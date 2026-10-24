import { useId, useLayoutEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab, isolateHistory } from "@codemirror/commands";
import { acceptCompletion } from "@codemirror/autocomplete";
import {
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { loadEditorLanguage } from "./code-editor-languages";
import "./code-editor.css";

function editorTheme(dark: boolean) {
  const palette = dark
    ? {
        keyword: "#c9a9ff",
        string: "#97d6ac",
        number: "#f2bd88",
        function: "#8acbfa",
        type: "#76d8ce",
        comment: "#a7a7a7",
        operator: "#f2a7bb",
      }
    : {
        keyword: "#813db5",
        string: "#207345",
        number: "#9c4a12",
        function: "#1758b0",
        type: "#006f79",
        comment: "#697586",
        operator: "#aa3458",
      };
  return [
    EditorView.theme(
      {
        "&": {
          color: "var(--coding-text)",
          backgroundColor: "var(--coding-panel)",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--coding-text)" },
        ".cm-content": { caretColor: "var(--coding-text)" },
        ".cm-gutters": {
          color: "var(--coding-muted)",
          backgroundColor: "var(--coding-inset)",
          borderRight: "1px solid var(--coding-line)",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: dark ? "#ffffff06" : "#315f9807",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
          { backgroundColor: dark ? "#496052" : "#cfe0f7" },
        ".cm-selectionMatch": { backgroundColor: dark ? "#4c5643" : "#e3eed6" },
        "&.cm-focused .cm-matchingBracket": {
          backgroundColor: dark ? "#335449" : "#d5ebe3",
          outline: "1px solid var(--coding-good)",
        },
        ".cm-tooltip, .cm-panels": {
          backgroundColor: "var(--coding-inset)",
          color: "var(--coding-text)",
          borderColor: "var(--coding-line)",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
          backgroundColor: "var(--coding-accent-soft)",
          color: "var(--coding-text)",
        },
        ".cm-searchMatch": { backgroundColor: dark ? "#69552c" : "#ffe7a5" },
      },
      { dark },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: [tags.keyword, tags.modifier], color: palette.keyword },
        { tag: [tags.string, tags.regexp], color: palette.string },
        { tag: [tags.number, tags.bool, tags.null], color: palette.number },
        {
          tag: [
            tags.function(tags.variableName),
            tags.definition(tags.variableName),
          ],
          color: palette.function,
        },
        {
          tag: [
            tags.typeName,
            tags.className,
            tags.namespace,
            tags.standard(tags.variableName),
          ],
          color: palette.type,
        },
        {
          tag: [tags.operator, tags.special(tags.variableName)],
          color: palette.operator,
        },
        { tag: tags.comment, color: palette.comment, fontStyle: "italic" },
        {
          tag: tags.invalid,
          color: dark ? "#ffa1a1" : "#b42318",
          textDecoration: "underline",
        },
      ]),
    ),
  ];
}

type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  language: string;
  dark: boolean;
  fontSize: number;
  tabSize: number;
};

// Parent-driven resets/restores must not echo back as new user edits.
const externalValue = Annotation.define<boolean>();

export default function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initial = useRef(props);
  const onChange = useRef(props.onChange);
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [syntaxStatus, setSyntaxStatus] = useState("loading");
  const helpId = useId();
  const [compartments] = useState(() => ({
    language: new Compartment(),
    appearance: new Compartment(),
    font: new Compartment(),
    indentation: new Compartment(),
  }));

  useLayoutEffect(() => {
    onChange.current = props.onChange;
  });

  useLayoutEffect(() => {
    if (!host.current) return;
    const current = initial.current;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: current.value,
        extensions: [
          basicSetup,
          keymap.of([{ key: "Tab", run: acceptCompletion }, indentWithTab]),
          EditorView.contentAttributes.of({
            "aria-label": "Solution code",
            "aria-describedby": helpId,
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off",
          }),
          compartments.language.of([]),
          compartments.appearance.of(editorTheme(current.dark)),
          compartments.font.of(
            EditorView.theme({ "&": { fontSize: `${current.fontSize}px` } }),
          ),
          compartments.indentation.of([
            EditorState.tabSize.of(current.tabSize),
            indentUnit.of(" ".repeat(current.tabSize)),
          ]),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(externalValue),
              )
            ) {
              onChange.current(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setPosition({ line: line.number, column: head - line.from + 1 });
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, [compartments, helpId]);

  useLayoutEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.value) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: props.value },
        annotations: [externalValue.of(true), isolateHistory.of("full")],
      });
    }
  }, [props.value]);
  useLayoutEffect(() => {
    let active = true;
    setSyntaxStatus("loading");
    loadEditorLanguage(props.language).then(
      (extension) => {
        if (!active || !view.current) return;
        view.current.dispatch({
          effects: compartments.language.reconfigure(extension),
        });
        setSyntaxStatus("ready");
      },
      () => {
        if (active) setSyntaxStatus("failed");
      },
    );
    return () => {
      active = false;
    };
  }, [compartments, props.language]);
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: compartments.appearance.reconfigure(editorTheme(props.dark)),
    });
  }, [compartments, props.dark]);
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: compartments.font.reconfigure(
        EditorView.theme({ "&": { fontSize: `${props.fontSize}px` } }),
      ),
    });
  }, [compartments, props.fontSize]);
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: compartments.indentation.reconfigure([
        EditorState.tabSize.of(props.tabSize),
        indentUnit.of(" ".repeat(props.tabSize)),
      ]),
    });
  }, [compartments, props.tabSize]);

  return (
    <div className="coding-source-editor">
      <div className="coding-editor-host" ref={host} />
      <div className="coding-editor-statusbar">
        <span>
          {props.language} <span aria-hidden="true">·</span> {props.tabSize}{" "}
          spaces
        </span>
        {syntaxStatus !== "ready" && (
          <span
            className={`coding-syntax-status ${syntaxStatus}`}
            role="status"
          >
            {syntaxStatus === "loading"
              ? "Loading syntax"
              : "Syntax unavailable · Code is still editable"}
          </span>
        )}
        <span id={helpId} className="coding-editor-keyboard-help">
          Tab to indent · Esc, then Tab to leave
        </span>
        <span>
          Ln {position.line}, Col {position.column}
        </span>
      </div>
    </div>
  );
}
