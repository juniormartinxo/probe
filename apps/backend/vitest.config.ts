import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/support/global-setup.ts"],
    // Os arquivos compartilham o banco de teste e o limpam entre os testes.
    fileParallelism: false,
  },
});
