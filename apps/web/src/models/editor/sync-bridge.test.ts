import { describe, expect, test } from "vite-plus/test";
import { replaceScope, type EditorCommand, type EditScope } from "@maleo/shared/editor";
import type { CommandSync } from "./command-sync.ts";
import { createSyncBridge } from "./sync-bridge.ts";

const scopeOf = (n: number): EditScope => ({
	doc: { schemaVersion: 2, clips: [], markers: [{ id: n } as never] },
	slides: [],
	posts: [],
	mediaAssets: [],
});
const move: EditorCommand = { type: "clip.move", id: "text:1", patch: { startSec: 1 } };
const back: EditorCommand = { type: "clip.move", id: "text:1", patch: { startSec: 0 } };

function wired(initial: EditScope) {
	let current = initial;
	const sent: [EditorCommand, EditorCommand][] = [];
	const sync = {
		enqueue: (command: EditorCommand, inverse: EditorCommand) => sent.push([command, inverse]),
		enqueueReplace: (before: EditScope, after: EditScope) =>
			sent.push([replaceScope(after), replaceScope(before)]),
	} as unknown as CommandSync;
	let enqueued = 0;
	const bridge = createSyncBridge({ scope: () => current, enqueued: () => enqueued++ });
	bridge.attach(sync);
	return {
		bridge,
		sent,
		enqueued: () => enqueued,
		set: (next: EditScope) => {
			current = next;
		},
	};
}

describe("which editor writes reach the command log", () => {
	test("a command the stack ran is sent as itself", () => {
		const a = scopeOf(0);
		const { bridge, sent } = wired(a);
		bridge.applied(a, move, back, scopeOf(1));
		expect(sent).toEqual([[move, back]]);
	});

	test("an agent's local merge is never sent, and later edits build on it", () => {
		const a = scopeOf(0);
		const merged = scopeOf(1);
		const { bridge, sent, set } = wired(a);
		bridge.localOnly(() => {
			set(merged);
			bridge.applied(a, move, back, merged);
		});
		bridge.catchUp();
		expect(sent).toEqual([]);
		bridge.applied(merged, move, back, scopeOf(2));
		expect(sent).toEqual([[move, back]]);
	});

	test("a write around the stack is sent as a whole-scope replace, before the next command", () => {
		const a = scopeOf(0);
		const bypassed = scopeOf(1);
		const { bridge, sent, set } = wired(a);
		set(bypassed);
		bridge.applied(bypassed, move, back, scopeOf(2));
		expect(sent).toEqual([
			[replaceScope(bypassed), replaceScope(a)],
			[move, back],
		]);
	});

	test("an undo is sent as a replace", () => {
		const a = scopeOf(0);
		const { bridge, sent } = wired(a);
		bridge.replaced(a, scopeOf(1));
		expect(sent).toEqual([[replaceScope(scopeOf(1)), replaceScope(a)]]);
	});

	test("nothing is sent before a project is attached", () => {
		const { bridge, sent } = wired(scopeOf(0));
		bridge.detach();
		bridge.applied(scopeOf(0), move, back, scopeOf(1));
		bridge.catchUp();
		expect(sent).toEqual([]);
	});
});

describe("the media library reaches the log as media commands (p1-media-library)", () => {
	const asset = (id: string, favorite = false) => ({
		id,
		label: id,
		url: `/${id}.png`,
		kind: "image" as const,
		source: "stock" as const,
		...(favorite ? { favorite } : {}),
	});
	const storyboard = scopeOf(0);
	const withMedia = (mediaAssets: EditScope["mediaAssets"]): EditScope => ({
		...storyboard,
		mediaAssets,
	});

	test("assets added around the stack are sent as one media.admit each, oldest first", () => {
		const a = scopeOf(0);
		const base = { ...a, mediaAssets: [asset("old")] };
		const { bridge, sent, set } = wired(base);
		set({ ...base, mediaAssets: [asset("b"), asset("a"), asset("old")] });
		bridge.catchUp();
		expect(sent.map(([command]) => command)).toEqual([
			{ type: "media.admit", asset: asset("a") },
			{ type: "media.admit", asset: asset("b") },
		]);
		expect(sent[1]![1]).toEqual({ type: "media.update", mediaAssets: [asset("a"), asset("old")] });
	});

	test("any other library change around the stack is sent as media.update of the list", () => {
		const base = withMedia([asset("a"), asset("b")]);
		const { bridge, sent, set } = wired(base);
		set(withMedia([asset("a", true)]));
		bridge.catchUp();
		expect(sent).toEqual([
			[
				{ type: "media.update", mediaAssets: [asset("a", true)] },
				{ type: "media.update", mediaAssets: [asset("a"), asset("b")] },
			],
		]);
	});

	test("an undo that changes the storyboard and the library sends both", () => {
		const before = withMedia([asset("a")]);
		const after = { ...scopeOf(1), mediaAssets: [] };
		const { bridge, sent } = wired(before);
		bridge.replaced(before, after);
		expect(sent.map(([command]) => command.type)).toEqual(["scope.replace", "media.update"]);
	});
});
