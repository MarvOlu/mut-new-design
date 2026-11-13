import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { Category } from "./categories";
import { DOWNLOAD_FORMATS, formatForFile, FORMAT_ORDER, type DownloadFormat } from "./downloads";
import { orderStage, promptCutoff, STAGE_ORDER, type OrderStage } from "./order-stages";
import { DEFAULT_SITE_CONTENT, resolveSiteContent, type SiteContent } from "./site-content";

export interface StoredDesign {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string | null;
  tag: string | null;
  image_key: string;
  images: string[];
  image_captions: Record<string, string>;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface StoredOrder {
  id: string;
  phone: string;
  amount: number;
  design_ids: string[];
  status: "pending" | "paid" | "failed";
  checkout_request_id: string | null;
  merchant_request_id: string | null;
  mpesa_receipt: string | null;
  result_desc: string | null;
  paid_at: string | null;
  downloaded_at: string | null;
  last_query_at: string | null;
  created_at: string;
  updated_at: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StoredOrderEvent {
  id: string;
  order_id: string;
  kind: string;
  message: string;
  detail: Record<string, JsonValue>;
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

export interface AdminRealtimeEvent {
  type: "order:created" | "order:prompt_sent" | "order:paid" | "order:failed" | "order:download" | "sessions:update" | "catalog:update";
  timestamp: string;
  payload: Record<string, unknown>;
}

interface PersistedState {
  categories: Category[];
  designs: StoredDesign[];
  orders: StoredOrder[];
  order_events: StoredOrderEvent[];
  site_content: SiteContent;
  site_updated_at: string;
}

const STORE_FILE = "/tmp/mutken-shop-store.json";
const UPLOADS_ROOT = "/tmp/mutken-uploads";
const DESIGN_IMAGES_DIR = path.join(UPLOADS_ROOT, "design-images");
const DESIGN_FILES_DIR = path.join(UPLOADS_ROOT, "designs");

function ensureDirs() {
  fs.mkdirSync(DESIGN_IMAGES_DIR, { recursive: true });
  fs.mkdirSync(DESIGN_FILES_DIR, { recursive: true });
}

function createInitialState(): PersistedState {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  const categories: Category[] = [
    { name: "Residential", emoji: "🏠", sort_order: 1 },
    { name: "Commercial", emoji: "🌆", sort_order: 2 },
    { name: "Industrial", emoji: "🏗", sort_order: 3 },
    { name: "Urban Design", emoji: "🗼", sort_order: 4 },
    { name: "Interior Design", emoji: "💠", sort_order: 5 },
  ];

  const designs: StoredDesign[] = [
    {
      id: "two-bedroom-apartment",
      name: "Two bedroom apartment",
      category: "Residential",
      price: 4500,
      unit: "2 pages",
      tag: "15% OFF",
      image_key: "residential",
      images: ["residential", "residential-interior", "floorplan"],
      image_captions: {
        residential: "Front exterior perspective showing balcony glazing and timber louver accents.",
        "residential-interior": "Open-plan living and dining space with natural daylighting.",
        floorplan: "Dimensioned 2-bedroom floor plan with master ensuite and utility balcony.",
      },
      description:
        "A modern two bedroom apartment with an open-plan lounge and kitchen, two bathrooms and a private balcony. Ideal for rental blocks or a family home.",
      is_active: true,
      sort_order: 1,
      created_at: iso(-86_400_000 * 14),
    },
    {
      id: "roller-castle",
      name: "Roller Castle",
      category: "Residential",
      price: 1225,
      unit: "1 page",
      tag: "Classic",
      image_key: "residential",
      images: ["residential", "elevation", "floorplan"],
      image_captions: {
        residential: "Main facade view with pitched roof geometry and stone plinth.",
        elevation: "Front and side architectural elevations with ridge heights.",
        floorplan: "Compact single-level layout optimized for low construction cost.",
      },
      description:
        "A classic family home with a striking front elevation, generous living spaces and a simple structure that keeps building costs low.",
      is_active: true,
      sort_order: 2,
      created_at: iso(-86_400_000 * 13),
    },
    {
      id: "ten-storey-building",
      name: "Ten Storey building",
      category: "Commercial",
      price: 13010,
      unit: "5 pages",
      tag: null,
      image_key: "commercial",
      images: ["commercial", "commercial-lobby", "elevation"],
      image_captions: {
        commercial: "Curtain-wall tower perspective for urban commercial plots.",
        "commercial-lobby": "Double-height reception lobby with terrazzo floor and lift core.",
        elevation: "Full 10-level elevation with floor-to-floor structural grid.",
      },
      description:
        "A ten storey office and retail building with a glass facade, central core and flexible open floors that suit many tenants.",
      is_active: true,
      sort_order: 3,
      created_at: iso(-86_400_000 * 12),
    },
    {
      id: "turbine-design",
      name: "Turbine Design",
      category: "Commercial",
      price: 12800,
      unit: "1 page",
      tag: "Fresh",
      image_key: "industrial",
      images: ["industrial", "industrial-detail", "elevation"],
      image_captions: {
        industrial: "Structural steel portal frame housing for turbine equipment.",
        "industrial-detail": "Baseplate, crane rail, and acoustic cladding section details.",
      },
      description: "Structural layout and elevation drawings for a turbine housing, prepared for engineers and contractors.",
      is_active: true,
      sort_order: 4,
      created_at: iso(-86_400_000 * 11),
    },
    {
      id: "bridge-design",
      name: "Bridge Design",
      category: "Industrial",
      price: 15750,
      unit: "4 pages",
      tag: null,
      image_key: "industrial",
      images: ["industrial", "industrial-detail", "elevation"],
      image_captions: {},
      description: "A pedestrian and light vehicle bridge with steel and concrete details, spans and sections ready for costing.",
      is_active: true,
      sort_order: 5,
      created_at: iso(-86_400_000 * 10),
    },
    {
      id: "first-floor",
      name: "First Floor",
      category: "Urban Design",
      price: 19000,
      unit: "1 page",
      tag: null,
      image_key: "urban",
      images: ["urban", "urban-aerial", "floorplan"],
      image_captions: {},
      description: "A first floor layout for a mixed-use urban building, with shops below and apartments or offices above.",
      is_active: true,
      sort_order: 6,
      created_at: iso(-86_400_000 * 9),
    },
    {
      id: "bronze-gate",
      name: "Bronze Gate",
      category: "Urban Design",
      price: 16200,
      unit: "3 pages",
      tag: "Organic",
      image_key: "urban",
      images: ["urban", "urban-aerial", "elevation"],
      image_captions: {},
      description: "A grand entrance gate with bronze finishes, pillars and a guard house, designed to give any compound a premium first impression.",
      is_active: true,
      sort_order: 7,
      created_at: iso(-86_400_000 * 8),
    },
    {
      id: "ceiling-design",
      name: "Ceiling Design",
      category: "Interior Design",
      price: 14900,
      unit: "5 pages",
      tag: null,
      image_key: "interior",
      images: ["interior", "interior-detail", "residential-interior"],
      image_captions: {},
      description: "Elegant gypsum ceiling designs with cove lighting for living rooms, dining areas and offices.",
      is_active: true,
      sort_order: 8,
      created_at: iso(-86_400_000 * 7),
    },
    {
      id: "iron-door",
      name: "Iron Door",
      category: "Commercial",
      price: 14400,
      unit: "1 leaf",
      tag: null,
      image_key: "interior",
      images: ["interior", "interior-detail", "elevation"],
      image_captions: {},
      description: "A decorative single-leaf iron door with detailed patterns, sizes and fixing details for your fabricator.",
      is_active: true,
      sort_order: 9,
      created_at: iso(-86_400_000 * 6),
    },
    {
      id: "sweet-strengthening-blocks",
      name: "Sweet Strengthening blocks",
      category: "Residential",
      price: 16000,
      unit: "1 page",
      tag: null,
      image_key: "residential",
      images: ["residential", "floorplan", "elevation"],
      image_captions: {},
      description: "Block layout and strengthening details for a durable, affordable house built with interlocking blocks.",
      is_active: true,
      sort_order: 10,
      created_at: iso(-86_400_000 * 5),
    },
  ];

  // Seed representative orders across all 4 dashboard stages so the progressive drill-down
  // (job -> job details -> records) and count cards work immediately on first boot.
  const order1Id = "11111111-1111-4111-8111-111111111101";
  const order2Id = "22222222-2222-4222-8222-222222222202";
  const order3Id = "33333333-3333-4333-8333-333333333303";
  const order4Id = "44444444-4444-4444-8444-444444444404";

  const orders: StoredOrder[] = [
    {
      id: order1Id,
      phone: "254712345678",
      amount: 4500,
      design_ids: ["two-bedroom-apartment"],
      status: "paid",
      checkout_request_id: "ws_CO_11112026091001",
      merchant_request_id: "mr_101",
      mpesa_receipt: "NLJ7RT61SV",
      result_desc: "The service request is processed successfully.",
      paid_at: iso(-3_600_000 * 2 + 45_000),
      downloaded_at: iso(-3_600_000 * 2 + 110_000),
      last_query_at: null,
      created_at: iso(-3_600_000 * 2),
      updated_at: iso(-3_600_000 * 2 + 110_000),
    },
    {
      id: order2Id,
      phone: "254723987654",
      amount: 14235,
      design_ids: ["roller-castle", "ten-storey-building"],
      status: "paid",
      checkout_request_id: "ws_CO_11112026094502",
      merchant_request_id: "mr_102",
      mpesa_receipt: "NLK9WP42AB",
      result_desc: "The service request is processed successfully.",
      paid_at: iso(-1_800_000 + 30_000),
      downloaded_at: null,
      last_query_at: null,
      created_at: iso(-1_800_000),
      updated_at: iso(-1_800_000 + 30_000),
    },
    {
      id: order3Id,
      phone: "254700112233",
      amount: 14900,
      design_ids: ["ceiling-design"],
      status: "pending",
      checkout_request_id: "ws_CO_11112026101503",
      merchant_request_id: "mr_103",
      mpesa_receipt: null,
      result_desc: null,
      paid_at: null,
      downloaded_at: null,
      last_query_at: null,
      created_at: iso(-90_000),
      updated_at: iso(-90_000),
    },
    {
      id: order4Id,
      phone: "254112445566",
      amount: 16200,
      design_ids: ["bronze-gate"],
      status: "failed",
      checkout_request_id: "ws_CO_11112026082004",
      merchant_request_id: "mr_104",
      mpesa_receipt: null,
      result_desc: "The payment was cancelled on the phone.",
      paid_at: null,
      downloaded_at: null,
      last_query_at: null,
      created_at: iso(-3_600_000 * 5),
      updated_at: iso(-3_600_000 * 5 + 25_000),
    },
  ];

  const order_events: StoredOrderEvent[] = [
    {
      id: crypto.randomUUID(),
      order_id: order1Id,
      kind: "created",
      message: "Order placed",
      detail: { amount: 4500, phone: "254712345678", designs: ["two-bedroom-apartment"] },
      created_at: iso(-3_600_000 * 2),
    },
    {
      id: crypto.randomUUID(),
      order_id: order1Id,
      kind: "prompt_sent",
      message: "M-PESA prompt sent to the buyer's phone",
      detail: { amount: 4500, checkout_request_id: "ws_CO_11112026091001" },
      created_at: iso(-3_600_000 * 2 + 2_000),
    },
    {
      id: crypto.randomUUID(),
      order_id: order1Id,
      kind: "paid",
      message: "Payment received",
      detail: { amount: 4500, receipt: "NLJ7RT61SV" },
      created_at: iso(-3_600_000 * 2 + 45_000),
    },
    {
      id: crypto.randomUUID(),
      order_id: order1Id,
      kind: "download",
      message: "Downloaded PDF · Two bedroom apartment",
      detail: { design_id: "two-bedroom-apartment", format: "pdf" },
      created_at: iso(-3_600_000 * 2 + 110_000),
    },
    {
      id: crypto.randomUUID(),
      order_id: order2Id,
      kind: "created",
      message: "Order placed",
      detail: { amount: 14235, phone: "254723987654", designs: ["roller-castle", "ten-storey-building"] },
      created_at: iso(-1_800_000),
    },
    {
      id: crypto.randomUUID(),
      order_id: order2Id,
      kind: "prompt_sent",
      message: "M-PESA prompt sent to the buyer's phone",
      detail: { amount: 14235, checkout_request_id: "ws_CO_11112026094502" },
      created_at: iso(-1_800_000 + 2_000),
    },
    {
      id: crypto.randomUUID(),
      order_id: order2Id,
      kind: "paid",
      message: "Payment received",
      detail: { amount: 14235, receipt: "NLK9WP42AB" },
      created_at: iso(-1_800_000 + 30_000),
    },
    {
      id: crypto.randomUUID(),
      order_id: order3Id,
      kind: "created",
      message: "Order placed",
      detail: { amount: 14900, phone: "254700112233", designs: ["ceiling-design"] },
      created_at: iso(-90_000),
    },
    {
      id: crypto.randomUUID(),
      order_id: order3Id,
      kind: "prompt_sent",
      message: "M-PESA prompt sent to the buyer's phone",
      detail: { amount: 14900, checkout_request_id: "ws_CO_11112026101503" },
      created_at: iso(-88_000),
    },
    {
      id: crypto.randomUUID(),
      order_id: order4Id,
      kind: "created",
      message: "Order placed",
      detail: { amount: 16200, phone: "254112445566", designs: ["bronze-gate"] },
      created_at: iso(-3_600_000 * 5),
    },
    {
      id: crypto.randomUUID(),
      order_id: order4Id,
      kind: "failed",
      message: "The payment was cancelled on the phone.",
      detail: { amount: 16200 },
      created_at: iso(-3_600_000 * 5 + 25_000),
    },
  ];

  return {
    categories,
    designs,
    orders,
    order_events,
    site_content: { ...DEFAULT_SITE_CONTENT },
    site_updated_at: iso(-86_400_000),
  };
}

type GlobalStore = {
  state: PersistedState;
  sessions: Map<string, ActiveSession>;
  listeners: Set<(event: AdminRealtimeEvent) => void>;
};

const globalKey = "__mutken_local_store__";

function loadPersistedState(): PersistedState {
  ensureDirs();
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed && Array.isArray(parsed.designs) && Array.isArray(parsed.categories) && Array.isArray(parsed.orders)) {
        return {
          categories: parsed.categories,
          designs: parsed.designs.map((d) => ({
            ...d,
            images: Array.isArray(d.images) ? d.images : [],
            image_captions: d.image_captions && typeof d.image_captions === "object" ? d.image_captions : {},
          })),
          orders: parsed.orders,
          order_events: Array.isArray(parsed.order_events) ? parsed.order_events : [],
          site_content: resolveSiteContent(parsed.site_content),
          site_updated_at: parsed.site_updated_at ?? new Date().toISOString(),
        };
      }
    }
  } catch (e) {
    console.warn("[local-store] Could not read persisted state, creating fresh seed:", e);
  }
  const initial = createInitialState();
  savePersistedState(initial);
  return initial;
}

