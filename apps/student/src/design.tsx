import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient, useMe } from "@slate/ui";
import { LoadingState, type LoadingVariant } from "@slate/ui/loading";
import type { Course } from "@slate/contracts";
import { referenceArt } from "./reference-art";
import { hasAccess, hasCodingAccess } from "./access";

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
      <rect
        x="3"
        y="3"
        width="7"
        height="7"
        rx="2"
        fill="currentColor"
        fillOpacity=".15"
      />
      <rect x="14" y="3" width="7" height="11" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect
        x="14"
        y="18"
        width="7"
        height="3"
        rx="1.5"
        fill="currentColor"
        fillOpacity=".15"
      />
    </>
  ),
  courses: (
    <>
      <path d="M12 6c-2.6-2-5.7-2.4-9-1.5v14c3.3-.9 6.4-.5 9 1.5 2.6-2 5.7-2.4 9-1.5v-14c-3.3-.9-6.4-.5-9 1.5Z" />
      <path d="M12 6v14M6 8.5l3 .5M6 12l3 .5M15 9l3-.5M15 12.5l3-.5" />
    </>
  ),
  compiler: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M2.5 8.5h19M6.5 12l2.5 2-2.5 2M12 16h4" />
      <circle cx="6" cy="6.3" r=".6" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="6.3" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  competitive: (
    <>
      <path
        d="m8 3 4 2 4-2v6a4 4 0 0 1-8 0V3Z"
        fill="currentColor"
        fillOpacity=".12"
      />
      <path d="M8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4M12 13v3M9 17h6M8 21l-3-2 3-2M16 17l3 2-3 2" />
    </>
  ),
  crt: (
    <>
      <path
        d="m2 8 10-5 10 5-10 5L2 8Z"
        fill="currentColor"
        fillOpacity=".12"
      />
      <path d="M6 10v6c3.4 3 8.6 3 12 0v-6M22 8v7M20.5 18l1.5-3 1.5 3" />
    </>
  ),
  practice: <path d="M8 5H5v15h14V5h-3M9 3h6v4H9zM8 12l2 2 5-5M8 17h7" />,
  exams: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4M17 3v4M3 10h18" />
      <circle cx="12" cy="15.5" r="3" fill="currentColor" fillOpacity=".12" />
      <path d="M12 14v1.5l1 .7" />
    </>
  ),
  jobs: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="3" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c5.6 3 12.4 3 18 0M10 13v3h4v-3" />
    </>
  ),
  pyq: (
    <>
      <path d="M4 19H2V5a2 2 0 0 1 2-2h9v2M7 7h13v14H7V7Z" />
      <path d="M11 21v-4h5v4M10.5 10.5h1M15.5 10.5h1M10.5 13.5h1M15.5 13.5h1" />
    </>
  ),
  resume: (
    <>
      <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8" />
    </>
  ),
  inbox: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 6.7 5.2a2.2 2.2 0 0 0 2.6 0L20 7M4 17l5-4M20 17l-5-4" />
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
export const courseTrackNames: Record<string, string> = {
  hiring: "Hiring Assessments",
  crt: "CRT Modules",
  dsa: "Advanced DSA",
  fullstack: "Full Stack Development",
  competitive: "Competitive Coding",
};
const navigation = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/courses", label: "Courses", icon: "courses", feature: "courses" },
  { to: "/crt", label: "CRT", icon: "crt", feature: "crt" },
  { to: "/compiler", label: "Compiler", icon: "compiler", feature: "compiler" },
  {
    to: "/competitive-programming",
    label: "Coding",
    icon: "competitive",
    feature: "practice",
  },
  {
    to: "/live-exams",
    label: "Live Exams",
    icon: "exams",
    feature: "live-exams",
  },
  {
    to: "/career-opportunities",
    label: "Careers",
    icon: "jobs",
    feature: "jobs",
  },
  { to: "/pyq", label: "PYQ", icon: "pyq", feature: "pyq" },
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
  const selectedNav =
    location.pathname === "/" ? "/" : `/${location.pathname.split("/")[1]}`;
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
          <span className="rail-brand-name">OTP Slate</span>
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
              (!item.feature ||
                identity.features.includes(item.feature) ||
                (item.to === "/career-opportunities" &&
                  identity.features.includes("resume"))) &&
              (item.feature !== "practice" || hasCodingAccess(identity)) &&
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
              data-nav-icon={item.icon}
            >
              <span className="rail-icon" aria-hidden="true">
                <StudentIcon name={item.icon} />
              </span>
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
          <span className="rail-label">Collapse sidebar</span>
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
                <button onClick={() => go("/career-opportunities/resume")}>
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
              ["/competitive-programming", "Solve coding problems", "practice"],
              ["/live-exams", "Check live exams", "live-exams"],
              ["/help", "Get help"],
            ]
              .filter(
                ([, , feature]) =>
                  !feature ||
                  (feature === "practice"
                    ? hasCodingAccess(identity)
                    : hasAccess(identity, feature)),
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
  label = "Loading your content",
  variant = "content",
}: {
  pending?: boolean;
  error?: unknown;
  label?: string;
  variant?: LoadingVariant;
}) {
  return pending ? (
    <LoadingState label={label} variant={variant} />
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
