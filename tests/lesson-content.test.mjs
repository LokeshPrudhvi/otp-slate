// Run: TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test tests/lesson-content.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  LessonContent,
  safeLessonLink,
} from "../packages/ui/src/lesson-content.tsx";
import { getLessonVideoSource } from "../packages/contracts/src/lesson-media.ts";

function render(body, format) {
  return JSDOM.fragment(
    renderToStaticMarkup(createElement(LessonContent, { body, format })),
  );
}

test("legacy lessons remain literal text when format is omitted or plain", () => {
  const body = "# Not a heading\n\n- Not a list\n<script>alert(1)</script>";
  for (const format of [undefined, "plain"]) {
    const document = render(body, format);
    assert.equal(document.querySelector(".lesson-plain").textContent, body);
    assert.equal(document.querySelector("h1, ul, script"), null);
  }
});

test("Markdown preserves semantic headings, emphasis, lists, quotes and code", () => {
  const document = render(
    [
      "# Main heading",
      "## Section",
      "### Topic",
      "#### Detail",
      "##### Note",
      "###### Aside",
      "",
      "**Important** and *emphasis* with ~~old content~~ and `inline()`.",
      "",
      "- First bullet",
      "- Second bullet",
      "",
      "1. First step",
      "2. Second step",
      "",
      "> A useful quotation.",
      "",
      "```javascript",
      'const element = "<script>not executable</script>";',
      "```",
    ].join("\n"),
    "markdown",
  );
  for (let level = 1; level <= 6; level++) {
    assert.ok(document.querySelector(`h${level}`));
  }
  assert.equal(document.querySelector("strong").textContent, "Important");
  assert.equal(document.querySelector("em").textContent, "emphasis");
  assert.equal(document.querySelector("del").textContent, "old content");
  assert.equal(document.querySelectorAll("ul > li").length, 2);
  assert.equal(document.querySelectorAll("ol > li").length, 2);
  assert.equal(
    document.querySelector("blockquote p").textContent,
    "A useful quotation.",
  );
  assert.match(
    document.querySelector("pre code").textContent,
    /<script>not executable<\/script>/,
  );
  assert.equal(
    document.querySelector("pre code").className,
    "language-javascript",
  );
  assert.equal(document.querySelector("script"), null);
});

test("Markdown tables stay scrollable and task-list checkboxes are read-only", () => {
  const document = render(
    "| Concept | Example |\n| --- | --- |\n| Array | [1, 2] |\n\n- [x] Read the lesson\n- [ ] Practise the concept",
    "markdown",
  );
  assert.ok(document.querySelector(".lesson-table-scroll > table"));
  assert.equal(document.querySelectorAll("thead th").length, 2);
  assert.equal(document.querySelector("tbody td").textContent, "Array");
  const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
  assert.equal(checkboxes.length, 2);
  assert.ok(checkboxes.every((checkbox) => checkbox.disabled));
  assert.equal(checkboxes[0].checked, true);
  assert.equal(checkboxes[1].checked, false);
});

test("raw HTML cannot create scripts, frames, event handlers or custom styles", () => {
  const document = render(
    [
      "<script>window.__lessonAttack = true</script>",
      "",
      '<iframe src="https://evil.example.test"></iframe>',
      "",
      '<img src="x" onerror="window.__lessonAttack = true">',
      "",
      '<div style="position:fixed" onclick="alert(1)">Raw content</div>',
      "",
      "<style>body{display:none}</style>",
      "",
      "Safe paragraph.",
    ].join("\n"),
    "markdown",
  );
  assert.equal(document.querySelector("script, iframe, img, style"), null);
  assert.equal(document.querySelector("[onerror], [onclick], [style]"), null);
  assert.match(document.textContent, /Safe paragraph/);
});

test("unsafe Markdown destinations keep their label but do not create links or images", () => {
  const document = render(
    [
      "[JavaScript](javascript:alert%281%29)",
      "[Mixed case](JaVaScRiPt:alert%281%29)",
      "[Encoded protocol](javascript&#58;alert%281%29)",
      "[Data document](data:text/html;base64,PHNjcmlwdD4=)",
      "[Local file](file:///etc/passwd)",
      "[Credential link](https://user:password@example.test/)",
      "![Unsafe image](data:image/svg+xml;base64,PHN2Zz4=)",
      "![Insecure image](http://example.test/image.png)",
    ].join("\n\n"),
    "markdown",
  );
  assert.equal(document.querySelector("a, img"), null);
  assert.match(document.textContent, /JavaScript/);
  assert.match(document.textContent, /Unsafe image/);
});

