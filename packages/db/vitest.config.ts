import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Each file can own an embedded PostgreSQL cluster. Parallel files exhausted
    // macOS System V shared memory during initdb (shmget: No space left on device).
    maxWorkers: 1,
  },
});
