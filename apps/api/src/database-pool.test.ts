import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareDatabasePool } from "./database.js";

type TestClient = {
  query(config: { text: string; query_timeout: number }): Promise<unknown>;
  release(discard?: boolean): void;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("database readiness waits for two concurrent connections and releases both", async () => {
  const attempts = [deferred<TestClient>(), deferred<TestClient>()];
  const probes = [deferred<unknown>(), deferred<unknown>()];
  let connections = 0;
  let releases = 0;
  let ended = false;
  let ready = false;
  const startup = prepareDatabasePool({
    connect: () => attempts[connections++].promise,
    async end() {
      ended = true;
    },
  }).then(() => {
    ready = true;
  });
  assert.equal(connections, 2, "start both handshakes without a serial wait");
  attempts[0].resolve({
    query(config) {
      assert.deepEqual(config, { text: "select 1", query_timeout: 10_000 });
      return probes[0].promise;
    },
    release(discard) {
      assert.equal(discard, false);
      releases++;
    },
  });
  await Promise.resolve();
  assert.equal(ready, false);
  attempts[1].resolve({
    query(config) {
      assert.deepEqual(config, { text: "select 1", query_timeout: 10_000 });
      return probes[1].promise;
    },
    release(discard) {
      assert.equal(discard, false);
      releases++;
    },
  });
  probes[0].resolve({});
  await Promise.resolve();
  assert.equal(
    ready,
    false,
    "readiness also waits for the second database probe",
  );
  probes[1].resolve({});
  await startup;
  assert.equal(releases, 2);
  assert.equal(ready, true);
  assert.equal(ended, false);
});

test("failed startup drains pending acquisition and closes the pool without hiding the cause", async () => {
  const attempts = [deferred<TestClient>(), deferred<TestClient>()];
  let connections = 0;
  let releases = 0;
  let ended = false;
  const failure = new Error("Synthetic handshake failure");
  const startup = prepareDatabasePool({
    connect: () => attempts[connections++].promise,
    async end() {
      assert.equal(
        releases,
        1,
        "release the successful client before ending the pool",
      );
      ended = true;
      throw new Error("Synthetic shutdown error");
    },
  });
  const rejected = assert.rejects(startup, (error) => error === failure);
  attempts[0].reject(failure);
  await Promise.resolve();
  assert.equal(
    ended,
    false,
    "do not close the pool while another acquisition is pending",
  );
  attempts[1].resolve({
    async query() {},
    release() {
      releases++;
    },
  });
  await rejected;
  assert.equal(ended, true);
});

test("failed startup probe discards that client and drains the other probe", async () => {
  const probes = [deferred<unknown>(), deferred<unknown>()];
  const discarded: boolean[] = [];
  let connections = 0;
  let ended = false;
  const failure = new Error("Synthetic database probe failure");
  const startup = prepareDatabasePool({
    async connect() {
      const index = connections++;
      return {
        query: () => probes[index].promise,
        release(discard?: boolean) {
          discarded[index] = Boolean(discard);
        },
      };
    },
    async end() {
      ended = true;
    },
  });
  const rejected = assert.rejects(startup, (error) => error === failure);
  probes[0].reject(failure);
  await Promise.resolve();
  assert.equal(ended, false);
  probes[1].resolve({});
  await rejected;
  assert.deepEqual(discarded, [true, false]);
  assert.equal(ended, true);
});

test("startup closes an entirely failed pool after both attempts settle", async () => {
  const failure = new Error("Synthetic unavailable database");
  let connections = 0;
  let ended = 0;
  await assert.rejects(
    prepareDatabasePool({
      async connect() {
        connections++;
        throw failure;
      },
      async end() {
        ended++;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(connections, 2);
  assert.equal(ended, 1);
});
