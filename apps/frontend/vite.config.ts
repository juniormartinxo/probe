import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const repoRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
  // O navegador só fala com /api no próprio Vite; o proxy leva à porta publicada do backend.
  // Assim a comunicação não depende da porta em que o Vite acabou subindo. A porta vem do
  // ambiente ou do .env.local da raiz, as mesmas fontes que o Makefile repassa ao Compose.
  const env = { ...loadEnv(mode, repoRoot, "PROBE_"), ...process.env };
  const backendPort = env.PROBE_BACKEND_PORT ?? "3210";

  return {
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
  };
});
