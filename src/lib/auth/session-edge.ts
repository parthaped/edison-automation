/** Edge-compatible session verification for middleware. */

export const SESSION_COOKIE_NAME = "edison-workbench-session";

export interface SessionPayload {
  username: string;
  exp: number;
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  return atob(padded);
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function verifySessionTokenEdge(
  token: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token || !secret) {
    return null;
  }

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = await signPayload(encoded, secret);
  if (signature !== expected) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as SessionPayload;
    if (
      typeof payload.username !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp < Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function getSessionSecretEdge(env: NodeJS.ProcessEnv): string {
  return (
    env.WORKBENCH_SESSION_SECRET?.trim() ||
    env.WORKBENCH_DEV_PASSWORD?.trim() ||
    "edison-dev-session-secret-change-me"
  );
}
