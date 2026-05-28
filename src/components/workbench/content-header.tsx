import type { ReactNode } from "react";

interface ContentHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function ContentHeader({
  title,
  description,
  action,
}: ContentHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
    </header>
  );
}
