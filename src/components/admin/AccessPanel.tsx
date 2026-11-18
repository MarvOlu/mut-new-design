import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Loader2, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isOwnerEmail } from "@/integrations/supabase/client";
import {
  adminDeleteRoleMember,
  adminSaveRoleMember,
  type RoleMember,
  type UserRole,
} from "@/lib/admin.functions";
import { timeAgo } from "@/lib/admin-queries";

export function AccessPanel({
  myRole,
  myEmail,
  members,
  isLoading,
}: {
  myRole: UserRole;
  myEmail: string | null;
  members: RoleMember[];
  isLoading: boolean;
}) {
  const qc = useQueryClient();
  const saveMember = useServerFn(adminSaveRoleMember);
  const removeMember = useServerFn(adminDeleteRoleMember);

  const canEdit = myRole === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("admin");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["admin", "access"] });
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || !email.trim()) return;
    setBusy(true);
    try {
      const res = await saveMember({ data: { email: email.trim(), role } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Saved ${res.member.email} as ${res.member.role}.`);
      setEmail("");
      await refresh();
    } catch {
      toast.error("Could not save team member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(targetEmail: string, nextRole: UserRole) {
    if (!canEdit) return;
    try {
      const res = await saveMember({ data: { email: targetEmail, role: nextRole } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Updated ${targetEmail} to ${nextRole}.`);
      await refresh();
    } catch {
      toast.error("Could not update role.");
    }
  }

  async function handleDelete(targetEmail: string) {
    if (!canEdit) return;
    try {
      const res = await removeMember({ data: { email: targetEmail } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Removed ${targetEmail}.`);
      await refresh();
    } catch {
      toast.error("Could not remove member.");
    }
  }

  const adminCount = members.filter((m) => m.role === "admin").length;
  const userCount = members.filter((m) => m.role === "user").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-bold">Admins &amp; Users Access Control</h2>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{adminCount}</span>{" "}
              {adminCount === 1 ? "admin" : "admins"} ·{" "}
              <span className="font-mono tabular-nums">{userCount}</span>{" "}
              {userCount === 1 ? "user" : "users"} · Only authenticated admins can make edits.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Signed in as <span className="font-semibold text-foreground">{myEmail ?? "Owner"}</span>{" "}
            ·{" "}
            <span
              className={
                canEdit ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"
              }
            >
              {canEdit ? "Admin (Full access)" : "User (Read-only)"}
            </span>
          </div>
        </div>

        {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading team roles…</p>}

        {!isLoading && members.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Users className="mx-auto mb-2 h-7 w-7 opacity-40" />
            No additional team accounts added yet.
          </div>
        )}

        {!isLoading && members.length > 0 && (
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const ownerLocked = isOwnerEmail(m.email);
              const isSelf = myEmail === m.email.toLowerCase();
              return (
                <li
                  key={m.email}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm font-semibold">{m.email}</span>
                      {isSelf && <span className="text-xs text-primary font-semibold">· You</span>}
                      {ownerLocked && (
                        <span className="text-xs text-muted-foreground">· Primary owner</span>
                      )}
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {m.role === "admin" ? (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                          <span className="font-semibold text-emerald-700">Admin</span>
                          <span>
                            · Can upload, edit &amp; delete images, pricing &amp; site content
                          </span>
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5 text-amber-700" />
                          <span className="font-semibold text-amber-700">User</span>
                          <span>· Read-only dashboard viewer</span>
                        </>
                      )}
                      <span>· {timeAgo(m.updatedAt)}</span>
                    </p>
                  </div>

                  {canEdit && !ownerLocked && (
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.email, e.target.value as UserRole)}
                        aria-label={`Role for ${m.email}`}
                        className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs font-semibold"
                      >
                        <option value="admin">Admin</option>
                        <option value="user">User (Read-only)</option>
                      </select>
                      {!isSelf && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(m.email)}
                          aria-label={`Remove ${m.email}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="h-fit rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-bold">Add or Update Member Role</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Grant Admin permissions to trusted staff or assign User access for read-only order and
          catalog inspection.
        </p>

        <form onSubmit={handleAdd} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rbac-email">Email Address</Label>
            <Input
              id="rbac-email"
              type="email"
              required
              disabled={!canEdit}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rbac-role">Role</Label>
            <select
              id="rbac-role"
              disabled={!canEdit}
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="admin">Admin — Full edit &amp; delete rights</option>
              <option value="user">User — Read-only dashboard viewing</option>
            </select>
          </div>

          <Button type="submit" variant="cta" className="w-full" disabled={!canEdit || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Save Role
          </Button>
          {!canEdit && (
            <p className="text-xs text-amber-700">
              Your account is signed in with User (read-only) access. Only admins can modify roles.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
