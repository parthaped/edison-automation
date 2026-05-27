import { NextResponse } from "next/server";
import { getRuntimeCapabilities } from "@/lib/edison/env";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "edison-automation",
    checks: {
      app: "ready",
      omeka: "requires-admin-verification",
      iiif: "requires-admin-verification",
      box: "webhook-endpoint-ready",
      capabilities: getRuntimeCapabilities(),
    },
  });
}
