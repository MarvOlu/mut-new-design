import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import type { Category } from "./categories";
import {
  canDownload,
  DOWNLOAD_FORMATS,
  formatForFile,
  FORMAT_ORDER,
  type DownloadFormat,
} from "./downloads";
import { resolveSiteContent, type SiteContent } from "./site-content";
import { formatKenyanPhone, orderTotal } from "./mpesa";

export interface Design {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string | null;
  tag: string | null;
  image_key: string;
  images: string[];
  image_captions?: Record<string, string>;
  description: string | null;
}

function hasPublicSupabase() {
  return Boolean(
    process.env["SUPABASE_URL"] &&
    process.env["SUPABASE_PUBLISHABLE_KEY"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"],
  );
}

function publicClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

async function admin() {
  const { isSupabaseAdminConfigured, supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  return isSupabaseAdminConfigured() ? supabaseAdmin : null;
}

function callbackUrl(): string {
  const token = process.env["PAYMENT_CALLBACK_TOKEN"] ?? "";
  const candidates = [process.env["SITE_URL"], new URL(getRequest().url).origin];
  const origin = candidates
    .map((o) => o?.replace(/\/+$/, ""))
    .find((o) => !!o && o.startsWith("https://") && !o.includes("--"));
  if (!origin) {
    const projectId = process.env["SUPABASE_PROJECT_ID"];
    if (projectId) return `https://${projectId}.supabase.co/functions/v1/payments-callback`;
    return `${new URL(getRequest().url).origin}/api/public/payments/callback?token=${encodeURIComponent(token)}`;
  }
  return `${origin}/api/public/payments/callback?token=${encodeURIComponent(token)}`;
}

async function listFormats(
  designId: string,
): Promise<{ format: DownloadFormat; path: string; fileName: string }[]> {
  const db = await admin();
  if (!db) {
    const store = await import("./local-store.server");
    return store.listAvailableFormats(designId).map((format) => ({
      format,
      path: `${designId}/${designId}.${format}`,
      fileName: `${designId}.${format}`,
    }));
  }
  const { data, error } = await db.storage.from("designs").list(designId, { limit: 100 });
  if (error) {
    console.error("Could not list design files", designId, error.message);
    return [];
  }
  const files = new Map<
    DownloadFormat,
    { format: DownloadFormat; path: string; fileName: string }
  >();
  for (const f of data ?? []) {
    const format = formatForFile(f.name);
    if (format && !files.has(format))
      files.set(format, { format, path: `${designId}/${f.name}`, fileName: f.name });
  }
  return FORMAT_ORDER.flatMap((fmt) => (files.has(fmt) ? [files.get(fmt)!] : []));
}

async function readSupabaseImageCaptions(): Promise<Record<string, Record<string, string>>> {
  try {
    const { data } = await publicClient()
      .from("site_settings")
      .select("content")
      .eq("id", 1)
      .maybeSingle();
    const raw =
      data?.content && typeof data.content === "object" && !Array.isArray(data.content)
        ? (data.content as Record<string, unknown>)["_image_captions"]
        : null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as Record<string, Record<string, string>>;
  } catch {
    return {};
  }
}

export const listDesigns = createServerFn({ method: "GET" }).handler(
  async (): Promise<Design[]> => {
    if (!hasPublicSupabase()) {
      const store = await import("./local-store.server");
      return store.listActiveDesigns();
    }
    const [{ data, error }, captionsMap] = await Promise.all([
      publicClient()
        .from("designs")
        .select("id, name, category, price, unit, tag, image_key, images, description")
        .eq("is_active", true)
        .order("sort_order"),
      readSupabaseImageCaptions(),
    ]);
    if (error) throw new Error("Could not load designs.");
    return (data ?? []).map((d) => ({
      ...d,
      image_captions: captionsMap[d.id] ?? {},
    }));
  },
);

export const listCategories = createServerFn({ method: "GET" }).handler(
  async (): Promise<Category[]> => {
    if (!hasPublicSupabase()) {
      const store = await import("./local-store.server");
      return store.listCategories();
    }
    const { data, error } = await publicClient()
      .from("categories")
      .select("name, emoji, sort_order")
      .order("sort_order");
    if (error) {
      console.error("Could not load categories", error.message);
      return [];
    }
    return data ?? [];
  },
);

export const getSiteContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteContent> => {
    try {
      if (!hasPublicSupabase()) {
        const store = await import("./local-store.server");
        return store.getSiteContentState().content;
      }
      const { data } = await publicClient()
        .from("site_settings")
        .select("content")
        .eq("id", 1)
        .maybeSingle();
      return resolveSiteContent(data?.content);
    } catch (e) {
      console.error("Could not load site content", e);
      return resolveSiteContent(null);
    }
  },
);

export const getDesignDetail = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ designId: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data }): Promise<{ design: Design; formats: DownloadFormat[] } | null> => {
    if (!hasPublicSupabase()) {
      const store = await import("./local-store.server");
      const design = store.getActiveDesign(data.designId);
      if (!design) return null;
      return { design, formats: store.listAvailableFormats(design.id) };
    }
    const [{ data: design, error }, captionsMap] = await Promise.all([
      publicClient()
        .from("designs")
        .select("id, name, category, price, unit, tag, image_key, images, description")
        .eq("id", data.designId)
        .eq("is_active", true)
        .maybeSingle(),
      readSupabaseImageCaptions(),
    ]);
    if (error) throw new Error("Could not load this design.");
    if (!design) return null;
    const formats = (await listFormats(design.id)).map((f) => f.format);
    return {
      design: {
        ...design,
        image_captions: captionsMap[design.id] ?? {},
      },
      formats,
    };
  });

