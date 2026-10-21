/* The active workspace's generation session: its history, its pending prompt,
 * and the generation currently in flight.
 *
 * The lab used to name its own workspace through a picker, so an operator with
 * one workspace active could generate into another without the app ever saying
 * so. It reads the active workspace now, like every other scoped surface. A lab
 * generation belongs to no project, so the operator's current tenant is the
 * honest answer for it — unlike a project generation, which takes the project's
 * workspace and never this one.
 *
 * A generation is optimistic — the bubble appears immediately in a
 * `generating` state and is patched in place as the job progresses, so the
 * prompt the operator just typed never disappears while the service works.
 * Polling stops at `POLL_ATTEMPTS * POLL_MS`, and the timeout is reported on
 * that bubble rather than silently leaving it spinning.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchImageJob, fetchImages, startImageGeneration } from "@api/image-gen.ts";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import {
	historyToMessages,
	type Aspect,
	type ChatMessage,
	type JobResult,
	type LedgerImage,
} from "@models/image-lab/image-job.ts";

const HISTORY_LIMIT = 50;
const POLL_MS = 2000;
const POLL_ATTEMPTS = 60;

export interface ImageSessionModel {
	/** Read-only here. The switcher is the only control that changes it. */
	workspace: string;
	messages: ChatMessage[];
	prompt: string;
	setPrompt: (v: string) => void;
	aspect: Aspect;
	setAspect: (v: Aspect) => void;
	busy: boolean;
	submit: (referenceUrls: string[]) => Promise<void>;
}

export function useImageSession({ onFeedGrew }: { onFeedGrew: () => void }): ImageSessionModel {
	const workspace = useActiveWorkspace();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [prompt, setPrompt] = useState("");
	const [aspect, setAspect] = useState<Aspect>("1:1");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let alive = true;
		void (async () => {
			try {
				// The lab shows its OWN generations: this workspace, source "lab". The
				// gallery is where every project's images live.
				const r = await fetchImages<LedgerImage>({
					workspace,
					source: "lab",
					limit: HISTORY_LIMIT,
				});
				if (!alive) return;
				setMessages(historyToMessages(r.items, workspace));
				setTimeout(onFeedGrew, 50);
			} catch {
				/* an unreadable history leaves the feed empty */
			}
		})();
		return () => {
			alive = false;
		};
	}, [workspace, onFeedGrew]);

	const submit = useCallback(
		async (referenceUrls: string[]) => {
			if (!prompt.trim() || busy) return;
			const text = prompt.trim();
			const msgId = `gen-${Date.now()}`;
			const startedAt = Date.now();
			setMessages((prev) => [
				...prev,
				{
					id: msgId,
					prompt: text,
					image_url: null,
					status: "generating",
					aspect,
					workspace,
					created_at: startedAt,
				},
			]);
			setPrompt("");
			setBusy(true);
			onFeedGrew();

			const patch = (p: Partial<ChatMessage>): void =>
				setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, ...p } : m)));

			try {
				const startRes = await startImageGeneration({
					prompt: text,
					workspace,
					aspect,
					reference_image_urls: referenceUrls.length ? referenceUrls : undefined,
				});
				if (!startRes.job_id) throw new Error(startRes.error ?? "no job_id");

				for (let i = 0; i < POLL_ATTEMPTS; i++) {
					await new Promise((r) => setTimeout(r, POLL_MS));
					const s = await fetchImageJob<JobResult>(startRes.job_id);
					const elapsed = Math.round((Date.now() - startedAt) / 1000);
					patch({ elapsed });

					if (s.status === "done" && s.image_url) {
						patch({ status: "done", image_url: s.image_url, elapsed });
						onFeedGrew();
						return;
					}
					if (s.status === "failed") throw new Error(s.error ?? "generation failed");
				}
				throw new Error(`timeout (${(POLL_ATTEMPTS * POLL_MS) / 1000}s)`);
			} catch (e) {
				patch({ status: "failed", error: e instanceof Error ? e.message : String(e) });
			} finally {
				setBusy(false);
			}
		},
		[prompt, busy, aspect, workspace, onFeedGrew],
	);

	return { workspace, messages, prompt, setPrompt, aspect, setAspect, busy, submit };
}
