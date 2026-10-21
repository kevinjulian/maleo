import { useState } from "react";
import type { JSX } from "react";
import { assetUrl } from "@models/core/asset-url.ts";
import { cn } from "@models/core/cn.ts";
import {
	exportOutputAvailable,
	jobAffordances,
	STATUS_TONE,
	type Job,
} from "@models/video/render-job.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Chip } from "@design-system/components/chip.tsx";
import { Progress } from "@design-system/components/progress.tsx";
import { Spinner } from "@design-system/components/spinner.tsx";
import { MediaCard } from "@design-system/patterns/media.tsx";

function exportDate(ts: number): string {
	return new Date(ts).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/* One export attempt as a collection row, whatever its state. The preview box
 * says what there is to see — the poster, or why there is none — and the facts
 * carry the state: measured progress while it runs, the cause when it failed.
 * Full diagnostics live in the details dialog, not in the row. */
export function ExportRow({ job, onDetails }: { job: Job; onDetails: () => void }): JSX.Element {
	const [missing, setMissing] = useState(false);
	const state = jobAffordances(job);
	const title = job.project_title || "Untitled project";
	const status = job.status.replaceAll("_", " ");
	const created = exportDate(job.created_at);
	const poster = state.ready && job.thumbnail_url && !missing ? job.thumbnail_url : null;
	const placeholder = state.ready
		? "No preview"
		: state.active
			? job.status === "queued"
				? "Queued"
				: "Rendering"
			: "No output";
	const cause = state.failed
		? state.codeMsg || job.error || "Open the project to review this export."
		: job.status === "done_with_fallback"
			? job.phase_detail || "Some assets used fallbacks."
			: null;
	return (
		<MediaCard
			layout="list"
			fit="contain"
			aspect={16 / 9}
			title={title}
			label={`View export: ${title}, ${status}, ${created}`}
			onActivate={onDetails}
			data-status={job.status}
			preview={
				poster ? (
					<img src={assetUrl(poster)} alt="" loading="lazy" onError={() => setMissing(true)} />
				) : null
			}
			unavailable={poster ? undefined : placeholder}
			unavailableIcon={
				job.status === "running" ? (
					<Spinner size="md" />
				) : job.status === "queued" ? (
					Ic.hourglass(ICON.md)
				) : state.failed ? (
					Ic.alertCircle(ICON.md)
				) : (
					Ic.film(ICON.md)
				)
			}
			meta={
				<>
					<Chip tone={STATUS_TONE[job.status] || "plain"}>{status}</Chip>
					<span>{created}</span>
					<span>{job.preset}</span>
					{job.duration_sec != null && <span>{job.duration_sec.toFixed(1)}s</span>}
					{job.status === "running" && (
						<Progress
							className="tw:basis-full tw:max-w-[var(--measure-form)]"
							value={Math.round(Math.max(0, Math.min(1, job.progress)) * 100)}
							label={state.phaseLabel || "Rendering"}
						/>
					)}
					{cause && (
						<span
							className={cn(
								"tw:basis-full tw:truncate",
								state.failed ? "tw:text-[var(--err)]" : "tw:text-[var(--warn)]",
							)}
							title={cause}
						>
							{cause}
						</span>
					)}
				</>
			}
			actions={
				<Button variant="secondary" size="sm" onClick={onDetails}>
					{exportOutputAvailable(job) ? <>{Ic.play(ICON.sm)} Play</> : "Details"}
				</Button>
			}
		/>
	);
}
