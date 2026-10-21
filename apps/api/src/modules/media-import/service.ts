import {
	getProjectMediaImport,
	getImportByRequestKey,
	listPendingProjectImports,
	importOriginal,
	importedAsset,
	reserveProjectMediaImport,
	attachImportOriginal,
	setImportWorkerJob,
	failProjectMediaImport,
	finishProjectMediaImport,
	cancelProjectMediaImport,
	type ProjectMediaImport,
} from "@maleo/db/media-imports";
import { openDb } from "@maleo/db/connection";
import { serialize } from "@maleo/db/handle";
import { getWorkspaceMember } from "@maleo/db/workspace-members";
import { registerMediaObject, mediaObjectUrl } from "@maleo/db/media-objects";
import { getMedia, putMedia, deleteMedia, type StoredMedia } from "@maleo/storage";
import {
	createMediaClient,
	MediaWorkerHttpError,
	type ProcessingMediaClient,
	type MediaProcessingRequest,
	isCaptionProcessingJob,
	type ProcessingJob,
	type ProcessingReadiness,
} from "@maleo/media/api";
import {
	effectiveMediaImportLimits,
	MediaImportLimitsSchema,
	mediaImportFilenameKind,
	type MediaImportLimits,
	type ProjectMediaImportPage,
	type ProjectMediaImportResponse,
	type ReadyImportedMedia,
} from "@maleo/shared";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HTTPException } from "hono/http-exception";
import { configuredServiceToken } from "../../lib/service-token.ts";
import type { ImportSourceScope, ImportUploadHeaders } from "./model.ts";

export interface MediaImportOptions {
	client?: ProcessingMediaClient;
	limits?: Partial<MediaImportLimits>;
}

/** A worker result this import can never accept; its message is safe to show and store. */
export class ImportRejected extends Error {}

/** Client-facing text: HTTP and rejection messages are authored for users; anything else stays in server logs. */
export function publicImportError(error: unknown, fallback: string): string {
	if (error instanceof HTTPException || error instanceof ImportRejected) return error.message;
	console.error("[media-import]", error);
	return fallback;
}

function clientForImport(options: MediaImportOptions): ProcessingMediaClient {
	if (options.client) return options.client;
	const baseUrl = process.env.MALEO_GEN_WORKER_URL?.trim();
	const token = configuredServiceToken();
	if (!baseUrl || !token)
		throw new HTTPException(503, {
			message: "Configure media worker and matching service token to import files",
		});
	return createMediaClient({ baseUrl, token });
}

export async function importReadiness(options: MediaImportOptions): Promise<ProcessingReadiness> {
	const configured = effectiveMediaImportLimits(options.limits);
	try {
		const ready = await clientForImport(options).processingReadiness();
		const limits = MediaImportLimitsSchema.parse(
			Object.fromEntries(
				MediaImportLimitsSchema.keyof().options.map((key) => [
					key,
					Math.min(configured[key], ready.limits[key]),
				]),
			),
		);
		return { ...ready, limits };
	} catch (error) {
		return {
			available: false,
			limits: configured,
			reason: publicImportError(error, "Media worker unavailable"),
		};
	}
}

/** Resolves whether the caller may edit; reads stay open to every workspace member. */
export async function assertImportProject(
	projectId: string,
	workspace: string,
	userId: string,
	write = true,
): Promise<{ canWrite: boolean }> {
	const project = await openDb().get<{ workspace: string }>(
		"SELECT workspace FROM content_projects WHERE id = ?",
		[projectId],
	);
	const member = await getWorkspaceMember(workspace, userId);
	if (!member || project?.workspace !== workspace)
		throw new HTTPException(404, { message: "Project not found" });
	const canWrite = member.role === "owner" || member.role === "member";
	if (write && !canWrite)
		throw new HTTPException(403, { message: "Project editing permission required" });
	return { canWrite };
}

