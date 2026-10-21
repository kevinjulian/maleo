/* An option the client offers is an option the pipeline renders.
 *
 * `4:5` was selectable in the timeline's aspect menu and in Project Settings,
 * and no layer implemented it: `aspectOf` had no branch, `FORMAT_DIMS` had no
 * row, and the renderer's `aspectMap` had only vertical/square/horizontal.
 * Because all three defaulted the same way, the preview agreed with the export
 * and both were 9:16 — a control labelled "Portrait" produced a vertical video.
 * No type, test or reviewer could see it: the lookup that sits between the two
 * vocabularies turns the disagreement into plausible output, because
 * `FORMAT_DIMS[fmt] ?? FORMAT_DIMS["9:16"]` cannot tell "unsupported" from
 * "9:16".
 *
 * This compares imported VALUES, never source text. A check that greps for
 * `case "flip":` goes green the moment an implementation is refactored into a
 * shape the pattern does not recognise — which is exactly when parity is most
 * likely to have broken. */
import { describe, expect, test } from "vite-plus/test";
import {
	aspectMap,
	resolveTransition,
	visualRevealBlackDirections,
	visualRevealColorBuilds,
	visualRevealDirections,
	visualRevealPhases,
	visualRevealTextures,
	visualRevealTypes,
} from "@maleo/video/composition";
import { TIMELINE_SCENE_TRANSITIONS } from "@maleo/shared";
import { ASPECT_RATIOS } from "@models/core/measures.ts";
import {
	CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS,
	CLIENT_VISUAL_REVEAL_COLOR_BUILDS,
	CLIENT_VISUAL_REVEAL_DIRECTIONS,
	CLIENT_VISUAL_REVEAL_PHASES,
	CLIENT_VISUAL_REVEAL_TEXTURES,
	CLIENT_VISUAL_REVEAL_TYPES,
	FORMAT_DIMS,
	VIDEO_ASPECTS,
} from "@models/timeline/timeline-editor-model.ts";

describe("every vocabulary the check reads is present", () => {
	/* This runs first and exists because the check resolves values across a
	 * package boundary, so it has several ways to read nothing: a moved export, a
	 * renamed entry point, a changed `exports` map in packages/video. A scan of
	 * nothing and a scan finding nothing are indistinguishable in a passing
	 * result — the same reason web-http-boundary's guard asserts its own target. */
	test("no vocabulary is empty", () => {
		expect(VIDEO_ASPECTS.length).toBeGreaterThan(0);
		expect(Object.keys(FORMAT_DIMS).length).toBeGreaterThan(0);
		expect(Object.keys(ASPECT_RATIOS).length).toBeGreaterThan(0);
		expect(Object.keys(aspectMap).length).toBeGreaterThan(0);
		expect(TIMELINE_SCENE_TRANSITIONS.length).toBeGreaterThan(0);
		expect(CLIENT_VISUAL_REVEAL_TYPES.length).toBeGreaterThan(0);
		expect(visualRevealTypes.length).toBeGreaterThan(0);
		expect(CLIENT_VISUAL_REVEAL_PHASES.length).toBeGreaterThan(0);
		expect(visualRevealPhases.length).toBeGreaterThan(0);
		expect(CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS.length).toBeGreaterThan(0);
		expect(visualRevealBlackDirections.length).toBeGreaterThan(0);
		expect(CLIENT_VISUAL_REVEAL_TEXTURES.length).toBeGreaterThan(0);
		expect(visualRevealTextures.length).toBeGreaterThan(0);
		expect(CLIENT_VISUAL_REVEAL_COLOR_BUILDS.length).toBeGreaterThan(0);
		expect(visualRevealColorBuilds.length).toBeGreaterThan(0);
	});
});

describe("every offered aspect is implemented", () => {
	test("each has render dimensions", () => {
		for (const { id } of VIDEO_ASPECTS) {
			expect(FORMAT_DIMS[id], `${id} has no FORMAT_DIMS row`).toBeDefined();
		}
	});

	test("each has a ratio", () => {
		for (const { id } of VIDEO_ASPECTS) {
			expect(ASPECT_RATIOS[id], `${id} has no ASPECT_RATIOS entry`).toBeDefined();
		}
	});

	/* The two vocabularies are spelled differently — the client says "9:16" and
	 * the renderer says "vertical" — so they are matched on the thing that has to
	 * agree rather than on a name table nobody would maintain: the renderer must
	 * be able to produce the dimensions the client previews at. */
	test("each maps onto a size the renderer can produce", () => {
		const renderable = Object.values(aspectMap).map((d) => `${d.width}x${d.height}`);
		for (const { id } of VIDEO_ASPECTS) {
			const dims = FORMAT_DIMS[id]!;
			expect(renderable, `${id} (${dims.w}x${dims.h}) is in no aspectMap entry`).toContain(
				`${dims.w}x${dims.h}`,
			);
		}
	});

	/* The ratio and the dimensions are two statements of one fact, and nothing
	 * made them agree. A row added to one but computed wrong in the other is the
	 * same class of defect as a row missing entirely. */
	test("the declared ratio matches the declared dimensions", () => {
		for (const { id } of VIDEO_ASPECTS) {
			const dims = FORMAT_DIMS[id]!;
			expect(ASPECT_RATIOS[id]!).toBeCloseTo(dims.w / dims.h, 5);
		}
	});
});

describe("every offered transition is implemented", () => {
	/* The probe compares against the default arm, so it is only meaningful if the
	 * default arm is stable between calls. If `fade()` returned a fresh component
	 * identity each time, every id would look handled and the suite below would
	 * pass vacuously. Asserted rather than assumed. */
	test("the default arm is stable, so comparing against it means something", () => {
		expect(resolveTransition("fade").presentation.component).toBe(
			resolveTransition("fade").presentation.component,
		);
	});

	/* An id with no `case` falls through to `default`, which returns fade. So an
	 * unimplemented transition is not an error — it silently renders as a fade,
	 * and the way to notice is to watch an export. */
	test("each resolves to something other than the fade fallback", () => {
		const fallback = resolveTransition("fade").presentation.component;
		for (const id of TIMELINE_SCENE_TRANSITIONS) {
			if (id === "fade") continue;
			expect(
				resolveTransition(id, undefined, { width: 1080, height: 1920 }).presentation.component,
				`${id} resolves to the fade fallback, so it is not implemented`,
			).not.toBe(fallback);
		}
	});
});

describe("every offered reveal effect is implemented", () => {
	test("effect types match renderer schema", () => {
		expect(CLIENT_VISUAL_REVEAL_TYPES).toEqual(visualRevealTypes);
	});

	test("directions match renderer schema", () => {
		expect(CLIENT_VISUAL_REVEAL_DIRECTIONS).toEqual(visualRevealDirections);
	});

	test("black slide directions match renderer schema", () => {
		expect(CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS).toEqual(visualRevealBlackDirections);
	});

	test("phases match renderer schema", () => {
		expect(CLIENT_VISUAL_REVEAL_PHASES).toEqual(visualRevealPhases);
	});

	test("textures match renderer schema", () => {
		expect(CLIENT_VISUAL_REVEAL_TEXTURES).toEqual(visualRevealTextures);
	});

	test("color builds match renderer schema", () => {
		expect(CLIENT_VISUAL_REVEAL_COLOR_BUILDS).toEqual(visualRevealColorBuilds);
	});
});
