/* Auto stat extraction — mine product metadata / notes / brief text for numeric
 * claims and turn each into a ready-to-add infographic payload, ranked by how
 * much scroll-stopping power the number carries. Pure + deterministic so the
 * suggestion list is unit-testable and free to compute on every panel open. */
import type { InfographicPayload } from "@maleo/shared";

export interface StatSuggestion {
	/** 0-100 — how scroll-stopping the number is (discounts/ratings rank high). */
	score: number;
	/** Short human reason shown next to the suggestion. */
	source: string;
	payload: InfographicPayload;
}

const dedupeKey = (p: InfographicPayload): string => JSON.stringify(p);

interface Matcher {
	pattern: RegExp;
	build: (
		m: RegExpMatchArray,
	) => { score: number; source: string; payload: InfographicPayload } | null;
}

const MATCHERS: Matcher[] = [
	{
		// "4.8 stars", "4.8/5", "4.8★" — with optional nearby review count.
		pattern: /(\d\.\d)\s*(?:\/\s*5|stars?|★|bintang)/gi,
		build: (m) => {
			const rating = Number(m[1]);
			if (!(rating >= 3 && rating <= 5)) return null;
			return {
				score: 88,
				source: `rating ${rating}`,
				payload: { type: "social_proof", title: "Rated by real buyers", rating },
			};
		},
	},
	{
		// "2,300 reviews" / "1.2k reviews"
		pattern: /([\d.,]+k?)\s*(?:reviews?|ulasan|penilaian)/gi,
		build: (m) => ({
			score: 80,
			source: `${m[1]} reviews`,
			payload: { type: "social_proof", title: "Buyers agree", reviewCount: m[1]! },
		}),
	},
	{
		// "12k sold" / "10.000+ terjual"
		pattern: /([\d.,]+k?\+?)\s*(?:sold|terjual)/gi,
		build: (m) => ({
			score: 84,
			source: `${m[1]} sold`,
			payload: { type: "social_proof", title: "Flying off shelves", soldCount: m[1]! },
		}),
	},
	{
		// "-40%", "40% off", "diskon 40%"
		pattern: /(?:-|save\s+|off\s*|diskon\s+)?(\d{1,2})\s*%\s*(?:off|discount|diskon)?/gi,
		build: (m) => {
			const pct = Number(m[1]);
			if (!(pct >= 10 && pct <= 90)) return null;
			// Only treat as a discount when discount words appear around the number.
			if (!/off|discount|diskon|save|-/.test(m[0]!.toLowerCase())) return null;
			return {
				score: 92,
				source: `${pct}% off`,
				payload: {
					type: "price_tag",
					title: "Deal right now",
					price: "",
					badge: `-${pct}%`,
					dropAnimation: true,
				},
			};
		},
	},
	{
		// "30h battery", "30 jam", "30-day", "30 hari"
		pattern: /(\d{1,4})\s*(?:-|\s)?(hours?|h\b|jam|days?|hari|minggu|weeks?|months?|bulan)/gi,
		build: (m) => ({
			score: 60,
			source: `${m[1]} ${m[2]}`,
			payload: { type: "stat_reveal", title: "Built to last", value: m[1]!, suffix: ` ${m[2]!}` },
		}),
	},
	{
		// Currency prices: "$49", "Rp 1.2jt", "Rp149.000"
		pattern: /((?:\$|Rp\s?)[\d.,]+(?:jt|rb|k)?)/gi,
		build: (m) => ({
			score: 55,
			source: `price ${m[1]}`,
			payload: { type: "price_tag", title: "The price", price: m[1]! },
		}),
	},
];

/** Extract ranked infographic suggestions from free text (title, bullets,
 *  description, notes, brief — join with newlines). */
export function extractStats(text: string): StatSuggestion[] {
	const out: StatSuggestion[] = [];
	const seen = new Set<string>();
	for (const matcher of MATCHERS) {
		for (const m of text.matchAll(matcher.pattern)) {
			const built = matcher.build(m);
			if (!built) continue;
			const key = dedupeKey(built.payload);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(built);
		}
	}
	// A discount suggestion carries no price of its own — fill it from a mined
	// price so the callout is complete, and drop the now-redundant bare price.
	const discount = out.find((s) => s.payload.type === "price_tag" && !s.payload.price);
	const priceIdx = out.findIndex((s) => s.payload.type === "price_tag" && s.payload.price);
	if (discount && discount.payload.type === "price_tag" && priceIdx !== -1) {
		const priced = out[priceIdx]!.payload;
		if (priced.type === "price_tag") {
			discount.payload = { ...discount.payload, price: priced.price };
			out.splice(priceIdx, 1);
		}
	}
	return out.sort((a, b) => b.score - a.score).slice(0, 8);
}
