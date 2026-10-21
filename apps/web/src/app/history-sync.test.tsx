// @vitest-environment happy-dom
import { expect, test, vi } from "vite-plus/test";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useHistorySync } = await import("./history-sync.ts");
const { pathToView } = await import("@models/core/routing.ts");
test("Sheet pop at same URL does not consume subsequent route navigation", async () => {
	window.location.href = "http://localhost/content";
	history.replaceState(null, "", "/content");
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	function Harness() {
		const [view, setView] = useState(() => pathToView("/content", ""));
		useHistorySync(view, setView);
		return <button onClick={() => setView(pathToView("/create", ""))}>Create</button>;
	}
	try {
		await act(async () => root.render(<Harness />));
		await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
		history.pushState({ uiSheet: true }, "", "/content");
		await act(async () => host.querySelector("button")!.click());
		expect(location.pathname).toBe("/create");
		expect(history.state).toBeNull();
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

test("explorer query edits replace history; inspection pushes and Back waits for popstate", async () => {
	window.location.href = "http://localhost/god/pipelines/workflows/workflow%3Aplan_story";
	history.replaceState(null, "", location.pathname);
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const push = vi.spyOn(history, "pushState");
	const replace = vi.spyOn(history, "replaceState");
	const back = vi.spyOn(history, "back").mockImplementation(() => {});
	function Harness() {
		const [view, setView] = useState(() => pathToView(location.pathname, location.search));
		const navigate = useHistorySync(view, setView);
		return (
			<>
				<button
					data-query
					onClick={() =>
						navigate(
							pathToView("/god/pipelines/workflows/workflow%3Aplan_story", "?q=clarify"),
							"replace",
						)
					}
				>
					Query
				</button>
				<button
					data-inspect
					onClick={() =>
						navigate(
							pathToView(
								"/god/pipelines/workflows/workflow%3Aplan_story",
								"?q=clarify&inspect=prompt%3Atest",
							),
						)
					}
				>
					Inspect
				</button>
				<button
					data-close
					onClick={() =>
						navigate(
							pathToView("/god/pipelines/workflows/workflow%3Aplan_story", "?q=clarify"),
							"close",
						)
					}
				>
					Close
				</button>
			</>
		);
	}
	try {
		await act(async () => root.render(<Harness />));
		await act(async () => host.querySelector<HTMLButtonElement>("[data-query]")!.click());
		expect(replace).toHaveBeenCalledTimes(1);
		expect(push).not.toHaveBeenCalled();
		const background = location.pathname + location.search;
		await act(async () => host.querySelector<HTMLButtonElement>("[data-inspect]")!.click());
		expect(push).toHaveBeenCalledTimes(1);
		expect(history.state.explorerPrevious).toBe(background);
		await act(async () => host.querySelector<HTMLButtonElement>("[data-close]")!.click());
		expect(back).toHaveBeenCalledTimes(1);
		expect(new URLSearchParams(location.search).get("inspect")).toBe("prompt:test");
	} finally {
		push.mockRestore();
		replace.mockRestore();
		back.mockRestore();
		await act(async () => root.unmount());
		host.remove();
	}
});

test("normalizing legacy explorer URLs preserves Back metadata across reload", async () => {
	window.location.href = "http://localhost/god/pipelines/definitions/prompts?inspect=prompt%3Atest";
	const prior = { explorerPrevious: "/god/pipelines/instructions" };
	history.replaceState(prior, "", location.pathname + location.search);
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	function Harness() {
		const [view, setView] = useState(() => pathToView(location.pathname, location.search));
		useHistorySync(view, setView);
		return null;
	}
	try {
		await act(async () => root.render(<Harness />));
		expect(location.pathname).toBe("/god/pipelines/instructions");
		expect(history.state).toEqual(prior);
		expect(new URLSearchParams(location.search).get("inspect")).toBe("prompt:test");
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});
