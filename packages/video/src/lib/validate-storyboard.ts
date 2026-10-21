import type { Storyboard } from "../schema";

export interface RenderValidationFinding {
	id: string;
	severity: "warning" | "blocker";
	message: string;
	ref?: string;
}

export interface RenderValidationReport {
	status: "passed" | "needs_attention" | "failed";
	findings: RenderValidationFinding[];
	blockerCount: number;
	warningCount: number;
}

function validTiming(start: number, duration: number): boolean {
	return Number.isFinite(start) && start >= 0 && Number.isFinite(duration) && duration > 0;
}

function layoutVisible(
	layout:
		| { xPct?: number; yPct?: number; widthPct?: number; heightPct?: number | null }
		| null
		| undefined,
): boolean {
	if (!layout) return true;
	const x = layout.xPct ?? 0;
	const y = layout.yPct ?? 0;
	const width = layout.widthPct ?? 100;
	const height = layout.heightPct ?? 100;
	return (
		[x, y, width, height].every(Number.isFinite) &&
		width > 0 &&
		height > 0 &&
		x < 100 &&
		y < 100 &&
		x + width > 0 &&
		y + height > 0
	);
}

export function validateRenderStoryboard(storyboard: Storyboard): RenderValidationReport {
	const findings: RenderValidationFinding[] = [];
	const add = (finding: RenderValidationFinding): void => {
		findings.push(finding);
	};
	if (
		!storyboard.scenes.length &&
		!storyboard.visualTimeline?.length &&
		!storyboard.videoOverlays.length
	)
		add({
			id: "visual-content-missing",
			severity: "blocker",
			message: "Add a scene or video clip before rendering.",
		});
	if (storyboard.captions?.enabled !== false) {
		for (const cue of storyboard.captionCues ?? []) {
			if (cue.caption.status === "needs-refresh" && cue.caption.style?.enabled !== false)
				add({
					id: "captions-need-refresh",
					severity: "blocker",
					message: `Caption ${cue.id} needs refresh. Refresh captions or disable captions before exporting.`,
					ref: cue.id,
				});
		}
	}

	if (storyboard.visualTimeline?.length) {
		storyboard.visualTimeline.forEach((clip, index) => {
			if (!clip.url.trim())
				add({
					id: "visual-url-missing",
					severity: "blocker",
					message: `Visual clip ${index + 1} has no media URL.`,
					ref: `visual:${index}`,
				});
			if (!validTiming(clip.startSec, clip.durationSec))
				add({
					id: "visual-timing-invalid",
					severity: "blocker",
					message: `Visual clip ${index + 1} has invalid timing.`,
					ref: `visual:${index}`,
				});
			if (!layoutVisible(clip.layout))
				add({
					id: "visual-layout-off-canvas",
					severity: "blocker",
					message: `Visual clip ${index + 1} is fully outside the canvas or has zero size.`,
					ref: `visual:${index}`,
				});
		});
	} else {
		storyboard.scenes.forEach((scene, index) => {
			if (!scene.image.trim())
				add({
					id: "scene-image-missing",
					severity: "blocker",
					message: `Scene ${index + 1} has no renderable image.`,
					ref: `scene:${index}`,
				});
			if (!validTiming(scene.startSec ?? 0, scene.durationSec))
				add({
					id: "scene-timing-invalid",
					severity: "blocker",
					message: `Scene ${index + 1} has invalid timing.`,
					ref: `scene:${index}`,
				});
			if (!layoutVisible(scene.layout))
				add({
					id: "scene-layout-off-canvas",
					severity: "blocker",
					message: `Scene ${index + 1} is fully outside the canvas or has zero size.`,
					ref: `scene:${index}`,
				});
		});
	}

	storyboard.videoOverlays.forEach((clip, index) => {
		if (!clip.url.trim())
			add({
				id: "overlay-url-missing",
				severity: "blocker",
				message: `Video overlay ${index + 1} has no media URL.`,
				ref: `video:${index}`,
			});
		if (!validTiming(clip.startSec, clip.durationSec))
			add({
				id: "overlay-timing-invalid",
				severity: "blocker",
				message: `Video overlay ${index + 1} has invalid timing.`,
				ref: `video:${index}`,
			});
		if (!layoutVisible(clip.layout))
			add({
				id: "overlay-layout-off-canvas",
				severity: "blocker",
				message: `Video overlay ${index + 1} is fully outside the canvas or has zero size.`,
				ref: `video:${index}`,
			});
	});
	storyboard.audioOverlays.forEach((clip, index) => {
		if (!clip.url?.trim())
			add({
				id: "audio-url-missing",
				severity: "blocker",
				message: `Audio clip ${index + 1} has no media URL.`,
				ref: `audio:${index}`,
			});
		if (!validTiming(clip.startSec, clip.durationSec))
			add({
				id: "audio-timing-invalid",
				severity: "blocker",
				message: `Audio clip ${index + 1} has invalid timing.`,
				ref: `audio:${index}`,
			});
	});

	const blockerCount = findings.filter((finding) => finding.severity === "blocker").length;
	const warningCount = findings.length - blockerCount;
	return {
		status: blockerCount ? "failed" : warningCount ? "needs_attention" : "passed",
		findings,
		blockerCount,
		warningCount,
	};
}

export function assertRenderStoryboard(storyboard: Storyboard): void {
	const report = validateRenderStoryboard(storyboard);
	if (report.blockerCount)
		throw new Error(
			`render validation failed: ${report.findings
				.filter((finding) => finding.severity === "blocker")
				.map((finding) => finding.message)
				.join(" ")}`,
		);
}
