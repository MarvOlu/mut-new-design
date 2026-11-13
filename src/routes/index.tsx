import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Eye, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useBasket } from "@/components/shop/basket";
import { HeroSection, PromoSection } from "@/components/shop/home-sections";
import { ImageCarousel } from "@/components/shop/ImageCarousel";
import { SiteFooter, SiteHeader, useSiteContent } from "@/components/shop/SiteChrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { visibleCategories } from "@/lib/categories";
import { designGallery } from "@/lib/design-images";
import { categoriesQuery, designsQuery, formatKsh, siteContentQuery } from "@/lib/shop-queries";
import type { SectionId } from "@/lib/site-content";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mutken Architectural Designs — Classy, affordable house plans" },
      { name: "description", content: "Browse residential, commercial and interior designs. Pay with M-PESA and download in PDF, DWG, DXF, PNG or JPG." },
      { property: "og:title", content: "Mutken Architectural Designs" },
      { property: "og:description", content: "Pay with M-PESA and instantly download classy, affordable architectural designs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(designsQuery),
      context.queryClient.ensureQueryData(categoriesQuery),
      context.queryClient.ensureQueryData(siteContentQuery),
    ]),
  component: Index,
});

function Index() {
  const { data: designs } = useSuspenseQuery(designsQuery);
  const { data: allCategories } = useSuspenseQuery(categoriesQuery);
  const content = useSiteContent();
  const categories = useMemo(() => visibleCategories(allCategories, designs), [allCategories, designs]);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const { has, toggle, setOpen } = useBasket();

  const shown = useMemo(
    () =>
      designs.filter(
        (d) =>
          (category === "All" || d.category === category || !categories.some((c) => c.name === category)) &&
          d.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [designs, categories, category, query],
  );

  const scrollToShop = () => document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" });

  const sections: Record<SectionId, ReactNode> = {
    hero: <HeroSection content={content} onShop={scrollToShop} />,
    categories: (
      <section>
        <h2 className="text-2xl font-bold sm:text-3xl">{content.shopHeading}</h2>
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
          {[{ name: "All", emoji: "🛒" }, ...categories].map(({ name, emoji }) => (
            <button
              key={name}
              type="button"
              onClick={() => setCategory(name)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-5 py-2.5 font-semibold transition-colors ${
                category === name
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-secondary"
              }`}
            >
              <span>{emoji}</span>
              {name}
            </button>
          ))}
        </div>
        <div className="relative mt-4 md:hidden">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search designs" className="h-11 rounded-full bg-muted pl-9" />
        </div>
      </section>
    ),
    designs: (
      <section>
        <h2 className="text-2xl font-bold sm:text-3xl">{category === "All" ? content.designsHeading : category}</h2>
          {shown.length === 0 ? (
            <p className="mt-6 text-muted-foreground">No designs found.</p>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-6">
              {shown.map((d) => {
                const inBasket = has(d.id);
                return (
                  <article key={d.id} className="group flex flex-col overflow-hidden rounded-3xl md:flex-row border border-border bg-card shadow-card transition-shadow hover:shadow-lift">
                    <div className="relative md:w-2/5 md:shrink-0">
                      <ImageCarousel images={designGallery(d)} alt={d.name} imageClassName="aspect-[4/3]">
                        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
                          <Link
                            to="/designs/$designId"
                            params={{ designId: d.id }}
                            className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-accent px-7 py-3 font-display text-sm font-bold uppercase tracking-wider text-accent-foreground shadow-lift transition md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                          >
                            <Eye className="h-4 w-4" /> View
                          </Link>
                        </div>
                      </ImageCarousel>
                      {d.tag && (
                        <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-highlight px-3 py-1 text-xs font-bold text-highlight-foreground">
                          {d.tag}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-5 md:p-8">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{d.category}</p>
                      <h3 className="text-lg font-bold md:text-2xl">
                        <Link to="/designs/$designId" params={{ designId: d.id }} className="hover:text-primary hover:underline">
                          {d.name}
                        </Link>
                      </h3>
                      {d.unit && <p className="text-sm text-muted-foreground">{d.unit}</p>}
                      {d.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>}
                      <div className="mt-auto flex items-center justify-between pt-4">
                        <span className="font-display text-lg font-extrabold text-primary">{formatKsh(d.price)}</span>
                        <Button variant={inBasket ? "soft" : "cta"} size="sm" className="h-9 px-4" onClick={() => toggle(d.id)}>
                          {inBasket ? <Check /> : <Plus />}
                          {inBasket ? "Added" : "Add"}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
      </section>
    ),
    promo: <PromoSection content={content} onOpenBasket={() => setOpen(true)} />,
  };

  return (
    <div className="min-h-screen">
      <SiteHeader>
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search designs"
            className="h-10 w-72 rounded-full bg-muted pl-9"
          />
        </div>
      </SiteHeader>

      <main className="mx-auto max-w-7xl px-4 sm:px-6">
        {content.sections
          .filter((s) => s.visible)
          .map((s, i, list) => {
            const shopAnchor = list.find((x) => x.id === "categories" || x.id === "designs")?.id;
            return <div key={s.id} id={s.id === shopAnchor ? "shop" : undefined} className={`scroll-mt-24 ${i === 0 ? "mt-6" : s.id === "designs" ? "mt-8" : "mt-14"}`}>{sections[s.id]}</div>;
          })}
      </main>

      <SiteFooter />
    </div>
  );
}
