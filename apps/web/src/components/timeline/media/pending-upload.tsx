/* A pending asset's upload state where it is used (`use-media-while-uploading` D7):
 * composed into its MediaCard's overlay, meta and actions, and as a compact badge on
 * every clip that uses it. See docs/design-system/patterns/media-card.md#pending-media
 * and timeline-clip.md#pending-media-badge. */
import type { CSSProperties, JSX } from "react";
import { FrameAction, FrameBadge } from "@design-system/components/frame.tsx";
import { Progress } from "@design-system/components/progress.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { pendingUploadLabel, type PendingUploadState } from "@models/core/pending-media-sources.ts";

/** The preview-box part: a progress line at its foot, or a warning once it failed. */
export function PendingUploadOverlay({
	name,
	state,
}: {
	name: string;
	state: PendingUploadState;
}): JSX.Element {
	if (state.phase === "failed" || state.phase === "interrupted")
		return (
			<FrameBadge corner="bl" className="tw:text-[var(--err)]">
				{Ic.warning(ICON.xs)}
			</FrameBadge>
		);
	const value = state.phase === "uploading" ? Math.floor(state.progress * 100) : null;
	return (
		<span className="tw:absolute tw:inset-x-1 tw:bottom-1 tw:z-3">
			<Progress value={value} label={`${name}: ${pendingUploadLabel(state)}`} hideLabel />
		</span>
	);
}

/** The status line under the title (and the list row's metadata). */
export function PendingUploadMeta({ state }: { state: PendingUploadState }): JSX.Element {
	if (state.phase === "failed")
		return (
			<span role="alert" className="tw:text-[var(--err)]">
				{state.reason}
			</span>
		);
	if (state.phase === "interrupted")
		return (
			<span role="alert" className="tw:text-[var(--err)]">
				Interrupted: choose the file again
			</span>
		);
	return <span role="status">{pendingUploadLabel(state)}</span>;
}

export interface PendingUploadHandlers {
	onCancel: () => void;
	onRetry: () => void;
	onChooseAgain: () => void;
	onDelete: () => void;
}

/** Recovery beside the card's activation: Cancel while it runs; Retry, Choose again
 *  and Delete once it failed; Choose again and Delete once interrupted. */
export function PendingUploadActions({
	name,
	state,
	handlers,
}: {
	name: string;
	state: PendingUploadState;
	handlers: PendingUploadHandlers;
}): JSX.Element {
	if (state.phase === "uploading" || state.phase === "processing")
		return (
			<FrameAction
				aria-label={`Cancel ${name}`}
				title={`Cancel ${name}`}
				onClick={handlers.onCancel}
			>
				{Ic.x(ICON.xs)}
			</FrameAction>
		);
	return (
		<>
			{state.phase === "failed" && state.canRetry && (
				<FrameAction
					aria-label={`Retry ${name}`}
					title={`Retry ${name}`}
					onClick={handlers.onRetry}
				>
					{Ic.refresh(ICON.xs)}
				</FrameAction>
			)}
			{!(state.phase === "failed" && state.canRetry) && (
				<FrameAction
					aria-label={`Choose ${name} again`}
					title={`Choose ${name} again`}
					onClick={handlers.onChooseAgain}
				>
					{Ic.upload(ICON.xs)}
				</FrameAction>
			)}
			<FrameAction
				aria-label={`Delete ${name}`}
				title={`Delete ${name}`}
				danger
				onClick={handlers.onDelete}
			>
				{Ic.trash(ICON.xs)}
			</FrameAction>
		</>
	);
}

/** The compact clip badge: an icon and, while it runs, a 2px line along the clip foot.
 *  Not interactive; its name is the state. */
export function ClipUploadBadge({ state }: { state: PendingUploadState }): JSX.Element {
	const label = pendingUploadLabel(state);
	const failed = state.phase === "failed" || state.phase === "interrupted";
	// SAFETY: a custom property is a valid style key; React's CSSProperties only lists the standard ones.
	const line =
		state.phase === "uploading"
			? ({ "--upload-progress": String(state.progress) } as CSSProperties)
			: undefined;
	return (
		<span
			className="tl2-clip-upload"
			data-upload-phase={state.phase}
			role="img"
			aria-label={label}
			title={label}
		>
			<span className="tl2-clip-upload-icon">
				{failed ? Ic.warning(ICON.xs) : Ic.upload(ICON.xs)}
			</span>
			{!failed && <span className="tl2-clip-upload-line" style={line} />}
		</span>
	);
}
