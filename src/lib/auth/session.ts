import { createHmac } from "node:crypto";

export const SESSION_COOKIE_NAME = "edison-workbench-session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  username: string;
  exp: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(
  username: string,
  secret: string,
): string {
  const payload: SessionPayload = {
    username,
    exp: Date.now() + SESSION_MAX_AGE_MS,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encoded, secret);
  return `${encoded}.${signature}`;
}

export function getSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.WORKBENCH_SESSION_SECRET?.trim() ||
    env.WORKBENCH_DEV_PASSWORD?.trim() ||
    "edison-dev-session-secret-change-me"
  );
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_MS / 1000,
};
