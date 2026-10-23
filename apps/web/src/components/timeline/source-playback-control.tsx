import { useEffect, useRef, useState } from "react";
import {
	processedAudioSource,
	sourceInterval,
	type MediaProcessingOperation,
	type ProjectMediaProcessingResponse,
} from "@maleo/shared";
import {
	processMediaSource,
	pollMediaProcessing,
	cancelMediaProcessing,
} from "@api/media-processing.ts";
import { mediaImportError } from "@api/media-import.ts";
import { getActiveWorkspace } from "@models/core/active-workspace.ts";
import { isPendingMedia, withReadyPending } from "@models/core/pending-media-sources.ts";
import { usePendingMediaVersion } from "@hooks/editor/use-pending-media-version.ts";
import { canReuseReverse, reverseTargetSource } from "@models/timeline/video-reverse.ts";
import {
	applySourcePlayback,
	sourceEditInfo,
	type SourceEditTarget,
} from "@models/timeline/source-audio-edit.ts";
import {
	extractSourceAudio,
	recoverSourceAudio,
	sourceAudioRecovery,
} from "@models/timeline/source-audio-extraction.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { AmountField, FieldRow, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Toggle } from "@design-system/components/toggle-group.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Switch } from "@design-system/components/switch.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Note } from "@design-system/components/note.tsx";

interface PendingSource {
	controller: AbortController;
	project: string;
	ids: string[];
	reverseOnly: boolean;
}

export const PENDING_SOURCE_REASON = "Available once the upload finishes.";

