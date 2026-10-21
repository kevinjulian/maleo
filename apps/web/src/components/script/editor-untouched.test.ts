/* The editor has four views, and this is what keeps that shape honest.
 *
 * The script began as a separate route and is now one of the editor's views,
 * beside the timeline and the studio. Two promises survive that move and are
 * easy to break later: the scene studio's OWN sub-views are not the place to add
 * anything, and the PNG storyboard export still ships because it feeds
 * image-to-video generation, which the script does not.
 */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the editor offers storyboard, script, timeline and studio", () => {
	test("the mode is named once, with exactly those four views", () => {
		expect(read("../../stores/shell-chrome-store.ts")).toContain(
			'export type EditorMode = "storyboard" | "script" | "timeline" | "studio";',
		);
	});

	test("each view has a tab", () => {
		const topbar = read("../editor/editor-topbar.tsx");
		expect(topbar).toContain("<TabsTab key={mode} value={mode}");
		for (const mode of ["storyboard", "script", "timeline", "studio"]) {
			expect(topbar).toContain(`{ mode: "${mode}",`);
		}
	});

	test("the script is a view, not a second page reachable another way", () => {
		// It renders inside the editor off the same `scenes` the other two use.
		const editor = read("../editor/editor-views.tsx");
		expect(editor).toContain('editorMode === "script"');
		expect(editor).toContain("<ScriptView");
	});
});

describe("the scene studio keeps the sub-views it had", () => {
	test("its switcher still offers exactly studio, board, list and storyboard", () => {
		const studio = read("../editor/studio.tsx");
		expect(studio).toContain('useState<"studio" | "board" | "list" | "storyboard">');
		// `list` was a retirement candidate during design and deliberately kept.
		expect(studio).toContain('view === "list"');
	});

	test("the script is not one of the studio's sub-views", () => {
		expect(read("../editor/studio.tsx")).not.toMatch(/"script"/);
	});

	test("the PNG storyboard export still exists and is still mounted", () => {
		// It serves image-to-video generation, which the script does not, so both
		// ship. Deleting it was considered and rejected.
		expect(read("../editor/studio.tsx")).toContain("<StoryboardView");
		expect(read("../editor/storyboard-export.tsx")).toContain("export function StoryboardView");
	});
});
