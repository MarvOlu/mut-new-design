import { useEffect, useState, type ReactNode } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

export function ImageCarousel({
  images,
  captions,
  alt,
  className,
  carouselClassName,
  imageClassName,
  thumbnails = false,
  eager = false,
  children,
}: {
  images: string[];
  captions?: (string | undefined)[];
  alt: string;
  className?: string;
  carouselClassName?: string;
  imageClassName?: string;
  thumbnails?: boolean;
  eager?: boolean;
  children?: ReactNode;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const many = images.length > 1;
  const activeCaption = captions?.[current]?.trim();

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect);
    api.on("reInit", onSelect);
    return () => {
      api.off("select", onSelect);
      api.off("reInit", onSelect);
    };
  }, [api]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Carousel
        setApi={setApi}
        opts={{ loop: many }}
        className={cn("relative w-full overflow-hidden", carouselClassName)}
        aria-label={`${alt} pictures`}
      >
        <CarouselContent className="ml-0 h-full">
          {images.map((src, i) => (
            <CarouselItem key={`${src}-${i}`} className="h-full pl-0">
              <img
                src={src}
                alt={captions?.[i]?.trim() || `${alt} — picture ${i + 1} of ${images.length}`}
                loading={eager && i === 0 ? "eager" : "lazy"}
                width={1280}
                height={960}
                referrerPolicy="no-referrer"
                className={cn("h-full w-full object-cover", imageClassName)}
              />
            </CarouselItem>
          ))}
        </CarouselContent>

        {many && (
          <>
            <CarouselPrevious
              variant="secondary"
              className="left-3 z-10 h-9 w-9 border-0 bg-card/90 shadow-card hover:bg-card"
            />
            <CarouselNext
              variant="secondary"
              className="right-3 z-10 h-9 w-9 border-0 bg-card/90 shadow-card hover:bg-card"
            />
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 rounded-full bg-foreground/40 px-2 py-1.5">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => api?.scrollTo(i)}
                  aria-label={`Show picture ${i + 1}`}
                  aria-current={i === current}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    i === current ? "w-5 bg-card" : "w-2 bg-card/60",
                  )}
                />
              ))}
            </div>
          </>
        )}
        {children}
      </Carousel>

      {activeCaption && <p className="text-sm text-muted-foreground">{activeCaption}</p>}

      {thumbnails && many && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={`${src}-thumb-${i}`}
              type="button"
              onClick={() => api?.scrollTo(i)}
              aria-label={`Show picture ${i + 1}`}
              className={cn(
                "h-20 w-24 shrink-0 overflow-hidden rounded-xl border-2 transition-colors",
                i === current ? "border-accent" : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <img
                src={src}
                alt=""
                loading="lazy"
                width={96}
                height={80}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
