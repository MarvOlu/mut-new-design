import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { isOwnerEmail, OWNER_EMAILS } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Category } from "./categories";
import { formatForFile, type DownloadFormat } from "./downloads";
import type { RoleMember, StoredImageMeta, UserRole } from "./local-store.server";
import { orderStage, promptCutoff, STAGE_ORDER, type OrderStage } from "./order-stages";
import { resolveSiteContent, SECTION_IDS } from "./site-content";

export type { RoleMember, StoredImageMeta, UserRole };

type EventDetail = Record<string, Json>;

type AuthContext = {
  isLocalMode: boolean;
  supabase: unknown;
  userId: string;
  claims?: Record<string, unknown>;
};

function claimEmail(context: AuthContext): string | null {
  return typeof context.claims?.["email"] === "string"
    ? context.claims["email"].trim().toLowerCase()
    : null;
}

async function readSupabaseSettingsRaw(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
) {
  const { data } = await supabaseAdmin
    .from("site_settings")
    .select("content, updated_at")
    .eq("id", 1)
    .maybeSingle();
  const raw =
    data?.content && typeof data.content === "object" && !Array.isArray(data.content)
      ? { ...(data.content as Record<string, unknown>) }
      : {};
  return { raw, updatedAt: data?.updated_at ?? null };
}

async function writeSupabaseSettingsRaw(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  nextRaw: Record<string, unknown>,
) {
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .upsert({ id: 1, content: nextRaw as unknown as Record<string, never> })
    .select("content, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function getPrivateMap<T>(raw: Record<string, unknown>, key: string): Record<string, T> {
  const val = raw[key];
  if (!val || typeof val !== "object" || Array.isArray(val)) return {};
  return { ...(val as Record<string, T>) };
}

async function resolveCallerRole(
  context: AuthContext,
): Promise<{ role: UserRole; email: string | null }> {
  const email = claimEmail(context);
  if (context.isLocalMode) {
    const store = await import("./local-store.server");
    return { role: store.getRoleForEmail(email), email };
  }
  if (isOwnerEmail(email)) return { role: "admin", email };

  const sb = context.supabase as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
  const { data: hasAdminRpc } = await sb.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (hasAdminRpc) return { role: "admin", email };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (email) {
    const { data: adminRow } = await supabaseAdmin
      .from("admin_emails")
      .select("email")
      .ilike("email", email)
      .maybeSingle();
    if (adminRow) return { role: "admin", email };

    const { raw } = await readSupabaseSettingsRaw(supabaseAdmin);
    const rbac = getPrivateMap<{ role: UserRole }>(raw, "_rbac_roles");
    if (rbac[email]?.role === "admin") return { role: "admin", email };
  }
  return { role: "user", email };
}

async function isAdminCaller(context: AuthContext): Promise<boolean> {
  const { role } = await resolveCallerRole(context);
  return role === "admin";
}

export const adminGetDashboardSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        filter: z
          .enum(["all", "successful", "received", "processing", "rejected", "completed"])
          .default("all"),
        search: z.string().max(80).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { role } = await resolveCallerRole(context);
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return {
        role,
        counts: store.getOrderCounts(),
        revenueSummary: store.getPaidRevenueSummary(),
        orders: store.listFilteredOrders(data.filter, data.search),
        recentEvents: store.listRecentOrderEvents(30),
        activeSessions: store.listActiveSessions(),
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: allOrders, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, phone, amount, design_ids, status, mpesa_receipt, result_desc, created_at, paid_at, downloaded_at, checkout_request_id",
      )
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) throw new Error(error.message);

    const rows = allOrders ?? [];
    const now = Date.now();
    const counts: Record<OrderStage, number> = {
      received: 0,
      processing: 0,
      rejected: 0,
      completed: 0,
    };
    let paidCount = 0;
    let totalRevenue = 0;
    for (const o of rows) {
      counts[orderStage(o, now)] += 1;
      if (o.status === "paid") {
        paidCount += 1;
        totalRevenue += o.amount;
      }
    }

    const term = data.search
      .trim()
      .toLowerCase()
      .replace(/[^\w+]/g, "");
    const orders = rows.filter((o) => {
      if (data.filter === "successful") {
        if (o.status !== "paid") return false;
      } else if (data.filter !== "all") {
        if (orderStage(o, now) !== data.filter) return false;
      }
      if (!term) return true;
      const localPhone = o.phone.startsWith("254") ? "0" + o.phone.slice(3) : o.phone;
      const receipt = (o.mpesa_receipt ?? "").toLowerCase();
      const ref = ("MTK" + o.id.replace(/-/g, "").slice(0, 9)).toLowerCase();
      return (
        o.phone.includes(term) ||
        localPhone.includes(term) ||
        receipt.includes(term) ||
        ref.includes(term)
      );
    });

    const { data: events } = await supabaseAdmin
      .from("order_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);

    const store = await import("./local-store.server");
    return {
      role,
      counts,
      revenueSummary: { paidCount, totalRevenue },
      orders: orders.slice(0, 100),
      recentEvents: (events ?? []).map((e) => ({
        ...e,
        detail: (e.detail && typeof e.detail === "object" && !Array.isArray(e.detail)
          ? e.detail
          : {}) as EventDetail,
      })),
      activeSessions: store.listActiveSessions(),
    };
  });

