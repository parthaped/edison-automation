"use client";

import { Download, FileCheck2, History, Upload } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  description: string;
  icon: typeof Upload;
}

const navItems: NavItem[] = [
  {
    label: "Upload & transcribe",
    href: "/upload",
    description: "Ingest pages and run OCR",
    icon: Upload,
  },
  {
    label: "Review",
    href: "/review",
    description: "Verify transcriptions",
    icon: FileCheck2,
  },
  {
    label: "Audit trail",
    href: "/audit",
    description: "Processing history",
    icon: History,
  },
];

export function WorkbenchSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border">
        <Link
          href="/review"
          className="flex items-center gap-2.5 px-4 py-3.5 transition-colors hover:bg-sidebar-accent"
        >
          <Image
            src="/favicon.svg"
            alt=""
            width={18}
            height={24}
            priority
            aria-hidden="true"
            className="shrink-0"
          />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Edison Papers
            </span>
            <span className="truncate text-[13.5px] font-semibold text-foreground">
              Automation Workbench
            </span>
          </div>
        </Link>
        <div className="h-px w-full bg-amber-500/80" aria-hidden="true" />
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      active
                        ? "text-sidebar-primary-foreground"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-medium leading-tight">
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 text-[11px] leading-tight",
                        active
                          ? "text-sidebar-primary-foreground/75"
                          : "text-muted-foreground",
                      )}
                    >
                      {item.description}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <a
          href="/api/export/transcriptions"
          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
        >
          <Download
            className="h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          Download Omeka CSV
        </a>
        <p className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          Rutgers University · Internal
        </p>
      </div>
    </aside>
  );
}
