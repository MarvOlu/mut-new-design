// Daraja API calls. Server-only: reads M-PESA credentials from secrets.
import { friendlyResult, nairobiTimestamp, stkPassword } from "./mpesa";

// Safaricom's public sandbox test shortcode and passkey (published in the Daraja docs).
const SANDBOX_SHORTCODE = "174379";
const SANDBOX_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

function cleanEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .trim()
    .replace(/^["'](.*)["']$/, "$1")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function getMpesaConfig() {
  const isProduction = cleanEnv(process.env["MPESA_ENV"]) === "production";
  const config = {
    isProduction,
    baseUrl: isProduction ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke",
    consumerKey: cleanEnv(process.env["MPESA_CONSUMER_KEY"]),
    consumerSecret: cleanEnv(process.env["MPESA_CONSUMER_SECRET"]),
    shortcode:
      cleanEnv(process.env["MPESA_SHORTCODE"]) || (isProduction ? undefined : SANDBOX_SHORTCODE),
    passkey: cleanEnv(process.env["MPESA_PASSKEY"]) || (isProduction ? undefined : SANDBOX_PASSKEY),
    // "CustomerPayBillOnline" for Paybill, "CustomerBuyGoodsOnline" for Till numbers.
    transactionType: cleanEnv(process.env["MPESA_TRANSACTION_TYPE"]) || "CustomerPayBillOnline",
    // For Till numbers the money goes to the till, which can differ from the store shortcode.
    partyB: cleanEnv(process.env["MPESA_PARTY_B"]),
  };
  const missing = [
    !config.consumerKey && "MPESA_CONSUMER_KEY",
    !config.consumerSecret && "MPESA_CONSUMER_SECRET",
    !config.shortcode && "MPESA_SHORTCODE",
    !config.passkey && "MPESA_PASSKEY",
  ].filter(Boolean) as string[];
  return { config, missing };
}

interface DarajaResponse {
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  CheckoutRequestID?: string;
  MerchantRequestID?: string;
  ResultCode?: string | number;
  ResultDesc?: string;
  errorMessage?: string;
}

type Config = ReturnType<typeof getMpesaConfig>["config"];

// Daraja tokens last about an hour; reuse them so frequent status checks don't trip Safaricom's rate limits.
let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

async function getAccessToken(config: Config): Promise<string> {
  const cacheKey = `${config.baseUrl}|${config.consumerKey}`;
  if (cachedToken && cachedToken.key === cacheKey && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const credentials = btoa(`${config.consumerKey}:${config.consumerSecret}`);
  const res = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  const text = await res.text();
  let data: { access_token?: string; expires_in?: string | number; errorMessage?: string } = {};
  try {
    data = JSON.parse(text);
  } catch {
    // Daraja returns an empty body when the key/secret are wrong.
  }
  if (!res.ok || !data.access_token) {
    console.error("Daraja OAuth failed", res.status, text.slice(0, 300));
    throw new Error(
      "M-PESA rejected the app's login. Check the Consumer Key and Consumer Secret from your Daraja app.",
    );
  }
  const ttlSeconds = Number(data.expires_in) || 3599;
  cachedToken = {
    key: cacheKey,
    token: data.access_token,
    expiresAt: Date.now() + (ttlSeconds - 120) * 1000,
  };
  return data.access_token;
}

export interface StkPushResult {
  ok: boolean;
  message: string;
  checkoutRequestId?: string | undefined;
  merchantRequestId?: string | undefined;
}

export async function sendStkPush(
  config: Config,
  opts: {
    phone: string;
    amount: number;
    reference: string;
    description: string;
    callbackUrl: string;
  },
): Promise<StkPushResult> {
  const token = await getAccessToken(config);
  const timestamp = nairobiTimestamp();
  const payload = {
    BusinessShortCode: config.shortcode,
    Password: stkPassword(config.shortcode!, config.passkey!, timestamp),
    Timestamp: timestamp,
    TransactionType: config.transactionType,
    Amount: opts.amount,
    PartyA: opts.phone,
    PartyB: config.partyB || config.shortcode,
    PhoneNumber: opts.phone,
    CallBackURL: opts.callbackUrl,
    AccountReference: opts.reference.slice(0, 12),
    TransactionDesc: opts.description.slice(0, 13),
  };
  const res = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as DarajaResponse;
  if (!res.ok || String(data.ResponseCode) !== "0") {
    console.error("STK push rejected", res.status, data);
    return {
      ok: false,
      message:
        data.errorMessage || data.ResponseDescription || "M-PESA could not start the payment.",
    };
  }
  return {
    ok: true,
    message: data.CustomerMessage || "Check your phone to complete the payment.",
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
  };
}

export type StkQueryOutcome =
  | { state: "pending" }
  | { state: "paid"; resultDesc: string }
  | { state: "failed"; resultDesc: string };

/** Asks Daraja for the result directly — works even when the callback can't reach the app. */
export async function queryStkStatus(
  config: Config,
  checkoutRequestId: string,
): Promise<StkQueryOutcome> {
  const token = await getAccessToken(config);
  const timestamp = nairobiTimestamp();
  const res = await fetch(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config.shortcode!, config.passkey!, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  if (res.status === 401) cachedToken = null;
  const data = (await res.json().catch(() => ({}))) as DarajaResponse;
  // While the customer hasn't answered, Daraja replies with an error such as "transaction is being processed".
  if (data.ResultCode === undefined || String(data.ResultCode) === "4999")
    return { state: "pending" };
  if (String(data.ResultCode) === "0") return { state: "paid", resultDesc: data.ResultDesc ?? "" };
  return {
    state: "failed",
    resultDesc: friendlyResult(data.ResultCode, data.ResultDesc ?? "Payment was not completed."),
  };
}
