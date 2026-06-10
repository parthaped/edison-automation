import type { ReactNode } from "react";
import { ResearchHeader } from "@/components/research/research-header";

export default function ResearchLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100svh] flex-col bg-[#f8f9fb]">
      <ResearchHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Thomas A. Edison Papers · Rutgers, The State University of New Jersey
          </p>
          <p>
            Images from{" "}
            <a
              href="https://edison.rutgers.edu"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              edison.rutgers.edu
            </a>
            . Search powered by{" "}
            <a
              href="https://edisondigital.rutgers.edu"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              edisondigital.rutgers.edu
            </a>{" "}
            Omeka S metadata
          </p>
        </div>
      </footer>
    </div>
  );
}
