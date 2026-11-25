import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // Only PORT is read here; no GitHub token is exposed to the browser.
  const env = loadEnv(mode, "..", "PORT");
  const target = `http://127.0.0.1:${process.env.PORT ?? env.PORT ?? "3000"}`;
  return {
    plugins: [react(), tailwindcss()],
    envDir: "..",
    server: {
      port: 5173,
      strictPort: true,
      proxy: { "/health": target, "/api": target },
    },
    preview: { proxy: { "/health": target, "/api": target } },
  };
});
