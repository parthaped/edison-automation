"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  defaultValue?: string;
  size?: "hero" | "compact";
  className?: string;
  autoFocus?: boolean;
}

export function SearchBar({
  defaultValue = "",
  size = "hero",
  className,
  autoFocus = false,
}: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultValue);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("w-full", className)}
      role="search"
    >
      <div
        className={cn(
          "flex overflow-hidden rounded-xl border border-border bg-white shadow-sm transition-all focus-within:border-primary/60 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/15",
          size === "hero" ? "h-12 sm:h-14" : "h-10",
        )}
      >
        <label htmlFor="research-search" className="sr-only">
          Search Edison Papers
        </label>
        <div className="flex flex-1 items-center px-4">
          <Search
            className={cn(
              "mr-3 shrink-0 text-muted-foreground/60",
              size === "hero" ? "size-4 sm:size-5" : "size-4",
            )}
            aria-hidden="true"
          />
          <input
            id="research-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Try "crushing ore", "electric light", or "Menlo Park laboratory"'
            autoFocus={autoFocus}
            className={cn(
              "min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60",
              size === "hero" ? "text-base sm:text-lg" : "text-sm",
            )}
          />
        </div>
        <div className="flex items-center p-1.5">
          <Button
            type="submit"
            className={cn(
              "h-full rounded-lg px-4 sm:px-6",
              size === "hero" ? "text-sm sm:text-base" : "text-sm",
            )}
          >
            <span>Search</span>
          </Button>
        </div>
      </div>
    </form>
  );
}
