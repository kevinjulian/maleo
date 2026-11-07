import { Hono } from "hono";
import { cors } from "hono/cors";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSchema, storyboardSchema } from "@maleo/video/schema";
import { PRESETS, describePreset } from "@maleo/video/lib/presets";
import { bearerAuth, getToken } from "./auth";
import {
	cancelJob,
	countJobs,
	jobOwners,
	findRecentByHash,
	getVisibleJob,
	insertJob,
	listJobs,
	pruneJobs,
	requeueJob,
	updateJob,
} from "./db";
import { startWorker, warmBundle } from "./worker";
import { comparisonRoutes } from "./comparison-routes";
import { z } from "zod";
import { assertMediaStorageConfigured, verifyMediaStorageReady } from "@maleo/storage";

/* The render request as this server reads it. `product` and `storyboard` stay
 * `unknown`: they are documents the caller assembled from types this package
 * cannot import — see `src/exports.ts` — and describing them here would be a
 * claim nothing checks. Everything else is named. */
const renderRequestBody = z
	.object({
		product: z.unknown(),
		storyboard: z.unknown(),
		preset: z.string(),
		backend: z.enum(["local", "lambda"]),
		draft_id: z.string(),
		workspace: z.string(),
		project_id: z.string(),
		preset_source: z.string(),
	})
	.partial()
	.extend({ workspace: z.string().min(1), project_id: z.string().min(1) });

const PORT = parseInt(process.env.MALEO_VIDEO_PORT ?? "8091", 10) || 8091;
// The render worker needs generated assets (placeholder images, voiceover WAVs)
// reachable by URL: Remotion's bundle only snapshots public/ at warm time, so
// runtime files must be fetched live over HTTP. Default the base to this server
// so prepare-storyboard can absolutize local asset paths (see toAssetUrl there).
process.env.MALEO_VIDEO_PUBLIC_BASE ??= `http://localhost:${PORT}/public`;
const CORS_ORIGINS = (process.env.MALEO_VIDEO_CORS_ORIGINS ?? "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const DEDUPE_WINDOW_MS =
	parseInt(process.env.MALEO_VIDEO_DEDUPE_WINDOW_MS ?? "120000", 10) || 120_000;
const JOB_RETENTION = Math.max(
	0,
	parseInt(process.env.MALEO_VIDEO_JOB_RETENTION ?? "5000", 10) || 5000,
);

try {
	getToken();
	assertMediaStorageConfigured();
	await verifyMediaStorageReady();
} catch (err) {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
}

const app = new Hono();

if (CORS_ORIGINS.length > 0) {
	app.use(
		"*",
		cors({
			origin: (o) => (CORS_ORIGINS.includes(o) ? o : null),
			credentials: true,
		}),
	);
}

// Dependency-aware health: reports each dependency the render pipeline needs so
// an operator (or a load balancer) sees *what* is broken, not just "down". 200
// when nothing critical is broken, 503 otherwise. /health is unauthenticated so
// probes work without the bearer token; /ready (below) requires auth.
app.get("/health", async (c) => {
	const checks = await collectHealth();
	const critical = ["out_writable", "db"] as const;
	const ok = critical.every((k) => checks[k]?.ok !== false);
	return c.json({ ok, ts: new Date().toISOString(), checks }, ok ? 200 : 503);
});

// Unauthenticated static serving of generated assets for the render worker
// (Remotion fetches voiceover/images over HTTP). Path-traversal guarded; scoped
// to the public/ dir only.
const PUBLIC_DIR = path.resolve("public");
app.get("/public/*", async (c) => {
	const rel = decodeURIComponent(c.req.path.replace(/^\/public\//, ""));
	const abs = path.resolve(PUBLIC_DIR, rel);
	// Lexical containment first (blocks ../ escapes), then resolve symlinks so a
	// link inside public/ pointing elsewhere can't leak files outside the root.
	if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + path.sep)) {
		return c.json({ error: "forbidden" }, 403);
	}
	let realRoot: string;
	let realAbs: string;
	try {
		realRoot = await fs.promises.realpath(PUBLIC_DIR);
		realAbs = await fs.promises.realpath(abs);
	} catch {
		return c.json({ error: "not_found" }, 404);
	}
	if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
		return c.json({ error: "forbidden" }, 403);
	}
	return new Response(Bun.file(realAbs));
});

app.use("*", bearerAuth);
app.route("/comparisons", comparisonRoutes());

