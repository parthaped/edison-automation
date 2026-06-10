import { NextResponse } from "next/server";
import { z } from "zod";
import { validateWorkbenchLogin } from "@/lib/auth/credentials";
import {
  createSessionToken,
  getSessionSecret,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth/session";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const { username, password } = parsed.data;
  if (!validateWorkbenchLogin(username, password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken(username, getSessionSecret());
  const response = NextResponse.json({ ok: true, username });
  response.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
  return response;
}
