import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localPortal } from "../../scripts/vite-local-portal";
export default defineConfig({
  plugins: [localPortal("student.localhost"), react()],
  server: {
    allowedHosts: ["student.localhost"],
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
});
