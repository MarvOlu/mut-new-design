import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const store = await import("@/lib/local-store.server");
        const url = new URL(request.url);
        const sessionId = url.searchParams.get("sessionId") || `admin-${Date.now()}`;
        const encoder = new TextEncoder();

        store.touchSession({
          id: sessionId.slice(0, 64),
          role: "admin",
          path: "/admin",
          basketCount: 0,
          userAgent: request.headers.get("user-agent")?.slice(0, 120) ?? "Admin Dashboard",
        });

        let cleanup: (() => void) | undefined;

        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              try {
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                );
              } catch {
                // Stream closed
              }
            };

            send("init", {
              sessions: store.listActiveSessions(),
              recentEvents: store.listRecentOrderEvents(20),
            });

            const unsubscribe = store.subscribeAdminEvents((evt) => {
              send(evt.type, evt);
            });

            const keepAlive = setInterval(() => {
              store.touchSession({
                id: sessionId.slice(0, 64),
                role: "admin",
                path: "/admin",
                basketCount: 0,
              });
              send("ping", {
                at: new Date().toISOString(),
                sessions: store.listActiveSessions(),
              });
            }, 15_000);

            cleanup = () => {
              clearInterval(keepAlive);
              unsubscribe();
              store.removeSession(sessionId.slice(0, 64));
            };

            request.signal.addEventListener("abort", () => {
              cleanup?.();
              try {
                controller.close();
              } catch {
                // Already closed
              }
            });
          },
          cancel() {
            cleanup?.();
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          },
        });
      },
    },
  },
});
