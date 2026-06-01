import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
    },
  },
  test: {
    // Default to the lightweight Node environment. Only component tests need a
    // DOM, and those opt in per-file with an `@vitest-environment jsdom`
    // docblock. Loading jsdom for every pure-logic file added ~5 minutes of
    // setup overhead to the suite.
    environment: "node",
    globals: true,
    // Run each test file in its own child process. The ingest pipeline pulls in
    // native addons (`@napi-rs/canvas`, `pdfjs-dist`) whose bindings are
    // unstable inside worker threads on Windows and intermittently crashed the
    // runner (0xC0000005) or timed workers out. Forks isolate each file in a
    // real process and are the stable choice for native code.
    pool: "forks",
    setupFiles: ["./src/test/setup.ts"],
  },
});
