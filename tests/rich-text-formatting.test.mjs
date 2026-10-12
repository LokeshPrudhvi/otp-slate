// Run: node --import tsx --test tests/rich-text-formatting.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { isolateTextStyleLines } from "../packages/ui/src/rich-text-formatting.ts";

const window = new JSDOM("<!doctype html><html><body></body></html>").window;
for (const name of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? window : window[name] });
}

function setup(t, content, contentType = "markdown") {
  const editor = new Editor({
    extensions: [StarterKit.configure({ underline: false, trailingNode: false }), Markdown.configure({ markedOptions: { gfm: true } }), TaskList, TaskItem.configure({ nested: true })],
    content,
    ...(contentType === "markdown" ? { contentType } : {}),
  });
  t.after(() => editor.destroy());
  return editor;
}

function heading(editor, from, to = from, level = 1) {
  editor.commands.setTextSelection({ from, to });
  assert.equal(editor.chain().command(isolateTextStyleLines).setHeading({ level }).run(), true);
}

function blocks(editor) {
  return editor.getJSON().content.map(node => ({ type: node.type, text: node.content?.map(child => child.text ?? "\n").join("") ?? "", level: node.attrs?.level }));
}

for (const [label, content, contentType] of [
  ["Markdown single newlines", "Title\nBody\nAfter", "markdown"],
  ["pasted HTML line breaks", "<p>Title<br>Body<br>After</p>", "html"],
]) {
  test(`${label}: first-line heading leaves the remaining paragraph alone`, t => {
    const editor = setup(t, content, contentType);
    heading(editor, 1, 6);
    const remainingLines = contentType === "html" ? "Body<br>After" : "Body\nAfter";
    assert.equal(editor.getHTML(), `<h1>Title</h1><p>${remainingLines}</p>`);
    assert.equal(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to), "Title");
  });

  test(`${label}: selected middle line changes independently`, t => {
    const editor = setup(t, content, contentType);
    heading(editor, 7, 11, 2);
    assert.equal(editor.getHTML(), "<p>Title</p><h2>Body</h2><p>After</p>");
    assert.equal(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to), "Body");
  });

  test(`${label}: last line changes without splitting preceding soft lines`, t => {
    const editor = setup(t, content, contentType);
    heading(editor, 12, 17);
    assert.deepEqual(blocks(editor), [
      { type: "paragraph", text: "Title\nBody", level: undefined },
      { type: "heading", text: "After", level: 1 },
    ]);
  });
}

test("a caret inside a soft line targets that line and stays at its text offset", t => {
  const editor = setup(t, "Title\nBody\nAfter");
  heading(editor, 9);
  assert.equal(editor.getHTML(), "<p>Title</p><h1>Body</h1><p>After</p>");
  assert.equal(editor.state.selection.empty, true);
  assert.equal(editor.state.selection.$from.parentOffset, 2);
});

test("reverse selection retains its direction and chosen text", t => {
  const editor = setup(t, "Title\nBody\nAfter");
  heading(editor, 11, 7);
  assert.equal(editor.getHTML(), "<p>Title</p><h1>Body</h1><p>After</p>");
  assert.ok(editor.state.selection.anchor > editor.state.selection.head);
  assert.equal(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to), "Body");
});

test("multiple selected lines become separate headings and exclude a following line-start endpoint", t => {
  const editor = setup(t, "Title\nBody\nAfter");
  heading(editor, 1, 12);
  assert.equal(editor.getHTML(), "<h1>Title</h1><h1>Body</h1><p>After</p>");
});

test("ordinary paragraphs and long visual wrapping are not split", t => {
  const editor = setup(t, "First paragraph with enough words to wrap on narrow screens.\n\nSecond paragraph.");
  heading(editor, 7, 16);
  assert.equal(editor.getJSON().content.length, 2);
  assert.equal(editor.getJSON().content[0].type, "heading");
  assert.equal(editor.getJSON().content[1].type, "paragraph");
});

test("a multi-block selection keeps standard heading behavior", t => {
  const editor = setup(t, "First\n\nSecond\n\nThird");
  heading(editor, 2, 11);
  assert.deepEqual(editor.getJSON().content.map(node => node.type), ["heading", "heading", "paragraph"]);
});

test("splitting retains bold text, links and untouched following content", t => {
  const editor = setup(t, "Before\n**Bold** [link](https://example.com)\nAfter\nUntouched");
  heading(editor, 9, 16);
  const [before, selected, after] = editor.getJSON().content;
  assert.equal(before.type, "paragraph");
  assert.equal(selected.type, "heading");
  assert.deepEqual(selected.content[0].marks, [{ type: "bold" }]);
  assert.equal(selected.content.at(-1).marks[0].type, "link");
  assert.equal(selected.content.at(-1).marks[0].attrs.href, "https://example.com");
  assert.equal(after.content[0].text, "After\nUntouched");
});

test("paragraph styling isolates one line of an existing multiline heading", t => {
  const editor = setup(t, "<h1>Title<br>Body<br>After</h1>", "html");
  editor.commands.setTextSelection({ from: 7, to: 11 });
  editor.chain().command(isolateTextStyleLines).setParagraph().run();
  assert.equal(editor.getHTML(), "<h1>Title</h1><p>Body</p><h1>After</h1>");
});

