import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient, useMe } from "@slate/ui";
import type { Course } from "@slate/contracts";
import { referenceArt } from "./reference-art";
import {
  hasAccess,
  hasToolkitTrack,
  useStudentData as useData,
} from "./access";

export function Artwork({ name }: { name: keyof typeof referenceArt }) {
  // Artwork is generated only from the static local reference, never API content.
  return (
    <span
      style={{ display: "contents" }}
      dangerouslySetInnerHTML={{ __html: referenceArt[name] }}
    />
  );
}
const iconPaths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l4.5-5" />
      <circle cx="12" cy="16" r="1.3" />
      <path d="M6.5 11.5l1 .6M12 8v1.2M17.5 11.5l-1 .6" />
    </>
  ),
  courses: (
    <>
      <path d="M6 3h11a1 1 0 0 1 1 1v16H7a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z" />
      <path d="M5 18a2 2 0 0 1 2-2h11" />
      <path d="M9 7h6M9 10h4" />
    </>
  ),
  toolkit: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3" />
    </>
  ),
  compiler: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
      <line x1="14" y1="4" x2="10" y2="20" />
    </>
  ),
  practice: (
    <>
      <path d="M8 5H5v15h14V5h-3M9 3h6v4H9zM8 12l2 2 5-5M8 17h7" />
    </>
  ),
  exams: (
    <>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M4 9h16" />
      <circle cx="12" cy="15" r="3" />
      <path d="M12 13v2l1 1" />
    </>
  ),
  jobs: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3" />
    </>
  ),
  resume: (
    <>
      <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5L6.2 5h11.6l2.2 8.5V19H4z" />
      <path d="M4 13.5h5l1.2 2.2h3.6l1.2-2.2h5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6" />
      <circle cx="12" cy="17" r=".5" fill="currentColor" />
    </>
  ),
  collapse: (
    <>
      <path d="M5 5v14M19 12H9M13 8l-4 4 4 4" />
    </>
  ),
  page: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h7M9 16h7" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m10 8 6 4-6 4z" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  ann: (
    <>
      <path d="M4 10v4h3l7 4V6l-7 4z" />
      <path d="M17.5 9a4 4 0 0 1 0 6" />
    </>
  ),
  assign: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h5" />
    </>
  ),
  discussion: (
    <>
      <path d="M4 5h11v8H9l-4 3v-3H4z" />
      <path d="M15 9h5v8h-1v3l-3-3h-5v-1" />
    </>
  ),
};
export function StudentIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name] || iconPaths.page}
    </svg>
  );
}
export const tracks = [
  {
    id: "hiring",
    name: "Hiring Assessments",
    glyph: "✓",
    intro: "Get ready for the next round.",
    description:
      "Build confidence with aptitude, typing, coding and web development assessments.",
    note: "Practice at your pace with activities assigned by your placement team.",
  },
  {
    id: "crt",
    name: "CRT Modules",
    glyph: "◎",
    intro: "Prepare for campus placements.",
    description:
      "A focused path through aptitude, reasoning, competitive programming and interview skills.",
    note: "Start with the fundamentals, then work through each module at your own pace.",
  },
  {
    id: "dsa",
    name: "Advanced DSA",
    glyph: "⋈",
    intro: "Turn concepts into solutions.",
    description:
      "Explore data structures and algorithms, from arrays and trees to dynamic programming.",
    note: "Recommended preparation: familiarity with one programming language.",
  },
  {
    id: "fullstack",
    name: "Full Stack Development",
    glyph: "▤",
    intro: "Build from front to back.",
    description:
      "Choose your stack and learn to deliver complete web applications.",
    note: "Each path includes front-end development, back-end APIs, databases and a capstone project.",
  },
  {
    id: "competitive",
    name: "Competitive Coding",
    glyph: "⌘",
    intro: "A hundred ways to get better.",
    description:
      "Build programming fluency with learning paths in C++, Java and Python.",
    note: "Work through the problem collections assigned by your placement team.",
  },
] as const;
const navigation = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/courses", label: "Courses", icon: "courses", feature: "courses" },
  { to: "/crt", label: "CRT", icon: "practice", feature: "crt" },
  { to: "/toolkit", label: "Toolkit", icon: "toolkit", feature: "toolkit" },
  { to: "/compiler", label: "Compiler", icon: "compiler", feature: "compiler" },
  { to: "/practice", label: "Practice", icon: "practice", feature: "practice" },
  {
    to: "/live-exams",
    label: "Live Exams",
    icon: "exams",
    feature: "live-exams",
  },
  { to: "/jobs", label: "Jobs", icon: "jobs", feature: "jobs" },
  { to: "/resume", label: "Resume", icon: "resume", feature: "resume" },
  { to: "/inbox", label: "Inbox", icon: "inbox", feature: "inbox" },
  {
    to: "/announcements",
    label: "Announcements",
    icon: "ann",
    feature: "announcements",
    unlessFeature: "inbox",
  },
];

