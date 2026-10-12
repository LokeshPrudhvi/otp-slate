import { test } from "node:test";
import assert from "node:assert/strict";
import { r2LessonStorage } from "./lesson-storage.js";

test("private upload signatures bind MIME and length without accidentally signing an empty-body checksum", async () => {
  const original = { ...process.env };
  try {
    process.env.R2_ACCOUNT_ID = "storage-test-account";
    process.env.R2_ACCESS_KEY_ID = "storage-test-key";
    process.env.R2_SECRET_ACCESS_KEY =
      "storage-test-secret-not-a-real-credential";
    process.env.R2_BUCKET = "storage-test-private";
    // Signing is local cryptography; no R2 or network requests occur here.
    const signed = new URL(
      await r2LessonStorage.upload("lesson-staging/test", "video/mp4", 1234),
    );
    assert.equal(signed.protocol, "https:");
    assert.equal(signed.searchParams.get("X-Amz-Expires"), "900");
    assert.match(
      signed.searchParams.get("X-Amz-SignedHeaders")!,
      /content-length/,
    );
    assert.match(
      signed.searchParams.get("X-Amz-SignedHeaders")!,
      /content-type/,
    );
    assert.equal(
      [...signed.searchParams.keys()].some((key) =>
        key.toLowerCase().includes("checksum"),
      ),
      false,
    );
    for (const attachment of [true, false]) {
      const download = new URL(
        await r2LessonStorage.download(
          "lesson-assets/immutable",
          "Learning notes.pdf",
          attachment,
        ),
      );
      assert.equal(
        download.searchParams.get("X-Amz-Expires"),
        attachment ? "300" : "3600",
      );
      assert.match(
        download.searchParams.get("response-content-disposition")!,
        attachment ? /^attachment;/ : /^inline;/,
      );
      assert.equal(download.pathname.includes("lesson-assets/immutable"), true);
    }
  } finally {
    for (const key of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
    ]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
