import { describe, expect, test } from "vite-plus/test";
import { corpusToken, sanitizeCorpusValue, vocabularyOf } from "./sanitize.ts";

const vocabulary = vocabularyOf([`const kinds = ["video", "text"]; const fit = "contain";`]);
const real = {
	id: "video:3",
	type: "video",
	title: "My launch video",
	voiceoverText: "",
	url: "/api/media/9b2c1f0e-0000-4000-8000-000000000001",
	mediaAssetId: "9b2c1f0e-0000-4000-8000-000000000001",
	fill: "#FF3E6C",
	startSec: 0.1,
	locked: false,
	beat: null,
	layout: { fit: "contain", playbackRate: 1.5 },
	refIds: ["Brand guide", "Brand guide"],
	byAsset: { "9b2c1f0e-0000-4000-8000-000000000001": 1, "0": 2 },
};

describe("corpus sanitizer", () => {
	const out = sanitizeCorpusValue(real, vocabulary) as typeof real;

	test("keeps structure, numbers, booleans, null and empty strings", () => {
		expect(Object.keys(out)).toEqual(Object.keys(real));
		expect(out.startSec).toBe(0.1);
		expect(out.locked).toBe(false);
		expect(out.beat).toBeNull();
		expect(out.voiceoverText).toBe("");
		expect(out.layout.playbackRate).toBe(1.5);
		expect(out.refIds).toHaveLength(2);
	});

	test("keeps vocabulary, colours and ordinal ids", () => {
		expect(out.type).toBe("video");
		expect(out.layout.fit).toBe("contain");
		expect(out.fill).toBe("#FF3E6C");
		expect(out.id).toBe("video:3");
	});

	test("replaces text, URLs and identifiers, consistently", () => {
		expect(out.title).toBe(corpusToken("My launch video"));
		expect(out.url).toMatch(/^s-[0-9a-f]{12}$/);
		expect(out.mediaAssetId).toBe(corpusToken(real.mediaAssetId));
		expect(out.refIds[0]).toBe(out.refIds[1]);
		expect(JSON.stringify(out)).not.toContain("launch");
		expect(JSON.stringify(out)).not.toContain("9b2c1f0e");
	});

	test("replaces non-identifier record keys and keeps numeric ones", () => {
		expect(Object.keys(out.byAsset).sort()).toEqual(["0", corpusToken(real.mediaAssetId)].sort());
	});

	test("is idempotent and deterministic", () => {
		expect(sanitizeCorpusValue(out, vocabulary)).toEqual(out);
		expect(sanitizeCorpusValue(real, vocabulary)).toEqual(out);
	});

	test("vocabulary is the double-quoted literals of the sources", () => {
		expect([...vocabularyOf([`a("x-y"); b = "has \\"quote\\""; c = 'single';`])]).toEqual(["x-y", 'has \\"quote\\"']);
	});
});
