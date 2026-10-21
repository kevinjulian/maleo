import { effectiveMediaImportLimits } from "@maleo/shared";
import type { ProcessingReadiness } from "../api/processing.ts";
import { runMediaCommand } from "./probe.ts";
import { getLocalWhisperStatus } from "./whisper.ts";

export async function processingReadiness(kind?: "captions"): Promise<ProcessingReadiness> {
	const limits = effectiveMediaImportLimits();
	const path = process.env.PATH ?? "";
	const ffmpeg = Bun.which("ffmpeg", { PATH: path });
	const ffprobe = Bun.which("ffprobe", { PATH: path });
	if (!ffmpeg || !ffprobe)
		return { available: false, limits, reason: "Install FFmpeg and ffprobe on media worker" };
	try {
		const signal = AbortSignal.timeout(3000);
		await Promise.all([
			runMediaCommand(ffmpeg, ["-version"], signal),
			runMediaCommand(ffprobe, ["-version"], signal),
		]);
		if (kind === "captions") {
			const status = await getLocalWhisperStatus();
			const reason = status.ready
				? undefined
				: "Install Whisper runtime and configured model on media worker in Settings";
			return {
				available: status.ready,
				limits,
				...(reason ? { reason } : {}),
				captions: {
					available: status.ready,
					model: status.model,
					runtime: status.version,
					...(reason ? { reason } : {}),
				},
			};
		}
		return { available: true, limits };
	} catch (error) {
		console.error("[processing] binary readiness", error);
		return {
			available: false,
			limits,
			reason: "FFmpeg or ffprobe check failed on media worker; check worker logs",
		};
	}
}
