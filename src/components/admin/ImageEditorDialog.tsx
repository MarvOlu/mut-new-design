import { useServerFn } from "@tanstack/react-start";
import {
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  RotateCcw,
  RotateCw,
  Save,
  SlidersHorizontal,
  Stamp,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminDeleteImage, adminUploadImage } from "@/lib/admin.functions";
import { designImage } from "@/lib/design-images";
import {
  aspectRatioValue,
  clampCrop,
  createDefaultEditConfig,
  exportEditedImage,
  fitDimensions,
  loadHtmlImage,
  renderEditedImageToCanvas,
  rotatedDimensions,
  type CropAspect,
  type ImageEditConfig,
  type WatermarkPosition,
} from "@/lib/image-optimizer";

export interface ImageEditorTarget {
  imageKey: string;
  label?: string;
  designId?: string | null;
  description?: string | null;
}

const CROP_PRESETS: { id: CropAspect; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "4:3", label: "4:3" },
  { id: "16:9", label: "16:9" },
  { id: "3:2", label: "3:2" },
  { id: "1:1", label: "1:1" },
];

const WATERMARK_POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: "bottom-right", label: "Bottom Right" },
  { id: "bottom-left", label: "Bottom Left" },
  { id: "center", label: "Center" },
  { id: "tile", label: "Tiled" },
];

