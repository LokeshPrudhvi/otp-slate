import { lazy, Suspense } from "react";

export interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  label: string;
  disabled?: boolean;
  format?: "plain" | "markdown";
}
const Editor = lazy(() => import("./rich-text-editor-impl"));
export function RichTextEditor(props: RichTextEditorProps) {
  return <Suspense fallback={<p role="status">Opening lesson editor…</p>}><Editor {...props} /></Suspense>;
}
