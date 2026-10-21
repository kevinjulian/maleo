import { z } from "zod";
import { CaptionLanguageSchema } from "@maleo/shared";

export const SPEECH_UPLOAD_BYTES = 64 * 1024 * 1024;
export const SpeechOptionsSchema = z
	.object({
		language: CaptionLanguageSchema.optional(),
		text: z.string().max(20_000).optional(),
		force: z.boolean().optional(),
	})
	.strict();
export type SpeechOptions = z.infer<typeof SpeechOptionsSchema>;
export const SpeechResultSchema = z
	.object({
		words: z.array(
			z
				.object({
					text: z.string().min(1),
					startSec: z.number().finite().nonnegative(),
					endSec: z.number().finite().positive(),
				})
				.refine((word) => word.endSec > word.startSec),
		),
		cached: z.boolean(),
		model: z.string(),
		detectedLanguage: z.string().optional(),
	})
	.nullable();
export const SpeechStatusSchema = z.object({
	ready: z.boolean(),
	enabled: z.boolean(),
	model: z.string(),
	version: z.string(),
	whisperDir: z.string(),
	cacheDir: z.string(),
	mainInstalled: z.boolean(),
	modelInstalled: z.boolean(),
	ffmpegInstalled: z.boolean(),
	cacheBytes: z.number().nonnegative(),
});
export type SpeechStatus = z.infer<typeof SpeechStatusSchema>;
export type SpeechResult = z.infer<typeof SpeechResultSchema>;
export interface SpeechMediaClient {
	speechStatus(): Promise<SpeechStatus>;
	setupSpeech(): Promise<SpeechStatus>;
	transcribeSpeech(audio: Blob, options: SpeechOptions): Promise<SpeechResult>;
}
