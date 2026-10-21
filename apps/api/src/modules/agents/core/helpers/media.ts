/* Media helpers shared by migrated generation handlers.
 *
 * Synthesis goes through `synthesizeBilledTts`, so this file writes files and
 * measures durations and knows nothing about what speech costs. It used to call
 * `runBillableOperation` directly with the audio price row copied inline — the
 * same five numbers the price table already held — so a price change reached the
 * longform path and not this one, and no workspace quota gated the spend. */
import { synthesizeBilledTts } from "../../../../lib/generation/billed-tts.ts";
import { measureOrProbeAudioDurationSec } from "../../../../lib/audio-duration.ts";
import { storeManagedMedia } from "../../../../lib/media-storage.ts";

// Synthesize speech via the workspace-default TTS provider and return its stable
// media URL. Throws on provider error, and
// on QuotaExceededError when the workspace has no generations left.
export async function synthToUploadResult(
	text: string,
	voice?: string,
	billing?: { workspace?: string },
): Promise<{ url: string; durationSec?: number }> {
	const workspace = billing?.workspace?.trim();
	if (!workspace) throw new Error("speech has no owning workspace");
	const { bytes, ext } = await synthesizeBilledTts({ text, voice, workspace });
	const durationSec = (await measureOrProbeAudioDurationSec(bytes, ext)) ?? undefined;
	const contentType = ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : `audio/${ext}`;
	const url = await storeManagedMedia({
		workspace,
		kind: "audio",
		body: bytes,
		contentType,
		filename: `speech.${ext}`,
	});
	return { url, durationSec };
}

export async function synthToUpload(
	text: string,
	voice?: string,
	billing?: { workspace?: string },
): Promise<string> {
	return (await synthToUploadResult(text, voice, billing)).url;
}
