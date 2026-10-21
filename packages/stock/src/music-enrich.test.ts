import { describe, expect, it } from "vite-plus/test";
import {
	applyEnrichment,
	buildEnrichPrompt,
	buildLabelCommand,
	needsEnrichment,
	parseEnrichment,
	planEnrich,
	type EnrichableBed,
} from "./music-enrich.ts";

const bed = (over: Partial<EnrichableBed> = {}): EnrichableBed => ({
	source: `https://pixabay.test/${over.id ?? "calm"}`,
	id: "calm",
	title: "Soft Ambient Pad",
	tags: ["ambient", "pad"],
	...over,
});

describe("deciding what to send", () => {
	it("sends a bed with no description", () => {
		expect(needsEnrichment(bed({ emotion: "calm" }))).toBe(true);
	});

	it("sends a bed with no emotion", () => {
		expect(needsEnrichment(bed({ description: "sustained pad" }))).toBe(true);
	});

	it("leaves a fully labelled bed alone", () => {
		expect(needsEnrichment(bed({ description: "sustained pad", emotion: "calm" }))).toBe(false);
	});

	it("treats a blank label as missing rather than present", () => {
		expect(needsEnrichment(bed({ description: "   ", emotion: "calm" }))).toBe(true);
	});

	it("splits a library into what costs money and what does not", () => {
		// The published manifest is the cache: re-running only pays for the gaps.
		const plan = planEnrich([
			bed({ id: "a", description: "pad", emotion: "calm" }),
			bed({ id: "b" }),
			bed({ id: "c", description: "drums" }),
		]);
		expect(plan.pending.map((b) => b.id)).toEqual(["b", "c"]);
		expect(plan.settled.map((b) => b.id)).toEqual(["a"]);
	});

	it("sends everything when forced", () => {
		const plan = planEnrich([bed({ description: "pad", emotion: "calm" })], { force: true });
		expect(plan.pending).toHaveLength(1);
	});
});

describe("the prompt", () => {
	it("offers the full vocabulary and an explicit way out", () => {
		// Emotion outranks every other signal, so refusing has to be as easy as
		// answering — otherwise the model guesses to satisfy the format.
		const prompt = buildEnrichPrompt(bed());
		expect(prompt).toContain("suspense");
		expect(prompt).toContain("victory");
		expect(prompt).toContain('"none"');
	});

	it("carries the labels the page already gave", () => {
		const prompt = buildEnrichPrompt(bed({ title: "Dark Pulse", tags: ["drone", "tension"] }));
		expect(prompt).toContain("Dark Pulse");
		expect(prompt).toContain("drone, tension");
	});

	it("says so when a bed has no tags, rather than showing an empty list", () => {
		expect(buildEnrichPrompt(bed({ tags: [] }))).toContain("(none)");
	});
});

describe("the command", () => {
	it("runs one-shot, with no tools and no session", () => {
		// Tools would give a labelling step the ability to edit the repo it is
		// invoked from; a session would let one bed's answer colour the next.
		const cmd = buildLabelCommand();
		expect(cmd[0]).toBe("pi");
		expect(cmd).toContain("-p");
		expect(cmd).toContain("--no-tools");
		expect(cmd).toContain("--no-session");
	});

	it("leaves provider and model to the CLI's own configuration unless asked", () => {
		expect(buildLabelCommand().join(" ")).not.toContain("--model");
		expect(buildLabelCommand().join(" ")).not.toContain("--provider");
	});

	it("passes an override through as separate argv entries", () => {
		// A single "--model x" string would be passed as one argument and rejected.
		const cmd = buildLabelCommand({ model: "anthropic/claude-sonnet-5", provider: "anthropic" });
		expect(cmd[cmd.indexOf("--model") + 1]).toBe("anthropic/claude-sonnet-5");
		expect(cmd[cmd.indexOf("--provider") + 1]).toBe("anthropic");
	});

	it("can point at a different binary", () => {
		expect(buildLabelCommand({ command: "/opt/bin/pi" })[0]).toBe("/opt/bin/pi");
	});
});

describe("reading the answer", () => {
	it("takes a clean response", () => {
		const result = parseEnrichment(
			'{"description":"sustained string pad, slow build","emotion":"hope"}',
		);
		expect(result).toEqual({ description: "sustained string pad, slow build", emotion: "hope" });
	});

	it("tolerates a code fence", () => {
		const result = parseEnrichment('```json\n{"description":"soft piano","emotion":"calm"}\n```');
		expect(result?.emotion).toBe("calm");
	});

	it("drops an emotion outside the vocabulary rather than mapping it to the nearest", () => {
		// "uplifting" is not one of the ten. Coercing it to "hope" would invent a
		// weight-5 match the bed never earned.
		const result = parseEnrichment('{"description":"bright strings","emotion":"uplifting"}');
		expect(result?.emotion).toBeUndefined();
		expect(result?.description).toBe("bright strings");
	});

	it("accepts a declined emotion and keeps the description", () => {
		const result = parseEnrichment('{"description":"lofi beat, soft hiss","emotion":"none"}');
		expect(result).toEqual({ description: "lofi beat, soft hiss" });
	});

	it("normalises case and surrounding space in the emotion", () => {
		expect(parseEnrichment('{"description":"x","emotion":" Tension "}')?.emotion).toBe("tension");
	});

	it("caps a long description instead of letting it drown the tags", () => {
		const long = "a".repeat(400);
		expect(parseEnrichment(`{"description":"${long}","emotion":"calm"}`)!.description).toHaveLength(
			240,
		);
	});

	it("collapses whitespace so the stored label is one line", () => {
		expect(
			parseEnrichment('{"description":"soft  pad\\n  and hiss","emotion":"calm"}')?.description,
		).toBe("soft pad and hiss");
	});

	it("reports unparseable output rather than writing a blank label", () => {
		expect(parseEnrichment("I think this one sounds calm!")).toBeNull();
		expect(parseEnrichment("")).toBeNull();
		expect(parseEnrichment("[1,2,3]")).toBeNull();
	});

	it("reports an answer that committed to nothing", () => {
		expect(parseEnrichment('{"description":"","emotion":"none"}')).toBeNull();
	});
});

describe("merging", () => {
	it("fills the blanks", () => {
		const next = applyEnrichment(bed(), { description: "soft pad", emotion: "calm" });
		expect(next.description).toBe("soft pad");
		expect(next.emotion).toBe("calm");
	});

	it("never clears a label the answer was silent about", () => {
		// With --force re-running the whole library, treating silence as deletion
		// would strip labels a human had corrected by hand.
		const next = applyEnrichment(bed({ description: "hand written", emotion: "victory" }), {
			description: "",
		});
		expect(next.description).toBe("hand written");
		expect(next.emotion).toBe("victory");
	});

	it("leaves the rest of the bed untouched", () => {
		const original = bed({
			url: "https://files.test/music/a.mp3",
			sha256: "abc",
			source: "https://pixabay.test/a",
		});
		const next = applyEnrichment(original, { description: "soft pad" });
		expect(next.url).toBe("https://files.test/music/a.mp3");
		expect(next.sha256).toBe("abc");
		expect(next.source).toBe("https://pixabay.test/a");
	});

	it("does not mutate the bed it was given", () => {
		const original = bed();
		applyEnrichment(original, { description: "soft pad", emotion: "calm" });
		expect(original.description).toBeUndefined();
		expect(original.emotion).toBeUndefined();
	});
});