export function SourcePlaybackControl({
	projectId,
	target,
	store,
	writers,
	library,
	onProcessingChange,
	label = "Reverse",
}: {
	projectId: string | null;
	target: SourceEditTarget;
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	library: ReferenceLibraryState;
	label?: string;
	onProcessingChange?: (key: string, label: string | null) => void;
}) {
	/* A finished import is processed as its managed source, so this reads and edits
	 * the document with ready references substituted; one still uploading has no
	 * server bytes yet, so every control waits for it. */
	usePendingMediaVersion();
	const doc = withReadyPending(useDocumentSelector(store, (value) => value.getDoc()));
	const source = sourceEditInfo(doc, target, library.mediaAssets);
	const workspace = getActiveWorkspace();
	const [recoveryChoice, setRecoveryChoice] = useState(false);
	const [status, setStatus] = useState<string | null>(null),
		[error, setError] = useState<string | null>(null);
	const pending = useRef<PendingSource | null>(null);
	const notify = useRef(onProcessingChange);
	notify.current = onProcessingChange;
	const key = JSON.stringify(target);
	const cancel = (show = true): void => {
		const job = pending.current;
		pending.current = null;
		job?.controller.abort();
		if (job) notify.current?.(key, null);
		for (const id of job?.ids ?? [])
			void cancelMediaProcessing(job!.project, id).catch((failure) => {
				if (show) setError(mediaImportError(failure));
			});
		if (show) setStatus(null);
	};
	useEffect(() => {
		setStatus(null);
		setError(null);
		setRecoveryChoice(false);
		return () => cancel(false);
	}, [projectId, workspace, key, source?.fingerprint]);
	const change = async (
		rate: number,
		pitch: boolean,
		reverse: boolean,
		extract = false,
	): Promise<void> => {
		if (
			!source ||
			source.locked ||
			pending.current ||
			!Number.isFinite(rate) ||
			rate < 0.25 ||
			rate > 4
		)
			return;
		setError(null);
		const interval = sourceInterval(
			source.start,
			source.duration,
			source.settings.playbackRate ?? 1,
		);
		const operations: MediaProcessingOperation[] = [];
		const video =
			target.source !== "audio" ? reverseTargetSource(doc, target, library.mediaAssets) : undefined;
		if (!extract && reverse && video && !canReuseReverse(video))
			operations.push({
				type: "reverse",
				startSec: interval.start,
				durationSec: interval.end - interval.start,
			});
		const needsAudio =
			(target.source === "audio" ? rate !== 1 || reverse : rate !== 1) &&
			source.asset?.metadata?.hasAudio !== false;
		const cached =
			source.settings.audioMedia?.sourceRevision === source.revision &&
			processedAudioSource(source.url, source.start, (interval.end - interval.start) / rate, {
				...source.settings,
				playbackRate: rate,
				preservePitch: pitch,
				reverse,
			});
		if (extract || (needsAudio && !cached))
			operations.push({
				type: "audio",
				startSec: interval.start,
				durationSec: interval.end - interval.start,
				playbackRate: rate,
				preservePitch: pitch,
				reverse,
			});
		if (!operations.length) {
			try {
				writers.mutate((doc) =>
					applySourcePlayback(
						withReadyPending(doc),
						target,
						library.getMediaAssets(),
						source.fingerprint,
						rate,
						pitch,
						reverse,
					),
				);
			} catch (failure) {
				setError(mediaImportError(failure));
			}
			return;
		}
		if (!projectId || !source.sourceMediaId || !source.revision || !source.asset) {
			setError("Import this source into All Media before processing playback");
			return;
		}
		const job: PendingSource = {
			controller: new AbortController(),
			project: projectId,
			ids: [],
			reverseOnly: operations.length === 1 && operations[0]?.type === "reverse",
		};
		pending.current = job;
		setStatus("Preparing source…");
		notify.current?.(key, source.asset.label);
		const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(600_000)]);
		try {
			const results: ProjectMediaProcessingResponse[] = [];
			for (const operation of operations) {
				const id = await processMediaSource(
					projectId,
					{
						sourceMediaId: source.sourceMediaId,
						sourceRevision: source.revision,
						requestKey: crypto.randomUUID(),
						operation,
					},
					signal,
				);
				job.ids.push(id);
				if (pending.current !== job) {
					await cancelMediaProcessing(projectId, id);
					return;
				}
				while (!signal.aborted && pending.current === job) {
					const result = await pollMediaProcessing(projectId, id, signal);
					if (pending.current !== job) return;
					if (result.status === "ready") {
						results.push(result);
						break;
					}
					if (result.status === "failed" || result.status === "cancelled")
						throw new Error(result.error ?? `Source processing ${result.status}`);
					setStatus(
						result.status === "queued"
							? "Source queued…"
							: operation.type === "reverse"
								? "Reversing source…"
								: "Processing source audio…",
					);
					await new Promise<void>((resolve, reject) => {
						const abort = () => {
							clearTimeout(timer);
							reject(new Error("Source processing cancelled or timed out"));
						};
						const timer = setTimeout(() => {
							signal.removeEventListener("abort", abort);
							resolve();
						}, 1000);
						signal.addEventListener("abort", abort, { once: true });
					});
				}
				signal.throwIfAborted();
			}
			if (pending.current !== job) return;
			if (extract && target.source !== "audio") {
				const result = results.find((r) => r.operation.type === "audio")!;
				writers.apply((scope) =>
					extractSourceAudio(
						{ ...scope, doc: withReadyPending(scope.doc) },
						target,
						source.fingerprint,
						result,
					),
				);
			} else
				writers.mutate((doc) =>
					applySourcePlayback(
						withReadyPending(doc),
						target,
						library.getMediaAssets(),
						source.fingerprint,
						rate,
						pitch,
						reverse,
						results,
					),
				);
			pending.current = null;
			notify.current?.(key, null);
			setStatus(null);
		} catch (failure) {
			if (pending.current === job) {
				setError(mediaImportError(failure));
				cancel();
			}
		}
	};
	const rate = source?.settings.playbackRate ?? 1,
		pitch = Boolean(source?.settings.preservePitch),
		reverse = Boolean(source?.settings.reverse);
	const unavailable = !source?.sourceMediaId || !source.asset || !projectId;
	const uploading = isPendingMedia(source?.url);
	const disabled = Boolean(status) || Boolean(source?.locked) || uploading;
	const recovery =
		target.source !== "audio"
			? sourceAudioRecovery({ doc, mediaAssets: library.mediaAssets }, target)
			: undefined;
	const recover = (choice?: "keep" | "discard") => {
		if (target.source === "audio") return;
		try {
			writers.apply((scope) =>
				recoverSourceAudio({ ...scope, doc: withReadyPending(scope.doc) }, target, choice),
			);
			setRecoveryChoice(false);
		} catch (failure) {
			setError(mediaImportError(failure));
		}
	};
	const video =
		target.source !== "audio" ? reverseTargetSource(doc, target, library.mediaAssets) : undefined;
	const staleReverse = reverse && video && !canReuseReverse(video);
	const staleAudio =
		source &&
		(target.source === "audio" ? rate !== 1 || reverse : rate !== 1) &&
		source.asset?.metadata?.hasAudio !== false &&
		!processedAudioSource(source.url, source.start, source.duration, source.settings);
	const hasNoAudio = source?.asset?.metadata?.hasAudio === false;
	return (
		<>
			<FieldRow label="Playback" onReset={() => void change(1, pitch, false)}>
				<AmountField
					label="Rate (%)"
					short="×"
					suffix="%"
					min={25}
					max={400}
					step={5}
					value={rate * 100}
					disabled={disabled}
					onChange={(value) => void change(value / 100, pitch, reverse)}
				/>
				<Toggle
					aria-label={label}
					title={label}
					pressed={reverse}
					disabled={disabled || (unavailable && !reverse)}
					onPressedChange={(value) => void change(rate, pitch, value)}
				>
					{Ic.swap(ICON.xs)}
				</Toggle>
			</FieldRow>
			<PropertyRow label="Preserve pitch">
				<Switch
					size="sm"
					checked={pitch}
					disabled={disabled}
					onCheckedChange={(value) => void change(rate, value, reverse)}
				/>
			</PropertyRow>
			{target.source !== "audio" &&
				(recovery ? (
					<SourceAudioRecovery
						disabled={disabled || recovery.locked}
						choosing={recoveryChoice}
						onRecover={() => (recovery.edited ? setRecoveryChoice(true) : recover())}
						onChoose={recover}
						onCancel={() => setRecoveryChoice(false)}
					/>
				) : (
					<>
						<Button
							size="sm"
							variant="secondary"
							disabled={disabled || unavailable || hasNoAudio}
							onClick={() => void change(rate, pitch, reverse, true)}
						>
							Extract audio
						</Button>
						{hasNoAudio && <Note>This source has no audio to extract.</Note>}
					</>
				))}
			{uploading ? (
				<Note>{PENDING_SOURCE_REASON}</Note>
			) : (
				unavailable && <Note>Import this source into All Media to process playback.</Note>
			)}
			{!status && !unavailable && (staleReverse || staleAudio) && (
				<Button
					size="sm"
					variant="secondary"
					disabled={disabled}
					onClick={() => void change(rate, pitch, reverse)}
				>
					{staleReverse ? "Process reverse again" : "Process audio again"}
				</Button>
			)}
			{status && (
				<>
					<Note role="status">{status}</Note>
					<Button size="sm" variant="secondary" onClick={() => cancel()}>
						{pending.current?.reverseOnly ? "Cancel reverse" : "Cancel processing"}
					</Button>
				</>
			)}
			{error && <Note role="alert">{error}</Note>}
		</>
	);
}

/** Detached source audio: recover directly, or choose keep/discard when the extracted clip was edited. */
function SourceAudioRecovery({
	disabled,
	choosing,
	onRecover,
	onChoose,
	onCancel,
}: {
	disabled: boolean;
	choosing: boolean;
	onRecover: () => void;
	onChoose: (choice: "keep" | "discard") => void;
	onCancel: () => void;
}) {
	return (
		<>
			<Note>Source audio detached. Extracted clip edits stay independent.</Note>
			<Button size="sm" variant="secondary" disabled={disabled} onClick={onRecover}>
				Recover source audio
			</Button>
			{choosing && (
				<>
					<Note>Extracted audio changed. Choose whether to keep or discard it.</Note>
					<Button
						size="sm"
						variant="secondary"
						disabled={disabled}
						onClick={() => onChoose("keep")}
					>
						Keep extracted audio
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={disabled}
						onClick={() => onChoose("discard")}
					>
						Discard extracted audio
					</Button>
					<Button size="sm" variant="ghost" onClick={onCancel}>
						Cancel recovery
					</Button>
				</>
			)}
		</>
	);
}
