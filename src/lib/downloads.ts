// Download rules shared by the server and the order page.

export const DOWNLOAD_FORMATS = {
  pdf: { label: "PDF", description: "Print-ready drawings" },
  dwg: { label: "DWG", description: "AutoCAD drawing" },
  dxf: { label: "DXF", description: "CAD exchange file" },
  png: { label: "PNG", description: "High-resolution image" },
  jpg: { label: "JPG", description: "Compressed image" },
} as const;

export type DownloadFormat = keyof typeof DOWNLOAD_FORMATS;

export const FORMAT_ORDER: DownloadFormat[] = ["pdf", "dwg", "dxf", "png", "jpg"];

/** Maps a stored file name to a download format, or null if the file type is not offered. */
export function formatForFile(fileName: string): DownloadFormat | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ext && ext in DOWNLOAD_FORMATS ? (ext as DownloadFormat) : null;
}

export interface OrderAccess {
  status: string;
  design_ids: string[];
}

/** A design can only be downloaded once its order is paid and it was part of that order. */
export function canDownload(order: OrderAccess | null | undefined, designId: string): boolean {
  return !!order && order.status === "paid" && order.design_ids.includes(designId);
}
