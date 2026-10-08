import { readFile, writeFile } from "node:fs/promises";

// Preserve the approved HTML's design verbatim; React owns state and API calls.
const source = await readFile(
  new URL("../src/otp-slate.html", import.meta.url),
  "utf8",
);
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const logo = source.match(
  /<div class="a-logo">(<svg[\s\S]*?<\/svg>)<\/div>/,
)?.[1];
const otto = source.match(
  /<button class="pet"[^>]*>\s*(<svg[\s\S]*?<\/svg>)/,
)?.[1];
const exam = source.match(
  /class="exam-empty-art" aria-hidden="true">(<svg[\s\S]*?<\/svg>)/,
)?.[1];
if (!css || !logo || !otto || !exam)
  throw new Error("The student reference design could not be extracted.");
await writeFile(
  new URL("../apps/student/src/reference.css", import.meta.url),
  `/* Generated from src/otp-slate.html by scripts/sync-student-design.mjs. */\n${css}`,
);
await writeFile(
  new URL("../apps/student/src/reference-art.ts", import.meta.url),
  `// Static, trusted SVG artwork copied from the approved HTML.\nexport const referenceArt = ${JSON.stringify({ logo, otto, exam }, null, 2)} as const;\n`,
);
