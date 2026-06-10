"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, FlaskConical, Lock } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

const navItems = [
  {
    label: "Research",
    href: "/",
    icon: BookOpen,
    description: "Search Edison Papers",
  },
  {
    label: "Workbench",
    href: "/workbench/review",
    icon: FlaskConical,
    description: "Staff transcription tools",
    protected: true,
  },
];

export function ResearchHeader() {
  const pathname = usePathname();
  const isResearch =
    pathname === "/" ||
    pathname.startsWith("/search") ||
    pathname.startsWith("/item");

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <Image
            src="/favicon.svg"
            alt=""
            width={20}
            height={26}
            priority
            aria-hidden="true"
            className="shrink-0"
          />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Thomas A. Edison Papers
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              Digital Research Platform
            </p>
          </div>
        </Link>

        <nav aria-label="Platform sections" className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? isResearch
                : pathname.startsWith("/workbench");

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
                {item.label}
                {item.protected ? (
                  <Lock className="size-3 opacity-70" aria-hidden="true" />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="h-px w-full bg-[var(--brand-accent)]" aria-hidden="true" />
    </header>
  );
}
