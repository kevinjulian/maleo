// @vitest-environment happy-dom
/* The Inspector pattern contract, as behaviour rather than class strings.
 *
 * docs/design-system/patterns/property-row.md and inspector-section.md are the
 * specification. What is held here is the part a screenshot cannot show:
 * which element names which control, what the disclosure announces, and that a
 * section action is never a button inside the disclosure button.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AmountField, FieldRow, InspectorSection, PropertyRow } = await import("./inspector.tsx");
const { Input } = await import("@design-system/components/input.tsx");
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

describe("PropertyRow", () => {
	it("labels the control it wraps", () => {
		const host = mount(
			<PropertyRow label="Rotation">
				<Input type="number" defaultValue={0} />
			</PropertyRow>,
		);
		const input = host.querySelector("input")!;
		expect(input.closest("label")?.textContent).toContain("Rotation");
	});

	it("names a compound control as a group, leaving each control its own name", () => {
		const host = mount(
			<PropertyRow label="Position" as="div">
				<Input aria-label="X position" />
				<Input aria-label="Y position" />
			</PropertyRow>,
		);
		const group = host.querySelector('[role="group"]')!;
		const labelId = group.getAttribute("aria-labelledby")!;
		expect(document.getElementById(labelId)?.textContent).toBe("Position");
		expect(host.querySelector("label")).toBeNull();
		expect([...host.querySelectorAll("input")].map((i) => i.getAttribute("aria-label"))).toEqual([
			"X position",
			"Y position",
		]);
	});

	it("renders a reset named for its property, outside the label", () => {
		let resets = 0;
		const host = mount(
			<PropertyRow
				label="Opacity"
				onReset={() => {
					resets += 1;
				}}
			>
				<Input />
			</PropertyRow>,
		);
		const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset Opacity"]')!;
		expect(reset).not.toBeNull();
		expect(reset.closest("label")).toBeNull();
		act(() => reset.click());
		expect(resets).toBe(1);
	});

	it("renders no reset for a property that is not resettable", () => {
		const host = mount(
			<PropertyRow label="Opacity">
				<Input />
			</PropertyRow>,
		);
		expect(host.querySelector('[data-slot="property-row-reset"]')?.childElementCount).toBe(0);
		expect(host.querySelector("button")).toBeNull();
	});
});

describe("FieldRow", () => {
	it("is one named group whose scrubbable cells keep their property names, with no slider", () => {
		let resets = 0;
		const host = mount(
			<FieldRow
				label="Position"
				onReset={() => {
					resets += 1;
				}}
			>
				<AmountField label="X offset" short="X" value={10} suffix="%" onChange={() => {}} />
				<AmountField
					label="Y offset"
					short="Y"
					value={0.30000000000000004}
					step={0.1}
					onChange={() => {}}
				/>
			</FieldRow>,
		);
		const group = host.querySelector('[role="group"]')!;
		expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toBe(
			"Position",
		);
		const inputs = [...host.querySelectorAll("input")];
		expect(inputs.map((i) => i.getAttribute("aria-label"))).toEqual(["X offset", "Y offset"]);
		expect(inputs[1]!.value).toBe("0.3");
		expect(host.querySelectorAll('[data-slot="number-field-icon"]').length).toBe(2);
		expect(host.querySelector('input[type="range"], [data-slot="slider"]')).toBeNull();
		act(() =>
			host.querySelector<HTMLButtonElement>('button[aria-label="Reset Position"]')!.click(),
		);
		expect(resets).toBe(1);
	});
});

describe("InspectorSection", () => {
	it("names a static section by its heading", () => {
		const host = mount(
			<InspectorSection title="Transform">
				<p>body</p>
			</InspectorSection>,
		);
		const section = host.querySelector("section")!;
		const heading = document.getElementById(section.getAttribute("aria-labelledby")!);
		expect(heading?.tagName).toBe("H3");
		expect(heading?.textContent).toBe("Transform");
		expect(host.querySelector("button")).toBeNull();
	});

	it("discloses through a named button that reports and controls its body", () => {
		const host = mount(
			<InspectorSection title="Playback" collapsible>
				<p>body</p>
			</InspectorSection>,
		);
		const toggle = host.querySelector<HTMLButtonElement>("h3 button")!;
		const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
		expect(toggle.textContent).toContain("Playback");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(body.hidden).toBe(true);
		act(() => toggle.click());
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(body.hidden).toBe(false);
	});

	it("shows current value only while collapsed and keeps the section named by its heading", () => {
		const host = mount(
			<InspectorSection title="Entrance" collapsible summary="Fade">
				<p>body</p>
			</InspectorSection>,
		);
		const section = host.querySelector("section")!;
		const heading = document.getElementById(section.getAttribute("aria-labelledby")!)!;
		const toggle = host.querySelector<HTMLButtonElement>("h3 button")!;
		expect(heading.tagName).toBe("H3");
		expect(heading.getAttribute("aria-label")).toBe("Entrance");
		expect(toggle.textContent).toBe("EntranceFade");
		act(() => toggle.click());
		expect(toggle.textContent).toBe("Entrance");
		act(() => toggle.click());
		expect(toggle.textContent).toBe("EntranceFade");
	});

	it("opens by default when asked", () => {
		const host = mount(
			<InspectorSection title="Position" collapsible defaultOpen>
				<p>body</p>
			</InspectorSection>,
		);
		expect(host.querySelector("h3 button")?.getAttribute("aria-expanded")).toBe("true");
	});

	it("keeps the section action out of the disclosure button", () => {
		const host = mount(
			<InspectorSection
				title="Keyframes"
				collapsible
				action={<button type="button">Add keyframe</button>}
			>
				<p>body</p>
			</InspectorSection>,
		);
		const action = [...host.querySelectorAll("button")].find(
			(b) => b.textContent === "Add keyframe",
		)!;
		expect(action.closest("h3")).toBeNull();
		expect(action.parentElement?.closest("button")).toBeNull();
	});
});