export function StudentShell() {
  const me = useMe(),
    query = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation();
  const examAttempt = /^\/live-exams\/[^/]+\/attempt\/[^/]+\/?$/.test(
    location.pathname,
  );
  const courseId = location.pathname.match(/^\/courses\/([^/]+)/)?.[1];
  const courses = useData<Course[]>(
    "courses",
    "student/courses",
    Boolean(courseId),
  );
  const currentCourse = courses.data?.find((course) => course.id === courseId);
  const selectedNav =
    currentCourse && hasToolkitTrack(me.data, currentCourse.track)
      ? "/toolkit"
      : location.pathname === "/"
        ? "/"
        : `/${location.pathname.split("/")[1]}`;
  const identity = me.data!;
  const lastAccessRevision = useRef(identity.access?.revision);
  useEffect(() => {
    const revision = identity.access?.revision;
    if (lastAccessRevision.current !== revision) {
      lastAccessRevision.current = revision;
      void query.invalidateQueries({ queryKey: ["student"] });
    }
  }, [identity.access?.revision, query]);
  const initials = identity.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  const [tray, setTray] = useState(false),
    [otto, setOtto] = useState(false),
    [collapsed, setCollapsed] = useState(false);
  const main = useRef<HTMLElement>(null),
    close = useRef<HTMLButtonElement>(null),
    account = useRef<HTMLButtonElement>(null);
  const logout = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error)
        throw new Error("We could not sign you out. Please retry.");
    },
    onSuccess: () => {
      query.clear();
      navigate("/login", { replace: true });
    },
  });
  useEffect(() => {
    setTray(false);
    setOtto(false);
    main.current?.scrollTo({ top: 0 });
  }, [location.pathname]);
  useEffect(() => {
    if (tray) close.current?.focus();
  }, [tray]);
  const closeTray = () => {
    setTray(false);
    account.current?.focus();
  };
  const mayNavigate = () =>
    window.dispatchEvent(
      new Event("student-before-navigation", { cancelable: true }),
    );
  const go = (path: string) => {
    if (!mayNavigate()) return;
    setTray(false);
    setOtto(false);
    navigate(path);
  };
  return (
    <div className={`app student-app${collapsed ? " rail-collapsed" : ""}`}>
      <a className="student-skip" href="#student-content">
        Skip to content
      </a>
      <nav
        className="a-rail"
        aria-label={`${identity.access?.display.portalTitle || "OTP Slate"} navigation`}
      >
        <Link to="/" className="a-logo" aria-label="OTP Slate dashboard">
          <Artwork name="logo" />
        </Link>
        <button
          ref={account}
          className={`a-nav${tray || selectedNav === "/help" ? " on" : ""}`}
          aria-label="Account & help"
          aria-expanded={tray}
          aria-controls="student-tray"
          onClick={() => setTray(!tray)}
        >
          <span className="a-av">{initials}</span>
          <span className="rail-label">Account &amp; help</span>
        </button>
        {navigation
          .filter(
            (item) =>
              (!item.feature || identity.features.includes(item.feature)) &&
              (!item.unlessFeature ||
                !identity.features.includes(item.unlessFeature)),
          )
          .map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`a-nav${!tray && selectedNav === item.to ? " on" : ""}`}
              aria-current={selectedNav === item.to ? "page" : undefined}
              aria-label={item.label}
            >
              <StudentIcon name={item.icon} />
              <span className="rail-label">{item.label}</span>
            </Link>
          ))}
        <span className="sp" />
        <button
          className="a-nav"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <StudentIcon name="collapse" />
        </button>
      </nav>
      <main className="a-main" id="student-content" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      {tray && (
        <aside
          id="student-tray"
          className="a-tray open"
          aria-labelledby="student-account-help-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeTray();
          }}
        >
          <button
            ref={close}
            className="x"
            onClick={closeTray}
            aria-label="Close tray"
          >
            ×
          </button>
          <h2 id="student-account-help-title" className="account-help-title">
            Account &amp; help
          </h2>
          <div className="prof">
            <div className="big">{initials}</div>
            <b>{identity.name}</b>
            <small>{identity.organizationName}</small>
          </div>
          <p className="account-email">{identity.email}</p>
          <button
            className="a-btn account-logout"
            onClick={() => {
              if (mayNavigate()) logout.mutate();
            }}
            disabled={logout.isPending}
          >
            {logout.isPending ? "Logging out…" : "Log out"}
          </button>
          <Status error={logout.error} />
          <ul className="tray-l">
            <li>
              <button onClick={() => go("/")}>
                Dashboard<small>Your assigned learning and updates</small>
              </button>
            </li>
            {hasAccess(identity, "courses") && (
              <li>
                <button onClick={() => go("/courses")}>
                  My courses
                  <small>Learning assigned by your organization</small>
                </button>
              </li>
            )}
            {identity.features.includes("resume") && (
              <li>
                <button onClick={() => go("/resume")}>
                  Resume
                  <small>Your details, templates and saved draft</small>
                </button>
              </li>
            )}
          </ul>
          <section
            className="account-help-support"
            aria-labelledby="student-support-title"
          >
            <h3 id="student-support-title">Help &amp; support</h3>
            <ul className="tray-l">
              {!examAttempt && (
                <li>
                  <button
                    onClick={() => {
                      setTray(false);
                      setOtto(true);
                    }}
                  >
                    Ask Otto<small>Find your way around OTP Slate</small>
                  </button>
                </li>
              )}
              <li>
                <button onClick={() => go("/help")}>
                  Search the help centre<small>Guides for students</small>
                </button>
              </li>
              {hasAccess(identity, "live-exams") && (
                <li>
                  <button onClick={() => go("/help#exams")}>
                    Exam and proctoring rules
                    <small>What is checked during a test</small>
                  </button>
                </li>
              )}
              <li>
                <button onClick={() => go("/help#access")}>
                  Learning access
                  <small>Contact your placement team for assignments</small>
                </button>
              </li>
            </ul>
          </section>
        </aside>
      )}
      {!examAttempt && (
        <button
          className="pet"
          aria-label="Chat with Otto, your assistant"
          aria-expanded={otto}
          onClick={() => setOtto(!otto)}
        >
          <Artwork name="otto" />
        </button>
      )}
      {otto && !examAttempt && (
        <section
          className="pet-chat open"
          role="dialog"
          aria-label="Chat with Otto"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOtto(false);
          }}
        >
          <div className="pc-h">
            <span aria-hidden="true" className="otto-mini">
              <Artwork name="otto" />
            </span>
            <div>
              <b>Otto</b>
              <small>Your OTP Slate guide</small>
            </div>
            <button onClick={() => setOtto(false)} aria-label="Close chat">
              ×
            </button>
          </div>
          <div className="otto-guidance">
            <p>Hi {identity.name.split(" ")[0]}! Where would you like to go?</p>
            <p>Your organization manages your courses and assessment access.</p>
          </div>
          <div className="otto-shortcuts">
            {[
              ["/courses", "Continue learning", "courses"],
              [
                "/toolkit",
                identity.access?.display.toolkitTitle ||
                  "Your learning toolkit",
                "toolkit",
              ],
              ["/practice", "Find practice", "practice"],
              ["/live-exams", "Check live exams", "live-exams"],
              ["/help", "Get help"],
            ]
              .filter(
                ([, , feature]) => !feature || hasAccess(identity, feature),
              )
              .map(([path, label]) => (
                <button key={path} className="a-btn" onClick={() => go(path)}>
                  {label} →
                </button>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
export function Heading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="a-head">
      <h1 className="a-h1">{title}</h1>
      <span className="sp" />
      {children}
    </div>
  );
}
export function Status({
  pending,
  error,
}: {
  pending?: boolean;
  error?: unknown;
}) {
  return pending ? (
    <p className="hub-note" role="status">
      Loading…
    </p>
  ) : error ? (
    <p className="student-error" role="alert">
      {error instanceof Error ? error.message : "Please retry."}
    </p>
  ) : null;
}
export function NoResults({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="practice-no-results">
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Banner({
  eyebrow = "LEARN · PRACTISE · GET HIRED",
  title,
  description,
  glyph,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  glyph: string;
}) {
  return (
    <section className="hub-banner">
      <div>
        <p className="hub-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <span className="hub-symbol" aria-hidden="true">
        {glyph}
      </span>
    </section>
  );
}
export function courseAppearance(course: Course) {
  const title = course.title.toLowerCase();
  if (title.includes("python")) return { color: "#2b6cb0", glyph: "Py" };
  if (title.includes("c++")) return { color: "#00599c", glyph: "C++" };
  if (title.includes("java") && !title.includes("javascript"))
    return { color: "#c4511c", glyph: "J" };
  if (title.includes("javascript")) return { color: "#a8850a", glyph: "JS" };
  if (title.includes("html") || title.includes("css"))
    return { color: "#d9480f", glyph: "</>" };
  if (title.includes("sql")) return { color: "#00758f", glyph: "SQL" };
  if (title.includes("mongo") || title.includes("mern"))
    return { color: "#2f855a", glyph: "{ }" };
  if (/\bc\b/.test(title)) return { color: "#3f51b5", glyph: "C" };
  return {
    color:
      {
        dsa: "#6b46c1",
        crt: "#15803d",
        hiring: "#b83280",
        fullstack: "#0f766e",
        competitive: "#334155",
      }[course.track] || "#3f51b5",
    glyph: course.title.slice(0, 3),
  };
}
export function shade(color: string, percentage: number) {
  const value = parseInt(color.slice(1), 16);
  const adjust = (channel: number) =>
    Math.round(channel * (1 + percentage / 100));
  return (
    "#" +
    [value >> 16, (value >> 8) & 255, value & 255]
      .map((channel) => adjust(channel).toString(16).padStart(2, "0"))
      .join("")
  );
}
export function heroBackground(color: string, index: number) {
  return [
    `radial-gradient(circle at 1px 1px,rgba(255,255,255,.24) 1.3px,transparent 1.8px) 0 0/14px 14px,linear-gradient(135deg,${color},${shade(color, -28)})`,
    `repeating-linear-gradient(-45deg,rgba(255,255,255,.12) 0 9px,transparent 9px 20px),linear-gradient(160deg,${color},${shade(color, -18)})`,
    `linear-gradient(rgba(255,255,255,.13) 1px,transparent 1px) 0 0/100% 16px,linear-gradient(90deg,rgba(255,255,255,.13) 1px,transparent 1px) 0 0/16px 100%,linear-gradient(160deg,${color},${shade(color, -30)})`,
    `repeating-radial-gradient(circle at 88% 120%,rgba(255,255,255,.15) 0 2px,transparent 2px 15px),${color}`,
  ][index % 4];
}
