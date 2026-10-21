import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptComposer, type PromptComposerProps } from "./prompt-composer.tsx";

const html = (over: Partial<PromptComposerProps> = {}): string =>
	renderToStaticMarkup(
		<PromptComposer
			label="Instruction"
			value=""
			onValueChange={() => {}}
			onSubmit={() => {}}
			submitLabel="Send"
			{...over}
		/>,
	);
const submit = (out: string): string => out.slice(out.indexOf("<button"), out.indexOf("</button>"));

describe("PromptComposer", () => {
	it("names the entry itself; a placeholder is not a name", () => {
		const out = html({ placeholder: "Describe a change" });
		expect(out).toMatch(/<textarea[^>]*aria-label="Instruction"/);
	});

	it("cannot send an empty draft, and can send text", () => {
		expect(submit(html())).toMatch(/\sdisabled=""/);
		expect(submit(html({ value: "go" }))).not.toMatch(/\sdisabled=""/);
	});

	it("takes the caller's word on whether a send would be accepted", () => {
		expect(submit(html({ value: "go", canSubmit: false }))).toMatch(/\sdisabled=""/);
	});

	it("reports a send in flight and names it, without dropping out of the tab order", () => {
		const out = submit(
			html({
				value: "go",
				busy: true,
				busyLabel: "Generating image",
				submitLabel: "Generate image",
			}),
		);
		expect(out).toContain('aria-busy="true"');
		expect(out).toContain('aria-label="Generating image"');
		expect(out).not.toMatch(/\sdisabled=""/);
	});

	it("keeps the caller's text: it renders the value it is given and nothing else", () => {
		expect(html({ value: "draft kept" })).toContain(">draft kept</textarea>");
	});

	it("places context above the box and tools inside it", () => {
		const out = html({ context: <i id="ctx" />, tools: <i id="tools" />, popup: <i id="popup" /> });
		const box = out.indexOf('class="ui-prompt-box"');
		expect(out.indexOf('id="ctx"')).toBeLessThan(box);
		expect(out.indexOf('id="tools"')).toBeGreaterThan(box);
		expect(out.indexOf('id="popup"')).toBeGreaterThan(box);
	});
});
