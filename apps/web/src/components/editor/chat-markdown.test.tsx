import { describe, expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "./chat-markdown.tsx";

const html = (text: string): string => renderToStaticMarkup(<ChatMarkdown text={text} />);

describe("ChatMarkdown", () => {
	test("renders bold, italic, and inline code", () => {
		const out = html("Make it **punchy** and *tight* with `cut`");
		expect(out).toContain("<strong>punchy</strong>");
		expect(out).toContain("<em>tight</em>");
		expect(out).toContain("cut</code>");
	});

	test("groups consecutive dashes into a bullet list", () => {
		const out = html("- first\n- second");
		expect(out).toContain("<ul");
		expect(out).toMatch(/<li[^>]*>first<\/li>/);
		expect(out).toMatch(/<li[^>]*>second<\/li>/);
	});

	test("renders ordered lists", () => {
		const out = html("1. one\n2. two");
		expect(out).toContain("<ol");
	});

	test("separates paragraphs on blank lines", () => {
		const out = html("para one\n\npara two");
		expect(out.match(/<p/g)?.length).toBe(2);
	});

	test("keeps safe http links and strips javascript URIs", () => {
		const safe = html("see [docs](https://example.com)");
		expect(safe).toContain('href="https://example.com"');
		const unsafe = html("[x](javascript:alert(1))");
		expect(unsafe).not.toContain("href");
		expect(unsafe).toContain("[x](javascript:alert(1))");
	});

	test("escapes HTML — no raw injection", () => {
		const out = html("<img src=x onerror=alert(1)>");
		expect(out).not.toContain("<img");
		expect(out).toContain("&lt;img");
	});
});
