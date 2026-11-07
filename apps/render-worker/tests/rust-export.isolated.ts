/* The worker's Rust export path end to end (OpenSpec p2-export task 3.4).
 *
 * Each test runs `tick()` on a queued storyboard job with
 * `MALEO_EXPORT_RENDERER=rust`, local media storage and a scratch working
 * directory. The host is the fake `tests/fixtures/fake-render-host.ts` (same
 * protocol and exit codes), and the real `maleo-render` when it is built
 * (`cargo build -p maleo-render-host`).
 *
 * Not a `.bun.test` file: `db.ts` opens its database when first imported, and
 * Bun runs every `.bun.test` file in one process, where another suite owns and
 * removes that database. `test:bun` runs this file in its own process. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// realpath: macOS tmpdir is a symlink, and the worker resolves paths through it.
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "maleo-rust-export-")));
const BASE = "http://127.0.0.1:9/public";
const FAKE = resolve(import.meta.dir, "fixtures", "fake-render-host.ts");
const REAL = resolve(import.meta.dir, "..", "..", "..", "target", "debug", "maleo-render");
const prior = process.cwd();
process.env.MALEO_VIDEO_DB = join(ROOT, "jobs.db");
process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
process.env.MALEO_DATA_DIR = join(ROOT, "data");
process.env.MALEO_VIDEO_PUBLIC_BASE = BASE;
process.env.MALEO_EXPORT_RENDERER = "rust";
// Shadow runs are on per test below; elsewhere a finished job would queue one.
process.env.MALEO_EXPORT_SHADOW = "off";
process.chdir(ROOT);

const {
	insertJob,
	insertShadowJob,
	getJob,
	getVisibleJob,
	cancelJob,
	countJobs,
	listJobs,
	jobOwners,
	db,
} = await import("../src/db");
const { tick } = await import("../src/worker");
const { listComparisons } = await import("../src/comparisons-db");
const { chooseRenderer } = await import("../src/rust-export");

mkdirSync(join(ROOT, "public", "test"), { recursive: true });
execFileSync("ffmpeg", [
	"-v",
	"error",
	"-y",
	"-f",
	"lavfi",
	"-i",
	"color=c=red:s=64x64:d=1",
	"-frames:v",
	"1",
	join(ROOT, "public", "test", "a.png"),
]);
execFileSync("ffmpeg", [
	"-v",
	"error",
	"-y",
	"-f",
	"lavfi",
	"-i",
	"anullsrc=r=48000:cl=stereo",
	"-t",
	"1",
	join(ROOT, "public", "test", "vo.wav"),
]);
const OUTPUT = join(ROOT, "fixture.mp4");
execFileSync("ffmpeg", [
	"-v",
	"error",
	"-y",
	"-f",
	"lavfi",
	"-i",
	"color=c=blue:s=108x192:d=1:r=30",
	"-pix_fmt",
	"yuv420p",
	OUTPUT,
]);

const RECORD = join(ROOT, "host-job.json");
const storyboard = {
	scenes: [{ image: `${BASE}/test/a.png`, durationSec: 1 }],
	voiceover: { text: "hello", audioUrl: `${BASE}/test/vo.wav`, startSec: 0, endSec: 1 },
};

function queue(over: { maxAttempts?: number; storyboard?: unknown } = {}) {
	return insertJob({
		id: crypto.randomUUID(),
		productJson: JSON.stringify(over.storyboard ?? storyboard),
		preset: "storyboard-tiktok",
		backend: "local",
		workspace: "rust-test",
		projectId: "project-1",
		maxAttempts: over.maxAttempts ?? 3,
	});
}

beforeEach(() => {
	for (const key of Object.keys(process.env))
		if (key.startsWith("FAKE_HOST_")) delete process.env[key];
	process.env.MALEO_RENDER_HOST = FAKE;
	process.env.FAKE_HOST_OUTPUT = OUTPUT;
	process.env.FAKE_HOST_RECORD = RECORD;
	process.env.FAKE_HOST_MEDIA = JSON.stringify([`${BASE}/test/a.png`, `${BASE}/test/vo.wav`]);
	rmSync(RECORD, { force: true });
});

afterAll(() => {
	process.chdir(prior);
	rmSync(ROOT, { recursive: true, force: true });
});

describe("Rust export in the render worker", () => {
	test("a Rust job completes, stores its output and poster, and names the rust renderer", async () => {
		const job = queue();
		expect(await tick("t-ok")).toBe(true);
		const done = getJob(job.id)!;
		expect(done.status).toBe("done");
		expect(done.renderer).toBe("rust");
		expect(done.renderer_note).toBeNull();
		expect(done.progress).toBe(1);
		expect(JSON.parse(done.output_storage!).key).toContain("video");
		expect(done.thumbnail_storage).not.toBeNull();
		// The host got local files for both media URLs, and the composition's size and length.
		const sent = JSON.parse(readFileSync(RECORD, "utf8"));
		expect(sent.media[`${BASE}/test/a.png`]).toBe(join(ROOT, "public", "test", "a.png"));
		expect(sent.media[`${BASE}/test/vo.wav`]).toBe(join(ROOT, "public", "test", "vo.wav"));
		expect([sent.width, sent.height, sent.fps, sent.frames]).toEqual([1080, 1920, 30, 30]);
		expect(existsSync(join(ROOT, "out", `${job.id}.host.json`))).toBe(false);
	});

	test("a host failure fails the job with the stage", async () => {
		process.env.FAKE_HOST_MODE = "fail";
		const job = queue({ maxAttempts: 1 });
		await tick("t-fail");
		const failed = getJob(job.id)!;
		expect(failed.status).toBe("error");
		expect(failed.error).toBe("render host failed at encode: encoder stopped reading");
		expect(failed.output_storage).toBeNull();
	});

	test("a coverage refusal fails the job without another attempt", async () => {
		process.env.FAKE_HOST_MODE = "refuse";
		const job = queue({ maxAttempts: 3 });
		await tick("t-refuse");
		const refused = getJob(job.id)!;
		expect(refused.status).toBe("error");
		expect(refused.attempts).toBe(1);
		expect(refused.error).toContain("`lower-third` preset");
	});

	test("cancelling a running Rust job stops the host and stores nothing", async () => {
		process.env.FAKE_HOST_MODE = "slow";
		const job = queue();
		const running = tick("t-cancel");
		for (let i = 0; i < 200 && !getJob(job.id)?.phase_detail?.startsWith("rust: frame"); i++)
			await Bun.sleep(25);
		expect(getJob(job.id)?.phase_detail).toStartWith("rust: frame");
		const asked = Date.now();
		cancelJob(job.id);
		await running;
		expect(Date.now() - asked).toBeLessThan(5_000);
		const cancelled = getJob(job.id)!;
		expect(cancelled.status).toBe("cancelled");
		expect(cancelled.output_storage).toBeNull();
	});

	test("a managed input whose bytes fail the registry SHA-256 fails the job before the host runs", async () => {
		const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
		const api = Bun.serve({
			port: 0,
			fetch: () =>
				new Response(new Uint8Array([1, 2, 3]), {
					headers: { "content-type": "image/png", "x-maleo-sha256": "f".repeat(64) },
				}),
		});
		process.env.MALEO_API_URL = `http://127.0.0.1:${api.port}`;
		process.env.MALEO_SERVICE_TOKEN = "service";
		try {
			const job = queue({
				maxAttempts: 1,
				storyboard: { ...storyboard, scenes: [{ image: `/api/media/${id}`, durationSec: 1 }] },
			});
			await tick("t-hash");
			const failed = getJob(job.id)!;
			expect(failed.status).toBe("error");
			expect(failed.error).toContain(`managed render input ${id} failed its SHA-256 check`);
			expect(existsSync(RECORD)).toBe(false);
		} finally {
			void api.stop(true);
		}
	});

	const real = existsSync(REAL) ? test : test.skip;
	real(
		"the real host renders a stored MP4 through the same job",
		async () => {
			process.env.MALEO_RENDER_HOST = REAL;
			process.env.MALEO_RENDER_H264_ENCODER = (() => {
				try {
					return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], {
						encoding: "utf8",
					}).includes("libopenh264")
						? "libopenh264"
						: "libx264";
				} catch {
					return "libx264";
				}
			})();
			const job = queue({ maxAttempts: 1 });
			await tick("t-real");
			const done = getJob(job.id)!;
			expect(done.error).toBeNull();
			expect(done.status).toBe("done");
			expect(done.renderer).toBe("rust");
			expect(done.thumbnail_storage).not.toBeNull();
		},
		300_000,
	);
});

describe("chooseRenderer", () => {
	const command = [FAKE];
	const input = {
		jobId: "j",
		compositionId: "StoryboardReel",
		storyboard: storyboard as never,
		backend: "local" as const,
		workDir: ROOT,
	};

	test("authority, preset, backend and coverage decide, and the job says why", async () => {
		process.env.MALEO_EXPORT_RENDERER = "remotion";
		expect(await chooseRenderer({ ...input, run: { command } })).toEqual({
			renderer: "remotion",
			note: null,
		});
		process.env.MALEO_EXPORT_RENDERER = "rust";
		expect(await chooseRenderer({ ...input, run: { command } })).toEqual({
			renderer: "rust",
			note: null,
		});
		expect((await chooseRenderer({ ...input, backend: "lambda", run: { command } })).note).toBe(
			"Lambda renders through Remotion",
		);
		expect((await chooseRenderer({ ...input, storyboard: null, run: { command } })).note).toBe(
			"Product presets render through Remotion",
		);
		process.env.FAKE_HOST_COVERAGE = JSON.stringify([
			{ frame: 45, path: "textOverlays[0]", reason: "`lower-third` preset" },
		]);
		expect(await chooseRenderer({ ...input, run: { command } })).toEqual({
			renderer: "remotion",
			note: "Rust renderer does not cover frame 45: textOverlays[0] `lower-third` preset",
		});
		const missing = await chooseRenderer({ ...input, run: { command: ["/no/such/maleo-render"] } });
		expect(missing.renderer).toBe("remotion");
		expect(missing.note).toStartWith("Rust render host unavailable");
	});
});

describe("shadow jobs (p2-export E6)", () => {
	const shadowsOf = (id: string) =>
		db.query<{ id: string }, [string]>("SELECT id FROM render_jobs WHERE shadow_of = ?").all(id);
	const reference = (shadowId: string) => join(ROOT, "out", "shadow", `${shadowId}.reference.mp4`);

	const comparisonOf = (shadowId: string) =>
		listComparisons().find((row) => row.shadow_job_id === shadowId);
	const realHost = existsSync(REAL) ? test : test.skip;

	beforeEach(() => {
		process.env.MALEO_EXPORT_SHADOW = "on";
		process.env.FAKE_HOST_REAL = REAL;
		process.env.MALEO_EXPORT_RENDERER = "rust";
		// Nothing from an earlier test may be waiting in the queue.
		db.run("DELETE FROM render_jobs WHERE status = 'queued'");
	});
	afterAll(() => {
		process.env.MALEO_EXPORT_SHADOW = "off";
	});

	/** A finished authoritative job and a queued Rust shadow with its reference file. */
	function rustShadow(over: { storyboard?: unknown } = {}) {
		const owner = queue();
		db.run(
			"UPDATE render_jobs SET status = 'done', phase = 'done', renderer = 'remotion' WHERE id = ?",
			[owner.id],
		);
		const shadow = insertShadowJob(
			getJob(owner.id)!,
			"rust",
			JSON.stringify(over.storyboard ?? storyboard),
		);
		mkdirSync(join(ROOT, "out", "shadow"), { recursive: true });
		copyFileSync(OUTPUT, reference(shadow.id));
		return { owner: getJob(owner.id)!, shadow };
	}

	test("a finished job queues one shadow on the other renderer with its prepared input and output", async () => {
		const job = queue();
		await tick("t-shadow-make");
		const done = getJob(job.id)!;
		expect(done.status).toBe("done");
		const rows = shadowsOf(job.id);
		expect(rows).toHaveLength(1);
		const shadow = getJob(rows[0]!.id)!;
		expect([shadow.status, shadow.renderer, shadow.backend, shadow.max_attempts]).toEqual([
			"queued",
			"remotion",
			"local",
			1,
		]);
		expect(JSON.parse(shadow.product_json)).toMatchObject(storyboard);
		expect(existsSync(reference(shadow.id))).toBe(true);
		expect(existsSync(join(ROOT, "out", `${job.id}.storyboard-tiktok.mp4`))).toBe(false);
	});

	test("MALEO_EXPORT_SHADOW=off queues no shadow", async () => {
		process.env.MALEO_EXPORT_SHADOW = "off";
		const job = queue();
		await tick("t-shadow-off");
		expect(getJob(job.id)!.status).toBe("done");
		expect(shadowsOf(job.id)).toHaveLength(0);
	});

	test("shadow rows never appear in operator-facing queries", () => {
		const { owner, shadow } = rustShadow();
		const filters = { workspace: "rust-test", projectIds: ["project-1"] };
		const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
		expect(ids(listJobs(500, 0))).toContain(owner.id);
		expect(ids(listJobs(500, 0))).not.toContain(shadow.id);
		expect(ids(listJobs(500, 0, filters))).not.toContain(shadow.id);
		expect(countJobs(filters)).toBe(listJobs(500, 0, filters).length);
		expect(countJobs()).toBe(listJobs(500, 0).length);
		expect(
			jobOwners({ workspace: "rust-test", legacyJobIds: [shadow.id] }).legacy_job_ids,
		).not.toContain(shadow.id);
		expect(getVisibleJob(shadow.id)).toBeNull();
		expect(getVisibleJob(owner.id)?.id).toBe(owner.id);
	});

	test("an authoritative job leases before an older shadow job", async () => {
		const { shadow } = rustShadow();
		const later = queue();
		await tick("t-order");
		expect(getJob(later.id)!.status).toBe("done");
		expect(getJob(shadow.id)!.status).toBe("queued");
		await tick("t-order");
		expect(getJob(shadow.id)!.status).toBe("done");
	});

	realHost(
		"a Rust shadow renders to out/shadow, stores nothing, and its comparison passes",
		async () => {
			const { owner, shadow } = rustShadow();
			await tick("t-shadow-run");
			const ran = getJob(shadow.id)!;
			expect(ran.status).toBe("done");
			expect(ran.output_path).toBe(join(ROOT, "out", "shadow", `${shadow.id}.mp4`));
			expect(ran.output_storage).toBeNull();
			expect(ran.thumbnail_storage).toBeNull();
			expect(getJob(owner.id)).toEqual(owner);
			expect(shadowsOf(shadow.id)).toHaveLength(0);
			const row = comparisonOf(shadow.id)!;
			expect(JSON.parse(row.failures)).toEqual([]);
			expect([
				row.status,
				row.job_id,
				row.authority,
				row.shadow_renderer,
				row.config_version,
			]).toEqual(["passed", owner.id, "remotion", "rust", 1]);
			expect(row.artifacts).toBeNull();
			// The comparison removes both MP4s.
			expect(existsSync(ran.output_path!)).toBe(false);
			expect(existsSync(reference(shadow.id))).toBe(false);
		},
	);

	test("a shadow failure leaves the authoritative job unchanged and is not retried", async () => {
		process.env.FAKE_HOST_MODE = "fail";
		const { owner, shadow } = rustShadow();
		await tick("t-shadow-fail");
		const failed = getJob(shadow.id)!;
		expect([failed.status, failed.attempts]).toEqual(["error", 1]);
		expect(failed.error).toContain("encoder stopped reading");
		expect(getJob(owner.id)).toEqual(owner);
		expect(existsSync(reference(shadow.id))).toBe(false);
		const row = comparisonOf(shadow.id)!;
		expect(row.status).toBe("failed");
		expect(JSON.parse(row.failures)[0]).toStartWith(
			"shadow render failed: render host failed at encode",
		);
	});

	test("an ineligible shadow records its reason and does not render", async () => {
		process.env.FAKE_HOST_COVERAGE = JSON.stringify([
			{ frame: 12, path: "textOverlays[0]", reason: "`lower-third` preset" },
		]);
		const { owner, shadow } = rustShadow();
		await tick("t-shadow-ineligible");
		const skipped = getJob(shadow.id)!;
		expect([skipped.status, skipped.error_code]).toEqual(["error", "INELIGIBLE"]);
		expect(skipped.renderer_note).toBe(
			"Rust renderer does not cover frame 12: textOverlays[0] `lower-third` preset",
		);
		expect(existsSync(RECORD)).toBe(false);
		expect(existsSync(reference(shadow.id))).toBe(false);
		expect(getJob(owner.id)).toEqual(owner);
		const row = comparisonOf(shadow.id)!;
		expect([row.status, row.summary]).toEqual([
			"ineligible",
			"Rust renderer does not cover frame 12: textOverlays[0] `lower-third` preset",
		]);
	});
});