app.get("/presets", (c) =>
	c.json({
		items: Object.values(PRESETS).map((p) => describePreset(p)),
	}),
);

app.get("/templates", (c) =>
	c.json({
		items: [
			{ id: "classic", label: "Classic (hook + bullets + CTA)" },
			{ id: "split-screen", label: "Split-screen (before/after)" },
			{ id: "before-after", label: "Before/after horizontal wipe" },
			{ id: "testimonial", label: "Testimonial quote overlay" },
		],
	}),
);

app.post("/render", async (c) => {
	const parsed = renderRequestBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_json" }, 400);
	const body = parsed.data;

	const presetId = body.preset ?? "tiktok";
	if (!PRESETS[presetId]) return c.json({ error: "unknown_preset" }, 400);

	const isStoryboard = presetId.startsWith("storyboard-");
	let propsJson: string;

	if (isStoryboard) {
		const parsed = storyboardSchema.safeParse(body.storyboard ?? body.product);
		if (!parsed.success) {
			return c.json({ error: "invalid_storyboard", issues: parsed.error.issues }, 400);
		}
		propsJson = JSON.stringify(parsed.data);
	} else {
		const parsed = productSchema.safeParse(body.product);
		if (!parsed.success) {
			return c.json({ error: "invalid_product", issues: parsed.error.issues }, 400);
		}
		propsJson = JSON.stringify(parsed.data);
	}

	// Dedupe: identical payload + preset submitted within the window returns the
	// existing job instead of queuing a duplicate render. Guards against double
	// submits from retries, refreshes, or racing clients.
	const inputHash = crypto
		.createHash("sha256")
		.update(`${body.workspace}|${body.project_id}|${presetId}|${propsJson}`)
		.digest("hex")
		.slice(0, 32);
	const existing = findRecentByHash(inputHash, presetId, DEDUPE_WINDOW_MS);
	if (existing) {
		return c.json({ ...existing, deduped: true }, 200);
	}

	const id = crypto.randomUUID();
	const job = insertJob({
		id,
		productJson: propsJson,
		preset: presetId,
		backend: body.backend ?? "local",
		inputHash,
		draftId: body.draft_id ?? null,
		workspace: body.workspace,
		projectId: body.project_id,
		presetSource: body.preset_source ?? null,
	});
	return c.json(job, 202);
});

app.get("/render/:id", (c) => {
	const j = getVisibleJob(c.req.param("id"));
	if (!j) return c.json({ error: "not_found" }, 404);
	return c.json(j);
});

// Server-side cancel: marks a queued/running job cancelled (the worker observes
// it between phases and aborts). UI cancel now reflects a real state change.
app.post("/render/:id/cancel", (c) => {
	const id = c.req.param("id");
	const j = getVisibleJob(id) ? cancelJob(id) : null;
	if (!j) return c.json({ error: "not_found" }, 404);
	return c.json(j);
});

// Server-side retry: re-queues a failed/cancelled job. `?force=1` resets the
// attempt budget so an exhausted job can run again. `?refresh_images=1` makes the
// next run re-attempt cached placeholder images (repairs degraded art).
app.post("/render/:id/retry", (c) => {
	const force = c.req.query("force") === "1" || c.req.query("force") === "true";
	const refreshImages =
		c.req.query("refresh_images") === "1" || c.req.query("refresh_images") === "true";
	const id = c.req.param("id");
	if (!getVisibleJob(id)) return c.json({ error: "not_found" }, 404);
	const j = requeueJob(id, { force });
	if (!j) return c.json({ error: "not_retryable" }, 409);
	if (refreshImages) {
		updateJob(id, { retry_images: 1 });
		return c.json(getVisibleJob(id));
	}
	return c.json(j);
});

app.get("/render/:id/file", (c) => {
	const j = getVisibleJob(c.req.param("id"));
	if (!j) return c.json({ error: "not_found" }, 404);
	if ((j.status !== "done" && j.status !== "done_with_fallback") || !j.output_path) {
		return c.json({ error: "not_ready", status: j.status }, 409);
	}
	if (!fs.existsSync(j.output_path)) {
		return c.json({ error: "file_missing" }, 410);
	}
	const file = Bun.file(j.output_path);
	return new Response(file, {
		headers: {
			"content-type": "video/mp4",
			"content-disposition": `inline; filename="${j.id}.mp4"`,
		},
	});
});

