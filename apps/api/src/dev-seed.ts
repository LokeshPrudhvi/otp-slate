import { eq } from "drizzle-orm";
import type { Auth } from "./auth.js";
import type { Database } from "./database.js";
import { scoped } from "./database.js";
import * as s from "./schema.js";
import { developmentPassword } from "./development-login.js";

// Explicitly invoked local fixtures. Never run against a remote database or production.
export async function seedDevelopment(db: Database, auth: Auth) {
  const password = developmentPassword;
  const [fixture] = await scoped(db, { platform: true }, (tx) =>
    tx
      .select({ organizationId: s.members.organizationId })
      .from(s.members)
      .innerJoin(s.user, eq(s.members.authUserId, s.user.id))
      .where(eq(s.user.email, "student@slate.test")),
  );
  const [existingOrg] = await scoped(db, { platform: true }, (tx) =>
    tx
      .select()
      .from(s.organizations)
      .where(
        fixture?.organizationId
          ? eq(s.organizations.id, fixture.organizationId)
          : eq(s.organizations.name, "Local development organization"),
      ),
  );
  const organization =
    existingOrg ||
    (await scoped(
      db,
      { platform: true },
      async (tx) =>
        (
          await tx
            .insert(s.organizations)
            .values({ name: "Local development organization" })
            .returning()
        )[0],
    ));
  let learnerId = "";
  for (const [email, name, role] of [
    ["admin@slate.test", "Development Admin", "platform_admin"],
    ["student@slate.test", "Development Learner", "student"],
    ["viewer@slate.test", "Development Viewer", "organization_viewer"],
  ] as const) {
    const [existing] = await db
      .select()
      .from(s.user)
      .where(eq(s.user.email, email));
    const identity =
      existing ||
      (
        await auth.api.createUser({
          body: {
            email,
            name,
            password,
            role: role === "platform_admin" ? "admin" : "user",
          },
        })
      ).user;
    const member = await scoped(db, { platform: true }, async (tx) => {
      await tx
        .insert(s.members)
        .values({
          authUserId: identity.id,
          organizationId: role === "platform_admin" ? null : organization.id,
          role,
          passwordSetupComplete: true,
          phone: role === "student" ? "+910000000000" : null,
          phoneVerifiedAt: role === "student" ? new Date() : null,
          features: role === "student" ? ["jobs", "resume", "rankings"] : [],
        })
        .onConflictDoNothing();
      return (
        await tx
          .select()
          .from(s.members)
          .where(eq(s.members.authUserId, identity.id))
      )[0];
    });
    if (role === "student") learnerId = member.id;
  }
  await scoped(db, { platform: true }, async (tx) => {
    const [existing] = await tx
      .select()
      .from(s.courses)
      .where(eq(s.courses.title, "Python · getting started"));
    if (existing) return;
    const [course] = await tx
      .insert(s.courses)
      .values({
        title: "Python · getting started",
        description:
          "A local development course for reviewing the learning workflow.",
        track: "foundation",
        status: "published",
      })
      .returning();
    const [version] = await tx
      .insert(s.versions)
      .values({
        courseId: course.id,
        number: 1,
        title: course.title,
        description: course.description,
        lessons: [
          {
            id: crypto.randomUUID(),
            title: "Variables and values",
            body: "A variable names a value. In Python, write count = 3 to assign an integer. Use print(count) to inspect the value.\n\nTry writing three variables: a name, an age and a list of skills.",
          },
          {
            id: crypto.randomUUID(),
            title: "Your first function",
            body: "Functions group reusable instructions. Define a function with def, give its inputs clear names and return the result.\n\ndef add(a, b):\n    return a + b\n\nprint(add(2, 3))\n\nThink about which inputs your function expects and which result it promises.",
          },
        ],
      })
      .returning();
    await tx.insert(s.grants).values({
      organizationId: organization.id,
      memberId: learnerId,
      courseId: course.id,
      versionId: version.id,
    });
  });
  console.log(
    "Local development fixtures ready. No emails were sent.",
  );
  console.log(
    "Demo accounts: admin@slate.test, student@slate.test, viewer@slate.test",
  );
  console.log("Common local portal login: test@gmail.com / 1234");
}