export const adminGetOrderDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await resolveCallerRole(context);
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.getAdminOrderDetail(data.orderId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, phone, amount, design_ids, status, mpesa_receipt, result_desc, created_at, paid_at, downloaded_at, checkout_request_id",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) return null;

    const [{ data: designs }, { data: events }] = await Promise.all([
      supabaseAdmin
        .from("designs")
        .select("id, name, category, price, images, image_key")
        .in("id", order.design_ids),
      supabaseAdmin
        .from("order_events")
        .select("*")
        .eq("order_id", data.orderId)
        .order("created_at", { ascending: true }),
    ]);

    return {
      order,
      designs: designs ?? [],
      events: (events ?? []).map((e) => ({
        ...e,
        detail: (e.detail && typeof e.detail === "object" && !Array.isArray(e.detail)
          ? e.detail
          : {}) as EventDetail,
      })),
    };
  });

export const adminCheckPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return {
        ok: false as const,
        message: "Only authenticated admins can check or update orders.",
      };

    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const order = store.getOrder(data.orderId);
      if (!order) return { ok: false as const, message: "Order not found." };
      if (order.status !== "pending")
        return { ok: true as const, status: order.status, changed: false };
      if (!order.checkout_request_id) {
        return {
          ok: false as const,
          message: "No M-PESA prompt was sent for this order, so there is nothing to check.",
        };
      }
      const { getMpesaConfig, queryStkStatus } = await import("./mpesa.server");
      const { config, missing } = getMpesaConfig();
      if (missing.length) {
        return {
          ok: false as const,
          message: "M-PESA Daraja credentials are not configured in this environment.",
        };
      }
      store.updateOrder(order.id, { last_query_at: new Date().toISOString() });
      const outcome = await queryStkStatus(config, order.checkout_request_id);
      if (outcome.state !== "pending") {
        store.updateOrder(order.id, {
          status: outcome.state,
          result_desc: outcome.resultDesc,
          ...(outcome.state === "paid" ? { paid_at: new Date().toISOString() } : {}),
        });
        return { ok: true as const, status: outcome.state, changed: true };
      }
      return { ok: true as const, status: "pending", changed: false };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, status, checkout_request_id, created_at, last_query_at")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) return { ok: false as const, message: "Order not found." };
    if (order.status !== "pending")
      return { ok: true as const, status: order.status, changed: false };
    if (!order.checkout_request_id) {
      return {
        ok: false as const,
        message: "No M-PESA prompt was sent for this order, so there is nothing to check.",
      };
    }

    const { syncPendingOrder } = await import("./order-sync.server");
    const synced = await syncPendingOrder(supabaseAdmin, order, { minAgeMs: 0, minGapMs: 5_000 });
    return { ok: true as const, status: synced?.status ?? "pending", changed: !!synced };
  });