function savePersistedState(state: PersistedState) {
  try {
    ensureDirs();
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.warn("[local-store] Failed to persist state:", e);
  }
}

function getStore(): GlobalStore {
  const g = globalThis as unknown as Record<string, GlobalStore | undefined>;
  if (!g[globalKey]) {
    g[globalKey] = {
      state: loadPersistedState(),
      sessions: new Map(),
      listeners: new Set(),
    };
  }
  return g[globalKey]!;
}

function broadcast(type: AdminRealtimeEvent["type"], payload: Record<string, unknown>) {
  const evt: AdminRealtimeEvent = {
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
  for (const listener of getStore().listeners) {
    try {
      listener(evt);
    } catch {
      // Ignore closed stream listener
    }
  }
}

function pruneSessions() {
  const cutoff = Date.now() - 90_000;
  const sessions = getStore().sessions;
  let removed = false;
  for (const [id, s] of sessions.entries()) {
    if (new Date(s.last_seen_at).getTime() < cutoff) {
      sessions.delete(id);
      removed = true;
    }
  }
  return removed;
}

export function subscribeAdminEvents(listener: (event: AdminRealtimeEvent) => void): () => void {
  const store = getStore();
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

export function touchSession(input: {
  id: string;
  role: "shopper" | "admin";
  path: string;
  basketCount?: number;
  userAgent?: string;
}): ActiveSession[] {
  pruneSessions();
  const store = getStore();
  const now = new Date().toISOString();
  const existing = store.sessions.get(input.id);
  const next: ActiveSession = {
    id: input.id,
    role: input.role,
    path: input.path || "/",
    basket_count: input.basketCount ?? existing?.basket_count ?? 0,
    user_agent: input.userAgent || existing?.user_agent || "Browser",
    connected_at: existing?.connected_at ?? now,
    last_seen_at: now,
  };
  store.sessions.set(input.id, next);
  const list = listActiveSessions();
  broadcast("sessions:update", { sessions: list });
  return list;
}

export function removeSession(id: string) {
  const store = getStore();
  if (store.sessions.delete(id)) {
    broadcast("sessions:update", { sessions: listActiveSessions() });
  }
}

export function listActiveSessions(): ActiveSession[] {
  pruneSessions();
  return [...getStore().sessions.values()].sort(
    (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime(),
  );
}

// ===== Public Storefront Queries =====

export function listActiveDesigns(): StoredDesign[] {
  return getStore()
    .state.designs.filter((d) => d.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function listAllDesigns(): StoredDesign[] {
  return [...getStore().state.designs].sort((a, b) => a.sort_order - b.sort_order);
}

export function getActiveDesign(designId: string): StoredDesign | null {
  return getStore().state.designs.find((d) => d.id === designId && d.is_active) ?? null;
}

export function getDesignById(designId: string): StoredDesign | null {
  return getStore().state.designs.find((d) => d.id === designId) ?? null;
}

export function listCategories(): Category[] {
  return [...getStore().state.categories].sort((a, b) => a.sort_order - b.sort_order);
}

export function getSiteContentState(): { content: SiteContent; updatedAt: string } {
  const s = getStore().state;
  return { content: s.site_content, updatedAt: s.site_updated_at };
}

// ===== Design Deliverable Files & Images =====

const DEFAULT_SEEDED_FORMATS: DownloadFormat[] = ["pdf", "dwg", "png"];

export function listDesignUploadedFiles(designId: string): { name: string; path: string; format: DownloadFormat | null; size: number }[] {
  ensureDirs();
  const dir = path.join(DESIGN_FILES_DIR, designId);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(dir, e.name);
      const stat = fs.statSync(full);
      return {
        name: e.name,
        path: `${designId}/${e.name}`,
        format: formatForFile(e.name),
        size: stat.size,
      };
    });
}

export function listAvailableFormats(designId: string): DownloadFormat[] {
  const uploaded = listDesignUploadedFiles(designId);
  if (uploaded.length > 0) {
    const found = new Set(uploaded.map((f) => f.format).filter((f): f is DownloadFormat => f !== null));
    return FORMAT_ORDER.filter((f) => found.has(f));
  }
  return DEFAULT_SEEDED_FORMATS;
}

export function saveUploadedDesignFile(designId: string, fileName: string, data: Uint8Array): { name: string; path: string; size: number } {
  ensureDirs();
  const safeName = path.basename(fileName).replace(/[^\w.\- ]+/g, "_");
  const dir = path.join(DESIGN_FILES_DIR, designId);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, safeName);
  fs.writeFileSync(target, data);
  return { name: safeName, path: `${designId}/${safeName}`, size: data.byteLength };
}

export function deleteUploadedDesignFile(designId: string, fileName: string): boolean {
  const safeName = path.basename(fileName);
  const target = path.join(DESIGN_FILES_DIR, designId, safeName);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    return true;
  }
  return false;
}

export function readDownloadableFile(
  designId: string,
  format: DownloadFormat,
): { bytes: Uint8Array; fileName: string; contentType: string } {
  const design = getDesignById(designId);
  const baseName = (design?.name ?? designId).replace(/[^\w\- ]+/g, "").trim() || designId;
  const uploaded = listDesignUploadedFiles(designId).find((f) => f.format === format);
  if (uploaded) {
    const full = path.join(DESIGN_FILES_DIR, uploaded.path);
    const bytes = fs.readFileSync(full);
    const ext = uploaded.name.split(".").pop()?.toLowerCase() ?? format;
    return {
      bytes,
      fileName: `${baseName}.${ext}`,
      contentType: mimeForFormat(format),
    };
  }
  // Generate a clean specification/drawing deliverable when no custom file was uploaded yet
  const summary = [
    `MUTKEN ARCHITECTURAL DESIGNS`,
    `Design: ${design?.name ?? designId}`,
    `Category: ${design?.category ?? "Architectural"}`,
    `Format: ${DOWNLOAD_FORMATS[format].label} (${DOWNLOAD_FORMATS[format].description})`,
    `Unit / Sheets: ${design?.unit ?? "Standard set"}`,
    `Price: KSh ${design?.price ?? 0}`,
    ``,
    design?.description ?? "Prepared architectural drawing package.",
  ].join("\n");
  return {
    bytes: new TextEncoder().encode(summary),
    fileName: `${baseName}.${format}`,
    contentType: "application/octet-stream",
  };
}

function mimeForFormat(fmt: DownloadFormat): string {
  switch (fmt) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

export function saveUploadedImage(originalName: string, bytes: Uint8Array): string {
  ensureDirs();
  const ext = path.extname(originalName).toLowerCase() || ".jpg";
  const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(ext) ? ext : ".jpg";
  const storagePath = `uploads/${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt}`;
  const full = path.join(DESIGN_IMAGES_DIR, storagePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return storagePath;
}

export function readUploadedImage(storagePath: string): Uint8Array | null {
  const resolved = path.resolve(DESIGN_IMAGES_DIR, storagePath);
  if (!resolved.startsWith(path.resolve(DESIGN_IMAGES_DIR))) return null;
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}

// ===== Orders & Events =====

function appendOrderEvent(
  orderId: string,
  kind: string,
  message: string,
  detail: Record<string, JsonValue> = {},
): StoredOrderEvent {
  const store = getStore();
  const evt: StoredOrderEvent = {
    id: crypto.randomUUID(),
    order_id: orderId,
    kind,
    message,
    detail,
    created_at: new Date().toISOString(),
  };
  store.state.order_events.push(evt);
  return evt;
}

export function createOrder(input: { phone: string; amount: number; designIds: string[] }): StoredOrder {
  const store = getStore();
  const now = new Date().toISOString();
  const order: StoredOrder = {
    id: crypto.randomUUID(),
    phone: input.phone,
    amount: input.amount,
    design_ids: input.designIds,
    status: "pending",
    checkout_request_id: null,
    merchant_request_id: null,
    mpesa_receipt: null,
    result_desc: null,
    paid_at: null,
    downloaded_at: null,
    last_query_at: null,
    created_at: now,
    updated_at: now,
  };
  store.state.orders.unshift(order);
  const evt = appendOrderEvent(order.id, "created", "Order placed", {
    amount: order.amount,
    phone: order.phone,
    designs: order.design_ids,
  });
  savePersistedState(store.state);
  broadcast("order:created", { order, event: evt });
  return order;
}

export function getOrder(orderId: string): StoredOrder | null {
  return getStore().state.orders.find((o) => o.id === orderId) ?? null;
}

export function getOrderByCheckoutId(checkoutRequestId: string): StoredOrder | null {
  return getStore().state.orders.find((o) => o.checkout_request_id === checkoutRequestId) ?? null;
}

export function updateOrder(
  orderId: string,
  patch: Partial<Pick<StoredOrder, "status" | "checkout_request_id" | "merchant_request_id" | "mpesa_receipt" | "result_desc" | "paid_at" | "downloaded_at" | "last_query_at">>,
): StoredOrder | null {
  const store = getStore();
  const order = store.state.orders.find((o) => o.id === orderId);
  if (!order) return null;

  const prevStatus = order.status;
  const prevCheckoutId = order.checkout_request_id;
  Object.assign(order, patch, { updated_at: new Date().toISOString() });

  if (order.checkout_request_id && order.checkout_request_id !== prevCheckoutId) {
    const evt = appendOrderEvent(order.id, "prompt_sent", "M-PESA prompt sent to the buyer's phone", {
      amount: order.amount,
      checkout_request_id: order.checkout_request_id,
    });
    broadcast("order:prompt_sent", { order, event: evt });
  }

  if (order.status !== prevStatus) {
    if (order.status === "paid") {
      const evt = appendOrderEvent(order.id, "paid", "Payment received", {
        amount: order.amount,
        receipt: order.mpesa_receipt,
      });
      broadcast("order:paid", { order, event: evt });
    } else if (order.status === "failed") {
      const evt = appendOrderEvent(order.id, "failed", order.result_desc || "Payment not completed", {
        amount: order.amount,
      });
      broadcast("order:failed", { order, event: evt });
    }
  }

  savePersistedState(store.state);
  return order;
}

export function recordOrderDownload(orderId: string, designId: string, format: DownloadFormat) {
  const store = getStore();
  const order = store.state.orders.find((o) => o.id === orderId);
  if (!order) return;
  if (!order.downloaded_at) {
    order.downloaded_at = new Date().toISOString();
    order.updated_at = order.downloaded_at;
  }
  const design = getDesignById(designId);
  const evt = appendOrderEvent(
    orderId,
    "download",
    `Downloaded ${DOWNLOAD_FORMATS[format].label} · ${design?.name ?? designId}`,
    { design_id: designId, format },
  );
  savePersistedState(store.state);
  broadcast("order:download", { order, event: evt });
}

// ===== Admin Queries & Mutations =====

export function getOrderCounts(now = Date.now()): Record<OrderStage, number> {
  const counts: Record<OrderStage, number> = {
    received: 0,
    processing: 0,
    rejected: 0,
    completed: 0,
  };
  for (const o of getStore().state.orders) {
    counts[orderStage(o, now)] += 1;
  }
  return counts;
}

export function getPaidRevenueSummary() {
  const paidOrders = getStore().state.orders.filter((o) => o.status === "paid");
  const totalRevenue = paidOrders.reduce((sum, o) => sum + o.amount, 0);
  return {
    paidCount: paidOrders.length,
    totalRevenue,
  };
}

export function listFilteredOrders(filter: OrderStage | "all" | "successful", search: string): StoredOrder[] {
  const term = search.trim().toLowerCase().replace(/[^\w+]/g, "");
  const now = Date.now();
  return [...getStore().state.orders]
    .filter((o) => {
      if (filter === "successful") {
        if (o.status !== "paid") return false;
      } else if (filter !== "all") {
        if (orderStage(o, now) !== filter) return false;
      }
      if (!term) return true;
      const localPhone = o.phone.startsWith("254") ? "0" + o.phone.slice(3) : o.phone;
      const receipt = (o.mpesa_receipt ?? "").toLowerCase();
      const ref = ("MTK" + o.id.replace(/-/g, "").slice(0, 9)).toLowerCase();
      return o.phone.includes(term) || localPhone.includes(term) || receipt.includes(term) || ref.includes(term);
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 100);
}

export function getAdminOrderDetail(orderId: string) {
  const order = getOrder(orderId);
  if (!order) return null;
  const designs = getStore()
    .state.designs.filter((d) => order.design_ids.includes(d.id))
    .map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      price: d.price,
      images: d.images,
      image_key: d.image_key,
    }));
  const events = getStore()
    .state.order_events.filter((e) => e.order_id === orderId)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return { order, designs, events };
}

export function listRecentOrderEvents(limit = 30): StoredOrderEvent[] {
  return [...getStore().state.order_events]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}

export function saveDesign(input: {
  id?: string | undefined;
  name: string;
  category: string;
  price: number;
  unit?: string | null | undefined;
  tag?: string | null | undefined;
  description?: string | null | undefined;
  images: string[];
  image_captions?: Record<string, string> | undefined;
  image_key?: string | undefined;
  is_active: boolean;
  sort_order?: number | undefined;
}): StoredDesign {
  const store = getStore();
  const cleanId =
    input.id?.trim() ||
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
    `design-${Date.now()}`;

  const cleanImages = input.images.map((s) => s.trim()).filter(Boolean);
  const primaryKey = input.image_key?.trim() || cleanImages[0] || "residential";
  const captions: Record<string, string> = {};
  if (input.image_captions) {
    for (const [k, v] of Object.entries(input.image_captions)) {
      if (v.trim()) captions[k] = v.trim();
    }
  }

  const existing = store.state.designs.find((d) => d.id === cleanId);
  if (existing) {
    existing.name = input.name.trim();
    existing.category = input.category.trim();
    existing.price = Math.max(1, Math.round(input.price));
    existing.unit = input.unit?.trim() || null;
    existing.tag = input.tag?.trim() || null;
    existing.description = input.description?.trim() || null;
    existing.images = cleanImages;
    existing.image_captions = captions;
    existing.image_key = primaryKey;
    existing.is_active = input.is_active;
    if (typeof input.sort_order === "number") existing.sort_order = input.sort_order;
    savePersistedState(store.state);
    broadcast("catalog:update", { kind: "design", id: existing.id });
    return existing;
  }

  const maxSort = store.state.designs.reduce((m, d) => Math.max(m, d.sort_order), 0);
  const created: StoredDesign = {
    id: cleanId,
    name: input.name.trim(),
    category: input.category.trim(),
    price: Math.max(1, Math.round(input.price)),
    unit: input.unit?.trim() || null,
    tag: input.tag?.trim() || null,
    description: input.description?.trim() || null,
    images: cleanImages,
    image_captions: captions,
    image_key: primaryKey,
    is_active: input.is_active,
    sort_order: typeof input.sort_order === "number" ? input.sort_order : maxSort + 1,
    created_at: new Date().toISOString(),
  };
  store.state.designs.push(created);
  savePersistedState(store.state);
  broadcast("catalog:update", { kind: "design", id: created.id });
  return created;
}

export function reorderDesigns(orderedIds: string[]): StoredDesign[] {
  const store = getStore();
  const orderMap = new Map(orderedIds.map((id, i) => [id, i + 1]));
  for (const d of store.state.designs) {
    const pos = orderMap.get(d.id);
    if (pos !== undefined) d.sort_order = pos;
  }
  savePersistedState(store.state);
  broadcast("catalog:update", { kind: "designs_order" });
  return listAllDesigns();
}

export function deleteDesign(designId: string): { ok: true } | { ok: false; message: string } {
  const store = getStore();
  const usedInOrders = store.state.orders.some((o) => o.design_ids.includes(designId));
  if (usedInOrders) {
    return {
      ok: false,
      message: "This design is part of existing orders. Hide it from the shop instead so buyers keep their downloads.",
    };
  }
  const idx = store.state.designs.findIndex((d) => d.id === designId);
  if (idx === -1) return { ok: false, message: "Design not found." };
  store.state.designs.splice(idx, 1);
  savePersistedState(store.state);
  broadcast("catalog:update", { kind: "design_deleted", id: designId });
  return { ok: true };
}

export function saveCategory(input: {
  originalName?: string | undefined;
  name: string;
  emoji: string;
  sort_order?: number | undefined;
}): { ok: true; category: Category } | { ok: false; message: string } {
  const store = getStore();
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Category name is required." };
  const emoji = input.emoji.trim() || "📐";

  if (input.originalName) {
    const existing = store.state.categories.find((c) => c.name === input.originalName);
    if (!existing) return { ok: false, message: "Category not found." };
    if (input.originalName !== name && store.state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, message: "A category with that name already exists." };
    }
    if (input.originalName !== name) {
      for (const d of store.state.designs) {
        if (d.category === input.originalName) d.category = name;
      }
      existing.name = name;
    }
    existing.emoji = emoji;
    if (typeof input.sort_order === "number") existing.sort_order = input.sort_order;
    savePersistedState(store.state);
    broadcast("catalog:update", { kind: "category", name });
    return { ok: true, category: existing };
  }

  if (store.state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, message: "That category already exists." };
  }
  const maxSort = store.state.categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
  const created: Category = {
    name,
    emoji,
    sort_order: typeof input.sort_order === "number" ? input.sort_order : maxSort + 1,
  };
  store.state.categories.push(created);
  savePersistedState(store.state);
  broadcast("catalog:update", { kind: "category", name });
  return { ok: true, category: created };
}

