// @vitest-environment happy-dom
/* The new canonical primitives: what each one announces and exposes. Their
 * look is checked in Storybook; here the contract is behaviour and ARIA. */
import { afterEach, describe, expect, it } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Spinner } = await import("./spinner.tsx");
const { Progress } = await import("./progress.tsx");
const { Separator } = await import("./separator.tsx");
const { Toggle, ToggleGroup, ToggleGroupItem } = await import("./toggle-group.tsx");
import type { ReactElement } from "react";

let unmount: (() => void) | undefined;
function mount(element: ReactElement): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(element));
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	return host;
}
afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe("Spinner", () => {
	it("is decorative without a label", () => {
		const host = mount(<Spinner />);
		expect(host.querySelector('[data-slot="spinner"]')?.getAttribute("aria-hidden")).toBe("true");
		expect(host.querySelector('[role="status"]')).toBeNull();
	});
	it("announces itself politely when labelled", () => {
		const host = mount(<Spinner label="Rendering" />);
		const status = host.querySelector('[role="status"]')!;
		expect(status.getAttribute("aria-label")).toBe("Rendering");
	});
});

describe("Progress", () => {
	it("is a named progressbar with its value", () => {
		const host = mount(<Progress label="Render" value={40} />);
		const bar = host.querySelector('[role="progressbar"]')!;
		expect(bar.getAttribute("aria-valuenow")).toBe("40");
		expect(bar.getAttribute("aria-labelledby") ?? bar.getAttribute("aria-label")).toBeTruthy();
	});
	it("has no value while indeterminate", () => {
		const host = mount(<Progress label="Uploading" value={null} />);
		expect(host.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
	});
});

describe("Separator", () => {
	it("exposes its orientation", () => {
		const host = mount(<Separator orientation="vertical" />);
		const sep = host.querySelector('[role="separator"]')!;
		expect(sep.getAttribute("aria-orientation")).toBe("vertical");
	});
});

describe("ToggleGroup", () => {
	function Fit() {
		const [fit, setFit] = useState("cover");
		return (
			<ToggleGroup aria-label="Fit" value={fit} onValueChange={setFit}>
				{["contain", "cover", "stretch"].map((f) => (
					<ToggleGroupItem key={f} value={f}>
						{f}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		);
	}
	it("presses exactly one option and moves the selection on click", () => {
		const host = mount(<Fit />);
		const pressed = (): string[] =>
			[...host.querySelectorAll("button")]
				.filter((b) => b.getAttribute("aria-pressed") === "true")
				.map((b) => b.textContent ?? "");
		expect(pressed()).toEqual(["cover"]);
		act(() =>
			[...host.querySelectorAll("button")].find((b) => b.textContent === "stretch")!.click(),
		);
		expect(pressed()).toEqual(["stretch"]);
	});
	it("does not let the single choice be cleared", () => {
		const host = mount(<Fit />);
		act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "cover")!.click());
		expect(
			[...host.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent),
		).toEqual(["cover"]);
	});
	it("is a named group", () => {
		const host = mount(<Fit />);
		expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Fit");
	});
});

describe("Toggle", () => {
	it("announces and flips its pressed state", () => {
		function Reverse() {
			const [on, setOn] = useState(false);
			return (
				<Toggle pressed={on} onPressedChange={setOn}>
					Reverse
				</Toggle>
			);
		}
		const host = mount(<Reverse />);
		const button = host.querySelector("button")!;
		expect(button.getAttribute("aria-pressed")).toBe("false");
		act(() => button.click());
		expect(button.getAttribute("aria-pressed")).toBe("true");
	});
});
