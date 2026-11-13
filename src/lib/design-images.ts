import residential from "@/assets/design-residential.jpg";
import commercial from "@/assets/design-commercial.jpg";
import industrial from "@/assets/design-industrial.jpg";
import urban from "@/assets/design-urban.jpg";
import interior from "@/assets/design-interior.jpg";
import floorplan from "@/assets/design-floorplan.jpg";
import elevation from "@/assets/design-elevation.jpg";
import residentialInterior from "@/assets/design-residential-interior.jpg";
import commercialLobby from "@/assets/design-commercial-lobby.jpg";
import industrialDetail from "@/assets/design-industrial-detail.jpg";
import urbanAerial from "@/assets/design-urban-aerial.jpg";
import interiorDetail from "@/assets/design-interior-detail.jpg";

const images: Record<string, string> = {
  residential,
  commercial,
  industrial,
  urban,
  interior,
  floorplan,
  elevation,
  "residential-interior": residentialInterior,
  "commercial-lobby": commercialLobby,
  "industrial-detail": industrialDetail,
  "urban-aerial": urbanAerial,
  "interior-detail": interiorDetail,
};

export const BUNDLED_IMAGE_OPTIONS: { key: string; label: string; src: string }[] = [
  { key: "residential", label: "Residential Exterior", src: residential },
  { key: "residential-interior", label: "Residential Interior", src: residentialInterior },
  { key: "floorplan", label: "Floor Plan", src: floorplan },
  { key: "elevation", label: "Elevation Drawing", src: elevation },
  { key: "commercial", label: "Commercial Tower", src: commercial },
  { key: "commercial-lobby", label: "Commercial Lobby", src: commercialLobby },
  { key: "industrial", label: "Industrial Structure", src: industrial },
  { key: "industrial-detail", label: "Structural Detail", src: industrialDetail },
  { key: "urban", label: "Urban Mixed-Use", src: urban },
  { key: "urban-aerial", label: "Urban Aerial", src: urbanAerial },
  { key: "interior", label: "Interior Design", src: interior },
  { key: "interior-detail", label: "Interior Detail", src: interiorDetail },
];

export const UPLOAD_PREFIX = "upload:";

/** Address the shop serves an uploaded picture from (pictures live in private storage). */
export function uploadedImageUrl(path: string): string {
  return "/api/public/images/" + path.split("/").map(encodeURIComponent).join("/");
}

/**
 * An image entry is a key for a bundled picture, "upload:<path>" for a picture uploaded in the
 * dashboard, or a full https:// link.
 */
export function designImage(key: string): string {
  if (key.startsWith(UPLOAD_PREFIX)) return uploadedImageUrl(key.slice(UPLOAD_PREFIX.length));
  if (/^https?:\/\//i.test(key) || key.startsWith("data:")) return key;
  return images[key] ?? residential;
}

/** All pictures for a design: its `images` list, or its single main picture when the list is empty. */
export function designGallery(d: { images?: string[] | null; image_key: string }): string[] {
  const keys = (d.images ?? []).filter((k) => k.trim().length > 0);
  return (keys.length ? keys : [d.image_key]).map(designImage);
}

/** Parallel list of raw image keys matching designGallery(d) for looking up captions. */
export function designGalleryKeys(d: { images?: string[] | null; image_key: string }): string[] {
  const keys = (d.images ?? []).filter((k) => k.trim().length > 0);
  return keys.length ? keys : [d.image_key];
}
