import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessage, ToolCall } from "./chat.tsx";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);

describe("ChatMessage", () => {
	it("marks who spoke", () => {
		expect(html(<ChatMessage speaker="user">hi</ChatMessage>)).toContain('data-speaker="user"');
		expect(html(<ChatMessage speaker="assistant">hi</ChatMessage>)).toContain(
			'data-speaker="assistant"',
		);
	});

	it("labels an assistant message whose change did not land", () => {
		const out = html(
			<ChatMessage speaker="assistant" held="Proposed, not applied">
				Rewrote slide two.
			</ChatMessage>,
		);
		expect(out).toContain("data-held");
		expect(out.indexOf("Proposed, not applied")).toBeLessThan(out.indexOf("Rewrote slide two."));
		expect(html(<ChatMessage speaker="assistant">ok</ChatMessage>)).not.toContain("data-held");
	});

	it("is pressable only when it is given somewhere to go, and says where", () => {
		const out = html(
			<ChatMessage speaker="assistant" action={{ label: "Jump to clip", onPress: () => {} }}>
				Scene 2
			</ChatMessage>,
		);
		expect(out).toMatch(/<button[^>]*title="Jump to clip"[^>]*>Scene 2<\/button>/);
	});

	it("renders what it is given and nothing interactive of its own", () => {
		expect(
			html(
				<ChatMessage speaker="assistant">
					<em>done</em>
				</ChatMessage>,
			),
		).not.toMatch(/<button|<a /);
	});
});

describe("ToolCall", () => {
	it("states the lifecycle in words, not only in colour", () => {
		expect(html(<ToolCall name="patch scene" status="running" />)).toContain("running patch scene");
		expect(html(<ToolCall name="patch scene" status="done" />)).toContain("called patch scene");
		expect(html(<ToolCall name="patch scene" status="error" />)).toContain("failed patch scene");
	});

	it("shows activity only while running", () => {
		expect(html(<ToolCall name="x" status="running" />)).toContain('data-slot="spinner"');
		expect(html(<ToolCall name="x" status="done" />)).not.toContain('data-slot="spinner"');
	});

	it("shows the one safe note and any previews it is given", () => {
		const out = html(
			<ToolCall
				name="generate image"
				status="done"
				note="2 frames"
				thumbs={["/a.png", "/b.png"]}
			/>,
		);
		expect(out).toContain("2 frames");
		expect(out.match(/<img/g)).toHaveLength(2);
		expect(html(<ToolCall name="x" status="done" />)).not.toContain("ui-chat-tool-note");
	});
});
