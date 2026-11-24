import type { GalleryTemplate } from "../../../shared/catalog";
import { brandCatalogFile, brandCoverRevision } from "../../../shared/brand-catalog";
import { brandKitShowcase, brandKitWebsite } from "../../../shared/brand-kit";
import type { BrandKit } from "../../../shared/brand-kit";
import { gatewayRequest } from "./gatewayClient";
export {
  brandKitInstruction,
  brandKitShowcase,
  isBrandKitBusy,
} from "../../../shared/brand-kit";
export type { BrandKit, BrandStyle } from "../../../shared/brand-kit";
export const brandFile = (kit: BrandKit, name: string) =>
  `/motion-api/brand-kits/${kit.id}/files/${name}?v=${encodeURIComponent(kit.updatedAt)}`;
export const brandRequest = <T>(suffix = "", method = "GET", body?: unknown) =>
  gatewayRequest<T>("brand-kits" + suffix, method, body);
/** Status reads must never strand the polling loop behind a stalled request. */
export async function loadBrandKits(signal: AbortSignal): Promise<BrandKit[]> {
  const response = await fetch("/motion-api/brand-kits", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Could not load Brand Kits");
  return (await response.json()).kits;
}
export const brandStage: Record<BrandKit["state"], string> = {
  queued: "Queued",
  scanning: "Reading your website",
  extracting: "Measuring brand styles",
  packaging: "Preparing Motion Package",
  rendering: "Rendering brand preview",
  ready: "Ready",
  failed: "Extraction failed",
  cancelled: "Cancelled",
};

export function brandCard(kit: BrandKit, subtitle: string): GalleryTemplate {
  const website = brandKitWebsite(kit);
  const { duration, width, height } = brandKitShowcase;
  return {
    id: kit.id,
    title: kit.name,
    subtitle,
    description: subtitle,
    collection: "reference",
    kind: "reference",
    tags: ["brand-kit", "style-only"],
    author: kit.name,
    brand: kit.name,
    sourceUrl: website || kit.url,
    duration,
    width,
    height,
    previewUrl: kit.preview ? brandFile(kit, "preview.mp4") : undefined,
    posterUrl: kit.poster ? brandFile(kit, "poster.png") : kit.catalogId ? brandCatalogFile(kit.catalogId, "style-cover.svg") : undefined,
    brandLogoUrl: website || kit.url ? `/motion-api/brand-kits/${kit.id}/favicon?v=${brandCoverRevision}` : undefined,
  };
}
