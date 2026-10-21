// @vitest-environment happy-dom
/* A settled run's result is applied once per run (`move-agent-tools-to-editor-commands`).
 *
 * No product path is known to settle the same run twice in one mount — a reload
 * re-attaches only active runs and the server refuses an answer to a settled one —
 * so this forces it: a server that accepts a second answer. */
import { expect, test, vi } from "vite-plus/test";
import type { AgentJobState } from "@models/agent/agent-wire.ts";

/* The server: answers are accepted; each poll returns the next state. */
let polls: AgentJobState[] = [];
const serve = (states: AgentJobState[]): void => {
	polls = [...states];
};
vi.mock("@api/chat.ts", () => ({
	answerChatAgent: async () => ({ jobId: "job-1" }),
	pollChatAgent: async () => (polls.length > 1 ? polls.shift()! : polls[0]!),
	cancelChatRun: async () => ({ jobId: "job-1", status: "cancelled" }),
	getCurrentChatJob: async () => null,
	resumeChatRun: async () => ({ jobId: "job-1", status: "running" }),
	startChatAgent: async () => ({ jobId: "job-1" }),
}));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useContentAgent } = await import("./use-content-agent.ts");
import type { ContentAgent } from "./use-content-agent.ts";

const state = (status: AgentJobState["status"]): AgentJobState => ({
	status,
	events: [],
	scenes: [],
	slides: [],
	posts: [],
	textOverlays: [],
	videoOverlays: [],
	audioOverlays: [],
	characters: [],
	artifacts: [],
	error: status === "error" ? "Run interrupted" : null,
	commands: [{ type: "clip.remove", id: "scene:1" }],
});

async function mount(): Promise<{
	agent: () => ContentAgent;
	settled: Array<{ running: boolean }>;
	unmount: () => Promise<void>;
}> {
	const settled: Array<{ running: boolean }> = [];
	let current!: ContentAgent;
	function Harness() {
		current = useContentAgent({
			projectId: "p1",
			contentType: "video",
			setChatMessages: () => undefined,
			apply: {
				onScenes: (_job, opts) => {
					if (!opts.running) settled.push(opts);
					return { status: "applied", touched: [], undoable: true };
				},
			},
			buildStart: () => ({}),
		});
		return null;
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(<Harness />));
	return {
		agent: () => current,
		settled,
		unmount: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

test("a run that settles twice in one mount is applied once", async () => {
	serve([state("done")]);
	const { agent, settled, unmount } = await mount();
	try {
		await act(async () => {
			await agent().answer("job-1", "yes");
		});
		await act(async () => {
			await agent().answer("job-1", "yes");
		});
		expect(settled).toHaveLength(1);
	} finally {
		await unmount();
	}
}, 15000);

test("an errored run is not marked, so resuming it applies once it settles", async () => {
	serve([state("error"), state("done")]);
	const { agent, settled, unmount } = await mount();
	try {
		await act(async () => {
			await agent().answer("job-1", "yes");
		});
		expect(settled).toHaveLength(0);
		await act(async () => {
			await agent().answer("job-1", "yes");
		});
		expect(settled).toHaveLength(1);
	} finally {
		await unmount();
	}
}, 15000);
