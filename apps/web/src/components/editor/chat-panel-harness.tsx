/* The chat panel test harness: a DOM, a mounted panel with every callback
 * recorded, a fake editor bridge, and input helpers that keep every update
 * inside act(). Shared by the panel's test suites; not a test itself.
 *
 * A suite using it runs in the happy-dom environment
 * (`// @vitest-environment happy-dom`) and calls `installChatHarness()` at the
 * top: it installs the per-test credit stub and cleanup. */
import { fixtureArtifact } from "@models/agent/artifact-fixture.ts";
import { afterEach, beforeEach } from "vite-plus/test";

// Tells React this is a test environment, so it checks updates happen in act().
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const { act, createElement, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ChatPanel } = await import("./editor-chat.tsx");
import type { ChatEntityRef, ChatProjectIndex, StoryClarificationSubmission } from "@maleo/shared";
import type { ChatLogMessage, StorySectionMsg } from "@models/chat/chat-log.ts";
import type { ChatCommandScope, ComposerFocusPreview } from "@models/chat/chat-composer.ts";
import type { ChatEditorBridge } from "@hooks/editor/use-chat-session.ts";
import type { CreditSummary } from "@api/credits.ts";
import type { BlockerResolution, BlockerState } from "@api/blockers.ts";

let creditBody: CreditSummary | null = null;
/** What the credits endpoint answers for the rest of this test. */
export function setCreditBody(body: CreditSummary | null): void {
	creditBody = body;
}

let blockerBody: BlockerState | null = null;
let resolveBody: BlockerResolution | null = null;
/** What the open-blocker read answers for the rest of this test. */
export function setBlockerBody(body: BlockerState): void {
	blockerBody = body;
}
/** What a blocker submission answers for the rest of this test. */
export function setBlockerResolution(body: BlockerResolution): void {
	resolveBody = body;
}
/** Every blocker submission this test made, newest last. */
interface BlockerSubmission {
	answers: Array<{ id: string; choice?: string; otherText?: string }>;
}
export const blockerSubmissions: BlockerSubmission[] = [];

let cleanup: (() => void) | undefined;
/** Unmount the current panel, so a test can mount another. */
export function unmount(): void {
	cleanup?.();
	cleanup = undefined;
}

export function installChatHarness(): void {
	const realFetch = globalThis.fetch;
	beforeEach(() => {
		creditBody = null;
		blockerBody = null;
		resolveBody = null;
		blockerSubmissions.length = 0;
		const json = (body: BlockerState | BlockerResolution | CreditSummary): Response =>
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url.includes("/blockers/resolve")) {
				const submission: BlockerSubmission = JSON.parse(
					typeof init?.body === "string" ? init.body : "{}",
				);
				blockerSubmissions.push(submission);
				return json(
					resolveBody ?? { ok: true, blockers: [], instructions: [], navigate: [], failed: [] },
				);
			}
			if (url.includes("/blockers"))
				return json(blockerBody ?? { blockers: [], acknowledged: [], batch: null });
			return creditBody ? json(creditBody) : new Response("{}", { status: 500 });
		};
		globalThis.fetch = Object.assign(stub, { preconnect: realFetch.preconnect });
	});
	afterEach(() => {
		unmount();
		globalThis.fetch = realFetch;
	});
}

export const tick = async (): Promise<void> => {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
};
export const frame = async (): Promise<void> => {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
};

/* ── A fake editor: a selection, a playhead, and a renameable index ── */
export function fakeEditor(
	initial: { selection?: ChatEntityRef[]; playhead?: ChatEntityRef | null } = {},
) {
	const index: ChatProjectIndex = {
		story: [
			{ kind: "section", id: "sec-a", label: "Opening hook" },
			{ kind: "section", id: "sec-b", label: "The turn" },
		],
		timeline: [
			{ kind: "clip", id: "scene:1", label: "Harbour at dawn" },
			{ kind: "clip", id: "scene:2", label: "Storm" },
		],
		materials: [{ kind: "material", id: "brief", label: "Brief" }],
		references: [{ kind: "reference", id: "ref-1", label: "Captain" }],
		assets: [],
	};
	const state = {
		selection: initial.selection ?? [],
		playhead: initial.playhead ?? null,
		index,
	};
	const listeners = new Set<() => void>();
	const previews: ChatCommandScope[] = [];
	const revealed: ChatEntityRef[][] = [];
	const undone: string[] = [];
	const undoable = new Set<string>();
	const label = (ref: ChatEntityRef): string =>
		[
			...state.index.story,
			...state.index.timeline,
			...state.index.materials,
			...state.index.references,
		].find((e) => e.kind === ref.kind && e.id === ref.id)?.label ?? ref.id;
	const preview = (_text: string, scope: ChatCommandScope): ComposerFocusPreview => {
		previews.push(scope);
		const chip = (ref: ChatEntityRef, source: "mention" | "selection" | "playhead") => ({
			...ref,
			label: label(ref),
			source,
		});
		if (scope.mentions.length)
			return { chips: scope.mentions.map((r) => chip(r, "mention")), index: state.index };
		if (state.selection.length && !scope.excludedSources.includes("selection"))
			return { chips: state.selection.map((r) => chip(r, "selection")), index: state.index };
		if (state.playhead && !scope.excludedSources.includes("playhead"))
			return { chips: [chip(state.playhead, "playhead")], index: state.index };
		return {
			chips: [{ kind: "project", id: "project", label: "Whole project", source: "project" }],
			index: state.index,
		};
	};
	const bridge: ChatEditorBridge = {
		composer: {
			preview,
			subscribe: (l) => {
				listeners.add(l);
				return () => listeners.delete(l);
			},
		},
		reveal: (refs) => {
			revealed.push(refs);
		},
		canUndo: (jobId) => undoable.has(jobId),
		undo: (jobId) => {
			undone.push(jobId);
			undoable.delete(jobId);
		},
	};
	return {
		bridge,
		state,
		previews,
		revealed,
		undone,
		undoable,
		select: (refs: ChatEntityRef[]) =>
			act(() => {
				state.selection = refs;
				for (const l of listeners) l();
			}),
	};
}

