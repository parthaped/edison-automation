import { NextResponse } from "next/server";
import { APP_SERVICE_ID } from "@/lib/app-config";
import { getRuntimeCapabilities } from "@/lib/edison/env";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: APP_SERVICE_ID,
    checks: {
      app: "ready",
      omeka: "requires-admin-verification",
      iiif: "requires-admin-verification",
      box: "webhook-endpoint-ready",
      capabilities: getRuntimeCapabilities(),
    },
  });
}
