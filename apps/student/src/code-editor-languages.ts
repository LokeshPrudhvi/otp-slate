import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

// Download only the selected language's parser; keep it cached for later switches.
const loaders: Record<string, () => Promise<Extension>> = {
  Python: () =>
    import("@codemirror/lang-python").then(({ python }) => python()),
  JavaScript: () =>
    import("@codemirror/lang-javascript").then(({ javascript }) =>
      javascript(),
    ),
  TypeScript: () =>
    import("@codemirror/lang-javascript").then(({ javascript }) =>
      javascript({ typescript: true }),
    ),
  C: () =>
    import("@codemirror/legacy-modes/mode/clike").then(({ c }) =>
      StreamLanguage.define(c),
    ),
  "C++": () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  Java: () => import("@codemirror/lang-java").then(({ java }) => java()),
  "C#": () =>
    import("@codemirror/legacy-modes/mode/clike").then(({ csharp }) =>
      StreamLanguage.define(csharp),
    ),
  Go: () =>
    import("@codemirror/legacy-modes/mode/go").then(({ go }) =>
      StreamLanguage.define(go),
    ),
  Rust: () =>
    import("@codemirror/legacy-modes/mode/rust").then(({ rust }) =>
      StreamLanguage.define(rust),
    ),
  Ruby: () =>
    import("@codemirror/legacy-modes/mode/ruby").then(({ ruby }) =>
      StreamLanguage.define(ruby),
    ),
  PHP: () =>
    import("@codemirror/lang-php").then(({ php }) => php({ plain: true })),
  Swift: () =>
    import("@codemirror/legacy-modes/mode/swift").then(({ swift }) =>
      StreamLanguage.define(swift),
    ),
  Kotlin: () =>
    import("@codemirror/legacy-modes/mode/clike").then(({ kotlin }) =>
      StreamLanguage.define(kotlin),
    ),
  Scala: () =>
    import("@codemirror/legacy-modes/mode/clike").then(({ scala }) =>
      StreamLanguage.define(scala),
    ),
  R: () =>
    import("@codemirror/legacy-modes/mode/r").then(({ r }) =>
      StreamLanguage.define(r),
    ),
  Dart: () =>
    import("@codemirror/legacy-modes/mode/clike").then(({ dart }) =>
      StreamLanguage.define(dart),
    ),
};
const loaded = new Map<string, Promise<Extension>>();

export function loadEditorLanguage(language: string): Promise<Extension> {
  const loader = loaders[language];
  if (!loader) return Promise.resolve([]);
  let result = loaded.get(language);
  if (!result) {
    result = loader().catch((error) => {
      loaded.delete(language);
      throw error;
    });
    loaded.set(language, result);
  }
  return result;
}
