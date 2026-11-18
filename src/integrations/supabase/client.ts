import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";

const LOCAL_SESSION_KEY = "mutken_local_owner_session";
const LOCAL_SIGNED_OUT_KEY = "mutken_local_owner_signed_out";
export const OWNER_EMAILS = ["oluoch542@gmail.com", "oluoch540@gmail.com"] as const;
export const LOCAL_OWNER_EMAIL = "oluoch542@gmail.com";
export const LOCAL_OWNER_TOKEN = "local-owner-session-token";

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (OWNER_EMAILS as readonly string[]).includes(normalized);
}

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

type LocalOwnerSession = { access_token: string; user: { id: string; email: string } };
type AuthListener = (event: string, session: unknown) => void;
const localListeners = new Set<AuthListener>();
let memoryLocalSession: LocalOwnerSession | null = null;
let memorySignedOut = false;

function readSignedOutFlag(): boolean {
  if (memorySignedOut) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(LOCAL_SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSignedOutFlag(value: boolean) {
  memorySignedOut = value;
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.sessionStorage.setItem(LOCAL_SIGNED_OUT_KEY, "1");
    } else {
      window.sessionStorage.removeItem(LOCAL_SIGNED_OUT_KEY);
    }
  } catch {
    // Ignore restricted storage in sandboxed iframes
  }
}

function readLocalSession(): LocalOwnerSession | null {
  if (memoryLocalSession) return memoryLocalSession;
  if (typeof window === "undefined") return null;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = storage.getItem(LOCAL_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LocalOwnerSession;
        if (parsed?.access_token && parsed?.user?.id) {
          memoryLocalSession = parsed;
          return parsed;
        }
      }
    } catch {
      // Storage may be blocked in third-party iframe contexts
    }
  }
  return null;
}

function writeLocalSession(session: LocalOwnerSession | null) {
  memoryLocalSession = session;
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      if (session) {
        storage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
      } else {
        storage.removeItem(LOCAL_SESSION_KEY);
      }
    } catch {
      // Ignore storage quota or third-party iframe restrictions
    }
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

export function signInLocalOwner(email = LOCAL_OWNER_EMAIL): LocalOwnerSession {
  writeSignedOutFlag(false);
  const session: LocalOwnerSession = {
    access_token: LOCAL_OWNER_TOKEN,
    user: { id: "local-owner-1", email: email.trim() || LOCAL_OWNER_EMAIL },
  };
  writeLocalSession(session);
  notifyLocalAuth("SIGNED_IN", session);
  return session;
}

export function signOutLocalOwner() {
  writeSignedOutFlag(true);
  writeLocalSession(null);
  notifyLocalAuth("SIGNED_OUT", null);
}

let serverModeCache: "local" | "supabase" | null = null;

export function setServerBackendMode(mode: "local" | "supabase") {
  serverModeCache = mode;
}

export function getServerBackendMode(): "local" | "supabase" | null {
  return serverModeCache;
}

export function getLocalOwnerSession(): LocalOwnerSession | null {
  return readLocalSession();
}

export function ensureLocalOwnerSession(forceLocal = false): LocalOwnerSession | null {
  if (!forceLocal && isSupabaseConfigured() && serverModeCache !== "local") return null;
  const existing = readLocalSession();
  if (existing) return existing;
  if (readSignedOutFlag()) return null;
  return signInLocalOwner(LOCAL_OWNER_EMAIL);
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
        writeSignedOutFlag(true);
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

function safeAuthStorage() {
  const base = brokeredPreviewStorage();
  if (!base) return undefined;
  const mem = new Map<string, string>();
  return {
    getItem: async (key: string) => {
      try {
        return await base.getItem(key);
      } catch {
        try {
          return window.sessionStorage.getItem(key);
        } catch {
          return mem.get(key) ?? null;
        }
      }
    },
    setItem: async (key: string, value: string) => {
      mem.set(key, value);
      try {
        await base.setItem(key, value);
      } catch {
        try {
          window.sessionStorage.setItem(key, value);
        } catch {
          // Stored in memory
        }
      }
    },
    removeItem: async (key: string) => {
      mem.delete(key);
      try {
        await base.removeItem(key);
      } catch {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          // Ignore
        }
      }
    },
  };
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
      storage: safeAuthStorage(),
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
