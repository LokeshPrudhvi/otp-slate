import type { ExamLanguage, ExamTestCase } from "@slate/contracts";

export interface ExamExecutionResult {
  available: boolean;
  message: string;
  cases: {
    id: string;
    passed: boolean;
    stdout: string;
    stderr: string;
    verdict: string;
  }[];
}
export interface ExamExecutor {
  configured: boolean;
  provider: string;
  execute(input: {
    language: ExamLanguage;
    code: string;
    tests: ExamTestCase[];
  }): Promise<ExamExecutionResult>;
}
const languages: Record<ExamLanguage, { id: string; file: string }> = {
  Python: { id: "python", file: "main.py" },
  Java: { id: "java", file: "Main.java" },
  "C++": { id: "cpp", file: "main.cpp" },
  C: { id: "c", file: "main.c" },
  JavaScript: { id: "nodejs", file: "index.js" },
  TypeScript: { id: "typescript", file: "index.ts" },
  "C#": { id: "csharp", file: "Program.cs" },
  Go: { id: "go", file: "main.go" },
  Rust: { id: "rust", file: "main.rs" },
  Ruby: { id: "ruby", file: "main.rb" },
  PHP: { id: "php", file: "main.php" },
  Kotlin: { id: "kotlin", file: "Main.kt" },
};
const unavailable = (message: string): ExamExecutionResult => ({
  available: false,
  message,
  cases: [],
});
// Preserve token spacing and line order. Permit CRLF and a final newline only.
export const normalizeExamOutput = (value: string) =>
  value.replace(/\r\n/g, "\n").replace(/\n+$/, "");
type ProviderResponse = {
  status: string;
  stdout?: string | null;
  stderr?: string | null;
  exception?: string | null;
  error?: string | null;
};
function responseItem(value: unknown): value is ProviderResponse {
  if (
    !value ||
    typeof value !== "object" ||
    !("status" in value) ||
    typeof value.status !== "string"
  )
    return false;
  return ["stdout", "stderr", "exception", "error"].every(
    (key) =>
      !(key in value) ||
      (value as Record<string, unknown>)[key] === null ||
      typeof (value as Record<string, unknown>)[key] === "string",
  );
}
async function readBounded(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing response");
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 1024 * 1024) {
        await reader.cancel();
        throw new Error("Response exceeds limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// The free iframe and this authenticated backend API are separate products.
// An absent key never falls back to a public compiler or to local execution.
export function examExecutor(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): ExamExecutor {
  const key = env.ONECOMPILER_API_KEY?.trim();
  return {
    configured: Boolean(key),
    provider: "OneCompiler",
    async execute({ language, code, tests }) {
      if (!key)
        return unavailable(
          "Automatic coding grading is not configured. Coding answers are saved for admin review.",
        );
      const selected = Object.hasOwn(languages, language)
        ? languages[language]
        : undefined;
      if (
        !selected ||
        !code.trim() ||
        code.length > 30_000 ||
        !tests.length ||
        tests.length > 10 ||
        tests.some(
          (test) => test.input.length > 10_000 || test.output.length > 10_000,
        )
      ) {
        return unavailable(
          "The code or test cases exceed the execution limits.",
        );
      }
      try {
        const response = await fetcher("https://api.onecompiler.com/v1/run", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          headers: { "content-type": "application/json", "X-API-Key": key },
          body: JSON.stringify({
            language: selected.id,
            stdin: tests.map((test) => test.input),
            files: [{ name: selected.file, content: code }],
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return unavailable(
            "OneCompiler is temporarily unavailable or its API quota is exhausted. Your submission is preserved for retry.",
          );
        }
        const raw = await readBounded(response);
        const values = Array.isArray(raw) ? raw : [raw];
        if (values.length !== tests.length || !values.every(responseItem))
          return unavailable(
            "OneCompiler returned an incomplete response. Your submission is preserved for retry.",
          );
        // Provider failures are not incorrect student answers. Never turn an
        // authentication, quota, unsupported-language, or malformed response into zero marks.
        if (
          values.some(
            (value) => value.status !== "success" || Boolean(value.error),
          )
        )
          return unavailable(
            "OneCompiler could not complete grading. Your submission is preserved for retry.",
          );
        const cases = values.map((value, index) => {
          const stdout = value.stdout || "";
          const stderr = value.stderr || value.exception || "";
          const errored = Boolean(value.exception);
          const passed =
            !errored &&
            normalizeExamOutput(stdout) ===
              normalizeExamOutput(tests[index].output);
          return {
            id: tests[index].id,
            passed,
            stdout: stdout.slice(0, 8_192),
            stderr: stderr.slice(0, 4_096),
            verdict: passed
              ? "Accepted"
              : errored
                ? "Execution error"
                : "Wrong answer",
          };
        });
        return { available: true, message: "Execution complete.", cases };
      } catch {
        return unavailable(
          "OneCompiler could not be reached. Your submission is preserved for retry.",
        );
      }
    },
  };
}