export const adminUpdateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        orderId: z.string().uuid(),
        status: z.enum(["paid", "failed"]),
        receipt: z.string().max(40).optional(),
        reason: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can update orders." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const updated = store.updateOrder(data.orderId, {
        status: data.status,
        ...(data.status === "paid"
          ? {
              paid_at: new Date().toISOString(),
              mpesa_receipt:
                data.receipt?.trim() ||
                "MTK" + Math.random().toString(36).slice(2, 9).toUpperCase(),
              result_desc: "Confirmed by shop admin.",
            }
          : {
              result_desc: data.reason?.trim() || "Marked as failed by shop admin.",
            }),
      });
      if (!updated) return { ok: false as const, message: "Order not found." };
      return { ok: true as const, order: updated };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("orders")
      .update(
        data.status === "paid"
          ? {
              status: "paid",
              paid_at: new Date().toISOString(),
              mpesa_receipt: data.receipt?.trim() || null,
              result_desc: "Confirmed by shop admin.",
            }
          : {
              status: "failed",
              result_desc: data.reason?.trim() || "Marked as failed by shop admin.",
            },
      )
      .eq("id", data.orderId)
      .select("*")
      .single();
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, order: updated };
  });

export const adminListDesigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await resolveCallerRole(context);
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.listAllDesigns().map((d) => ({
        ...d,
        formats: store.listAvailableFormats(d.id),
      }));
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data, error }, { raw }] = await Promise.all([
      supabaseAdmin
        .from("designs")
        .select(
          "id, name, category, price, unit, tag, description, images, image_key, is_active, sort_order",
        )
        .order("sort_order")
        .order("created_at"),
      readSupabaseSettingsRaw(supabaseAdmin),
    ]);
    if (error) throw new Error(error.message);
    const captionsMap = getPrivateMap<Record<string, string>>(raw, "_image_captions");
    return (data ?? []).map((d) => ({
      ...d,
      image_captions: captionsMap[d.id] ?? ({} as Record<string, string>),
      formats: [] as DownloadFormat[],
    }));
  });

export const adminSaveDesign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().max(80).optional(),
        name: z.string().min(1).max(120),
        category: z.string().min(1).max(80),
        price: z.number().int().positive(),
        unit: z.string().max(60).nullable().optional(),
        tag: z.string().max(40).nullable().optional(),
        description: z.string().max(2000).nullable().optional(),
        images: z.array(z.string().min(1).max(500)).default([]),
        image_captions: z.record(z.string(), z.string().max(500)).optional(),
        image_key: z.string().max(500).optional(),
        is_active: z.boolean().default(true),
        sort_order: z.number().int().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can edit designs." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const saved = store.saveDesign(data);
      return { ok: true as const, design: saved };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cleanId =
      data.id?.trim() ||
      data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const payload = {
      id: cleanId,
      name: data.name.trim(),
      category: data.category.trim(),
      price: data.price,
      unit: data.unit?.trim() || null,
      tag: data.tag?.trim() || null,
      description: data.description?.trim() || null,
      images: data.images,
      image_key: data.image_key?.trim() || data.images[0] || "residential",
      is_active: data.is_active,
      ...(typeof data.sort_order === "number" ? { sort_order: data.sort_order } : {}),
    };
    const { data: saved, error } = await supabaseAdmin
      .from("designs")
      .upsert(payload)
      .select("*")
      .single();
    if (error) return { ok: false as const, message: error.message };

    const cleanCaptions: Record<string, string> = {};
    if (data.image_captions) {
      for (const [k, v] of Object.entries(data.image_captions)) {
        if (v.trim()) cleanCaptions[k] = v.trim();
      }
    }
    const { raw } = await readSupabaseSettingsRaw(supabaseAdmin);
    const captionsMap = getPrivateMap<Record<string, string>>(raw, "_image_captions");
    captionsMap[cleanId] = cleanCaptions;
    const mediaMap = getPrivateMap<StoredImageMeta>(raw, "_media");
    for (const imgKey of data.images) {
      const m = mediaMap[imgKey];
      if (m) {
        m.designId = cleanId;
        if (cleanCaptions[imgKey]) m.description = cleanCaptions[imgKey];
        m.updatedAt = new Date().toISOString();
      }
    }
    raw["_image_captions"] = captionsMap;
    raw["_media"] = mediaMap;
    await writeSupabaseSettingsRaw(supabaseAdmin, raw);

    return { ok: true as const, design: { ...saved, image_captions: cleanCaptions } };
  });

