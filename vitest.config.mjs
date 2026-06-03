import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // The thin CLI entry (arg-wiring + process I/O) and pure config constants
      // are exercised end-to-end, not unit-tested; the gate stays meaningful for
      // the logic modules in lib/.
      include: ["lib/**/*.mjs"],
      exclude: ["**/*.test.mjs"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