// Paginated jobs list. Returns the full contract the dashboard client expects:
// items + total + limit + offset + has_more + next_offset.
app.get("/jobs", (c) => {
	const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 500);
	const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
	const total = countJobs();
	const items = listJobs(limit, offset);
	const consumed = offset + items.length;
	return c.json({
		items,
		total,
		limit,
		offset,
		has_more: consumed < total,
		next_offset: consumed < total ? consumed : null,
	});
});

// Internal read query uses a body so authorized project sets cannot overflow a URL.
const jobQuerySchema = z.object({
	limit: z.number().int().min(1).max(500).default(50),
	offset: z.number().int().min(0).default(0),
	workspace: z.string().min(1),
	projectIds: z.array(z.string().min(1)),
	legacyJobIds: z.array(z.string().min(1)).default([]),
	statuses: z
		.array(z.enum(["queued", "running", "done", "done_with_fallback", "error", "cancelled"]))
		.optional(),
});
app.post("/jobs/query", async (c) => {
	const parsed = jobQuerySchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
	const { limit, offset, ...filters } = parsed.data;
	const total = countJobs(filters);
	const items = listJobs(limit, offset, filters);
	const next = offset + items.length;
	return c.json({
		items,
		...jobOwners(filters),
		total,
		limit,
		offset,
		has_more: next < total,
		next_offset: next < total ? next : null,
	});
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
	console.error("[error]", err);
	return c.json(
		{ error: "internal", message: err instanceof Error ? err.message : String(err) },
		500,
	);
});

type Check = { ok: boolean; detail?: string };

async function collectHealth(): Promise<Record<string, Check>> {
	const checks: Record<string, Check> = {};

	// out/ writable — required to land rendered files.
	try {
		const outDir = path.resolve("out");
		fs.mkdirSync(outDir, { recursive: true });
		const probe = path.join(outDir, `.health-${process.pid}`);
		fs.writeFileSync(probe, "ok");
		fs.unlinkSync(probe);
		checks.out_writable = { ok: true };
	} catch (err) {
		checks.out_writable = { ok: false, detail: err instanceof Error ? err.message : String(err) };
	}

	// job DB reachable.
	try {
		countJobs();
		checks.db = { ok: true };
	} catch (err) {
		checks.db = { ok: false, detail: err instanceof Error ? err.message : String(err) };
	}

	// Token configured (already enforced at boot, reported for completeness).
	checks.token = { ok: Boolean(process.env.MALEO_VIDEO_TOKEN) };

	// TTS provider reachability (best-effort, non-critical).
	const kokoro = process.env.MALEO_KOKORO_URL?.replace(/\/$/, "");
	if (kokoro) {
		checks.tts = await ping(`${kokoro}/health`, kokoro);
	} else if (process.env.ELEVENLABS_API_KEY) {
		checks.tts = { ok: true, detail: "elevenlabs configured" };
	} else {
		checks.tts = { ok: true, detail: "none (renders silent)" };
	}

	// Image service reachability (best-effort, non-critical).
	const imageUrl = process.env.MALEO_IMAGE_URL?.replace(/\/$/, "");
	if (imageUrl) {
		checks.image_service = await ping(`${imageUrl}/health`, imageUrl);
	} else {
		checks.image_service = { ok: true, detail: "none (uses placeholders)" };
	}

	return checks;
}

async function ping(url: string, label: string): Promise<Check> {
	try {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 2000);
		const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
		return { ok: res.ok, detail: `${label} ${res.status}` };
	} catch (err) {
		return { ok: false, detail: `${label} ${err instanceof Error ? err.message : String(err)}` };
	}
}

const server = Bun.serve({ port: PORT, fetch: app.fetch, idleTimeout: 255 });
console.log(`maleo-video listening on :${server.port}`);

// Remotion bundling changes cwd temporarily; finish before jobs resolve runtime paths.
await warmBundle();
if (JOB_RETENTION > 0) {
	const pruned = pruneJobs(JOB_RETENTION);
	if (pruned > 0) console.log(`[server] pruned ${pruned} old job(s)`);
	// Periodic retention sweep.
	setInterval(() => {
		try {
			pruneJobs(JOB_RETENTION);
		} catch (err) {
			console.error("[server] prune error", err);
		}
	}, 3_600_000);
}
startWorker();

const shutdown = (sig: string) => {
	console.log(`received ${sig}, closing`);
	void server.stop();
	process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
