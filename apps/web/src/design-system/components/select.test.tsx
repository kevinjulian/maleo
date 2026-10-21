// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Select, onSelect } = await import("./select.tsx");
let host: HTMLElement, root: ReturnType<typeof createRoot>;
const options = [
	{ value: "a", label: "Alpha" },
	{ value: "b", label: "Beta", disabled: true },
	{ value: "c", label: "Gamma" },
];
beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});

test("controlled value, unknown value and disabled states retain accessible labels", async () => {
	await act(async () =>
		root.render(
			<label>
				Choice
				<Select options={options} value="missing" disabled name="choice" />
			</label>,
		),
	);
	const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
	expect(trigger.disabled).toBe(true);
	expect(trigger.textContent).toContain("missing (unavailable)");
	expect(trigger.labels?.[0]?.textContent).toContain("Choice");
	expect(host.querySelector<HTMLInputElement>('input[name="choice"]')?.value).toBe("missing");
	await act(async () =>
		root.render(
			<label>
				Choice
				<Select options={options} value="c" name="choice" />
			</label>,
		),
	);
	expect(trigger.textContent).toContain("Gamma");
	expect(trigger.disabled).toBe(false);
});

test("uncontrolled selection participates in FormData and resets to authored default", async () => {
	const changes: string[] = [];
	await act(async () =>
		root.render(
			<form>
				<label>
					Choice
					<Select
						options={options}
						defaultValue="c"
						name="choice"
						onValueChange={(value) => changes.push(value)}
					/>
				</label>
			</form>,
		),
	);
	const form = host.querySelector("form")!;
	expect(new FormData(form).get("choice")).toBe("c");
	await act(async () => form.reset());
	expect(new FormData(form).get("choice")).toBe("c");
	expect(changes).toEqual([]);
});

test("empty options keep placeholder and never invent a submitted value", async () => {
	await act(async () =>
		root.render(
			<Select
				options={[]}
				name="choice"
				aria-label="Choice"
				placeholder="Choose a voice"
				size="xs"
				width="auto"
			/>,
		),
	);
	expect(host.querySelector('[data-slot="select"]')?.textContent).toContain("Choose a voice");
	expect(host.querySelector('[data-slot="select"]')?.getAttribute("data-size")).toBe("xs");
	// Auto width is the absence of the fill utility; no layered rule can undo it.
	expect(host.querySelector('[data-slot="select"]')?.classList.contains("tw:w-full")).toBe(false);
});

test("onSelect validates custom callback values before domain writes", () => {
	const calls: string[] = [];
	const commit = onSelect(["a", "c"] as const, (value) => calls.push(value));
	commit("unknown");
	commit("b");
	commit("c");
	expect(calls).toEqual(["c"]);
});
