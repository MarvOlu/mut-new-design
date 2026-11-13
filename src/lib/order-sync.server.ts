import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { getMpesaConfig, queryStkStatus } from "./mpesa.server";

type Db = SupabaseClient<Database>;

export interface PendingOrder {
  id: string;
  status: string;
  checkout_request_id: string | null;
  created_at: string;
  last_query_at: string | null;
}

/**
 * Asks Daraja (STK Query) how a pending payment ended, for when Safaricom's callback hasn't
 * arrived. Throttled per order so Safaricom doesn't rate-limit us. Returns the new status, or
 * null when nothing changed or the check was skipped.
 */
export async function syncPendingOrder(
  db: Db,
  order: PendingOrder,
  { minAgeMs = 10_000, minGapMs = 15_000 }: { minAgeMs?: number; minGapMs?: number } = {},
): Promise<{ status: "paid" | "failed"; resultDesc: string } | null> {
  if (order.status !== "pending" || !order.checkout_request_id) return null;
  const ageMs = Date.now() - new Date(order.created_at).getTime();
  const sinceQueryMs = order.last_query_at ? Date.now() - new Date(order.last_query_at).getTime() : Infinity;
  if (ageMs < minAgeMs || sinceQueryMs < minGapMs) return null;

  await db.from("orders").update({ last_query_at: new Date().toISOString() }).eq("id", order.id);
  try {
    const { config, missing } = getMpesaConfig();
    if (missing.length) return null;
    const outcome = await queryStkStatus(config, order.checkout_request_id);
    if (outcome.state === "pending") return null;
    await db
      .from("orders")
      .update({
        status: outcome.state,
        result_desc: outcome.resultDesc,
        ...(outcome.state === "paid" ? { paid_at: new Date().toISOString() } : {}),
      })
      .eq("id", order.id)
      .eq("status", "pending");
    return { status: outcome.state, resultDesc: outcome.resultDesc };
  } catch (e) {
    console.error("STK status query failed", e);
    return null;
  }
}
