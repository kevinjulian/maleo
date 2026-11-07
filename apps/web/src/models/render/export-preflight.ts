/* Browser export preflight rules (OpenSpec p2-export E9, asset-manifest delta).
 *
 * The checks run in this order and the first refusal wins: WebGPU, encoders,
 * whole-project coverage, manifest blockers, then each used file's local bytes.
 * A refusal names its cause. It offers server export only when the server could
 * still render the project: a local download or hash failure, or a browser
 * limit. A `pending` or `failed` file blocks server export too, so it offers
 * nothing. Preflight only reads; it never changes the document. */
import { z } from "zod";
import { coverageReason, type ExportCoverage } from "./export-coverage.ts";

export const manifestEntrySchema = z.object({
	id: z.string(),
	url: z.string(),
	state: z.enum(["ready", "pending", "failed", "external"]),
	origin: z.enum(["import", "managed", "external"]).optional(),
	kind: z.string().optional(),
	contentType: z.string().optional(),
	size: z.number().int().nonnegative().optional(),
	sha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/i)
		.optional(),
	label: z.string().optional(),
	used: z.boolean(),
});
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export const assetManifestSchema = z.object({ assets: z.array(manifestEntrySchema) });

export type PreflightCause =
	| "webgpu"
	| "encoder"
	| "size"
	| "coverage"
	| "pending"
	| "failed"
	| "download"
	| "hash";

export type PreflightResult =
	| { ok: true }
	| { ok: false; cause: PreflightCause; message: string; offerServer: boolean };

/** What the browser read for one entry: its bytes' size and SHA-256, or nothing. */
export interface LocalBytes {
	size: number;
	sha256: string;
}

const refuse = (cause: PreflightCause, message: string, offerServer: boolean): PreflightResult => ({
	ok: false,
	cause,
	message,
	offerServer,
});

export function fileName(entry: ManifestEntry): string {
	return entry.label ?? entry.url;
}

export function environmentRefusal(webgpu: boolean, encoders: boolean): PreflightResult | null {
	if (!webgpu)
		return refuse("webgpu", "This browser has no WebGPU adapter, so it cannot export.", true);
	if (!encoders)
		return refuse(
			"encoder",
			"This browser cannot encode H.264 video with AAC audio at this size.",
			true,
		);
	return null;
}

/** The encoded file is built in memory (the audio edit list rewrites it whole), so
 *  a browser export larger than this goes to the server instead. */
export const BROWSER_EXPORT_MAX_BYTES = 512 * 1024 * 1024;
const AUDIO_BITS_PER_SECOND = 192_000;

/** The estimated file size, with 5% container and rate-control headroom. */
export function estimatedExportBytes(videoBitrate: number, seconds: number): number {
	return Math.ceil((((videoBitrate + AUDIO_BITS_PER_SECOND) / 8) * seconds * 105) / 100);
}

export function sizeRefusal(videoBitrate: number, seconds: number): PreflightResult | null {
	const bytes = estimatedExportBytes(videoBitrate, seconds);
	if (bytes <= BROWSER_EXPORT_MAX_BYTES) return null;
	return refuse(
		"size",
		`This export is about ${Math.round(bytes / 1024 / 1024)} MiB, more than a browser export holds (${BROWSER_EXPORT_MAX_BYTES / 1024 / 1024} MiB). Export on the server instead.`,
		true,
	);
}

export function coverageRefusal(coverage: ExportCoverage): PreflightResult | null {
	switch (coverage.state) {
		case "eligible":
			return null;
		case "ineligible":
			return refuse(
				"coverage",
				`The Rust renderer does not cover this project: ${coverageReason(coverage.entries)}.`,
				true,
			);
		case "checking":
			return refuse("coverage", "Renderer coverage is still being checked.", false);
		case "error":
			return refuse("coverage", `Renderer coverage check failed: ${coverage.message}`, true);
	}
}

/** The first used entry that is still uploading or gone. */
export function manifestRefusal(entries: readonly ManifestEntry[]): PreflightResult | null {
	const pending = entries.find((entry) => entry.used && entry.state === "pending");
	if (pending)
		return refuse(
			"pending",
			`${fileName(pending)} is still uploading. Wait for it to finish before export.`,
			false,
		);
	const failed = entries.find((entry) => entry.used && entry.state === "failed");
	if (failed)
		return refuse(
			"failed",
			`${fileName(failed)} is unavailable. Replace the missing source before export.`,
			false,
		);
	return null;
}

/** The entries whose local bytes the browser must read before encoding. */
export function entriesToRead(entries: readonly ManifestEntry[]): ManifestEntry[] {
	return entries.filter(
		(entry) => entry.used && (entry.state === "ready" || entry.state === "external"),
	);
}

/** Checks one entry's local bytes against the manifest. `null` bytes: not downloaded. */
export function bytesRefusal(
	entry: ManifestEntry,
	bytes: LocalBytes | null,
): PreflightResult | null {
	if (!bytes)
		return refuse(
			"download",
			`${fileName(entry)} could not be downloaded in this browser. Export on the server instead.`,
			true,
		);
	if (entry.state !== "ready") return null;
	if (
		(entry.size !== undefined && bytes.size !== entry.size) ||
		(entry.sha256 !== undefined && bytes.sha256 !== entry.sha256.toLowerCase())
	)
		return refuse(
			"hash",
			`${fileName(entry)} does not match the stored file. Export on the server instead.`,
			true,
		);
	return null;
}
