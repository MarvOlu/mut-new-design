import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import "@lovable.dev/cloud-auth-js/styles.css";

import { GoogleButton } from "@/components/admin/GoogleButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getLocalOwnerSession,
  isSupabaseConfigured,
  LOCAL_OWNER_EMAIL,
  setServerBackendMode,
  signInLocalOwner,
  supabase,
} from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { backendModeQuery } from "@/lib/shop-queries";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Owner sign in — Mutken Architectural Designs" },
      {
        name: "description",
        content: "Sign in to manage the Mutken design shop: orders, designs and the website.",
      },
      { property: "og:title", content: "Owner sign in — Mutken Architectural Designs" },
      { property: "og:description", content: "Sign in to the Mutken shop dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(backendModeQuery),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "otp" | "forgot";

function isLovableHosted(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return [
    "lovableproject.com",
    "lovableproject-dev.com",
    "lovable.app",
    "gpt-eng.com",
    "gptengineer.run",
  ].some((z) => host === z || host.endsWith("." + z));
}

function AuthPage() {
  const navigate = useNavigate();
  const { data: backend } = useSuspenseQuery(backendModeQuery);
  const hasSupabase = backend.mode === "supabase" && isSupabaseConfigured();
  const onLovableHost = isLovableHosted();
  const showGoogleOAuth = hasSupabase && (onLovableHost || backend.googleOAuthEnabled);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState(hasSupabase ? "" : LOCAL_OWNER_EMAIL);
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpType, setOtpType] = useState<"email" | "signup">("email");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [invalidCreds, setInvalidCreds] = useState(false);

  useEffect(() => {
    setServerBackendMode(backend.mode);
  }, [backend.mode]);

  useEffect(() => {
    if (!hasSupabase) {
      if (getLocalOwnerSession()) navigate({ to: "/admin", replace: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/admin", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/admin", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [hasSupabase, navigate]);

  function switchMode(next: Mode) {
    setMode(next);
    setNotice(null);
    setInvalidCreds(false);
    setOtpSent(false);
    setOtpCode("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    setInvalidCreds(false);
    const cleanEmail = email.trim();
    try {
      if (!hasSupabase) {
        setServerBackendMode("local");
        signInLocalOwner(cleanEmail || LOCAL_OWNER_EMAIL);
        navigate({ to: "/admin", replace: true });
        return;
      }

      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) {
          if (error.message.toLowerCase().includes("invalid login credentials")) {
            setInvalidCreds(true);
          } else {
            toast.error(error.message);
          }
        } else if (data.session) {
          navigate({ to: "/admin", replace: true });
        }
      } else if (mode === "signup") {
        if (otpSent) {
          const { data, error } = await supabase.auth.verifyOtp({
            email: cleanEmail,
            token: otpCode.trim(),
            type: otpType,
          });
          if (error) toast.error(error.message);
          else if (data.session) navigate({ to: "/admin", replace: true });
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: window.location.origin + "/auth" },
        });
        if (error) {
          toast.error(error.message);
        } else if (data.session) {
          navigate({ to: "/admin", replace: true });
        } else {
          setOtpType("signup");
          setOtpSent(true);
          setNotice(
            `Confirmation sent to ${cleanEmail}. Click the email link or enter the 6-digit code below.`,
          );
        }
      } else if (mode === "otp") {
        if (!otpSent) {
          const { error } = await supabase.auth.signInWithOtp({
            email: cleanEmail,
            options: {
              shouldCreateUser: true,
              emailRedirectTo: window.location.origin + "/auth",
            },
          });
          if (error) {
            toast.error(error.message);
          } else {
            setOtpType("email");
            setOtpSent(true);
            setNotice(
              `Login code sent to ${cleanEmail}. Enter the code from your inbox or click the sign-in link.`,
            );
          }
        } else {
          const { data, error } = await supabase.auth.verifyOtp({
            email: cleanEmail,
            token: otpCode.trim(),
            type: "email",
          });
          if (error) toast.error(error.message);
          else if (data.session) navigate({ to: "/admin", replace: true });
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) toast.error(error.message);
        else setNotice("If that email has an account, a password reset link is on its way.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: "google" | "lovable") {
    if (!hasSupabase) {
      enterLocalDashboard();
      return;
    }
    if (onLovableHost) {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin + "/auth",
      });
      if (result.error)
        toast.error(result.error.message || "Sign in didn't work. Please try again.");
      return;
    }
    if (provider === "google" && backend.googleOAuthEnabled) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/auth" },
      });
      if (error) toast.error(error.message || "Google sign in is unavailable on this host.");
      return;
    }
    toast.error("Please sign in using your email and password below.");
  }

  function enterLocalDashboard() {
    setServerBackendMode("local");
    signInLocalOwner(email || LOCAL_OWNER_EMAIL);
    navigate({ to: "/admin", replace: true });
  }

  const title =
    mode === "signin"
      ? "Owner sign in"
      : mode === "signup"
        ? "Create owner account"
        : mode === "otp"
          ? "Sign in with email code"
          : "Reset your password";

  return (
    <div className="grid min-h-screen place-items-center bg-secondary px-4 py-10">
      <div className="w-full max-w-sm">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to the shop
        </Link>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-lift sm:p-8">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary font-display text-lg font-extrabold text-primary-foreground">
              M
            </span>
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
                  Running with the built-in shop backend. Open the owner dashboard directly or sign
                  in below.
                </p>
              </div>
              <Button
                type="button"
                variant="cta"
                size="lg"
                className="w-full"
                onClick={enterLocalDashboard}
              >
                Open Owner Dashboard
              </Button>
            </div>
          )}

          {hasSupabase && mode !== "forgot" && (
            <div className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
              {(
                [
                  { id: "signin", label: "Sign in" },
                  { id: "signup", label: "Register" },
                  { id: "otp", label: "Email code" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchMode(tab.id)}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
                    mode === tab.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {showGoogleOAuth && mode !== "forgot" && (
            <div className="space-y-3">
              <GoogleButton onClick={() => social("google")} />
              {onLovableHost && (
                <button
                  type="button"
                  className="lovable-auth-button w-full"
                  onClick={() => social("lovable")}
                >
                  Continue with Lovable
                </button>
              )}
              <div className="flex items-center gap-3 py-1 text-xs uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or{" "}
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}

          {invalidCreds && (
            <div className="mb-4 space-y-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs">
              <p className="font-semibold text-destructive">Invalid login credentials.</p>
              <p className="text-muted-foreground">
                If you haven&apos;t set a password for this email yet (or previously used Google),
                register a password or sign in with a one-time email code:
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="soft"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => switchMode("signup")}
                >
                  Create account
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => switchMode("otp")}
                >
                  Send email code
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
            </div>

            {(mode === "signin" || (mode === "signup" && !otpSent)) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">
                    {mode === "signup" ? "Choose password (min 8 chars)" : "Password"}
                  </Label>
                  {hasSupabase && mode === "signin" && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary hover:underline"
                      onClick={() => switchMode("forgot")}
                    >
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

            {(mode === "otp" || mode === "signup") && otpSent && (
              <div className="space-y-1.5">
                <Label htmlFor="otp-code">6-digit email code</Label>
                <Input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="h-11 font-mono tracking-widest"
                />
              </div>
            )}

            {notice && (
              <p className="rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
                {notice}
              </p>
            )}
            <Button
              type="submit"
              variant={hasSupabase ? "cta" : "soft"}
              size="lg"
              className="w-full"
              disabled={busy}
            >
              {busy && <Loader2 className="animate-spin" />}
              {mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? otpSent
                    ? "Verify & open dashboard"
                    : "Create account"
                  : mode === "otp"
                    ? otpSent
                      ? "Verify code & sign in"
                      : "Send login code"
                    : "Send reset link"}
            </Button>
          </form>

          {hasSupabase && mode === "forgot" && (
            <p className="mt-5 text-center text-sm text-muted-foreground">
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => switchMode("signin")}
              >
                Back to sign in
              </button>
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Only the shop owner&apos;s account can open the dashboard.
        </p>
      </div>
    </div>
  );
}
