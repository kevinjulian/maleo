import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { getRenderProgress, renderMediaOnLambda } from "@remotion/lambda/client";
import { downloadMedia, getRegions } from "@remotion/lambda";
import { productSchema, storyboardSchema } from "@maleo/video/schema";
import { PRESETS } from "@maleo/video/lib/presets";
import { prepareStoryboard } from "@maleo/video/lib/prepare-storyboard";
import { assertRenderStoryboard } from "@maleo/video/lib/validate-storyboard";
import { classifyRenderError } from "@maleo/video/lib/error-codes";
import { getJob, leaseNext, reclaimStale, setPhase, updateJob } from "./db";
import { publishExportPoster } from "./export-poster";
import { putMedia } from "@maleo/storage";
import { materializeManagedInputs } from "./managed-inputs";
import { VIDEO_ENTRY, VIDEO_ROOT } from "@maleo/video/paths";

let cachedServeUrl: string | null = null;
let bundling: Promise<string> | null = null;

// Bundle the Remotion site once and cache it. Concurrent callers share the same
// in-flight bundle promise so a burst of jobs doesn't trigger N bundles.
async function getServeUrl(): Promise<string> {
	if (cachedServeUrl) return cachedServeUrl;
	if (!bundling) {
		console.log("[worker] bundling Remotion site…");
		bundling = bundle({
			entryPoint: VIDEO_ENTRY,
			rootDir: VIDEO_ROOT,
			publicDir: path.resolve("public"),
		}).then((url) => {
			cachedServeUrl = url;
			bundling = null;
			return url;
		});
	}
	return bundling;
}

