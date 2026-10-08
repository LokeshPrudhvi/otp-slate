import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient, ErrorMessage, Icon, useMe } from "@slate/ui";

const navigation = [
  { to: "/", label: "Overview", icon: "grid" },
  { to: "/students", label: "Student insights", icon: "users" },
  { to: "/learning", label: "Learning analytics", icon: "chart" },
  { to: "/rankings", label: "Student rankings", icon: "exam" },
];

export function OrgGlyph({
  name,
}: {
  name: "search" | "arrow" | "download" | "chevron" | "menu";
}) {
  const paths = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    download: <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function OrgCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`org-card ${className}`}>
      <header className="org-card-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function OrganizationWorkspace() {
  const me = useMe().data!,
    navigate = useNavigate(),
    query = useQueryClient(),
    location = useLocation();
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    if (!menu) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
      if (event.key === "Tab") {
        const links = sidebar.current?.querySelectorAll<HTMLElement>(
          "a, button:not(:disabled)",
        );
        if (!links?.length) return;
        const first = links[0],
          last = links[links.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    const desktop = window.matchMedia("(min-width: 721px)");
    const handleResize = () => {
      if (desktop.matches) setMenu(false);
    };
    desktop.addEventListener("change", handleResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
      desktop.removeEventListener("change", handleResize);
      menuButton.current?.focus();
    };
  }, [menu]);
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
  const page =
    navigation.find(
      (item) => item.to !== "/" && location.pathname.startsWith(item.to),
    )?.label || "Overview";
  const organization =
    me.organizationName?.replace(/ · Demo$/, "") || "Your organization";
  return (
    <div className={`org-root ${menu ? "org-menu-open" : ""}`}>
      <a className="skip-link" href="#org-main">
        Skip to content
      </a>
      {menu && (
        <button
          className="org-nav-overlay"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className="org-sidebar" id="org-navigation" ref={sidebar}>
        <Link to="/" className="org-brand" onClick={() => setMenu(false)}>
          <span className="org-brand-mark">
            otp
            <span />
          </span>
          <span>
            Slate<span className="org-brand-product">ORGANIZATION</span>
          </span>
        </Link>
        <div className="org-organization">
          <span className="org-campus-icon">
            <Icon name="book" />
          </span>
          <div>
            <strong title={organization}>{organization}</strong>
            <span>Organization workspace</span>
          </div>
        </div>
        <p className="org-nav-label">WORKSPACE</p>
        <nav aria-label="Organization navigation">
          {navigation.map((item) => (
            <NavLink
              to={item.to}
              end={item.to === "/"}
              key={item.to}
              onClick={() => setMenu(false)}
              className={({ isActive }) =>
                `org-nav-item ${isActive ? "is-active" : ""}`
              }
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="org-sidebar-bottom">
          <div className="org-access-note">
            <span className="org-access-dot" />
            <strong>Insights workspace</strong>
            <p>Track learning and discover your students’ potential.</p>
          </div>
          <button
            className="org-nav-item org-signout"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <Icon name="logout" />
            <span>{logout.isPending ? "Signing out…" : "Sign out"}</span>
          </button>
          <div className="org-sidebar-footer">
            OTP Slate <span>Learning, connected.</span>
          </div>
        </div>
      </aside>
      <div className="org-workspace" inert={menu || undefined}>
        <header className="org-topbar">
          <div className="org-breadcrumb">
            <button
              className="org-mobile-menu"
              ref={menuButton}
              aria-label="Open navigation"
              aria-controls="org-navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <OrgGlyph name="menu" />
            </button>
            <span>Workspace</span>
            <b>/</b>
            <strong>{page}</strong>
          </div>
          <div className="org-topbar-right">
            <form
              className="org-global-search"
              onSubmit={(event) => {
                event.preventDefault();
                navigate(`/students?q=${encodeURIComponent(search.trim())}`);
              }}
            >
              <OrgGlyph name="search" />
              <input
                aria-label="Find a student"
                placeholder="Find a student…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="submit" aria-label="Search students">
                ↵
              </button>
            </form>
            <div className="org-user">
              <span className="org-user-avatar">
                {me.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{me.name}</strong>
                <span>Organization admin</span>
              </div>
            </div>
          </div>
        </header>
        <main id="org-main" className="org-main">
          <ErrorMessage error={logout.error} />
          <Outlet />
        </main>
        <footer className="org-page-footer">
          <span>OTP Slate · Organization insights</span>
          <span>Learning progress. Meaningful outcomes.</span>
        </footer>
      </div>
    </div>
  );
}
