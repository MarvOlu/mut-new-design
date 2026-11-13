import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
  Monitor,
  Save,
  Smartphone,
  Upload,
} from "lucide-react";
import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";

import { HeroSection, PromoSection } from "@/components/shop/home-sections";
import { AnnouncementBar, FooterContent } from "@/components/shop/SiteChrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminSaveSiteContent, adminUploadImage } from "@/lib/admin.functions";
import { SHOP_KEYS } from "@/lib/admin-queries";
import { BUNDLED_IMAGE_OPTIONS } from "@/lib/design-images";
import { SECTION_LABELS, type SectionId, type SiteContent } from "@/lib/site-content";

export function PageMakerPanel({
  siteContent,
  updatedAt,
}: {
  siteContent: SiteContent;
  updatedAt: string | null;
}) {
  const qc = useQueryClient();
  const saveContent = useServerFn(adminSaveSiteContent);
  const uploadImage = useServerFn(adminUploadImage);

  const [draft, setDraft] = useState<SiteContent>(siteContent);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);

  useEffect(() => {
    setDraft(siteContent);
  }, [siteContent]);

  function updateField<K extends keyof SiteContent>(key: K, value: SiteContent[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function reorderSection(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= draft.sections.length) return;
    setDraft((prev) => {
      const next = [...prev.sections];
      const [moved] = next.splice(from, 1);
      if (!moved) return prev;
      next.splice(to, 0, moved);
      return { ...prev, sections: next };
    });
  }

  function toggleSection(id: SectionId) {
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)),
    }));
  }

  async function handleHeroUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingHero(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result ?? ""));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const res = await uploadImage({
        data: { fileName: file.name, contentType: file.type || "image/jpeg", base64 },
      });
      if (!res.ok) toast.error(res.message);
      else {
        updateField("heroImage", res.key);
        toast.success("Hero banner image uploaded.");
      }
    } catch {
      toast.error("Could not upload hero image.");
    } finally {
      setUploadingHero(false);
      e.target.value = "";
    }
  }

  async function handlePublish() {
    setBusy(true);
    try {
      const res = await saveContent({ data: draft });
      if (!res.ok) {
        toast.error("Could not publish website changes.");
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin"] }),
        ...SHOP_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })),
      ]);
      toast.success("Website changes published to storefront.");
    } catch {
      toast.error("Could not save website changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[440px_1fr]">
      {/* Left Editor & Drag-and-Drop Panel */}
      <div className="space-y-5">
        {/* Drag and Drop Section Layout Panel */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">Drag &amp; Drop Page Sections</h2>
              <p className="text-xs text-muted-foreground">
                Reorder or show/hide sections on the main website.
              </p>
            </div>
            <Button variant="cta" size="sm" disabled={busy} onClick={handlePublish}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Publish
            </Button>
          </div>

          <ul className="mt-4 space-y-2">
            {draft.sections.map((s, idx) => (
              <li
                key={s.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e: DragEvent) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx !== null) reorderSection(dragIdx, idx);
                  setDragIdx(null);
                }}
                className={`flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5 transition-colors ${
                  dragIdx === idx ? "opacity-50" : "hover:bg-muted/40"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                  <span className="truncate text-sm font-semibold">{SECTION_LABELS[s.id]}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={idx === 0}
                    onClick={() => reorderSection(idx, idx - 1)}
                    aria-label={`Move ${SECTION_LABELS[s.id]} up`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={idx === draft.sections.length - 1}
                    onClick={() => reorderSection(idx, idx + 1)}
                    aria-label={`Move ${SECTION_LABELS[s.id]} down`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <button
                    type="button"
                    onClick={() => toggleSection(s.id)}
                    className={`ml-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      s.visible
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {s.visible ? "Shown" : "Hidden"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {updatedAt && (
            <p className="mt-3 text-xs text-muted-foreground">
              Last published {new Date(updatedAt).toLocaleString()}
            </p>
          )}
        </section>

        {/* Copy & Media Controls */}
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-bold">Website Copy &amp; Hero Media</h3>

          <div className="space-y-1.5">
            <Label htmlFor="pm-announcement">Top Announcement Bar</Label>
            <Input
              id="pm-announcement"
              value={draft.announcement}
              onChange={(e) => updateField("announcement", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-hero-title">Hero Title</Label>
              <Input
                id="pm-hero-title"
                value={draft.heroTitle}
                onChange={(e) => updateField("heroTitle", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-hero-hi">Highlighted Words</Label>
              <Input
                id="pm-hero-hi"
                value={draft.heroHighlight}
                onChange={(e) => updateField("heroHighlight", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pm-hero-sub">Hero Subtitle</Label>
            <Textarea
              id="pm-hero-sub"
              rows={2}
              value={draft.heroSubtitle}
              onChange={(e) => updateField("heroSubtitle", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-hero-btn">Hero Button</Label>
              <Input
                id="pm-hero-btn"
                value={draft.heroButton}
                onChange={(e) => updateField("heroButton", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-phone">Contact Phone</Label>
              <Input
                id="pm-phone"
                value={draft.phone}
                onChange={(e) => updateField("phone", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Hero Image</Label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
                {uploadingHero ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Upload picture
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleHeroUpload}
                  disabled={uploadingHero}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Input
                value={draft.heroImage ?? ""}
                onChange={(e) => updateField("heroImage", e.target.value || null)}
                placeholder="Default blueprint or https:// / key"
                className="text-xs"
              />
              {draft.heroImage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => updateField("heroImage", null)}
                >
                  Reset
                </Button>
              )}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {BUNDLED_IMAGE_OPTIONS.slice(0, 6).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => updateField("heroImage", opt.key)}
                  className={`shrink-0 overflow-hidden rounded-lg border-2 ${
                    draft.heroImage === opt.key ? "border-primary" : "border-transparent"
                  }`}
                >
                  <img src={opt.src} alt={opt.label} className="h-9 w-12 object-cover" />
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-shop-head">Categories Heading</Label>
              <Input
                id="pm-shop-head"
                value={draft.shopHeading}
                onChange={(e) => updateField("shopHeading", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-des-head">Designs Heading</Label>
              <Input
                id="pm-des-head"
                value={draft.designsHeading}
                onChange={(e) => updateField("designsHeading", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pm-promo-title">Promo Banner Title</Label>
            <Input
              id="pm-promo-title"
              value={draft.promoTitle}
              onChange={(e) => updateField("promoTitle", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-promo-text">Promo Banner Subtitle</Label>
            <Input
              id="pm-promo-text"
              value={draft.promoText}
              onChange={(e) => updateField("promoText", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-foot-head">Footer Heading</Label>
              <Input
                id="pm-foot-head"
                value={draft.footerHeading}
                onChange={(e) => updateField("footerHeading", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-foot-note">Copyright Note</Label>
              <Input
                id="pm-foot-note"
                value={draft.footerNote}
                onChange={(e) => updateField("footerNote", e.target.value)}
              />
            </div>
          </div>

          <Button
            type="button"
            variant="cta"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={handlePublish}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Publish Website Changes
          </Button>
        </section>
      </div>

      {/* Live Preview Canvas */}
      <section className="min-w-0 rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-bold">Live Website Preview</span>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setPreviewMode("desktop")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
                previewMode === "desktop"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              <Monitor className="h-3.5 w-3.5" /> Desktop
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("mobile")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
                previewMode === "mobile"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" /> Mobile
            </button>
          </div>
        </div>

        <div className="overflow-x-auto bg-muted/40 p-4">
          <div
            className={`mx-auto overflow-hidden rounded-2xl border border-border bg-background shadow-sm transition-all ${
              previewMode === "mobile" ? "max-w-[390px]" : "w-full"
            }`}
          >
            <AnnouncementBar text={draft.announcement} />
            <div className="space-y-8 p-4 sm:p-6">
              {draft.sections
                .filter((s) => s.visible)
                .map((s) => {
                  if (s.id === "hero") return <HeroSection key="hero" content={draft} />;
                  if (s.id === "categories") {
                    return (
                      <div key="categories" className="rounded-xl border border-border bg-card p-4">
                        <h3 className="text-lg font-bold">{draft.shopHeading}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Active category pills render here dynamically.
                        </p>
                      </div>
                    );
                  }
                  if (s.id === "designs") {
                    return (
                      <div key="designs" className="rounded-xl border border-border bg-card p-4">
                        <h3 className="text-lg font-bold">{draft.designsHeading}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Design cards &amp; image carousels render here.
                        </p>
                      </div>
                    );
                  }
                  return <PromoSection key="promo" content={draft} />;
                })}
            </div>
            <div className="bg-primary text-primary-foreground">
              <FooterContent content={draft} ownerLink={false} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