function responseForImport(row: ProjectMediaImport): ProjectMediaImportResponse {
	return {
		id: row.id,
		filename: row.original_filename,
		status: row.status,
		asset: importedAsset(row),
		error: row.error,
	};
}

export async function pendingProjectImports(
	projectId: string,
	workspace: string,
	after: string | null,
): Promise<ProjectMediaImportPage> {
	const rows = await listPendingProjectImports(workspace, projectId, after);
	const page = rows.slice(0, 50);
	return {
		items: page.map((row) => ({ requestKey: row.request_key, import: responseForImport(row) })),
		nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
	};
}

function workerRequest(row: ProjectMediaImport): MediaProcessingRequest {
	const original = importOriginal(row);
	if (!original) throw new Error("Import source not uploaded");
	return {
		importId: row.id,
		workspaceId: row.workspace,
		projectId: row.project_id,
		sourceRevision: row.source_revision,
		fingerprint: original.hash,
		originalFilename: row.original_filename,
		kind: row.claimed_kind,
		idempotencyKey: `${row.id}-${row.source_revision}`,
	};
}

async function boundedUpload<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	let abort: () => void = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([pending, cancelled]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

// ponytail: two uploads per API process; use a shared semaphore if replicas are introduced.
let activeUploads = 0;

export async function uploadProjectMedia(
	projectId: string,
	workspace: string,
	headers: ImportUploadHeaders,
	request: Request,
	options: MediaImportOptions,
): Promise<ProjectMediaImportResponse> {
	if (mediaImportFilenameKind(headers.filename) !== headers.kind)
		throw new HTTPException(400, { message: "Choose a supported image, video or audio filename" });
	// Configured limits bound every effective limit, so cheap refusals need no worker round trip.
	const configured = effectiveMediaImportLimits(options.limits);
	if (headers.batchSize > configured.maxBatchFiles)
		throw new HTTPException(400, { message: "Import batch exceeds file limit" });
	const declared = Math.max(
		Number(request.headers.get("content-length")) || 0,
		headers.declaredBytes ?? 0,
	);
	if (declared > configured.maxFileBytes)
		throw new HTTPException(413, { message: "File exceeds import byte limit" });
	if (!request.body) throw new HTTPException(400, { message: "File is empty" });
	if (activeUploads >= configured.maxConcurrentUploads)
		throw new HTTPException(429, {
			message: "Two uploads already running; retry when one finishes",
		});
	activeUploads++;
	let directory: string | undefined;
	let row: ProjectMediaImport | undefined;
	let stored: StoredMedia | undefined;
	let attached = false;
	try {
		// Reserve before any await on the worker, so cancel-by-request-key always finds this attempt.
		const reservation = await reserveProjectMediaImport({
			workspace,
			projectId,
			requestKey: headers.requestKey,
			filename: headers.filename,
			kind: headers.kind,
			uploadTimeoutMs: configured.processingTimeoutMs,
		}).catch((error) => {
			if (error instanceof Error && error.message === "Upload retry does not match original file")
				throw new HTTPException(409, { message: error.message });
			throw error;
		});
		row = reservation.row;
		if (!reservation.claimed) {
			await request.body.cancel().catch(() => {});
			return responseForImport(row);
		}
		const readiness = await importReadiness(options);
		if (!readiness.available) throw new HTTPException(503, { message: readiness.reason });
		const { limits } = readiness;
		if (headers.batchSize > limits.maxBatchFiles)
			throw new HTTPException(400, { message: "Import batch exceeds file limit" });
		if (declared > limits.maxFileBytes)
			throw new HTTPException(413, { message: "File exceeds import byte limit" });
		if ((await getProjectMediaImport(row.id))?.status !== "uploading")
			throw new HTTPException(409, { message: "Import was cancelled or replaced" });
		const signal = AbortSignal.any([
			request.signal,
			AbortSignal.timeout(limits.processingTimeoutMs),
		]);
		directory = await mkdtemp(join(tmpdir(), "maleo-upload-"));
		const path = join(directory, "source.bin");
		let size = 0;
		const stream = request.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					size += chunk.byteLength;
					if (size > limits.maxFileBytes)
						throw new HTTPException(413, { message: "File exceeds import byte limit" });
					if (headers.declaredBytes != null && size > headers.declaredBytes)
						throw new HTTPException(400, { message: "Upload was incomplete; retry file" });
					controller.enqueue(chunk);
				},
			}),
			{ signal },
		);
		const file = await open(path, "w", 0o600);
		try {
			await stream.pipeTo(
				new WritableStream<Uint8Array>({ write: (chunk) => file.writeFile(chunk) }),
				{ signal },
			);
		} finally {
			await file.close();
		}
		if (!size) throw new HTTPException(400, { message: "File is empty" });
		if (headers.declaredBytes != null && size !== headers.declaredBytes)
			throw new HTTPException(400, { message: "Upload was incomplete; retry file" });
		const pending = putMedia({
			workspace,
			project: projectId,
			kind: "file",
			body: Bun.file(path),
			contentType: "application/octet-stream",
			filename: headers.filename,
		});
		void pending
			.then((value) => (signal.aborted ? deleteMedia(value.key) : undefined))
			.catch(() => {});
		stored = await boundedUpload(pending, signal);
		signal.throwIfAborted();
		if (!(await attachImportOriginal(row, stored)))
			throw new HTTPException(409, { message: "Import was cancelled or replaced" });
		attached = true;
		const jobId = await clientForImport(options).submitProcessing(
			workerRequest((await getProjectMediaImport(row.id))!),
		);
		if (!(await setImportWorkerJob(row, jobId))) {
			await clientForImport(options).cancelProcessing(jobId, { workspaceId: workspace, projectId });
			throw new HTTPException(409, { message: "Import was cancelled or replaced" });
		}
		return responseForImport((await getProjectMediaImport(row.id))!);
	} catch (error) {
		if (row)
			await failProjectMediaImport(row, publicImportError(error, "Upload failed; retry file"));
		if (stored && !attached) await deleteMedia(stored.key);
		throw error;
	} finally {
		activeUploads--;
		if (directory) await rm(directory, { recursive: true, force: true });
	}
}

