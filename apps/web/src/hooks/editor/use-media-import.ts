import { useCallback, useEffect, useRef, useState } from "react";
import {
	DEFAULT_MEDIA_IMPORT_LIMITS,
	isMediaId,
	mediaImportFilenameKind,
	mintMediaId,
	type ImportedMediaKind,
	type MediaImportReadiness,
	type MediaImportState,
	type ReadyImportedMedia,
	type ProjectMediaImportResponse,
} from "@maleo/shared";
import {
	mediaImportByRequest,
	mediaImportReadiness,
	pendingMediaImports,
	uploadMediaFile,
	pollMediaImport,
	cancelMediaImport,
	cancelMediaUpload,
	mediaImportError,
} from "@api/media-import.ts";
import { ApiError } from "@api/client.ts";
import { getActiveWorkspace } from "@models/core/active-workspace.ts";
import { probeLocalMedia } from "@models/analysis/local-media-probe.ts";
import {
	clearPendingSources,
	pendingSourceKey,
	removePendingSource,
	setPendingLocalUrl,
	setPendingReady,
	setPendingUploadState,
	trackPendingSource,
	type PendingUploadState,
} from "@models/core/pending-media-sources.ts";
import { pendingMediaAsset } from "@models/timeline/pending-media-asset.ts";
import {
	createUploadStaging,
	type UploadStaging,
} from "@services/upload-staging/upload-staging.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";

export interface MediaImportRow {
	key: string;
	file?: File;
	filename: string;
	batchSize: number;
	status: MediaImportState;
	id?: string;
	error?: string;
	retryable: boolean;
	place?: PlaceMedia;
	/** Admitted as a pending asset (id = `key`), so readiness resolves it rather than admitting it. */
	pending?: boolean;
	/** No file and no server upload to resume: the editor has to choose the file again. */
	interrupted?: boolean;
	/** Placement waits for the ready asset (source replacement), with no pending asset. */
	whenReady?: boolean;
	/** Bytes sent, 0–1, while uploading. Absent when the transport has not reported yet. */
	progress?: number;
}
/** Place an asset; answers whether it was placed. Called with the pending asset at
 *  selection, or with the ready one when the row places on ready. */
export type PlaceMedia = (asset: MediaAsset) => boolean;
export interface PendingAdmission {
	/** Admit a pending asset to Ready to place. */
	admit: (asset: MediaAsset) => void;
	/** Whether the project holds a pending asset for this request key, so a restored
	 *  import resolves it rather than admitting a second asset. */
	has: (requestKey: string) => boolean;
	/** A cancelled or deleted upload's pending asset leaves the project, with any clips that use it. */
	discard: (requestKey: string) => string | undefined;
	/** Why a file chosen again cannot back the pending asset's placed uses. */
	validate?: (
		requestKey: string,
		kind: ImportedMediaKind | undefined,
		duration: number | undefined,
	) => string | undefined;
	probe?: typeof probeLocalMedia;
	/** Where chosen files wait for their import; browser-private storage by default. */
	staging?: UploadStaging;
}

/** Names the limit, so a refused file says how small it has to be. */
const oversize = (bytes: number): string =>
	`File is over the ${Math.floor(bytes / (1024 * 1024))} MB import limit`;
const INTERRUPTED = "Upload interrupted. Choose the file again.";
const sessionStaging = createUploadStaging();

/** What a pending asset's surfaces show for its row; nothing once ready or cancelled. */
export function pendingUploadState(row: MediaImportRow): PendingUploadState | undefined {
	if (row.status === "ready" || row.status === "cancelled") return undefined;
	if (row.status === "failed")
		return row.interrupted
			? { phase: "interrupted" }
			: {
					phase: "failed",
					reason: row.error ?? "Upload failed",
					canRetry: Boolean(row.file) && row.retryable,
				};
	if (row.status === "processing" || (row.status === "uploading" && (row.progress ?? 0) >= 1))
		return { phase: "processing" };
	return { phase: "uploading", progress: row.status === "uploading" ? (row.progress ?? 0) : 0 };
}

const terminal = (status: MediaImportState) => ["ready", "failed", "cancelled"].includes(status);
/** The server keeps an import alive through worker trouble; only these answers end it. */
const importGone = (failure: unknown) =>
	failure instanceof ApiError && (failure.status === 403 || failure.status === 404);
const POLL_MS = 1000,
	MAX_POLL_MS = 10_000;

