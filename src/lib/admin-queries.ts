import { queryOptions } from "@tanstack/react-query";

import type { Json } from "@/integrations/supabase/types";
import {
  adminGetAccessControl,
  adminGetDashboardSnapshot,
  adminGetOrderDetail,
  adminGetSiteContent,
  adminListCategories,
  adminListDesignFiles,
  adminListDesigns,
  adminListMedia,
  type RoleMember,
  type StoredImageMeta,
  type UserRole,
} from "./admin.functions";
import type { DownloadFormat } from "./downloads";
import type { OrderStage } from "./order-stages";

export type { RoleMember, StoredImageMeta, UserRole };

export type OrderFilter = OrderStage | "all" | "successful";

export type AdminOrder = {
  id: string;
  phone: string;
  amount: number;
  design_ids: string[];
  status: string;
  mpesa_receipt: string | null;
  result_desc: string | null;
  created_at: string;
  paid_at: string | null;
  downloaded_at: string | null;
  checkout_request_id: string | null;
};

export interface OrderEvent {
  id: string;
  order_id: string;
  kind: string;
  message: string;
  detail: Record<string, Json | undefined>;
  created_at: string;
}

export interface ActiveSession {
  id: string;
  role: "shopper" | "admin";
  path: string;
  basket_count: number;
  user_agent: string;
  connected_at: string;
  last_seen_at: string;
}

export interface AdminDesign {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string | null;
  tag: string | null;
  description: string | null;
  images: string[];
  image_captions?: Record<string, string>;
  image_key: string;
  is_active: boolean;
  sort_order: number;
  formats?: DownloadFormat[];
}

export interface DesignFile {
  name: string;
  path: string;
  format: DownloadFormat | null;
  size: number | null;
}

export const dashboardSnapshotQuery = (filter: OrderFilter, search: string) =>
  queryOptions({
    queryKey: ["admin", "snapshot", filter, search],
    queryFn: () => adminGetDashboardSnapshot({ data: { filter, search } }),
  });

export const orderDetailQuery = (orderId: string) =>
  queryOptions({
    queryKey: ["admin", "orders", "detail", orderId],
    queryFn: () => adminGetOrderDetail({ data: { orderId } }),
  });

export const adminDesignsQuery = queryOptions({
  queryKey: ["admin", "designs"],
  queryFn: () => adminListDesigns(),
});

export const designFilesQuery = (designId: string) =>
  queryOptions({
    queryKey: ["admin", "design-files", designId],
    queryFn: () => adminListDesignFiles({ data: { designId } }),
  });

export const adminCategoriesQuery = queryOptions({
  queryKey: ["admin", "categories"],
  queryFn: () => adminListCategories(),
});

export const adminSiteContentQuery = queryOptions({
  queryKey: ["admin", "site"],
  queryFn: () => adminGetSiteContent(),
});

export const mediaLibraryQuery = queryOptions({
  queryKey: ["admin", "media"],
  queryFn: () => adminListMedia(),
});

export const accessControlQuery = queryOptions({
  queryKey: ["admin", "access"],
  queryFn: () => adminGetAccessControl(),
});

/** Short order reference shown to the owner, matching the M-PESA account reference. */
export function orderRef(id: string): string {
  return "MTK" + id.replace(/-/g, "").slice(0, 9).toUpperCase();
}

/** 254712345678 → 0712 345 678 */
export function displayPhone(phone: string): string {
  const local = phone.startsWith("254") ? "0" + phone.slice(3) : phone;
  return local.replace(/^(\d{4})(\d{3})(\d+)$/, "$1 $2 $3");
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

/** After a dashboard change, refresh the public shop data too. */
export const SHOP_KEYS = [["designs"], ["design"], ["categories"], ["site-content"]] as const;
