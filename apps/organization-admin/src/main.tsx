import React from "react";
import { createRoot } from "react-dom/client";
import { PortalRoot } from "@slate/ui";
import { OrganizationRoutes } from "./routes";
import "@slate/ui/styles.css";
import "./organization.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PortalRoot portal="organization">
      <OrganizationRoutes />
    </PortalRoot>
  </React.StrictMode>,
);
