/* What the browser can measure about a chosen file before it uploads, so a pending
 * asset is placeable at once (`use-media-while-uploading` D3). Server-measured
 * metadata replaces all of it once the import is ready. */
import { ALL_FORMATS, BlobSource, Input, type InputTrack } from "mediabunny";
import type { ImportedMediaKind } from "@maleo/shared";

export interface LocalMediaProbe {
	width?: number;
	height?: number;
	duration?: number;
	hasAudio?: boolean;
	/** Whether this browser can preview the file before processing converts it. */
	decodable: boolean;
	/** Why the file cannot be placed until processing finishes. */
	blocked?: string;
}

interface ProbeDeps {
	decodeImage?: (file: File) => Promise<{ width: number; height: number; close(): void }>;
	canDecode?: (track: InputTrack) => Promise<boolean>;
}

const UNKNOWN_DURATION = "Length unknown until processing finishes";

export async function probeLocalMedia(
	file: File,
	kind: ImportedMediaKind,
	deps: ProbeDeps = {},
): Promise<LocalMediaProbe> {
	if (kind === "image") {
		try {
			const bitmap = await (deps.decodeImage ?? createImageBitmap)(file);
			const size = { width: bitmap.width, height: bitmap.height };
			bitmap.close();
			return { ...size, decodable: true };
		} catch {
			return { decodable: false };
		}
	}
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		// Sequential: parallel reads of an unreadable file each reject, and only one would be caught.
		const duration = await input.computeDuration();
		const video = await input.getPrimaryVideoTrack(),
			audio = await input.getPrimaryAudioTrack();
		const track = kind === "video" ? video : audio;
		const decodable = track
			? await (deps.canDecode ?? ((t: InputTrack) => t.canDecode()))(track).catch(() => false)
			: false;
		const measured = Number.isFinite(duration) && duration > 0 && track ? duration : undefined;
		input.dispose();
		return {
			...(kind === "video" && video
				? { width: video.displayWidth, height: video.displayHeight }
				: {}),
			...(measured ? { duration: measured } : { blocked: UNKNOWN_DURATION }),
			hasAudio: Boolean(audio),
			decodable,
		};
	} catch {
		// Not disposed: disposing an input that failed to read rejects again, unhandled.
		return { decodable: false, blocked: UNKNOWN_DURATION };
	}
}
