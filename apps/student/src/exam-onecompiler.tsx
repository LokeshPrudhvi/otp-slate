import { useEffect, useRef, useState } from "react";
import type { ExamLanguage } from "@slate/contracts";
const origin = "https://onecompiler.com";
const languages: Record<ExamLanguage, [string, string]> = {
  Python: ["python", "main.py"],
  Java: ["java", "Main.java"],
  "C++": ["cpp", "main.cpp"],
  C: ["c", "main.c"],
  JavaScript: ["javascript", "index.js"],
  TypeScript: ["typescript", "index.ts"],
  "C#": ["csharp", "Program.cs"],
  Go: ["go", "main.go"],
  Rust: ["rust", "main.rs"],
  Ruby: ["ruby", "main.rb"],
  PHP: ["php", "main.php"],
  Kotlin: ["kotlin", "Main.kt"],
};
export function compilerSourceMessage(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  source: Window | null,
  language: ExamLanguage,
): string | null {
  if (!source || event.origin !== origin || event.source !== source)
    return null;
  const data = event.data;
  const [id, name] = languages[language];
  if (
    !data ||
    typeof data !== "object" ||
    data.language !== id ||
    !Array.isArray(data.files) ||
    data.files.length !== 1
  )
    return null;
  const file = data.files[0];
  return file &&
    file.name === name &&
    typeof file.content === "string" &&
    file.content.length <= 30_000
    ? file.content
    : null;
}
export function ExamOneCompiler({
  language,
  code,
  input,
  editable,
  onCode,
}: {
  language: ExamLanguage;
  code: string;
  input: string;
  editable: boolean;
  onCode: (code: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [loaded, setLoaded] = useState(false),
    [synced, setSynced] = useState(false),
    [slow, setSlow] = useState(false),
    [retry, setRetry] = useState(0),
    [sourceError, setSourceError] = useState(""),
    [preparingRun, setPreparingRun] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null),
    latest = useRef({ code, onCode, editable }),
    expected = useRef<string | null>(null),
    acknowledged = useRef(false),
    pendingRun = useRef(false),
    runnerCode = useRef<string | null>(null),
    parentCode = useRef(code);
  latest.current = { code, onCode, editable };
  if (parentCode.current !== code) {
    parentCode.current = code;
    // A primary-editor change invalidates earlier runner messages immediately.
    // Runner-originated changes already match runnerCode and do not echo back.
    if (runnerCode.current !== code) {
      acknowledged.current = false;
      expected.current = null;
    }
  }
  const [id, name] = languages[language];
  function populate() {
    expected.current = latest.current.code;
    acknowledged.current = false;
    setSynced(false);
    frame.current?.contentWindow?.postMessage(
      {
        eventType: "populateCode",
        language: id,
        files: [{ name, content: latest.current.code }],
      },
      origin,
    );
  }
  useEffect(() => {
    if (open && loaded && !acknowledged.current && expected.current !== code)
      populate();
  }, [code, open, loaded]);
  useEffect(() => {
    if (!editable) {
      pendingRun.current = false;
      setPreparingRun(false);
    }
  }, [editable]);
  useEffect(() => {
    if (!open || synced) return;
    const timer = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(timer);
  }, [open, retry, synced]);
  useEffect(() => {
    if (!open || !loaded || synced) return;
    let remaining = 10;
    const timer = setInterval(() => {
      if (remaining-- > 0) populate();
      else clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [open, loaded, synced, retry]);
  useEffect(() => {
    if (!open) return;
    const receive = (event: MessageEvent) => {
      if (!latest.current.editable) return;
      const content = compilerSourceMessage(
        event,
        frame.current?.contentWindow || null,
        language,
      );
      if (content === null) {
        if (
          event.origin === origin &&
          event.source === frame.current?.contentWindow &&
          event.data?.language === id &&
          event.data?.files?.[0]?.name === name &&
          typeof event.data.files[0].content === "string" &&
          event.data.files[0].content.length > 30_000
        )
          setSourceError(
            "Runner code exceeds 30,000 characters. Shorten it to sync; your last valid answer above is preserved.",
          );
        return;
      }
      setSourceError("");
      // Ignore the runner's initial sample until it echoes the exact source we sent.
      if (!acknowledged.current) {
        if (expected.current === null || content !== expected.current) return;
        if (content !== latest.current.code) {
          populate();
          return;
        }
        acknowledged.current = true;
        runnerCode.current = content;
        setSynced(true);
        setSlow(false);
        if (pendingRun.current) {
          pendingRun.current = false;
          setPreparingRun(false);
          frame.current?.contentWindow?.postMessage(
            { eventType: "triggerRun" },
            origin,
          );
        }
        return;
      }
      runnerCode.current = content;
      if (content !== latest.current.code) latest.current.onCode(content);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [open, language]);
  if (!editable) return null;
  return (
    <section className="exam-embed">
      <button
        className="a-btn"
        onClick={() => {
          setOpen((value) => !value);
          setLoaded(false);
          setSynced(false);
          setSlow(false);
          expected.current = null;
          acknowledged.current = false;
          runnerCode.current = null;
          pendingRun.current = false;
          setPreparingRun(false);
        }}
      >
        {open ? "Close OneCompiler" : "Run in OneCompiler"}
      </button>
      <p>
        OneCompiler runs your code in its own editor. Only your code and public
        examples are shared; its output does not determine your exam grade. The
        source shown above is your submitted answer.
      </p>
      {open && (
        <>
          <div className="exam-embed-actions">
            <button
              className="a-btn pri"
              disabled={!loaded || preparingRun}
              onClick={() => {
                pendingRun.current = true;
                setPreparingRun(true);
                populate();
              }}
            >
              {preparingRun ? "Syncing latest code…" : "Run code in runner"}
            </button>
            <button className="a-btn" disabled={!loaded} onClick={populate}>
              Send latest code to runner
            </button>
            <button
              className="a-btn"
              onClick={() => {
                setLoaded(false);
                setSynced(false);
                setSlow(false);
                expected.current = null;
                acknowledged.current = false;
                runnerCode.current = null;
                pendingRun.current = false;
                setPreparingRun(false);
                setRetry((value) => value + 1);
              }}
            >
              Reload runner
            </button>
          </div>
          {sourceError && (
            <p role="alert" className="exam-alert">
              {sourceError}
            </p>
          )}
          <p role="status">
            {synced
              ? "Runner connected. Code changes sync to your answer above."
              : "Waiting for source synchronization. Use the source editor above until the runner connects."}
            {slow
              ? " If the runner is unavailable, save your answer and continue; running examples is optional."
              : ""}
          </p>
          <iframe
            key={`${id}:${retry}`}
            ref={frame}
            title={`OneCompiler ${language} example runner`}
            src={`${origin}/embed/${id}?listenToEvents=true&codeChangeEvent=true&hideLanguageSelection=true&hideNew=true&hideNewFileOption=true&hideEditorOptions=true`}
            referrerPolicy="no-referrer"
            onLoad={() => {
              setLoaded(true);
              populate();
            }}
          />
          {input && (
            <div>
              <b>Public example input</b>
              <p>Paste this into the runner’s STDIN field before running.</p>
              <pre>{input}</pre>
            </div>
          )}
          <p>
            Clipboard activity inside this external runner cannot be observed by
            the portal. Leaving focus may still create a browser event for
            review.
          </p>
        </>
      )}
    </section>
  );
}
