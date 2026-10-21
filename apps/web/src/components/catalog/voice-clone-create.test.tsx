/* Cloning is offered where it is meaningful, and nowhere else.
 *
 * The surface reads which providers clone off the payload, so these assertions
 * name no provider — a provider added later must change nothing here.
 */
import { describe, expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TtsProviderOption } from "@maleo/shared";
import { VoiceCloneCreate } from "./voice-clone-create.tsx";
import { voiceRows } from "./voices-library.tsx";

const CLONING: TtsProviderOption = {
	id: "cloner",
	label: "Cloning Provider",
	health: "ready",
	clones: true,
	voices: [],
};

const DECLARING: TtsProviderOption = {
	id: "declarer",
	label: "Declaring Provider",
	health: "ready",
	voices: [{ id: "M1", name: "Marcus", desc: "Warm male", lang: "EN", hue: 1, sampleUrl: null }],
};

describe("the clone control", () => {
	test("is offered when a provider clones", () => {
		const html = renderToStaticMarkup(
			<VoiceCloneCreate providers={[CLONING]} onCreated={() => {}} />,
		);
		expect(html).toContain("Clone a voice");
	});

	/* Nothing to offer is not an error state: the control is absent rather than
	 * present and dead. */
	test("renders nothing when no registered provider clones", () => {
		const html = renderToStaticMarkup(<VoiceCloneCreate providers={[]} onCreated={() => {}} />);
		expect(html).toBe("");
	});
});

describe("a clone is an ordinary catalogue voice", () => {
	/* The point of a clone being a row with an id: it flows through the same
	 * listing code as a declared voice, with no branch anywhere. */
	test("appears in the library rows beside declared voices", () => {
		const withClone: TtsProviderOption = {
			...CLONING,
			voices: [
				{
					id: "vc_1",
					name: "Bu Sri",
					desc: "Cloned voice",
					lang: "ID",
					hue: 9,
					sampleUrl: "/uploads/voice-clone-a.wav",
					cloned: true,
				},
			],
		};
		const rows = voiceRows([DECLARING, withClone]);
		expect(rows.map((r) => r.voice.id)).toEqual(["M1", "vc_1"]);
		expect(rows[1]?.voice.cloned).toBe(true);
	});

	/* A clone has no baked sample and must still be auditionable — through the
	 * recording it was created from. */
	test("carries a play source even though no bake ran", () => {
		const rows = voiceRows([
			{
				...CLONING,
				voices: [
					{
						id: "vc_1",
						name: "Bu Sri",
						desc: "Cloned voice",
						lang: "ID",
						sampleUrl: "/uploads/voice-clone-a.wav",
						cloned: true,
					},
				],
			},
		]);
		expect(rows[0]?.voice.sampleUrl).toBe("/uploads/voice-clone-a.wav");
	});
});
