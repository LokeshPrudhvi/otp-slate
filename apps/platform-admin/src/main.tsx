import React from "react";
import { createRoot } from "react-dom/client";
import { PortalRoot } from "@slate/ui";
import { PlatformRoutes } from "./routes";
import "@slate/ui/styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PortalRoot portal="platform">
      <PlatformRoutes />
    </PortalRoot>
  </React.StrictMode>,
);
