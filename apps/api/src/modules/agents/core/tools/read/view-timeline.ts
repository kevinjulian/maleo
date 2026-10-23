import { knowledgeArtifact, referencesPendingMedia } from "@maleo/shared";
import { jobArtifactsOfKind } from "../../artifact-store.ts";
import { defineTool } from "../../types.ts";
import { emptyArgs } from "../../helpers/schemas.ts";

export const viewTimeline = defineTool({
	name: "view_timeline",
	kind: "read",
	contentType: ["video"],
	intents: ["build_short", "build_story", "edit_element", "add_element", "research", "restyle"],
	input: emptyArgs,
	description:
		"view_timeline {} - READ-ONLY: inspect the current timeline (scenes, durations, media, what's missing)",
	handler: async (ctx) => {
		const job = ctx.job;
		let acc = 0;
		const lines = job.scenes.map((s, i) => {
			const start = s.startSec ?? acc;
			acc = start + Math.max(1, s.durationSec);
			return `#${i + 1} ${s.name} ${start.toFixed(1)}-${acc.toFixed(1)}s${s.image ? " [frame]" : " [no frame]"}${s.voiceover ? " [vo]" : ""}`;
		});
		const missing: string[] = [];
		if (!jobArtifactsOfKind(job, knowledgeArtifact).length) missing.push("story_outline");
		if (job.scenes.some((s) => !s.image)) missing.push("frames");
		const uploading = [job.scenes, job.videoOverlays, job.audioOverlays, job.clientClips ?? []]
			.flat()
			.filter((item) => referencesPendingMedia(item, job.pendingMediaIds)).length;
		const pending = uploading
			? ` ${uploading} clip(s) use a file still uploading and are read-only until it finishes.`
			: "";
		return {
			note: `Timeline: ${job.scenes.length} scenes, ~${Math.round(acc)}s total. ${lines.join(" | ") || "(empty)"}. Text overlays: ${job.textOverlays.length}, video overlays: ${job.videoOverlays.length}. Missing: ${missing.join(", ") || "none"}.${pending}`,
		};
	},
});
