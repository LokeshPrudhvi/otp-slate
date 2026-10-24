import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccessPolicy, EffectiveAccess } from "@slate/contracts";
import {
  inheritPolicy,
  resolvePolicies,
  supportedPolicy,
  updateAccessInput,
} from "./access.js";
import { SlateService, type Actor } from "./service.js";

const organization = {
  id: "organization-a",
  accessRevision: 4,
  portalDisplay: { portalTitle: "Student portal", welcomeText: "Welcome" },
} as Parameters<typeof resolvePolicies>[0];
const student = {
  id: "student-a",
  authUserId: "user-a",
  organizationId: organization.id,
  role: "student",
  status: "active",
  passwordSetupComplete: true,
  studentId: null,
  cohort: null,
  branchName: "Computer Science",
  branchCode: "CSE",
  phone: null,
  phoneVerifiedAt: null,
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Parameters<typeof resolvePolicies>[1];

function resolve(policy: AccessPolicy, demo = false) {
  return resolvePolicies(
    organization,
    student,
    [
      {
        scope: "organization",
        targetKey: "organization",
        policy,
        courseVersions: {},
      },
    ] as Parameters<typeof resolvePolicies>[2],
    [],
    demo,
  ).effective;
}

test("Competitive Programming retires noncoding effective access without replacing legacy assignments", () => {
  const legacy: AccessPolicy = {
    ...inheritPolicy(),
    features: ["practice", "compiler"],
    practiceModuleIds: ["aptitude", "typing", "competitive-coding"],
  };
  assert.deepEqual(resolve(legacy).practiceModuleIds, ["competitive-coding"]);
  assert.deepEqual(
    supportedPolicy(legacy),
    legacy,
    "stored choices remain round-trip compatible",
  );
  assert.equal(
    updateAccessInput.safeParse({
      revision: 4,
      scope: "organization",
      policy: legacy,
    }).success,
    true,
  );
  assert.deepEqual(
    resolve({ ...legacy, practiceModuleIds: ["aptitude"] }).practiceModuleIds,
    [],
  );
  assert.deepEqual(
    resolve({ ...legacy, practiceModuleIds: [] }).practiceModuleIds,
    [],
  );
  assert.deepEqual(resolve(inheritPolicy()).practiceModuleIds, []);
  assert.deepEqual(resolve(inheritPolicy(), true).practiceModuleIds, [
    "competitive-coding",
  ]);
  assert.deepEqual(
    resolve({ ...legacy, features: ["practice"] }).practiceModuleIds,
    [],
  );
  assert.deepEqual(
    resolve({ ...legacy, features: ["compiler"] }).practiceModuleIds,
    [],
  );
});

test("a branch cannot obtain Competitive Programming outside its organization ceiling", () => {
  const effective = resolvePolicies(
    organization,
    student,
    [
      {
        scope: "organization",
        targetKey: "organization",
        policy: {
          ...inheritPolicy(),
          features: ["practice", "compiler"],
          practiceModuleIds: ["aptitude"],
        },
        courseVersions: {},
      },
      {
        scope: "branch",
        targetKey: "CSE",
        policy: {
          ...inheritPolicy(),
          practiceModuleIds: ["competitive-coding"],
        },
        courseVersions: {},
      },
    ] as Parameters<typeof resolvePolicies>[2],
    [],
    false,
  ).effective;
  assert.deepEqual(effective.practiceModuleIds, []);
});

test("the practice API returns only coding problems and keeps assignment and compiler gates", () => {
  const service = Object.create(SlateService.prototype) as SlateService;
  const access: EffectiveAccess = resolve({
    ...inheritPolicy(),
    features: ["practice", "compiler"],
    practiceModuleIds: ["competitive-coding"],
  });
  const actor = { features: access.features, access, demo: false } as Actor;
  const problems = service.practice(actor);
  assert.equal(problems.length, 600);
  assert.ok(
    problems.every((problem) => problem.kind === "coding" && problem.problem),
  );
  assert.deepEqual(
    service.practice({
      ...actor,
      access: { ...access, practiceModuleIds: ["aptitude"] },
    }),
    [],
  );
  assert.deepEqual(service.practice({ ...actor, features: ["practice"] }), []);
  assert.throws(
    () => service.practice({ ...actor, features: ["compiler"] }),
    /not assigned/,
  );
});
