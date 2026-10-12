import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

const mailUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value));
const passwordResetMailPayload = z.object({
  email: z.string().email(),
  url: mailUrl,
  userId: z.string().min(1).optional(),
});
const welcomeMailPayload = z.object({
  userId: z.string().min(1).optional(),
  email: z.string().email(),
  name: z.string().min(1),
  temporaryPassword: z.string().min(1),
  loginUrl: mailUrl,
  organizationName: z.string().min(1),
  studentId: z.string().min(1),
});
export type PasswordResetMailPayload = z.infer<typeof passwordResetMailPayload>;
export type WelcomeMailPayload = z.infer<typeof welcomeMailPayload>;
export type MailPayloads = {
  password_reset: PasswordResetMailPayload;
  welcome_student: WelcomeMailPayload;
};

export interface PhoneSender {
  configured: boolean;
  send(phone: string, code: string): Promise<void>;
}
export function metaPhoneSender(): PhoneSender {
  const {
    WHATSAPP_ACCESS_TOKEN: token,
    WHATSAPP_PHONE_NUMBER_ID: sender,
    WHATSAPP_TEMPLATE_NAME: template,
    WHATSAPP_GRAPH_VERSION: version,
  } = process.env;
  return {
    configured: Boolean(token && sender && template && version),
    async send(phone, code) {
      if (
        !token ||
        !sender ||
        !template ||
        !version ||
        !/^v\d+\.\d+$/.test(version)
      )
        throw new Error("WhatsApp is not configured.");
      const response = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(sender)}/messages`,
        {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone.replace(/^\+/, ""),
            type: "template",
            template: {
              name: template,
              language: {
                code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US",
              },
              components: [
                { type: "body", parameters: [{ type: "text", text: code }] },
                {
                  type: "button",
                  sub_type: "url",
                  index: "0",
                  parameters: [{ type: "text", text: code }],
                },
              ],
            },
          }),
        },
      );
      if (!response.ok) throw new Error("WhatsApp delivery request failed.");
    },
  };
}
export function encryptPayload(secret: string, data: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret).digest(),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function decryptPayload(
  secret: string,
  data: string,
): PasswordResetMailPayload;
export function decryptPayload<T extends keyof MailPayloads>(
  secret: string,
  data: string,
  type: T,
): MailPayloads[T];
export function decryptPayload(
  secret: string,
  data: string,
  type: keyof MailPayloads = "password_reset",
): MailPayloads[keyof MailPayloads] {
  let value: unknown;
  try {
    const buffer = Buffer.from(data, "base64url");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      buffer.subarray(0, 12),
    );
    cipher.setAuthTag(buffer.subarray(12, 28));
    value = JSON.parse(
      Buffer.concat([
        cipher.update(buffer.subarray(28)),
        cipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error("Email payload could not be decrypted.");
  }
  const parsed = (
    type === "welcome_student" ? welcomeMailPayload : passwordResetMailPayload
  ).safeParse(value);
  if (!parsed.success) throw new Error("Email payload is invalid.");
  return parsed.data;
}
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
export class MailQuotaError extends Error {
  readonly retryAfterMs = 24 * 3600_000;
  constructor(readonly quota: "daily" | "monthly") {
    super("Email sending quota is temporarily exhausted.");
    this.name = "MailQuotaError";
  }
}
function throwMailProviderError(error: { name: string }): never {
  if (error.name === "daily_quota_exceeded") throw new MailQuotaError("daily");
  if (error.name === "monthly_quota_exceeded")
    throw new MailQuotaError("monthly");
  // Provider messages may contain recipient addresses or request content.
  throw new Error("Email delivery failed.");
}
async function sendResendMail(
  id: string,
  mail: { to: string; subject: string; text: string; html?: string },
) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    throw new Error("Email is not configured.");
  // A fixed endpoint avoids credential forwarding. Keep the timeout shorter
  // than the outbox lease; never log provider bodies or message content.
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": id,
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, ...mail }),
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Email acceptance was not confirmed.");
  }
  const record =
    result && typeof result === "object"
      ? (result as { name?: unknown; id?: unknown })
      : {};
  if (!response.ok)
    throwMailProviderError({
      name: typeof record.name === "string" ? record.name : "unknown_error",
    });
  if (typeof record.id !== "string" || !record.id)
    throw new Error("Email acceptance was not confirmed.");
}
export async function sendResetMail(
  id: string,
  payload: PasswordResetMailPayload,
) {
  await sendResendMail(id, {
    to: payload.email,
    subject: "Reset your OTP Slate password",
    text: `Use this link to reset your password: ${payload.url}\nIf you did not request this, ignore this email.`,
  });
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}
export function formatWelcomeMail(payload: WelcomeMailPayload) {
  const parsed = welcomeMailPayload.safeParse(payload);
  if (!parsed.success) throw new Error("Email payload is invalid.");
  const {
    email,
    name,
    temporaryPassword,
    loginUrl,
    organizationName,
    studentId,
  } = parsed.data;
  return {
    subject: "Welcome to OTP Slate — your student account is ready",
    text: `Hi ${name},\n\nWelcome to OTP Slate! Your student account for ${organizationName} is ready.\n\nStudent ID: ${studentId}\nEmail: ${email}\nTemporary password: ${temporaryPassword}\n\nSign in: ${loginUrl}\n\nSet a new password during onboarding to secure your account. Keep these sign-in details private.\n\nIf you weren't expecting this invitation, contact your organization's administrator.\n\nThe OTP Slate team`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Welcome to OTP Slate</title></head>
<body style="margin:0;padding:32px 16px;background:#f3f5f4;color:#19251f;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
<table role="presentation" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;background:#ffffff;border:1px solid #dce4df;border-radius:16px;"><tr><td style="padding:32px;">
<p style="margin:0 0 24px;font-size:14px;font-weight:700;letter-spacing:2px;color:#176445;">OTP SLATE</p>
<h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;">Your learning journey starts here.</h1>
<p>Hi ${escapeHtml(name)},</p>
<p>Your student account for <strong>${escapeHtml(organizationName)}</strong> is ready. Use the details below to sign in.</p>
<table role="presentation" style="width:100%;margin:24px 0;border-collapse:collapse;background:#f3f7f5;">
<tr><td style="padding:16px 20px 4px;color:#526159;font-size:12px;">STUDENT ID</td></tr><tr><td style="padding:0 20px 12px;overflow-wrap:anywhere;">${escapeHtml(studentId)}</td></tr>
<tr><td style="padding:0 20px 4px;color:#526159;font-size:12px;">EMAIL</td></tr><tr><td style="padding:0 20px 12px;overflow-wrap:anywhere;">${escapeHtml(email)}</td></tr>
<tr><td style="padding:0 20px 4px;color:#526159;font-size:12px;">TEMPORARY PASSWORD</td></tr><tr><td style="padding:0 20px 20px;font-family:monospace;font-size:16px;overflow-wrap:anywhere;white-space:pre-wrap;">${escapeHtml(temporaryPassword)}</td></tr>
</table>
<p style="margin:24px 0;"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 24px;background:#176445;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Sign in to OTP Slate</a></p>
<p>Set a new password during onboarding to secure your account. Keep these sign-in details private.</p>
<p style="font-size:13px;color:#526159;">If the button doesn't work, open this link:<br><a href="${escapeHtml(loginUrl)}" style="color:#176445;overflow-wrap:anywhere;">${escapeHtml(loginUrl)}</a></p>
<hr style="margin:28px 0;border:0;border-top:1px solid #dce4df;">
<p style="margin:0;font-size:13px;color:#526159;">If you weren't expecting this invitation, contact your organization's administrator.</p>
<p style="margin:16px 0 0;font-size:13px;color:#526159;">The OTP Slate team</p>
</td></tr></table></body></html>`,
  };
}
export async function sendWelcomeMail(id: string, payload: WelcomeMailPayload) {
  await sendResendMail(id, {
    to: payload.email,
    ...formatWelcomeMail(payload),
  });
}
export function r2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET,
  );
}
export async function createUpload(key: string, contentType: string) {
  if (!r2Configured()) throw new Error("Storage is not configured.");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 },
  );
}
