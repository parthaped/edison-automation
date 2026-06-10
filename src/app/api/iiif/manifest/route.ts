import { NextResponse } from "next/server";
import { APP_USER_AGENT } from "@/lib/app-config";
import { getEdisonDigitalSiteUrl } from "@/lib/omeka/client";

const ALLOWED_ORIGIN = getEdisonDigitalSiteUrl();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const manifestUrl = url.searchParams.get("url")?.trim();

  if (!manifestUrl) {
    return NextResponse.json({ error: "Missing url parameter." }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(manifestUrl);
  } catch {
    return NextResponse.json({ error: "Invalid manifest URL." }, { status: 400 });
  }

  if (parsed.origin !== ALLOWED_ORIGIN || !parsed.pathname.includes("/iiif/")) {
    return NextResponse.json({ error: "Manifest URL not allowed." }, { status: 403 });
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        Accept: "application/json, application/ld+json;q=0.9, */*;q=0.1",
        "User-Agent": APP_USER_AGENT,
      },
      cache: "force-cache",
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `IIIF manifest fetch failed (${response.status}).` },
        { status: response.status },
      );
    }

    const manifest = await response.json();
    return NextResponse.json(manifest, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch IIIF manifest." }, { status: 502 });
  }
}
