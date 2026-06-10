import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

const EDISON_SITE = "https://edison.rutgers.edu";

type ExploreCard = {
  title: string;
  image: string;
  href: string;
  external?: boolean;
  className?: string;
};

const exploreCards: ExploreCard[] = [
  {
    title: "Biographical Essays",
    image: "/landing/innovations.jpg",
    href: `${EDISON_SITE}/life-of-edison/biographical-essays`,
    external: true,
    className: "sm:col-span-2 lg:col-span-2 lg:row-span-2",
  },
  {
    title: "Inventions",
    image: "/landing/inventions.jpg",
    href: `${EDISON_SITE}/life-of-edison/inventions`,
    external: true,
    className: "sm:col-span-2 lg:col-span-2",
  },
  {
    title: "Document Sampler",
    image: "/landing/document-sampler.jpg",
    href: `${EDISON_SITE}/research/document-sampler`,
    external: true,
    className: "sm:col-span-2 lg:col-span-2",
  },
  {
    title: "Patents",
    image: "/landing/Patents.jpg",
    href: `${EDISON_SITE}/research/edison-s-patents`,
    external: true,
  },
  {
    title: "Lewis Howard Latimer",
    image: "/landing/Latimer.jpg",
    href: `${EDISON_SITE}/resources/latimer`,
    external: true,
  },
  {
    title: "Edison's Digital Documents",
    image: "/landing/digital_documents.jpg",
    href: `${EDISON_SITE}/research/digital-edition`,
    external: true,
  },
  {
    title: "Motion Pictures",
    image: "/landing/motion-pictures.jpg",
    href: `${EDISON_SITE}/research/motion-picture-catalogs`,
    external: true,
  },
  {
    title: "Thomas Edison's New Jersey",
    image: "/landing/Thomas_Edisons_New_Jersey.jpg",
    href: "https://uploads.knightlab.com/storymapjs/a12cc1cc54c4c8e08420a3954abf6183/thomas-edisons-new-jersey-1/index.html",
    external: true,
    className: "lg:col-span-2",
  },
];

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
        {exploreCards.map((card) => (
          <ExploreCardLink key={card.title} card={card} />
        ))}
      </div>
    </section>
  );
}
