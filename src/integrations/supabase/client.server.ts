import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function createSupabaseAdminClient() {
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(", ")}.`);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_SERVICE_ROLE_KEY),
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});

let healthCache: { ok: boolean; checkedAt: number } | null = null;
const HEALTH_TTL_MS = 60_000;

export function markSupabaseAdminUnhealthy() {
  healthCache = { ok: false, checkedAt: Date.now() };
}

/**
 * Verifies that SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are not only set,
 * but actually accepted by Supabase (e.g. catches invalid/rotated service keys).
 */
export async function checkSupabaseAdminHealth(): Promise<boolean> {
  if (!isSupabaseAdminConfigured()) return false;
  if (healthCache && Date.now() - healthCache.checkedAt < HEALTH_TTL_MS) {
    return healthCache.ok;
  }
  try {
    const { error } = await supabaseAdmin.from("designs").select("id").limit(1);
    const ok = !error;
    if (!ok) {
      console.warn("[Supabase Admin] Key check failed, using local store fallback:", error.message);
    }
    healthCache = { ok, checkedAt: Date.now() };
    return ok;
  } catch (e) {
    console.warn("[Supabase Admin] Health probe failed, using local store fallback:", e);
    healthCache = { ok: false, checkedAt: Date.now() };
    return false;
  }
}
