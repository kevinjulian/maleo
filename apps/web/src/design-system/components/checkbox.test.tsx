// @vitest-environment happy-dom
import { afterEach, expect, test } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Checkbox } = await import("./checkbox.tsx");

let unmount: (() => void) | undefined;
afterEach(() => {
	unmount?.();
	unmount = undefined;
	document.body.replaceChildren();
});

test("Base UI Checkbox updates controlled state and form value", () => {
	function Form(): React.JSX.Element {
		const [checked, setChecked] = useState(false);
		return createElement(
			"form",
			null,
			createElement(
				"div",
				null,
				createElement(Checkbox, {
					id: "overwrite-control",
					name: "overwrite",
					value: "yes",
					checked,
					onCheckedChange: setChecked,
					"aria-label": "Overwrite edits",
				}),
				createElement("label", { htmlFor: "overwrite-control" }, "Overwrite edits"),
			),
		);
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(createElement(Form)));
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	const form = host.querySelector("form")!;
	const checkbox = host.querySelector<HTMLElement>('[data-slot="checkbox"]')!;
	expect(checkbox.getAttribute("aria-checked")).toBe("false");
	expect(new FormData(form).get("overwrite")).toBeNull();
	act(() => checkbox.click());
	expect(checkbox.getAttribute("aria-checked")).toBe("true");
	expect(new FormData(form).get("overwrite")).toBe("yes");
	act(() => host.querySelector("label")!.click());
	expect(checkbox.getAttribute("aria-checked")).toBe("false");
});