// Warm the bundle at boot so the first real job doesn't eat the ~30s bundle cost
// and any bundle error surfaces immediately instead of on first render.
export async function warmBundle(): Promise<void> {
	try {
		await getServeUrl();
		console.log("[worker] bundle warm");
	} catch (err) {
		console.error(
			`[worker] warm bundle failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

// Remotion Lambda config — the function + serve url come from deploy-lambda.ts.
// Both present = lambda renders are available; a lambda job without them falls
// back to the local path (recorded on the job) instead of failing.
type LambdaRegion = Parameters<typeof renderMediaOnLambda>[0]["region"];
function lambdaConfig(): { region: LambdaRegion; functionName: string; serveUrl: string } | null {
	const functionName = process.env.REMOTION_LAMBDA_FUNCTION;
	const serveUrl = process.env.REMOTION_LAMBDA_SERVE_URL;
	if (!functionName || !serveUrl) return null;
	const configured = process.env.REMOTION_AWS_REGION ?? "us-east-1";
	const region = getRegions().find((candidate) => candidate === configured);
	if (!region) {
		console.error(
			`[worker] REMOTION_AWS_REGION ${configured} is not a Lambda region; rendering locally`,
		);
		return null;
	}
	return {
		region,
		functionName,
		serveUrl,
	};
}

// Render on Remotion Lambda and download the finished file to outPath. Progress
// and estimated cost stream onto the job row while the cloud render runs.
async function renderOnLambda(
	jobId: string,
	preset: (typeof PRESETS)[string],
	props: Parameters<typeof renderMediaOnLambda>[0]["inputProps"],
	outPath: string,
	cfg: NonNullable<ReturnType<typeof lambdaConfig>>,
): Promise<void> {
	setPhase(jobId, "rendering", "lambda: starting");
	const { renderId, bucketName } = await renderMediaOnLambda({
		region: cfg.region,
		functionName: cfg.functionName,
		serveUrl: cfg.serveUrl,
		composition: preset.compositionId,
		inputProps: props,
		codec: preset.codec,
		privacy: "private",
		videoBitrate: preset.videoBitrate,
		audioBitrate: preset.audioBitrate,
		pixelFormat: preset.pixelFormat,
	});
	for (;;) {
		assertNotCancelled(jobId);
		const progress = await getRenderProgress({
			renderId,
			bucketName,
			functionName: cfg.functionName,
			region: cfg.region,
		});
		if (progress.fatalErrorEncountered) {
			throw new Error(
				`lambda render failed: ${progress.errors
					.map((e) => e.message)
					.join("; ")
					.slice(0, 300)}`,
			);
		}
		updateJob(jobId, { progress: progress.overallProgress, cost_usd: progress.costs.accruedSoFar });
		setPhase(jobId, "rendering", `lambda: ${Math.round(progress.overallProgress * 100)}%`);
		if (progress.done) break;
		await new Promise((r) => setTimeout(r, 3000));
	}
	setPhase(jobId, "finalizing", "lambda: downloading");
	await downloadMedia({ renderId, bucketName, region: cfg.region, outPath });
}

// True if the job was cancelled out from under us while a phase ran.
function isCancelled(jobId: string): boolean {
	return getJob(jobId)?.status === "cancelled";
}

class CancelledError extends Error {
	constructor() {
		super("cancelled");
		this.name = "CancelledError";
	}
}

function assertNotCancelled(jobId: string): void {
	if (isCancelled(jobId)) throw new CancelledError();
}

async function runJob(
	jobId: string,
	productJsonStr: string,
	presetId: string,
	backend: "local" | "lambda" = "local",
): Promise<void> {
	const preset = PRESETS[presetId];
	if (!preset) throw new Error(`unknown preset: ${presetId}`);
	const owner = getJob(jobId);
	const workspace = owner?.workspace;
	if (!workspace) throw new Error("render job has no owning workspace");
	const project = owner.project_id;

	setPhase(jobId, "validating");
	const isStoryboard = presetId.startsWith("storyboard-");
	let props = isStoryboard
		? storyboardSchema.parse(JSON.parse(productJsonStr))
		: productSchema.parse(JSON.parse(productJsonStr));
	const managed = await materializeManagedInputs(props, workspace);
	props = managed.value;
	try {
		const outDir = path.resolve("out");
		await fs.mkdir(outDir, { recursive: true });
		let audioFallback = false;
		let placeholderImages = 0;
		let manifestPath: string | null = null;

		// Auto-prep storyboards that arrive raw (no voiceover audio yet): prep/reuse
		// images, synthesize TTS, and align scene durations + captions to the audio.
		const sourceStoryboard = "scenes" in props ? props : null;
		if (sourceStoryboard && !sourceStoryboard.voiceover?.audioUrl) {
			setPhase(jobId, "preparing_images");
			const aspect =
				preset.compositionId === "StoryboardWide"
					? "horizontal"
					: preset.compositionId === "StoryboardSquare"
						? "square"
						: "vertical";
			const targetDurationSec = sourceStoryboard.targetDurationSec;
			assertNotCancelled(jobId);
			// Map prep stages onto job phases with a human detail (e.g. "image 3/10"),
			// so the dashboard shows live progress instead of a frozen phase label.
			const retryPlaceholders = (getJob(jobId)?.retry_images ?? 0) > 0;
			const prepared = await prepareStoryboard(sourceStoryboard, {
				aspect,
				targetDurationSec,
				retryPlaceholders,
				onProgress: (p) => {
					if (p.stage === "preparing_images") {
						if (p.items) updateJob(jobId, { image_status: JSON.stringify(p.items) });
						setPhase(jobId, "preparing_images", p.detail ? `image ${p.detail}` : undefined);
					} else if (p.stage === "synthesizing_audio") {
						setPhase(jobId, "synthesizing_audio");
					} else {
						setPhase(jobId, "synthesizing_audio", "aligning captions");
					}
				},
			});
			props = prepared.storyboard;
			audioFallback = prepared.audioStatus === "fallback_silent";
			placeholderImages = prepared.placeholderImages;

			// Persist a prep manifest so a render can be inspected / replayed without
			// re-running TTS + image gen. Recorded on the job as manifest_path.
			manifestPath = path.join(outDir, `${jobId}.manifest.json`);
			await fs.writeFile(
				manifestPath,
				JSON.stringify(
					{
						jobId,
						preset: presetId,
						audioStatus: prepared.audioStatus,
						uniqueImages: prepared.uniqueImages,
						generatedImages: prepared.generatedImages,
						placeholderImages: prepared.placeholderImages,
						reusedScenes: prepared.reusedScenes,
						totalDurationSec: prepared.totalDurationSec,
						sourceStoryboard: JSON.parse(productJsonStr),
					},
					null,
					2,
				),
			);
			// Clear the one-shot retry-images flag now that this run consumed it.
			updateJob(jobId, {
				manifest_path: manifestPath,
				duration_sec: prepared.totalDurationSec,
				retry_images: 0,
			});
			console.log(
				`[worker] prepped ${jobId}: ${prepared.uniqueImages} img (${prepared.generatedImages} gen), ${prepared.reusedScenes} reused, audio=${prepared.audioStatus}, ${prepared.totalDurationSec.toFixed(1)}s`,
			);
		}

		assertNotCancelled(jobId);
		if ("scenes" in props) assertRenderStoryboard(props);
		const outPath = path.join(outDir, `${jobId}.${presetId}.mp4`);

		// Lambda backend: cloud render + download (no local bundle needed). Missing
		// lambda config degrades to the local path and says so on the job.
		let lambdaFellBack = false;
		const lambda = backend === "lambda" ? lambdaConfig() : null;
		if (backend === "lambda" && lambda) {
			await renderOnLambda(jobId, preset, props, outPath, lambda);
		} else {
			if (backend === "lambda") {
				lambdaFellBack = true;
				console.warn(
					`[worker] ${jobId}: lambda requested but REMOTION_LAMBDA_FUNCTION/SERVE_URL unset — rendering locally`,
				);
				updateJob(jobId, { backend: "local" });
			}
			setPhase(jobId, "bundling");
			const serveUrl = await getServeUrl();
			const composition = await selectComposition({
				serveUrl,
				id: preset.compositionId,
				inputProps: props,
			});

			assertNotCancelled(jobId);
			setPhase(jobId, "rendering");
			await renderMedia({
				composition,
				serveUrl,
				// Bound frame workers; auto-detection can produce NaN in Bun containers.
				concurrency: 1,
				codec: preset.codec,
				outputLocation: outPath,
				inputProps: props,
				videoBitrate: preset.videoBitrate,
				audioBitrate: preset.audioBitrate,
				pixelFormat: preset.pixelFormat,
				onProgress: ({ progress }) => {
					updateJob(jobId, { progress });
					setPhase(jobId, "rendering", `${Math.round(progress * 100)}%`);
				},
			});
		}

		setPhase(jobId, "finalizing");
		// Degraded but shipped: surface every fallback so the user isn't blindsided by
		// a silent video or placeholder art. Any degradation marks done_with_fallback.
		const notes: string[] = [];
		if (lambdaFellBack) notes.push("lambda not configured — rendered locally");
		if (audioFallback) notes.push("rendered silent (TTS unavailable)");
		if (placeholderImages > 0) {
			notes.push(
				`${placeholderImages} frame${placeholderImages === 1 ? "" : "s"} used placeholder art`,
			);
		}
		const degraded = notes.length > 0;
		const output = await putMedia({
			workspace,
			project,
			kind: "video",
			body: Bun.file(outPath),
			contentType: "video/mp4",
			filename: `render-${jobId}.mp4`,
		});
		const thumbnail = await publishExportPoster({ path: outPath, workspace, project, jobId });
		const manifest = manifestPath
			? await putMedia({
					workspace,
					project,
					kind: "manifest",
					body: Bun.file(manifestPath),
					contentType: "application/json",
					filename: `render-${jobId}.json`,
				})
			: null;
		updateJob(jobId, {
			status: degraded ? "done_with_fallback" : "done",
			phase: "done",
			phase_detail: degraded ? notes.join("; ") : null,
			output_path: null,
			output_storage: JSON.stringify(output),
			thumbnail_storage: thumbnail ? JSON.stringify(thumbnail) : null,
			manifest_path: null,
			manifest_storage: manifest ? JSON.stringify(manifest) : null,
			progress: 1,
			finished_at: Date.now(),
		});
		// Delivery already succeeded. A cleanup failure must not requeue the render.
		await fs
			.rm(outPath, { force: true })
			.catch((error) => console.warn(`[worker] cleanup failed for ${jobId}: ${error}`));
		if (manifestPath)
			await fs
				.rm(manifestPath, { force: true })
				.catch((error) => console.warn(`[worker] manifest cleanup failed for ${jobId}: ${error}`));
	} finally {
		await managed.cleanup();
	}
}

const WORKER_ID = process.env.MALEO_VIDEO_WORKER_ID ?? `w-${crypto.randomUUID().slice(0, 8)}`;

// Lease + run one queued job for this worker slot. Returns true if it ran one.
export async function tick(workerId = WORKER_ID): Promise<boolean> {
	const job = leaseNext(workerId);
	if (!job) return false;
	try {
		console.log(
			`[worker:${workerId}] start ${job.id} (${job.preset}, ${job.backend}) attempt ${job.attempts}`,
		);
		await runJob(job.id, job.product_json, job.preset, job.backend);
		console.log(`[worker:${workerId}] done ${job.id}`);
	} catch (err) {
		if (err instanceof CancelledError) {
			console.log(`[worker:${workerId}] cancelled ${job.id}`);
			return true;
		}
		const msg = err instanceof Error ? err.message : String(err);
		const classified = classifyRenderError(msg);
		const fresh = getJob(job.id);
		const attempts = fresh?.attempts ?? job.attempts;
		const max = fresh?.max_attempts ?? job.max_attempts;
		if (attempts < max) {
			// Re-queue for another attempt (transient failures recover on retry).
			console.warn(
				`[worker:${workerId}] error ${job.id} (attempt ${attempts}/${max}) [${classified.code}], requeueing: ${msg}`,
			);
			updateJob(job.id, {
				status: "queued",
				phase: "queued",
				phase_detail: null,
				error: msg.slice(0, 500),
				error_code: classified.code,
				progress: 0,
				worker_id: null,
				leased_at: null,
			});
		} else {
			console.error(
				`[worker:${workerId}] error ${job.id} (exhausted ${attempts}/${max}) [${classified.code}]: ${msg}`,
			);
			updateJob(job.id, {
				status: "error",
				phase: "failed",
				error: msg.slice(0, 500),
				error_code: classified.code,
				finished_at: Date.now(),
			});
		}
	}
	return true;
}

// Spawn `concurrency` independent worker loops. Each leases its own job, so up
// to N renders run at once (default 1 — rendering is CPU-heavy, raise with care).
export function startWorker(intervalMs = 2000): void {
	const concurrency = Math.max(1, parseInt(process.env.MALEO_VIDEO_CONCURRENCY ?? "1", 10) || 1);
	const staleMs = parseInt(process.env.MALEO_VIDEO_LEASE_STALE_MS ?? "600000", 10) || 600_000;

	// Reclaim jobs stranded by a previous crashed process before accepting work.
	const reclaimed = reclaimStale(staleMs);
	if (reclaimed > 0) console.log(`[worker] reclaimed ${reclaimed} stale job(s)`);

	console.log(`[worker] started (concurrency=${concurrency})`);
	for (let i = 0; i < concurrency; i++) {
		const workerId = `${WORKER_ID}-${i}`;
		const loop = async () => {
			try {
				const did = await tick(workerId);
				setTimeout(() => void loop(), did ? 100 : intervalMs);
			} catch (err) {
				console.error(`[worker:${workerId}] loop error`, err);
				setTimeout(() => void loop(), intervalMs);
			}
		};
		void loop();
	}

	// Periodic reclaim of stale leases (covers a worker that dies mid-run while
	// the process stays up via another slot).
	setInterval(
		() => {
			try {
				reclaimStale(staleMs);
			} catch (err) {
				console.error("[worker] reclaim error", err);
			}
		},
		Math.max(30_000, Math.floor(staleMs / 4)),
	);
}
