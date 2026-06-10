"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Lock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WorkbenchLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/workbench/review";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Login failed");
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Unable to reach the login service.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100svh] flex-col bg-[#f8f9fb]">
      <header className="border-b border-border bg-white px-4 py-4 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <Image
            src="/workbench-icon.svg"
            alt=""
            width={18}
            height={18}
            priority
            aria-hidden="true"
          />
          <span className="text-sm font-semibold">Edison Papers Research Platform</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Lock className="size-5" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Workbench sign in</h1>
              <p className="text-sm text-muted-foreground">
                Authorized staff access only
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="username" className="text-sm font-medium">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                required
              />
            </div>

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading}>
              <LogIn className="size-4" aria-hidden="true" />
              {loading ? "Signing in…" : "Sign in to Workbench"}
            </Button>
          </form>

          <p className="mt-6 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Development credentials: username{" "}
            <code className="font-mono">edison-admin</code>, password{" "}
            <code className="font-mono">edison-dev-2026</code>. Override with{" "}
            <code className="font-mono">WORKBENCH_DEV_USERNAME</code> and{" "}
            <code className="font-mono">WORKBENCH_DEV_PASSWORD</code>.
          </p>
        </div>
      </main>
    </div>
  );
}
