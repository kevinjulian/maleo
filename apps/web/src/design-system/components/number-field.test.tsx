// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { NumberField, scrubValue } = await import("./number-field.tsx");
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

describe("scrubValue", () => {
	it("moves one step per pixel from where the drag started", () => {
		expect(scrubValue({ start: 10, pixels: 5, step: 1 })).toBe(15);
		expect(scrubValue({ start: 10, pixels: -3, step: 0.1 })).toBe(9.7);
	});
	it("clamps to the range", () => {
		expect(scrubValue({ start: 90, pixels: 50, step: 1, max: 100 })).toBe(100);
		expect(scrubValue({ start: 0, pixels: -20, step: 1, min: -10 })).toBe(-10);
	});
	it("lands on the step grid without float noise", () => {
		expect(scrubValue({ start: 0.3, pixels: 3, step: 0.1 })).toBe(0.6);
	});
});

describe("NumberField", () => {
	it("is a named spinbutton whose scrub handle stays out of the accessibility tree", () => {
		const host = mount(
			<NumberField aria-label="X offset" icon="X" value={4} onValueChange={() => {}} />,
		);
		const input = host.querySelector("input")!;
		expect(input.type).toBe("number");
		expect(input.getAttribute("aria-label")).toBe("X offset");
		expect(host.querySelector('[data-slot="number-field-icon"]')?.getAttribute("aria-hidden")).toBe(
			"true",
		);
		expect(host.querySelectorAll("button").length).toBe(0);
	});
	it("reports typed numbers and ignores text that is not one", () => {
		const seen: number[] = [];
		const host = mount(
			<NumberField aria-label="Rotation" value={0} onValueChange={(v) => seen.push(v)} />,
		);
		const input = host.querySelector("input")!;
		const type = (text: string): void => {
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
			act(() => {
				setter.call(input, text);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
		};
		type("45");
		type("");
		expect(seen).toEqual([45]);
	});
	it("shows its unit", () => {
		const host = mount(
			<NumberField aria-label="Opacity" suffix="%" value={50} onValueChange={() => {}} />,
		);
		expect(host.textContent).toContain("%");
	});
	it("scrubs from its short label with a resize cursor, and commits once on release", () => {
		const seen: number[] = [];
		let commits = 0;
		const host = mount(
			<NumberField
				aria-label="Width"
				icon="W"
				value={50}
				onValueChange={(v) => seen.push(v)}
				onScrubEnd={() => {
					commits += 1;
				}}
			/>,
		);
		const handle = host.querySelector<HTMLElement>('[data-slot="number-field-icon"]')!;
		expect(handle.className).toContain("cursor-ew-resize");
		const pointer = (type: string, init: Record<string, number>): void => {
			act(() => {
				handle.dispatchEvent(
					Object.assign(new MouseEvent(type, { bubbles: true, button: 0 }), {
						pointerId: 1,
						...init,
					}),
				);
			});
		};
		handle.setPointerCapture = () => {};
		pointer("pointerdown", {});
		pointer("pointermove", { movementX: 3 });
		pointer("pointerup", {});
		expect(seen.at(-1)).toBe(53);
		expect(commits).toBe(1);
	});
});