async function scopedImport(
	id: string,
	projectId: string,
	workspace: string,
): Promise<ProjectMediaImport> {
	const row = await getProjectMediaImport(id);
	if (!row || row.project_id !== projectId || row.workspace !== workspace)
		throw new HTTPException(404, { message: "Import not found" });
	return row;
}

async function publishImport(
	row: ProjectMediaImport,
	job: ProcessingJob,
): Promise<ProjectMediaImport> {
	if (isCaptionProcessingJob(job) || job.request.operation || job.request.sourceMediaId)
		throw new ImportRejected("Derivative output cannot complete an import");
	const expected = workerRequest(row);
	if (
		job.request.importId !== expected.importId ||
		job.request.workspaceId !== expected.workspaceId ||
		job.request.projectId !== expected.projectId ||
		job.request.sourceRevision !== expected.sourceRevision ||
		job.request.fingerprint !== expected.fingerprint ||
		job.request.kind !== expected.kind
	)
		throw new ImportRejected("Worker result does not own import source");
	const result = job.result;
	const original = importOriginal(row)!;
	if (
		job.id !== row.worker_job_id ||
		!result ||
		result.sourceRevision !== row.source_revision ||
		result.metadata.kind !== row.claimed_kind ||
		result.metadata.byteSize !== original.size ||
		result.metadata.originalFilename !== row.original_filename
	)
		throw new ImportRejected("Worker result does not match original metadata");
	if (
		result.compatibility.preview.status !== "supported" ||
		result.compatibility.render.status !== "supported"
	)
		throw new ImportRejected("Media needs compatible playback conversion before placement");
	const playbackType =
		row.claimed_kind === "image"
			? "image/png"
			: row.claimed_kind === "audio"
				? "audio/mp4"
				: "video/mp4";
	if (
		result.playback.contentType !== playbackType ||
		(result.thumbnail && result.thumbnail.contentType !== "image/png")
	)
		throw new ImportRejected("Worker playback format does not match import contract");
	const outputs = [
		[original, "file"],
		[result.playback, row.claimed_kind],
		...(result.thumbnail ? ([[result.thumbnail, "image"]] as const) : []),
	] as const;
	// Storage round trips stay outside the transaction so the completion lock is held only for registry writes.
	for (const [stored, kind] of outputs) {
		if (!stored.key.startsWith(`workspaces/${row.workspace}/${kind}/${row.project_id}/`))
			throw new ImportRejected("Worker result storage ownership mismatch");
		if ((await getMedia(stored.key)).size !== stored.size)
			throw new ImportRejected("Worker result storage size mismatch");
	}
	return openDb().transaction(async (tx) => {
		await serialize(tx, `import-complete:${row.id}`);
		const current = await getProjectMediaImport(row.id, tx);
		if (!current || current.source_revision !== row.source_revision)
			throw new HTTPException(409, { message: "Import source changed" });
		if (current.status === "ready" || current.status === "cancelled") return current;
		const register = (stored: StoredMedia, kind: "file" | "image" | "audio" | "video") => {
			return registerMediaObject(
				{
					workspace: row.workspace,
					kind,
					hash: stored.hash,
					storage_key: stored.key,
					content_type: stored.contentType,
					size: stored.size,
				},
				tx,
			);
		};
		const source = await register(original, "file");
		const playback = await register(result.playback, row.claimed_kind);
		const thumbnail = result.thumbnail ? await register(result.thumbnail, "image") : undefined;
		const asset: ReadyImportedMedia = {
			id: row.id,
			label: row.original_filename,
			url: mediaObjectUrl(playback.id),
			kind: row.claimed_kind,
			source: "upload",
			metadata: result.metadata,
			compatibility: result.compatibility,
			importedSource: {
				revision: row.source_revision,
				fingerprint: original.hash,
				originalMediaId: source.id,
				playbackMediaId: playback.id,
				...(thumbnail ? { thumbnailMediaId: thumbnail.id } : {}),
			},
			...(result.metadata.duration ? { dur: result.metadata.duration } : {}),
			...(thumbnail ? { thumb: mediaObjectUrl(thumbnail.id) } : {}),
		};
		if (!(await finishProjectMediaImport(current, asset, tx)))
			throw new HTTPException(409, { message: "Import was cancelled or replaced" });
		return (await getProjectMediaImport(row.id, tx))!;
	});
}

