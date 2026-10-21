/* Keeps a COPY honest.
 *
 * `video-response-schemas.ts` restates shapes that live in `@maleo/video`,
 * because the API cannot import that package's types: its package exports are
 * `./composition` only, deliberately, and it talks to the service over HTTP
 * anyway. A copy with nothing linking it is two definitions that drift
 * silently, so the link runs through a committed fixture instead.
 *
 * `packages/video/tests/job-wire-fixture.test.ts` owns that fixture and types
 * it as the service's own `Job`, so a column added or renamed there is a
 * compile error in the service's test until the file is regenerated. This test
 * reads the same file and asserts the parser still accepts it. Neither side can
 * move alone without one of the two going red.
 *
 * The fixture is read by PATH rather than imported, because importing it would
 * mean adding `@maleo/video` to this package's dependency graph — a
 * compile-time edge from the API to a service it only ever reaches over the
 * network. The path is the smaller cost, and a wrong one fails loudly below.
 */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	jobsPageResponseSchema,
	presetsResponseSchema,
	renderJobPhaseSchema,
	renderJobSchema,
	renderJobStatusSchema,
	templatesResponseSchema,
} from "./video-response-schemas.ts";

const FIXTURE = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"apps",
	"render-worker",
	"fixtures",
	"render-job.json",
);

/* Typed as an open record rather than `unknown`, so the spreads below need no
 * assertion of their own — `JSON.parse` returns `any`, and assigning it to a
 * declared type is a narrowing the compiler performs, not a claim this file
 * makes. */
const serviceJob: Record<string, unknown> = (() => {
	try {
		return JSON.parse(readFileSync(FIXTURE, "utf8"));
	} catch (err) {
		throw new Error(
			`could not read the video service's published job fixture at ${FIXTURE} — ` +
				"run `bun test` in packages/video to regenerate it. " +
				(err instanceof Error ? err.message : String(err)),
		);
	}
})();

describe("the video service's job shape", () => {
	test("a job as the service stores it parses", () => {
		const result = renderJobSchema.safeParse(serviceJob);
		expect(result.success).toBe(true);
	});

	/* The service sends columns this schema does not declare — `worker_id`,
	 * `leased_at`, `retry_images` and the rest. `routes/video.ts` forwards the
	 * parsed body to the browser, so dropping them would delete them from the
	 * web client's copy without an error anywhere. */
	test("columns the schema does not declare survive the parse", () => {
		const parsed = renderJobSchema.parse(serviceJob);
		expect(parsed).toHaveProperty("worker_id", null);
		expect(parsed).toHaveProperty("retry_images", 0);
	});

	test("a body that is not a job is rejected rather than passed on", () => {
		expect(renderJobSchema.safeParse({ error: "not_found" }).success).toBe(false);
		expect(renderJobSchema.safeParse(undefined).success).toBe(false);
		expect(renderJobSchema.safeParse({ ...serviceJob, progress: "half" }).success).toBe(false);
	});

	/* The fixture pins one status and one phase, so it cannot prove the whole
	 * union. What it CAN prove is that the members the fixture uses are still
	 * accepted, and that the schema has not silently gained members the service
	 * has no way to send. A member the service adds and the schema lacks shows up
	 * as a rejected response in staging, not here — stated rather than papered
	 * over, because the alternative is importing the service's types. */
	test("the status and phase the fixture carries are accepted", () => {
		expect(renderJobStatusSchema.safeParse(serviceJob.status).success).toBe(true);
		expect(renderJobPhaseSchema.safeParse(serviceJob.phase).success).toBe(true);
	});

	test("a status outside the union is rejected", () => {
		expect(renderJobSchema.safeParse({ ...serviceJob, status: "paused" }).success).toBe(false);
	});
});

describe("the video service's list shapes", () => {
	test("a jobs page parses, and paging fields stay optional", () => {
		const page = { items: [serviceJob] };
		const result = jobsPageResponseSchema.safeParse(page);
		expect(result.success).toBe(true);
	});

	test("a jobs page without items is rejected — the client cannot derive it", () => {
		expect(jobsPageResponseSchema.safeParse({ total: 3 }).success).toBe(false);
	});

	test("presets and templates parse", () => {
		expect(
			presetsResponseSchema.safeParse({
				items: [
					{ id: "p", compositionId: "c", maxDurationSec: 60, codec: "h264", videoBitrate: "8M" },
				],
			}).success,
		).toBe(true);
		expect(
			templatesResponseSchema.safeParse({
				items: [{ id: "classic", label: "Classic" }],
			}).success,
		).toBe(true);
	});

	test("a template id the API does not know is rejected", () => {
		expect(
			templatesResponseSchema.safeParse({
				items: [{ id: "brand-new", label: "Brand new" }],
			}).success,
		).toBe(false);
	});
});
