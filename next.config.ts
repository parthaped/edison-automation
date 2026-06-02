import type { NextConfig } from "next";
import { withWorkflow } from "@workflow/next";

const nextConfig: NextConfig = {
  // @napi-rs/canvas ships a precompiled native binding and must stay external
  // so the bundler does not try to inline it. Keep pdfjs-dist bundled: its
  // worker files are ESM, and externalizing them makes Node require() resolve
  // to an EcmaScript module in production builds.
  serverExternalPackages: ["@napi-rs/canvas"],
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
