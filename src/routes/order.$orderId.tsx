import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Download, Loader2, Smartphone, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SiteFooter, SiteHeader } from "@/components/shop/SiteChrome";
import { Button } from "@/components/ui/button";
import { designImage } from "@/lib/design-images";
import { DOWNLOAD_FORMATS, type DownloadFormat } from "@/lib/downloads";
import { formatKsh, orderQuery } from "@/lib/shop-queries";
import { getDownloadLink } from "@/lib/shop.functions";

export const Route = createFileRoute("/order/$orderId")({
  head: () => ({
    meta: [
      { title: "Your order — Mutken Architectural Designs" },
      {
        name: "description",
        content: "Track your M-PESA payment and download your purchased designs.",
      },
      { property: "og:title", content: "Your order — Mutken Architectural Designs" },
      {
        property: "og:description",
        content: "Track your M-PESA payment and download your designs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrderPage,
});

const MAX_WAIT_MS = 3 * 60 * 1000;

function OrderPage() {
  const { orderId } = Route.useParams();
  const [startedAt] = useState(() => Date.now());
  const { data, isLoading, isError } = useQuery({
    ...orderQuery(orderId),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d && d.found && d.status !== "pending") return false;
      return Date.now() - startedAt > MAX_WAIT_MS ? false : 4000;
    },
  });

  return (
    <div className="min-h-screen">
      <SiteHeader>
        <Button asChild variant="soft">
          <Link to="/">Browse designs</Link>
        </Button>
      </SiteHeader>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {isLoading && (
          <StatusCard
            icon={<Loader2 className="h-8 w-8 animate-spin" />}
            title="Loading your order…"
          />
        )}
        {(isError || (data && !data.found)) && (
          <StatusCard
            icon={<XCircle className="h-8 w-8 text-destructive" />}
            title="Order not found"
            text="Check the link, or start a new order."
          />
        )}
        {data?.found && data.status === "pending" && (
          <StatusCard
            icon={
              <span className="relative grid h-16 w-16 place-items-center">
                <span className="absolute inset-0 rounded-full bg-mpesa/30 animate-pulse-ring" />
                <span className="relative grid h-14 w-14 place-items-center rounded-full bg-mpesa text-mpesa-foreground">
                  <Smartphone className="h-6 w-6" />
                </span>
              </span>
            }
            title="Check your phone"
            text={`Enter your M-PESA PIN to pay ${formatKsh(data.amount)}. This page updates automatically once the payment goes through.`}
          >
            {Date.now() - startedAt > MAX_WAIT_MS && (
              <p className="text-sm text-muted-foreground">
                Still waiting? Refresh this page, or go back and try again.
              </p>
            )}
          </StatusCard>
        )}
        {data?.found && data.status === "failed" && (
          <StatusCard
            icon={<XCircle className="h-8 w-8 text-destructive" />}
            title="Payment not completed"
            text={data.message ?? "The M-PESA payment was cancelled or failed."}
          >
            <Button asChild variant="cta" size="lg">
              <Link to="/">Try again</Link>
            </Button>
          </StatusCard>
        )}
        {data?.found && data.status === "paid" && (
          <>
            <StatusCard
              icon={<CheckCircle2 className="h-10 w-10 text-success" />}
              title="Payment received — thank you!"
              text={`You paid ${formatKsh(data.amount)}${data.receipt ? ` · M-PESA receipt ${data.receipt}` : ""}. Bookmark this page to download your designs again later.`}
            />
            <div className="mt-8 space-y-5">
              {data.items.map((item) => (
                <DesignDownloads key={item.id} orderId={orderId} item={item} />
              ))}
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function StatusCard({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[2rem] border border-border bg-card p-10 text-center shadow-card">
      {icon}
      <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
      {text && <p className="max-w-md text-muted-foreground">{text}</p>}
      {children}
    </div>
  );
}

function DesignDownloads({
  orderId,
  item,
}: {
  orderId: string;
  item: {
    id: string;
    name: string;
    category: string;
    image_key: string;
    formats: DownloadFormat[];
  };
}) {
  const getLink = useServerFn(getDownloadLink);
  const [busy, setBusy] = useState<DownloadFormat | null>(null);

  async function download(format: DownloadFormat) {
    setBusy(format);
    try {
      const res = await getLink({ data: { orderId, designId: item.id, format } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      // The link is marked as an attachment, so the browser saves the file and stays on this page.
      window.location.href = res.url;
    } catch {
      toast.error("Could not prepare the download. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-card sm:flex-row sm:items-center">
      <img
        src={designImage(item.image_key)}
        alt=""
        className="h-24 w-full rounded-2xl object-cover sm:w-32"
        loading="lazy"
        width={128}
        height={96}
      />
      <div className="flex-1 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {item.category}
          </p>
          <h2 className="text-lg font-bold">{item.name}</h2>
        </div>
        {item.formats.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your files are being prepared. Call +254 725 202833 if they don't appear here soon.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {item.formats.map((f) => (
              <Button
                key={f}
                variant={f === "pdf" ? "cta" : "soft"}
                size="sm"
                className="h-9 px-4"
                disabled={busy !== null}
                onClick={() => download(f)}
                title={DOWNLOAD_FORMATS[f].description}
              >
                {busy === f ? <Loader2 className="animate-spin" /> : <Download />}
                {DOWNLOAD_FORMATS[f].label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
