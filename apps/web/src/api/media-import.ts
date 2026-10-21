import {
	ProjectMediaImportResponseSchema,
	ProjectMediaImportPageSchema,
	MediaImportReadinessSchema,
	type ImportedMediaKind,
	type ProjectMediaImportResponse,
} from "@maleo/shared";
import { z } from "zod";
import { request, requestUrl, responseError, ApiError } from "./client.ts";
import { BASE } from "./base.ts";

const base = (project: string) => `${BASE}/projects/${encodeURIComponent(project)}/media/import`;
export async function pendingMediaImports(
	project: string,
	after: string | null,
	signal: AbortSignal,
) {
	return ProjectMediaImportPageSchema.parse(
		await (
			await request(`${base(project)}${after ? `?after=${encodeURIComponent(after)}` : ""}`, {
				signal,
			})
		).json(),
	);
}
export async function mediaImportReadiness(project: string, signal: AbortSignal) {
	return MediaImportReadinessSchema.parse(
		await (await request(`${base(project)}/readiness`, { signal })).json(),
	);
}
/** XHR rather than fetch: only XHR reports request-body progress. `onProgress` receives 0–1. */
export function uploadMediaFile(
	project: string,
	file: File,
	kind: ImportedMediaKind,
	requestKey: string,
	batchSize: number,
	signal: AbortSignal,
	onProgress?: (fraction: number) => void,
) {
	const path = base(project);
	return new Promise<ProjectMediaImportResponse>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", requestUrl(path));
		xhr.withCredentials = true;
		const headers = {
			"content-type": "application/octet-stream",
			"x-file-name": encodeURIComponent(file.name),
			"x-media-kind": kind,
			"x-upload-id": requestKey,
			"x-batch-size": String(batchSize),
			"x-file-size": String(file.size),
		};
		for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0)
				onProgress?.(Math.min(1, event.loaded / event.total));
		};
		const abort = () => xhr.abort();
		const settle = (finish: () => void) => {
			signal.removeEventListener("abort", abort);
			finish();
		};
		xhr.onload = () =>
			settle(() => {
				if (xhr.status < 200 || xhr.status >= 300) {
					reject(responseError(path, xhr.status, xhr.responseText));
					return;
				}
				try {
					resolve(ProjectMediaImportResponseSchema.parse(JSON.parse(xhr.responseText)));
				} catch (error) {
					reject(error);
				}
			});
		xhr.onerror = () => settle(() => reject(new TypeError("Network request failed")));
		xhr.onabort = () => settle(() => reject(new DOMException("Upload aborted", "AbortError")));
		if (signal.aborted) {
			reject(new DOMException("Upload aborted", "AbortError"));
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		xhr.send(file);
	});
}
export async function pollMediaImport(project: string, id: string, signal: AbortSignal) {
	return ProjectMediaImportResponseSchema.parse(
		await (await request(`${base(project)}/${encodeURIComponent(id)}`, { signal })).json(),
	);
}
/** The import behind one request key, from stored state; a pending reference resolves through it. */
export async function mediaImportByRequest(
	project: string,
	requestKey: string,
	signal: AbortSignal,
) {
	return ProjectMediaImportResponseSchema.parse(
		await (
			await request(`${base(project)}/request/${encodeURIComponent(requestKey)}`, { signal })
		).json(),
	);
}
export async function cancelMediaImport(project: string, id: string) {
	return ProjectMediaImportResponseSchema.parse(
		await (
			await request(`${base(project)}/${encodeURIComponent(id)}`, {
				method: "DELETE",
				signal: AbortSignal.timeout(30_000),
			})
		).json(),
	);
}
export async function cancelMediaUpload(project: string, requestKey: string) {
	const response = await request(
		`${base(project)}/request/${encodeURIComponent(requestKey)}`,
		{ method: "DELETE", signal: AbortSignal.timeout(30_000) },
		{ nullOn404: true, richError: true },
	);
	return response.status === 404
		? null
		: ProjectMediaImportResponseSchema.parse(await response.json());
}
/** Gateway and edge-proxy codes (including Cloudflare's 52x) mean the service was not reached. */
const UNAVAILABLE = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

/** User-facing text: the API's authored message when it sent one, never a proxy's HTML page. */
export function mediaImportError(error: unknown): string {
	if (error instanceof ApiError) {
		const parsed = z.object({ message: z.string() }).safeParse(error.body);
		if (parsed.success) return parsed.data.message;
		if (error.status === 413)
			return "File is larger than the server or its proxy accepts (HTTP 413).";
		if (UNAVAILABLE.has(error.status))
			return `Upload service unavailable (HTTP ${error.status}). Retry in a moment.`;
		return `Upload failed (HTTP ${error.status}). Retry in a moment.`;
	}
	if (error instanceof DOMException && error.name === "AbortError") return "Upload cancelled";
	if (error instanceof TypeError) return "Network connection lost. Retry when online.";
	return error instanceof Error ? error.message : "File import failed";
}
