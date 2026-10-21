/* Recover server exports from worker ownership. Browser drafts remain session-local. */
import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getOrNull } from "@api/client.ts";
import { shouldPollRenderJob, type RenderQueueStatus } from "@models/render/render-queue.ts";
import type { ExportDiscovery } from "@models/video/render-job.ts";
import type { ShellChromeStore } from "@stores/shell-chrome-store.ts";

export function useRenderPoll(opts: {
	renderJobId: string | null;
	rendering: boolean;
	setRenderStatus: Dispatch<SetStateAction<RenderQueueStatus | null>>;
	setRendering: Dispatch<SetStateAction<boolean>>;
	projectId?: string;
	workspace?: string;
	chrome?: ShellChromeStore;
}): void {
	const { renderJobId, rendering, projectId, workspace, chrome, setRenderStatus, setRendering } =
		opts;
	useEffect(() => {
		if (!projectId && (!renderJobId || !rendering)) return;
		let alive = true;
		let busy = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (projectId) chrome?.patch("exportConnection", "checking");
		const poll = async (): Promise<void> => {
			if (busy || !alive) return;
			busy = true;
			if (timer) clearTimeout(timer);
			try {
				let job: RenderQueueStatus | null;
				if (projectId) {
					const found = await getOrNull<ExportDiscovery>(
						`/api/video/projects/${encodeURIComponent(projectId)}/exports?workspace=${encodeURIComponent(workspace ?? "")}`,
					);
					if (!alive) return;
					if (!found) {
						chrome?.patch("exportConnection", "missing");
						chrome?.patch("exportError", "Project export is no longer available.");
						setRendering(false);
						return;
					}
					// A submission accepted after this read must not be cleared by its older snapshot.
					if (chrome?.get().rendering && !chrome.get().renderJobId) {
						timer = setTimeout(() => void poll(), 2000);
						return;
					}
					job = found.active ?? found.latest;
				} else {
					job = await getOrNull<RenderQueueStatus>(`/api/video/render/${renderJobId}`);
					if (!alive) return;
				}
				if (!job && renderJobId) {
					setRenderStatus(null);
					setRendering(false);
					chrome?.patch("exportConnection", "missing");
					chrome?.patch(
						"exportError",
						"This export is no longer available in history. Start a new export or reconnect.",
					);
					return;
				}
				if (projectId) chrome?.patch("renderJobId", job?.id ?? null);
				setRenderStatus(job);
				setRendering(Boolean(job && shouldPollRenderJob(job.status)));
				chrome?.patch(
					"exportConnection",
					job ? "connected" : renderJobId && !projectId ? "missing" : "idle",
				);
				chrome?.patch("exportError", null);
				if (job && shouldPollRenderJob(job.status)) timer = setTimeout(() => void poll(), 2000);
			} catch (error) {
				if (!alive) return;
				chrome?.patch("exportConnection", "disconnected");
				chrome?.patch(
					"exportError",
					`Export status is unavailable. Last known progress is retained. ${error instanceof Error ? error.message : String(error)}`,
				);
				timer = setTimeout(() => void poll(), 4000);
			} finally {
				busy = false;
			}
		};
		const refresh = () => void poll();
		void poll();
		window.addEventListener("focus", refresh);
		window.addEventListener("maleo:refresh-export", refresh);
		return () => {
			alive = false;
			if (timer) clearTimeout(timer);
			window.removeEventListener("focus", refresh);
			window.removeEventListener("maleo:refresh-export", refresh);
		};
	}, [
		projectId,
		workspace,
		renderJobId,
		projectId ? undefined : rendering,
		chrome,
		setRenderStatus,
		setRendering,
	]);
}
