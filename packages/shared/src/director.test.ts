import { describe, expect, test } from "vite-plus/test";
import { applyDirector, styleDirective } from "./director.ts";
import { findPresetFixture } from "./content-preset-builtins.ts";
import type { StyleKnobs } from "./video-style.ts";
import { inferBeat } from "./video-blueprint.ts";
import type { Scene } from "./timeline-model.ts";

/** Knobs for a shipped style, by the builtin preset that owns them. Tests used to
 *  reach for a style registry; the builtins are where styles live now. */
function knobs(styleId: string): StyleKnobs | undefined {
	return findPresetFixture(styleId)?.bundle.style ?? undefined;
}

function scene(id: number, over: Partial<Scene> = {}): Scene {
	return {
		id,
		dur: 4,
		name: `Scene ${id}`,
		shot: "Medium Shot",
		move: "Static",
		transition: "fade",
		vis: "",
		vo: "",
		img: false,
		...over,
	};
}

describe("inferBeat", () => {
	test("first scene is the hook, last is the cta", () => {
		expect(inferBeat(0, 5)).toBe("hook");
		expect(inferBeat(4, 5)).toBe("cta");
	});

	test("a single scene is just a hook", () => {
		expect(inferBeat(0, 1)).toBe("hook");
	});
});

describe("applyDirector", () => {
	test("no style → scenes returned unchanged", () => {
		const input = [scene(1), scene(2)];
		expect(applyDirector(input, undefined)).toBe(input);
	});

	test("a style assigns beat + emotion and overrides camera/transition", () => {
		const out = applyDirector([scene(1), scene(2), scene(3)], knobs("high-energy-challenge"));
		// Every scene gets a beat + emotion.
		for (const s of out) {
			expect(s.beat).toBeTruthy();
			expect(s.emotion).toBeTruthy();
		}
		// First scene is the hook with a non-default camera move.
		expect(out[0]!.beat).toBe("hook");
		expect(out[0]!.move).not.toBe("Static");
	});

	test("input scenes are not mutated", () => {
		const input = [scene(1, { move: "Static", transition: "fade" })];
		const out = applyDirector(input, knobs("cinematic-story"));
		expect(input[0]!.move).toBe("Static");
		expect(input[0]!.beat).toBeUndefined();
		expect(out[0]).not.toBe(input[0]);
	});

	test("an explicit scene beat is respected over positional inference", () => {
		const out = applyDirector(
			[scene(1, { beat: "twist" }), scene(2)],
			knobs("editorial-map-explainer"),
		);
		expect(out[0]!.beat).toBe("twist");
	});

	test("transition is the OUTGOING edge; last scene keeps its own", () => {
		const valid: Array<Scene["transition"]> = ["cut", "fade", "slide", "zoom", "wipe"];
		const out = applyDirector(
			[scene(1), scene(2), scene(3, { transition: "wipe" })],
			knobs("high-energy-challenge"),
		);
		// Non-last scenes get a resolved outgoing transition.
		expect(valid).toContain(out[0]!.transition);
		expect(valid).toContain(out[1]!.transition);
		// Last scene has no outgoing edge — its existing transition is preserved.
		expect(out[2]!.transition).toBe("wipe");
	});
});

/* The planner prompt used to carry the style's slug twice — once from
 * content-generator and once from this directive's first line. Both are gone: the
 * slug states nothing the description does not, and for an operator-authored
 * style it would be a uuid. What the model must still receive is what the style
 * IS. */
describe("styleDirective", () => {
	const meta = {
		name: "High-Energy Challenge",
		description: "Maximal energy: fast cuts, huge text, constant SFX.",
	};

	test("names and describes the style, and states its knobs", () => {
		const out = styleDirective(knobs("high-energy-challenge"), meta)!;
		expect(out).toContain("High-Energy Challenge");
		expect(out).toContain("Maximal energy");
		expect(out).toContain("fast");
		expect(out).toContain("punchy saturation, high contrast");
		expect(out).toContain("high-energy, hype, driving beat");
		expect(out).toContain("~2s per scene");
	});

	test("emits no bare style identifier", () => {
		const out = styleDirective(knobs("high-energy-challenge"), meta)!;
		expect(out).not.toContain("high-energy-challenge");
		expect(out.toLowerCase()).not.toContain("preset id");
	});

	test("an operator-authored style gets the same fields as a shipped one", () => {
		const custom = {
			...knobs("high-energy-challenge")!,
			pacing: "slow" as const,
			colorMood: "washed pastel",
		};
		const out = styleDirective(custom, { name: "House Look", description: "Ours." })!;
		expect(out).toContain("House Look");
		expect(out).toContain("washed pastel");
		expect(out).toContain("slow");
	});

	test("still asks for per-scene beat and emotion", () => {
		expect(styleDirective(knobs("editorial-map-explainer"), meta)).toContain("beat");
		expect(styleDirective(knobs("editorial-map-explainer"), meta)).toContain("emotion");
	});

	test("no style yields no directive", () => {
		expect(styleDirective(undefined, meta)).toBeUndefined();
	});

	test("knobs without identity still describe the style", () => {
		const out = styleDirective(knobs("editorial-map-explainer"))!;
		expect(out).toContain("Pacing:");
		expect(out).not.toContain("Style direction:");
	});
});
