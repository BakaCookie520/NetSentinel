import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000", "/agent": { target: "ws://localhost:3000", ws: true } } },
  build: { sourcemap: true, rollupOptions: { output: { manualChunks: { react: ["react", "react-dom", "react-router-dom"], mui: ["@mui/material", "@mui/icons-material"], charts: ["@mui/x-charts"], data: ["@tanstack/react-query", "i18next", "react-i18next"] } } } },
});
