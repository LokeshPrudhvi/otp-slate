import type { ReactNode } from "react";
import { PageHead } from "@slate/ui";

export function AdminPage({ title, description, action, className = "", children }: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`admin-section ${className}`}>
    <header className="admin-hero">
      <PageHead title={title} description={description} action={action} />
    </header>
    <div className="admin-content">{children}</div>
  </div>;
}
