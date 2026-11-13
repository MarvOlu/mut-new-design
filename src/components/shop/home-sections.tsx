import { ShoppingBasket } from "lucide-react";

import heroFallback from "@/assets/hero-blueprint.jpg";
import { Button } from "@/components/ui/button";
import { designImage } from "@/lib/design-images";
import type { SiteContent } from "@/lib/site-content";

// Homepage sections whose words come from the page maker. The dashboard preview renders these too.

export function HeroSection({ content, onShop }: { content: SiteContent; onShop?: () => void }) {
  return (
    <section className="grid overflow-hidden rounded-[2rem] bg-hero text-hero-foreground md:grid-cols-2">
      <div className="flex flex-col justify-center gap-5 p-8 sm:p-12">
        <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">
          {content.heroTitle} <span className="text-highlight">{content.heroHighlight}</span>
        </h1>
        <p className="max-w-md text-lg text-hero-foreground/85">{content.heroSubtitle}</p>
        <div>
          <Button variant="cta" size="xl" onClick={onShop}>
            {content.heroButton}
          </Button>
        </div>
      </div>
      <img
        src={content.heroImage ? designImage(content.heroImage) : heroFallback}
        alt="Featured Mutken design"
        className="h-full max-h-[480px] w-full object-cover"
        width={1200}
        height={960}
      />
    </section>
  );
}

export function PromoSection({
  content,
  onOpenBasket,
}: {
  content: SiteContent;
  onOpenBasket?: () => void;
}) {
  return (
    <section className="flex flex-col items-start gap-6 rounded-[2rem] bg-secondary p-8 sm:flex-row sm:items-center sm:p-10">
      <div className="text-5xl">📐</div>
      <div className="flex-1">
        <h2 className="text-2xl font-bold">{content.promoTitle}</h2>
        <p className="mt-1 text-muted-foreground">{content.promoText}</p>
      </div>
      <Button variant="cta" size="xl" onClick={onOpenBasket}>
        <ShoppingBasket /> View basket
      </Button>
    </section>
  );
}
