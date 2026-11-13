import { createFileRoute } from "@tanstack/react-router";
import { canDownload, DOWNLOAD_FORMATS, type DownloadFormat } from "@/lib/downloads";

export const Route = createFileRoute("/api/public/downloads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const orderId = url.searchParams.get("orderId") ?? "";
        const designId = url.searchParams.get("designId") ?? "";
        const format = url.searchParams.get("format") ?? "";

        if (!orderId || !designId || !(format in DOWNLOAD_FORMATS)) {
          return new Response("Invalid download parameters", { status: 400 });
        }

        const store = await import("@/lib/local-store.server");
        const order = store.getOrder(orderId);
        if (!canDownload(order, designId)) {
          return new Response("Forbidden", { status: 403 });
        }

        const file = store.readDownloadableFile(designId, format as DownloadFormat);
        return new Response(Buffer.from(file.bytes), {
          headers: {
            "content-type": file.contentType,
            "content-disposition": `attachment; filename="${file.fileName}"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
