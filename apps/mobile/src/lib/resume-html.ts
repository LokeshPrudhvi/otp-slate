import type { ResumeDraft } from "./resume-model";
export const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    )
    .replace(/\r?\n/g, "<br>");
const text = (v: string) => v.trim();
export function resumeHtml(d: ResumeDraft) {
  const p = (v: string) => (text(v) ? `<p>${escapeHtml(v)}</p>` : "");
  const points = (items: string[]) =>
    items.some(text)
      ? `<ul>${items
          .filter(text)
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>`
      : "";
  const section = (title: string, body: string) =>
    body ? `<section><h2>${title}</h2>${body}</section>` : "";
  const projects = d.projects
    .filter((e) => e.title || e.description || e.bullets.some(text))
    .map(
      (e) =>
        `<article><h3>${escapeHtml(e.title)}</h3>${p(e.url)}${p(e.description)}${points(e.bullets)}</article>`,
    )
    .join("");
  const experience = d.experience
    .filter(
      (e) => e.title || e.company || e.description || e.bullets.some(text),
    )
    .map(
      (e) =>
        `<article><div class="row"><h3>${escapeHtml(e.title)}</h3><span>${escapeHtml([e.startDate, e.current ? "Present" : e.endDate].filter(Boolean).join(" – "))}</span></div>${p(e.company)}${p(e.description)}${points(e.bullets)}</article>`,
    )
    .join("");
  const education = d.education
    .filter((e) => e.institution || e.degree || e.description)
    .map(
      (e) =>
        `<article><div class="row"><h3>${escapeHtml(e.institution)}</h3><span>${escapeHtml([e.startDate, e.current && e.endDate ? `Expected ${e.endDate}` : e.current ? "Present" : e.endDate].filter(Boolean).join(" – "))}</span></div>${p([e.degree, e.fieldOfStudy].filter(Boolean).join(" · "))}${p(e.grade)}${p(e.description)}</article>`,
    )
    .join("");
  const certifications = d.certifications
    .filter((e) => e.name || e.description)
    .map(
      (e) =>
        `<article><h3>${escapeHtml(e.name)}</h3>${p([e.issuer, e.issuedDate].filter(Boolean).join(" · "))}${p(e.credentialId)}${p(e.url)}${p(e.description)}</article>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(d.name)} - Resume</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:10.5pt/1.45 Arial,sans-serif;color:#17212b;margin:0;padding:4mm;overflow-wrap:anywhere}h1{font-size:24pt;margin:0 0 5pt}header{border-bottom:1pt solid #24384e;padding-bottom:10pt}h2{font-size:10.5pt;text-transform:uppercase;letter-spacing:.06em;margin:15pt 0 5pt;break-after:avoid}h3{font-size:10.5pt;margin:0;break-after:avoid}p{margin:4pt 0;orphans:3;widows:3}.contact{font-size:9pt}.row{display:flex;justify-content:space-between;gap:12pt;break-after:avoid}.row span{font-size:9pt}article{margin:9pt 0}ul{padding-left:15pt;margin:4pt 0}li{margin:2pt 0}body.modern h1,body.modern h2{color:#0F2747}body.modern header{border-bottom:3pt solid #0F2747}body.compact{font-size:9.5pt;line-height:1.3}body.compact h2{margin-top:10pt}body.serif{font-family:Georgia,serif}</style></head><body class="${d.template}"><header><h1>${escapeHtml(d.name)}</h1>${p(d.title)}<p class="contact">${escapeHtml([d.email, d.phone, d.location, d.links].filter(text).join(" | "))}</p></header>${section("Professional summary", p(d.summary))}${section("Skills", d.skills.filter(text).map(escapeHtml).join(" · "))}${section("Experience", experience)}${section("Projects", projects)}${section("Education", education)}${section("Certifications", certifications)}</body></html>`;
}
