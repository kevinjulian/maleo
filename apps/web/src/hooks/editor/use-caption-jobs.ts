import { useEffect, useRef, useState } from "react";
import { captionTrackFor, type CaptionJobResponse } from "@maleo/shared";
import { editCaptions, batch, applyCommand, diffScopeToCommand } from "@maleo/shared/editor";
import {
	cancelCaptionJob,
	pollCaptionJob,
	submitCaptionJob,
	captionJobError,
	type CaptionJobInput,
} from "@api/caption-jobs.ts";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { withReadyPending } from "@models/core/pending-media-sources.ts";

interface JobState {
	key: string;
	id: string | null;
	job: CaptionJobResponse | null;
	status: string;
	error: string | null;
	busy: boolean;
}
const empty = (key: string): JobState => ({
	key,
	id: null,
	job: null,
	status: "",
	error: null,
	busy: false,
});
const message = captionJobError;
function remembered(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function remember(key: string, id: string | null): void {
	try {
		if (id) localStorage.setItem(key, id);
		else localStorage.removeItem(key);
	} catch {
		/* Current editor session still owns the job. */
	}
}

/** Editor-owned: panel closure does not cancel work or lose its durable identity. */
export function useCaptionJobs(
	project: string | null,
	store: TimelineDocumentStore,
	writers: DocumentWriters,
) {
	const workspace = useActiveWorkspace();
	const key = `caption-job:${JSON.stringify([workspace, project])}`;
	const current = useRef(key);
	current.current = key;
	const [state, setState] = useState<JobState>(() => empty(key));
	const [pollVersion, setPollVersion] = useState(0);
	const submission = useRef(new Map<string, { cancelled: boolean }>());
	const attempted = useRef(new Set<string>());
	const cancelled = useRef(new Set<string>());
	const live = state.key === key ? state : empty(key);

	function apply(job: CaptionJobResponse): void {
		if (!job.result || !project || current.current !== key) return;
		if (store.getDoc().captionSet?.appliedRunIds.includes(job.id)) {
			remember(key, null);
			setState({ ...empty(key), status: "Caption result already applied." });
			return;
		}
		try {
			const result = job.result;
			let added = 0;
			writers.apply((scope) => {
				const track = captionTrackFor(scope.doc);
				const command = editCaptions({
					action: "apply-result",
					...job.context,
					candidates: result.cues.map((cue) => ({ ...cue, track })),
					runId: job.id,
					language: result.language,
					...(result.detectedLanguage ? { detectedLanguage: result.detectedLanguage } : {}),
				});
				const edit = result.cues.length
					? batch([
							command,
							{
								type: "doc.setTrackFlags",
								trackFlags: {
									...scope.doc.trackFlags,
									[track]: { ...scope.doc.trackFlags?.[track], group: "caption" },
								},
							},
						])
					: command;
				// The ledger logs refusals; this caller must retain a held result and show its reason.
				const accepted = applyCommand({ ...scope, doc: withReadyPending(scope.doc) }, edit);
				if (!result.cues.length) return { type: "noop" };
				const candidateIds = new Set(result.cues.map((cue) => cue.id));
				added = accepted.doc.clips.filter((clip) => candidateIds.has(clip.id)).length;
				const originals = new Map(scope.doc.clips.map((clip) => [clip.id, clip]));
				// Import completion resolves playback; accepting captions must not edit or unlock its source.
				return diffScopeToCommand(scope, {
					...scope,
					doc: {
						...scope.doc,
						clips: accepted.doc.clips.map((clip) =>
							clip.type === "caption" ? clip : originals.get(clip.id)!,
						),
						captionSet: accepted.doc.captionSet,
						trackFlags: added ? accepted.doc.trackFlags : scope.doc.trackFlags,
					},
				});
			});
			remember(key, null);
			setState({
				key,
				id: null,
				job: null,
				busy: false,
				error: null,
				status: job.result.cues.length
					? added
						? "Captions ready. Review text and timing."
						: "No captions added. Existing captions or deletions protected this range. To restore deleted captions, regenerate with Replace edited captions in this range."
					: "No speech found. Current captions preserved.",
			});
		} catch (error) {
			setState({
				key,
				id: job.id,
				job,
				busy: false,
				status: "Result held. Sources or captions changed.",
				error: message(error),
			});
		}
	}
	const applyLatest = useRef(apply);
	applyLatest.current = apply;

	useEffect(() => {
		const id = remembered(key);
		setState({ ...empty(key), id, busy: Boolean(id), status: id ? "Resuming caption job…" : "" });
	}, [key]);

	useEffect(() => {
		if (!project || !live.id || !live.busy) return;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		const id = live.id;
		async function poll() {
			try {
				const job = await pollCaptionJob(project!, workspace, id, controller.signal);
				if (controller.signal.aborted || current.current !== key || cancelled.current.has(id))
					return;
				if (job.status === "done") {
					if (!attempted.current.has(id)) {
						attempted.current.add(id);
						applyLatest.current(job);
					}
					return;
				}
				const busy = job.status === "queued" || job.status === "processing";
				setState({
					key,
					id,
					job,
					busy,
					error: job.error,
					status:
						job.stage === "preparing-audio"
							? "Preparing audio…"
							: job.stage === "recognizing-speech"
								? "Recognizing speech…"
								: job.stage === "building-captions"
									? "Building captions…"
									: job.status === "queued"
										? "Waiting for caption worker…"
										: job.status === "cancelled"
											? "Caption job cancelled. Current captions preserved."
											: "Caption job failed. Retry generation.",
				});
				if (busy) timer = setTimeout(() => void poll(), 750);
				else remember(key, null);
			} catch (error) {
				if (!controller.signal.aborted && current.current === key)
					setState((previous) => ({
						...previous,
						busy: false,
						error: message(error),
						status: "Caption job connection lost. Resume to check its status.",
					}));
			}
		}
		void poll();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [key, project, workspace, live.id, live.busy, pollVersion]);

	async function generate(input: Omit<CaptionJobInput, "requestKey" | "doc">): Promise<void> {
		if (!project || live.busy || submission.current.has(key)) return;
		const pending = { cancelled: false };
		let acceptedId: string | null = null;
		submission.current.set(key, pending);
		setState({ ...empty(key), busy: true, status: "Submitting caption job…" });
		try {
			const id = await submitCaptionJob(project, workspace, {
				...input,
				doc: withReadyPending(store.getDoc()),
				requestKey: crypto.randomUUID(),
			});
			acceptedId = id;
			remember(key, id);
			if (pending.cancelled) {
				cancelled.current.add(id);
				await cancelCaptionJob(project, workspace, id);
				remember(key, null);
			}
			if (current.current === key)
				setState({
					...empty(key),
					id: pending.cancelled ? null : id,
					busy: !pending.cancelled,
					status: pending.cancelled ? "Caption job cancelled." : "Waiting for caption worker…",
				});
		} catch (error) {
			if (current.current === key)
				setState({
					...empty(key),
					id: acceptedId,
					error: message(error),
					status: acceptedId ? "Cancellation failed. Resume to check job status." : "",
				});
		} finally {
			if (submission.current.get(key) === pending) submission.current.delete(key);
		}
	}
	async function cancel(): Promise<void> {
		const pending = submission.current.get(key);
		if (pending) pending.cancelled = true;
		if (!project || !live.id) return;
		const id = live.id;
		cancelled.current.add(id);
		setState((previous) => ({ ...previous, busy: true, status: "Cancelling caption job…" }));
		try {
			await cancelCaptionJob(project, workspace, id);
			if (remembered(key) === id) remember(key, null);
			if (current.current === key)
				setState((previous) =>
					previous.id === id
						? { ...empty(key), status: "Caption job cancelled. Current captions preserved." }
						: previous,
				);
		} catch (error) {
			if (current.current === key)
				setState((previous) =>
					previous.id === id ? { ...previous, busy: false, error: message(error) } : previous,
				);
		}
	}
	return {
		...live,
		generate,
		cancel,
		apply: () => {
			if (live.job) apply(live.job);
		},
		resume: () => {
			attempted.current.delete(live.id ?? "");
			cancelled.current.delete(live.id ?? "");
			setState((previous) => ({ ...previous, busy: true, error: null }));
			setPollVersion((version) => version + 1);
		},
	};
}
export type CaptionJobControls = ReturnType<typeof useCaptionJobs>;
