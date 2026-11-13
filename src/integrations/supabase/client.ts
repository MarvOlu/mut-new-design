import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";

const LOCAL_SESSION_KEY = "mutken_local_owner_session";
export const LOCAL_OWNER_EMAIL = "oluoch540@gmail.com";
export const LOCAL_OWNER_TOKEN = "local-owner-session-token";

export function isSupabaseConfigured(): boolean {
  const url =
    import.meta.env["VITE_SUPABASE_URL"] ||
    (typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined);
  const key =
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    (typeof process !== "undefined" ? process.env["SUPABASE_PUBLISHABLE_KEY"] : undefined);
  return Boolean(url && key);
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function serverSupabaseUrl(publicUrl: string, supabaseKey: string): string | undefined {
  if (typeof window !== "undefined" || typeof process === "undefined") return undefined;
  const serverUrl = process.env["SUPABASE_URL"]?.replace(/\/+$/, "");
  if (
    !serverUrl ||
    serverUrl === publicUrl ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] !== supabaseKey
  )
    return undefined;
  return serverUrl;
}

function createSupabaseFetch(supabaseUrl: string, supabaseKey: string): typeof fetch {
  const publicUrl = supabaseUrl.replace(/\/+$/, "");
  const serverUrl = serverSupabaseUrl(publicUrl, supabaseKey);
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
    if (serverUrl) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(`${publicUrl}/`)) {
        const target = serverUrl + url.slice(publicUrl.length);
        const request =
          typeof input === "string" || input instanceof URL ? target : new Request(target, input);
        return fetch(request, { ...init, headers });
      }
    }
    return fetch(input, { ...init, headers });
  };
}

type AuthListener = (event: string, session: unknown) => void;
const localListeners = new Set<AuthListener>();

function readLocalSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { access_token: string; user: { id: string; email: string } };
  } catch {
    return null;
  }
}

function writeLocalSession(
  session: { access_token: string; user: { id: string; email: string } } | null,
) {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(LOCAL_SESSION_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

function notifyLocalAuth(event: string, session: unknown) {
  for (const cb of localListeners) {
    try {
      cb(event, session);
    } catch {
      // Ignore listener error
    }
  }
}

export function signInLocalOwner(email = LOCAL_OWNER_EMAIL) {
  const session = {
    access_token: LOCAL_OWNER_TOKEN,
    user: { id: "local-owner-1", email: email.trim() || LOCAL_OWNER_EMAIL },
  };
  writeLocalSession(session);
  notifyLocalAuth("SIGNED_IN", session);
  return session;
}

function createLocalFallbackClient() {
  const emptyQuery = () => {
    const res = { data: [], error: null, count: 0 };
    const chain: Record<string, unknown> = {
      then: (resolve: (v: typeof res) => unknown) => Promise.resolve(res).then(resolve),
    };
    const methods = [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "neq",
      "gt",
      "lt",
      "in",
      "is",
      "not",
      "or",
      "order",
      "limit",
      "maybeSingle",
      "single",
    ];
    for (const m of methods) {
      chain[m] = () => chain;
    }
    return chain;
  };

  return {
    auth: {
      async getSession() {
        const session = readLocalSession();
        return { data: { session }, error: null };
      },
      async getUser() {
        const session = readLocalSession();
        return { data: { user: session?.user ?? null }, error: null };
      },
      onAuthStateChange(cb: AuthListener) {
        localListeners.add(cb);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                localListeners.delete(cb);
              },
            },
          },
        };
      },
      async signInWithPassword({ email }: { email: string; password?: string }) {
        const session = signInLocalOwner(email);
        return { data: { user: session.user, session }, error: null };
      },
      async signUp({ email }: { email: string; password?: string }) {
        const session = signInLocalOwner(email);
        return { data: { user: session.user, session }, error: null };
      },
      async resetPasswordForEmail() {
        return { data: {}, error: null };
      },
      async updateUser() {
        const session = readLocalSession();
        return { data: { user: session?.user ?? null }, error: null };
      },
      async setSession() {
        const session = signInLocalOwner();
        return { data: { user: session.user, session }, error: null };
      },
      async signOut() {
        writeLocalSession(null);
        notifyLocalAuth("SIGNED_OUT", null);
        return { error: null };
      },
    },
    async rpc(fn: string) {
      if (fn === "has_role") {
        const session = readLocalSession();
        return { data: Boolean(session), error: null };
      }
      return { data: null, error: null };
    },
    from: () => emptyQuery(),
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
      }),
    },
  } as unknown as ReturnType<typeof createClient<Database>>;
}

function createSupabaseClient() {
  const SUPABASE_URL =
    import.meta.env["VITE_SUPABASE_URL"] ||
    (typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined);
  const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    (typeof process !== "undefined" ? process.env["SUPABASE_PUBLISHABLE_KEY"] : undefined);

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.warn(
      "[Mutken] Supabase env vars not configured — running with local server store and local owner auth.",
    );
    return createLocalFallbackClient();
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY),
    },
    auth: {
      storage: brokeredPreviewStorage(),
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