export function reorderCategories(orderedNames: string[]): Category[] {
  const store = getStore();
  const orderMap = new Map(orderedNames.map((n, i) => [n, i + 1]));
  for (const c of store.state.categories) {
    const pos = orderMap.get(c.name);
    if (pos !== undefined) c.sort_order = pos;
  }
  savePersistedState(store.state);
  broadcast("catalog:update", { kind: "categories_order" });
  return listCategories();
}

export function deleteCategory(name: string): { ok: true } | { ok: false; message: string } {
  const store = getStore();
  if (store.state.designs.some((d) => d.category === name)) {
    return { ok: false, message: "Move or delete the designs in this category first." };
  }
  const idx = store.state.categories.findIndex((c) => c.name === name);
  if (idx === -1) return { ok: false, message: "Category not found." };
  store.state.categories.splice(idx, 1);
  savePersistedState(store.state);
  broadcast("catalog:update", { kind: "category_deleted", name });
  return { ok: true };
}

export function saveSiteContentState(raw: unknown): { content: SiteContent; updatedAt: string } {
  const store = getStore();
  const resolved = resolveSiteContent(raw);
  const updatedAt = new Date().toISOString();
  store.state.site_content = resolved;
  store.state.site_updated_at = updatedAt;
  savePersistedState(store.state);
  broadcast("catalog:update", { kind: "site_content" });
  return { content: resolved, updatedAt };
}

export { promptCutoff };
