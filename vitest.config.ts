import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // E2E tests spawn testagent subprocesses; running test files serially
    // avoids subprocess/transcript contention and keeps polling deterministic.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      // SDK-adapter / GUI-only surfaces are not unit-testable without the
      // Stream Deck runtime; excluded so the headline number reflects logic
      // we can actually exercise.
      exclude: [
        "src/plugin.ts",
        "src/actions/**",
      ],
    },
  },
});
