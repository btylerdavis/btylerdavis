/**
 * Curated demo mattress catalog (~30 SKUs) — Tempur-Pedic lines first
 * (TECHNICAL.md §T2 catalog note), plus other Mattress Hub brands.
 * firmnessRating is the normalized 1-10 scale (higher = firmer).
 */
export interface CatalogEntry {
  sku: string;
  brand: string;
  model: string;
  firmnessRating: number;
  materialClass: "memory_foam" | "hybrid" | "innerspring" | "latex";
  size: string;
}

export const MATTRESS_CATALOG: CatalogEntry[] = [
  // Tempur-Pedic ProAdapt line
  { sku: "TP-PROADAPT-S-Q", brand: "Tempur-Pedic", model: "TEMPUR-ProAdapt Soft", firmnessRating: 3, materialClass: "memory_foam", size: "Queen" },
  { sku: "TP-PROADAPT-M-Q", brand: "Tempur-Pedic", model: "TEMPUR-ProAdapt Medium", firmnessRating: 5, materialClass: "memory_foam", size: "Queen" },
  { sku: "TP-PROADAPT-MH-Q", brand: "Tempur-Pedic", model: "TEMPUR-ProAdapt Medium Hybrid", firmnessRating: 6, materialClass: "hybrid", size: "Queen" },
  { sku: "TP-PROADAPT-MH-K", brand: "Tempur-Pedic", model: "TEMPUR-ProAdapt Medium Hybrid", firmnessRating: 6, materialClass: "hybrid", size: "King" },
  { sku: "TP-PROADAPT-F-Q", brand: "Tempur-Pedic", model: "TEMPUR-ProAdapt Firm", firmnessRating: 8, materialClass: "memory_foam", size: "Queen" },
  // Tempur-Pedic LuxeAdapt line
  { sku: "TP-LUXEADAPT-S-Q", brand: "Tempur-Pedic", model: "TEMPUR-LuxeAdapt Soft", firmnessRating: 3, materialClass: "memory_foam", size: "Queen" },
  { sku: "TP-LUXEADAPT-MH-Q", brand: "Tempur-Pedic", model: "TEMPUR-LuxeAdapt Medium Hybrid", firmnessRating: 6, materialClass: "hybrid", size: "Queen" },
  { sku: "TP-LUXEADAPT-F-K", brand: "Tempur-Pedic", model: "TEMPUR-LuxeAdapt Firm", firmnessRating: 8, materialClass: "memory_foam", size: "King" },
  // Tempur-Pedic Adapt line
  { sku: "TP-ADAPT-M-Q", brand: "Tempur-Pedic", model: "TEMPUR-Adapt Medium", firmnessRating: 5, materialClass: "memory_foam", size: "Queen" },
  { sku: "TP-ADAPT-MH-Q", brand: "Tempur-Pedic", model: "TEMPUR-Adapt Medium Hybrid", firmnessRating: 6, materialClass: "hybrid", size: "Queen" },
  { sku: "TP-ADAPT-MH-F", brand: "Tempur-Pedic", model: "TEMPUR-Adapt Medium Hybrid", firmnessRating: 6, materialClass: "hybrid", size: "Full" },
  // Beautyrest
  { sku: "BR-BLACK-LX-P-Q", brand: "Beautyrest", model: "Black L-Class Plush", firmnessRating: 4, materialClass: "hybrid", size: "Queen" },
  { sku: "BR-BLACK-CX-M-Q", brand: "Beautyrest", model: "Black C-Class Medium", firmnessRating: 6, materialClass: "hybrid", size: "Queen" },
  { sku: "BR-BLACK-KX-F-K", brand: "Beautyrest", model: "Black K-Class Firm", firmnessRating: 8, materialClass: "hybrid", size: "King" },
  { sku: "BR-HARMONY-M-Q", brand: "Beautyrest", model: "Harmony Lux Medium", firmnessRating: 5, materialClass: "innerspring", size: "Queen" },
  { sku: "BR-HARMONY-PL-Q", brand: "Beautyrest", model: "Harmony Lux Plush", firmnessRating: 3, materialClass: "innerspring", size: "Queen" },
  // Serta
  { sku: "SR-ISERIES-H3-Q", brand: "Serta", model: "iSeries Hybrid 3000 Medium", firmnessRating: 6, materialClass: "hybrid", size: "Queen" },
  { sku: "SR-ISERIES-H1-Q", brand: "Serta", model: "iSeries Hybrid 1000 Firm", firmnessRating: 8, materialClass: "hybrid", size: "Queen" },
  { sku: "SR-PS-PLUS-M-Q", brand: "Serta", model: "Perfect Sleeper Plus Medium", firmnessRating: 5, materialClass: "innerspring", size: "Queen" },
  { sku: "SR-PS-PLUS-P-F", brand: "Serta", model: "Perfect Sleeper Plus Plush", firmnessRating: 3, materialClass: "innerspring", size: "Full" },
  { sku: "SR-ARCTIC-MF-Q", brand: "Serta", model: "Arctic Premier Memory Foam", firmnessRating: 5, materialClass: "memory_foam", size: "Queen" },
  // Simmons
  { sku: "SM-DEEPSLEEP-M-Q", brand: "Simmons", model: "DeepSleep Medium", firmnessRating: 5, materialClass: "innerspring", size: "Queen" },
  { sku: "SM-DEEPSLEEP-F-Q", brand: "Simmons", model: "DeepSleep Firm", firmnessRating: 7, materialClass: "innerspring", size: "Queen" },
  { sku: "SM-GELMF-M-T", brand: "Simmons", model: "Gel Memory Foam Medium", firmnessRating: 5, materialClass: "memory_foam", size: "Twin XL" },
  // Five Star
  { sku: "FS-PINNACLE-MH-Q", brand: "Five Star", model: "Pinnacle Medium Hybrid", firmnessRating: 6, materialClass: "hybrid", size: "Queen" },
  { sku: "FS-PINNACLE-F-Q", brand: "Five Star", model: "Pinnacle Firm", firmnessRating: 8, materialClass: "innerspring", size: "Queen" },
  { sku: "FS-CROWN-P-K", brand: "Five Star", model: "Crown Jewel Plush", firmnessRating: 3, materialClass: "innerspring", size: "King" },
  // Latex options
  { sku: "LX-NATURA-M-Q", brand: "Natura", model: "GreenSpring Latex Medium", firmnessRating: 6, materialClass: "latex", size: "Queen" },
  { sku: "LX-NATURA-F-Q", brand: "Natura", model: "GreenSpring Latex Firm", firmnessRating: 8, materialClass: "latex", size: "Queen" },
  { sku: "LX-TALALAY-M-K", brand: "PureTal", model: "Talalay Bliss Medium", firmnessRating: 5, materialClass: "latex", size: "King" },
];

/** Marcus Reed's scripted purchase (medium-firm hybrid — the flagship-signal combo). */
export const MARCUS_SKU = "TP-PROADAPT-MH-Q";

/** Medium-firm hybrid = the combo carrying the supine-time treatment effect. */
export function isMediumFirmHybrid(entry: Pick<CatalogEntry, "firmnessRating" | "materialClass">): boolean {
  return entry.materialClass === "hybrid" && entry.firmnessRating >= 5 && entry.firmnessRating <= 7;
}
