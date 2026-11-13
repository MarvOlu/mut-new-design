import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Category } from "./categories";
import { formatForFile, type DownloadFormat } from "./downloads";
import { orderStage, promptCutoff, STAGE_ORDER, type OrderStage } from "./order-stages";
import { resolveSiteContent, SECTION_IDS, type SiteContent } from "./site-content";

type EventDetail = Record<string, Json>;

async function assertAdmin(context: { isLocalMode: boolean; supabase: unknown; userId: string }) {
  if (context.isLocalMode) return true;
  const sb = context.supabase as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> };
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  return Boolean(isAdmin);
}

export const adminGetDashboardSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        filter: z.enum(["all", "successful", "received", "processing", "rejected", "completed"]).default("all"),
        search: z.string().max(80).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) {
      throw new Error("Only the shop owner can access dashboard data.");
    }
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return {
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
      .select("id, phone, amount, design_ids, status, mpesa_receipt, result_desc, created_at, paid_at, downloaded_at, checkout_request_id")
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) throw new Error(error.message);

    const rows = allOrders ?? [];
    const now = Date.now();
    const counts: Record<OrderStage, number> = { received: 0, processing: 0, rejected: 0, completed: 0 };
    let paidCount = 0;
    let totalRevenue = 0;
    for (const o of rows) {
      counts[orderStage(o, now)] += 1;
      if (o.status === "paid") {
        paidCount += 1;
        totalRevenue += o.amount;
      }
    }

    const term = data.search.trim().toLowerCase().replace(/[^\w+]/g, "");
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
      return o.phone.includes(term) || localPhone.includes(term) || receipt.includes(term) || ref.includes(term);
    });

    const { data: events } = await supabaseAdmin
      .from("order_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);

    const store = await import("./local-store.server");
    return {
      counts,
      revenueSummary: { paidCount, totalRevenue },
      orders: orders.slice(0, 100),
      recentEvents: (events ?? []).map((e) => ({
        ...e,
        detail: (e.detail && typeof e.detail === "object" && !Array.isArray(e.detail) ? e.detail : {}) as EventDetail,
      })),
      activeSessions: store.listActiveSessions(),
    };
  });

export const adminGetOrderDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) throw new Error("Only the shop owner can access order details.");
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.getAdminOrderDetail(data.orderId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id, phone, amount, design_ids, status, mpesa_receipt, result_desc, created_at, paid_at, downloaded_at, checkout_request_id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) return null;

    const [{ data: designs }, { data: events }] = await Promise.all([
      supabaseAdmin.from("designs").select("id, name, category, price, images, image_key").in("id", order.design_ids),
      supabaseAdmin.from("order_events").select("*").eq("order_id", data.orderId).order("created_at", { ascending: true }),
    ]);

    return {
      order,
      designs: designs ?? [],
      events: (events ?? []).map((e) => ({
        ...e,
        detail: (e.detail && typeof e.detail === "object" && !Array.isArray(e.detail) ? e.detail : {}) as EventDetail,
      })),
    };
  });

export const adminCheckPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Only the shop owner can do this." };

    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const order = store.getOrder(data.orderId);
      if (!order) return { ok: false as const, message: "Order not found." };
      if (order.status !== "pending") return { ok: true as const, status: order.status, changed: false };
      if (!order.checkout_request_id) {
        return { ok: false as const, message: "No M-PESA prompt was sent for this order, so there is nothing to check." };
      }
      const { getMpesaConfig, queryStkStatus } = await import("./mpesa.server");
      const { config, missing } = getMpesaConfig();
      if (missing.length) {
        return { ok: false as const, message: "M-PESA Daraja credentials are not configured in this environment." };
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
    if (order.status !== "pending") return { ok: true as const, status: order.status, changed: false };
    if (!order.checkout_request_id) {
      return { ok: false as const, message: "No M-PESA prompt was sent for this order, so there is nothing to check." };
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
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Only the shop owner can do this." };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const updated = store.updateOrder(data.orderId, {
        status: data.status,
        ...(data.status === "paid"
          ? {
              paid_at: new Date().toISOString(),
              mpesa_receipt: data.receipt?.trim() || "MTK" + Math.random().toString(36).slice(2, 9).toUpperCase(),
              result_desc: "Confirmed by shop owner.",
            }
          : {
              result_desc: data.reason?.trim() || "Marked as failed by shop owner.",
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
              result_desc: "Confirmed by shop owner.",
            }
          : {
              status: "failed",
              result_desc: data.reason?.trim() || "Marked as failed by shop owner.",
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
    if (!(await assertAdmin(context))) throw new Error("Unauthorized");
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.listAllDesigns().map((d) => ({
        ...d,
        formats: store.listAvailableFormats(d.id),
      }));
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("designs")
      .select("id, name, category, price, unit, tag, description, images, image_key, is_active, sort_order")
      .order("sort_order")
      .order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => ({ ...d, image_captions: {} as Record<string, string>, formats: [] as DownloadFormat[] }));
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
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Only the shop owner can edit designs." };
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
    const { data: saved, error } = await supabaseAdmin.from("designs").upsert(payload).select("*").single();
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, design: { ...saved, image_captions: data.image_captions ?? {} } };
  });

