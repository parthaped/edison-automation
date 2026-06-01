import type { NextConfig } from "next";
import { withWorkflow } from "@workflow/next";

const nextConfig: NextConfig = {
  // pdfjs-dist loads "@napi-rs/canvas" via createRequire at runtime in Node
  // mode, and the canvas package itself ships a precompiled native binding.
  // Both must stay external so the bundler does not try to inline them.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default withWorkflow(nextConfig);
