/* Whole-project coverage for Rust export eligibility (OpenSpec p2-export E1).
 *
 * The renderer module (`/renderer/`, `app/renderer-routes.ts`) is not part of a
 * normal editor load. It loads here, the first time the export menu asks, and
 * only its GPU-free `project_coverage` runs on the main thread: no WebGPU
 * device or preview session starts. An empty report for every frame means the
 * project is eligible for Rust export. */
import { z } from "zod";
import type { ManifestEntry } from "./export-preflight.ts";

const MODULE_URL = "/renderer/maleo_renderer_wasm.js";

const entrySchema = z.object({
	kind: z.string(),
	path: z.string(),
	reason: z.string(),
	frame: z.number().int().nonnegative(),
	time: z.number().nonnegative(),
});
export type CoverageEntry = z.infer<typeof entrySchema>;

/** What export reads from the preview: the storyboard it would render, at what
 *  size and rate, and the complete local file the preview loaded for a manifest
 *  entry (absent until the preview's media session opens). */
export interface ExportSource {
	storyboard: object;
	fps: number;
	frames: number;
	width: number;
	height: number;
	localFile?: (entry: ManifestEntry) => File | undefined;
}

export type ExportCoverage =
	| { state: "checking" }
	| { state: "eligible" }
	| { state: "ineligible"; entries: CoverageEntry[] }
	| { state: "error"; message: string };

interface CoverageModule {
	default: () => Promise<unknown>;
	project_coverage(json: string, fps: number, frames: number): string;
}

export type ModuleImporter = (url: string) => Promise<CoverageModule>;

// SAFETY: the URL is the renderer build output, whose exports `CoverageModule` names.
const importModule: ModuleImporter = (url) =>
	import(/* @vite-ignore */ url) as Promise<CoverageModule>;

/** One loaded module per page; a failed load is retried on the next call. */
export function createCoverageLoader(load: ModuleImporter = importModule) {
	let pending: Promise<CoverageModule> | null = null;
	const module = (): Promise<CoverageModule> => {
		pending ??= load(MODULE_URL)
			.then(async (native) => {
				await native.default();
				return native;
			})
			.catch((error: unknown) => {
				pending = null;
				throw error;
			});
		return pending;
	};
	return async (source: ExportSource): Promise<ExportCoverage> => {
		try {
			const native = await module();
			const json = native.project_coverage(
				JSON.stringify(source.storyboard),
				source.fps,
				source.frames,
			);
			const entries = z.array(entrySchema).parse(JSON.parse(json));
			return entries.length === 0 ? { state: "eligible" } : { state: "ineligible", entries };
		} catch (error) {
			return {
				state: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};
}

/** The first problem, for the menu: what is unsupported and where it starts. */
export function coverageReason(entries: readonly CoverageEntry[]): string {
	const first = entries[0];
	if (!first) return "";
	const more = entries.length > 1 ? ` (+${entries.length - 1} more)` : "";
	return `${first.reason} at ${first.time.toFixed(2)} s${more}`;
}

export const loadExportCoverage = createCoverageLoader();
