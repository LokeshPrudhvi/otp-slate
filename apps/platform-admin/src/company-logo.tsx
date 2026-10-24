import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CompanyLogo } from "@slate/contracts";
import { api, ErrorMessage, Field, useData } from "@slate/ui";
import { AdminSelect } from "./select";
import "./company-logo.css";
const normalize = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export function CompanyLogoField({
  company,
  value,
  onChange,
  onPending,
}: {
  company: string;
  value: string | null;
  onChange: (id: string | null) => void;
  onPending: (pending: boolean) => void;
}) {
  const query = useQueryClient(),
    data = useData<CompanyLogo[]>("company-logos", "platform/company-logos"),
    help = useId();
  const [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [notice, setNotice] = useState("");
  const selected = data.data?.find((logo) => logo.id === value);
  useEffect(() => {
    if (value || !company.trim()) return;
    const found = data.data?.find(
      (logo) => normalize(logo.companyName) === normalize(company),
    );
    if (found) onChange(found.id);
  }, [company, value, data.data, onChange]);
  async function upload(file: File) {
    if (pending || !company.trim()) return;
    setError(null);
    setNotice("");
    setPending(true);
    onPending(true);
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        !file.size ||
        file.size > 524288
      )
        throw new Error("Choose a PNG, JPG or WebP logo of 512 KB or smaller.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const match = data.data?.find((logo) => logo.sha256 === hash);
      if (match) {
        onChange(match.id);
        setNotice(
          "This logo is already saved. Reused the existing image without another upload.",
        );
        return;
      }
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const logo = await api<CompanyLogo & { reused: boolean }>(
        "platform/company-logos",
        "POST",
        {
          companyName: company.trim(),
          fileName: file.name.slice(0, 180),
          contentType: file.type,
          base64: btoa(binary),
        },
      );
      query.setQueryData<CompanyLogo[]>(
        ["platform", "company-logos"],
        (current) => [
          logo,
          ...(current ?? []).filter((item) => item.id !== logo.id),
        ],
      );
      onChange(logo.id);
      setNotice(
        logo.reused
          ? "Reused the existing image. No duplicate copy was stored."
          : "Logo saved to your library. Reuse it for future posts.",
      );
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue
          : new Error("Logo upload failed. Please retry."),
      );
    } finally {
      setPending(false);
      onPending(false);
    }
  }
  return (
    <div className="company-logo-field">
      <div className="company-logo-field-header">
        <span className="company-logo-field-preview">
          {selected?.url ? (
            <img src={selected.url} alt={`${selected.companyName} logo`} />
          ) : (
            company.trim().slice(0, 2).toUpperCase() || "＋"
          )}
        </span>
        <div>
          <strong>Company logo</strong>
          <p>Upload once. Reuse across jobs, PYQ and organizations.</p>
        </div>
      </div>
      <Field label="Choose a saved logo">
        <AdminSelect
          searchable
          aria-label="Choose a saved company logo"
          value={value ?? ""}
          onChange={(id) => {
            onChange(id || null);
            setNotice("");
          }}
          disabled={pending || data.isPending}
          placeholder={
            data.isPending
              ? "Loading logo library…"
              : "Select an existing company logo"
          }
          options={(data.data ?? []).map((logo) => ({
            value: logo.id,
            label: logo.companyName,
            description: logo.fileName,
          }))}
        />
      </Field>
      <div className="company-logo-upload">
        <label className="btn">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Upload a new company logo"
            disabled={pending || !company.trim() || data.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          {pending ? "Saving logo…" : "＋ Upload a new logo"}
        </label>
        <span id={help}>
          {company.trim()
            ? "PNG, JPG or WebP · max 512 KB"
            : "Enter the company name to upload its logo"}
        </span>
      </div>
      {pending && (
        <p className="muted" role="status">
          Checking your library and saving the logo…
        </p>
      )}
      {notice && (
        <p className="company-logo-notice" role="status">
          {notice}
        </p>
      )}
      <ErrorMessage error={error ?? data.error} />
    </div>
  );
}
