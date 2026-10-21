// Number, price and text formatting for catalog-style listings.
export function fmtNumber(n: number | null | undefined): string {
	if (n == null) return "—";
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
	return n.toString();
}

export function truncate(s: string | null | undefined, len = 80): string {
	if (!s) return "";
	if (s.length <= len) return s;
	return s.slice(0, len) + "…";
}

// Catalog prices are sourced in IDR. The reference library has its own USD
// formatter (`models/references/ref-transforms.ts`); the two are different currencies, not
// duplicates.
export function fmtPriceIdr(n: number | null | undefined): string {
	if (n == null) return "—";
	if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}jt`;
	if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}rb`;
	return `Rp ${n}`;
}