export interface Harness {
	host: HTMLElement;
	runs: Array<{ text: string; scope?: ChatCommandScope }>;
	answers: Array<{
		jobId: string;
		answer: string;
		actionId?: string;
		batch?: StoryClarificationSubmission;
	}>;
	stops: number;
	resumes: number;
	setBusy: (busy: boolean) => void;
	setMessages: (next: ChatLogMessage[] | ((m: ChatLogMessage[]) => ChatLogMessage[])) => void;
	messages: () => ChatLogMessage[];
	textarea: () => HTMLTextAreaElement;
}

export async function mount(
	opts: {
		messages?: ChatLogMessage[];
		busy?: boolean;
		editor?: ChatEditorBridge;
		interrupted?: { jobId: string } | null;
		refuseAnswers?: boolean;
		onJump?: boolean;
		projectId?: string;
	} = {},
): Promise<Harness> {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const h: Harness = {
		host,
		runs: [],
		answers: [],
		stops: 0,
		resumes: 0,
		setBusy: () => {},
		setMessages: () => {},
		messages: () => [],
		textarea: () => host.querySelector("textarea")!,
	};
	let current: ChatLogMessage[] = opts.messages ?? [];
	function App() {
		const [messages, setMessages] = useState<ChatLogMessage[]>(opts.messages ?? []);
		const [busy, setBusy] = useState(Boolean(opts.busy));
		current = messages;
		h.setBusy = (b) => act(() => setBusy(b));
		h.setMessages = (next) => act(() => setMessages(next));
		return createElement(ChatPanel, {
			scenes: [],
			messages,
			setMessages,
			busy,
			editor: opts.editor,
			interrupted: opts.interrupted ?? null,
			// Opt-in: a project id also turns on the Trace toggle, and most tests
			// here count the panel's controls.
			projectId: opts.projectId ?? null,
			onResume: () => {
				h.resumes++;
			},
			onRunCommand: async (text: string, scope?: ChatCommandScope) => {
				h.runs.push({ text, scope });
			},
			onAnswerQuestion: async (
				jobId: string,
				answer: string,
				actionId?: string,
				batch?: StoryClarificationSubmission,
			) => {
				h.answers.push({ jobId, answer, actionId, batch });
				return !opts.refuseAnswers;
			},
			onStop: () => {
				h.stops++;
			},
			onClose: () => {},
			// Every output action wired, so history's lack of them is the panel's doing.
			onSeek: opts.onJump ? () => {} : undefined,
			onJump: opts.onJump ? () => {} : undefined,
			onAddArtifact: opts.onJump ? () => {} : undefined,
		});
	}
	/* Rendered and then flushed inside act: the panel loads credits on mount, and
	 * that response settling outside act is an update React never saw. */
	await act(async () => {
		root.render(createElement(App));
		await new Promise((r) => setTimeout(r, 0));
	});
	h.messages = () => current;
	cleanup = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	return h;
}

export function type(h: Harness, value: string): void {
	const box = h.textarea();
	act(() => {
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
		setter.call(box, value);
		box.selectionStart = value.length;
		box.selectionEnd = value.length;
		box.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
export function key(h: Harness, k: string, init: KeyboardEventInit = {}): void {
	act(() => {
		h.textarea().dispatchEvent(
			new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }),
		);
	});
}
/* Clicks often start async work (a send, a stop, an answer) whose settle
 * updates the panel; flushing it inside act keeps every update where React sees. */
export async function click(el: Element | null | undefined): Promise<void> {
	if (!(el instanceof HTMLElement)) throw new Error("element not found");
	await act(async () => {
		el.click();
		await new Promise((r) => setTimeout(r, 0));
	});
}
export const byText = (root: ParentNode, selector: string, text: string): HTMLElement | undefined =>
	[...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.includes(text));

export const user = (
	id: number,
	text: string,
	extra: Partial<ChatLogMessage> = {},
): ChatLogMessage => ({ id, role: "user", text, ...extra });
export const section = (i: number, status: StorySectionMsg["status"]): StorySectionMsg => ({
	id: `s${i}`,
	title: `S${i}`,
	narration: "n",
	visualPrompt: "v",
	estimatedDurationSec: 5,
	status,
});
export const planMsg = (id: number, statuses: StorySectionMsg["status"][]): ChatLogMessage => ({
	id,
	role: "assistant",
	jobId: "j1",
	artifact: fixtureArtifact("story_plan", {
		targetSec: 40,
		sections: statuses.map((s, i) => section(i, s)),
	}),
});

export { act };
