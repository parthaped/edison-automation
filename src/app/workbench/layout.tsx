import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/workbench-icon.svg", type: "image/svg+xml" }],
  },
};

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return children;
}
