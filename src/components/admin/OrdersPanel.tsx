import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShoppingBag,
  Smartphone,
  Users,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { adminCheckPayment, adminUpdateOrderStatus } from "@/lib/admin.functions";
import {
  displayPhone,
  orderDetailQuery,
  orderRef,
  timeAgo,
  type ActiveSession,
  type AdminOrder,
  type OrderEvent,
  type OrderFilter,
} from "@/lib/admin-queries";
import { designImage } from "@/lib/design-images";
import { orderStage, STAGE_META, type OrderStage } from "@/lib/order-stages";
import { formatKsh } from "@/lib/shop-queries";

const FILTER_TABS: { id: OrderFilter; label: string }[] = [
  { id: "all", label: "All orders" },
  { id: "successful", label: "Successful (Paid)" },
  { id: "received", label: "Received" },
  { id: "processing", label: "Processing" },
  { id: "completed", label: "Completed" },
  { id: "rejected", label: "Rejected" },
];

export function StageBadge({ stage }: { stage: OrderStage }) {
  const meta = STAGE_META[stage];
  if (stage === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        {meta.label}
      </span>
    );
  }
  if (stage === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary whitespace-nowrap">
        <Download className="h-3.5 w-3.5 shrink-0" />
        {meta.label}
      </span>
    );
  }
  if (stage === "received") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {meta.label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive whitespace-nowrap">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      {meta.label}
    </span>
  );
}

