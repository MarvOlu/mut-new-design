import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import "@lovable.dev/cloud-auth-js/styles.css";

import { GoogleButton } from "@/components/admin/GoogleButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured, LOCAL_OWNER_EMAIL, signInLocalOwner, supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Owner sign in — Mutken Architectural Designs" },
      { name: "description", content: "Sign in to manage the Mutken design shop: orders, designs and the website." },
      { property: "og:title", content: "Owner sign in — Mutken Architectural Designs" },
      { property: "og:description", content: "Sign in to the Mutken shop dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const hasSupabase = isSupabaseConfigured();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState(hasSupabase ? "" : LOCAL_OWNER_EMAIL);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/admin", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/admin", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) toast.error(error.message);
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/auth" },
        });
        if (error) toast.error(error.message);
        else setNotice("Check your email and click the confirmation link, then sign in here.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) toast.error(error.message);
        else setNotice("If that email has an account, a reset link is on its way.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: "google" | "lovable") {
    const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/auth" });
    if (result.error) toast.error(result.error.message || "Sign in didn't work. Please try again.");
  }

  function enterLocalDashboard() {
    signInLocalOwner(email || LOCAL_OWNER_EMAIL);
    navigate({ to: "/admin", replace: true });
  }

  const title = mode === "signin" ? "Owner sign in" : mode === "signup" ? "Create your owner account" : "Reset your password";

  return (
    <div className="grid min-h-screen place-items-center bg-secondary px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to the shop
        </Link>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-lift sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary font-display text-lg font-extrabold text-primary-foreground">M</span>
            <div>
              <h1 className="text-xl font-extrabold">{title}</h1>
              <p className="text-sm text-muted-foreground">Mutken shop dashboard</p>
            </div>
          </div>

          {!hasSupabase && (
            <div className="mb-5 space-y-3 rounded-2xl border border-border bg-muted/60 p-4">
              <div className="flex items-start gap-2.5 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-muted-foreground">
                  Running with the built-in shop backend. Sign in below or open the owner workspace directly.
                </p>
              </div>
              <Button type="button" variant="cta" size="lg" className="w-full" onClick={enterLocalDashboard}>
                Open Owner Dashboard
              </Button>
            </div>
          )}

          {hasSupabase && mode !== "forgot" && (
            <div className="space-y-3">
              <GoogleButton onClick={() => social("google")} />
              <button type="button" className="lovable-auth-button w-full" onClick={() => social("lovable")}>
                Continue with Lovable
              </button>
              <div className="flex items-center gap-3 py-1 text-xs uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {hasSupabase && mode === "signin" && (
                    <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setMode("forgot")}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  required={hasSupabase}
                  minLength={hasSupabase ? 8 : undefined}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11"
                />
              </div>
            )}
            {notice && <p className="rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">{notice}</p>}
            <Button type="submit" variant={hasSupabase ? "cta" : "soft"} size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
            </Button>
          </form>

          {hasSupabase && (
            <p className="mt-5 text-center text-sm text-muted-foreground">
              {mode === "signin" ? (
                <>
                  First time here?{" "}
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setMode("signup")}>
                    Create an account
                  </button>
                </>
              ) : (
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setMode("signin")}>
                  Back to sign in
                </button>
              )}
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Only the shop owner's account can open the dashboard.</p>
      </div>
    </div>
  );
}
