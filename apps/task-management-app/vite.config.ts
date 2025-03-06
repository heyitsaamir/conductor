import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/tasks",
  server: {
    proxy: {
      "/tasks-api": {
        target: "http://localhost:3002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tasks-api/, ""),
      },
    },
  },
});
