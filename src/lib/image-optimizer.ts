export type CropAspect = "free" | "4:3" | "16:9" | "1:1" | "3:2";
export type WatermarkPosition = "bottom-right" | "bottom-left" | "center" | "tile";

export interface ImageCrop {
  /** Normalized 0..1 coordinates in rotated image space */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  position: WatermarkPosition;
  opacity: number;
}

export interface ImageEditConfig {
  crop: ImageCrop;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  targetWidth: number;
  targetHeight: number;
  brightness: number;
  contrast: number;
  saturation: number;
  watermark: WatermarkConfig;
}

export interface OptimizedImageResult {
  base64: string;
  fileName: string;
  contentType: string;
  width: number;
  height: number;
  originalSizeBytes: number;
  sizeBytes: number;
  optimized: boolean;
}

export function createDefaultEditConfig(width = 1200, height = 900): ImageEditConfig {
  return {
    crop: { x: 0, y: 0, width: 1, height: 1 },
    rotate: 0,
    flipH: false,
    flipV: false,
    targetWidth: width,
    targetHeight: height,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    watermark: {
      enabled: false,
      text: "MUTKEN DESIGNS",
      position: "bottom-right",
      opacity: 0.45,
    },
  };
}

export function clampCrop(crop: ImageCrop): ImageCrop {
  const width = Math.min(1, Math.max(0.08, crop.width));
  const height = Math.min(1, Math.max(0.08, crop.height));
  const x = Math.min(1 - width, Math.max(0, crop.x));
  const y = Math.min(1 - height, Math.max(0, crop.y));
  return { x, y, width, height };
}

export function estimateBase64Bytes(dataUrl: string): number {
  const b64 = dataUrl.includes(",") ? (dataUrl.split(",")[1] ?? "") : dataUrl;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(1, Math.floor((b64.length * 3) / 4) - padding);
}

export function fitDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDim = 1600,
): { width: number; height: number } {
  if (srcWidth <= 0 || srcHeight <= 0) return { width: 1200, height: 900 };
  const largest = Math.max(srcWidth, srcHeight);
  if (largest <= maxDim) return { width: Math.round(srcWidth), height: Math.round(srcHeight) };
  const scale = maxDim / largest;
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  };
}

export function aspectRatioValue(aspect: CropAspect): number | null {
  switch (aspect) {
    case "4:3":
      return 4 / 3;
    case "16:9":
      return 16 / 9;
    case "1:1":
      return 1;
    case "3:2":
      return 3 / 2;
    default:
      return null;
  }
}

export function rotatedDimensions(
  naturalWidth: number,
  naturalHeight: number,
  rotate: 0 | 90 | 180 | 270,
): { width: number; height: number } {
  if (rotate === 90 || rotate === 270) {
    return { width: naturalHeight, height: naturalWidth };
  }
  return { width: naturalWidth, height: naturalHeight };
}

export function encodeCanvasOptimized(
  canvas: HTMLCanvasElement,
  baseName: string,
  quality = 0.82,
): { dataUrl: string; contentType: string; fileName: string; sizeBytes: number } {
  const cleanStem = baseName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "design-image";
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) {
    return {
      dataUrl: webp,
      contentType: "image/webp",
      fileName: `${cleanStem}.webp`,
      sizeBytes: estimateBase64Bytes(webp),
    };
  }
  const jpeg = canvas.toDataURL("image/jpeg", Math.min(0.92, quality + 0.04));
  return {
    dataUrl: jpeg,
    contentType: "image/jpeg",
    fileName: `${cleanStem}.jpg`,
    sizeBytes: estimateBase64Bytes(jpeg),
  };
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:\/\//i.test(src) && !src.startsWith(window.location.origin)) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for processing."));
    img.src = src;
  });
}

/**
 * Automatically optimizes a newly selected image file on the client:
 * resizes oversized photos to max 1600px, strips EXIF via canvas re-encode,
 * and compresses to WebP (with JPEG fallback).
 */
