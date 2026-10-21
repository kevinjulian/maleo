/* Bake the voice audition samples.
 *
 * Every catalogued voice speaks one fixed sentence into a static file under
 * public/uploads. The pickers play those files; nothing synthesizes a sample on
 * the request path, so previewing a voice is free and never touches a provider.
 *
 * Synthesis goes through `synthesizeTts` — the UNBILLED provider dispatch — and
 * deliberately not `synthesizeBilledTts`. That is the whole reason a preview
 * costs nothing: the only spend is here, once per voice per sample-text version.
 *
 * Re-running is a no-op. The filename encodes provider + voice + text version,
 * so an already-baked voice is skipped by an existence check. Bump
 * SAMPLE_TEXT_VERSION in voice-samples.ts to rebake the whole set.
 *
 *   bun run bake:voice-samples                          # bake what is missing
 *   bun run bake:voice-samples -- --force               # rebake everything
 *   bun run bake:voice-samples -- --provider=kokoro     # one provider only
 *
 * It lives in apps/api rather than the repo-root scripts/ for two reasons:
 * workspace dependencies (@maleo/media) only resolve
 * inside a package, and the uploads directory is cwd-relative — running here
 * means the baker writes exactly where the API server reads.
 *
 * An unconfigured provider is skipped with a note, not a failure: one provider's
 * samples alone are useful, and a fresh environment with none configured should
 * still complete setup. The exit code is non-zero only when a configured
 * provider produced nothing at all.
 */
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { TtsVoice } from "@maleo/media/providers";
import {
	SAMPLE_TEXT_VERSION,
	sampleTextForLanguage,
	voiceSampleFilename,
} from "../src/lib/voice-samples.ts";
import { synthesizeTts, ttsProviders, type TtsProviderId } from "../src/lib/tts-synth.ts";
import { resolveUploadFilePath } from "../src/lib/upload-files.ts";

const UPLOADS_DIR = "public/uploads";
const force = process.argv.includes("--force");
const onlyProvider = process.argv.find((a) => a.startsWith("--provider="))?.split("=")[1];

/* A provider can answer its readiness probe and then hang on every job — Canvas
 * enqueues with a 150s timeout, so eight dead voices is a twenty-minute bake that
 * looks like a hung script. After this many consecutive failures the provider is
 * abandoned and the remaining voices are left unbaked (still listed, just without
 * a preview). Consecutive, not total: a single bad voice among good ones does not
 * trip it. */
const CONSECUTIVE_FAILURE_LIMIT = 2;

interface ProviderPlan {
	provider: TtsProviderId;
	voices: readonly TtsVoice[];
	configured: () => Promise<boolean>;
}

/* Derived from the registry, never listed here.
 *
 * This array used to name the providers and import each one's voice catalogue,
 * which made it the last place a provider's voices were restated — and a list
 * that must be edited when a provider is added is a list that will one day be
 * missed, leaving a provider's voices listed everywhere and auditionable
 * nowhere. Registering a TTS provider now brings its voices into the bake with
 * no edit to this file. */
function plans(): ProviderPlan[] {
	return ttsProviders().map((provider) => ({
		provider: provider.meta.id,
		voices: provider.meta.tts?.voices ?? [],
		configured: async () => (await provider.meta.health("tts")) === "ready",
	}));
}

/** True when any extension of this voice's sample is already on disk. Mirrors
 *  `voiceSampleUrl`'s probe, but the baker cannot import it for this: it needs to
 *  know "is anything baked", not "what url would I serve". */
function alreadyBaked(provider: TtsProviderId, voiceId: string): boolean {
	for (const ext of ["mp3", "wav", "ogg", "flac"]) {
		const path = resolveUploadFilePath(`/uploads/${voiceSampleFilename(provider, voiceId, ext)}`);
		if (path && existsSync(path)) return true;
	}
	return false;
}

