import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getSessionSecretEdge,
  SESSION_COOKIE_NAME,
  verifySessionTokenEdge,
} from "@/lib/auth/session-edge";

const WORKBENCH_PUBLIC_PATHS = ["/workbench/login"];

const PROTECTED_API_PREFIXES = [
  "/api/ingest",
  "/api/export",
  "/api/documents",
  "/api/blob",
];

function isProtectedPath(pathname: string): boolean {
  if (WORKBENCH_PUBLIC_PATHS.includes(pathname)) {
    return false;
  }
  if (pathname.startsWith("/workbench")) {
    return true;
  }
  return PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const secret = getSessionSecretEdge(process.env);
  const session = await verifySessionTokenEdge(token, secret);

  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/workbench/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/workbench",
    "/workbench/:path*",
    "/api/ingest/:path*",
    "/api/export/:path*",
    "/api/documents/:path*",
    "/api/blob/:path*",
  ],
};
