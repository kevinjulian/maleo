import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MediaClient } from "@maleo/media/api";
import { closeMaleoDb } from "@maleo/db/connection";
import {
	ImageSubmitFailedError,
	normalizeImageUrl,
	recordJobCompleted,
	recordJobFailed,
	submitImageJob,
} from "./image-generator.ts";
import { findByJobId, listAttempts, listImages } from "@maleo/db/image-ledger";
import { setMediaClientForTests } from "../image-gen-client.ts";
import { setGlobalImageProvider } from "@maleo/db/global-settings";

describe("normalizeImageUrl", () => {
	const prevWorker = process.env.MALEO_GEN_WORKER_URL;
	const prevWorkerPublic = process.env.MALEO_GEN_WORKER_PUBLIC_URL;

	beforeEach(() => {
		// Public-url precedence is PUBLIC ?? IMAGE_URL ?? base; clear both env layers
		// so the `base` argument is exercised deterministically.
		delete process.env.MALEO_GEN_WORKER_URL;
		delete process.env.MALEO_GEN_WORKER_PUBLIC_URL;
	});
	afterEach(() => {
		if (prevWorker === undefined) delete process.env.MALEO_GEN_WORKER_URL;
		else process.env.MALEO_GEN_WORKER_URL = prevWorker;
		if (prevWorkerPublic === undefined) delete process.env.MALEO_GEN_WORKER_PUBLIC_URL;
		else process.env.MALEO_GEN_WORKER_PUBLIC_URL = prevWorkerPublic;
	});

	test("rewrites an upstream files url to the dashboard proxy path", () => {
		const out = normalizeImageUrl(
			"https://img.internal/files/abc.png?sig=1",
			"https://img.internal",
		);
		expect(out.path).toBe("/files/abc.png");
		expect(out.proxy).toBe("/api/image-gen/files/abc.png");
		expect(out.public).toBe("https://img.internal/files/abc.png");
	});

	test("passes through a url with no /files/ segment", () => {
		const out = normalizeImageUrl("/already/proxied.png", "https://img.internal");
		expect(out.path).toBe("/already/proxied.png");
		expect(out.proxy).toBe("/api/image-gen/already/proxied.png");
	});

	test("uses media-worker public url when durable generation is active", () => {
		process.env.MALEO_GEN_WORKER_URL = "http://media-worker:7071";
		process.env.MALEO_GEN_WORKER_PUBLIC_URL = "https://media.example.com/";
		const out = normalizeImageUrl("/files/x.png", "http://media-worker:7071");
		expect(out.public).toBe("https://media.example.com/files/x.png");
	});
});

describe("workspace image provider propagation", () => {
	const dbPath = join(tmpdir(), "maleo-image-provider-propagation.test.db");
	const priorDbPath = process.env.MALEO_DB_PATH;

	afterEach(async () => {
		setMediaClientForTests(undefined);
		await closeMaleoDb();
		for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
		if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
		else process.env.MALEO_DB_PATH = priorDbPath;
	});

	test("sends persisted provider id with every durable image request", async () => {
		process.env.MALEO_DB_PATH = dbPath;
		await setGlobalImageProvider("sandbox");
		let submitted: Parameters<MediaClient["submitImage"]>[0] | undefined;
		const client: MediaClient = {
			async submitImage(request) {
				submitted = request;
				return "job-1";
			},
			async submitVideo() {
				throw new Error("unused");
			},
			async videoReadiness() {
				return {};
			},
			async submitTts() {
				return "tts-1";
			},
			async poll() {
				throw new Error("not used");
			},
			async download() {
				throw new Error("not used");
			},
			fileUrl(path) {
				return path;
			},
		};
		setMediaClientForTests(client);

		const result = await submitImageJob(
			{ prompt: "mock this", aspect: "9:16" },
			{ workspace: "acme", source: "lab" },
		);
		expect(result.job_id).toBe("job-1");
		expect(submitted?.providerId).toBe("sandbox");
		expect(submitted?.providerSource).toBe("workspace");
	});
});

/* The recording contract. Every producer funnels through submitImageJob, so these
 * assert at that one point rather than per producer — a new producer that reaches
 * the image service inherits this behaviour by construction. */