export const adminReorderDesigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ orderedIds: z.array(z.string().min(1).max(80)).min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can reorder designs." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      store.reorderDesigns(data.orderedIds);
      return { ok: true as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await Promise.all(
      data.orderedIds.map((id, i) =>
        supabaseAdmin
          .from("designs")
          .update({ sort_order: i + 1 })
          .eq("id", id),
      ),
    );
    return { ok: true as const };
  });

export const adminDeleteDesign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ designId: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can delete designs." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.deleteDesign(data.designId);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("designs").delete().eq("id", data.designId);
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const };
  });

export const adminUploadImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fileName: z.string().min(1).max(160),
        contentType: z.string().min(1).max(80),
        base64: z.string().min(1).max(12_000_000),
        width: z.number().int().positive().nullable().optional(),
        height: z.number().int().positive().nullable().optional(),
        originalSizeBytes: z.number().int().nonnegative().nullable().optional(),
        optimized: z.boolean().optional(),
        watermarkText: z.string().max(120).nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        designId: z.string().max(80).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can upload images." };
    const cleanBase64 = data.base64.includes(",") ? data.base64.split(",")[1]! : data.base64;
    const bytes = Uint8Array.from(Buffer.from(cleanBase64, "base64"));

    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const { storagePath, meta } = store.saveUploadedImage(data.fileName, bytes, {
        contentType: data.contentType,
        width: data.width,
        height: data.height,
        originalSizeBytes: data.originalSizeBytes,
        optimized: data.optimized,
        watermarkText: data.watermarkText,
        description: data.description,
        designId: data.designId,
      });
      return { ok: true as const, key: `upload:${storagePath}`, meta };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ext = data.fileName.split(".").pop()?.toLowerCase() || "webp";
    const storagePath = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabaseAdmin.storage.from("design-images").upload(storagePath, bytes, {
      contentType: data.contentType,
      upsert: false,
    });
    if (error) return { ok: false as const, message: error.message };

    const key = `upload:${storagePath}`;
    const now = new Date().toISOString();
    const meta: StoredImageMeta = {
      key,
      storagePath,
      fileName: data.fileName,
      contentType: data.contentType,
      width: data.width ?? null,
      height: data.height ?? null,
      sizeBytes: bytes.byteLength,
      originalSizeBytes: data.originalSizeBytes ?? bytes.byteLength,
      optimized: Boolean(data.optimized),
      watermarkText: data.watermarkText?.trim() || null,
      description: data.description?.trim() || null,
      designId: data.designId?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };

    const { raw } = await readSupabaseSettingsRaw(supabaseAdmin);
    const mediaMap = getPrivateMap<StoredImageMeta>(raw, "_media");
    mediaMap[key] = meta;
    raw["_media"] = mediaMap;
    if (meta.designId && meta.description) {
      const captionsMap = getPrivateMap<Record<string, string>>(raw, "_image_captions");
      captionsMap[meta.designId] = {
        ...(captionsMap[meta.designId] ?? {}),
        [key]: meta.description,
      };
      raw["_image_captions"] = captionsMap;
    }
    await writeSupabaseSettingsRaw(supabaseAdmin, raw);

    return { ok: true as const, key, meta };
  });

