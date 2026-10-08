import { useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Course,
  IntegrationStatus,
  Job,
  Lesson,
  Member,
  Organization,
} from "@slate/contracts";
import {
  api,
  DataState,
  Empty,
  ErrorMessage,
  Field,
  Login,
  Metric,
  NotFound,
  Onboarding,
  PageHead,
  Panel,
  Protected,
  ResetPassword,
  Shell,
  useData,
} from "@slate/ui";
import { DemoAssessments } from "./assessments";

const navigation = [
  { to: "/", label: "Dashboard", icon: "grid" },
  { to: "/organizations", label: "Organizations", icon: "users" },
  { to: "/members", label: "People", icon: "users" },
  { to: "/courses", label: "Courses", icon: "book" },
  {
    to: "/assessments",
    label: "Assessments & exams",
    icon: "toolkit",
    demoOnly: true,
  },
  { to: "/jobs", label: "Jobs", icon: "jobs" },
  { to: "/integrations", label: "Services", icon: "toolkit" },
];
function useOrganizations() {
  const query = useData<Organization[]>(
      "organizations",
      "platform/organizations",
    ),
    [selected, setSelected] = useState("");
  useEffect(() => {
    if (!selected && query.data?.[0]) setSelected(query.data[0].id);
  }, [selected, query.data]);
  return { query, selected, setSelected };
}
function OrganizationSelect({
  organizations,
  value,
  onChange,
}: {
  organizations: Organization[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Organization">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select an organization</option>
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function Dashboard() {
  const summary = useData<{
    organizations: number;
    students: number;
    viewers: number;
    publishedCourses: number;
  }>("summary", "platform/summary");
  return (
    <>
      <PageHead
        title="Platform overview"
        description="Your organizations, people and learning content."
      />
      <section className="hero">
        <div>
          <span className="eyebrow">MAKE LEARNING POSSIBLE</span>
          <h2>A workspace for every organization.</h2>
          <p>
            Create organizations, issue individual accounts and assign the
            learning each student needs.
          </p>
          <Link className="btn primary" to="/organizations">
            Manage organizations →
          </Link>
        </div>
        <span className="hero-symbol" aria-hidden="true">
          ◎
        </span>
      </section>
      <DataState pending={summary.isPending} error={summary.error}>
        <div className="stats">
          <Metric
            label="Organizations"
            value={summary.data?.organizations ?? "—"}
          />
          <Metric label="Students" value={summary.data?.students ?? "—"} />
          <Metric
            label="Organization viewers"
            value={summary.data?.viewers ?? "—"}
          />
          <Metric
            label="Published courses"
            value={summary.data?.publishedCourses ?? "—"}
          />
        </div>
      </DataState>
      <div className="grid">
        {[
          {
            to: "/members",
            title: "People & learning access",
            body: "Create student and organization-viewer accounts. Assign published courses and career tools.",
          },
          {
            to: "/courses",
            title: "Courses & modules",
            body: "Publish versioned learning content. Existing student assignments keep their enrolled version.",
          },
          {
            to: "/jobs",
            title: "Career opportunities",
            body: "Publish job cards manually with descriptions, dates and original application links.",
          },
        ].map((item) => (
          <article className="card" key={item.to}>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            <Link className="btn" to={item.to}>
              Open workspace →
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
function Organizations() {
  const data = useData<Organization[]>(
      "organizations",
      "platform/organizations",
    ),
    client = useQueryClient(),
    [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api<Organization>("platform/organizations", "POST", { name }),
    onSuccess: () => {
      setName("");
      client.invalidateQueries({ queryKey: ["platform"] });
    },
  });
  return (
    <>
      <PageHead
        title="Organizations"
        description="Each organization has its own people, assignments and analytics."
      />
      <div className="split">
        <Panel title="Your organizations">
          <DataState pending={data.isPending} error={data.error}>
            {data.data?.length ? (
              <div className="grid">
                {data.data.map((org) => (
                  <article key={org.id} className="card">
                    <span className="card-icon">
                      {org.name.slice(0, 2).toUpperCase()}
                    </span>
                    <h2>{org.name}</h2>
                    <span className="badge green">{org.status}</span>
                    <p>
                      Created{" "}
                      {new Date(org.createdAt).toLocaleDateString("en-IN")}
                    </p>
                    <Link className="btn" to="/members">
                      Manage people →
                    </Link>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="Create your first organization">
                Add an organization, then create its student and viewer
                accounts.
              </Empty>
            )}
          </DataState>
        </Panel>
        <Panel title="Create an organization">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Organization name">
              <input
                required
                maxLength={150}
                placeholder="College or organization name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <ErrorMessage error={create.error} />
            <button className="btn primary" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create organization"}
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
function MemberActions({
  member,
  courses,
}: {
  member: Member;
  courses: Course[];
}) {
  const query = useQueryClient(),
    [course, setCourse] = useState("");
  const update = useMutation({
    mutationFn: (body: unknown) =>
      api(`platform/members/${member.id}`, "PATCH", body),
    onSuccess: () => query.invalidateQueries({ queryKey: ["platform"] }),
  });
  const assign = useMutation({
    mutationFn: () =>
      api("platform/assignments", "POST", {
        memberId: member.id,
        courseId: course,
      }),
    onSuccess: () => setCourse(""),
  });
  return (
    <>
      <select
        aria-label={`Account status for ${member.name}`}
        disabled={update.isPending}
        value={member.status}
        onChange={(e) => update.mutate({ status: e.target.value })}
      >
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
        <option value="disabled">Disabled</option>
      </select>
      {member.role === "student" && (
        <>
          <div className="checks">
            {["jobs", "resume", "rankings"].map((feature) => (
              <label key={feature}>
                <input
                  type="checkbox"
                  checked={member.features.includes(feature)}
                  disabled={update.isPending}
                  onChange={(e) =>
                    update.mutate({
                      features: e.target.checked
                        ? [...member.features, feature]
                        : member.features.filter((f) => f !== feature),
                    })
                  }
                />
                {feature}
              </label>
            ))}
          </div>
          <div className="actions">
            <select
              aria-label={`Assign course to ${member.name}`}
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              disabled={assign.isPending}
            >
              <option value="">Choose published course</option>
              {courses
                .filter((c) => c.status === "published")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
            <button
              className="btn"
              disabled={!course || assign.isPending}
              onClick={() => assign.mutate()}
            >
              {assign.isPending ? "Assigning…" : "Assign latest version"}
            </button>
          </div>
          {assign.isSuccess && <small role="status">Course assigned.</small>}
        </>
      )}
      <ErrorMessage error={update.error || assign.error} />
    </>
  );
}
function Members() {
  const org = useOrganizations(),
    client = useQueryClient(),
    data = useData<Member[]>(
      `members-${org.selected}`,
      `platform/organizations/${org.selected}/members`,
      Boolean(org.selected),
    ),
    courses = useData<Course[]>("courses", "platform/courses");
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<"student" | "organization_viewer">("student"),
    [search, setSearch] = useState(""),
    [credentials, setCredentials] = useState<{
      name: string;
      email: string;
      temporaryPassword: string;
    } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ name: string; email: string; temporaryPassword: string }>(
        "platform/members",
        "POST",
        { organizationId: org.selected, name, email, role },
      ),
    onSuccess: (result) => {
      setCredentials(result);
      setName("");
      setEmail("");
      client.invalidateQueries({ queryKey: ["platform"] });
    },
  });
  const rows =
    data.data?.filter((member) =>
      `${member.name} ${member.email}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  return (
    <>
      <PageHead
        title="People & learning access"
        description="Only Platform Admin creates accounts and assigns learning."
      />
      <DataState pending={org.query.isPending} error={org.query.error}>
        <OrganizationSelect
          organizations={org.query.data || []}
          value={org.selected}
          onChange={(value) => {
            org.setSelected(value);
            setCredentials(null);
          }}
        />
        {!org.selected ? (
          <Empty
            title="Choose an organization"
            action={
              <Link className="btn" to="/organizations">
                Create an organization
              </Link>
            }
          >
            Select an organization before managing its students and viewers.
          </Empty>
        ) : (
          <>
            <div className="split">
              <Panel title="Create an individual account">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    create.mutate();
                  }}
                >
                  <div className="form-grid">
                    <Field label="Full name">
                      <input
                        required
                        maxLength={150}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field label="Login email">
                      <input
                        type="email"
                        required
                        maxLength={200}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Account role">
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as typeof role)}
                    >
                      <option value="student">Student</option>
                      <option value="organization_viewer">
                        Organization Admin · analytics only
                      </option>
                    </select>
                  </Field>
                  <p className="note">
                    Students start with no learning access. Organization viewers
                    receive only their organization’s analytics.
                  </p>
                  <ErrorMessage error={create.error} />
                  <button className="btn primary" disabled={create.isPending}>
                    {create.isPending ? "Creating…" : "Create account"}
                  </button>
                </form>
              </Panel>
              <Panel title="Credential distribution">
                {credentials ? (
                  <div className="credentials">
                    <strong>{credentials.name}</strong>
                    <p>{credentials.email}</p>
                    <span className="muted">
                      Temporary password · shown once
                    </span>
                    <code>{credentials.temporaryPassword}</code>
                    <p>
                      Share securely through the organization’s existing
                      channel. The user must change this password on first
                      login.
                    </p>
                    <div className="actions">
                      <button
                        className="btn"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            `${credentials.email}\n${credentials.temporaryPassword}`,
                          )
                        }
                      >
                        Copy credentials
                      </button>
                      <button
                        className="btn"
                        onClick={() => setCredentials(null)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="muted">
                    A new account’s temporary credentials appear here once.
                    Permanent passwords cannot be retrieved.
                  </p>
                )}
              </Panel>
            </div>
            <Panel title="Organization accounts">
              <div className="toolbar">
                <input
                  aria-label="Search organization accounts"
                  type="search"
                  placeholder="Search name or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span className="muted">{rows.length} accounts</span>
              </div>
              <DataState pending={data.isPending} error={data.error}>
                {rows.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Role / onboarding</th>
                          <th>Status & learning access</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((member) => (
                          <tr key={member.id}>
                            <td>
                              <strong>{member.name}</strong>
                              <small>{member.email}</small>
                            </td>
                            <td>
                              {member.role === "student"
                                ? "Student"
                                : "Organization viewer"}
                              <small>
                                {!member.passwordSetupComplete
                                  ? "Password change required"
                                  : member.role === "student" &&
                                      !member.phoneVerifiedAt
                                    ? "Phone verification required"
                                    : "Account setup complete"}
                              </small>
                            </td>
                            <td>
                              <MemberActions
                                member={member}
                                courses={courses.data || []}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty title="No accounts to show">
                    Create an individual student or organization-viewer account
                    above.
                  </Empty>
                )}
              </DataState>
            </Panel>
          </>
        )}
      </DataState>
    </>
  );
}
function Courses() {
  const data = useData<Course[]>("courses", "platform/courses"),
    client = useQueryClient(),
    navigate = useNavigate(),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [track, setTrack] = useState("foundation");
  const create = useMutation({
    mutationFn: () =>
      api<Course>("platform/courses", "POST", { title, description, track }),
    onSuccess: (course) => {
      client.invalidateQueries({ queryKey: ["platform", "courses"] });
      navigate(`/courses/${course.id}`);
    },
  });
  return (
    <>
      <PageHead
        title="Courses & modules"
        description="Publish content at any time. Enrolled students keep their assigned course version."
      />
      <div className="split">
        <Panel title="Course catalog">
          <DataState pending={data.isPending} error={data.error}>
            {data.data?.length ? (
              <div className="grid">
                {data.data.map((course) => (
                  <article key={course.id} className="card">
                    <span
                      className={`badge ${course.status === "published" ? "green" : "amber"}`}
                    >
                      {course.status}
                    </span>
                    <h2>{course.title}</h2>
                    <p>{course.description}</p>
                    <Link className="btn" to={`/courses/${course.id}`}>
                      Edit & publish →
                    </Link>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="Build your course catalog">
                Create a course, add its lessons and publish a version before
                assigning students.
              </Empty>
            )}
          </DataState>
        </Panel>
        <Panel title="Create a course">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Course title">
              <input
                required
                maxLength={150}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea
                required
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="Learning track">
              <select value={track} onChange={(e) => setTrack(e.target.value)}>
                <option value="foundation">
                  Courses · C, C++, Python, Java
                </option>
                <option value="hiring">Hiring assessments</option>
                <option value="crt">CRT modules</option>
                <option value="dsa">Advanced DSA</option>
                <option value="fullstack">Full Stack development</option>
                <option value="competitive">Competitive coding</option>
              </select>
            </Field>
            <ErrorMessage error={create.error} />
            <button className="btn primary" disabled={create.isPending}>
              Create draft course
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
function CourseEditor() {
  const { id } = useParams(),
    client = useQueryClient(),
    data = useData<Course & { lessons: Lesson[] }>(
      `course-${id}`,
      `platform/courses/${id}`,
    );
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [lessons, setLessons] = useState<Lesson[]>([]),
    [loaded, setLoaded] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (data.data && loaded !== `${id}:${data.data.versionId || ""}`) {
      setTitle(data.data.title);
      setDescription(data.data.description);
      setLessons(
        data.data.lessons.length
          ? data.data.lessons
          : [{ id: crypto.randomUUID(), title: "", body: "" }],
      );
      setLoaded(`${id}:${data.data.versionId || ""}`);
    }
  }, [data.data, id, loaded]);
  const publish = useMutation({
    mutationFn: () =>
      api<{ number: number }>(`platform/courses/${id}/publish`, "POST", {
        title,
        description,
        lessons,
      }),
    onSuccess: (result) => {
      setNotice(
        `Version ${result.number} published. Existing assignments keep their previous version.`,
      );
      client.invalidateQueries({ queryKey: ["platform"] });
    },
  });
  const update = (index: number, key: "title" | "body", value: string) =>
    setLessons((items) =>
      items.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
  return (
    <>
      <PageHead
        title="Course editor"
        description="Publishing creates an immutable version. Reassign a student to upgrade their enrolled version."
        action={
          <Link to="/courses" className="btn">
            Back to courses
          </Link>
        }
      />
      <DataState pending={data.isPending} error={data.error}>
        <Panel
          title={`Content · ${data.data?.version ? `latest version ${data.data.version}` : "new draft"}`}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              publish.mutate();
            }}
          >
            <Field label="Course title">
              <input
                required
                maxLength={150}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={publish.isPending}
              />
            </Field>
            <Field label="Description">
              <textarea
                required
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={publish.isPending}
              />
            </Field>
            {lessons.map((lesson, index) => (
              <section className="lesson-editor" key={lesson.id}>
                <h3>Lesson {index + 1}</h3>
                <Field label="Lesson title">
                  <input
                    required
                    maxLength={150}
                    value={lesson.title}
                    onChange={(e) => update(index, "title", e.target.value)}
                    disabled={publish.isPending}
                  />
                </Field>
                <Field label="Lesson content">
                  <textarea
                    required
                    rows={7}
                    maxLength={20_000}
                    value={lesson.body}
                    onChange={(e) => update(index, "body", e.target.value)}
                    disabled={publish.isPending}
                  />
                </Field>
                <button
                  type="button"
                  className="text-button"
                  disabled={lessons.length === 1 || publish.isPending}
                  onClick={() =>
                    setLessons((items) => items.filter((_, i) => i !== index))
                  }
                >
                  Remove lesson
                </button>
              </section>
            ))}
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={publish.isPending || lessons.length >= 200}
                onClick={() =>
                  setLessons((items) => [
                    ...items,
                    { id: crypto.randomUUID(), title: "", body: "" },
                  ])
                }
              >
                Add lesson
              </button>
              <button className="btn primary" disabled={publish.isPending}>
                {publish.isPending ? "Publishing…" : "Publish new version"}
              </button>
            </div>
            <ErrorMessage error={publish.error} />
            {notice && (
              <p className="success-note" role="status">
                {notice}
              </p>
            )}
          </form>
        </Panel>
      </DataState>
    </>
  );
}
function Jobs() {
  const org = useOrganizations(),
    query = useQueryClient(),
    data = useData<Job[]>(
      `jobs-${org.selected}`,
      `platform/jobs?organizationId=${org.selected}`,
      Boolean(org.selected),
    );
  const [title, setTitle] = useState(""),
    [company, setCompany] = useState(""),
    [description, setDescription] = useState(""),
    [url, setUrl] = useState("");
  const publish = useMutation({
    mutationFn: () =>
      api("platform/jobs", "POST", {
        organizationId: org.selected,
        title,
        company,
        description,
        url,
      }),
    onSuccess: () => {
      setTitle("");
      setCompany("");
      setDescription("");
      setUrl("");
      query.invalidateQueries({ queryKey: ["platform"] });
    },
  });
  return (
    <>
      <PageHead
        title="Job opportunities"
        description="Manually publish opportunities with their original application links."
      />
      <OrganizationSelect
        organizations={org.query.data || []}
        value={org.selected}
        onChange={org.setSelected}
      />
      {org.selected ? (
        <div className="split">
          <Panel title="Published opportunities">
            <DataState pending={data.isPending} error={data.error}>
              {data.data?.length ? (
                <div className="grid">
                  {data.data.map((job) => (
                    <article key={job.id} className="card">
                      <span className="eyebrow">{job.company}</span>
                      <h2>{job.title}</h2>
                      <p>{job.description}</p>
                      <small className="muted">
                        {new Date(job.postedAt).toLocaleDateString("en-IN")}
                      </small>
                      <a
                        href={job.url}
                        className="btn"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open original posting ↗
                      </a>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty title="No jobs published">
                  Add an opportunity to share it with eligible students.
                </Empty>
              )}
            </DataState>
          </Panel>
          <Panel title="Publish a job">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                publish.mutate();
              }}
            >
              <Field label="Job title">
                <input
                  required
                  maxLength={150}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Company">
                <input
                  required
                  maxLength={150}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </Field>
              <Field label="Short description">
                <textarea
                  required
                  maxLength={3000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label="Original application link">
                <input
                  type="url"
                  required
                  placeholder="https://…"
                  maxLength={2000}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <ErrorMessage error={publish.error} />
              <button className="btn primary" disabled={publish.isPending}>
                {publish.isPending ? "Publishing…" : "Publish job"}
              </button>
            </form>
          </Panel>
        </div>
      ) : (
        <Empty title="Choose an organization">
          Select the organization that should receive these opportunities.
        </Empty>
      )}
    </>
  );
}
function Integrations() {
  const data = useData<IntegrationStatus>(
    "integrations",
    "platform/integrations",
  );
  return (
    <>
      <PageHead
        title="Connected services"
        description="Provider configuration for the platform."
      />
      <DataState pending={data.isPending} error={data.error}>
        {data.data && (
          <div className="split">
            <Panel title="Service configuration">
              {[
                [
                  "Database",
                  data.data.database === "local-postgres"
                    ? "Local PostgreSQL · development"
                    : "PostgreSQL",
                ],
                ["Authentication", "Better Auth · revocable sessions"],
                [
                  "Resend email",
                  data.data.email ? "Configured" : "Not configured",
                ],
                [
                  "WhatsApp verification",
                  data.data.whatsapp ? "Configured" : "Not configured",
                ],
                [
                  "Private R2 storage",
                  data.data.storage ? "Configured" : "Not configured",
                ],
                ["Code execution", "Provider trial pending"],
              ].map(([name, value]) => (
                <div className="integration-row" key={name}>
                  <strong>{name}</strong>
                  <span className="badge">{value}</span>
                </div>
              ))}
            </Panel>
            <Panel title="Before onboarding students">
              <p className="muted">
                Configure the approved WhatsApp sender and authentication
                template before issuing student accounts. Configure the email
                sending domain for password resets.
              </p>
              <p className="note">
                Credentials are managed in server configuration. This page never
                displays API keys or permanent passwords.
              </p>
            </Panel>
          </div>
        )}
      </DataState>
    </>
  );
}
export function PlatformRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Protected />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<Shell navigation={navigation} />}>
          <Route index element={<Dashboard />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="members" element={<Members />} />
          <Route path="courses" element={<Courses />} />
          <Route path="courses/:id" element={<CourseEditor />} />
          <Route path="assessments" element={<DemoAssessments />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
