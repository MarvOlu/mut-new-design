import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Crop,
  Eye,
  EyeOff,
  FileDown,
  GripVertical,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";

import { ImageEditorDialog, type ImageEditorTarget } from "@/components/admin/ImageEditorDialog";
import { MediaLibraryPanel } from "@/components/admin/MediaLibraryPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  adminDeleteDesign,
  adminDeleteDesignFile,
  adminDeleteImage,
  adminReorderDesigns,
  adminSaveDesign,
  adminUploadDesignFile,
  adminUploadImage,
  type AdminCategoryRow,
} from "@/lib/admin.functions";
import {
  designFilesQuery,
  mediaLibraryQuery,
  SHOP_KEYS,
  type AdminDesign,
} from "@/lib/admin-queries";
import { BUNDLED_IMAGE_OPTIONS, designImage } from "@/lib/design-images";
import { optimizeImageFile } from "@/lib/image-optimizer";
import { formatKsh } from "@/lib/shop-queries";

export function DesignsPanel({
  designs,
  categories,
  isLoading,
  canEdit,
}: {
  designs: AdminDesign[];
  categories: AdminCategoryRow[];
  isLoading: boolean;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const reorderDesigns = useServerFn(adminReorderDesigns);
  const saveDesign = useServerFn(adminSaveDesign);
  const removeDesign = useServerFn(adminDeleteDesign);
  const mediaQ = useQuery(mediaLibraryQuery);

  const [subView, setSubView] = useState<"catalog" | "media">("catalog");
  const [ordered, setOrdered] = useState<AdminDesign[]>(designs);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminDesign | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);

  useEffect(() => {
    setOrdered(designs);
    const nextPrices: Record<string, string> = {};
    for (const d of designs) nextPrices[d.id] = String(d.price);
    setPriceDrafts(nextPrices);
  }, [designs]);

  const visible = ordered.filter(
    (d) =>
      (catFilter === "All" || d.category === catFilter) &&
      d.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function commitOrder(next: AdminDesign[]) {
    if (!canEdit) return;
    setOrdered(next);
    try {
      await reorderDesigns({ data: { orderedIds: next.map((d) => d.id) } });
      await invalidateAll();
      toast.success("Design order updated.");
    } catch {
      toast.error("Could not save design order.");
    }
  }

  async function invalidateAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin"] }),
      ...SHOP_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })),
    ]);
  }

  function handleDrop(targetId: string) {
    if (!canEdit || !dragId || dragId === targetId) return;
    const from = ordered.findIndex((d) => d.id === dragId);
    const to = ordered.findIndex((d) => d.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setDragId(null);
    commitOrder(next);
  }

  function moveBy(id: string, delta: -1 | 1) {
    if (!canEdit) return;
    const idx = ordered.findIndex((d) => d.id === id);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const [moved] = next.splice(idx, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    commitOrder(next);
  }

  async function saveInlinePrice(d: AdminDesign) {
    if (!canEdit) return;
    const raw = Number(priceDrafts[d.id]);
    if (!Number.isFinite(raw) || raw <= 0) {
      toast.error("Enter a valid positive price in KSh.");
      return;
    }
    const nextPrice = Math.round(raw);
    if (nextPrice === d.price) return;
    setSavingPriceId(d.id);
    try {
      const res = await saveDesign({
        data: {
          id: d.id,
          name: d.name,
          category: d.category,
          price: nextPrice,
          unit: d.unit,
          tag: d.tag,
          description: d.description,
          images: d.images,
          image_captions: d.image_captions ?? {},
          image_key: d.image_key,
          is_active: d.is_active,
          sort_order: d.sort_order,
        },
      });
      if (!res.ok) toast.error(res.message);
      else {
        await invalidateAll();
        toast.success(`Updated ${d.name} price to ${formatKsh(nextPrice)}.`);
      }
    } catch {
      toast.error("Could not update price.");
    } finally {
      setSavingPriceId(null);
    }
  }

  async function toggleActive(d: AdminDesign) {
    if (!canEdit) return;
    try {
      const res = await saveDesign({
        data: {
          id: d.id,
          name: d.name,
          category: d.category,
          price: d.price,
          unit: d.unit,
          tag: d.tag,
          description: d.description,
          images: d.images,
          image_captions: d.image_captions ?? {},
          image_key: d.image_key,
          is_active: !d.is_active,
          sort_order: d.sort_order,
        },
      });
      if (!res.ok) toast.error(res.message);
      else {
        await invalidateAll();
        toast.success(
          !d.is_active ? `${d.name} is now live on the shop.` : `${d.name} hidden from the shop.`,
        );
      }
    } catch {
      toast.error("Could not update design.");
    }
  }

  async function handleDelete(d: AdminDesign) {
    if (!canEdit) return;
    try {
      const res = await removeDesign({ data: { designId: d.id } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      await invalidateAll();
      toast.success(`${d.name} deleted.`);
    } catch {
      toast.error("Could not delete design.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold">Designs, Pricing &amp; Image Studio</h2>
          <p className="text-xs text-muted-foreground">
            Manage designs, quick prices, auto-optimized uploads, in-browser image editing, and
            per-image descriptions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setSubView("catalog")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                subView === "catalog"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Catalog &amp; Pricing ({designs.length})
            </button>
            <button
              type="button"
              onClick={() => setSubView("media")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                subView === "media"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Image Library ({mediaQ.data?.length ?? 0})
            </button>
          </div>
          {canEdit && (
            <Button
              variant="cta"
              size="default"
              className="shrink-0 whitespace-nowrap"
              onClick={() => setEditing("new")}
            >
              <Plus className="h-4 w-4" /> Add Design
            </Button>
          )}
        </div>
      </div>

      {subView === "media" ? (
        <MediaLibraryPanel
          media={mediaQ.data ?? []}
          designs={designs}
          isLoading={mediaQ.isLoading}
          canEdit={canEdit}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search designs..."
              className="h-10 sm:w-64"
            />
            <div className="flex gap-1 overflow-x-auto pb-1">
              {["All", ...categories.map((c) => c.name)].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCatFilter(c)}
                  className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    catFilter === c
                      ? "border border-border bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <section className="rounded-2xl border border-border bg-card">
            {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading designs…</p>}
            {!isLoading && visible.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold">No designs match your filter</p>
                {canEdit && (
                  <Button
                    variant="soft"
                    size="sm"
                    className="mt-3"
                    onClick={() => setEditing("new")}
                  >
                    <Plus className="h-4 w-4" /> Create first design
                  </Button>
                )}
              </div>
            )}
            <ul className="divide-y divide-border">
              {visible.map((d, i) => {
                const draftPrice = priceDrafts[d.id] ?? String(d.price);
                const priceChanged = Number(draftPrice) !== d.price;
                return (
                  <li
                    key={d.id}
                    draggable={canEdit && catFilter === "All" && !search.trim()}
                    onDragStart={() => canEdit && setDragId(d.id)}
                    onDragOver={(e: DragEvent) => e.preventDefault()}
                    onDrop={() => handleDrop(d.id)}
                    className={`flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center ${
                      dragId === d.id ? "bg-muted/60 opacity-60" : "hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {canEdit && (
                        <span
                          className="hidden cursor-grab text-muted-foreground sm:inline-flex"
                          title="Drag to reorder"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                      )}
                      <img
                        src={designImage(d.images[0] || d.image_key)}
                        alt={d.name}
                        referrerPolicy="no-referrer"
                        className="h-16 w-20 shrink-0 rounded-xl object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-bold">{d.name}</h3>
                          {!d.is_active && (
                            <span className="text-xs font-semibold text-amber-700">· Hidden</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {d.category} · {d.images.length || 1}{" "}
                          {d.images.length === 1 ? "image" : "images"}
                          {!canEdit && (
                            <>
                              {" · "}
                              <span className="font-mono font-semibold text-primary tabular-nums">
                                {formatKsh(d.price)}
                              </span>
                            </>
                          )}
                        </p>
                        {d.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {d.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {canEdit && (
                        <div className="mr-1 flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">KSh</span>
                          <Input
                            type="number"
                            min={1}
                            value={draftPrice}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))
                            }
                            aria-label={`Price for ${d.name}`}
                            className="h-8 w-24 font-mono text-xs tabular-nums"
                          />
                          {priceChanged && (
                            <Button
                              type="button"
                              variant="soft"
                              size="icon"
                              className="h-8 w-8"
                              disabled={savingPriceId === d.id}
                              onClick={() => saveInlinePrice(d)}
                              aria-label={`Save price for ${d.name}`}
                            >
                              {savingPriceId === d.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      )}

                      {canEdit && catFilter === "All" && !search.trim() && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            disabled={i === 0}
                            onClick={() => moveBy(d.id, -1)}
                            aria-label={`Move ${d.name} up`}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            disabled={i === visible.length - 1}
                            onClick={() => moveBy(d.id, 1)}
                            aria-label={`Move ${d.name} down`}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </>
                      )}

                      {canEdit ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleActive(d)}
                            title={d.is_active ? "Hide from shop" : "Show on shop"}
                          >
                            {d.is_active ? (
                              <Eye className="h-4 w-4" />
                            ) : (
                              <EyeOff className="h-4 w-4" />
                            )}
                            <span className="hidden md:inline">
                              {d.is_active ? "Visible" : "Hidden"}
                            </span>
                          </Button>
                          <Button variant="soft" size="sm" onClick={() => setEditing(d)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(d)}
                            aria-label={`Delete ${d.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button variant="soft" size="sm" onClick={() => setEditing(d)}>
                          <Eye className="h-3.5 w-3.5" /> Inspect
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <DesignEditorSheet
        design={editing}
        categories={categories}
        canEdit={canEdit}
        onClose={() => setEditing(null)}
        onSaved={invalidateAll}
      />
    </div>
  );
}

function DesignEditorSheet({
  design,
  categories,
  canEdit,
  onClose,
  onSaved,
}: {
  design: AdminDesign | "new" | null;
  categories: AdminCategoryRow[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isNew = design === "new";
  const initial = design && design !== "new" ? design : null;

  const saveDesign = useServerFn(adminSaveDesign);
  const uploadImage = useServerFn(adminUploadImage);
  const deleteImage = useServerFn(adminDeleteImage);
  const uploadFile = useServerFn(adminUploadDesignFile);
  const deleteFile = useServerFn(adminDeleteDesignFile);

  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0]?.name ?? "Residential");
  const [price, setPrice] = useState("4500");
  const [unit, setUnit] = useState("2 pages");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [images, setImages] = useState<string[]>(["residential"]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [urlInput, setUrlInput] = useState("");
  const [dragImgIdx, setDragImgIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [editorIndex, setEditorIndex] = useState<number | null>(null);

  const filesQuery = useQuery({
    ...designFilesQuery(initial?.id ?? "__none__"),
    enabled: Boolean(initial?.id),
  });

  useEffect(() => {
    if (!design) return;
    if (design === "new") {
      setName("");
      setCategory(categories[0]?.name ?? "Residential");
      setPrice("4500");
      setUnit("2 pages");
      setTag("");
      setDescription("");
      setIsActive(true);
      setImages(["residential"]);
      setCaptions({});
    } else {
      setName(design.name);
      setCategory(design.category);
      setPrice(String(design.price));
      setUnit(design.unit ?? "");
      setTag(design.tag ?? "");
      setDescription(design.description ?? "");
      setIsActive(design.is_active);
      const list = design.images.length ? design.images : [design.image_key];
      setImages(list);
      setCaptions(design.image_captions ?? {});
    }
    setUrlInput("");
    setEditorIndex(null);
  }, [design, categories]);

  async function handleImageUpload(e: ChangeEvent<HTMLInputElement>) {
    if (!canEdit) return;
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploadingImg(true);
    try {
      for (const file of Array.from(fileList)) {
        const opt = await optimizeImageFile(file, { maxDim: 1600, quality: 0.82 });
        const res = await uploadImage({
          data: {
            fileName: opt.fileName,
            contentType: opt.contentType,
            base64: opt.base64,
            width: opt.width,
            height: opt.height,
            originalSizeBytes: opt.originalSizeBytes,
            optimized: true,
            designId: initial?.id ?? null,
          },
        });
        if (!res.ok) {
          toast.error(res.message);
        } else {
          setImages((prev) => [...prev, res.key]);
          const pct =
            opt.originalSizeBytes > opt.sizeBytes
              ? Math.round(((opt.originalSizeBytes - opt.sizeBytes) / opt.originalSizeBytes) * 100)
              : 0;
          toast.success(
            pct > 0
              ? `Optimized & uploaded ${file.name} (${pct}% smaller)`
              : `Optimized & uploaded ${file.name}`,
          );
        }
      }
    } catch {
      toast.error("Could not optimize and upload image.");
    } finally {
      setUploadingImg(false);
      e.target.value = "";
    }
  }

  function addImageKey(key: string) {
    if (!canEdit || !key.trim()) return;
    setImages((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }

  function addImageUrl() {
    if (!canEdit) return;
    const trimmed = urlInput.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error("Enter a valid https:// image link.");
      return;
    }
    addImageKey(trimmed);
    setUrlInput("");
  }

  async function removeImage(idx: number) {
    if (!canEdit) return;
    const key = images[idx];
    setImages((prev) => prev.filter((_, i) => i !== idx));
    if (key) {
      setCaptions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (key.startsWith("upload:")) {
        try {
          await deleteImage({ data: { key } });
          await onSaved();
          toast.success("Removed image from design, cloud storage, and database.");
        } catch {
          // Non-fatal UI fallback
        }
      }
    }
  }

  function reorderImage(from: number, to: number) {
    if (!canEdit || from === to || from < 0 || to < 0 || to >= images.length) return;
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (!moved) return prev;
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function handleDeliverableUpload(e: ChangeEvent<HTMLInputElement>) {
    if (!canEdit) return;
    const file = e.target.files?.[0];
    if (!file || !initial?.id) return;
    setUploadingFile(true);
    try {
      const base64 = await readFileAsBase64(file);
      const res = await uploadFile({
        data: {
          designId: initial.id,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          base64,
        },
      });
      if (!res.ok) toast.error(res.message);
      else {
        toast.success(`Uploaded ${file.name}`);
        filesQuery.refetch();
      }
    } catch {
      toast.error("Could not upload design file.");
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  }

  async function handleDeleteFile(fileName: string) {
    if (!canEdit || !initial?.id) return;
    try {
      const res = await deleteFile({ data: { designId: initial.id, fileName } });
      if (!res.ok) toast.error(res.message);
      else {
        toast.success(`Removed ${fileName}`);
        filesQuery.refetch();
      }
    } catch {
      toast.error("Could not remove file.");
    }
  }

  async function handleSave() {
    if (!canEdit) return;
    if (!name.trim()) {
      toast.error("Design name is required.");
      return;
    }
    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error("Enter a valid price in KSh.");
      return;
    }
    if (images.length === 0) {
      toast.error("Add at least one image for this design.");
      return;
    }
    setBusy(true);
    try {
      const res = await saveDesign({
        data: {
          ...(initial?.id ? { id: initial.id } : {}),
          name: name.trim(),
          category,
          price: Math.round(parsedPrice),
          unit: unit.trim() || null,
          tag: tag.trim() || null,
          description: description.trim() || null,
          images,
          image_captions: captions,
          image_key: images[0],
          is_active: isActive,
        },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      await onSaved();
      toast.success(isNew ? "Design created." : "Design updated.");
      onClose();
    } catch {
      toast.error("Could not save design.");
    } finally {
      setBusy(false);
    }
  }

  const editorTarget: ImageEditorTarget | null =
    editorIndex !== null && images[editorIndex]
      ? {
          imageKey: images[editorIndex]!,
          label: `${name || "Design"} #${editorIndex + 1}`,
          designId: initial?.id ?? null,
          description: captions[images[editorIndex]!] ?? null,
        }
      : null;

  return (
    <>
      <Sheet open={Boolean(design)} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-border px-6 py-4">
            <SheetTitle className="text-lg font-bold">
              {isNew
                ? "New Architectural Design"
                : canEdit
                  ? `Edit · ${initial?.name}`
                  : `Inspect · ${initial?.name}`}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto p-6">
            {/* Core details */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="design-name">Design Name</Label>
                <Input
                  id="design-name"
                  disabled={!canEdit}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Modern 3-Bedroom Villa"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="design-category">Category</Label>
                <select
                  id="design-category"
                  disabled={!canEdit}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.emoji} {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="design-price">Price (KSh)</Label>
                <Input
                  id="design-price"
                  type="number"
                  min={1}
                  disabled={!canEdit}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="design-unit">Drawings / Unit</Label>
                <Input
                  id="design-unit"
                  disabled={!canEdit}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="e.g. 4 pages"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="design-tag">Tag (optional)</Label>
                <Input
                  id="design-tag"
                  disabled={!canEdit}
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="e.g. 15% OFF"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="design-desc">Design Description</Label>
                <Textarea
                  id="design-desc"
                  rows={3}
                  disabled={!canEdit}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the layout, structural style, room dimensions, and target plot..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Visible in storefront (uncheck to hide without deleting)
              </label>
            </div>

            {/* Images & Image Descriptions */}
            <div className="space-y-3 border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold">Images &amp; Image Descriptions</h3>
                  <p className="text-xs text-muted-foreground">
                    Uploads are auto-optimized to WebP. Crop, resize, rotate, or watermark any
                    image.
                  </p>
                </div>
                {canEdit && (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80">
                    {uploadingImg ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Upload &amp; Optimize
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={uploadingImg}
                    />
                  </label>
                )}
              </div>

              <div className="space-y-2.5">
                {images.map((key, idx) => (
                  <div
                    key={`${key}-${idx}`}
                    draggable={canEdit}
                    onDragStart={() => canEdit && setDragImgIdx(idx)}
                    onDragOver={(e: DragEvent) => e.preventDefault()}
                    onDrop={() => {
                      if (canEdit && dragImgIdx !== null) reorderImage(dragImgIdx, idx);
                      setDragImgIdx(null);
                    }}
                    className="flex flex-col gap-2.5 rounded-xl border border-border bg-muted/20 p-3 sm:flex-row sm:items-start"
                  >
                    <div className="flex items-center gap-2">
                      {canEdit && (
                        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                      )}
                      <img
                        src={designImage(key)}
                        alt={captions[key] || `Design image ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        className="h-16 w-20 shrink-0 rounded-lg object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {idx === 0 ? "Cover · " : `#${idx + 1} · `}
                          {key}
                        </span>
                        {canEdit && (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setEditorIndex(idx)}
                              title="Crop, resize, rotate, adjust or watermark image"
                            >
                              <Crop className="h-3 w-3" /> Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={idx === 0}
                              onClick={() => reorderImage(idx, idx - 1)}
                              aria-label="Move image up"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={idx === images.length - 1}
                              onClick={() => reorderImage(idx, idx + 1)}
                              aria-label="Move image down"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeImage(idx)}
                              aria-label="Delete image"
                              title={
                                key.startsWith("upload:")
                                  ? "Delete image from storage and database"
                                  : "Remove image"
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <Input
                        disabled={!canEdit}
                        value={captions[key] ?? ""}
                        onChange={(e) =>
                          setCaptions((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        placeholder="Write a description for this image..."
                        className="h-9 bg-card text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {canEdit && (
                <>
                  <div className="flex gap-2">
                    <Input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="Or paste https:// image URL..."
                      className="h-9 text-xs"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addImageUrl}>
                      <ImagePlus className="h-3.5 w-3.5" /> Add URL
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Add bundled architectural image:
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {BUNDLED_IMAGE_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => addImageKey(opt.key)}
                          className="group flex shrink-0 flex-col items-center gap-1 rounded-lg border border-border p-1 text-[11px] hover:border-primary"
                          title={`Add ${opt.label}`}
                        >
                          <img
                            src={opt.src}
                            alt={opt.label}
                            className="h-10 w-14 rounded object-cover"
                          />
                          <span className="max-w-[60px] truncate text-muted-foreground group-hover:text-foreground">
                            {opt.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Downloadable CAD/PDF Files (for existing designs) */}
            {initial?.id && (
              <div className="space-y-3 border-t border-border pt-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">
                      Downloadable Files (PDF, DWG, DXF, PNG, JPG)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Unlocked automatically for buyers after M-PESA payment.
                    </p>
                  </div>
                  {canEdit && (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80">
                      {uploadingFile ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileDown className="h-3.5 w-3.5" />
                      )}
                      Upload File
                      <input
                        type="file"
                        accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg"
                        className="hidden"
                        onChange={handleDeliverableUpload}
                        disabled={uploadingFile}
                      />
                    </label>
                  )}
                </div>
                {filesQuery.data && filesQuery.data.length > 0 ? (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {filesQuery.data.map((f) => (
                      <li
                        key={f.path}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <span className="truncate font-mono">{f.name}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          {f.size !== null && (
                            <span className="font-mono text-muted-foreground tabular-nums">
                              {Math.max(1, Math.round(f.size / 1024))} KB
                            </span>
                          )}
                          {canEdit && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => handleDeleteFile(f.name)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Using standard starter deliverables (PDF, DWG, PNG) until custom files are
                    uploaded.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              {canEdit ? "Cancel" : "Close"}
            </Button>
            {canEdit && (
              <Button type="button" variant="cta" disabled={busy} onClick={handleSave}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {isNew ? "Create Design" : "Save Changes"}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ImageEditorDialog
        target={editorTarget}
        replaceStorageFile
        onClose={() => setEditorIndex(null)}
        onSaved={(newKey) => {
          if (editorIndex === null) return;
          const oldKey = images[editorIndex];
          setImages((prev) => prev.map((k, i) => (i === editorIndex ? newKey : k)));
          if (oldKey && captions[oldKey]) {
            setCaptions((prev) => {
              const next = { ...prev, [newKey]: prev[oldKey]! };
              delete next[oldKey];
              return next;
            });
          }
          setEditorIndex(null);
        }}
      />
    </>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
