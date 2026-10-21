import { useEffect, useState, type JSX } from "react";
import { mediaImportFilenameKind } from "@maleo/shared";
import { MediaCard } from "@design-system/patterns/media.tsx";
import { FrameActions, FrameAction } from "@design-system/components/frame.tsx";
import { Progress } from "@design-system/components/progress.tsx";
import { Ic, ICON } from "@design-system/icons/index.tsx";
import type { MediaImportRow } from "@hooks/editor/use-media-import.ts";

/** A local preview for a chosen image, revoked when the card leaves. Video and audio show their kind instead. */
function useImagePreview(file: File | undefined): string | undefined {
	const [url, setUrl] = useState<string>();
	useEffect(() => {
		if (!file || mediaImportFilenameKind(file.name) !== "image") {
			setUrl(undefined);
			return;
		}
		const next = URL.createObjectURL(file);
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [file]);
	return url;
}

/** Status text and bar value for a row still in flight. Null value means amount unknown. */
export interface UploadPhase {
	label: string;
	value: number | null;
}

export function uploadPhase(row: MediaImportRow): UploadPhase {
	if (row.status === "ready") return { label: "Ready", value: null };
	if (row.status === "queued") return { label: "Queued", value: null };
	if (row.status === "processing") return { label: "Processing", value: null };
	if (row.progress != null && row.progress >= 1) return { label: "Finishing upload", value: null };
	const percent = Math.floor((row.progress ?? 0) * 100);
	return { label: `Uploading ${percent}%`, value: percent };
}

export function UploadCard({
	row,
	layout,
	onRetry,
	onChooseAgain,
	onDismiss,
}: {
	row: MediaImportRow;
	layout: "grid" | "list";
	onRetry: (key: string) => void;
	onChooseAgain: (key: string) => void;
	onDismiss: (key: string) => void;
}): JSX.Element {
	const image = useImagePreview(row.file);
	const kind = mediaImportFilenameKind(row.filename);
	const failed = row.status === "failed",
		ready = row.status === "ready";
	const phase = failed ? null : uploadPhase(row);
	const canRetry = failed && Boolean(row.file) && row.retryable;
	// A failed card leads with the warning, not the media, so it reads as failed at a glance.
	const preview = failed ? (
		<span className="tw:flex tw:h-full tw:w-full tw:items-center tw:justify-center tw:bg-[var(--err-bg)] tw:text-[var(--err)]">
			{Ic.warning(ICON.xl)}
		</span>
	) : image ? (
		<img src={image} alt="" />
	) : (
		<span className="tw:flex tw:h-full tw:w-full tw:items-center tw:justify-center tw:text-[var(--fg-dim)]">
			{kind === "audio"
				? Ic.music(ICON.lg)
				: kind === "video"
					? Ic.video(ICON.lg)
					: Ic.image(ICON.lg)}
		</span>
	);
	const overlay = (
		<>
			<FrameActions corner="tr">
				{canRetry && (
					<FrameAction aria-label={`Retry ${row.filename}`} onClick={() => onRetry(row.key)}>
						{Ic.refresh(ICON.sm)}
					</FrameAction>
				)}
				{failed && !canRetry && (
					<FrameAction
						aria-label={`Choose ${row.filename} again`}
						onClick={() => onChooseAgain(row.key)}
					>
						{Ic.upload(ICON.sm)}
					</FrameAction>
				)}
				<FrameAction
					aria-label={`${failed ? "Delete" : ready ? "Dismiss" : "Cancel"} ${row.filename}`}
					danger={failed}
					onClick={() => onDismiss(row.key)}
				>
					{failed ? Ic.trash(ICON.sm) : Ic.x(ICON.sm)}
				</FrameAction>
			</FrameActions>
			{phase && !ready && (
				<span className="tw:absolute tw:inset-x-1 tw:bottom-1">
					<Progress value={phase.value} label={`${row.filename}: ${phase.label}`} hideLabel />
				</span>
			)}
		</>
	);
	const meta = failed ? (
		<span role="alert" className="tw:text-[var(--err)]">
			{row.error ?? "Upload failed"}
		</span>
	) : (
		<span role="status">{ready && row.error ? row.error : phase!.label}</span>
	);
	return (
		<MediaCard
			data-upload-state={failed ? "failed" : row.status}
			layout={layout}
			preview={preview}
			title={row.filename}
			meta={meta}
			overlay={overlay}
			label={`${row.filename}, ${failed ? "upload failed" : phase!.label}`}
		/>
	);
}
