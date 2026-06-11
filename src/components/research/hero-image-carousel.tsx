"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { LandingImage } from "@/lib/landing-images";
import { cn } from "@/lib/utils";

const INTERVAL_MS = 6500;
const FADE_MS = 1400;

interface HeroImageCarouselProps {
  images: LandingImage[];
  className?: string;
}

export function HeroImageCarousel({ images, className }: HeroImageCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const slideCount = images.length;

  const goTo = useCallback(
    (index: number) => {
      if (slideCount === 0) return;
      setActiveIndex(((index % slideCount) + slideCount) % slideCount);
    },
    [slideCount],
  );

  const goNext = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const goPrev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (slideCount <= 1 || isPaused || prefersReducedMotion) return;
    const timer = window.setInterval(goNext, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [slideCount, isPaused, prefersReducedMotion, goNext]);

  if (slideCount === 0) {
    return (
      <div
        className={cn("absolute inset-0 bg-gradient-to-b from-slate-800 to-slate-900", className)}
        aria-hidden="true"
      />
    );
  }

  const showControls = slideCount > 1 && !prefersReducedMotion;

  return (
    <div className={cn("absolute inset-0", className)}>
      {images.map((image, index) => (
        <div
          key={image.src}
          className="absolute inset-0 transition-opacity ease-in-out"
          style={{
            opacity: index === activeIndex ? 1 : 0,
            transitionDuration: `${FADE_MS}ms`,
            zIndex: index === activeIndex ? 1 : 0,
          }}
        >
          <Image
            src={image.src}
            alt={image.alt}
            fill
            sizes="100vw"
            className="object-cover"
            priority={index === 0}
          />
        </div>
      ))}

      <div className="absolute inset-0 z-[2] bg-gradient-to-b from-black/55 via-black/45 to-black/60" />

      {showControls ? (
        <>
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-3 top-1/2 z-[3] flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:left-5"
            aria-label="Previous slide"
          >
            <ChevronLeft className="size-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="absolute right-3 top-1/2 z-[3] flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:right-5"
            aria-label="Next slide"
          >
            <ChevronRight className="size-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setIsPaused((value) => !value)}
            className="absolute bottom-4 right-4 z-[3] flex size-9 items-center justify-center rounded bg-black/40 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:bottom-5 sm:right-5"
            aria-label={isPaused ? "Play slideshow" : "Pause slideshow"}
            aria-pressed={isPaused}
          >
            {isPaused ? (
              <Play className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Pause className="size-3.5" strokeWidth={1.75} />
            )}
          </button>
        </>
      ) : null}

      <p className="sr-only" aria-live="polite">
        Slide {activeIndex + 1} of {slideCount}
      </p>
    </div>
  );
}
