import { describe, expect, it } from "vite-plus/test";
import { cleanRetiredProjectVisuals, cleanRetiredVisualTemplate } from "./visual-cleanup.ts";

const retainedLayer = {
	preset: "shape-rect",
	content: "",
	relStart: 4,
	dur: 2,
	track: 3,
	params: { fill: "transparent", opacity: 0 },
};
const retiredLayer = { preset: "title", content: "retired", relStart: 0, dur: 2 };
const bundle = { overlays: [retiredLayer, retainedLayer], spanSec: 10 };
const clip = (id: number, preset: unknown, params?: unknown) => ({
	id: `text:${id}`,
	type: "text",
	startSec: id * 10,
	durationSec: 10,
	track: 2,
	text: {
		id,
		preset,
		content: "",
		start: id * 10,
		dur: 10,
		params,
		style: { fill: "transparent" },
		layout: { opacity: 0 },
	},
});

describe("project visual cleanup", () => {
	it("deletes only retired text without ripple or changes to surviving fields", () => {
		const plain = clip(1, "plain");
		const media = {
			id: "video:4",
			type: "video",
			startSec: 40,
			durationSec: 3,
			video: { url: "title", params: { preset: "title" } },
		};
		const project = {
			schemaVersion: 2,
			clips: [plain, clip(2, "title"), media],
			markers: [{ clipIds: ["text:2"] }],
			captions: { preset: "title" },
			artifacts: [{ preset: "title" }],
		};
		const before = structuredClone(project);
		const cleaned = cleanRetiredProjectVisuals(project);
		expect(cleaned.counts).toEqual({ removedClips: 1, removedLayers: 0, removedTemplates: 0 });
		expect(cleaned.value).toEqual({ ...project, clips: [plain, media] });
		expect(cleaned.value.clips).toEqual([before.clips[0], before.clips[2]]);
		expect(project).toEqual(before);
		const twice = cleanRetiredProjectVisuals(cleaned.value);
		expect(twice.value).toBe(cleaned.value);
		expect(twice.changed).toBe(false);
	});

	it("keeps late layers and original composition span; removes empty containers", () => {
		const packed = clip(1, "motion-comp", bundle);
		const empty = clip(2, "motion-comp", { ...bundle, overlays: [retiredLayer] });
		const result = cleanRetiredProjectVisuals({ clips: [packed, empty] });
		expect(result.counts).toEqual({ removedClips: 1, removedLayers: 2, removedTemplates: 0 });
		expect(result.value.clips).toEqual([
			{
				...packed,
				text: {
					...packed.text,
					params: { schemaVersion: 1, overlays: [retainedLayer], spanSec: 10 },
				},
			},
		]);
		expect(cleanRetiredProjectVisuals(result.value).changed).toBe(false);
	});

	it("uses historical missing/empty preset semantics in clips and legacy arrays", () => {
		for (const preset of [undefined, null, ""]) {
			const raw = clip(1, preset);
			expect(cleanRetiredProjectVisuals({ clips: [raw] }).counts.removedClips).toBe(1);
			const result = cleanRetiredProjectVisuals({
				text_overlays: [raw.text, { preset: "plain", start_sec: 30, duration_sec: 4 }],
			});
			expect(result.value.text_overlays).toEqual([
				{ preset: "plain", start_sec: 30, duration_sec: 4 },
			]);
		}
	});

	it("reports malformed and unknown IDs without changing input", () => {
		for (const params of [
			{ ...bundle, schemaVersion: 2 },
			{ ...bundle, overlays: [{ ...retainedLayer, preset: "rve-unknown" }] },
			{ ...bundle, overlays: [{ ...retainedLayer, dur: NaN }] },
		]) {
			const input = { clips: [clip(1, "motion-comp", params)] };
			const before = structuredClone(input);
			expect(() => cleanRetiredProjectVisuals(input)).toThrow(/clips\[0\].text.params/);
			expect(input).toEqual(before);
		}
		expect(() => cleanRetiredProjectVisuals({ clips: [clip(1, "title.png")] })).toThrow(
			/clips\[0\].text.preset/,
		);
	});
});

describe("saved template cleanup", () => {
	const identity = {
		id: "saved",
		label: "Custom",
		owner: "original",
		createdAt: 10,
		updatedAt: 20,
	};
	it("preserves retained record identity, ownership, span and layer values", () => {
		const input = { ...identity, kind: "composition", base: "composition", config: bundle };
		const before = structuredClone(input);
		const result = cleanRetiredVisualTemplate(input);
		expect(result.value).toEqual({
			...input,
			category: "motion",
			config: { schemaVersion: 1, overlays: [retainedLayer], spanSec: 10 },
		});
		expect(result.counts).toEqual({ removedClips: 0, removedLayers: 1, removedTemplates: 0 });
		expect(input).toEqual(before);
		expect(cleanRetiredVisualTemplate(result.value).changed).toBe(false);
	});

	it("deletes empty records and retired-base variants without replacement", () => {
		for (const overlays of [[], [retiredLayer], [{ ...retiredLayer, preset: "" }]]) {
			const result = cleanRetiredVisualTemplate({
				...identity,
				kind: "composition",
				config: { ...bundle, overlays },
			});
			expect(result.value).toBeNull();
			expect(result.counts.removedTemplates).toBe(1);
			expect(result.counts.removedLayers).toBe(overlays.length);
		}
		const variant = cleanRetiredVisualTemplate({
			...identity,
			kind: "text",
			base: "title",
			config: {},
		});
		expect(variant.value).toBeNull();
	});

	it("leaves retained primitive variants unchanged and refuses unknown bases", () => {
		for (const base of ["plain", "shape-rect", "shape-star"]) {
			const input = {
				...identity,
				kind: "text",
				base,
				category: base === "plain" ? "text" : "shape",
				config: base === "plain" ? {} : { fill: "#000" },
			};
			const result = cleanRetiredVisualTemplate(input);
			expect(result.value).toBe(input);
			expect(result.changed).toBe(false);
		}
		expect(() =>
			cleanRetiredVisualTemplate({ ...identity, kind: "text", base: "rve-unknown" }),
		).toThrow(/template.base/);
	});
});
