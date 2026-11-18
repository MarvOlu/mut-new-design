import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import {
  ensureLocalOwnerSession,
  setServerBackendMode,
  supabase,
} from "@/integrations/supabase/client";
import { backendModeQuery } from "@/lib/shop-queries";

// Signed-in area. Client-only: the session lives in browser storage, which the server can't read.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const backend = await context.queryClient.ensureQueryData(backendModeQuery);
    setServerBackendMode(backend.mode);
    if (backend.mode === "local") {
      const localSession = ensureLocalOwnerSession(true);
      if (!localSession) throw redirect({ to: "/auth" });
      return { user: localSession.user, backendMode: backend.mode };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user, backendMode: backend.mode };
  },
  component: () => <Outlet />,
});
