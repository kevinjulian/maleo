import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_TIMELINE_TEMPLATE, timelineTemplateInputSchema } from "./timeline-template.ts";

/* A template persists as one `template_json` blob, not as columns, and the schema is
 * `.strict()`. So retiring a field or renaming one is not a schema-only edit: every
 * row written by an older build still carries the old keys, and a strict parse of one
 * of those throws. `ensureDefaultTimelineTemplate` runs on every list and get, so that
 * throw takes the whole template panel rather than one row.
 *
 * These tests pin the read-side normaliser that reconciles old blobs, and pin that it
 * did not become a blanket passthrough on the way. */
describe("stored blobs written before the field retirements still parse", () => {
	const storedBefore = () => ({
		...DEFAULT_TIMELINE_TEMPLATE,
		// The renamed pair, under the names an old row used.
		introTextPreset: undefined,
		sectionTextPreset: undefined,
		introMotionPreset: "section-card",
		sectionMotionPreset: "rve-countdown-intro",
		// The retired keys, each of which a real row still carries.
		backgroundFill: "#123456",
		referenceIds: ["ent_abc", "ent_def"],
		useData: false,
	});

	test("an old blob parses and yields the current field names", () => {
		const raw = storedBefore();
		delete (raw as Record<string, unknown>).introTextPreset;
		delete (raw as Record<string, unknown>).sectionTextPreset;

		const parsed = timelineTemplateInputSchema.parse(raw);

		expect(parsed.introTextPreset).toBe("section-card");
		expect(parsed.sectionTextPreset).toBe("rve-countdown-intro");
	});

	test("the retired keys are gone from the parsed result", () => {
		const raw = storedBefore();
		delete (raw as Record<string, unknown>).introTextPreset;
		delete (raw as Record<string, unknown>).sectionTextPreset;

		const parsed = timelineTemplateInputSchema.parse(raw) as Record<string, unknown>;

		expect("backgroundFill" in parsed).toBe(false);
		expect("referenceIds" in parsed).toBe(false);
		expect("useData" in parsed).toBe(false);
	});

	test("a current blob is unaffected, so the shim is a no-op after the migration", () => {
		const parsed = timelineTemplateInputSchema.parse({ ...DEFAULT_TIMELINE_TEMPLATE });

		expect(parsed).toEqual(DEFAULT_TIMELINE_TEMPLATE);
	});

	/* A blob holding both names is mid-migration — written by the new build, then read
	 * by it again before the migration cleared the old key. The new name wins; taking
	 * the old one would undo an edit the operator just made. */
	test("a blob carrying both names keeps the new one", () => {
		const parsed = timelineTemplateInputSchema.parse({
			...DEFAULT_TIMELINE_TEMPLATE,
			introTextPreset: "chapter",
			introMotionPreset: "section-card",
		});

		expect(parsed.introTextPreset).toBe("chapter");
	});

	test("strict parsing still rejects a genuinely unknown key", () => {
		expect(() =>
			timelineTemplateInputSchema.parse({
				...DEFAULT_TIMELINE_TEMPLATE,
				intoTextPrest: "chapter",
			}),
		).toThrow();
	});

	test("the default template round-trips through a parse", () => {
		expect(timelineTemplateInputSchema.parse(DEFAULT_TIMELINE_TEMPLATE)).toEqual(
			DEFAULT_TIMELINE_TEMPLATE,
		);
	});
});
