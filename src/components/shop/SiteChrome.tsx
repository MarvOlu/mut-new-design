import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";

import { BasketButton } from "@/components/shop/basket";
import { Button } from "@/components/ui/button";
import { siteContentQuery } from "@/lib/shop-queries";
import { DEFAULT_SITE_CONTENT, phoneHref, type SiteContent } from "@/lib/site-content";

export function useSiteContent(): SiteContent {
  const { data } = useQuery(siteContentQuery);
  return data ?? DEFAULT_SITE_CONTENT;
}

/** Thin bar above the header. "M-PESA" is highlighted wherever the owner writes it. */
export function AnnouncementBar({ text }: { text: string }) {
  return (
    <div className="bg-primary px-4 py-2 text-center text-sm text-primary-foreground">
      {text.split(/(M-PESA)/g).map((part, i) =>
        part === "M-PESA" ? (
          <b key={i} className="text-highlight">
            M-PESA
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  );
}

export function SiteHeader({ children }: { children?: ReactNode }) {
  const content = useSiteContent();
  return (
    <>
      <AnnouncementBar text={content.announcement} />
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 font-display text-lg font-extrabold text-primary"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              M
            </span>
            <span className="hidden sm:inline">Mutken Architectural Designs</span>
            <span className="sm:hidden">Mutken</span>
          </Link>
          <span className="hidden text-sm italic text-muted-foreground lg:inline">
            📍 We design anything, anywhere
          </span>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {children}
            <Button
              asChild
              variant="soft"
              size="sm"
              className="h-10 shrink-0 whitespace-nowrap px-3"
            >
              <Link to="/admin">
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
            </Button>
            <BasketButton />
          </div>
        </div>
      </header>
    </>
  );
}

export function FooterContent({
  content,
  ownerLink = true,
}: {
  content: SiteContent;
  ownerLink?: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-10 sm:flex-row sm:items-center sm:px-6">
      <h3 className="text-xl font-bold">
        {content.footerHeading}{" "}
        <a
          href={phoneHref(content.phone)}
          className="text-highlight underline-offset-4 hover:underline"
        >
          📞 {content.phone}
        </a>
      </h3>
      <div className="flex flex-col gap-1 text-sm text-primary-foreground/70 sm:items-end">
        <p>{content.footerNote}</p>
        {ownerLink && (
          <Link
            to="/admin"
            className="text-xs text-primary-foreground/50 hover:text-primary-foreground hover:underline"
          >
            Owner dashboard
          </Link>
        )}
      </div>
    </div>
  );
}

export function SiteFooter() {
  const content = useSiteContent();
  return (
    <footer className="mt-20 bg-primary text-primary-foreground">
      <FooterContent content={content} />
    </footer>
  );
}
