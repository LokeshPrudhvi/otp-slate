import React from "react";
import { createRoot } from "react-dom/client";
import { PortalRoot } from "@slate/ui";
import { StudentRoutes } from "./routes";
import "./reference.css";
import "./student.css";
import "@slate/ui/lesson-content.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PortalRoot portal="student">
      <StudentRoutes />
    </PortalRoot>
  </React.StrictMode>,
);