export async function optimizeImageFile(
  file: File,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<OptimizedImageResult> {
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.82;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(objectUrl);
    const naturalW = img.naturalWidth || 1200;
    const naturalH = img.naturalHeight || 900;
    const { width, height } = fitDimensions(naturalW, naturalH, maxDim);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    const encoded = encodeCanvasOptimized(canvas, file.name, quality);
    return {
      base64: encoded.dataUrl,
      fileName: encoded.fileName,
      contentType: encoded.contentType,
      width,
      height,
      originalSizeBytes: file.size,
      sizeBytes: encoded.sizeBytes,
      optimized: true,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function renderEditedImageToCanvas(
  img: HTMLImageElement,
  edits: ImageEditConfig,
  canvas: HTMLCanvasElement,
  overrideDimensions?: { width: number; height: number },
) {
  const naturalW = img.naturalWidth || 1200;
  const naturalH = img.naturalHeight || 900;
  const rotDims = rotatedDimensions(naturalW, naturalH, edits.rotate);

  // Stage 1: render rotated / flipped + color-adjusted full source onto scratch canvas
  const stage = document.createElement("canvas");
  stage.width = rotDims.width;
  stage.height = rotDims.height;
  const sctx = stage.getContext("2d");
  if (!sctx) throw new Error("Canvas 2D context unavailable.");

  sctx.save();
  sctx.filter = `brightness(${edits.brightness}%) contrast(${edits.contrast}%) saturate(${edits.saturation}%)`;
  sctx.translate(rotDims.width / 2, rotDims.height / 2);
  sctx.rotate((edits.rotate * Math.PI) / 180);
  sctx.scale(edits.flipH ? -1 : 1, edits.flipV ? -1 : 1);
  sctx.drawImage(img, -naturalW / 2, -naturalH / 2, naturalW, naturalH);
  sctx.restore();

  // Stage 2: apply normalized crop + resize to destination canvas
  const crop = clampCrop(edits.crop);
  const sx = crop.x * rotDims.width;
  const sy = crop.y * rotDims.height;
  const sw = Math.max(1, crop.width * rotDims.width);
  const sh = Math.max(1, crop.height * rotDims.height);

  const outW = Math.max(16, Math.round(overrideDimensions?.width ?? edits.targetWidth));
  const outH = Math.max(16, Math.round(overrideDimensions?.height ?? edits.targetHeight));

  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(stage, sx, sy, sw, sh, 0, 0, outW, outH);

  // Stage 3: apply optional watermark
  if (edits.watermark.enabled && edits.watermark.text.trim()) {
    drawWatermark(ctx, outW, outH, edits.watermark);
  }
}

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  wm: WatermarkConfig,
) {
  const label = wm.text.trim();
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.045));
  ctx.save();
  ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.globalAlpha = Math.min(0.95, Math.max(0.08, wm.opacity));

  if (wm.position === "tile") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const stepX = Math.max(180, fontSize * label.length * 0.85);
    const stepY = Math.max(110, fontSize * 3.5);
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-Math.PI / 6);
    for (let y = -height; y <= height; y += stepY) {
      for (let x = -width; x <= width; x += stepX) {
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = Math.max(2, fontSize * 0.08);
        ctx.strokeText(label, x, y);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillText(label, x, y);
      }
    }
    ctx.restore();
    return;
  }

  const pad = Math.max(14, Math.round(Math.min(width, height) * 0.035));
  let x = width - pad;
  let y = height - pad;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";

  if (wm.position === "bottom-left") {
    x = pad;
    y = height - pad;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
  } else if (wm.position === "center") {
    x = width / 2;
    y = height / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.lineWidth = Math.max(2.5, fontSize * 0.1);
  ctx.strokeText(label, x, y);
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.fillText(label, x, y);
  ctx.restore();
}

export async function exportEditedImage(
  src: string,
  baseFileName: string,
  edits: ImageEditConfig,
  quality = 0.84,
): Promise<OptimizedImageResult> {
  const img = await loadHtmlImage(src);
  const canvas = document.createElement("canvas");
  renderEditedImageToCanvas(img, edits, canvas);
  const encoded = encodeCanvasOptimized(canvas, baseFileName, quality);
  return {
    base64: encoded.dataUrl,
    fileName: encoded.fileName,
    contentType: encoded.contentType,
    width: canvas.width,
    height: canvas.height,
    originalSizeBytes: estimateBase64Bytes(encoded.dataUrl),
    sizeBytes: encoded.sizeBytes,
    optimized: true,
  };
}