export const adminListMedia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoredImageMeta[]> => {
    await resolveCallerRole(context);
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.listImageMetadata();
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ raw }, { data: storageFiles }, { data: designs }] = await Promise.all([
      readSupabaseSettingsRaw(supabaseAdmin),
      supabaseAdmin.storage.from("design-images").list("uploads", { limit: 200 }),
      supabaseAdmin.from("designs").select("id, images, image_key"),
    ]);

    const mediaMap = getPrivateMap<StoredImageMeta>(raw, "_media");
    const captionsMap = getPrivateMap<Record<string, string>>(raw, "_image_captions");
    const out = new Map<string, StoredImageMeta>();

    for (const [k, v] of Object.entries(mediaMap)) {
      out.set(k, v);
    }

    for (const f of storageFiles ?? []) {
      if (!f.name || f.name.startsWith(".")) continue;
      const storagePath = `uploads/${f.name}`;
      const key = `upload:${storagePath}`;
      if (!out.has(key)) {
        const metaObj = (f.metadata ?? {}) as { size?: number; mimetype?: string };
        out.set(key, {
          key,
          storagePath,
          fileName: f.name,
          contentType: metaObj.mimetype ?? "image/jpeg",
          width: null,
          height: null,
          sizeBytes: metaObj.size ?? 0,
          originalSizeBytes: null,
          optimized: false,
          watermarkText: null,
          description: null,
          designId: null,
          createdAt: f.created_at ?? new Date().toISOString(),
          updatedAt: f.updated_at ?? f.created_at ?? new Date().toISOString(),
        });
      }
    }

    // Backfill design association and description if used by any design
    for (const d of designs ?? []) {
      const keys = d.images?.length ? d.images : [d.image_key];
      for (const k of keys) {
        const rec = out.get(k);
        if (rec) {
          if (!rec.designId) rec.designId = d.id;
          if (!rec.description && captionsMap[d.id]?.[k]) {
            rec.description = captionsMap[d.id]![k]!;
          }
        }
      }
    }

    return [...out.values()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  });

export const adminUpdateImageMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        key: z.string().min(1).max(500),
        description: z.string().max(500).nullable().optional(),
        designId: z.string().max(80).nullable().optional(),
        watermarkText: z.string().max(120).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can edit image metadata." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const updated = store.updateImageMetadata(data.key, data);
      if (data.designId && data.description !== undefined) {
        const design = store.getDesignById(data.designId);
        if (design) {
          const captions = { ...design.image_captions };
          if (data.description?.trim()) captions[data.key] = data.description.trim();
          else delete captions[data.key];
          store.saveDesign({ ...design, image_captions: captions });
        }
      }
      return { ok: true as const, meta: updated };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { raw } = await readSupabaseSettingsRaw(supabaseAdmin);
    const mediaMap = getPrivateMap<StoredImageMeta>(raw, "_media");
    const existing = mediaMap[data.key] ?? {
      key: data.key,
      storagePath: data.key.startsWith("upload:") ? data.key.slice("upload:".length) : data.key,
      fileName: data.key.split("/").pop() ?? data.key,
      contentType: "image/webp",
      width: null,
      height: null,
      sizeBytes: 0,
      originalSizeBytes: null,
      optimized: false,
      watermarkText: null,
      description: null,
      designId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (data.description !== undefined) existing.description = data.description?.trim() || null;
    if (data.designId !== undefined) existing.designId = data.designId?.trim() || null;
    if (data.watermarkText !== undefined)
      existing.watermarkText = data.watermarkText?.trim() || null;
    existing.updatedAt = new Date().toISOString();
    mediaMap[data.key] = existing;
    raw["_media"] = mediaMap;

    const targetDesignId = existing.designId;
    if (targetDesignId && data.description !== undefined) {
      const captionsMap = getPrivateMap<Record<string, string>>(raw, "_image_captions");
      const nextCaps = { ...(captionsMap[targetDesignId] ?? {}) };
      if (data.description?.trim()) nextCaps[data.key] = data.description.trim();
      else delete nextCaps[data.key];
      captionsMap[targetDesignId] = nextCaps;
      raw["_image_captions"] = captionsMap;
    }
    await writeSupabaseSettingsRaw(supabaseAdmin, raw);
    return { ok: true as const, meta: existing };
  });

