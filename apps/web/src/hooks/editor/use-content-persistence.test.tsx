// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EMPTY_CREATIVE_DIRECTION } from "@maleo/shared";
import { DEFAULT_SETTINGS } from "@models/presets/creative-settings.ts";
import { DEFAULT_PACING_DEVICES } from "@models/presets/generation-defaults.ts";
import { useContentPersistence, type ContentPersistence } from "./use-content-persistence.ts";
import {
	parseLoadedProject,
	type EditorStateJson,
} from "@models/storyboard/parse-loaded-project.ts";
import { useChatSession, type ContentChat } from "./use-chat-session.ts";

const api = vi.hoisted(() => ({ put: vi.fn(), post: vi.fn() }));
vi.mock("@api/client.ts", () => api);
vi.mock("./use-content-agent.ts", () => ({ useContentAgent: () => ({ running: false }) }));
vi.mock("@api/project-commands.ts", () => ({
	readCommandLog: async () => ({ headStoryboardId: "head" }),
	savePresentation: async () => {},
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Input = Parameters<typeof useContentPersistence>[0];
let root: Root;
let persistence: ContentPersistence;
let input: Input;
let saved: EditorStateJson;
const choice = { providerId: "api", model: "deepseek-flash" };

function Probe() {
	persistence = useContentPersistence(input);
	return null;
}
const render = () =>
	act(async () => {
		root.render(createElement(Probe));
	});

beforeEach(() => {
	vi.useFakeTimers();
	api.put.mockReset().mockImplementation(async (_path, body) => {
		saved = body.editor_state;
	});
	root = createRoot(document.createElement("div"));
	input = {
		projectId: "project-a",
		type: "video",
		commandLog: { flush: async () => {}, pull: async () => {} },
		presentation: { pacingDevices: DEFAULT_PACING_DEVICES, presentation: {} },
		editorState: {
			chatMessages: [{ id: 1, role: "user", text: "Keep this" }],
			settings: DEFAULT_SETTINGS,
			trackFlags: {},
			hookVariants: [],
			direction: EMPTY_CREATIVE_DIRECTION,
			elementSources: {},
			renderOverrides: {},
			activePresetId: "preset",
			decisions: [],
		},
		config: {},
		setSaveState: vi.fn(),
		setSaveError: vi.fn(),
	};
});
afterEach(async () => {
	await act(async () => root.unmount());
	vi.useRealTimers();
});

test("serializes delayed autosave before immediate selection and restores acknowledged preference", async () => {
	await render();
	let release!: () => void;
	api.put.mockImplementationOnce(async (_path, body) => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		saved = body.editor_state;
	});
	input = { ...input, editorState: { ...input.editorState, activePresetId: "edited" } };
	await render();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1200);
	});
	expect(api.put).toHaveBeenCalledTimes(1);
	let acknowledged = false;
	const flush = persistence.flushEditorState({ chatModelSelection: choice }).then(() => {
		acknowledged = true;
	});
	await Promise.resolve();
	expect(api.put).toHaveBeenCalledTimes(1);
	expect(acknowledged).toBe(false);
	release();
	await flush;
	expect(acknowledged).toBe(true);
	expect(saved).toMatchObject({
		chatModelSelection: choice,
		chat: input.editorState.chatMessages,
		active_preset_id: "edited",
		decisions: [],
		element_sources: {},
		render_overrides: {},
	});
	const restored = parseLoadedProject({
		project: {
			id: "project-a",
			title: "Test",
			type: "video",
			target_audience: null,
			target_duration_sec: null,
			target_format: null,
			target_platform: null,
			brief_json: null,
			editor_state_json: saved,
		},
		storyboards: [],
	});
	expect(restored.chatModelSelection).toEqual(choice);
	input = { ...input, editorState: { ...input.editorState, chatModelSelection: choice } };
	await render();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1200);
	});
	expect(saved.chatModelSelection).toEqual(choice);
});

test("failed writes do not block Retry or later preference writes", async () => {
	await render();
	api.put.mockRejectedValueOnce(new Error("offline"));
	await expect(persistence.flushEditorState({ chatModelSelection: choice })).rejects.toThrow(
		"offline",
	);
	await act(async () => persistence.retrySave());
	expect(saved.chatModelSelection).toEqual(choice);
	expect(input.setSaveState).toHaveBeenLastCalledWith("saved");
});

test("project switch writes new project's preference without copying previous selection", async () => {
	await render();
	await persistence.flushEditorState({ chatModelSelection: choice });
	input = {
		...input,
		projectId: "project-b",
		editorState: { ...input.editorState, chatModelSelection: undefined },
	};
	await render();
	await persistence.flushEditorState();
	expect(api.put).toHaveBeenLastCalledWith(
		expect.stringContaining("project-b/editor-state"),
		expect.objectContaining({
			editor_state: expect.objectContaining({ chatModelSelection: undefined }),
		}),
	);
});

test("chat session clears project preference when project changes", async () => {
	let chat: ContentChat | undefined;
	function Session({ projectId }: { projectId: string }) {
		chat = useChatSession({
			projectId,
			contentType: "video",
			apply: {},
			buildStart: () => ({}),
			onRunStart: () => {},
		});
		return null;
	}
	await act(async () => root.render(createElement(Session, { projectId: "project-a" })));
	await act(async () => chat!.setChatModelSelection(choice));
	expect(chat!.chatModelSelection).toEqual(choice);
	await act(async () => root.render(createElement(Session, { projectId: "project-b" })));
	expect(chat!.chatModelSelection).toBeUndefined();
});
