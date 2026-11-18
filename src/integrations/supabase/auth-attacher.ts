import { createMiddleware } from "@tanstack/react-start";
import {
  ensureLocalOwnerSession,
  getLocalOwnerSession,
  getServerBackendMode,
  isSupabaseConfigured,
  supabase,
} from "./client";

export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let token: string | undefined;
    try {
      const serverMode = getServerBackendMode();
      if (serverMode === "local") {
        token = (getLocalOwnerSession() ?? ensureLocalOwnerSession(true))?.access_token;
      } else {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
        if (!token && (!isSupabaseConfigured() || serverMode === null)) {
          token = getLocalOwnerSession()?.access_token ?? ensureLocalOwnerSession()?.access_token;
        }
      }
    } catch {
      token = getLocalOwnerSession()?.access_token;
    }
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
