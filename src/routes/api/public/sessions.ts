import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/sessions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          id?: string;
          role?: "shopper" | "admin";
          path?: string;
          basketCount?: number;
        } | null;

        if (!body?.id || typeof body.id !== "string") {
          return Response.json({ ok: false }, { status: 400 });
        }

        const store = await import("@/lib/local-store.server");
        store.touchSession({
          id: body.id.slice(0, 64),
          role: body.role === "admin" ? "admin" : "shopper",
          path: typeof body.path === "string" ? body.path.slice(0, 120) : "/",
          basketCount: typeof body.basketCount === "number" ? Math.max(0, body.basketCount) : 0,
          userAgent: request.headers.get("user-agent")?.slice(0, 120) ?? "Browser",
        });

        return Response.json({ ok: true });
      },
    },
  },
});
