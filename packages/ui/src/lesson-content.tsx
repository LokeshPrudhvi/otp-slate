import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function safeLessonLink(value: string, image = false) {
  try {
    if (!image && value.startsWith("#")) return value;
    const url = new URL(value);
    if (url.username || url.password) return "";
    return (image ? ["https:"] : ["https:", "http:", "mailto:"]).includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export function LessonContent({ body, format = "plain" }: { body: string; format?: "plain" | "markdown" }) {
  if (format !== "markdown") return <div className="lesson-rich-content lesson-plain">{body}</div>;
  return <div className="lesson-rich-content">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml
      urlTransform={(url, key) => safeLessonLink(url, key === "src")}
      components={{
        a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
        img: ({ src, alt }) => src ? <img src={src} alt={alt || "Lesson illustration"} loading="lazy" referrerPolicy="no-referrer" /> : <span>{alt}</span>,
        table: ({ children }) => <div className="lesson-table-scroll"><table>{children}</table></div>,
      }}>{body}</Markdown>
  </div>;
}
