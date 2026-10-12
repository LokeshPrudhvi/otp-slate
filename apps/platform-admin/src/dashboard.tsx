import { Link } from "react-router-dom";
import type { Organization } from "@slate/contracts";
import { ErrorMessage, Icon, useData } from "@slate/ui";
import { AdminPage } from "./page";
import "./dashboard.css";

interface PlatformSummary {
  organizations: number;
  students: number;
  viewers: number;
  publishedCourses: number;
}

const workspaceLinks = [
  {
    to: "/courses",
    icon: "book",
    title: "Courses",
    description: "Create, publish and organize learning content.",
  },
  {
    to: "/access",
    icon: "toolkit",
    title: "Learning access",
    description: "Assign courses, practice and portal sections.",
  },
  {
    to: "/jobs",
    icon: "jobs",
    title: "Job opportunities",
    description: "Manage the openings students can explore.",
  },
];

function organizationInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function AdminDashboard() {
  const summary = useData<PlatformSummary>("summary", "platform/summary");
  const organizations = useData<Organization[]>("organizations", "platform/organizations");
  const allOrganizations = organizations.data ?? [];
  const recentOrganizations = [...allOrganizations]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
  const activeCount = allOrganizations.filter((organization) => organization.status === "active").length;
  const archivedCount = allOrganizations.filter((organization) => organization.status === "archived").length;
  const metrics = [
    { key: "organizations" as const, title: "Organizations", note: "Across the platform", to: "/organizations", icon: "grid" },
    { key: "students" as const, title: "Student accounts", note: "Across all organizations", to: "/members", icon: "users" },
    { key: "publishedCourses" as const, title: "Published courses", note: "Ready to assign", to: "/courses", icon: "book" },
    { key: "viewers" as const, title: "Organization viewers", note: "Read-only analytics accounts", to: "/members?role=organization_viewer", icon: "chart" },
  ];

  return (
    <AdminPage
      className="admin-dashboard"
      title="Platform overview"
      description="Manage your organizations, students and learning from one place."
      action={<Link className="btn primary" to="/members?create=student"><span aria-hidden="true">+</span> Add student</Link>}
    >
      <div className="admin-dashboard-actions" aria-label="Common actions">
        <Link to="/registrations?status=pending"><Icon name="resume" /><span>Review registrations</span><span aria-hidden="true">→</span></Link>
        <Link to="/organizations?create=organization"><Icon name="users" /><span>Create organization</span><span aria-hidden="true">→</span></Link>
        <span className="admin-dashboard-actions-note">Student accounts created by you are ready immediately.</span>
      </div>

      {summary.error ? <div className="admin-dashboard-load-error">
        <ErrorMessage error={summary.error} />
        <button type="button" className="btn" onClick={() => void summary.refetch()}>Retry overview</button>
      </div> : <section className="admin-dashboard-metrics" aria-label="Platform totals" aria-busy={summary.isPending}>
        {metrics.map((metric) => <Link className="admin-dashboard-metric" to={metric.to} key={metric.key}>
          <div className="admin-dashboard-metric-label"><span>{metric.title}</span><Icon name={metric.icon} /></div>
          <strong>{summary.isPending ? <span className="admin-dashboard-placeholder" aria-label="Loading total" /> : (summary.data?.[metric.key] ?? 0).toLocaleString("en-IN")}</strong>
          <div className="admin-dashboard-metric-foot"><span>{metric.note}</span><span aria-hidden="true">↗</span></div>
        </Link>)}
      </section>}

      <div className="admin-dashboard-columns">
        <section className="admin-dashboard-panel admin-dashboard-organizations" aria-labelledby="dashboard-organizations-title">
          <div className="admin-dashboard-panel-head">
            <div><h2 id="dashboard-organizations-title">Recent organizations</h2><p>Open an organization to manage its people and access.</p></div>
            <Link className="admin-dashboard-text-link" to="/organizations">View all <span aria-hidden="true">→</span></Link>
          </div>
          {organizations.isPending ? <div className="admin-dashboard-placeholder-list" role="status">Loading organizations…</div> : organizations.error ? <div className="admin-dashboard-load-error">
            <ErrorMessage error={organizations.error} />
            <button type="button" className="btn" onClick={() => void organizations.refetch()}>Retry organizations</button>
          </div> : allOrganizations.length ? <>
            <div className="admin-dashboard-org-counts"><span><i aria-hidden="true" />{activeCount} active</span><span>{archivedCount} archived</span></div>
            <ul className="admin-dashboard-org-list">
              {recentOrganizations.map((organization) => {
                const archived = organization.status === "archived";
                const organizationQuery = `organizationId=${encodeURIComponent(organization.id)}`;
                return <li key={organization.id}>
                  <span className="admin-dashboard-org-avatar" aria-hidden="true">{organizationInitials(organization.name)}</span>
                  <div className="admin-dashboard-org-info">
                    <Link to={`/members?${organizationQuery}`}>{organization.name}</Link>
                    <span>Created {new Date(organization.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                  <span className={`badge ${archived ? "amber" : "green"}`}>{archived ? "Archived" : "Active"}</span>
                  <div className="admin-dashboard-org-links">
                    <Link to={`/members?${organizationQuery}`} aria-label={`View people in ${organization.name}`}>People</Link>
                    <Link to={`/access?${organizationQuery}`} aria-label={`${archived ? "View" : "Manage"} learning access for ${organization.name}`}>Access <span aria-hidden="true">→</span></Link>
                  </div>
                </li>;
              })}
            </ul>
            {allOrganizations.length > recentOrganizations.length && <div className="admin-dashboard-panel-foot">Showing the {recentOrganizations.length} most recently created organizations.</div>}
          </> : <div className="admin-dashboard-empty">
            <span className="admin-dashboard-empty-icon"><Icon name="users" /></span>
            <h3>Create your first organization</h3>
            <p>Then add its students and choose the learning they can access.</p>
            <Link className="btn primary" to="/organizations?create=organization">Create organization</Link>
          </div>}
        </section>

        <div className="admin-dashboard-side">
          <section className="admin-dashboard-panel" aria-labelledby="dashboard-learning-title">
            <div className="admin-dashboard-panel-head"><h2 id="dashboard-learning-title">Manage learning</h2></div>
            <div className="admin-dashboard-workspaces">
              {workspaceLinks.map((item) => <Link to={item.to} key={item.to}>
                <span className="admin-dashboard-workspace-icon"><Icon name={item.icon} /></span>
                <span><strong>{item.title}</strong><small>{item.description}</small></span>
                <span className="admin-dashboard-link-arrow" aria-hidden="true">→</span>
              </Link>)}
            </div>
          </section>
          <section className="admin-dashboard-service" aria-labelledby="dashboard-services-title">
            <span className="admin-dashboard-workspace-icon"><Icon name="toolkit" /></span>
            <div><h2 id="dashboard-services-title">Connected services</h2><p>Check email, verification and code execution setup.</p><Link className="admin-dashboard-text-link" to="/integrations">View services <span aria-hidden="true">→</span></Link></div>
          </section>
        </div>
      </div>
    </AdminPage>
  );
}
