// @vitest-environment happy-dom
/* Masks and Adjust as grouped rows (inspector-field-layout): the mask size lock keeps
 * the ratio inside the frame and is never written to the layout, and Adjust is one
 * row with one reset. */
import { afterEach, expect, test } from "vite-plus/test";
import type { ClipLayout } from "@maleo/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ClipCompositingFields } = await import("./clip-compositing-control.tsx");

let unmount: (() => void) | undefined;
afterEach(() => {
	unmount?.();
	unmount = undefined;
});

const MASK = {
	shape: "rectangle" as const,
	xPct: 10,
	yPct: 10,
	widthPct: 40,
	heightPct: 20,
	rotationDeg: 0,
	featherPct: 0,
	inverted: false,
};

function mount(initial: Partial<ClipLayout>) {
	const writes: Partial<ClipLayout>[] = [];
	const latest: { layout: Partial<ClipLayout> } = { layout: initial };
	function Harness() {
		const [layout, setLayout] = useState(initial);
		latest.layout = layout;
		return (
			<ClipCompositingFields
				layout={layout}
				onChange={(patch) => {
					writes.push(patch);
					setLayout((prev) => ({ ...prev, ...patch }));
				}}
			/>
		);
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(<Harness />));
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	const field = (name: string) =>
		host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
	const type = (name: string, value: number) =>
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
				field(name),
				String(value),
			);
			field(name).dispatchEvent(new Event("input", { bubbles: true }));
		});
	const button = (name: string) =>
		host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
	return { host, writes, latest, field, type, button };
}

test("a locked mask is driven by width, keeps its ratio inside the frame, and the lock is not written to the layout", () => {
	const ui = mount({ mask: MASK });
	act(() => ui.button("Lock mask aspect ratio").click());
	expect(ui.field("Mask height").disabled).toBe(true);
	ui.type("Mask width", 60);
	expect(ui.latest.layout.mask).toMatchObject({ widthPct: 60, heightPct: 30 });
	ui.type("Mask width", 200);
	expect(ui.latest.layout.mask!.widthPct).toBeCloseTo(90, 6);
	expect(ui.latest.layout.mask!.heightPct).toBeCloseTo(45, 6);
	expect(ui.writes.every((patch) => Object.keys(patch).every((key) => key === "mask"))).toBe(true);
	expect(JSON.stringify(ui.writes)).not.toContain("lock");
});

test("an unlocked mask edits width alone, and a fresh mount starts unlocked", () => {
	const ui = mount({ mask: MASK });
	expect(ui.button("Lock mask aspect ratio").getAttribute("aria-pressed")).toBe("false");
	ui.type("Mask width", 60);
	expect(ui.latest.layout.mask).toMatchObject({ widthPct: 60, heightPct: 20 });
});

test("Adjust is one row of three fields with one reset for the row", () => {
	const ui = mount({ color: { brightness: 1.5, contrast: 1.2, saturation: 0.5 } });
	const row = ui.field("brightness").closest('[data-slot="property-row"]')!;
	expect(
		[...row.querySelectorAll("input")].map((input) => input.getAttribute("aria-label")),
	).toEqual(["brightness", "contrast", "saturation"]);
	act(() => row.querySelector<HTMLButtonElement>('button[aria-label="Reset Adjust"]')!.click());
	expect(ui.latest.layout.color).toEqual({ brightness: 1, contrast: 1, saturation: 1 });
	expect(ui.host.querySelector('input[type="range"]')).toBeNull();
});
