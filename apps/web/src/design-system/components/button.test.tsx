import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ButtonLabel, ButtonLink } from "./button.tsx";
import { IconButton } from "./icon-button.tsx";

/* The canonical contract: a button's look is its variant and size, carried in
 * the component's own recipe and exposed as data attributes — never a legacy
 * class another stylesheet paints. */
const html = (el: React.ReactElement): string => renderToStaticMarkup(el);
const classOf = (el: React.ReactElement): string => /class="([^"]*)"/.exec(html(el))?.[1] ?? "";

describe("Button", () => {
	it("exposes variant and size as data, defaulting to secondary / md", () => {
		const out = html(<Button>Save</Button>);
		expect(out).toContain('data-slot="button"');
		expect(out).toContain('data-variant="secondary"');
		expect(out).toContain('data-size="md"');
	});

	it("gives every variant its own semantic paint", () => {
		const paint = {
			primary: "tw:bg-primary",
			secondary: "tw:border-border",
			ghost: "tw:bg-transparent",
			danger: "tw:bg-destructive",
		} as const;
		for (const [variant, cls] of Object.entries(paint)) {
			expect(classOf(<Button variant={variant as keyof typeof paint} />)).toContain(cls);
		}
	});

	it("sizes on the control-height tokens, with the touch floor built in", () => {
		expect(classOf(<Button size="sm" />)).toContain("tw:min-h-[var(--control-h-sm)]");
		expect(classOf(<Button />)).toContain("tw:min-h-[var(--control-h)]");
		expect(classOf(<Button />)).toContain("tw:pointer-coarse:min-h-[var(--control-h-touch)]");
	});

	it("defines focus, disabled and pressed states", () => {
		const cls = classOf(<Button variant="secondary" />);
		expect(cls).toContain("tw:focus-visible:outline-ring");
		expect(cls).toContain("tw:disabled:opacity-50");
		expect(cls).toContain("tw:active:bg-pressed");
	});

	it("emits no legacy class for another sheet to paint", () => {
		expect(
			classOf(<Button variant="primary" size="sm" />)
				.split(" ")
				.filter((c) => !c.startsWith("tw:")),
		).toEqual([]);
		expect(classOf(<Button className="cv-rail-close" />)).toContain("cv-rail-close");
	});

	it("announces loading, blocks presses and keeps focus", () => {
		const out = html(<Button loading>Save</Button>);
		expect(out).toContain('aria-busy="true"');
		expect(out).toContain('aria-disabled="true"');
		expect(out).toContain('data-slot="spinner"');
		expect(out).not.toMatch(/\sdisabled=""/);
		expect(html(<Button>Save</Button>)).not.toContain("aria-busy");
	});

	it("forwards disabled and type", () => {
		const out = html(<Button disabled type="submit" />);
		expect(out).toContain("disabled");
		expect(out).toContain('type="submit"');
	});
});

/* The link and the label exist for markup a <button> cannot produce. They must
 * style identically, or three appearances return by another route. */
describe("ButtonLink and ButtonLabel", () => {
	it("style exactly as the button does", () => {
		expect(classOf(<ButtonLink variant="secondary" size="sm" />)).toBe(
			classOf(<Button variant="secondary" size="sm" />),
		);
		expect(classOf(<ButtonLabel variant="danger" size="sm" />)).toBe(
			classOf(<Button variant="danger" size="sm" />),
		);
	});
	it("render the element their call site needs", () => {
		expect(html(<ButtonLink href="/x" />)).toContain("<a ");
		expect(html(<ButtonLabel />)).toContain("<label ");
	});
});

describe("IconButton", () => {
	it("keeps an accessible name and sizes on the control scale", () => {
		const out = html(<IconButton size="micro" aria-label="Remove context" />);
		expect(out).toContain('aria-label="Remove context"');
		expect(out).toContain("tw:size-4");
		expect(classOf(<IconButton size="xs" aria-label="x" />)).toContain(
			"tw:size-[var(--control-h-xs)]",
		);
		expect(classOf(<IconButton size="sm" aria-label="s" />)).toContain(
			"tw:size-[var(--control-h-sm)]",
		);
		expect(classOf(<IconButton aria-label="m" />)).toContain("tw:size-[var(--control-h)]");
	});
	it("announces its pressed state and paints it as selection", () => {
		const out = html(<IconButton on aria-label="Show layers" />);
		expect(out).toContain('aria-pressed="true"');
		expect(classOf(<IconButton on aria-label="On" />)).toContain("tw:bg-[var(--ai-bg)]");
		expect(html(<IconButton on={false} aria-label="Off" />)).toContain('aria-pressed="false"');
		expect(html(<IconButton aria-label="Plain" />)).not.toContain("aria-pressed");
	});
	it("defines danger, pressed-pointer, disabled and focus states without legacy classes", () => {
		const cls = classOf(<IconButton danger aria-label="Delete" />);
		expect(cls).toContain("tw:hover:text-destructive");
		expect(cls).toContain("tw:active:bg-pressed");
		expect(cls).toContain("tw:disabled:opacity-50");
		expect(cls).toContain("tw:focus-visible:outline-ring");
		expect(cls.split(" ").filter((c) => !c.startsWith("tw:"))).toEqual([]);
	});
});
