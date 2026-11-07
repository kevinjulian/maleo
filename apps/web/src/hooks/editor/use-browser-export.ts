/* Browser export from the editor (OpenSpec p2-export E2, E9).
 *
 * One click runs, in order: save the storyboard (the manifest describes the saved
 * one), capture the storyboard the preview shows, read the asset manifest and
 * the whole-project coverage, run preflight, then encode in the export worker
 * and save the file. A refusal names its cause; when the server could still
 * render the project, the export menu opens again so Server render is one click
 * away. Edits made after the capture stay in the document and stay out of the
 * file. Cancel stops the worker and saves nothing. */
import { useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getAssetManifest } from "@api/asset-manifest.ts";
import { loadExportCoverage, type ExportSource } from "@models/render/export-coverage.ts";
import type { RenderQueueStatus } from "@models/render/render-queue.ts";
import {
	ExportCancelled,
	exportBitrate,
	startBrowserExport,
} from "@services/preview-media/browser-export.ts";
import { runExportPreflight } from "@services/preview-media/export-preflight.ts";
import type { ShellChromeStore } from "@stores/shell-chrome-store.ts";

export const BROWSER_EXPORT_ID = "browser-export";

const PHASES: Record<string, string> = {
	loading: "loading renderer",
	rendering: "rendering frames",
	finishing: "finishing file",
};

export interface BrowserExportInput {
	chrome: ShellChromeStore;
	projectId?: string;
	saveStoryboard: () => Promise<unknown>;
	readExportSource: () => ExportSource | null;
	setSaveError: Dispatch<SetStateAction<string | null>>;
	filename: () => string;
	/** Saves the finished file; the default downloads it through a link. */
	save?: (blob: Blob, filename: string) => void;
}

function download(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The editor's handle on browser export. */
export interface BrowserExportControls {
	start: () => Promise<void>;
	cancel: () => void;
}

export function useBrowserExport(input: BrowserExportInput): BrowserExportControls {
	const latest = useRef(input);
	latest.current = input;
	const cancelRef = useRef<(() => void) | null>(null);
	const cancelled = useRef(false);

	const start = useCallback(async (): Promise<void> => {
		const { chrome, projectId, setSaveError } = latest.current;
		if (chrome.get().rendering) return;
		cancelled.current = false;
		const status = (next: Omit<RenderQueueStatus, "id">): void =>
			chrome.patch("renderStatus", { id: BROWSER_EXPORT_ID, ...next });
		chrome.set((previous) => ({
			...previous,
			exportMenuOpen: false,
			exportOrigin: "browser",
			exportConnection: "idle",
			exportError: null,
			renderJobId: null,
			rendering: true,
		}));
		status({ status: "running", phase: "checking export", progress: 0, error: null });
		try {
			if (!projectId) throw new Error("Save the project before export.");
			await latest.current.saveStoryboard();
			const source = latest.current.readExportSource();
			if (!source) throw new Error("The preview is not ready yet.");
			const [manifest, coverage] = await Promise.all([
				getAssetManifest(projectId),
				loadExportCoverage(source),
			]);
			const bitrate = exportBitrate(source.width, source.height);
			const preflight = await runExportPreflight({
				width: source.width,
				height: source.height,
				bitrate,
				seconds: source.frames / source.fps,
				coverage,
				manifest,
				localFile: source.localFile ?? (() => undefined),
			});
			if (!preflight.ok) {
				status({ status: "error", phase: preflight.cause, progress: 0, error: preflight.message });
				setSaveError(preflight.message);
				if (preflight.offerServer) chrome.patch("exportMenuOpen", true);
				return;
			}
			if (cancelled.current) throw new ExportCancelled();
			const run = startBrowserExport({
				storyboard: source.storyboard,
				fps: source.fps,
				frames: source.frames,
				width: source.width,
				height: source.height,
				bitrate,
				onProgress: (phase, frame, frames) =>
					status({
						status: "running",
						phase: PHASES[phase] ?? phase,
						progress: frames > 0 ? frame / frames : 0,
						error: null,
					}),
			});
			cancelRef.current = run.cancel;
			const blob = await run.done;
			(latest.current.save ?? download)(blob, latest.current.filename());
			status({ status: "done", phase: "saved to this device", progress: 1, error: null });
		} catch (error) {
			if (error instanceof ExportCancelled) {
				status({ status: "cancelled", phase: "cancelled", progress: 0, error: null });
				return;
			}
			const text = message(error);
			status({ status: "error", phase: "browser export", progress: 0, error: text });
			setSaveError(`Browser export failed: ${text}`);
		} finally {
			cancelRef.current = null;
			chrome.patch("rendering", false);
		}
	}, []);

	const cancel = useCallback((): void => {
		cancelled.current = true;
		cancelRef.current?.();
	}, []);

	return { start, cancel };
}