export function ImageEditorDialog({
  target,
  replaceStorageFile = true,
  onClose,
  onSaved,
}: {
  target: ImageEditorTarget | null;
  replaceStorageFile?: boolean;
  onClose: () => void;
  onSaved: (
    newKey: string,
    meta?: { width: number; height: number; sizeBytes: number },
  ) => void | Promise<void>;
}) {
  const uploadImage = useServerFn(adminUploadImage);
  const deleteImage = useServerFn(adminDeleteImage);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origCrop: ImageEditConfig["crop"];
  } | null>(null);

  const [imgSize, setImgSize] = useState<{ width: number; height: number }>({
    width: 1200,
    height: 900,
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aspect, setAspect] = useState<CropAspect>("free");
  const [lockAspect, setLockAspect] = useState(true);
  const [toolTab, setToolTab] = useState<"crop" | "adjust" | "watermark">("crop");
  const [edits, setEdits] = useState<ImageEditConfig>(() => createDefaultEditConfig(1200, 900));

  useEffect(() => {
    if (!target) {
      loadedImgRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setAspect("free");
    setToolTab("crop");
    const src = designImage(target.imageKey);

    loadHtmlImage(src)
      .then((img) => {
        if (cancelled) return;
        loadedImgRef.current = img;
        const w = img.naturalWidth || 1200;
        const h = img.naturalHeight || 900;
        const fitted = fitDimensions(w, h, 1600);
        setImgSize({ width: w, height: h });
        setEdits(createDefaultEditConfig(fitted.width, fitted.height));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(
          "Could not load this image for editing. External links may block canvas access.",
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  // Re-render live canvas preview whenever edits change
  useEffect(() => {
    const img = loadedImgRef.current;
    const canvas = previewCanvasRef.current;
    if (!img || !canvas || loading || loadError) return;
    try {
      const previewDim = fitDimensions(edits.targetWidth, edits.targetHeight, 960);
      renderEditedImageToCanvas(img, edits, canvas, previewDim);
    } catch {
      // Ignore transient draw error
    }
  }, [edits, loading, loadError]);

  function applyAspectPreset(nextAspect: CropAspect) {
    setAspect(nextAspect);
    const ratio = aspectRatioValue(nextAspect);
    const rot = rotatedDimensions(imgSize.width, imgSize.height, edits.rotate);
    if (!ratio) {
      const fitted = fitDimensions(rot.width, rot.height, 1600);
      setEdits((prev) => ({
        ...prev,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        targetWidth: fitted.width,
        targetHeight: fitted.height,
      }));
      return;
    }
    const imgRatio = rot.width / rot.height;
    let cw = 1;
    let ch = 1;
    if (imgRatio > ratio) {
      cw = Math.min(1, ratio / imgRatio);
      ch = 1;
    } else {
      cw = 1;
      ch = Math.min(1, imgRatio / ratio);
    }
    const cx = (1 - cw) / 2;
    const cy = (1 - ch) / 2;
    const pixelW = Math.round(cw * rot.width);
    const pixelH = Math.round(ch * rot.height);
    const fitted = fitDimensions(pixelW, pixelH, 1600);
    setEdits((prev) => ({
      ...prev,
      crop: clampCrop({ x: cx, y: cy, width: cw, height: ch }),
      targetWidth: fitted.width,
      targetHeight: fitted.height,
    }));
  }

  function rotateBy(delta: 90 | -90) {
    setEdits((prev) => {
      const nextRot = ((prev.rotate + delta + 360) % 360) as 0 | 90 | 180 | 270;
      return {
        ...prev,
        rotate: nextRot,
        targetWidth: prev.targetHeight,
        targetHeight: prev.targetWidth,
      };
    });
  }

  function updateTargetWidth(raw: string) {
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 16) return;
    const clampedW = Math.min(3200, Math.round(val));
    setEdits((prev) => {
      if (!lockAspect || prev.targetWidth <= 0) {
        return { ...prev, targetWidth: clampedW };
      }
      const ratio = prev.targetHeight / prev.targetWidth;
      return {
        ...prev,
        targetWidth: clampedW,
        targetHeight: Math.max(16, Math.round(clampedW * ratio)),
      };
    });
  }

  function updateTargetHeight(raw: string) {
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 16) return;
    const clampedH = Math.min(3200, Math.round(val));
    setEdits((prev) => {
      if (!lockAspect || prev.targetHeight <= 0) {
        return { ...prev, targetHeight: clampedH };
      }
      const ratio = prev.targetWidth / prev.targetHeight;
      return {
        ...prev,
        targetWidth: Math.max(16, Math.round(clampedH * ratio)),
        targetHeight: clampedH,
      };
    });
  }

  function resetAll() {
    const fitted = fitDimensions(imgSize.width, imgSize.height, 1600);
    setAspect("free");
    setEdits(createDefaultEditConfig(fitted.width, fitted.height));
  }

  function startCropDrag(mode: "move" | "resize", e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origCrop: edits.crop,
    };
  }

  function handleCropPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    const box = stageBoxRef.current;
    if (!drag || !box) return;
    const rect = box.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;

    if (drag.mode === "move") {
      const nextX = Math.min(1 - drag.origCrop.width, Math.max(0, drag.origCrop.x + dx));
      const nextY = Math.min(1 - drag.origCrop.height, Math.max(0, drag.origCrop.y + dy));
      setEdits((prev) => ({
        ...prev,
        crop: { ...drag.origCrop, x: nextX, y: nextY },
      }));
      return;
    }

    const nextW = Math.min(1 - drag.origCrop.x, Math.max(0.15, drag.origCrop.width + dx));
    let nextH = Math.min(1 - drag.origCrop.y, Math.max(0.15, drag.origCrop.height + dy));
    const lockedRatio = aspectRatioValue(aspect);
    if (lockedRatio) {
      const rot = rotatedDimensions(imgSize.width, imgSize.height, edits.rotate);
      const pixelW = nextW * rot.width;
      const desiredPixelH = pixelW / lockedRatio;
      nextH = Math.min(1 - drag.origCrop.y, Math.max(0.15, desiredPixelH / rot.height));
    }
    const rot = rotatedDimensions(imgSize.width, imgSize.height, edits.rotate);
    const fitted = fitDimensions(nextW * rot.width, nextH * rot.height, 1600);
    setEdits((prev) => ({
      ...prev,
      crop: clampCrop({ x: drag.origCrop.x, y: drag.origCrop.y, width: nextW, height: nextH }),
      targetWidth: fitted.width,
      targetHeight: fitted.height,
    }));
  }

  function stopCropDrag() {
    dragStateRef.current = null;
  }

  async function handleSave() {
    if (!target) return;
    setSaving(true);
    try {
      const src = designImage(target.imageKey);
      const stem = (target.label || target.imageKey.split("/").pop() || "edited-design")
        .replace(/^upload:/, "")
        .replace(/\.[^.]+$/, "");
      const edited = await exportEditedImage(src, stem, edits, 0.85);
      const uploadRes = await uploadImage({
        data: {
          fileName: edited.fileName,
          contentType: edited.contentType,
          base64: edited.base64,
          width: edited.width,
          height: edited.height,
          originalSizeBytes: edited.originalSizeBytes,
          optimized: true,
          watermarkText: edits.watermark.enabled ? edits.watermark.text.trim() || null : null,
          description: target.description ?? null,
          designId: target.designId ?? null,
        },
      });
      if (!uploadRes.ok) {
        toast.error(uploadRes.message);
        return;
      }

      await onSaved(uploadRes.key, {
        width: edited.width,
        height: edited.height,
        sizeBytes: edited.sizeBytes,
      });

      if (
        replaceStorageFile &&
        target.imageKey.startsWith("upload:") &&
        target.imageKey !== uploadRes.key
      ) {
        await deleteImage({ data: { key: target.imageKey } }).catch(() => {});
      }

      toast.success(`Saved optimized image (${edited.width}×${edited.height}px)`);
      onClose();
    } catch {
      toast.error("Could not save edited image.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-bold">
            Edit &amp; Optimize Image {target?.label ? `· ${target.label}` : ""}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Crop, resize, rotate, adjust colors, or apply a watermark. Exports as optimized WebP.
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 gap-0 overflow-y-auto lg:grid-cols-[1fr_320px]">
          {/* Preview Canvas Stage */}
          <div className="flex flex-col items-center justify-center bg-muted/40 p-4 sm:p-6">
            {loading && (
              <div className="flex h-64 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading image editor…
              </div>
            )}
            {loadError && (
              <div className="max-w-sm rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center text-xs text-destructive">
                {loadError}
              </div>
            )}
            {!loading && !loadError && (
              <div className="w-full space-y-3">
                <div
                  ref={stageBoxRef}
                  className="relative mx-auto flex max-h-[420px] w-fit max-w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-background shadow-sm select-none"
                >
                  <canvas
                    ref={previewCanvasRef}
                    className="block max-h-[400px] max-w-full object-contain"
                  />
                  {toolTab === "crop" && (
                    <div
                      onPointerDown={(e) => startCropDrag("move", e)}
                      onPointerMove={handleCropPointerMove}
                      onPointerUp={stopCropDrag}
                      onPointerCancel={stopCropDrag}
                      style={{
                        left: `${edits.crop.x * 100}%`,
                        top: `${edits.crop.y * 100}%`,
                        width: `${edits.crop.width * 100}%`,
                        height: `${edits.crop.height * 100}%`,
                      }}
                      className="absolute cursor-move border-2 border-primary bg-primary/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]"
                      title="Drag crop frame"
                    >
                      <div
                        onPointerDown={(e) => startCropDrag("resize", e)}
                        onPointerMove={handleCropPointerMove}
                        onPointerUp={stopCropDrag}
                        onPointerCancel={stopCropDrag}
                        className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border border-background bg-primary"
                        title="Resize crop region"
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">
                    Output: {edits.targetWidth} × {edits.targetHeight} px
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={resetAll}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset edits
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Tool Controls Sidebar */}
          <div className="flex flex-col border-t border-border bg-card lg:border-t-0 lg:border-l">
            {/* Tool Switcher */}
            <div className="grid grid-cols-3 gap-1 border-b border-border bg-muted/40 p-1.5">
              <button
                type="button"
                onClick={() => setToolTab("crop")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  toolTab === "crop" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                <Crop className="h-3.5 w-3.5" /> Crop &amp; Size
              </button>
              <button
                type="button"
                onClick={() => setToolTab("adjust")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  toolTab === "adjust"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust
              </button>
              <button
                type="button"
                onClick={() => setToolTab("watermark")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  toolTab === "watermark"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                <Stamp className="h-3.5 w-3.5" /> Watermark
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              {toolTab === "crop" && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Crop Aspect Ratio</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {CROP_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyAspectPreset(p.id)}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                            aspect === p.id
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Rotate &amp; Flip</Label>
                    <div className="grid grid-cols-4 gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => rotateBy(-90)}
                        title="Rotate 90° left"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => rotateBy(90)}
                        title="Rotate 90° right"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant={edits.flipH ? "default" : "outline"}
                        size="sm"
                        onClick={() => setEdits((p) => ({ ...p, flipH: !p.flipH }))}
                        title="Flip horizontally"
                      >
                        <FlipHorizontal2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant={edits.flipV ? "default" : "outline"}
                        size="sm"
                        onClick={() => setEdits((p) => ({ ...p, flipV: !p.flipV }))}
                        title="Flip vertically"
                      >
                        <FlipVertical2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">Resize Dimensions (px)</Label>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={lockAspect}
                          onChange={(e) => setLockAspect(e.target.checked)}
                          className="h-3.5 w-3.5"
                        />
                        Lock ratio
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <span className="text-[11px] text-muted-foreground">Width</span>
                        <Input
                          type="number"
                          min={64}
                          max={3200}
                          value={edits.targetWidth}
                          onChange={(e) => updateTargetWidth(e.target.value)}
                          className="h-9 font-mono text-xs tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[11px] text-muted-foreground">Height</span>
                        <Input
                          type="number"
                          min={64}
                          max={3200}
                          value={edits.targetHeight}
                          onChange={(e) => updateTargetHeight(e.target.value)}
                          className="h-9 font-mono text-xs tabular-nums"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {toolTab === "adjust" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <Label>Brightness</Label>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {edits.brightness}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={150}
                      value={edits.brightness}
                      onChange={(e) =>
                        setEdits((p) => ({ ...p, brightness: Number(e.target.value) }))
                      }
                      className="w-full accent-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <Label>Contrast</Label>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {edits.contrast}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={150}
                      value={edits.contrast}
                      onChange={(e) =>
                        setEdits((p) => ({ ...p, contrast: Number(e.target.value) }))
                      }
                      className="w-full accent-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <Label>Saturation</Label>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {edits.saturation}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={edits.saturation}
                      onChange={(e) =>
                        setEdits((p) => ({ ...p, saturation: Number(e.target.value) }))
                      }
                      className="w-full accent-primary"
                    />
                  </div>
                </div>
              )}

              {toolTab === "watermark" && (
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={edits.watermark.enabled}
                      onChange={(e) =>
                        setEdits((p) => ({
                          ...p,
                          watermark: { ...p.watermark, enabled: e.target.checked },
                        }))
                      }
                      className="h-4 w-4"
                    />
                    Apply watermark stamp
                  </label>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Watermark Text</Label>
                    <Input
                      value={edits.watermark.text}
                      onChange={(e) =>
                        setEdits((p) => ({
                          ...p,
                          watermark: { ...p.watermark, text: e.target.value, enabled: true },
                        }))
                      }
                      placeholder="MUTKEN DESIGNS"
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Position</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {WATERMARK_POSITIONS.map((pos) => (
                        <button
                          key={pos.id}
                          type="button"
                          onClick={() =>
                            setEdits((p) => ({
                              ...p,
                              watermark: { ...p.watermark, position: pos.id, enabled: true },
                            }))
                          }
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                            edits.watermark.position === pos.id
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground"
                          }`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <Label>Opacity</Label>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {Math.round(edits.watermark.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={90}
                      value={Math.round(edits.watermark.opacity * 100)}
                      onChange={(e) =>
                        setEdits((p) => ({
                          ...p,
                          watermark: {
                            ...p.watermark,
                            opacity: Number(e.target.value) / 100,
                            enabled: true,
                          },
                        }))
                      }
                      className="w-full accent-primary"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border bg-muted/40 px-5 py-3.5">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="cta"
            disabled={saving || loading || Boolean(loadError)}
            onClick={handleSave}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Optimized Image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