test("one undo restores the original document and redo restores the isolated heading", t => {
  const editor = setup(t, "Title\nBody\nAfter");
  const original = editor.getJSON();
  heading(editor, 7, 11);
  const formatted = editor.getJSON();
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(editor.getJSON(), original);
  assert.equal(editor.commands.redo(), true);
  assert.deepEqual(editor.getJSON(), formatted);
});

test("can() queries do not mutate the document or selection", t => {
  const editor = setup(t, "Title\nBody\nAfter");
  editor.commands.setTextSelection({ from: 7, to: 11 });
  const original = editor.getJSON();
  const selection = editor.state.selection.toJSON();
  assert.equal(editor.can().chain().command(isolateTextStyleLines).setHeading({ level: 1 }).run(), true);
  assert.deepEqual(editor.getJSON(), original);
  assert.deepEqual(editor.state.selection.toJSON(), selection);
});

test("Enter after the new heading naturally creates a paragraph", t => {
  const editor = setup(t, "Title\nBody");
  heading(editor, 1, 6);
  editor.commands.setTextSelection(6);
  assert.equal(editor.commands.splitBlock(), true);
  assert.equal(editor.getHTML(), "<h1>Title</h1><p></p><p>Body</p>");
});

test("a newline-only selection and a caret before a break stay on the preceding line", t => {
  for (const to of [6, 7]) {
    const editor = setup(t, "Title\nBody");
    heading(editor, 6, to);
    assert.equal(editor.getHTML(), "<h1>Title</h1><p>Body</p>");
  }
});

test("empty soft lines remain present without changing neighboring paragraphs", t => {
  const editor = setup(t, "<p>Title<br><br>Body</p>", "html");
  heading(editor, 7);
  assert.equal(editor.getHTML(), "<p>Title</p><h1></h1><p>Body</p>");
});

test("formatting survives Markdown serialization and reopening", t => {
  const editor = setup(t, "<p><strong>Intro</strong><br><br>Body paragraph<br><br></p>", "html");
  heading(editor, 1, 6);
  const saved = editor.getMarkdown();
  assert.match(saved, /^# \*\*Intro\*\*/);
  assert.doesNotMatch(saved, /#.*Body/);
  const reopened = setup(t, saved);
  assert.equal(reopened.getJSON().content[0].type, "heading");
  assert.equal(reopened.getJSON().content[0].content[0].text, "Intro");
  assert.deepEqual(reopened.getJSON().content[0].content[0].marks, [{ type: "bold" }]);
  assert.ok(reopened.getJSON().content.slice(1).every(node => node.type === "paragraph"));
  assert.ok(reopened.state.doc.textContent.includes("Body paragraph"));
});

test("a range spanning soft lines in two separate paragraphs isolates both endpoints", t => {
  const editor = setup(t, "Before\nStart\n\nEnd\nAfter");
  heading(editor, 8, 18);
  assert.equal(editor.getHTML(), "<p>Before</p><h1>Start</h1><h1>End</h1><p>After</p>");
});

test("nested paragraph boundaries preserve a blockquote", t => {
  const editor = setup(t, "<blockquote><p>Title<br>Body<br>After</p></blockquote>", "html");
  heading(editor, 8, 12);
  assert.equal(editor.getHTML(), "<blockquote><p>Title</p><h1>Body</h1><p>After</p></blockquote>");
});

test("line breaks inside code blocks are not altered by the helper", t => {
  const editor = setup(t, "```text\nFirst\nSecond\n```\n\nAfter");
  editor.commands.setTextSelection({ from: 1, to: 6 });
  const original = editor.getJSON();
  editor.commands.command(isolateTextStyleLines);
  assert.deepEqual(editor.getJSON(), original);
});

for (const [command, html] of [
  ["toggleBulletList", "<ul><li><p>Body</p></li></ul>"],
  ["toggleOrderedList", "<ol><li><p>Body</p></li></ol>"],
  ["toggleBlockquote", "<blockquote><p>Body</p></blockquote>"],
]) {
  test(`${command} can also target one soft line`, t => {
    const editor = setup(t, "Title\nBody\nAfter");
    editor.commands.setTextSelection({ from: 7, to: 11 });
    assert.equal(editor.chain().command(isolateTextStyleLines)[command]().run(), true);
    assert.equal(editor.getHTML(), `<p>Title</p>${html}<p>After</p>`);
  });
}

test("checklist formatting targets the middle soft line and one undo restores the original paragraph", t => {
  const editor = setup(t, "Title\nBody\nAfter");
  const original = editor.getJSON();
  editor.commands.setTextSelection({ from: 7, to: 11 });
  assert.equal(editor.chain().command(isolateTextStyleLines).toggleTaskList().run(), true);
  const [before, checklist, after] = editor.getJSON().content;
  assert.deepEqual(before, { type: "paragraph", content: [{ type: "text", text: "Title" }] });
  assert.equal(checklist.type, "taskList");
  assert.equal(checklist.content.length, 1);
  assert.equal(checklist.content[0].type, "taskItem");
  assert.equal(checklist.content[0].attrs.checked, false);
  assert.deepEqual(checklist.content[0].content, [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }]);
  assert.deepEqual(after, { type: "paragraph", content: [{ type: "text", text: "After" }] });
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(editor.getJSON(), original);
});
