// @vitest-environment happy-dom
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetched: string[] = [];
const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});
globalThis.fetch = ((input: RequestInfo | URL) => {
	fetched.push(String(input));
	return Promise.resolve(new Response("{}", { status: 500 }));
}) as unknown as typeof fetch;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TopBar } = await import("./top-bar.tsx");
const { useSidebarCollapsed } = await import("@hooks/ui/use-sidebar-collapsed.ts");

const USER = { id: "u", email: "m@example.com", name: "Member" };
let unmount: (() => void) | undefined;
beforeEach(() => {
	fetched.length = 0;
	window.localStorage.clear();
});
afterEach(() => {
	unmount?.();
	unmount = undefined;
	document.body.innerHTML = "";
});

async function mount(element: ReturnType<typeof createElement>): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(element);
	});
	unmount = () => act(() => root.unmount());
	return host;
}

const noop = () => {};
const bar = (over: Record<string, unknown> = {}) =>
	createElement(TopBar, {
		title: "Images",
		user: USER,
		onOpenAccount: noop,
		onSearch: noop,
		onOpenDrawer: noop,
		onToggleSidebar: noop,
		sidebarCollapsed: false,
		credits: false,
		...over,
	});

describe("the top bar", () => {
	test("the search control opens the palette", async () => {
		let searched = 0;
		const host = await mount(
			bar({
				onSearch: () => {
					searched += 1;
				},
			}),
		);
		await act(async () => {
			(host.querySelector('[aria-label^="Search"]') as HTMLButtonElement).click();
		});
		expect(searched).toBe(1);
	});

	test("without credits (God Mode) no credit summary is requested", async () => {
		await mount(bar({ credits: false }));
		expect(fetched.some((url) => url.includes("credit"))).toBe(false);
	});

	test("with credits the summary is requested", async () => {
		await mount(bar({ credits: true }));
		expect(fetched.some((url) => url.includes("credit"))).toBe(true);
	});

	test("the sidebar toggle reports its state", async () => {
		let toggled = 0;
		const host = await mount(
			bar({
				sidebarCollapsed: true,
				onToggleSidebar: () => {
					toggled += 1;
				},
			}),
		);
		const toggle = host.querySelector('[aria-label="expand sidebar"]') as HTMLButtonElement;
		await act(async () => {
			toggle.click();
		});
		expect(toggled).toBe(1);
	});
});

describe("the sidebar collapse is remembered", () => {
	function Probe() {
		const [collapsed, toggle] = useSidebarCollapsed();
		return createElement("button", { onClick: toggle }, collapsed ? "collapsed" : "expanded");
	}

	test("a collapse survives a remount", async () => {
		let host = await mount(createElement(Probe));
		expect(host.textContent).toBe("expanded");
		await act(async () => {
			host.querySelector("button")!.click();
		});
		unmount?.();
		host = await mount(createElement(Probe));
		expect(host.textContent).toBe("collapsed");
	});
});
