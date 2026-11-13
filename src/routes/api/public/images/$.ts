import { createFileRoute } from "@tanstack/react-router";

const SAFE_PATH = /^[\w\-./]+$/;
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export const Route = createFileRoute("/api/public/images/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const path = decodeURIComponent(params._splat ?? "");
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        if (!SAFE_PATH.test(path) || path.includes("..") || !TYPES[ext]) {
          return new Response("Not found", { status: 404 });
        }

        const { isSupabaseAdminConfigured, supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (!isSupabaseAdminConfigured()) {
          const { readUploadedImage } = await import("@/lib/local-store.server");
          const bytes = readUploadedImage(path);
          if (!bytes) return new Response("Not found", { status: 404 });
          return new Response(Buffer.from(bytes), {
            headers: {
              "content-type": TYPES[ext],
              "cache-control": "public, max-age=31536000, immutable",
            },
          });
        }

        const { data, error } = await supabaseAdmin.storage.from("design-images").download(path);
        if (error || !data) return new Response("Not found", { status: 404 });
        return new Response(data, {
          headers: {
            "content-type": TYPES[ext],
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
