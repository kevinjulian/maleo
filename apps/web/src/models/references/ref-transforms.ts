/* Maleo — References: pure ref/product transforms */
import { referenceTags } from "@models/references/reference-vocabulary.ts";
import type { RefsState } from "@maleo/shared";

export type SetRefs = (fn: (r: RefsState) => RefsState) => void;
export type ToggleCat = "image" | "voice" | "note";

export function fmtPrice(price: number | null): string {
	if (price == null) return "";
	return price >= 1000 ? `$${(price / 1000).toFixed(price >= 10000 ? 0 : 1)}k` : `$${price}`;
}

// Category is a data shape, not "first tag": an asset tagged ["kitchen","product"]
// is still a product. Treat anything carrying the product tag/kind as a product.
export function isProductRef(ref: { tags?: string[]; kind?: string }): boolean {
	return ref.kind === "product" || referenceTags(ref).includes("product");
}
