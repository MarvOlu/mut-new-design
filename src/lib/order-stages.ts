// How orders are grouped on the dashboard. Stages come straight from the payment state.

export type OrderStage = "received" | "processing" | "completed" | "rejected";

/** An M-PESA prompt that hasn't been answered within this time is treated as abandoned. */
export const PROMPT_TIMEOUT_MINUTES = 10;

export const STAGE_ORDER: OrderStage[] = ["received", "processing", "rejected", "completed"];

export const STAGE_META: Record<OrderStage, { label: string; hint: string }> = {
  received: { label: "Received", hint: "Waiting for the buyer's M-PESA PIN" },
  processing: { label: "Processing", hint: "Paid — buyer hasn't downloaded yet" },
  rejected: { label: "Rejected", hint: "Payment failed, cancelled or timed out" },
  completed: { label: "Completed", hint: "Paid and downloaded" },
};

export interface StageInput {
  status: string;
  created_at: string;
  downloaded_at: string | null;
}

export function promptCutoff(now: number = Date.now()): string {
  return new Date(now - PROMPT_TIMEOUT_MINUTES * 60_000).toISOString();
}

export function orderStage(order: StageInput, now: number = Date.now()): OrderStage {
  if (order.status === "paid") return order.downloaded_at ? "completed" : "processing";
  if (order.status === "pending") {
    const age = now - new Date(order.created_at).getTime();
    return age < PROMPT_TIMEOUT_MINUTES * 60_000 ? "received" : "rejected";
  }
  return "rejected";
}
