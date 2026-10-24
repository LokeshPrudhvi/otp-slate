import assert from "node:assert/strict";
import { after, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

const bundle = new URL(`../.loading-tests-${process.pid}.mjs`, import.meta.url);
await build({
  entryPoints: [
    fileURLToPath(new URL("../packages/ui/src/loading.tsx", import.meta.url)),
  ],
  outfile: fileURLToPath(bundle),
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react/*"],
});
const { LoadingState } = await import(bundle.href);
after(() => rm(bundle, { force: true }));

function render(props) {
  return new JSDOM(renderToStaticMarkup(createElement(LoadingState, props)))
    .window.document;
}

test("loading state announces its purpose and hides placeholder content from assistive technology", () => {
  const document = render({
    label: "Opening your courses",
    detail: "Preparing your learning space.",
    variant: "cards",
  });
  const status = document.querySelector('[role="status"]');
  assert.equal(status.getAttribute("aria-label"), "Opening your courses");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-busy"), "true");
  assert.match(status.textContent, /Preparing your learning space/);
  assert.equal(
    document
      .querySelector(".slate-loading__skeleton")
      .getAttribute("aria-hidden"),
    "true",
  );
  assert.equal(
    document.querySelectorAll("button, input, a, [tabindex]").length,
    0,
  );
});

test("inline state remains compact and contains no decorative page layout", () => {
  const document = render({
    variant: "inline",
    label: "Fetching recipients",
    fullScreen: true,
  });
  assert.equal(document.querySelector(".slate-loading__skeleton"), null);
  assert.equal(document.querySelector(".slate-loading__brand"), null);
  assert.equal(document.querySelector(".slate-loading--fullscreen"), null);
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /Fetching recipients/,
  );
});

test("full-screen authentication loading uses one status and decorative Slate branding", () => {
  const document = render({ label: "Opening your portal", fullScreen: true });
  assert.equal(document.querySelectorAll('[role="status"]').length, 1);
  assert.equal(
    document.querySelector(".slate-loading__brand").getAttribute("aria-hidden"),
    "true",
  );
  assert.ok(document.querySelector(".slate-loading--fullscreen"));
  assert.equal(document.querySelector('[role="progressbar"]'), null);
});
