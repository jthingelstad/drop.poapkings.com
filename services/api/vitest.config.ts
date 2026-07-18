import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 75,
        lines: 60,
      },
    },
  },
});