export const adminReorderDesigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderedIds: z.array(z.string().min(1).max(80)).min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      store.reorderDesigns(data.orderedIds);
      return { ok: true as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await Promise.all(
      data.orderedIds.map((id, i) => supabaseAdmin.from("designs").update({ sort_order: i + 1 }).eq("id", id)),
    );
    return { ok: true as const };
  });

export const adminDeleteDesign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ designId: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
    const cleanBase64 = data.base64.includes(",") ? data.base64.split(",")[1]! : data.base64;
    const bytes = Uint8Array.from(Buffer.from(cleanBase64, "base64"));

    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const storagePath = store.saveUploadedImage(data.fileName, bytes);
      return { ok: true as const, key: `upload:${storagePath}` };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ext = data.fileName.split(".").pop()?.toLowerCase() || "jpg";
    const storagePath = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabaseAdmin.storage.from("design-images").upload(storagePath, bytes, {
      contentType: data.contentType,
      upsert: false,
    });
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, key: `upload:${storagePath}` };
  });

export const adminListDesignFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ designId: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) throw new Error("Unauthorized");
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.listDesignUploadedFiles(data.designId);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: files, error } = await supabaseAdmin.storage.from("designs").list(data.designId, { limit: 100 });
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
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
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
    return { ok: true as const, file: { name: data.fileName, path: filePath, size: bytes.byteLength } };
  });

export const adminDeleteDesignFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ designId: z.string().min(1).max(80), fileName: z.string().min(1).max(160) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      store.deleteUploadedDesignFile(data.designId, data.fileName);
      return { ok: true as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage.from("designs").remove([`${data.designId}/${data.fileName}`]);
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
    if (!(await assertAdmin(context))) throw new Error("Unauthorized");
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
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.saveCategory(data);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.originalName) {
      const { data: updated, error } = await supabaseAdmin
        .from("categories")
        .update({ name: data.name.trim(), emoji: data.emoji.trim(), ...(data.sort_order !== undefined ? { sort_order: data.sort_order } : {}) })
        .eq("name", data.originalName)
        .select("name, emoji, sort_order")
        .single();
      if (error) return { ok: false as const, message: error.message };
      return { ok: true as const, category: updated };
    }
    const { data: created, error } = await supabaseAdmin
      .from("categories")
      .insert({ name: data.name.trim(), emoji: data.emoji.trim(), sort_order: data.sort_order ?? 10 })
      .select("name, emoji, sort_order")
      .single();
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, category: created };
  });

export const adminReorderCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderedNames: z.array(z.string().min(1).max(80)).min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      store.reorderCategories(data.orderedNames);
      return { ok: true as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await Promise.all(
      data.orderedNames.map((name, i) => supabaseAdmin.from("categories").update({ sort_order: i + 1 }).eq("name", name)),
    );
    return { ok: true as const };
  });

export const adminDeleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
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
    if (!(await assertAdmin(context))) throw new Error("Unauthorized");
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      return store.getSiteContentState();
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("site_settings").select("content, updated_at").eq("id", 1).maybeSingle();
    if (error) throw new Error(error.message);
    return { content: resolveSiteContent(data?.content), updatedAt: data?.updated_at ?? null };
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
    if (!(await assertAdmin(context))) return { ok: false as const, message: "Unauthorized" };
    if (context.isLocalMode) {
      const store = await import("./local-store.server");
      const saved = store.saveSiteContentState(data);
      return { ok: true as const, ...saved };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const resolved = resolveSiteContent(data);
    const { data: row, error } = await supabaseAdmin
      .from("site_settings")
      .upsert({ id: 1, content: resolved as unknown as Record<string, never> })
      .select("content, updated_at")
      .single();
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, content: resolveSiteContent(row.content), updatedAt: row.updated_at };
  });

export { STAGE_ORDER, promptCutoff };
