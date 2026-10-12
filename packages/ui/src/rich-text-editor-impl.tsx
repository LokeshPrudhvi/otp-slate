import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { LessonContent, safeLessonLink } from "./lesson-content";
import { isolateTextStyleLines } from "./rich-text-formatting";
import type { RichTextEditorProps } from "./rich-text-editor";
import "./rich-text-editor.css";

const plainDocument = (value: string) => ({
  type: "doc",
  content: value.split("\n").map((text) => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) })),
});

export default function LessonEditor({ value, onChange, label, disabled = false, format = "plain", maxLength = 100_000 }: RichTextEditorProps) {
  const id = useId();
  const callback = useRef(onChange);
  callback.current = onChange;
  const previous = useRef(value);
  const [mode, setMode] = useState<"write" | "markdown" | "preview">("write");
  const [insert, setInsert] = useState<"link" | "image" | null>(null);
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, trailingNode: false, link: { openOnClick: false, autolink: false, protocols: ["https", "http", "mailto"] } }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      TableKit.configure({ table: { resizable: false } }),
      TaskList, TaskItem.configure({ nested: true }),
      Image.configure({ allowBase64: false, HTMLAttributes: { referrerpolicy: "no-referrer" } }),
    ],
    content: format === "markdown" ? value : plainDocument(value),
    ...(format === "markdown" ? { contentType: "markdown" as const } : {}),
    editable: !disabled,
    editorProps: { attributes: { class: "lesson-rich-content rte-document", role: "textbox", "aria-label": label, "aria-multiline": "true" } },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      previous.current = markdown;
      callback.current(markdown);
    },
  });
  useEditorState({ editor, selector: ({ editor: current }) => current ? JSON.stringify({
    marks: ["bold", "italic", "strike", "code", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "table"].map(mark => current.isActive(mark)),
    level: current.getAttributes("heading").level,
    undo: current.can().undo(), redo: current.can().redo(),
  }) : "" });
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  useEffect(() => {
    if (!editor || value === previous.current) return;
    previous.current = value;
    editor.commands.setContent(format === "markdown" ? value : plainDocument(value), { emitUpdate: false, ...(format === "markdown" ? { contentType: "markdown" as const } : {}) });
  }, [editor, value, format]);
  if (!editor) return <p role="status">Opening editor…</p>;

  // Pointer clicks should keep the document selection; keyboard users can still
  // tab into the toolbar and activate controls normally.
  const keepSelection = (event: MouseEvent) => { if (event.button === 0) event.preventDefault(); };
  const tool = (name: string, content: ReactNode, action: () => void, active = false, unavailable = false) => <button type="button" title={name} aria-label={name} aria-pressed={active} disabled={disabled || unavailable} className={active ? "is-active" : ""} onMouseDown={keepSelection} onClick={action}>{content}</button>;
  const add = () => {
    const url = safeLessonLink(address.trim(), insert === "image");
    if (!url) { setError(insert === "image" ? "Use a public HTTPS image link." : "Use an HTTPS, HTTP or email link."); return; }
    if (insert === "image") editor.chain().focus().setImage({ src: url, alt: description.trim() || "Lesson illustration" }).run();
    else if (editor.state.selection.empty) editor.chain().focus().insertContent({ type: "text", text: description.trim() || url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setInsert(null); setAddress(""); setDescription(""); setError("");
  };

  return <section className={`rte${disabled ? " rte-disabled" : ""}`} aria-label={label}>
    <div className="rte-topbar">
      <span className="rte-label">{label}</span>
      <div className="rte-modes" role="group" aria-label="Editor mode">
        {([['write', 'Write'], ['markdown', 'Markdown'], ['preview', 'Preview']] as const).map(([key, text]) => <button type="button" key={key} className={mode === key ? "active" : ""} aria-pressed={mode === key} onClick={() => { setMode(key); setInsert(null); }}>{text}</button>)}
      </div>
    </div>
    {mode === "write" && <>
      <div className="rte-toolbar" role="group" aria-label="Text formatting">
        <details className="rte-style-picker"><summary aria-label="Text style" onMouseDown={keepSelection}>{editor.isActive("heading") ? `Heading ${editor.getAttributes("heading").level}` : "Text style"} <span aria-hidden="true">⌄</span></summary><div className="rte-style-menu">
          <button type="button" disabled={disabled} aria-pressed={editor.isActive("paragraph")} onMouseDown={keepSelection} onClick={(event) => { editor.chain().focus().command(isolateTextStyleLines).setParagraph().run(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Paragraph</button>
          {([1, 2, 3, 4, 5, 6] as const).map(level => <button type="button" disabled={disabled} aria-pressed={editor.isActive("heading", { level })} onMouseDown={keepSelection} key={level} onClick={(event) => { editor.chain().focus().command(isolateTextStyleLines).setHeading({ level }).run(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Heading {level}</button>)}
        </div></details>
        <span className="rte-tools">
          {tool("Bold", <b>B</b>, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
          {tool("Italic", <i>I</i>, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
          {tool("Strikethrough", <s>S</s>, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
          {tool("Inline code", "<>" , () => editor.chain().focus().toggleCode().run(), editor.isActive("code"))}
        </span>
        <span className="rte-tools">
          {tool("Bullet list", "• List", () => editor.chain().focus().command(isolateTextStyleLines).toggleBulletList().run(), editor.isActive("bulletList"))}
          {tool("Numbered list", "1. List", () => editor.chain().focus().command(isolateTextStyleLines).toggleOrderedList().run(), editor.isActive("orderedList"))}
          {tool("Checklist", "☑", () => editor.chain().focus().command(isolateTextStyleLines).toggleTaskList().run(), editor.isActive("taskList"))}
          {tool("Quote", "❞", () => editor.chain().focus().command(isolateTextStyleLines).toggleBlockquote().run(), editor.isActive("blockquote"))}
          {tool("Code block", "{ }", () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
        </span>
        <span className="rte-tools">
          {tool("Insert link", "Link", () => { setInsert("link"); setAddress(editor.getAttributes("link").href || ""); setError(""); })}
          {tool("Remove link", "Unlink", () => editor.chain().focus().unsetLink().run(), false, !editor.isActive("link"))}
          {tool("Insert image", "Image", () => { setInsert("image"); setAddress(""); setError(""); })}
          {tool("Insert table", "Table", () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), false, editor.isActive("table"))}
          {tool("Divider", "―", () => editor.chain().focus().setHorizontalRule().run())}
        </span>
        <span className="rte-tools">
          {tool("Undo", "↶", () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
          {tool("Redo", "↷", () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
        </span>
      </div>
      {editor.isActive("table") && <div className="rte-table-tools" role="group" aria-label="Table actions">
        {tool("Add row", "+ Row", () => editor.chain().focus().addRowAfter().run())}
        {tool("Add column", "+ Column", () => editor.chain().focus().addColumnAfter().run())}
        {tool("Remove row", "Remove row", () => editor.chain().focus().deleteRow().run())}
        {tool("Remove column", "Remove column", () => editor.chain().focus().deleteColumn().run())}
        {tool("Delete table", "Delete table", () => editor.chain().focus().deleteTable().run())}
      </div>}
      {insert && <div className="rte-insert" role="group" aria-label={`Insert ${insert}`}>
        <label htmlFor={`${id}-address`}>{insert === "image" ? "Image URL" : "Link URL"}</label>
        <input id={`${id}-address`} type="url" placeholder="https://…" value={address} onChange={event => setAddress(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
        <label htmlFor={`${id}-description`}>{insert === "image" ? "Image description" : "Link text (for a new link)"}</label>
        <input id={`${id}-description`} value={description} onChange={event => setDescription(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        <div><button type="button" disabled={disabled} onClick={add}>Insert {insert}</button><button type="button" onClick={() => setInsert(null)}>Cancel</button></div>
      </div>}
    </>}
    <div hidden={mode !== "write"}><EditorContent editor={editor} /></div>
    {mode === "markdown" && <textarea className="rte-source" aria-label={`${label} Markdown source`} spellCheck={false} rows={14} maxLength={maxLength} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} />}
    {mode === "preview" && <div className="rte-preview">{value.trim() ? <LessonContent body={value} format={format} /> : <p className="rte-empty">Your formatted content will appear here.</p>}</div>}
    <div className="rte-footer"><span>Select text to format · Enter starts a paragraph · Shift+Enter adds a line break</span><span className={value.length > maxLength ? "rte-over-limit" : ""}>{value.length.toLocaleString()} / {maxLength.toLocaleString()}</span></div>
    {value.length > maxLength && <p className="rte-limit-error" role="alert">Shorten this content to {maxLength.toLocaleString()} characters before publishing.</p>}
  </section>;
}