export const adminDeleteImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ key: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can delete images." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const res = store.deleteUploadedImage(data.key);
      return { ok: true as const, ...res };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = data.key.trim();
    let removedStorage = false;
    if (key.startsWith("upload:")) {
      const storagePath = key.slice("upload:".length);
      const { error } = await supabaseAdmin.storage.from("design-images").remove([storagePath]);
      if (!error) removedStorage = true;
    }

    const [{ raw }, { data: designs }] = await Promise.all([
      readSupabaseSettingsRaw(supabaseAdmin),
      supabaseAdmin.from("designs").select("id, images, image_key"),
    ]);

    const mediaMap = getPrivateMap<StoredImageMeta>(raw, "_media");
    delete mediaMap[key];
    raw["_media"] = mediaMap;

    const captionsMap = getPrivateMap<Record<string, string>>(raw, "_image_captions");
    for (const dId of Object.keys(captionsMap)) {
      if (captionsMap[dId]?.[key]) {
        delete captionsMap[dId]![key];
      }
    }
    raw["_image_captions"] = captionsMap;
    if (raw["heroImage"] === key) {
      raw["heroImage"] = null;
    }
    await writeSupabaseSettingsRaw(supabaseAdmin, raw);

    await Promise.all(
      (designs ?? [])
        .filter((d) => (d.images ?? []).includes(key) || d.image_key === key)
        .map((d) => {
          const nextImages = (d.images ?? []).filter((img) => img !== key);
          const nextKey = d.image_key === key ? nextImages[0] || "residential" : d.image_key;
          return supabaseAdmin
            .from("designs")
            .update({ images: nextImages, image_key: nextKey })
            .eq("id", d.id);
        }),
    );

    return { ok: true as const, removedStorage };
  });

export const adminListDesignFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ designId: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    await resolveCallerRole(context);
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.listDesignUploadedFiles(data.designId);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: files, error } = await supabaseAdmin.storage
      .from("designs")
      .list(data.designId, { limit: 100 });
    if (error) throw new Error(error.message);
    return (files ?? [])
      .filter((f) => f.id)
      .map((f) => ({
        name: f.name,
        path: `${data.designId}/${f.name}`,
        format: formatForFile(f.name),
        size: (f.metadata as { size?: number } | null)?.size ?? null,
      }));
  });

export const adminUploadDesignFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        designId: z.string().min(1).max(80),
        fileName: z.string().min(1).max(160),
        contentType: z.string().max(120).default("application/octet-stream"),
        base64: z.string().min(1).max(20_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can upload design files." };
    if (!formatForFile(data.fileName)) {
      return { ok: false as const, message: "Allowed file types: PDF, DWG, DXF, PNG, JPG." };
    }
    const cleanBase64 = data.base64.includes(",") ? data.base64.split(",")[1]! : data.base64;
    const bytes = Uint8Array.from(Buffer.from(cleanBase64, "base64"));

    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const saved = store.saveUploadedDesignFile(data.designId, data.fileName, bytes);
      return { ok: true as const, file: saved };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const filePath = `${data.designId}/${data.fileName}`;
    const { error } = await supabaseAdmin.storage.from("designs").upload(filePath, bytes, {
      contentType: data.contentType,
      upsert: true,
    });
    if (error) return { ok: false as const, message: error.message };
    return {
      ok: true as const,
      file: { name: data.fileName, path: filePath, size: bytes.byteLength },
    };
  });

export const adminDeleteDesignFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ designId: z.string().min(1).max(80), fileName: z.string().min(1).max(160) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can delete design files." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      store.deleteUploadedDesignFile(data.designId, data.fileName);
      return { ok: true as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage
      .from("designs")
      .remove([`${data.designId}/${data.fileName}`]);
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const };
  });

export interface AdminCategoryRow extends Category {
  activeDesignCount: number;
  totalDesignCount: number;
}

export const adminListCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminCategoryRow[]> => {
    await resolveCallerRole(context);
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const cats = store.listCategories();
      const designs = store.listAllDesigns();
      return cats.map((c) => ({
        ...c,
        activeDesignCount: designs.filter((d) => d.category === c.name && d.is_active).length,
        totalDesignCount: designs.filter((d) => d.category === c.name).length,
      }));
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: cats, error }, { data: designs }] = await Promise.all([
      supabaseAdmin.from("categories").select("name, emoji, sort_order").order("sort_order"),
      supabaseAdmin.from("designs").select("category, is_active"),
    ]);
    if (error) throw new Error(error.message);
    return (cats ?? []).map((c) => ({
      ...c,
      activeDesignCount: (designs ?? []).filter((d) => d.category === c.name && d.is_active).length,
      totalDesignCount: (designs ?? []).filter((d) => d.category === c.name).length,
    }));
  });

