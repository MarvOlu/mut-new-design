// Pure M-PESA (Daraja) helpers. Safe for browser and server; no secrets here.

/** Converts 07xx / 01xx / +254 / 254 numbers to the 2547XXXXXXXX form Daraja expects. */
export function formatKenyanPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const phone = String(input).trim().replace(/[\s-]/g, "");
  if (/^0[17]\d{8}$/.test(phone)) return "254" + phone.slice(1);
  if (/^\+254[17]\d{8}$/.test(phone)) return phone.slice(1);
  if (/^254[17]\d{8}$/.test(phone)) return phone;
  if (/^[17]\d{8}$/.test(phone)) return "254" + phone;
  return null;
}

/** Daraja timestamp (YYYYMMDDHHmmss) in Kenyan time (UTC+3), regardless of server timezone. */
export function nairobiTimestamp(date: Date = new Date()): string {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    eat.getUTCFullYear() +
    p(eat.getUTCMonth() + 1) +
    p(eat.getUTCDate()) +
    p(eat.getUTCHours()) +
    p(eat.getUTCMinutes()) +
    p(eat.getUTCSeconds())
  );
}

/** STK password = base64(shortcode + passkey + timestamp). */
export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(shortcode + passkey + timestamp);
}

export interface ParsedStkCallback {
  checkoutRequestId: string;
  merchantRequestId?: string | undefined;
  resultCode: number;
  resultDesc: string;
  amount?: number | undefined;
  receipt?: string | undefined;
  phone?: string | undefined;
}

interface StkCallbackBody {
  MerchantRequestID?: unknown;
  CheckoutRequestID?: unknown;
  ResultCode?: unknown;
  ResultDesc?: unknown;
  CallbackMetadata?: { Item?: { Name: string; Value?: unknown }[] };
}

/** Reads Safaricom's STK callback body. Returns null if it is not a valid callback. */
export function parseStkCallback(body: unknown): ParsedStkCallback | null {
  const cb = (body as { Body?: { stkCallback?: StkCallbackBody } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string") return null;
  const items = cb.CallbackMetadata?.Item ?? [];
  const get = (name: string) => items.find((i) => i.Name === name)?.Value;
  const amount = get("Amount");
  const receipt = get("MpesaReceiptNumber");
  const phone = get("PhoneNumber");
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: typeof cb.MerchantRequestID === "string" ? cb.MerchantRequestID : undefined,
    resultCode: Number(cb.ResultCode),
    resultDesc: String(cb.ResultDesc ?? ""),
    amount: amount === undefined ? undefined : Number(amount),
    receipt: receipt === undefined ? undefined : String(receipt),
    phone: phone === undefined ? undefined : String(phone),
  };
}

/** Total in whole shillings for the selected designs (server always recomputes from the database). */
export function orderTotal(prices: number[]): number {
  return prices.reduce((sum, p) => sum + Math.round(p), 0);
}

/** Plain-language reason for a failed STK payment, keyed by Safaricom's result code. */
export function friendlyResult(code: number | string, fallback: string): string {
  const messages: Record<string, string> = {
    "1": "Your M-PESA balance was not enough for this payment.",
    "1032": "The payment was cancelled on the phone.",
    "1037": "The phone could not be reached, or the prompt timed out.",
    "2001": "The M-PESA PIN entered was wrong.",
  };
  return messages[String(code)] ?? fallback;
}
