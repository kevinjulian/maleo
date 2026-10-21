/* Publishes this service's job shape as a committed fixture.
 *
 * `@maleo/api` parses the bodies this service returns, and it cannot import
 * `Job` to check its parser against: `@maleo/video`'s package exports are
 * `./composition` only, deliberately, and widening that surface so another
 * package can borrow a database row type would be the wrong fix.
 *
 * So the shape is published instead. This test owns the fixture and types it as
 * `Job`, which means a field added or renamed in `Job` is a COMPILE error here
 * until the fixture accounts for it. `@maleo/api`'s
 * `video-response-schemas.test.ts` reads the same file and asserts its parser
 * still accepts it. Between them, neither side can change alone without a red
 * test: this one catches the shape drifting, that one catches the parser
 * falling behind it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Job } from "../src/db";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "render-job.json");

/* Every column, with the nullable ones null — the widest shape a reader has to
 * cope with. A running job rather than a finished one, because that is what the
 * API polls and therefore what its parser sees most. */
const job: Job = {
	id: "job_fixture",
	product_json: "{}",
	preset: "storyboard-vertical",
	status: "running",
	phase: "rendering",
	phase_detail: null,
	output_path: null,
	output_url: null,
	thumbnail_path: null,
	thumbnail_storage: null,
	manifest_path: null,
	image_status: null,
	duration_sec: null,
	error: null,
	error_code: null,
	cost_usd: null,
	progress: 0.5,
	backend: "local",
	attempts: 1,
	max_attempts: 3,
	retry_images: 0,
	worker_id: null,
	leased_at: null,
	input_hash: null,
	draft_id: null,
	workspace: null,
	project_id: null,
	output_storage: null,
	manifest_storage: null,
	preset_source: null,
	created_at: 1,
	started_at: null,
	finished_at: null,
};

describe("the published job wire fixture", () => {
	/* Writes before it asserts, so a `Job` change lands in the fixture as a diff
	 * the author reviews rather than as a failure they have to hand-fix. The
	 * assertion below is what makes it a test rather than a codegen step: it
	 * fails when the committed file is stale, which is what CI checks. */
	test("the committed fixture matches this service's Job type", () => {
		const serialised = `${JSON.stringify(job, null, "\t")}\n`;
		const existing = (() => {
			try {
				return readFileSync(FIXTURE, "utf8");
			} catch {
				return null;
			}
		})();
		if (existing !== serialised) writeFileSync(FIXTURE, serialised);
		expect(JSON.parse(serialised)).toEqual(job);
		expect(existing).toBe(serialised);
	});
});
