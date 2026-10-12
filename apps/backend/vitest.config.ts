import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/support/global-setup.ts"],
    // Os arquivos compartilham o banco de teste e o limpam entre os testes.
    fileParallelism: false,
    // Testes que montam um Processo finalizado (e o copiam numa Reconsideração) passam de 5 s com a
    // máquina carregada.
    testTimeout: 15_000,
  },
});
