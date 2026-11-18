import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crop, Image as ImageIcon, Loader2, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { ImageEditorDialog, type ImageEditorTarget } from "@/components/admin/ImageEditorDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminDeleteImage,
  adminSaveDesign,
  adminUpdateImageMeta,
  adminUploadImage,
  type StoredImageMeta,
} from "@/lib/admin.functions";
import { SHOP_KEYS, type AdminDesign } from "@/lib/admin-queries";
import { designImage } from "@/lib/design-images";
import { optimizeImageFile } from "@/lib/image-optimizer";

export function MediaLibraryPanel({
  media,
  designs,
  isLoading,
  canEdit,
}: {
  media: StoredImageMeta[];
  designs: AdminDesign[];
  isLoading: boolean;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const uploadImage = useServerFn(adminUploadImage);
  const updateMeta = useServerFn(adminUpdateImageMeta);
  const deleteImage = useServerFn(adminDeleteImage);
  const saveDesign = useServerFn(adminSaveDesign);

  const [uploading, setUploading] = useState(false);
  const [uploadTargetDesign, setUploadTargetDesign] = useState<string>("");
  const [editorTarget, setEditorTarget] = useState<ImageEditorTarget | null>(null);
  const [draftDescs, setDraftDescs] = useState<Record<string, string>>({});
  const [draftDesigns, setDraftDesigns] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const descs: Record<string, string> = {};
    const dIds: Record<string, string> = {};
    for (const m of media) {
      descs[m.key] = m.description ?? "";
      dIds[m.key] = m.designId ?? "";
    }
    setDraftDescs(descs);
    setDraftDesigns(dIds);
  }, [media]);

  async function invalidateAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin"] }),
      ...SHOP_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })),
    ]);
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    if (!canEdit) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const opt = await optimizeImageFile(file, { maxDim: 1600, quality: 0.82 });
        const targetDesign = designs.find((d) => d.id === uploadTargetDesign) ?? null;
        const res = await uploadImage({
          data: {
            fileName: opt.fileName,
            contentType: opt.contentType,
            base64: opt.base64,
            width: opt.width,
            height: opt.height,
            originalSizeBytes: opt.originalSizeBytes,
            optimized: true,
            designId: targetDesign?.id ?? null,
          },
        });
        if (!res.ok) {
          toast.error(res.message);
          continue;
        }
        if (targetDesign && !targetDesign.images.includes(res.key)) {
          await saveDesign({
            data: {
              ...targetDesign,
              images: [...targetDesign.images, res.key],
            },
          });
        }
        const savedPct =
          opt.originalSizeBytes > opt.sizeBytes
            ? Math.round(((opt.originalSizeBytes - opt.sizeBytes) / opt.originalSizeBytes) * 100)
            : 0;
        toast.success(
          savedPct > 0
            ? `Uploaded & optimized ${file.name} (${savedPct}% smaller)`
            : `Uploaded & optimized ${file.name}`,
        );
      }
      await invalidateAll();
    } catch {
      toast.error("Could not optimize and upload image.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleSaveMeta(m: StoredImageMeta) {
    if (!canEdit) return;
    setSavingKey(m.key);
    try {
      const nextDesignId = draftDesigns[m.key]?.trim() || null;
      const nextDesc = draftDescs[m.key] ?? "";
      const res = await updateMeta({
        data: {
          key: m.key,
          description: nextDesc,
          designId: nextDesignId,
        },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (nextDesignId && nextDesignId !== m.designId) {
        const target = designs.find((d) => d.id === nextDesignId);
        if (target && !target.images.includes(m.key)) {
          await saveDesign({
            data: {
              ...target,
              images: [...target.images, m.key],
              image_captions: {
                ...(target.image_captions ?? {}),
                ...(nextDesc.trim() ? { [m.key]: nextDesc.trim() } : {}),
              },
            },
          });
        }
      }
      await invalidateAll();
      toast.success("Image metadata saved.");
    } catch {
      toast.error("Could not update image metadata.");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleDelete(m: StoredImageMeta) {
    if (!canEdit) return;
    try {
      const res = await deleteImage({ data: { key: m.key } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      await invalidateAll();
      toast.success("Deleted image from cloud storage and database.");
    } catch {
      toast.error("Could not delete image.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold">Image Library &amp; Auto-Optimization</h2>
          <p className="text-xs text-muted-foreground">
            Uploads are resized &amp; compressed to WebP automatically. Edit files, update metadata,
            or delete from both storage and database.
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={uploadTargetDesign}
              onChange={(e) => setUploadTargetDesign(e.target.value)}
              aria-label="Attach uploaded image to design"
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs"
            >
              <option value="">Store in library only</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  Attach to: {d.name}
                </option>
              ))}
            </select>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
              {uploading ? (
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
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>
          </div>
        )}
      </div>

      {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading media library…</p>}

      {!isLoading && media.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-semibold">No uploaded images in cloud storage yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload a new architectural photo above or edit any design image to store an optimized
            copy.
          </p>
        </div>
      )}

      {!isLoading && media.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((m) => {
            const kb = Math.max(1, Math.round(m.sizeBytes / 1024));
            const origKb = m.originalSizeBytes
              ? Math.max(1, Math.round(m.originalSizeBytes / 1024))
              : null;
            return (
              <article
                key={m.key}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="relative aspect-[4/3] bg-muted">
                  <img
                    src={designImage(m.key)}
                    alt={m.description || m.fileName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-2.5 p-4">
                  <div>
                    <p className="truncate font-mono text-xs font-semibold">{m.fileName}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {m.width && m.height ? `${m.width}×${m.height}px · ` : ""}
                      {kb} KB
                      {origKb && origKb > kb ? ` (from ${origKb} KB)` : ""}
                      {m.optimized ? " · Optimized" : ""}
                      {m.watermarkText ? ` · Watermark: ${m.watermarkText}` : ""}
                    </p>
                  </div>

                  <Input
                    value={draftDescs[m.key] ?? ""}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setDraftDescs((prev) => ({ ...prev, [m.key]: e.target.value }))
                    }
                    placeholder="Image description..."
                    className="h-9 text-xs"
                  />

                  <select
                    value={draftDesigns[m.key] ?? ""}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setDraftDesigns((prev) => ({ ...prev, [m.key]: e.target.value }))
                    }
                    className="h-9 rounded-md border border-input bg-background px-2.5 text-xs"
                  >
                    <option value="">Unassigned</option>
                    {designs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>

                  {canEdit && (
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-1.5 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditorTarget({
                            imageKey: m.key,
                            label: m.fileName,
                            designId: m.designId,
                            description: draftDescs[m.key] ?? m.description,
                          })
                        }
                      >
                        <Crop className="h-3.5 w-3.5" /> Edit File
                      </Button>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="soft"
                          size="sm"
                          disabled={savingKey === m.key}
                          onClick={() => handleSaveMeta(m)}
                        >
                          {savingKey === m.key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(m)}
                          aria-label={`Delete ${m.fileName}`}
                          title="Delete from cloud storage and database"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ImageEditorDialog
        target={editorTarget}
        replaceStorageFile
        onClose={() => setEditorTarget(null)}
        onSaved={async (newKey) => {
          if (!editorTarget) return;
          const matchingDesign = designs.find(
            (d) =>
              d.images.includes(editorTarget.imageKey) || d.image_key === editorTarget.imageKey,
          );
          if (matchingDesign) {
            const nextImages = matchingDesign.images.map((k) =>
              k === editorTarget.imageKey ? newKey : k,
            );
            const nextCaptions = { ...(matchingDesign.image_captions ?? {}) };
            if (nextCaptions[editorTarget.imageKey]) {
              nextCaptions[newKey] = nextCaptions[editorTarget.imageKey]!;
              delete nextCaptions[editorTarget.imageKey];
            }
            await saveDesign({
              data: {
                ...matchingDesign,
                images: nextImages.length ? nextImages : [newKey],
                image_captions: nextCaptions,
                image_key:
                  matchingDesign.image_key === editorTarget.imageKey
                    ? newKey
                    : matchingDesign.image_key,
              },
            });
          }
          await invalidateAll();
        }}
      />
    </div>
  );
}
