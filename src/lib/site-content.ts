// Words, pictures and section layout of the main website, edited in the dashboard page maker.

export const SECTION_IDS = ["hero", "categories", "designs", "promo"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  hero: "Top banner",
  categories: "Shop by category",
  designs: "Designs list",
  promo: "Basket reminder",
};

export interface SiteSection {
  id: SectionId;
  visible: boolean;
}

export interface SiteContent {
  announcement: string;
  heroTitle: string;
  heroHighlight: string;
  heroSubtitle: string;
  heroButton: string;
  /** Picture key: "upload:<path>", an https link, or null for the built-in blueprint picture. */
  heroImage: string | null;
  shopHeading: string;
  designsHeading: string;
  promoTitle: string;
  promoText: string;
  footerHeading: string;
  phone: string;
  footerNote: string;
  sections: SiteSection[];
}

export const DEFAULT_SITE_CONTENT: SiteContent = {
  announcement: "Pay with M-PESA · Download your design instantly in PDF, DWG, DXF, PNG or JPG",
  heroTitle: "Get",
  heroHighlight: "classy designs",
  heroSubtitle: "That look premium and stay affordable to construct.",
  heroButton: "Shop now →",
  heroImage: null,
  shopHeading: "Shop by category",
  designsHeading: "Available designs",
  promoTitle: "Trendy, modern architecture shaped by the latest building technology.",
  promoText: "Order now, and download your classic and affordable design.",
  footerHeading: "Have a project in mind?",
  phone: "+254 725 202833",
  footerNote: "© 2026 Mutken Architectural Design. All rights reserved.",
  sections: SECTION_IDS.map((id) => ({ id, visible: true })),
};

type TextKey = Exclude<keyof SiteContent, "sections" | "heroImage">;
const TEXT_KEYS = Object.keys(DEFAULT_SITE_CONTENT).filter(
  (k) => k !== "sections" && k !== "heroImage",
) as TextKey[];

/** Every section appears exactly once; unknown ones are dropped and missing ones are added at the end, shown. */
export function normalizeSections(raw: unknown): SiteSection[] {
  const seen = new Set<SectionId>();
  const out: SiteSection[] = [];
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const id = (s as { id?: unknown })?.id;
      if (typeof id !== "string" || !(SECTION_IDS as readonly string[]).includes(id)) continue;
      if (seen.has(id as SectionId)) continue;
      seen.add(id as SectionId);
      out.push({ id: id as SectionId, visible: (s as { visible?: unknown }).visible !== false });
    }
  }
  for (const id of SECTION_IDS) if (!seen.has(id)) out.push({ id, visible: true });
  return out;
}

/** Fills in anything missing or broken in the saved content with the defaults. */
export function resolveSiteContent(raw: unknown): SiteContent {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const content: SiteContent = { ...DEFAULT_SITE_CONTENT, sections: normalizeSections(src["sections"]) };
  for (const key of TEXT_KEYS) {
    const v = src[key];
    if (typeof v === "string" && v.trim().length > 0) content[key] = v.slice(0, 400);
  }
  content.heroImage = typeof src["heroImage"] === "string" && src["heroImage"].trim() ? src["heroImage"] : null;
  return content;
}

/** tel: link for a phone number as typed by the owner. */
export function phoneHref(phone: string): string {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}
