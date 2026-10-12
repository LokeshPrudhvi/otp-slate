import { test } from "node:test";
import assert from "node:assert/strict";
import { examExecutor, normalizeExamOutput } from "./exam-execution.js";
const input = {
  language: "Python" as const,
  code: "print(input())",
  tests: [
    { id: "one", input: "42", output: "42\n", hidden: true },
    { id: "two", input: "7", output: "7", hidden: true },
  ],
};
const env = { ONECOMPILER_API_KEY: "synthetic-test-key" };
test("missing provider key never executes code or fabricates grading", async () => {
  let calls = 0;
  const executor = examExecutor({}, (async () => {
    calls++;
    throw Error("unexpected");
  }) as typeof fetch);
  assert.equal(executor.configured, false);
  assert.equal((await executor.execute(input)).available, false);
  assert.equal(calls, 0);
});
test("OneCompiler batch uses fixed origin, server credential and stdin without expected answers", async () => {
  const executor = examExecutor(env, (async (url, init) => {
    assert.equal(url, "https://api.onecompiler.com/v1/run");
    assert.equal(init?.redirect, "error");
    assert.equal(
      new Headers(init?.headers).get("X-API-Key"),
      env.ONECOMPILER_API_KEY,
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      language: "python",
      stdin: ["42", "7"],
      files: [{ name: "main.py", content: input.code }],
    });
    return Response.json([
      { status: "success", stdout: "42\r\n" },
      { status: "success", stdout: "wrong" },
    ]);
  }) as typeof fetch);
  const result = await executor.execute(input);
  assert.equal(result.available, true);
  assert.deepEqual(
    result.cases.map((item) => item.passed),
    [true, false],
  );
});
test("quota, missing output rows, oversized output and transport errors remain pending", async () => {
  for (const response of [
    Response.json({ status: "failed", error: "quota" }),
    Response.json([{ status: "success", stdout: "42" }]),
    new Response("x".repeat(1024 * 1024 + 1)),
    new Response("down", { status: 503 }),
    Response.json([
      { status: "success", error: "E001" },
      { status: "success", stdout: "7" },
    ]),
  ]) {
    const result = await examExecutor(
      env,
      (async () => response) as typeof fetch,
    ).execute(input);
    assert.equal(result.available, false);
    assert.deepEqual(result.cases, []);
  }
  assert.equal(
    (
      await examExecutor(env, (async () => {
        throw Error("secret response");
      }) as typeof fetch).execute(input)
    ).available,
    false,
  );
});
test("execution errors are incorrect solutions; API errors are not", async () => {
  const result = await examExecutor(env, (async () =>
    Response.json([
      { status: "success", stdout: null, exception: "Compilation error" },
      { status: "success", stdout: "7", stderr: null },
    ])) as typeof fetch).execute(input);
  assert.equal(result.available, true);
  assert.deepEqual(
    result.cases.map((item) => item.passed),
    [false, true],
  );
});
test("bound source/tests before contacting provider and compare outputs without collapsing tokens", async () => {
  let calls = 0;
  const executor = examExecutor(env, (async () => {
    calls++;
    return Response.json({});
  }) as typeof fetch);
  assert.equal(
    (await executor.execute({ ...input, code: "x".repeat(30_001) })).available,
    false,
  );
  assert.equal(
    (
      await executor.execute({
        ...input,
        tests: Array.from({ length: 11 }, () => input.tests[0]),
      })
    ).available,
    false,
  );
  assert.equal(
    (
      await executor.execute({
        ...input,
        tests: [{ ...input.tests[0], input: "x".repeat(10_001) }],
      })
    ).available,
    false,
  );
  assert.equal(calls, 0);
  assert.notEqual(normalizeExamOutput("1  2"), normalizeExamOutput("1 2"));
  assert.equal(normalizeExamOutput("42\r\n"), "42");
});
test("valid Unicode source and examples share the API character limits", async () => {
  const content = "界".repeat(10_000);
  const result = await examExecutor(env, (async () =>
    Response.json({
      status: "success",
      stdout: content,
    })) as typeof fetch).execute({
    language: "Python",
    code: "#" + "界".repeat(29_999),
    tests: [{ id: "unicode", input: content, output: content, hidden: false }],
  });
  assert.equal(result.available, true);
  assert.equal(result.cases[0].passed, true);
});
