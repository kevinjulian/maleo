/* Runs browser export preflight (OpenSpec p2-export E9) over the preview's
 * complete local sources. Files are hashed one at a time, so peak memory is the
 * largest single source, and the same local bytes then serve decoding. */
import { canEncodeAudio, canEncodeVideo } from "mediabunny";
import type { ExportCoverage } from "@models/render/export-coverage.ts";
import {
	bytesRefusal,
	coverageRefusal,
	entriesToRead,
	environmentRefusal,
	manifestRefusal,
	sizeRefusal,
	type LocalBytes,
	type ManifestEntry,
	type PreflightResult,
} from "@models/render/export-preflight.ts";

export interface PreflightInput {
	width: number;
	height: number;
	bitrate: number;
	/** Output duration in seconds. */
	seconds: number;
	coverage: ExportCoverage;
	manifest: readonly ManifestEntry[];
	/** The complete local file the preview loaded for an entry, if any. */
	localFile: (entry: ManifestEntry) => File | undefined;
}

export interface PreflightProbes {
	webgpu: () => Promise<boolean>;
	encoders: (width: number, height: number, bitrate: number) => Promise<boolean>;
	digest: (file: File) => Promise<string>;
}

export const browserProbes: PreflightProbes = {
	async webgpu() {
		try {
			// SAFETY: `navigator.gpu` is absent from this DOM lib; it is read as optional.
			const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } })
				.gpu;
			return Boolean(await gpu?.requestAdapter());
		} catch {
			return false;
		}
	},
	async encoders(width, height, bitrate) {
		try {
			const [video, audio] = await Promise.all([
				canEncodeVideo("avc", { width, height, bitrate }),
				canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48_000, bitrate: 192_000 }),
			]);
			return video && audio;
		} catch {
			return false;
		}
	},
	async digest(file) {
		const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
		return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	},
};

export async function runExportPreflight(
	input: PreflightInput,
	probes: PreflightProbes = browserProbes,
): Promise<PreflightResult> {
	const environment = environmentRefusal(
		await probes.webgpu(),
		await probes.encoders(input.width, input.height, input.bitrate),
	);
	if (environment) return environment;
	const size = sizeRefusal(input.bitrate, input.seconds);
	if (size) return size;
	const coverage = coverageRefusal(input.coverage);
	if (coverage) return coverage;
	const manifest = manifestRefusal(input.manifest);
	if (manifest) return manifest;
	for (const entry of entriesToRead(input.manifest)) {
		const file = input.localFile(entry);
		let bytes: LocalBytes | null = null;
		if (file) {
			try {
				bytes = { size: file.size, sha256: await probes.digest(file) };
			} catch {
				bytes = null;
			}
		}
		const refusal = bytesRefusal(entry, bytes);
		if (refusal) return refusal;
	}
	return { ok: true };
}
