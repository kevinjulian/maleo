import { describe, expect, test } from "vite-plus/test";
import { backDismissal, type BackEnvironment } from "./back-dismissal.ts";
import { createOverlayStack, type OverlayCloseReason, type OverlayStack } from "./overlay-stack.ts";

/* A history that records what was asked of it, so each case can say exactly
 * how many entries the page holds. `back()` pops and fires popstate the way a
 * browser does: after the call returns. */
function fakeHistory(): BackEnvironment & {
	entries: number;
	pressBack(): Promise<void>;
	navigate(path: string): void;
} {
	const listeners = new Set<() => void>();
	const env = {
		entries: 1,
		location: { pathname: "/content/p1", search: "" },
		history: {
			pushState: () => {
				env.entries += 1;
			},
			back: () => {
				env.entries -= 1;
				queueMicrotask(() => {
					for (const listener of listeners) listener();
				});
			},
		},
		addEventListener: (_type: "popstate", listener: () => void) => {
			listeners.add(listener);
		},
		/* The browser's Back button: the entry is gone before popstate arrives. */
		pressBack: async () => {
			env.entries -= 1;
			for (const listener of listeners) listener();
			await Promise.resolve();
		},
		navigate: (path: string) => {
			env.location.pathname = path;
		},
	};
	return env;
}

function open(
	stack: OverlayStack,
	id: string,
	options: { dismissOnBack: boolean; closed: string[] },
): () => void {
	return stack.push({
		id,
		zOrder: stack.entries().length * 20 + 700,
		modal: true,
		dismissOnBack: options.dismissOnBack,
		onRequestClose: (reason: OverlayCloseReason) => {
			options.closed.push(`${id}:${reason}`);
		},
	});
}

const settle = (): Promise<void> =>
	new Promise((done) => queueMicrotask(() => queueMicrotask(done)));

describe("Back dismissal", () => {
	test("Back closes the topmost sheet only, and the page keeps one entry for the one still open", async () => {
		const env = fakeHistory();
		const stack = createOverlayStack();
		const back = backDismissal(env, stack);
		const closed: string[] = [];
		open(stack, "properties", { dismissOnBack: true, closed });
		const releaseProperties = back.hold("properties");
		open(stack, "tools", { dismissOnBack: true, closed });
		back.hold("tools");
		expect(env.entries).toBe(2);

		await env.pressBack();
		expect(closed).toEqual(["tools:back"]);
		/* The entry Back consumed is put back for the sheet that is still open. */
		expect(env.entries).toBe(2);
		void releaseProperties;
	});

	test("a modal above a sheet absorbs Back instead of closing the hidden sheet", async () => {
		const env = fakeHistory();
		const stack = createOverlayStack();
		const back = backDismissal(env, stack);
		const closed: string[] = [];
		open(stack, "sheet", { dismissOnBack: true, closed });
		back.hold("sheet");
		open(stack, "confirm", { dismissOnBack: false, closed });

		await env.pressBack();
		expect(closed).toEqual([]);
		/* Both stay open, so the sheet's entry is restored. */
		expect(env.entries).toBe(2);
	});

	test("a sheet replacing another in the same commit keeps a single entry", async () => {
		const env = fakeHistory();
		const stack = createOverlayStack();
		const back = backDismissal(env, stack);
		const closed: string[] = [];
		const releaseFirst = open(stack, "first", { dismissOnBack: true, closed });
		const giveBackFirst = back.hold("first");
		/* React runs the closing sheet's cleanup and the opening sheet's effect in
		 * one commit. */
		giveBackFirst();
		releaseFirst();
		open(stack, "second", { dismissOnBack: true, closed });
		back.hold("second");
		await settle();
		expect(env.entries).toBe(2);
		expect(closed).toEqual([]);
	});

	test("closing by the UI gives the entry back exactly once", async () => {
		const env = fakeHistory();
		const stack = createOverlayStack();
		const back = backDismissal(env, stack);
		const release = open(stack, "sheet", { dismissOnBack: true, closed: [] });
		const giveBack = back.hold("sheet");
		expect(env.entries).toBe(2);
		giveBack();
		release();
		await settle();
		expect(env.entries).toBe(1);
	});

	test("a sheet closed by Back does not pop a second entry", async () => {
		const env = fakeHistory();
		const stack = createOverlayStack();
		const back = backDismissal(env, stack);
		const closed: string[] = [];
		const release = open(stack, "sheet", { dismissOnBack: true, closed });
		const giveBack = back.hold("sheet");
		await env.pressBack();
		expect(closed).toEqual(["sheet:back"]);
		giveBack();
		release();
		await settle();
		/* Back already took the entry; taking another would leave the editor. */
		expect(env.entries).toBe(1);
	});

	test("an entry is not popped once the route has moved on", async () => {
		const env = fakeHistory();
		const stack = createOverlayStack();
		const back = backDismissal(env, stack);
		const release = open(stack, "sheet", { dismissOnBack: true, closed: [] });
		const giveBack = back.hold("sheet");
		env.navigate("/content/p2");
		giveBack();
		release();
		await settle();
		expect(env.entries).toBe(2);
	});

	test("Back with no held overlay is left to the router", async () => {
		const env = fakeHistory();
		const stack = createOverlayStack();
		backDismissal(env, stack);
		const closed: string[] = [];
		open(stack, "modal", { dismissOnBack: false, closed });
		await env.pressBack();
		expect(closed).toEqual([]);
		expect(env.entries).toBe(0);
	});
});