export const startCheckout = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().min(9).max(16),
        designIds: z.array(z.string().min(1).max(80)).min(1).max(30),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const phone = formatKenyanPhone(data.phone);
    if (!phone)
      return { ok: false as const, message: "Enter a valid Kenyan phone number, e.g. 0712345678." };

    const { getMpesaConfig, sendStkPush } = await import("./mpesa.server");
    const { config, missing } = getMpesaConfig();
    if (missing.length) {
      console.error("Missing M-PESA settings:", missing.join(", "));
      return {
        ok: false as const,
        message: "M-PESA payments are not set up yet. Please try again later.",
      };
    }

    const db = await admin();
    const ids = [...new Set(data.designIds)];

    if (!db) {
      const store = await import("./local-store.server");
      const active = store.listActiveDesigns().filter((d) => ids.includes(d.id));
      if (active.length !== ids.length) {
        return {
          ok: false as const,
          message: "Some designs in your basket are no longer available.",
        };
      }
      const amount = orderTotal(active.map((d) => d.price));
      const order = store.createOrder({ phone, amount, designIds: ids });
      try {
        const result = await sendStkPush(config, {
          phone,
          amount,
          reference: "MTK" + order.id.replace(/-/g, "").slice(0, 9).toUpperCase(),
          description: "Mutken Design",
          callbackUrl: callbackUrl(),
        });
        if (!result.ok) {
          store.updateOrder(order.id, { status: "failed", result_desc: result.message });
          return { ok: false as const, message: result.message };
        }
        store.updateOrder(order.id, {
          checkout_request_id: result.checkoutRequestId ?? null,
          merchant_request_id: result.merchantRequestId ?? null,
        });
        return { ok: true as const, orderId: order.id, amount, message: result.message };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not reach M-PESA.";
        store.updateOrder(order.id, { status: "failed", result_desc: message });
        return { ok: false as const, message };
      }
    }

    const { data: designs, error } = await db
      .from("designs")
      .select("id, price")
      .in("id", ids)
      .eq("is_active", true);
    if (error || !designs || designs.length !== ids.length) {
      return {
        ok: false as const,
        message: "Some designs in your basket are no longer available.",
      };
    }
    const amount = orderTotal(designs.map((d) => d.price));

    const { data: order, error: orderError } = await db
      .from("orders")
      .insert({ phone, amount, design_ids: ids })
      .select("id")
      .single();
    if (orderError || !order)
      return { ok: false as const, message: "Could not create your order." };

    try {
      const result = await sendStkPush(config, {
        phone,
        amount,
        reference: "MTK" + order.id.replace(/-/g, "").slice(0, 9).toUpperCase(),
        description: "Mutken Design",
        callbackUrl: callbackUrl(),
      });
      if (!result.ok) {
        await db
          .from("orders")
          .update({ status: "failed", result_desc: result.message })
          .eq("id", order.id);
        return { ok: false as const, message: result.message };
      }
      await db
        .from("orders")
        .update({
          checkout_request_id: result.checkoutRequestId ?? null,
          merchant_request_id: result.merchantRequestId ?? null,
        })
        .eq("id", order.id);
      return { ok: true as const, orderId: order.id, amount, message: result.message };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not reach M-PESA.";
      await db.from("orders").update({ status: "failed", result_desc: message }).eq("id", order.id);
      return { ok: false as const, message };
    }
  });