interface ProviderResult {
	provider: TtsProviderId;
	/** Why it was skipped, so the summary does not report an unselected provider
	 *  as an unconfigured one — that reads as a setup problem that is not there. */
	skipped: "" | "not selected" | "not configured";
	abandoned: boolean;
	baked: number;
	reused: number;
	failures: Array<{ voice: string; error: string }>;
}

async function bakeProvider(plan: ProviderPlan): Promise<ProviderResult> {
	const result: ProviderResult = {
		provider: plan.provider,
		skipped: "",
		abandoned: false,
		baked: 0,
		reused: 0,
		failures: [],
	};

	if (onlyProvider && onlyProvider !== plan.provider) {
		result.skipped = "not selected";
		console.log(`- ${plan.provider}: not selected — skipping`);
		return result;
	}

	if (!(await plan.configured())) {
		result.skipped = "not configured";
		console.log(`- ${plan.provider}: not configured — skipping`);
		return result;
	}

	await mkdir(UPLOADS_DIR, { recursive: true });
	console.log(`- ${plan.provider}: ${plan.voices.length} voices`);

	let consecutiveFailures = 0;
	for (const voice of plan.voices) {
		if (!force && alreadyBaked(plan.provider, voice.id)) {
			result.reused += 1;
			continue;
		}
		try {
			/* The sample text follows the VOICE's language, not the provider's or the
			 * operator's. Kokoro's non-English voices are language-locked, so an
			 * English sentence read by a Japanese voice is not an audition of it. */
			const text = sampleTextForLanguage(voice.lang);
			const { bytes, ext } = await synthesizeTts({
				text,
				voice: voice.id,
				provider: plan.provider,
			});
			const name = voiceSampleFilename(plan.provider, voice.id, ext);
			await Bun.write(`${UPLOADS_DIR}/${name}`, bytes);
			result.baked += 1;
			consecutiveFailures = 0;
			console.log(`  baked ${plan.provider}/${voice.id} (${voice.name}) -> ${name}`);
		} catch (err) {
			// One flaky voice must not block a deploy — record it and keep going.
			// An unbaked voice is still listed and selectable, just not auditionable.
			const message = err instanceof Error ? err.message : String(err);
			result.failures.push({ voice: voice.id, error: message });
			consecutiveFailures += 1;
			console.error(`  FAILED ${plan.provider}/${voice.id}: ${message}`);
			if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
				result.abandoned = true;
				console.error(
					`  ${plan.provider}: ${consecutiveFailures} failures in a row — abandoning this provider`,
				);
				break;
			}
		}
	}
	return result;
}

async function main(): Promise<void> {
	console.log(`Baking voice samples (${SAMPLE_TEXT_VERSION})${force ? " [--force]" : ""}`);
	console.log("Sample text is per language; each voice speaks its own.\n");

	const all = plans();
	/* Checked against the registry rather than a list here, so a typo names the
	 * providers that exist instead of silently baking nothing. */
	if (onlyProvider && !all.some((plan) => plan.provider === onlyProvider)) {
		console.error(
			`Unknown provider "${onlyProvider}". Registered: ${all.map((p) => p.provider).join(", ")}`,
		);
		process.exit(1);
	}

	const results: ProviderResult[] = [];
	for (const plan of all) results.push(await bakeProvider(plan));

	console.log("\nSummary:");
	let fatal = false;
	for (const r of results) {
		if (r.skipped) {
			console.log(`  ${r.provider}: skipped (${r.skipped})`);
			continue;
		}
		const abandoned = r.abandoned ? " (abandoned early)" : "";
		console.log(
			`  ${r.provider}: ${r.baked} baked, ${r.reused} already present, ${r.failures.length} failed${abandoned}`,
		);
		// Configured but produced nothing usable — that is a real problem worth
		// stopping a pipeline for. Partial success is not.
		if (r.baked === 0 && r.reused === 0) fatal = true;
	}

	if (fatal) {
		console.error("\nA configured provider produced no samples at all.");
		process.exit(1);
	}
	console.log("\nDone. Voices without a sample stay selectable, just without a preview.");
}

await main();