export function OrdersPanel({
  filter,
  onFilterChange,
  search,
  onSearchChange,
  orders,
  isLoading,
  revenueSummary,
  recentEvents,
  activeSessions,
  selectedOrderId,
  onSelectOrder,
  sseConnected,
}: {
  filter: OrderFilter;
  onFilterChange: (f: OrderFilter) => void;
  search: string;
  onSearchChange: (s: string) => void;
  orders: AdminOrder[];
  isLoading: boolean;
  revenueSummary: { paidCount: number; totalRevenue: number };
  recentEvents: OrderEvent[];
  activeSessions: ActiveSession[];
  selectedOrderId: string | null;
  onSelectOrder: (id: string | null) => void;
  sseConnected: boolean;
}) {
  const [drillView, setDrillView] = useState<"details" | "records">("details");

  function openJobDetails(orderId: string) {
    setDrillView("details");
    onSelectOrder(orderId);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">
      {/* Primary Orders Table / List */}
      <section className="min-w-0 rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-bold">Orders &amp; Jobs</h2>
            <p className="text-xs text-muted-foreground">
              {revenueSummary.paidCount} successful orders ·{" "}
              <span className="font-mono tabular-nums font-semibold text-foreground">
                {formatKsh(revenueSummary.totalRevenue)}
              </span>{" "}
              collected
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Phone, receipt or ref..."
              className="h-10 pl-9 text-sm"
            />
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/40 px-3 py-2">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onFilterChange(t.id)}
              className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === t.id
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        )}

        {!isLoading && orders.length === 0 && (
          <div className="px-4 py-12 text-center">
            <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-semibold">No matching orders</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Orders placed via M-PESA checkout will appear here automatically.
            </p>
          </div>
        )}

        {!isLoading && orders.length > 0 && (
          <>
            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Job Ref</th>
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 font-medium">Designs</th>
                    <th className="px-4 py-2.5 font-medium">Stage</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium">Placed</th>
                    <th className="w-8 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((o) => {
                    const stage = orderStage(o);
                    return (
                      <tr
                        key={o.id}
                        onClick={() => openJobDetails(o.id)}
                        className="cursor-pointer transition-colors hover:bg-muted/50"
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold whitespace-nowrap">
                          {orderRef(o.id)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          {displayPhone(o.phone)}
                          {o.mpesa_receipt && (
                            <span className="ml-2 text-muted-foreground">· {o.mpesa_receipt}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {o.design_ids.length} {o.design_ids.length === 1 ? "design" : "designs"}
                        </td>
                        <td className="px-4 py-3">
                          <StageBadge stage={stage} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-bold text-primary tabular-nums whitespace-nowrap">
                          {formatKsh(o.amount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {timeAgo(o.created_at)}
                        </td>
                        <td className="px-2 py-3 text-right text-muted-foreground">
                          <ChevronRight className="h-4 w-4" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile List */}
            <ul className="divide-y divide-border md:hidden">
              {orders.map((o) => {
                const stage = orderStage(o);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => openJobDetails(o.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold">{orderRef(o.id)}</span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <StageBadge stage={stage} />
                        </div>
                        <p className="font-mono text-xs text-muted-foreground">
                          {displayPhone(o.phone)} · {o.design_ids.length}{" "}
                          {o.design_ids.length === 1 ? "design" : "designs"} ·{" "}
                          {timeAgo(o.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-sm font-bold text-primary tabular-nums">
                          {formatKsh(o.amount)}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* Real-time Sessions & Live Notifications Sidebar */}
      <aside className="space-y-4">
        {/* Live Sessions */}
        <section className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Real-Time Sessions</h3>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${
                  sseConnected ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span className="font-mono tabular-nums">{activeSessions.length}</span> active
            </span>
          </div>
          {activeSessions.length === 0 ? (
            <p className="px-4 py-5 text-xs text-muted-foreground">
              Active storefront and dashboard sessions appear here live.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {activeSessions.slice(0, 8).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {s.role === "admin" ? "Owner session" : "Shopper"} ·{" "}
                      <span className="font-mono text-muted-foreground">{s.path}</span>
                    </p>
                    <p className="text-muted-foreground">
                      {s.role === "shopper" && s.basket_count > 0
                        ? `${s.basket_count} in basket · `
                        : ""}
                      {timeAgo(s.last_seen_at)}
                    </p>
                  </div>
                  <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Live Order Activity / Notifications */}
        <section className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Order Notifications</h3>
            </div>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              Latest {recentEvents.length}
            </span>
          </div>
          {recentEvents.length === 0 ? (
            <p className="px-4 py-5 text-xs text-muted-foreground">No order activity yet.</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
              {recentEvents.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => openJobDetails(ev.order_id)}
                    className="flex w-full items-start justify-between gap-2 px-4 py-2.5 text-left text-xs transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{ev.message}</p>
                      <p className="mt-0.5 font-mono text-muted-foreground">
                        {orderRef(ev.order_id)} · {timeAgo(ev.created_at)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      {/* Progressive 1-Click Drill-down Drawer: Job Details <-> Records */}
      <OrderDrilldownSheet
        orderId={selectedOrderId}
        view={drillView}
        onViewChange={setDrillView}
        onClose={() => onSelectOrder(null)}
      />
    </div>
  );
}

function OrderDrilldownSheet({
  orderId,
  view,
  onViewChange,
  onClose,
}: {
  orderId: string | null;
  view: "details" | "records";
  onViewChange: (v: "details" | "records") => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const detailQuery = useQuery({
    ...orderDetailQuery(orderId ?? "00000000-0000-0000-0000-000000000000"),
    enabled: Boolean(orderId),
  });
  const checkPayment = useServerFn(adminCheckPayment);
  const updateStatus = useServerFn(adminUpdateOrderStatus);
  const [busy, setBusy] = useState(false);

  async function refreshMpesa() {
    if (!orderId) return;
    setBusy(true);
    try {
      const res = await checkPayment({ data: { orderId } });
      if (!res.ok) {
        toast.error(res.message);
      } else if (res.changed) {
        toast.success(`Payment updated to ${res.status}.`);
      } else {
        toast.info(`Current M-PESA status: ${res.status}`);
      }
      await qc.invalidateQueries({ queryKey: ["admin"] });
    } catch {
      toast.error("Could not query M-PESA right now.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveOrder(status: "paid" | "failed") {
    if (!orderId) return;
    setBusy(true);
    try {
      const res = await updateStatus({ data: { orderId, status } });
      if (!res.ok) {
        toast.error(res.message);
      } else {
        toast.success(status === "paid" ? "Order confirmed as paid." : "Order marked as failed.");
        await qc.invalidateQueries({ queryKey: ["admin"] });
      }
    } catch {
      toast.error("Could not update order.");
    } finally {
      setBusy(false);
    }
  }

  const data = detailQuery.data;

  return (
    <Sheet open={Boolean(orderId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div>
              <SheetTitle className="font-mono text-base font-bold">
                {data?.order ? orderRef(data.order.id) : "Order"}
              </SheetTitle>
              <p className="text-xs text-muted-foreground">
                {view === "details" ? "Step 2 · Job Details" : "Step 3 · Audit Records"}
              </p>
            </div>
            {data?.order && <StageBadge stage={orderStage(data.order)} />}
          </div>

          {/* 1-click switch between Job Details and Records */}
          <div className="mt-3 flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => onViewChange("details")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === "details"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Job Details
            </button>
            <button
              type="button"
              onClick={() => onViewChange("records")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === "records"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Records ({data?.events.length ?? 0})
            </button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {detailQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading order…
            </div>
          )}

          {!detailQuery.isLoading && !data && (
            <p className="text-sm text-muted-foreground">Order not found.</p>
          )}

          {data && view === "details" && (
            <div className="space-y-6">
              <dl className="divide-y divide-border rounded-xl border border-border text-sm">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="font-mono font-bold text-primary tabular-nums">
                    {formatKsh(data.order.amount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-mono">{displayPhone(data.order.phone)}</dd>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">M-PESA Receipt</dt>
                  <dd className="font-mono">{data.order.mpesa_receipt || "—"}</dd>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">Placed</dt>
                  <dd className="font-mono text-xs tabular-nums">
                    {new Date(data.order.created_at).toLocaleString()}
                  </dd>
                </div>
                {data.order.paid_at && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <dt className="text-muted-foreground">Paid at</dt>
                    <dd className="font-mono text-xs tabular-nums">
                      {new Date(data.order.paid_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                {data.order.downloaded_at && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <dt className="text-muted-foreground">Downloaded at</dt>
                    <dd className="font-mono text-xs tabular-nums">
                      {new Date(data.order.downloaded_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                {data.order.result_desc && (
                  <div className="px-4 py-2.5">
                    <dt className="text-xs text-muted-foreground">M-PESA Message</dt>
                    <dd className="mt-1 text-xs">{data.order.result_desc}</dd>
                  </div>
                )}
              </dl>

              <div>
                <h3 className="text-sm font-bold">Designs in this order</h3>
                <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                  {data.designs.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 p-3">
                      <img
                        src={designImage(d.image_key)}
                        alt={d.name}
                        referrerPolicy="no-referrer"
                        className="h-12 w-14 shrink-0 rounded-lg object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{d.category}</p>
                      </div>
                      <span className="font-mono text-xs font-bold tabular-nums">
                        {formatKsh(d.price)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {data.order.status === "pending" && (
                <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-4">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Pending Payment Actions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={refreshMpesa}>
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Check M-PESA
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={busy}
                      onClick={() => resolveOrder("paid")}
                    >
                      <Smartphone className="h-3.5 w-3.5" /> Confirm Paid
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => resolveOrder("failed")}
                    >
                      Mark Failed
                    </Button>
                  </div>
                </div>
              )}

              {/* 1-click drill to Level 3: Records */}
              <Button
                type="button"
                variant="cta"
                size="lg"
                className="w-full justify-between"
                onClick={() => onViewChange("records")}
              >
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" /> View Records ({data.events.length})
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {data && view === "records" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Chronological Order Records</h3>
                <button
                  type="button"
                  onClick={() => onViewChange("details")}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  ← Back to Job Details
                </button>
              </div>
              {data.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No records logged for this order.</p>
              ) : (
                <ol className="divide-y divide-border rounded-xl border border-border">
                  {data.events.map((ev) => (
                    <li key={ev.id} className="space-y-1 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{ev.message}</span>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {new Date(ev.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        event: {ev.kind} · {new Date(ev.created_at).toLocaleDateString()}
                      </p>
                      {Object.keys(ev.detail).length > 0 && (
                        <pre className="mt-1.5 overflow-x-auto rounded-lg bg-muted p-2 font-mono text-[11px] text-muted-foreground">
                          {JSON.stringify(ev.detail, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
