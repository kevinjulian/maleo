/* The document-to-wire transforms, pinned where the split left them exposed.
 *
 * `storyboardJson` and `buildSceneImageRequest` already had coverage. These did
 * not, and they decide what the server stores for a project's brief and its
 * speakers — a wrong field here is a silent data loss that no typecheck sees,
 * because every field is a string going into a blob.
 *
 * `referencesFromState` was covered here too, until it turned out to be building
 * rows for `content_references` — a table retired months earlier — which the
 * create route never declared and therefore discarded. The tests passed the whole
 * time. The roster now travels as entity ids. */
import { describe, expect, test } from "vite-plus/test";
import type { Config, RefsState, Speaker } from "@maleo/shared";
import { findPresetFixture, type StyleKnobs } from "@maleo/shared";

const knobs = (styleId: string): StyleKnobs => findPresetFixture(styleId)!.bundle.style!;
import { briefFromConfig, speakersFromState } from "./document-wire.ts";

const refs = (over: Partial<RefsState> = {}): RefsState => ({
	images: [],
	speakers: [],
	notes: [],
	style: {} as RefsState["style"],
	...over,
});

describe("briefFromConfig", () => {
	test("maps the wizard's three brief fields onto the stored blob", () => {
		const style = knobs("high-energy-challenge");
		expect(
			briefFromConfig({
				brief: "sell the shoe",
				audience: "runners",
				style,
				styleName: "High-Energy Challenge",
				styleDescription: "Maximal energy.",
			} as Config),
		).toEqual({
			goal: "sell the shoe",
			workspace_profile: "runners",
			style_preset: style,
			style_preset_name: "High-Energy Challenge",
			style_preset_description: "Maximal energy.",
		});
	});

	/* The setup description is deliberately NOT the goal — it describes the project
	 * for the list, while the brief drives generation. CreateContent.test.ts guards
	 * the same separation by reading this file's source. */
	test("takes the goal from the brief, never from the description", () => {
		const brief = briefFromConfig({
			brief: "a 30s teaser",
			description: "internal notes",
		} as Config);
		expect(brief.goal).toBe("a 30s teaser");
	});

	test("trims, and an empty field stores null rather than an empty string", () => {
		expect(briefFromConfig({ brief: "  spaced  ", audience: "   " } as Config)).toEqual({
			goal: "spaced",
			workspace_profile: null,
			style_preset: null,
			style_preset_name: null,
			style_preset_description: null,
		});
	});

	test("an absent config yields all nulls", () => {
		expect(briefFromConfig({} as Config)).toEqual({
			goal: null,
			workspace_profile: null,
			style_preset: null,
			style_preset_name: null,
			style_preset_description: null,
		});
	});
});

describe("speakersFromState", () => {
	test("carries the voice key, name and resolved hue", () => {
		const state = refs({
			speakers: [{ id: "s1", name: "Narrator", voiceId: "v-alloy", hue: 120 } as Speaker],
		});
		const [row] = speakersFromState("video", state);

		expect(row).toMatchObject({ voice_key: "v-alloy", name: "Narrator", is_default: false });
		expect(typeof row?.hue).toBe("number");
	});

	test("falls back to the speaker id when no voice is chosen", () => {
		const state = refs({ speakers: [{ id: "s1", name: "Narrator" } as Speaker] });
		expect(speakersFromState("video", state)[0]?.voice_key).toBe("s1");
	});

	test("the default flag crosses as a boolean, not undefined", () => {
		const state = refs({
			speakers: [
				{ id: "s1", name: "N", default: true } as Speaker,
				{ id: "s2", name: "M" } as Speaker,
			],
		});
		expect(speakersFromState("video", state).map((s) => s.is_default)).toEqual([true, false]);
	});

	/* Only video has narrated scenes to assign a voice to. An image or text project
	 * carrying speakers would write rows nothing ever reads. */
	test("image and text projects have no speakers", () => {
		const state = refs({ speakers: [{ id: "s1", name: "Narrator" } as Speaker] });

		expect(speakersFromState("image", state)).toEqual([]);
		expect(speakersFromState("text", state)).toEqual([]);
	});
});
