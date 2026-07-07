import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src/frontend",
  base: "./",
  optimizeDeps: {
    exclude: ["monaco-editor"],
  },
  build: {
    outDir: "../../dist/frontend",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/frontend/dashboard.html"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:3099",
    },
  },
  plugins: [
    // 开发模式：/ → /dashboard.html（Vite 默认只认 index.html）
    { name: "dev-index", configureServer(s) { s.middlewares.use((r, _, n) => { if (r.url === "/" || r.url === "/index.html") r.url = "/dashboard.html"; n(); }); } },
  ],
});
