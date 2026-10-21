import { describe, expect, it } from "vite-plus/test";
import {
	detectCommandTrigger,
	expandCommandPrompt,
	filterChatCommands,
	insertCommandPrompt,
	type ChatCommandOption,
} from "./editor-chat.tsx";

describe("chat command autocomplete", () => {
	const commands: ChatCommandOption[] = [
		{
			id: "story",
			command: "/generate-storyboard",
			intent: "Generate storyboard from saved brief",
			group: "story",
			prompt: "Generate a storyboard from the saved brief.",
		},
		{
			id: "pace",
			command: "/critique-pacing",
			intent: "Review pacing with timestamped notes",
			group: "review",
			prompt: "Critique pacing with timestamped notes.",
		},
	];

	it("detects slash command trigger after whitespace", () => {
		expect(detectCommandTrigger("/gen", 4)).toEqual({ slashIdx: 0, query: "gen" });
		expect(detectCommandTrigger("please /crit", "please /crit".length)).toEqual({
			slashIdx: 7,
			query: "crit",
		});
		expect(detectCommandTrigger("http://x", "http://x".length)).toBeNull();
	});

	it("filters and inserts command prompts", () => {
		expect(filterChatCommands(commands, "pacing").map((c) => c.id)).toEqual(["pace"]);
		const trigger = detectCommandTrigger("please /gen", "please /gen".length)!;
		const next = insertCommandPrompt("please /gen", trigger, commands[0]!);
		expect(next.value).toBe(
			"please /generate-storyboard\nGenerate a storyboard from the saved brief.",
		);
		expect(next.cursor).toBe(next.value.length);
	});

	it("expands manually typed slash commands before sending", () => {
		expect(expandCommandPrompt("/generate-storyboard kerja pintar", commands)).toBe(
			"/generate-storyboard\nGenerate a storyboard from the saved brief.\n\nUser direction: kerja pintar",
		);
	});
});
