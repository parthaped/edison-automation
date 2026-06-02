import type { ReactNode } from "react";
import { ActiveIngestProvider } from "@/components/workbench/active-ingest-provider";
import { WorkbenchSidebar } from "@/components/workbench/sidebar";

export default function WorkbenchLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ActiveIngestProvider>
      <div className="flex h-[100svh] w-full overflow-hidden bg-background">
        <WorkbenchSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </ActiveIngestProvider>
  );
}
