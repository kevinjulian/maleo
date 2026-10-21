/* The chat composer's slash-command grammar.
 *
 * Pure string work: what counts as a trigger, which commands match a query,
 * what the composer's value becomes when one is picked, and how a staged
 * prompt expands before it is sent. No React, so it is testable without a
 * renderer — which is how the `@` mention path stayed separable from `/`.
 */
import type { TextInsertion } from "@models/references/mention-matching.ts";

export interface ChatCommandOption {
	id: string;
	command: string;
	intent: string;
	group: string;
	prompt: string;
}

export interface CommandTrigger {
	slashIdx: number;
	query: string;
}

export function detectCommandTrigger(text: string, cursor: number): CommandTrigger | null {
	let i = cursor - 1;
	while (i >= 0) {
		const ch = text[i];
		if (ch === "/") {
			if (i > 0 && !/\s/u.test(text[i - 1] ?? "")) return null;
			return { slashIdx: i, query: text.slice(i + 1, cursor) };
		}
		if (ch === "\n") return null;
		i--;
	}
	return null;
}

export function filterChatCommands(
	commands: ChatCommandOption[],
	query: string,
): ChatCommandOption[] {
	const q = query.trim().toLowerCase();
	return commands.filter((command) => {
		if (!q) return true;
		return (
			command.command.toLowerCase().includes(q) ||
			command.intent.toLowerCase().includes(q) ||
			command.prompt.toLowerCase().includes(q) ||
			command.group.toLowerCase().includes(q)
		);
	});
}

export function insertCommandPrompt(
	text: string,
	trigger: CommandTrigger,
	command: ChatCommandOption,
): TextInsertion {
	const insert = `${command.command}\n${command.prompt}`;
	const value = `${text.slice(0, trigger.slashIdx)}${insert}${text.slice(trigger.slashIdx + 1 + trigger.query.length)}`;
	return { value, cursor: trigger.slashIdx + insert.length };
}

export function expandCommandPrompt(text: string, commands: ChatCommandOption[]): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^(\/[a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
	if (!match) return trimmed;
	const command = commands.find(
		(candidate) => candidate.command.toLowerCase() === match[1]!.toLowerCase(),
	);
	if (!command) return trimmed;
	const extra = (match[2] ?? "").trim();
	const direction = extra
		.split(/\n+/)
		.map((line) => line.trim())
		.filter((line) => line && line !== command.prompt)
		.join("\n");
	if (!direction) return `${command.command}\n${command.prompt}`;
	return `${command.command}\n${command.prompt}\n\nUser direction: ${direction}`;
}