describe("generation recording", () => {
	const dbPath = join(
		tmpdir(),
		`ledger-rec-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
	);

	const clientReturning = (jobId: string | undefined): MediaClient => ({
		async submitImage() {
			if (!jobId) throw new Error("submit refused");
			return jobId;
		},
		async submitVideo() {
			throw new Error("unused");
		},
		async videoReadiness() {
			return {};
		},
		async submitTts() {
			return "tts-1";
		},
		async poll() {
			throw new Error("not used");
		},
		async download() {
			throw new Error("not used");
		},
		fileUrl(path) {
			return path;
		},
	});

	const priorDbPath = process.env.MALEO_DB_PATH;

	beforeEach(async () => {
		process.env.MALEO_DB_PATH = dbPath;
		await closeMaleoDb();
	});

	afterEach(async () => {
		setMediaClientForTests(undefined);
		await closeMaleoDb();
		// WAL mode leaves -shm/-wal siblings; removing only the db file leaves them
		// pointing at a file that no longer exists, and the next open fails with
		// SQLITE_IOERR_SHORT_READ.
		for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
		if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
		else process.env.MALEO_DB_PATH = priorDbPath;
	});

	test("opens a pending row carrying the caller's attribution", async () => {
		setMediaClientForTests(clientReturning("job-rec-1"));
		const { ledgerId } = await submitImageJob(
			{ prompt: "a red coat", aspect: "1:1" },
			{ workspace: "acme", projectId: "p1", source: "clip" },
		);

		const row = await findByJobId("job-rec-1");
		expect(row?.id).toBe(ledgerId);
		expect(row?.workspace).toBe("acme");
		expect(row?.project_id).toBe("p1");
		expect(row?.source).toBe("clip");
		// Pending: submitted, not yet an image.
		expect(row?.status).toBe("pending");
		expect(await listImages({})).toHaveLength(0);
	});

	test("records an agent generation the same way as a route generation", async () => {
		setMediaClientForTests(clientReturning("job-agent"));
		await submitImageJob(
			{ prompt: "portrait" },
			{ workspace: "acme", projectId: "p1", source: "agent" },
		);
		setMediaClientForTests(clientReturning("job-route"));
		await submitImageJob(
			{ prompt: "portrait" },
			{ workspace: "acme", projectId: "p1", source: "clip" },
		);

		await recordJobCompleted("job-agent", "/img/agent.png");
		await recordJobCompleted("job-route", "/img/route.png");

		const rows = await listImages({ projectId: "p1" });
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.workspace === "acme")).toBe(true);
	});

	test("resolves a doubly-observed completion exactly once", async () => {
		setMediaClientForTests(clientReturning("job-twice"));
		await submitImageJob({ prompt: "x" }, { workspace: "acme", source: "lab" });

		expect(await recordJobCompleted("job-twice", "/img/first.png")).toBe(true);
		expect(await recordJobCompleted("job-twice", "/img/second.png")).toBe(false);

		const rows = await listImages({});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.asset_url).toBe("/img/first.png");
	});

	test("a failed generation yields no image", async () => {
		setMediaClientForTests(clientReturning("job-fail"));
		await submitImageJob({ prompt: "x" }, { workspace: "acme", source: "lab" });

		expect(await recordJobFailed("job-fail")).toBe(true);
		expect(await listImages({})).toHaveLength(0);
		expect((await findByJobId("job-fail"))?.status).toBe("failed");
	});

	test("a submit that throws does not leave the attempt pending forever", async () => {
		setMediaClientForTests(clientReturning(undefined));
		await expect(
			submitImageJob({ prompt: "x" }, { workspace: "acme", source: "lab" }),
		).rejects.toThrow();

		// Nothing will ever poll this attempt, so it must not sit pending.
		const rows = await listAttempts();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("failed");
		expect(await listImages({})).toHaveLength(0);
	});

	test("an absent worker fails clearly and resolves the attempt", async () => {
		setMediaClientForTests(null);
		await expect(
			submitImageJob({ prompt: "x" }, { workspace: "acme", source: "lab" }),
		).rejects.toThrow("media worker not configured");
		expect((await listAttempts())[0]?.status).toBe("failed");
	});

	/* A submit that yields no job id used to RETURN normally with job_id undefined.
	 * meter() wraps this call, and runBillableOperation captures usage on any
	 * fulfilled run — so a generation that never started was billed. It must throw. */
	test("a job-less submit rejects rather than returning, so it cannot be billed", async () => {
		setMediaClientForTests({
			async submitImage() {
				return undefined as unknown as string;
			},
			async submitVideo() {
				throw new Error("unused");
			},
			async videoReadiness() {
				return {};
			},
			async submitTts() {
				return "tts-1";
			},
			async poll() {
				throw new Error("not used");
			},
			async download() {
				throw new Error("not used");
			},
			fileUrl(path) {
				return path;
			},
		});

		const attempt = submitImageJob({ prompt: "x" }, { workspace: "acme", source: "lab" });
		await expect(attempt).rejects.toBeInstanceOf(ImageSubmitFailedError);

		const rows = await listAttempts();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("failed");
	});

	test("the thrown error carries the upstream status and body for verbatim forwarding", async () => {
		setMediaClientForTests({
			async submitImage() {
				throw new ImageSubmitFailedError(503, { error: "not_configured" });
			},
			async submitVideo() {
				throw new Error("unused");
			},
			async videoReadiness() {
				return {};
			},
			async submitTts() {
				return "tts-1";
			},
			async poll() {
				throw new Error("not used");
			},
			async download() {
				throw new Error("not used");
			},
			fileUrl(path) {
				return path;
			},
		});

		try {
			await submitImageJob({ prompt: "x" }, { workspace: "acme", source: "lab" });
			throw new Error("expected a rejection");
		} catch (err) {
			expect(err).toBeInstanceOf(ImageSubmitFailedError);
			expect((err as ImageSubmitFailedError).status).toBe(503);
			expect((err as ImageSubmitFailedError).raw).toEqual({ error: "not_configured" });
		}
	});

	/* `fromCache` means "cost nothing to produce", not "is not an image". Gating
	 * ledger resolution on it left the row pending while the client rendered the
	 * picture, so the gallery missed an image the operator could see. */
	test("a cached completion still resolves the ledger row", async () => {
		setMediaClientForTests(clientReturning("job-cached"));
		await submitImageJob({ prompt: "x" }, { workspace: "acme", source: "lab" });

		expect(await recordJobCompleted("job-cached", "/img/cached.png")).toBe(true);
		expect(await listImages({})).toHaveLength(1);
		expect((await findByJobId("job-cached"))?.status).toBe("completed");
	});
});