export const adminSaveCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        originalName: z.string().max(80).optional(),
        name: z.string().min(1).max(80),
        emoji: z.string().min(1).max(16).default("📐"),
        sort_order: z.number().int().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can edit categories." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.saveCategory(data);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.originalName) {
      const { data: updated, error } = await supabaseAdmin
        .from("categories")
        .update({
          name: data.name.trim(),
          emoji: data.emoji.trim(),
          ...(data.sort_order !== undefined ? { sort_order: data.sort_order } : {}),
        })
        .eq("name", data.originalName)
        .select("name, emoji, sort_order")
        .single();
      if (error) return { ok: false as const, message: error.message };
      return { ok: true as const, category: updated };
    }
    const { data: created, error } = await supabaseAdmin
      .from("categories")
      .insert({
        name: data.name.trim(),
        emoji: data.emoji.trim(),
        sort_order: data.sort_order ?? 10,
      })
      .select("name, emoji, sort_order")
      .single();
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, category: created };
  });

export const adminReorderCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ orderedNames: z.array(z.string().min(1).max(80)).min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can reorder categories." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      store.reorderCategories(data.orderedNames);
      return { ok: true as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await Promise.all(
      data.orderedNames.map((name, i) =>
        supabaseAdmin
          .from("categories")
          .update({ sort_order: i + 1 })
          .eq("name", name),
      ),
    );
    return { ok: true as const };
  });

export const adminDeleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return { ok: false as const, message: "Only authenticated admins can delete categories." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.deleteCategory(data.name);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("categories").delete().eq("name", data.name);
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const };
  });

export const adminGetSiteContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await resolveCallerRole(context);
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.getSiteContentState();
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { raw, updatedAt } = await readSupabaseSettingsRaw(supabaseAdmin);
    return { content: resolveSiteContent(raw), updatedAt };
  });

export const adminSaveSiteContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        announcement: z.string().max(400),
        heroTitle: z.string().max(400),
        heroHighlight: z.string().max(400),
        heroSubtitle: z.string().max(400),
        heroButton: z.string().max(120),
        heroImage: z.string().max(500).nullable(),
        shopHeading: z.string().max(200),
        designsHeading: z.string().max(200),
        promoTitle: z.string().max(400),
        promoText: z.string().max(400),
        footerHeading: z.string().max(200),
        phone: z.string().max(60),
        footerNote: z.string().max(300),
        sections: z.array(z.object({ id: z.enum(SECTION_IDS), visible: z.boolean() })),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdminCaller(context)))
      return {
        ok: false as const,
        message: "Only authenticated admins can publish website changes.",
      };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const saved = store.saveSiteContentState(data);
      return { ok: true as const, ...saved };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const resolved = resolveSiteContent(data);
    // Preserve internal server-managed namespaces (_media, _image_captions, _rbac_roles)
    const { raw } = await readSupabaseSettingsRaw(supabaseAdmin);
    const merged: Record<string, unknown> = {
      ...resolved,
      ...(raw["_media"] ? { _media: raw["_media"] } : {}),
      ...(raw["_image_captions"] ? { _image_captions: raw["_image_captions"] } : {}),
      ...(raw["_rbac_roles"] ? { _rbac_roles: raw["_rbac_roles"] } : {}),
    };
    const row = await writeSupabaseSettingsRaw(supabaseAdmin, merged);
    return {
      ok: true as const,
      content: resolveSiteContent(row.content),
      updatedAt: row.updated_at,
    };
  });

// ===== Admins & Users Role-Based Access Control (RBAC) =====

