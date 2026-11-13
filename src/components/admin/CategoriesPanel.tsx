import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, GripVertical, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminDeleteCategory,
  adminReorderCategories,
  adminSaveCategory,
  type AdminCategoryRow,
} from "@/lib/admin.functions";
import { SHOP_KEYS } from "@/lib/admin-queries";

export function CategoriesPanel({
  categories,
  isLoading,
}: {
  categories: AdminCategoryRow[];
  isLoading: boolean;
}) {
  const qc = useQueryClient();
  const saveCategory = useServerFn(adminSaveCategory);
  const reorderCategories = useServerFn(adminReorderCategories);
  const deleteCategory = useServerFn(adminDeleteCategory);

  const [ordered, setOrdered] = useState<AdminCategoryRow[]>(categories);
  const [dragName, setDragName] = useState<string | null>(null);
  const [editingOriginal, setEditingOriginal] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📐");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOrdered(categories);
  }, [categories]);

  async function invalidateAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin"] }),
      ...SHOP_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })),
    ]);
  }

  async function commitOrder(next: AdminCategoryRow[]) {
    setOrdered(next);
    try {
      await reorderCategories({ data: { orderedNames: next.map((c) => c.name) } });
      await invalidateAll();
      toast.success("Category order updated.");
    } catch {
      toast.error("Could not reorder categories.");
    }
  }

  function handleDrop(targetName: string) {
    if (!dragName || dragName === targetName) return;
    const from = ordered.findIndex((c) => c.name === dragName);
    const to = ordered.findIndex((c) => c.name === targetName);
    if (from === -1 || to === -1) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setDragName(null);
    commitOrder(next);
  }

  function moveBy(catName: string, delta: -1 | 1) {
    const idx = ordered.findIndex((c) => c.name === catName);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const [moved] = next.splice(idx, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    commitOrder(next);
  }

  function startEdit(c: AdminCategoryRow) {
    setEditingOriginal(c.name);
    setName(c.name);
    setEmoji(c.emoji);
  }

  function cancelEdit() {
    setEditingOriginal(null);
    setName("");
    setEmoji("📐");
  }

  async function submitForm(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await saveCategory({
        data: {
          ...(editingOriginal ? { originalName: editingOriginal } : {}),
          name: name.trim(),
          emoji: emoji.trim() || "📐",
        },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      await invalidateAll();
      toast.success(editingOriginal ? "Category updated." : "Category added.");
      cancelEdit();
    } catch {
      toast.error("Could not save category.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(c: AdminCategoryRow) {
    try {
      const res = await deleteCategory({ data: { name: c.name } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      await invalidateAll();
      toast.success(`Deleted ${c.name}.`);
    } catch {
      toast.error("Could not delete category.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <h2 className="text-base font-bold">Shop by Category Cards</h2>
          <p className="text-xs text-muted-foreground">
            Only categories with at least one active design appear on the main storefront. Drag to
            reorder.
          </p>
        </div>

        {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading categories…</p>}
        {!isLoading && ordered.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No categories yet.</p>
        )}

        <ul className="divide-y divide-border">
          {ordered.map((c, idx) => {
            const shownOnShop = c.activeDesignCount > 0;
            return (
              <li
                key={c.name}
                draggable
                onDragStart={() => setDragName(c.name)}
                onDragOver={(e: DragEvent) => e.preventDefault()}
                onDrop={() => handleDrop(c.name)}
                className={`flex items-center justify-between gap-3 p-4 transition-colors ${
                  dragName === c.name ? "bg-muted/60 opacity-60" : "hover:bg-muted/30"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-muted-foreground sm:block" />
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-xl">
                    {c.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">{c.activeDesignCount}</span> active{" "}
                      {c.activeDesignCount === 1 ? "design" : "designs"} ·{" "}
                      <span
                        className={
                          shownOnShop ? "font-semibold text-emerald-700" : "text-amber-700"
                        }
                      >
                        {shownOnShop ? "Shown on shop" : "Hidden (no active designs)"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    disabled={idx === 0}
                    onClick={() => moveBy(c.name, -1)}
                    aria-label={`Move ${c.name} up`}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    disabled={idx === ordered.length - 1}
                    onClick={() => moveBy(c.name, 1)}
                    aria-label={`Move ${c.name} down`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => startEdit(c)}
                    aria-label={`Edit ${c.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-destructive hover:text-destructive"
                    disabled={c.totalDesignCount > 0}
                    onClick={() => handleDelete(c)}
                    title={
                      c.totalDesignCount > 0
                        ? "Move designs out of this category before deleting"
                        : "Delete category"
                    }
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="h-fit rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-bold">
          {editingOriginal ? `Edit "${editingOriginal}"` : "Add Category"}
        </h3>
        <form onSubmit={submitForm} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Category Name</Label>
            <Input
              id="cat-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bungalows"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-emoji">Icon / Emoji</Label>
            <Input
              id="cat-emoji"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="🏡"
              maxLength={8}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="cta" className="flex-1" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editingOriginal ? "Save" : "Add Category"}
            </Button>
            {editingOriginal && (
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
