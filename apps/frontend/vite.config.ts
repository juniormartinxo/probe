import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// O navegador só fala com /api no próprio Vite; o proxy leva à porta publicada do backend.
// Assim a comunicação não depende da porta em que o Vite acabou subindo.
const backendPort = process.env.PROBE_BACKEND_PORT ?? "3210";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": `http://127.0.0.1:${backendPort}`,
    },
  },
});
