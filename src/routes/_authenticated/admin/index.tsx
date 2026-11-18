import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FolderKanban,
  LayoutTemplate,
  LogOut,
  Package,
  ShieldCheck,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AccessPanel } from "@/components/admin/AccessPanel";
import { CategoriesPanel } from "@/components/admin/CategoriesPanel";
import { DesignsPanel } from "@/components/admin/DesignsPanel";
import { OrdersPanel } from "@/components/admin/OrdersPanel";
import { PageMakerPanel } from "@/components/admin/PageMakerPanel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { isSupabaseConfigured, signOutLocalOwner, supabase } from "@/integrations/supabase/client";
import {
  accessControlQuery,
  adminCategoriesQuery,
  adminDesignsQuery,
  adminSiteContentQuery,
  dashboardSnapshotQuery,
  orderRef,
  timeAgo,
  type ActiveSession,
  type OrderEvent,
  type OrderFilter,
} from "@/lib/admin-queries";
import { STAGE_META, STAGE_ORDER, type OrderStage } from "@/lib/order-stages";
import { DEFAULT_SITE_CONTENT } from "@/lib/site-content";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Mutken Architectural Designs" },
      {
        name: "description",
        content: "Backend management dashboard for Mutken Architectural Designs.",
      },
      { property: "og:title", content: "Dashboard — Mutken" },
      {
        property: "og:description",
        content: "Backend management dashboard for Mutken Architectural Designs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminDashboardIndexPage,
});

type TabId = "orders" | "designs" | "categories" | "pagemaker" | "access";

const NAV_TABS: { id: TabId; label: string; icon: typeof ShoppingBag }[] = [
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "designs", label: "Designs", icon: Package },
  { id: "categories", label: "Categories", icon: FolderKanban },
  { id: "pagemaker", label: "Page Maker", icon: LayoutTemplate },
  { id: "access", label: "Access", icon: ShieldCheck },
];

const STAGE_ICONS: Record<OrderStage, typeof Clock> = {
  received: Clock,
  processing: Download,
  rejected: XCircle,
  completed: CheckCircle2,
};

function AdminDashboardIndexPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  async function signOut() {
    signOutLocalOwner();
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut().catch(() => {});
    }
    navigate({ to: "/auth", replace: true });
  }

  return <Dashboard userEmail={user.email ?? null} onSignOut={signOut} />;
}

