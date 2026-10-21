// @vitest-environment happy-dom
/* The switcher is also the way into the workspace surface: the sidebar no
 * longer has a "Manage" section, so settings and members are reached from its
 * menu, and the trigger is what says the surface is open. */
import { afterAll, afterEach, describe, expect, test } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});
globalThis.fetch = (() =>
	Promise.resolve(
		new Response(JSON.stringify({ items: [] }), {
			headers: { "content-type": "application/json" },
		}),
	)) as unknown as typeof fetch;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { WorkspaceSwitcher } = await import("./workspace-switcher.tsx");

let unmount: (() => void) | undefined;
afterEach(() => {
	unmount?.();
	unmount = undefined;
	document.body.innerHTML = "";
});

async function render(props: Parameters<typeof WorkspaceSwitcher>[0]): Promise<void> {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(createElement(WorkspaceSwitcher, props));
	});
	unmount = () => act(() => root.unmount());
}

/* Opening the popup and choosing Members / Workspace settings is driven in a
 * real browser by visual/account-shell.spec.ts: Base UI fixes its layout-effect
 * hook at first import, and bun shares modules across test files. */
describe("the switcher leads into the workspace surface", () => {
	test("the trigger says so while the surface is open", async () => {
		await render({ current: true });
		expect(document.querySelector('[aria-current="page"]')).not.toBeNull();
	});

	test("and does not claim it otherwise", async () => {
		await render({});
		expect(document.querySelector('[aria-current="page"]')).toBeNull();
	});
});