test("safe resource links open separately with protections and HTTPS images retain alt text", () => {
  const document = render(
    "[Reference](https://example.test/guide?q=lesson)\n\n![Array diagram](https://example.test/diagram.png)",
    "markdown",
  );
  const link = document.querySelector("a");
  assert.equal(link.href, "https://example.test/guide?q=lesson");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  const image = document.querySelector("img");
  assert.equal(image.src, "https://example.test/diagram.png");
  assert.equal(image.alt, "Array diagram");
  assert.equal(image.getAttribute("loading"), "lazy");
  assert.equal(image.getAttribute("referrerpolicy"), "no-referrer");
});

test("safeLessonLink permits supported resources and rejects executable, relative and credential URLs", () => {
  for (const value of [
    "https://example.test/guide",
    "http://example.test/guide",
    "mailto:teacher@example.test",
    "#section-two",
  ]) {
    assert.equal(safeLessonLink(value), value);
  }
  for (const value of [
    "javascript:alert(1)",
    "java\nscript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///private/lesson.txt",
    "https://user:password@example.test/",
    "https://user@example.test/",
    "//example.test/guide",
    "/relative-path",
    "not a URL",
  ]) {
    assert.equal(safeLessonLink(value), "", value);
  }
});

test("lesson images accept only HTTPS destinations without credentials", () => {
  assert.equal(
    safeLessonLink("https://example.test/image.png", true),
    "https://example.test/image.png",
  );
  for (const value of [
    "http://example.test/image.png",
    "#anchor",
    "mailto:teacher@example.test",
    "data:image/png;base64,abc",
    "https://user:password@example.test/image.png",
  ]) {
    assert.equal(safeLessonLink(value, true), "", value);
  }
});

test("YouTube links normalize to privacy embeds and discard autoplay parameters", () => {
  for (const value of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=30",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    assert.deepEqual(
      getLessonVideoSource(value),
      {
        kind: "youtube",
        url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      },
      value,
    );
  }
});

test("Vimeo public and unlisted links preserve the required private-video hash", () => {
  assert.deepEqual(getLessonVideoSource("https://vimeo.com/123456789"), {
    kind: "vimeo",
    url: "https://player.vimeo.com/video/123456789",
  });
  for (const value of [
    "https://vimeo.com/123456789/abc123",
    "https://player.vimeo.com/video/123456789?h=abc123&autoplay=1",
  ]) {
    assert.deepEqual(getLessonVideoSource(value), {
      kind: "vimeo",
      url: "https://player.vimeo.com/video/123456789?h=abc123",
    });
  }
});

test("direct HTTPS MP4 and WebM URLs retain access query strings", () => {
  for (const value of [
    "https://cdn.example.test/course/lecture.mp4?signature=123",
    "https://cdn.example.test/course/lecture.WEBM",
  ]) {
    assert.deepEqual(getLessonVideoSource(value), { kind: "file", url: value });
  }
});

test("unsupported media links and spoofed provider URLs cannot become embedded content", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:video/mp4;base64,abc",
    "file:///private/video.mp4",
    "http://cdn.example.test/lecture.mp4",
    "//cdn.example.test/lecture.mp4",
    "https://user:password@cdn.example.test/lecture.mp4",
    "https://cdn.example.test:8443/lecture.mp4",
    "https://youtube.com.evil.example.test/watch?v=dQw4w9WgXcQ",
    "https://youtube.com@evil.example.test/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/short",
    "https://youtube.com/watch?v=invalid%3Cscript%3E",
    "https://youtube.com/channel/example",
    "https://vimeo.com/channels/staffpicks",
    "https://vimeo.com/not-a-video",
    "https://vimeo.com.evil.example.test/123456789",
    "https://example.test/embed/lesson",
    "https://cdn.example.test/lecture.mp4.html",
    "https://cdn.example.test/lecture?filename=video.mp4",
    "",
  ]) {
    assert.equal(getLessonVideoSource(value), null, value);
  }
});
