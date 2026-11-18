import { createFileRoute } from "@tanstack/react-router";

import { friendlyResult, parseStkCallback } from "@/lib/mpesa";

const accepted = () => Response.json({ ResultCode: 0, ResultDesc: "Accepted" });

export const Route = createFileRoute("/api/public/payments/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["PAYMENT_CALLBACK_TOKEN"];
        const token = new URL(request.url).searchParams.get("token");
        if (!expected || token !== expected) return new Response("Forbidden", { status: 403 });

        const body = await request.json().catch(() => null);
        const cb = parseStkCallback(body);
        if (!cb) return accepted();

        const { isSupabaseAdminConfigured, supabaseAdmin } =
          await import("@/integrations/supabase/client.server");
        if (!isSupabaseAdminConfigured()) {
          const store = await import("@/lib/local-store.server");
          const order = store.getOrderByCheckoutId(cb.checkoutRequestId);
          if (!order || order.status !== "pending") return accepted();
          if (cb.resultCode === 0) {
            if (cb.amount !== undefined && Math.round(cb.amount) !== order.amount) {
              console.error(
                "Callback amount mismatch",
                cb.checkoutRequestId,
                cb.amount,
                order.amount,
              );
              return accepted();
            }
            store.updateOrder(order.id, {
              status: "paid",
              mpesa_receipt: cb.receipt ?? null,
              result_desc: cb.resultDesc,
              paid_at: new Date().toISOString(),
            });
          } else {
            store.updateOrder(order.id, {
              status: "failed",
              result_desc: friendlyResult(cb.resultCode, cb.resultDesc),
            });
          }
          return accepted();
        }

        const { data: order } = await supabaseAdmin
          .from("orders")
          .select("id, amount, status")
          .eq("checkout_request_id", cb.checkoutRequestId)
          .maybeSingle();
        if (!order || order.status !== "pending") return accepted();

        if (cb.resultCode === 0) {
          if (cb.amount !== undefined && Math.round(cb.amount) !== order.amount) {
            console.error(
              "Callback amount mismatch",
              cb.checkoutRequestId,
              cb.amount,
              order.amount,
            );
            return accepted();
          }
          await supabaseAdmin
            .from("orders")
            .update({
              status: "paid",
              mpesa_receipt: cb.receipt ?? null,
              result_desc: cb.resultDesc,
              paid_at: new Date().toISOString(),
            })
            .eq("id", order.id)
            .eq("status", "pending");
        } else {
          await supabaseAdmin
            .from("orders")
            .update({ status: "failed", result_desc: friendlyResult(cb.resultCode, cb.resultDesc) })
            .eq("id", order.id)
            .eq("status", "pending");
        }
        return accepted();
      },
    },
  },
});
