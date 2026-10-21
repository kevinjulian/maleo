// @vitest-environment happy-dom
/* Captions as grouped rows (inspector-field-layout): no sliders, related values share
 * a row, and each field writes the same caption config key it always did. */
import { afterEach, expect, test } from "vite-plus/test";
import type { CaptionConfig } from "@maleo/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DEFAULT_CAPTIONS } = await import("@maleo/shared");
const { CaptionsPanel } = await import("./editor-captions.tsx");

let unmount: (() => void) | undefined;
afterEach(() => {
	unmount?.();
	unmount = undefined;
});

test("caption values are scrubbable fields in shared rows that write their own keys", () => {
	const seen: CaptionConfig[] = [];
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() =>
		root.render(
			<CaptionsPanel
				value={{ ...DEFAULT_CAPTIONS, enabled: true }}
				onChange={(next) => seen.push(next)}
				onClose={() => {}}
			/>,
		),
	);
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	act(() => {
		const style = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
			(tab) => tab.textContent === "Style",
		)!;
		style.click();
	});
	expect(host.querySelector('input[type="range"], [data-slot="slider"]')).toBeNull();
	const rowOf = (name: string) =>
		[
			...host
				.querySelector(`input[aria-label="${name}"]`)!
				.closest('[data-slot="property-row"]')!
				.querySelectorAll("input"),
		].map((i) => i.getAttribute("aria-label"));
	expect(rowOf("Vertical position")).toEqual(["Vertical position", "Max width"]);
	expect(rowOf("Shadow blur")).toEqual(["Shadow blur", "Shadow distance", "Shadow opacity"]);
	const input = host.querySelector<HTMLInputElement>('input[aria-label="Max width"]')!;
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "80");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	expect(seen.at(-1)).toEqual({ ...DEFAULT_CAPTIONS, enabled: true, maxWidth: 80 });
});

test("style scope is a switch: This caption is disabled with a reason until a cue is selected", () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const render = (selected: boolean) =>
		act(() =>
			root.render(
				<CaptionsPanel
					value={{ ...DEFAULT_CAPTIONS, enabled: true }}
					onChange={() => {}}
					onClose={() => {}}
					selectedStyle={
						selected
							? { value: DEFAULT_CAPTIONS, onChange: () => {}, onReset: () => {} }
							: undefined
					}
				/>,
			),
		);
	render(false);
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	act(() => {
		[...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
			.find((tab) => tab.textContent === "Style")!
			.click();
	});
	const scope = () =>
		[...host.querySelectorAll<HTMLButtonElement>("button")].find(
			(button) => button.textContent === "This caption",
		)!;
	expect(scope().hasAttribute("disabled") || scope().getAttribute("aria-disabled") === "true").toBe(
		true,
	);
	expect(host.textContent).toContain("Select a caption to style it on its own.");
	render(true);
	expect(scope().hasAttribute("disabled")).toBe(false);
	expect(host.textContent).not.toContain("Select a caption to style it on its own.");
});

test("presets name their motion and preview fill and highlight colours", () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() =>
		root.render(
			<CaptionsPanel
				value={{ ...DEFAULT_CAPTIONS, enabled: true }}
				onChange={() => {}}
				onClose={() => {}}
			/>,
		),
	);
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	act(() => {
		[...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
			.find((tab) => tab.textContent === "Style")!
			.click();
	});
	const punch = host.querySelector<HTMLButtonElement>('[aria-label="Punch preset, Pop motion"]')!;
	expect(punch.textContent).toContain("Punch · Pop");
	const preview = punch.querySelector<HTMLElement>(".fc-cap-preview")!;
	expect(preview.style.color).toBe("#ffffff");
	expect(preview.querySelector("span")!.style.color).toBe("#ffd400");
});
