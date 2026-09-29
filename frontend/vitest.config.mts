import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// A fixed zone with a negative UTC offset and daylight saving, so date code
// that silently mixes UTC and local time (e.g. `new Date("2026-09-24")`
// landing on the 23rd) fails here on every machine and in CI, not just on
// a developer's laptop west of Greenwich. Set before any worker starts.
process.env.TZ = "America/New_York";

export default defineConfig({
  resolve: {
    // Mirrors "paths" in tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Same automatic JSX runtime as Next ("jsx": "react-jsx"): no React import needed.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
