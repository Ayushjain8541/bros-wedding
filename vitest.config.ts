import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"], exclude: ["**/node_modules/**", "**/.worktrees/**", "tests/integration/**", "tests/e2e/**", "**/.next/**"] },
});