export const adminGetAccessControl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ myRole: UserRole; myEmail: string | null; members: RoleMember[] }> => {
      const caller = await resolveCallerRole(context);
      if (context.isLocalMode) {
        const store = await import("./local-store.server");
        return {
          myRole: caller.role,
          myEmail: caller.email,
          members: store.listRoleMembers(),
        };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: adminEmails }, { raw }] = await Promise.all([
        supabaseAdmin.from("admin_emails").select("email"),
        readSupabaseSettingsRaw(supabaseAdmin),
      ]);

      const rbacMap = getPrivateMap<{
        role: UserRole;
        addedBy?: string | null;
        updatedAt?: string;
      }>(raw, "_rbac_roles");
      const byEmail = new Map<string, RoleMember>();
      const now = new Date().toISOString();

      for (const owner of OWNER_EMAILS) {
        byEmail.set(owner, { email: owner, role: "admin", addedBy: "system", updatedAt: now });
      }
      for (const row of adminEmails ?? []) {
        const clean = row.email.trim().toLowerCase();
        if (clean && !byEmail.has(clean)) {
          byEmail.set(clean, {
            email: clean,
            role: "admin",
            addedBy: rbacMap[clean]?.addedBy ?? "admin",
            updatedAt: rbacMap[clean]?.updatedAt ?? now,
          });
        }
      }
      for (const [emailKey, meta] of Object.entries(rbacMap)) {
        const clean = emailKey.trim().toLowerCase();
        if (!clean) continue;
        if (isOwnerEmail(clean)) continue;
        byEmail.set(clean, {
          email: clean,
          role: meta.role,
          addedBy: meta.addedBy ?? null,
          updatedAt: meta.updatedAt ?? now,
        });
      }

      if (caller.email && !byEmail.has(caller.email)) {
        byEmail.set(caller.email, {
          email: caller.email,
          role: caller.role,
          addedBy: null,
          updatedAt: now,
        });
      }

      return {
        myRole: caller.role,
        myEmail: caller.email,
        members: [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email)),
      };
    },
  );

export const adminSaveRoleMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email().max(160),
        role: z.enum(["admin", "user"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await resolveCallerRole(context);
    if (caller.role !== "admin") {
      return { ok: false as const, message: "Only authenticated admins can manage team roles." };
    }
    const cleanEmail = data.email.trim().toLowerCase();
    if (isOwnerEmail(cleanEmail) && data.role !== "admin") {
      return { ok: false as const, message: "Primary shop owner accounts must remain admins." };
    }

    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.saveRoleMember(cleanEmail, data.role, caller.email);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();

    if (data.role === "admin") {
      await supabaseAdmin.from("admin_emails").upsert({ email: cleanEmail });
    } else {
      await supabaseAdmin.from("admin_emails").delete().ilike("email", cleanEmail);
    }

    const { raw } = await readSupabaseSettingsRaw(supabaseAdmin);
    const rbacMap = getPrivateMap<{ role: UserRole; addedBy: string | null; updatedAt: string }>(
      raw,
      "_rbac_roles",
    );
    rbacMap[cleanEmail] = { role: data.role, addedBy: caller.email, updatedAt: now };
    raw["_rbac_roles"] = rbacMap;
    await writeSupabaseSettingsRaw(supabaseAdmin, raw);

    return {
      ok: true as const,
      member: {
        email: cleanEmail,
        role: data.role,
        addedBy: caller.email,
        updatedAt: now,
      } satisfies RoleMember,
    };
  });

export const adminDeleteRoleMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ email: z.string().email().max(160) }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await resolveCallerRole(context);
    if (caller.role !== "admin") {
      return { ok: false as const, message: "Only authenticated admins can remove team members." };
    }
    const cleanEmail = data.email.trim().toLowerCase();
    if (isOwnerEmail(cleanEmail)) {
      return { ok: false as const, message: "Primary shop owner accounts cannot be removed." };
    }
    if (cleanEmail === caller.email) {
      return { ok: false as const, message: "You cannot remove your own active admin account." };
    }

    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.deleteRoleMember(cleanEmail);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("admin_emails").delete().ilike("email", cleanEmail);

    const { raw } = await readSupabaseSettingsRaw(supabaseAdmin);
    const rbacMap = getPrivateMap<{ role: UserRole; addedBy: string | null; updatedAt: string }>(
      raw,
      "_rbac_roles",
    );
    delete rbacMap[cleanEmail];
    raw["_rbac_roles"] = rbacMap;
    await writeSupabaseSettingsRaw(supabaseAdmin, raw);

    return { ok: true as const };
  });

export { STAGE_ORDER, promptCutoff };
