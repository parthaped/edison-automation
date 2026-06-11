export const EDISON_SITE = "https://edison.rutgers.edu";

export type LandingImage = {
  src: string;
  alt: string;
};

export const HERO_CAROUSEL_IMAGES: LandingImage[] = [
  { src: "/landing/hero-01.webp", alt: "" },
  { src: "/landing/hero-02.webp", alt: "" },
  { src: "/landing/hero-03.webp", alt: "" },
  { src: "/landing/hero-04.webp", alt: "" },
];

export type ExploreCardConfig = {
  title: string;
  image: string;
  href: string;
  external?: boolean;
  className?: string;
};

export const EXPLORE_CARDS: ExploreCardConfig[] = [
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
