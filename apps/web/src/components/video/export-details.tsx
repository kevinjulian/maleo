/* The body of one export's details dialog: playback when there is output, the
 * attempt's facts, its full diagnostics, and what can be done about it. The
 * row only summarises; this is where the cause and the recovery live. */
import { useState } from "react";
import type { JSX } from "react";
import { assetUrl } from "@models/core/asset-url.ts";
import { exportOutputAvailable, jobAffordances, type Job } from "@models/video/render-job.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button, ButtonLink } from "@design-system/components/button.tsx";
import { Callout } from "@design-system/components/note.tsx";
import { VideoPlayer } from "@design-system/components/video-player.tsx";
import { ErrorState } from "@design-system/patterns/collection.tsx";
import { GenerationError } from "@design-system/patterns/generation.tsx";

export function ExportDetails({
	job,
	actionError,
	onRefresh,
	onOpenProject,
	onRetry,
}: {
	job: Job;
	actionError: string | null;
	onRefresh: () => void;
	onOpenProject?: (id: string) => void;
	onRetry: (id: string, images?: boolean) => Promise<void>;
}): JSX.Element {
	const [playbackError, setPlaybackError] = useState(false);
	const state = jobAffordances(job);
	const playable = exportOutputAvailable(job) && !playbackError;
	const src = assetUrl(job.output_url || `/api/video/render/${job.id}/file`);
	const [retrying, setRetrying] = useState(false);
	const retry = async () => {
		setRetrying(true);
		try {
			await onRetry(job.id, job.status === "done_with_fallback" && !state.audioOnly);
		} finally {
			setRetrying(false);
		}
	};
	return (
		<div className="tw:flex tw:flex-col tw:gap-4">
			{playable ? (
				<VideoPlayer
					title={job.project_title || "Export video"}
					poster={job.thumbnail_url ? assetUrl(job.thumbnail_url) : undefined}
					src={src}
					onError={() => setPlaybackError(true)}
				/>
			) : (
				<Callout tone={playbackError ? "error" : "info"}>
					{playbackError
						? "Export media is unavailable. Open the project or try again later."
						: "No playable output for this attempt."}
				</Callout>
			)}
			<p className="tw:m-0 tw:text-[length:var(--type-caption-size)] tw:text-[var(--fg-dim)] tw:tabular-nums">
				{job.preset}
				{job.duration_sec != null ? ` · ${job.duration_sec.toFixed(1)} seconds` : ""}
				{state.active && state.phaseLabel ? ` · ${state.phaseLabel}` : ""}
				{job.phase_detail && job.status !== "done_with_fallback" ? ` · ${job.phase_detail}` : ""}
			</p>
			{job.status === "done_with_fallback" && (
				<Callout tone="warn">{job.phase_detail || "Some assets used fallbacks."}</Callout>
			)}
			{state.failed && (
				<GenerationError
					title={job.status === "cancelled" ? "Export cancelled" : "Export failed"}
					code={job.error_code ?? undefined}
					message={state.codeMsg || job.error || "Open the project to review this export."}
					detail={job.error ?? undefined}
				/>
			)}
			{actionError && (
				<ErrorState inline title="Export action failed" message={actionError} onRetry={onRefresh} />
			)}
			<div className="cv-modal-actions">
				{(state.canRetry || job.status === "done_with_fallback") && (
					<Button variant="secondary" loading={retrying} onClick={() => void retry()}>
						{Ic.refresh(ICON.sm)}{" "}
						{job.status === "done_with_fallback"
							? state.audioOnly
								? "Retry audio"
								: "Retry images"
							: "Retry export"}
					</Button>
				)}
				{playable && (
					<ButtonLink variant="secondary" href={src} download={`export-${job.id}.mp4`}>
						{Ic.download(ICON.sm)} Download MP4
					</ButtonLink>
				)}
				{onOpenProject && job.project_id && (
					<Button variant="primary" onClick={() => onOpenProject(job.project_id!)}>
						Open project
					</Button>
				)}
			</div>
		</div>
	);
}
