import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Resend } from "resend";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
export function decryptPayload(secret: string, data: string) {
  const buffer = Buffer.from(data, "base64url");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret).digest(),
    buffer.subarray(0, 12),
  );
  cipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(buffer.subarray(28)),
      cipher.final(),
    ]).toString("utf8"),
  ) as { email: string; url: string };
}
export async function sendResetMail(
  id: string,
  payload: { email: string; url: string },
) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    throw new Error("Email is not configured.");
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
    {
      from: process.env.EMAIL_FROM,
      to: payload.email,
      subject: "Reset your OTP Slate password",
      text: `Use this link to reset your password: ${payload.url}\nIf you did not request this, ignore this email.`,
    },
    { idempotencyKey: id },
  );
  if (result.error) throw new Error("Email delivery failed.");
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
