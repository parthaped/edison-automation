import Image from "next/image";
import Link from "next/link";
import { EXPLORE_CARDS, type ExploreCardConfig } from "@/lib/landing-images";
import { cn } from "@/lib/utils";

type ExploreCard = ExploreCardConfig;

function ExploreCardLink({ card }: { card: ExploreCard }) {
  const content = (
    <>
      <Image
        src={card.image}
        alt=""
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />
      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
          Explore
        </p>
        <h3 className="mt-1 text-base font-semibold leading-snug text-white sm:text-lg">
          {card.title}
        </h3>
      </div>
    </>
  );

  const className = cn(
    "group relative block min-h-[11rem] overflow-hidden rounded-xl border border-border/60 bg-muted shadow-sm transition-shadow hover:shadow-md sm:min-h-[12rem]",
    card.className,
  );

  if (card.external) {
    return (
      <a
        href={card.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {content}
      </a>
    );
  }

  return (
    <Link href={card.href} className={className}>
      {content}
    </Link>
  );
}

export function LandingExploreGrid() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="mb-8 max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/70">
          From the Edison Papers
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Explore the collection
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Browse biographical essays, inventions, patents, and archival resources
          from the Thomas A. Edison Papers at Rutgers.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:auto-rows-[12rem]">
        {EXPLORE_CARDS.map((card) => (
          <ExploreCardLink key={card.title} card={card} />
        ))}
      </div>
    </section>
  );
}
