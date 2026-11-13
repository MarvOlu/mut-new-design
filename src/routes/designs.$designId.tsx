import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, FileDown, ShoppingBasket, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { useBasket } from "@/components/shop/basket";
import { ImageCarousel } from "@/components/shop/ImageCarousel";
import { SiteFooter, SiteHeader } from "@/components/shop/SiteChrome";
import { Button } from "@/components/ui/button";
import { designGallery, designGalleryKeys } from "@/lib/design-images";
import { DOWNLOAD_FORMATS } from "@/lib/downloads";
import { designDetailQuery, formatKsh } from "@/lib/shop-queries";

export const Route = createFileRoute("/designs/$designId")({
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(designDetailQuery(params.designId));
    if (!detail) throw notFound();
    return { name: detail.design.name, description: detail.design.description, category: detail.design.category };
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.name} — Mutken Architectural Designs` : "Design — Mutken Architectural Designs";
    const description =
      loaderData?.description ?? `${loaderData?.category ?? "Architectural"} design. Pay with M-PESA and download instantly.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "product" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(loaderData ? [] : [{ name: "robots", content: "noindex" }]),
      ],
    };
  },
  notFoundComponent: DesignNotFound,
  component: DesignPage,
});

function DesignNotFound() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-3xl font-bold">Design not found</h1>
        <p className="mt-2 text-muted-foreground">This design may have been removed.</p>
        <Button asChild variant="cta" size="xl" className="mt-6">
          <Link to="/">Back to all designs</Link>
        </Button>
      </main>
    </div>
  );
}

function DesignPage() {
  const { designId } = Route.useParams();
  const { data } = useSuspenseQuery(designDetailQuery(designId));
  const { has, add, setOpen } = useBasket();
  const navigate = useNavigate();
  if (!data) return <DesignNotFound />;
  const { design, formats } = data;
  const inBasket = has(design.id);
  const formatLabels = formats.map((f) => DOWNLOAD_FORMATS[f].label);

  function addAndContinue() {
    add(design.id);
    toast.success(`${design.name} added to your basket.`);
    navigate({ to: "/", hash: "shop" });
  }

  function buyNow() {
    add(design.id);
    setOpen(true);
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-7xl px-4 sm:px-6">
        <Link to="/" hash="shop" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> All designs
        </Link>

        <div className="mt-4 grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-12">
          <div className="relative">
            <ImageCarousel
              images={designGallery(design)}
              captions={designGalleryKeys(design).map((k) => design.image_captions?.[k])}
              alt={design.name}
              thumbnails
              eager
              carouselClassName="rounded-3xl"
              imageClassName="aspect-[4/3]"
            />
            {design.tag && (
              <span className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-highlight px-3 py-1 text-xs font-bold text-highlight-foreground">
                {design.tag}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{design.category}</p>
              <h1 className="mt-1 text-3xl font-extrabold leading-tight sm:text-4xl">{design.name}</h1>
              <p className="mt-2 font-display text-2xl font-extrabold text-primary">{formatKsh(design.price)}</p>
              {design.unit && <p className="text-sm text-muted-foreground">{design.unit}</p>}
              <p className="mt-4 border-l-4 border-highlight pl-4 leading-relaxed text-foreground/80">
                {design.description ?? `A ${design.category.toLowerCase()} design by Mutken Architectural Designs, ready to download after payment.`}
              </p>
            </div>

            <div className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-lift">
              <Button variant="mpesa" size="xl" className="w-full" onClick={buyNow}>
                <Smartphone /> Buy now
              </Button>
              <Button
                variant="outline"
                size="xl"
                className="w-full rounded-full border-2 border-accent bg-card font-semibold text-accent hover:bg-accent hover:text-accent-foreground"
                onClick={addAndContinue}
              >
                {inBasket ? <Check /> : <ShoppingBasket />}
                {inBasket ? "In basket — keep shopping" : "Add to basket"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Pay with <b className="text-foreground">M-PESA</b>. Downloads unlock as soon as payment succeeds.
              </p>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold">Design details</h2>
              <dl className="mt-3 divide-y divide-border text-sm">
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">Category</dt>
                  <dd className="font-semibold">{design.category}</dd>
                </div>
                {design.unit && (
                  <div className="flex justify-between gap-4 py-2">
                    <dt className="text-muted-foreground">Drawings</dt>
                    <dd className="font-semibold">{design.unit}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">Delivery</dt>
                  <dd className="font-semibold">Instant download after M-PESA payment</dd>
                </div>
                <div className="flex flex-col gap-2 py-2">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <FileDown className="h-4 w-4 text-primary" /> Download formats
                  </dt>
                  <dd>
                    {formatLabels.length === 0 ? (
                      <span className="text-muted-foreground">Files are being prepared. Call us to confirm formats.</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {formatLabels.map((label) => (
                          <span key={label} className="rounded-full border border-border bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
