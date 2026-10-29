import { defineConfig } from "vitest/config";

// Unit tests for the app's pure and stateful logic (no React Native renderer).
// Native modules are mocked per test file.
export default defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"] } });
