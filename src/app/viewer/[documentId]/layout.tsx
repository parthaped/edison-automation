import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Edison Papers · Document viewer",
  description:
    "Embeddable side-by-side viewer for Edison Papers source images and transcriptions.",
  robots: { index: false, follow: false },
};

export default function ViewerLayout({ children }: { children: ReactNode }) {
  return (
    <div data-embed="true" className="flex min-h-screen flex-col bg-background">
      {children}
    </div>
  );
}
