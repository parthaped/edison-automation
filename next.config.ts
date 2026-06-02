import type { NextConfig } from "next";
import { withWorkflow } from "@workflow/next";

const nextConfig: NextConfig = {
  // pdfjs-dist loads "@napi-rs/canvas" via createRequire at runtime in Node
  // mode, and the canvas package itself ships a precompiled native binding.
  // Both must stay external so the bundler does not try to inline them.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // pdfjs dynamically imports pdf.worker.mjs from inside pdf.mjs, which the
  // serverless file tracer misses. Include worker assets for every function.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
    ],
  },
};

export default withWorkflow(nextConfig);
