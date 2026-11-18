import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Mutken Architectural Designs" },
      { name: "description", content: "Choose a new password for your Mutken dashboard account." },
      { property: "og:title", content: "Set a new password — Mutken" },
      {
        property: "og:description",
        content: "Choose a new password for your Mutken dashboard account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setIsRecovery(true);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setIsRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated.");
    navigate({ to: "/admin", replace: true });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-secondary px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card p-6 shadow-lift sm:p-8"
      >
        <h1 className="text-xl font-extrabold">Set a new password</h1>
        {!isRecovery && (
          <p className="text-sm text-muted-foreground">
            Open this page from the reset link in your email.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
          />
        </div>
        <Button
          type="submit"
          variant="cta"
          size="lg"
          className="w-full"
          disabled={busy || !isRecovery}
        >
          {busy && <Loader2 className="animate-spin" />} Save password
        </Button>
      </form>
    </div>
  );
}
