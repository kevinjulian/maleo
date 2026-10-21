/* Research is an artifact, and a plan cites it by reference (standardize-pipeline-
 * artifact-contracts 3.1). The run holds one research bundle; a plan records which
 * exact revision it was drafted against; research revised afterwards is what the
 * next draft works from, never evidence the existing plan claims. */
import { describe, expect, test } from "bun:test";
import {
	artifactRefOf,
	artifactsOfKind,
	researchBundleArtifact,
	storyPlanArtifactOf,
} from "@maleo/shared";
import type { AgentJob } from "./model.ts";
import type { ResearchBundle } from "../../../lib/web-research.ts";
import { getStoryPlan, setStoryPlan } from "./plan-state.ts";
import { declaredArtifacts, groundedResearch, researchOf, setResearch } from "./research-state.ts";
import { FINALIZE_CONTRACT, PLAN_CONTRACT } from "./stage-contracts.ts";

const TOPIC = "sejarah runtuhnya Majapahit";
const KEY = "sejarah runtuhnya majapahit";

function job(): AgentJob {
	return {
		id: "run-research",
		projectId: "project-research",
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: TOPIC,
		startedAt: 0,
	};
}

function bundle(...urls: string[]): ResearchBundle {
	const sources = urls.map((url) => ({
		url,
		title: url,
		excerpt: `Excerpt from ${url} long enough to cite.`,
		retrievedAt: "2026-09-29T00:00:00.000Z",
	}));
	return {
		topic: TOPIC,
		queries: ["majapahit"],
		sources,
		claims: sources.map((s) => ({ text: s.excerpt, sourceUrls: [s.url] })),
	};
}

const section = {
	id: "s1",
	title: "One",
	narration: "Majapahit fell.",
	visualPrompt: "ruins",
	estimatedDurationSec: 10,
	factual: true,
};

function draft(current: AgentJob): void {
	setStoryPlan(current, 60, [section], false, undefined, {
		planningBrief: TOPIC,
		factual: true,
		researchKey: KEY,
	});
}

describe("research as an artifact", () => {
	test("the run's research is the artifact, rebuilt into the bundle the planner reads", () => {
		const current = job();
		setResearch(current, bundle("https://a.test"));
		expect(current.artifacts.map((a) => a.kind)).toEqual(["research_bundle"]);
		expect(researchOf(current)).toEqual(bundle("https://a.test"));
	});

	test("a draft grounded in research references that exact research", () => {
		const current = job();
		setResearch(current, bundle("https://a.test"));
		draft(current);
		const research = artifactsOfKind(current.artifacts, researchBundleArtifact)[0]!;
		expect(storyPlanArtifactOf(current.artifacts)!.inputRefs).toEqual([artifactRefOf(research)]);
		expect(groundedResearch(current)?.sources.map((s) => s.url)).toEqual(["https://a.test"]);
	});

	test("research revised after the draft is not evidence the plan cites, until a redraft", () => {
		const current = job();
		setResearch(current, bundle("https://a.test"));
		draft(current);
		setResearch(current, bundle("https://a.test", "https://b.test"));
		// The run holds the richer research; the plan still names the revision it used.
		expect(researchOf(current)?.sources).toHaveLength(2);
		expect(groundedResearch(current)).toBeUndefined();
		draft(current);
		expect(groundedResearch(current)?.sources).toHaveLength(2);
	});

	test("a re-save without a redraft keeps the reference the plan already had", () => {
		const current = job();
		setResearch(current, bundle("https://a.test"));
		draft(current);
		const before = storyPlanArtifactOf(current.artifacts)!.inputRefs;
		setResearch(current, bundle("https://a.test", "https://b.test"));
		setStoryPlan(
			current,
			60,
			getStoryPlan(current)!.sections.map((s) => ({ ...s, title: "Edited" })),
		);
		expect(storyPlanArtifactOf(current.artifacts)!.inputRefs).toEqual(before);
	});

	test("an ungrounded draft references no research", () => {
		const current = job();
		setResearch(current, bundle("https://a.test"));
		setStoryPlan(current, 60, [{ ...section, factual: false }], false, undefined, {
			planningBrief: TOPIC,
			factual: false,
		});
		expect(storyPlanArtifactOf(current.artifacts)!.inputRefs).toEqual([]);
	});

	test("a stage sees research only when it declares it", () => {
		const current = job();
		setResearch(current, bundle("https://a.test"));
		draft(current);
		expect(declaredArtifacts(current, FINALIZE_CONTRACT)).toEqual([]);
		expect(
			declaredArtifacts(current, PLAN_CONTRACT)
				.map((a) => a.kind)
				.sort(),
		).toEqual(["research_bundle", "story_plan"]);
	});
});
