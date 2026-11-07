/* Turns an ended shadow job into its `render_comparisons` row (OpenSpec p2-export E7).
 *
 * - An ineligible shadow records its reason.
 * - A failed shadow records the failure as a divergence.
 * - A finished shadow is compared with the authoritative output. Both MP4s are
 *   removed after; a failed comparison keeps its frames under
 *   `out/comparisons/<shadow id>/`, which `pruneComparisonArtifacts` removes
 *   after 30 days. */
import path from "node:path";
import { readdir, rm, stat } from "node:fs/promises";
import { PRESETS } from "@maleo/video/lib/presets";
import { storyboardSchema } from "@maleo/video/schema";
import { getJob } from "./db";
import { compareOutputs, loadComparisonConfig } from "./comparison";
import { insertComparison } from "./comparisons-db";
import { shadowReferencePath } from "./rust-export";
import type { HostRun } from "./rust-host";

export const ARTIFACT_DAYS = 30;

export async function settleShadow(shadowId: string, run?: HostRun): Promise<void> {
	const shadow = getJob(shadowId);
	if (!shadow?.shadow_of) return;
	const owner = getJob(shadow.shadow_of);
	const outDir = path.resolve("out");
	const reference = shadowReferencePath(outDir, shadow.id);
	const base = {
		jobId: shadow.shadow_of,
		shadowJobId: shadow.id,
		authority: owner?.renderer ?? "remotion",
		shadowRenderer: shadow.renderer,
	};
	try {
		if (shadow.error_code === "INELIGIBLE") {
			insertComparison({ ...base, status: "ineligible", summary: shadow.renderer_note });
			return;
		}
		if (shadow.status !== "done" || !shadow.output_path) {
			insertComparison({
				...base,
				status: "failed",
				failures: [`shadow render failed: ${shadow.error ?? shadow.status}`],
			});
			return;
		}
		const preset = PRESETS[shadow.preset];
		if (!preset) throw new Error(`unknown preset: ${shadow.preset}`);
		const config = await loadComparisonConfig();
		const result = await compareOutputs({
			reference,
			candidate: shadow.output_path,
			storyboard: storyboardSchema.parse(JSON.parse(shadow.product_json)),
			compositionId: preset.compositionId,
			projectId: shadow.project_id,
			remotion:
				base.authority === "remotion"
					? "reference"
					: shadow.renderer === "remotion"
						? "candidate"
						: undefined,
			dir: path.join(outDir, "comparisons", shadow.id),
			config,
			run,
		});
		insertComparison({
			...base,
			status: result.passed ? "passed" : "failed",
			configVersion: result.configVersion,
			failures: result.failures,
			scores: result,
			artifacts: result.artifacts,
		});
	} catch (error) {
		// A comparison that cannot run is a divergence too: an operator explains it.
		insertComparison({
			...base,
			status: "failed",
			failures: [`comparison failed: ${error instanceof Error ? error.message : String(error)}`],
		});
	} finally {
		await rm(reference, { force: true });
		if (shadow.output_path) await rm(shadow.output_path, { force: true });
	}
}

/** Removes comparison artifact directories older than `days`. */
export async function pruneComparisonArtifacts(
	days = ARTIFACT_DAYS,
	now = Date.now(),
): Promise<number> {
	const dir = path.resolve("out", "comparisons");
	const names = await readdir(dir).catch(() => []);
	let removed = 0;
	for (const name of names) {
		const entry = path.join(dir, name);
		const info = await stat(entry).catch(() => null);
		if (info && now - info.mtimeMs > days * 86_400_000) {
			await rm(entry, { recursive: true, force: true });
			removed++;
		}
	}
	return removed;
}