/** Readers see stored state; only editors drive worker submission and publication. */
export async function pollProjectMediaImport(
	id: string,
	projectId: string,
	workspace: string,
	options: MediaImportOptions,
	canWrite = true,
): Promise<ProjectMediaImportResponse> {
	const row = await scopedImport(id, projectId, workspace);
	if (!canWrite || row.status === "ready" || row.status === "cancelled")
		return responseForImport(row);
	try {
		return await driveImport(row, options);
	} catch (error) {
		const current = (await getProjectMediaImport(row.id))!;
		if (
			current.source_revision !== row.source_revision ||
			current.status === "ready" ||
			current.status === "cancelled"
		)
			return responseForImport(current);
		if (error instanceof ImportRejected) await failProjectMediaImport(row, error.message);
		else if (error instanceof MediaWorkerHttpError && error.status === 404)
			await failProjectMediaImport(row, "Processing was interrupted; retry file");
		else if (error instanceof HTTPException && error.status === 409)
			return responseForImport(current);
		else {
			console.error("[media-import] poll", error);
			// Transient worker/storage trouble keeps the import live until its processing window closes.
			if (
				Date.now() <
				row.lease_until + 2 * effectiveMediaImportLimits(options.limits).processingTimeoutMs
			)
				return current.status === "failed"
					? responseForImport(current)
					: { ...responseForImport(current), status: "processing", error: null };
			await failProjectMediaImport(row, "Processing timed out; retry file");
		}
		return responseForImport((await getProjectMediaImport(row.id))!);
	}
}