export const getOrderStatus = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    if (!db) {
      const store = await import("./local-store.server");
      const order = store.getOrder(data.orderId);
      if (!order) return { found: false as const };
      let status = order.status;
      let resultDesc = order.result_desc;

      if (order.status === "pending" && order.checkout_request_id) {
        const ageMs = Date.now() - new Date(order.created_at).getTime();
        const sinceQueryMs = order.last_query_at
          ? Date.now() - new Date(order.last_query_at).getTime()
          : Infinity;
        if (ageMs >= 10_000 && sinceQueryMs >= 15_000) {
          const { getMpesaConfig, queryStkStatus } = await import("./mpesa.server");
          const { config, missing } = getMpesaConfig();
          if (!missing.length) {
            store.updateOrder(order.id, { last_query_at: new Date().toISOString() });
            try {
              const outcome = await queryStkStatus(config, order.checkout_request_id);
              if (outcome.state !== "pending") {
                store.updateOrder(order.id, {
                  status: outcome.state,
                  result_desc: outcome.resultDesc,
                  ...(outcome.state === "paid" ? { paid_at: new Date().toISOString() } : {}),
                });
                status = outcome.state;
                resultDesc = outcome.resultDesc;
              }
            } catch (e) {
              console.error("STK status query failed", e);
            }
          }
        }
      }

      const items = store
        .listAllDesigns()
        .filter((d) => order.design_ids.includes(d.id))
        .map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          image_key: d.image_key,
          formats: status === "paid" ? store.listAvailableFormats(d.id) : [],
        }));

      return {
        found: true as const,
        status,
        amount: order.amount,
        receipt: status === "paid" ? order.mpesa_receipt : null,
        message: status === "failed" ? resultDesc : null,
        items,
      };
    }

    const { data: order } = await db
      .from("orders")
      .select(
        "id, status, amount, design_ids, checkout_request_id, mpesa_receipt, result_desc, created_at, last_query_at",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) return { found: false as const };

    let status = order.status;
    let resultDesc = order.result_desc;

    const { syncPendingOrder } = await import("./order-sync.server");
    const synced = await syncPendingOrder(db, order);
    if (synced) {
      status = synced.status;
      resultDesc = synced.resultDesc;
    }

    const { data: designs } = await db
      .from("designs")
      .select("id, name, category, image_key")
      .in("id", order.design_ids);

    const items = await Promise.all(
      (designs ?? []).map(async (d) => ({
        ...d,
        formats: status === "paid" ? (await listFormats(d.id)).map((f) => f.format) : [],
      })),
    );

    return {
      found: true as const,
      status,
      amount: order.amount,
      receipt: status === "paid" ? order.mpesa_receipt : null,
      message: status === "failed" ? resultDesc : null,
      items,
    };
  });

export const getDownloadLink = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        orderId: z.string().uuid(),
        designId: z.string().min(1).max(80),
        format: z.enum(["pdf", "dwg", "dxf", "png", "jpg"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    if (!db) {
      const store = await import("./local-store.server");
      const order = store.getOrder(data.orderId);
      if (!canDownload(order, data.designId)) {
        return {
          ok: false as const,
          message: "This design is unlocked only after a successful M-PESA payment.",
        };
      }
      const available = store.listAvailableFormats(data.designId);
      if (!available.includes(data.format)) {
        return { ok: false as const, message: "That format isn't available for this design yet." };
      }
      const design = store.getDesignById(data.designId);
      const downloadName = `${(design?.name ?? data.designId).replace(/[^\w\- ]+/g, "")}.${data.format}`;
      store.recordOrderDownload(data.orderId, data.designId, data.format);
      const url = `/api/public/downloads?orderId=${encodeURIComponent(data.orderId)}&designId=${encodeURIComponent(data.designId)}&format=${encodeURIComponent(data.format)}`;
      return { ok: true as const, url, fileName: downloadName };
    }

    const { data: order } = await db
      .from("orders")
      .select("status, design_ids, downloaded_at")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!canDownload(order, data.designId)) {
      return {
        ok: false as const,
        message: "This design is unlocked only after a successful M-PESA payment.",
      };
    }
    const file = (await listFormats(data.designId)).find((f) => f.format === data.format);
    if (!file)
      return { ok: false as const, message: "That format isn't available for this design yet." };

    const { data: design } = await db
      .from("designs")
      .select("name")
      .eq("id", data.designId)
      .maybeSingle();
    const ext = file.fileName.split(".").pop();
    const downloadName = `${(design?.name ?? data.designId).replace(/[^\w\- ]+/g, "")}.${ext}`;
    const { data: signed, error } = await db.storage
      .from("designs")
      .createSignedUrl(file.path, 120, { download: downloadName });
    if (error || !signed) return { ok: false as const, message: "Could not prepare the download." };

    if (!order!.downloaded_at) {
      await db
        .from("orders")
        .update({ downloaded_at: new Date().toISOString() })
        .eq("id", data.orderId);
    }
    await db.from("order_events").insert({
      order_id: data.orderId,
      kind: "download",
      message: `Downloaded ${DOWNLOAD_FORMATS[data.format].label} · ${design?.name ?? data.designId}`,
      detail: { design_id: data.designId, format: data.format },
    });
    return { ok: true as const, url: signed.signedUrl, fileName: downloadName };
  });

export const getBackendMode = createServerFn({ method: "GET" }).handler(async () => {
  const fullSupabaseReady = hasPublicSupabase();
  let googleOAuthEnabled = false;
  if (fullSupabaseReady && process.env["SUPABASE_URL"]) {
    try {
      const res = await fetch(
        `${process.env["SUPABASE_URL"].replace(/\/+$/, "")}/auth/v1/authorize?provider=google`,
        {
          redirect: "manual",
          signal: AbortSignal.timeout(1500),
        },
      );
      googleOAuthEnabled = res.status >= 300 && res.status < 400;
    } catch {
      googleOAuthEnabled = false;
    }
  }
  return {
    mode: fullSupabaseReady ? ("supabase" as const) : ("local" as const),
    googleOAuthEnabled,
  };
});
