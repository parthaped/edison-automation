import { NextResponse } from "next/server";
import { verifyOmekaPublicEndpoints } from "@/lib/edison/omeka-client";

export const runtime = "nodejs";

export async function GET() {
  const result = await verifyOmekaPublicEndpoints();
  return NextResponse.json(result);
}
