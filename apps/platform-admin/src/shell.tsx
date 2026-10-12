import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient, ErrorMessage, Icon, Logo, useMe, type NavigationItem } from "@slate/ui";
import "./admin.css";

export function AdminShell({ navigation }: { navigation: NavigationItem[] }) {
  const me = useMe(), query = useQueryClient(), navigate = useNavigate(), location = useLocation();
  const identity = me.data!;
  const links = navigation.filter(item => !item.demoOnly || identity.demo);
  const active = links.find(item => item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to));
  const logout = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error("We could not sign you out. Please retry.");
    },
    onSuccess: () => { query.clear(); navigate("/login", { replace: true }); },
  });
  const groups = [
    { name: "Workspace", paths: ["/", "/organizations", "/members", "/registrations"] },
    { name: "Learning", paths: ["/access", "/courses", "/assessments"] },
    { name: "Platform", paths: ["/jobs", "/integrations"] },
  ];
  return <div className="platform-admin">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="admin-sidebar">
      <Link to="/" className="admin-brand" aria-label="OTP Slate dashboard"><Logo /><span>OTP Slate<small>Platform administration</small></span></Link>
      <nav aria-label="Main navigation">
        {groups.map(group => <div className="admin-nav-group" key={group.name}>
          <span className="admin-nav-label">{group.name}</span>
          {group.paths.flatMap(path => links.filter(item => item.to === path)).map(item => <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => `admin-nav-item${isActive ? " active" : ""}`}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </NavLink>)}
        </div>)}
      </nav>
      <div className="admin-sidebar-footer">
        <div className="admin-user"><span className="avatar">{identity.name.split(" ").map(word => word[0]).slice(0, 2).join("")}</span><span><strong>{identity.name}</strong><small>Platform admin</small></span></div>
        <button type="button" className="admin-nav-item" onClick={() => logout.mutate()} disabled={logout.isPending}><Icon name="logout" /><span>{logout.isPending ? "Signing out…" : "Sign out"}</span></button>
      </div>
    </aside>
    <div className="admin-workspace">
      <header className="admin-topbar">
        <nav aria-label="Breadcrumb"><Link to="/">Workspace</Link><span aria-hidden="true">/</span><span aria-current="page">{active?.label || "Page unavailable"}{location.pathname.startsWith("/courses/") ? " / Course editor" : ""}</span></nav>
        <span className="admin-workspace-tag">{identity.demo ? "Sample workspace" : "Platform admin"}</span>
      </header>
      <main id="main" className="page admin-page">{logout.error && <div className="admin-shell-notice"><ErrorMessage error={logout.error} /></div>}<Outlet /></main>
    </div>
  </div>;
}

export function AdminPagination({ page, total, size, onChange }: { page: number; total: number; size: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (!total) return null;
  return <div className="admin-pagination">
    <span role="status">Showing {(page - 1) * size + 1}–{Math.min(page * size, total)} of {total}</span>
    {pages > 1 && <nav aria-label="List pagination"><button type="button" className="btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>← Previous</button><span>Page {page} of {pages}</span><button type="button" className="btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next →</button></nav>}
  </div>;
}
