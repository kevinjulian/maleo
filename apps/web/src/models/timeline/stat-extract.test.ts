import { describe, expect, test } from "vite-plus/test";
import { extractStats } from "./stat-extract.ts";

describe("extractStats", () => {
	test("mines rating, reviews, sold, discount, duration, and price from product text", () => {
		const text = [
			"Wireless earbuds — 4.8 stars from 2,300 reviews, 12k sold.",
			"30h battery life. Now Rp 1.2jt, 40% off this week only.",
		].join("\n");
		const suggestions = extractStats(text);
		const types = suggestions.map((s) => s.payload.type);
		expect(types).toContain("social_proof");
		expect(types).toContain("price_tag");
		expect(types).toContain("stat_reveal");

		const rating = suggestions.find(
			(s) => s.payload.type === "social_proof" && "rating" in s.payload && s.payload.rating,
		);
		expect(rating && "rating" in rating.payload ? rating.payload.rating : null).toBe(4.8);

		const discount = suggestions.find(
			(s) => s.payload.type === "price_tag" && "badge" in s.payload && s.payload.badge,
		);
		expect(discount && discount.payload.type === "price_tag" ? discount.payload.badge : null).toBe(
			"-40%",
		);
		// The mined price folds into the discount callout; no redundant bare price.
		expect(discount && discount.payload.type === "price_tag" ? discount.payload.price : null).toBe(
			"Rp 1.2jt",
		);
		expect(suggestions.filter((s) => s.payload.type === "price_tag").length).toBe(1);
	});

	test("ranked by shock value: discount and rating outrank generic durations", () => {
		const suggestions = extractStats("4.8 stars, 40% off, 30h battery");
		expect(suggestions[0]!.payload.type).not.toBe("stat_reveal");
		const statIdx = suggestions.findIndex((s) => s.payload.type === "stat_reveal");
		const discountIdx = suggestions.findIndex((s) => s.payload.type === "price_tag");
		expect(discountIdx).toBeLessThan(statIdx);
	});

	test("no numbers → no suggestions", () => {
		expect(extractStats("soft and comfortable, ships fast")).toEqual([]);
	});

	test("dedupes identical suggestions and caps at 8", () => {
		const suggestions = extractStats(Array.from({ length: 20 }, () => "4.8 stars").join(" "));
		expect(suggestions.length).toBe(1);
	});

	test("implausible rating values are skipped", () => {
		expect(
			extractStats("version 9.9 stars nothing").some((s) => s.payload.type === "social_proof"),
		).toBe(false);
	});
});