function Dashboard({ userEmail, onSignOut }: { userEmail: string | null; onSignOut: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>("orders");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveNotifications, setLiveNotifications] = useState<OrderEvent[]>([]);
  const [liveSessions, setLiveSessions] = useState<ActiveSession[]>([]);
  const [sseConnected, setSseConnected] = useState(false);

  const sessionIdRef = useRef<string>("");
  if (!sessionIdRef.current && typeof window !== "undefined") {
    const existing = window.sessionStorage.getItem("mutken-admin-sid");
    sessionIdRef.current = existing || `admin-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem("mutken-admin-sid", sessionIdRef.current);
  }

  const snapshot = useQuery({
    ...dashboardSnapshotQuery(orderFilter, search),
    refetchInterval: 20_000,
  });
  const designsQ = useQuery(adminDesignsQuery);
  const categoriesQ = useQuery(adminCategoriesQuery);
  const siteQ = useQuery(adminSiteContentQuery);
  const accessQ = useQuery(accessControlQuery);

  const myRole = snapshot.data?.role ?? accessQ.data?.myRole ?? "user";
  const canEdit = myRole === "admin";

  // Real-time SSE connection for live order notifications and active shopper/admin sessions
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sid = sessionIdRef.current || "admin-live";
    const es = new EventSource(`/api/admin/events?sessionId=${encodeURIComponent(sid)}`);

    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    es.addEventListener("init", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          sessions?: ActiveSession[];
          recentEvents?: OrderEvent[];
        };
        if (data.sessions) setLiveSessions(data.sessions);
        if (data.recentEvents) setLiveNotifications(data.recentEvents);
      } catch {
        // Ignore malformed init
      }
    });

    es.addEventListener("ping", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { sessions?: ActiveSession[] };
        if (data.sessions) setLiveSessions(data.sessions);
      } catch {
        // Ignore
      }
    });

    es.addEventListener("sessions:update", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          payload?: { sessions?: ActiveSession[] };
        };
        if (data.payload?.sessions) setLiveSessions(data.payload.sessions);
      } catch {
        // Ignore
      }
    });

    const handleOrderStreamEvent = (e: Event) => {
      try {
        const parsed = JSON.parse((e as MessageEvent).data) as {
          type?: string;
          payload?: { event?: OrderEvent };
        };
        const evt = parsed.payload?.event;
        if (evt) {
          setLiveNotifications((prev) =>
            [evt, ...prev.filter((x) => x.id !== evt.id)].slice(0, 30),
          );
          setUnreadCount((c) => c + 1);
          toast.info(`${evt.message} · ${orderRef(evt.order_id)}`, {
            action: {
              label: "Inspect",
              onClick: () => {
                setTab("orders");
                setSelectedOrderId(evt.order_id);
              },
            },
          });
        }
        qc.invalidateQueries({ queryKey: ["admin", "snapshot"] });
        if (evt?.order_id) {
          qc.invalidateQueries({ queryKey: ["admin", "orders", "detail", evt.order_id] });
        }
      } catch {
        // Ignore
      }
    };

    for (const evtName of ["order:created", "order:paid", "order:failed", "order:download"]) {
      es.addEventListener(evtName, handleOrderStreamEvent);
    }

    es.addEventListener("catalog:update", () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
    });

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [qc]);

  const counts = snapshot.data?.counts;
  const activeSessions =
    liveSessions.length > 0 ? liveSessions : (snapshot.data?.activeSessions ?? []);
  const notifications =
    liveNotifications.length > 0 ? liveNotifications : (snapshot.data?.recentEvents ?? []);

  function clickStageCard(stage: OrderStage) {
    setTab("orders");
    setOrderFilter((prev) => (prev === stage ? "all" : stage));
  }

  return (
    <div className="min-h-screen bg-secondary/35">
      {/* Single-row 3-zone top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2.5 font-display text-base font-extrabold text-primary whitespace-nowrap"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">
              M
            </span>
            <span>Mutken Admin</span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            {NAV_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap shrink-0 text-sm font-semibold transition-colors ${
                  tab === t.id
                    ? "text-primary underline underline-offset-8 decoration-2"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative h-10 w-10"
              onClick={() => {
                setUnreadCount(0);
                setNotificationsOpen(true);
              }}
              aria-label="Order notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold text-accent-foreground tabular-nums">
                  {unreadCount}
                </span>
              )}
            </Button>
            <Button
              asChild
              variant="soft"
              size="sm"
              className="hidden whitespace-nowrap sm:inline-flex"
            >
              <Link to="/">
                View shop <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={onSignOut}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>

        {/* Mobile / Tablet touch navigation strip */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-3 py-1.5 md:hidden">
          {NAV_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === t.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {!snapshot.isLoading && !canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <span>
              Signed in as <strong>{userEmail ?? "User"}</strong> with <strong>User</strong>{" "}
              (read-only) role. Only authenticated Admins can upload/edit/delete images, prices, or
              website content.
            </span>
            <button
              type="button"
              onClick={() => setTab("access")}
              className="font-semibold underline hover:no-underline"
            >
              View Access Roles
            </button>
          </div>
        )}

        {snapshot.isError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>
              Could not load dashboard data:{" "}
              {snapshot.error instanceof Error ? snapshot.error.message : "Unknown error"}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => snapshot.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {/* Top of screen opens on four card counts: Received, Processing, Rejected, Completed */}
        <section aria-label="Order stage counts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {STAGE_ORDER.map((stage) => {
            const Icon = STAGE_ICONS[stage];
            const active = tab === "orders" && orderFilter === stage;
            return (
              <button
                key={stage}
                type="button"
                onClick={() => clickStageCard(stage)}
                className={`flex flex-col justify-between rounded-2xl border p-4 text-left transition-colors ${
                  active
                    ? "border-primary bg-secondary/60"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {STAGE_META[stage].label}
                  </span>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-2 font-mono text-3xl font-extrabold tabular-nums">
                  {counts?.[stage] ?? "–"}
                </p>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                  {STAGE_META[stage].hint}
                </p>
              </button>
            );
          })}
        </section>

        {/* Active Workspace View */}
        {tab === "orders" && (
          <OrdersPanel
            filter={orderFilter}
            onFilterChange={setOrderFilter}
            search={search}
            onSearchChange={setSearch}
            orders={snapshot.data?.orders ?? []}
            isLoading={snapshot.isLoading}
            revenueSummary={snapshot.data?.revenueSummary ?? { paidCount: 0, totalRevenue: 0 }}
            recentEvents={notifications}
            activeSessions={activeSessions}
            selectedOrderId={selectedOrderId}
            onSelectOrder={setSelectedOrderId}
            sseConnected={sseConnected}
            canEdit={canEdit}
          />
        )}

        {tab === "designs" && (
          <DesignsPanel
            designs={designsQ.data ?? []}
            categories={categoriesQ.data ?? []}
            isLoading={designsQ.isLoading}
            canEdit={canEdit}
          />
        )}

        {tab === "categories" && (
          <CategoriesPanel
            categories={categoriesQ.data ?? []}
            isLoading={categoriesQ.isLoading}
            canEdit={canEdit}
          />
        )}

        {tab === "pagemaker" && (
          <PageMakerPanel
            siteContent={siteQ.data?.content ?? DEFAULT_SITE_CONTENT}
            updatedAt={siteQ.data?.updatedAt ?? null}
            canEdit={canEdit}
          />
        )}

        {tab === "access" && (
          <AccessPanel
            myRole={myRole}
            myEmail={accessQ.data?.myEmail ?? userEmail}
            members={accessQ.data?.members ?? []}
            isLoading={accessQ.isLoading}
          />
        )}
      </main>

      {/* Slide-over Notifications Drawer */}
      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-6 py-4">
            <SheetTitle className="text-base font-bold">Real-Time Order Notifications</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No order notifications yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((ev) => (
                  <li key={ev.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationsOpen(false);
                        setTab("orders");
                        setSelectedOrderId(ev.order_id);
                      }}
                      className="flex w-full flex-col gap-1 px-6 py-3.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <span className="text-sm font-semibold">{ev.message}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {orderRef(ev.order_id)} · {timeAgo(ev.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
