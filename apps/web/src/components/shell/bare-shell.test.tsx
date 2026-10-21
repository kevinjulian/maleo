// @vitest-environment happy-dom
import { afterEach, expect, test } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BareShell } = await import("./bare-shell.tsx");

let unmount: (() => void) | undefined;
afterEach(() => {
	unmount?.();
	document.body.innerHTML = "";
});

test("the bare shell says where you are, has no sidebar, and its back control leaves", async () => {
	let back = 0;
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			createElement(BareShell, {
				onBack: () => {
					back += 1;
				},
				children: createElement("p", null, "form"),
			}),
		);
	});
	unmount = () => act(() => root.unmount());
	expect(host.querySelector("header")?.textContent).toContain("Account");
	expect(host.querySelector("aside, .sidebar")).toBeNull();
	await act(async () => {
		(host.querySelector('[aria-label="Back"]') as HTMLButtonElement).click();
	});
	expect(back).toBe(1);
});