/** Lives in TimelineEditor: closing Assets must not interrupt project imports. */
export function useMediaImport(
	project: string | null,
	onReady: (asset: ReadyImportedMedia) => void,
	pendingAdmission?: PendingAdmission,
) {
	const [rows, setRows] = useState<readonly MediaImportRow[]>([]);
	const [readiness, setReadiness] = useState<MediaImportReadiness | null>(null);
	const [error, setError] = useState<string | null>(null);
	const readyRef = useRef({ project, workspace: getActiveWorkspace(), onReady, pendingAdmission });
	readyRef.current = { project, workspace: getActiveWorkspace(), onReady, pendingAdmission };
	const actions = useRef({
		enqueue: (_files: File[], _place?: PlaceMedia, _options?: EnqueueOptions) => {},
		resolve: (_assets: readonly PendingReference[]) => {},
		chooseAgain: (_key: string, _file: File) => {},
		retry: (_key: string) => {},
		cancel: (_key: string) => {},
		dismiss: (_key: string) => {},
		refresh: () => {},
	});
	const workspace = getActiveWorkspace();
	useEffect(() => {
		let active = true;
		let current: readonly MediaImportRow[] = [];
		let limits = { ...DEFAULT_MEDIA_IMPORT_LIMITS };
		let status: MediaImportReadiness | null = null;
		const scope = new AbortController();
		const uploads = new Map<string, AbortController>();
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const looked = new Set<string>();
		const staging = readyRef.current.pendingAdmission?.staging ?? sessionStaging;
		setRows([]);
		setReadiness(null);
		setError(null);
		// Rows are replaced, never edited: async callbacks hold a key and read the latest row.
		const get = (key: string) => current.find((row) => row.key === key);
		const patch = (key: string, value: Partial<MediaImportRow>) => {
			current = current.map((row) => (row.key === key ? { ...row, ...value } : row));
			if (active) setRows(current);
		};
		const accept = (key: string, result: ProjectMediaImportResponse) => {
			const row = get(key);
			if (
				!active ||
				!row ||
				row.status === "cancelled" ||
				readyRef.current.project !== project ||
				readyRef.current.workspace !== workspace
			)
				return;
			patch(key, { id: result.id, status: result.status, error: result.error ?? undefined });
			if (
				result.status === "ready" &&
				result.asset &&
				(row.pending || readyRef.current.pendingAdmission?.has(key))
			) {
				// Resolution, not an edit: every use of the pending asset now plays the managed media.
				revoke(setPendingReady(key, result.asset));
				if (project) void staging.remove(project, key);
				patch(key, { file: undefined, retryable: false });
			} else if (result.status === "ready" && result.asset) {
				const placed = row.place?.(result.asset);
				if (!row.place || !placed) readyRef.current.onReady(result.asset);
				patch(key, {
					file: undefined,
					retryable: false,
					...(row.place && !placed
						? { error: "File ready; destination changed or locked. Add from Ready to place." }
						: {}),
				});
			}
		};
		const poll = async (key: string, delay = POLL_MS): Promise<void> => {
			const row = get(key);
			if (!active || !project || !row?.id || terminal(row.status)) return;
			let next = POLL_MS;
			try {
				accept(key, await pollMediaImport(project, row.id, scope.signal));
			} catch (failure) {
				if (!active || get(key)?.status === "cancelled") return;
				if (importGone(failure)) patch(key, { status: "failed", error: mediaImportError(failure) });
				// ponytail: exponential backoff capped at 10s; the server times the import out, not this loop.
				else {
					patch(key, { error: `Checking again: ${mediaImportError(failure)}` });
					next = Math.min(MAX_POLL_MS, delay * 2);
				}
			}
			if (active && !terminal(get(key)?.status ?? "cancelled")) {
				const timer = setTimeout(() => {
					timers.delete(timer);
					void poll(key, next);
				}, next);
				timers.add(timer);
			}
		};
		const revoke = (url: string | undefined): void => {
			if (url) URL.revokeObjectURL(url);
		};
		const add = (row: MediaImportRow): void => {
			current = [...current, row];
			setRows(current);
		};
		/* Resume owns a pending asset's key: a row the mount-time restore listed for it knows
		 * nothing of the asset or its staged file, so it gives way. False once resume or this
		 * session already holds the key. */
		const claim = (key: string): boolean => {
			const row = get(key);
			if (row && (row.pending || row.file)) return false;
			if (row) {
				current = current.filter((item) => item.key !== key);
				setRows(current);
			}
			return true;
		};
		const discard = (key: string): void => {
			const refused = readyRef.current.pendingAdmission?.discard(key);
			if (refused && active) setError(refused);
		};
		/* The chosen file becomes a usable asset now: a local copy to play, what the
		 * browser can measure, placed where it was dropped or staged in Ready to place. */
		const admitPending = async (key: string, admission: PendingAdmission): Promise<void> => {
			const row = get(key);
			if (!row?.file) return;
			const kind = mediaImportFilenameKind(row.filename)!;
			setPendingLocalUrl(key, URL.createObjectURL(row.file));
			// ponytail: staged beside the upload, not before it; a reload in the first seconds of a large file finds it unstaged and interrupted.
			if (project) void staging.stage(project, key, row.file);
			const probe = await (admission.probe ?? probeLocalMedia)(row.file, kind);
			const latest = get(key);
			// Cancelled, or so fast the ready asset was already admitted the ordinary way.
			if (!active || !latest || latest.status === "cancelled" || latest.status === "ready") {
				revoke(removePendingSource(key));
				return;
			}
			const asset = pendingMediaAsset(key, row.file, kind, probe);
			const placed = !probe.blocked && latest.place ? latest.place(asset) : false;
			if (!placed) admission.admit(asset);
			patch(key, {
				pending: true,
				place: undefined,
				...(latest.place && !placed
					? { error: probe.blocked ?? "Destination changed or locked. Add from Ready to place." }
					: {}),
			});
		};
		const pump = (): void => {
			if (!active || !project || !status?.available) return;
			for (const row of current) {
				if (uploads.size >= limits.maxConcurrentUploads) break;
				if (row.status !== "queued" || row.id || !row.file) continue;
				const { key } = row;
				const controller = new AbortController();
				uploads.set(key, controller);
				patch(key, { status: "uploading", error: undefined, progress: 0 });
				const kind = mediaImportFilenameKind(row.filename)!;
				// Whole-percent steps keep a large upload from re-rendering on every chunk.
				const onProgress = (fraction: number) => {
					if (Math.floor(fraction * 100) > Math.floor((get(key)?.progress ?? 0) * 100))
						patch(key, { progress: fraction });
				};
				void uploadMediaFile(
					project,
					row.file,
					kind,
					key,
					row.batchSize,
					AbortSignal.any([
						scope.signal,
						controller.signal,
						AbortSignal.timeout(limits.processingTimeoutMs),
					]),
					onProgress,
				)
					.then((result) => {
						if (get(key)?.status === "cancelled") {
							if (active) void cancelMediaImport(project, result.id).catch(() => {});
							return;
						}
						accept(key, result);
						void poll(key);
					})
					.catch((failure) => {
						if (active && get(key)?.status !== "cancelled")
							patch(key, { status: "failed", error: mediaImportError(failure) });
					})
					.finally(() => {
						uploads.delete(key);
						pump();
					});
			}
		};
		actions.current = {
			enqueue(files, place, options = {}) {
				if (!active || !project) return;
				if (!status) {
					setError("Import is still starting; try again in a moment");
					return;
				}
				if (!status.available) {
					setError(`Import unavailable: ${status.reason ?? "media worker unavailable"}`);
					return;
				}
				if (files.length > limits.maxBatchFiles) {
					setError(`Choose at most ${limits.maxBatchFiles} files per batch`);
					return;
				}
				setError(null);
				current = [
					...current,
					...files.map((file): MediaImportRow => {
						const error = !mediaImportFilenameKind(file.name)
							? "Unsupported file type"
							: !file.size
								? "File is empty"
								: file.size > limits.maxFileBytes
									? oversize(limits.maxFileBytes)
									: undefined;
						return {
							// The media identity, minted now: the placed reference never changes.
							key: mintMediaId(),
							file,
							filename: file.name,
							batchSize: files.length,
							status: error ? "failed" : "queued",
							error,
							retryable: !error,
							place,
							...(options.whenReady ? { whenReady: true } : {}),
						};
					}),
				];
				setRows(current);
				// This session chose these files; a loaded reference lookup never applies to them.
				for (const row of current.slice(-files.length)) looked.add(row.key);
				const admission = readyRef.current.pendingAdmission;
				if (admission && !options.whenReady)
					for (const row of current.slice(-files.length))
						if (row.status === "queued") void admitPending(row.key, admission);
				pump();
			},
			/* A loaded document's pending references: a finished import resolves them, an
			 * unfinished one is followed like a restored import. Looked up once per key. */
			/* A loaded document's pending references (D5): a finished import resolves
			 * them; a processing one is followed; an upload that failed, expired or never
			 * arrived restarts from the staged file under the same key, which the server
			 * reclaims; with no staged file the asset is interrupted. Once per key. */
			resolve(assets) {
				if (!active || !project) return;
				for (const { url, label } of assets) {
					const key = pendingSourceKey(url);
					if (!key || looked.has(key)) continue;
					// A row restored on mount from the server's unfinished imports knows nothing of
					// the pending asset or its staged file; resuming takes it over.
					if (!claim(key)) continue;
					looked.add(key);
					// A minted URL loads nothing until the lookup settles, rather than the server's 409.
					if (isMediaId(key)) trackPendingSource(key);
					void (async () => {
						let result: ProjectMediaImportResponse | undefined;
						try {
							result = await mediaImportByRequest(project, key, scope.signal);
						} catch (failure) {
							if (!importGone(failure)) {
								if (active && claim(key))
									add({
										key,
										filename: label,
										batchSize: 1,
										status: "failed",
										retryable: false,
										pending: true,
										error: mediaImportError(failure),
									});
								return;
							}
						}
						if (!active || !claim(key)) return;
						if (result?.status === "ready" && result.asset) {
							setPendingReady(key, result.asset);
							void staging.remove(project, key);
							return;
						}
						if (result && !["failed", "uploading", "cancelled"].includes(result.status)) {
							// Processing: the staged copy plays until the server copy is ready.
							const staged = await staging.read(project, key);
							if (!active || !claim(key)) return;
							if (staged) setPendingLocalUrl(key, URL.createObjectURL(staged));
							add({
								key,
								id: result.id,
								filename: result.filename,
								batchSize: 1,
								status: result.status,
								error: result.error ?? undefined,
								retryable: false,
								pending: true,
							});
							void poll(key);
							return;
						}
						const file =
							result?.status === "cancelled" ? undefined : await staging.read(project, key);
						if (!active || !claim(key)) return;
						if (!file) {
							add({
								key,
								filename: result?.filename ?? label,
								batchSize: 1,
								status: "failed",
								retryable: false,
								pending: true,
								interrupted: true,
								error: INTERRUPTED,
							});
							return;
						}
						setPendingLocalUrl(key, URL.createObjectURL(file));
						add({
							key,
							file,
							filename: file.name,
							batchSize: 1,
							status: "queued",
							retryable: true,
							pending: true,
						});
						pump();
					})();
				}
			},
			/* A failed or interrupted pending asset takes a file chosen again: checked like a
			 * source replacement, staged, and uploaded under the same request key. */
			chooseAgain(key, file) {
				const row = get(key),
					admission = readyRef.current.pendingAdmission;
				if (!active || !project || !row?.pending || row.status !== "failed" || !admission) return;
				const kind = mediaImportFilenameKind(file.name);
				const limit = !kind
					? "Unsupported file type"
					: !file.size
						? "File is empty"
						: file.size > limits.maxFileBytes
							? oversize(limits.maxFileBytes)
							: undefined;
				if (limit) {
					patch(key, { error: limit, interrupted: false });
					return;
				}
				void (admission.probe ?? probeLocalMedia)(file, kind!).then((probe) => {
					if (!active || get(key)?.status !== "failed") return;
					const reason = admission.validate?.(key, kind, probe.duration);
					// Shown as a failure with its reason; with no file held, the card still offers Choose again.
					if (reason) {
						patch(key, { error: reason, interrupted: false });
						return;
					}
					revoke(removePendingSource(key));
					setPendingLocalUrl(key, URL.createObjectURL(file));
					void staging.stage(project, key, file);
					patch(key, {
						file,
						filename: file.name,
						status: "queued",
						id: undefined,
						error: undefined,
						interrupted: false,
						retryable: true,
						progress: undefined,
					});
					pump();
				});
			},
			retry(key) {
				const row = get(key);
				if (
					!row ||
					row.status !== "failed" ||
					!row.file ||
					!mediaImportFilenameKind(row.filename) ||
					row.file.size > limits.maxFileBytes ||
					!row.file.size
				)
					return;
				patch(key, { status: "queued", id: undefined, error: undefined });
				pump();
			},
			cancel(key) {
				const row = get(key);
				if (!row || terminal(row.status)) return;
				patch(key, { status: "cancelled", error: undefined });
				uploads.get(key)?.abort();
				revoke(removePendingSource(key));
				if (project) void staging.remove(project, key);
				if (row.pending) discard(key);
				if (project)
					void (
						row.id ? cancelMediaImport(project, row.id) : cancelMediaUpload(project, key)
					).catch((failure) => {
						if (active) setError(mediaImportError(failure));
					});
			},
			dismiss(key) {
				const row = get(key);
				if (!row) return;
				uploads.get(key)?.abort();
				current = current.filter((item) => item.key !== key);
				setRows(current);
				// A ready row's source is what resolves its asset everywhere; only an unfinished one goes.
				if (row.status !== "ready") {
					revoke(removePendingSource(key));
					if (project) void staging.remove(project, key);
					if (row.pending) discard(key);
				}
				// Cancelling the server import keeps a dismissed failure from returning on reload.
				if (project && row.status !== "ready" && row.status !== "cancelled")
					void (
						row.id ? cancelMediaImport(project, row.id) : cancelMediaUpload(project, key)
					).catch(() => {});
			},
			refresh() {
				if (!active || !project) return;
				setReadiness(null);
				void mediaImportReadiness(project, scope.signal)
					.then((value) => {
						if (!active) return;
						status = value;
						limits = value.limits;
						setReadiness(value);
						pump();
					})
					.catch((failure) => {
						if (!active) return;
						status = { available: false, limits, reason: mediaImportError(failure) };
						setReadiness(status);
					});
			},
		};
		if (project) {
			actions.current.refresh();
			void (async () => {
				let after: string | null = null;
				do {
					const page = await pendingMediaImports(project, after, scope.signal);
					if (!active) return;
					for (const item of page.items) {
						if (
							looked.has(item.requestKey) ||
							current.some((row) => row.key === item.requestKey || row.id === item.import.id)
						)
							continue;
						const row: MediaImportRow = {
							key: item.requestKey,
							id: item.import.id,
							filename: item.import.filename,
							batchSize: 1,
							status: item.import.status,
							error: item.import.error ?? undefined,
							retryable: false,
						};
						current = [...current, row];
						setRows(current);
						if (!terminal(row.status)) void poll(row.key);
					}
					after = page.nextCursor;
				} while (after);
			})().catch((failure) => {
				if (active) setError(`Could not restore imports: ${mediaImportError(failure)}`);
			});
		}
		return () => {
			active = false;
			scope.abort();
			for (const timer of timers) clearTimeout(timer);
			clearPendingSources().forEach(revoke);
		};
	}, [project, workspace]);
	/* Each pending asset's card and clips read its state by request key. */
	const published = useRef(new Set<string>());
	useEffect(() => {
		const live = new Set<string>();
		for (const row of rows) {
			const state = row.pending ? pendingUploadState(row) : undefined;
			if (state) {
				live.add(row.key);
				setPendingUploadState(row.key, state);
			}
		}
		for (const key of published.current) if (!live.has(key)) setPendingUploadState(key, undefined);
		published.current = live;
	}, [rows]);
	// Stable, so an effect over the loaded assets can list it as a dependency.
	const resolve = useCallback(
		(assets: readonly PendingReference[]) => actions.current.resolve(assets),
		[],
	);
	return {
		rows,
		readiness,
		error,
		resolve,
		chooseAgain: (key: string, file: File) => actions.current.chooseAgain(key, file),
		enqueue: (files: File[], place?: PlaceMedia, options?: EnqueueOptions) =>
			actions.current.enqueue(files, place, options),
		retry: (key: string) => actions.current.retry(key),
		cancel: (key: string) => actions.current.cancel(key),
		dismiss: (key: string) => actions.current.dismiss(key),
		refresh: () => actions.current.refresh(),
	};
}
/** A pending asset as the loaded project records it. */
export type PendingReference = Pick<MediaAsset, "url" | "label">;
export interface EnqueueOptions {
	/** Place only once the import is ready, with no pending asset (source replacement). */
	whenReady?: boolean;
}
export type MediaImportControls = ReturnType<typeof useMediaImport>;
