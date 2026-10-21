import { expect, test } from "vite-plus/test";
import { renderPromptParts } from "./prompt-fragment.ts";

test("prompt interpolation preserves native conversion and whitespace", () => {
	const values = [undefined, null, ["a", "b"], 0, false];
	expect(renderPromptParts(["\n", "|", "|", "|", "|", "\n"], values)).toBe(
		`\n${values[0]}|${values[1]}|${values[2]}|${values[3]}|${values[4]}\n`,
	);
	expect(() => renderPromptParts([""], ["extra"])).toThrow("interpolation count");
	expect(() => renderPromptParts(["", ""], [Symbol("x")])).toThrow();
});