async function driveImport(
	initial: ProjectMediaImport,
	options: MediaImportOptions,
): Promise<ProjectMediaImportResponse> {
	let row = initial;
	const { workspace, project_id: projectId } = row;
	if (row.status === "uploading") {
		if (row.lease_until < Date.now())
			await failProjectMediaImport(row, "Upload interrupted; retry file");
		return responseForImport((await getProjectMediaImport(row.id))!);
	}
	if (!importOriginal(row)) return responseForImport(row);
	const client = clientForImport(options);
	if (!row.worker_job_id) {
		const id = await client.submitProcessing(workerRequest(row));
		await setImportWorkerJob(row, id);
		row = (await getProjectMediaImport(row.id))!;
	}
	if (!row.worker_job_id) return responseForImport(row);
	const job = await client.pollProcessing(row.worker_job_id, { workspaceId: workspace, projectId });
	if (job.status === "done") row = await publishImport(row, job);
	else if (job.status === "failed") {
		await failProjectMediaImport(row, job.error ?? "Media processing failed");
		row = (await getProjectMediaImport(row.id))!;
	} else if (job.status === "cancelled") {
		await cancelProjectMediaImport(row);
		row = (await getProjectMediaImport(row.id))!;
	} else
		return {
			...responseForImport(row),
			error: null,
			status: job.status === "queued" ? "queued" : "processing",
		};
	return responseForImport(row);
}

export async function cancelImport(
	id: string,
	projectId: string,
	workspace: string,
	options: MediaImportOptions,
): Promise<ProjectMediaImportResponse> {
	const row = await scopedImport(id, projectId, workspace);
	await cancelProjectMediaImport(row);
	// The row is already cancelled; a worker that cannot be reached only delays its own cleanup.
	if (row.worker_job_id && row.status !== "ready")
		await clientForImport(options)
			.cancelProcessing(row.worker_job_id, { workspaceId: workspace, projectId })
			.catch((error: unknown) => console.error("[media-import] worker cancel", error));
	return responseForImport((await getProjectMediaImport(id))!);
}

/** Stored state only, so pending references resolve without advancing the worker for read-only callers. */
export async function importByRequestKey(
	requestKey: string,
	projectId: string,
	workspace: string,
): Promise<ProjectMediaImportResponse | null> {
	const row = await getImportByRequestKey(workspace, projectId, requestKey);
	return row ? responseForImport(row) : null;
}

export async function cancelUploadRequest(
	requestKey: string,
	projectId: string,
	workspace: string,
	options: MediaImportOptions,
): Promise<ProjectMediaImportResponse | null> {
	const row = await getImportByRequestKey(workspace, projectId, requestKey);
	return row ? cancelImport(row.id, projectId, workspace, options) : null;
}

/** Quarantine access is tied to live project ownership and immutable revision. */
export async function authorizedImportSource(
	id: string,
	scope: ImportSourceScope,
): Promise<Blob | null> {
	const row = await getProjectMediaImport(id);
	if (
		!row ||
		row.workspace !== scope.workspace ||
		row.project_id !== scope.project ||
		row.source_revision !== scope.revision ||
		!["processing", "failed"].includes(row.status)
	)
		return null;
	const project = await openDb().get<{ workspace: string }>(
		"SELECT workspace FROM content_projects WHERE id = ?",
		[row.project_id],
	);
	if (project?.workspace !== scope.workspace) return null;
	const original = importOriginal(row);
	if (!original || !original.key.startsWith(`workspaces/${scope.workspace}/file/${scope.project}/`))
		return null;
	const blob = await getMedia(original.key);
	if (blob.size !== original.size) throw new Error("Import source size changed in storage");
	return blob;
}
