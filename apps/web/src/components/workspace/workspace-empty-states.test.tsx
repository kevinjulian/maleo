/* A scoped surface with nothing to show names the workspace it is empty FOR.
 *
 * Five of the six registered workspaces own nothing, so after scoping a correct
 * empty app is the ORDINARY case — and it looked exactly like a broken one.
 * These pin the two properties that make the difference:
 *
 *  1. the copy names the active workspace, so an operator can tell "this
 *     workspace is empty" from "my work has disappeared";
 *  2. empty is guarded against error, so a failed load does not also render the
 *     reassuring empty state on top of its own failure.
 *
 * Source assertions rather than renders: these surfaces load on mount and the
 * harness has no DOM or fetch layer, so driving them would test the mock. What
 * is worth pinning is the copy and the guard, and both are visible here. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "../..");

const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

describe("an empty scoped surface names its workspace", () => {
	test("the content list", () => {
		const src = read("pages/content.tsx");
		expect(src).toContain("${workspace} has no projects yet");
		expect(src).toContain("Nothing in ${workspace} matches");
	});

	test("the image gallery", () => {
		/* A template literal since the gallery renders the shared `EmptyState`,
		   which takes the heading as a prop rather than as markup. */
		expect(read("components/images/images-gallery.tsx")).toContain("No images in ${workspace} yet");
	});

	test("the materials library", () => {
		expect(read("components/catalog/materials-library.tsx")).toContain(
			"No materials in ${workspace} yet",
		);
	});

	test("the reference library", () => {
		expect(read("components/catalog/references-library.tsx")).toContain(
			"No reference images in ${workspace} yet",
		);
	});

	test("the image lab", () => {
		expect(read("pages/image-lab.tsx")).toContain("{session.workspace}");
	});
});

describe("empty is distinguishable from failed to load", () => {
	/* Each of these renders zero rows on failure too. Without the guard the
	   surface says "this workspace is empty" over the top of its own error, which
	   is the more misleading of the two messages. */
	test("the content list does not claim emptiness while erroring", () => {
		expect(read("pages/content.tsx")).toContain("feed.error ? null : feed.rows.length === 0");
	});

	test("the gallery does not claim emptiness while erroring", () => {
		expect(read("components/images/images-gallery.tsx")).toContain('phase === "failed" ? (');
	});

	test("the materials library does not claim emptiness while erroring", () => {
		expect(read("components/catalog/materials-library.tsx")).toContain('phase === "failed" ? (');
	});

	/* The surfaces that used to say "none yet" beside their own error, while
	   still loading, or instead of an error they had swallowed. */
	test("every collection surface decides its state in one place", () => {
		for (const file of [
			"components/catalog/materials-library.tsx",
			"components/catalog/presets-library.tsx",
			"components/catalog/templates-library.tsx",
			"components/catalog/references-library.tsx",
			"components/catalog/voices-library.tsx",
			"components/images/images-gallery.tsx",
			"components/speech/speech-gallery.tsx",
		]) {
			const src = read(file);
			expect(src, file).toContain("collectionPhase(");
			expect(src, file).toContain("<ErrorState");
			expect(src, file).toContain("<LoadingState");
		}
	});

	test("a failed catalogue load is reported, not swallowed", () => {
		expect(read("hooks/catalog/use-content-catalogue.ts")).toContain(
			"setFailed(catalogue === null);",
		);
	});
});

/* The fullscreen create/editor flows replace the sidebar AND the mobile topbar,
   so they carried no workspace indicator at all — an operator there could not
   tell which tenant they were in without opening the nav drawer. That is also
   the surface where generations are produced, which makes it the worst place to
   have to guess.

   BOTH flows are asserted. They do not share a topbar: the editor renders
   components/editor/editor-topbar.tsx, while /create builds its own `cv-topbar`
   inline in pages/create-form.tsx. A test that checked only the editor read as
   covering "create/editor" while leaving half of it unheld — which is exactly
   how /create shipped without a chip. */
describe("the fullscreen flows show the active workspace", () => {
	test("the editor topbar renders the switcher", () => {
		expect(read("components/editor/editor-topbar.tsx")).toContain(
			"<WorkspaceSwitcher collapsed />",
		);
	});

	test("the create topbar renders the switcher too", () => {
		const src = read("pages/create-form.tsx");
		expect(src).toContain("<WorkspaceSwitcher collapsed />");
		// In ITS OWN topbar, not merely imported somewhere in the file.
		const topbar = src.slice(src.indexOf('<Topbar variant="editor"'), src.indexOf("</Topbar>"));
		expect(topbar).toContain("<WorkspaceSwitcher collapsed />");
	});

	test("neither flow pulls settings or credits under the workspace", () => {
		// The chip is the ONLY thing these topbars gained. Credits keep their own
		// global badge and settings keep their own route.
		for (const file of ["components/editor/editor-topbar.tsx", "pages/create-form.tsx"]) {
			expect(read(file)).not.toContain("scope_id");
			expect(read(file).toLowerCase()).not.toContain("fetchcreditsummary");
		}
	});
});

/* The shared Popover portals the panel, positions it fixed, and handles
   collisions, so it stays outside the rail's scroll container at desktop and
   inside the viewport at phone width. The switcher owns none of that. */
describe("the switcher panel escapes its container", () => {
	const css = (): string => read("app/styles/shell.css");

	test("the panel is the shared Popover, not a Base UI primitive of its own", () => {
		const src = read("components/workspace/workspace-switcher.tsx");
		expect(src).toContain('from "@design-system/components/popover.tsx"');
		expect(src).not.toContain("@base-ui/react");
		const popover = read("design-system/components/popover.tsx");
		expect(popover).toContain("<BasePopover.Portal");
		expect(popover).toContain('positionMethod="fixed"');
		expect(popover).toContain("collisionPadding={8}");
		expect(css()).not.toContain(".ws-positioner");
	});

	test("no per-surface rule re-positions it", () => {
		// Each of these was a bug: the mobile panel opened off the right edge, the
		// fullscreen panel collapsed to chip width, the rail panel was clipped.
		// One strategy means there is nothing left to get wrong per surface.
		expect(css()).not.toContain(".ws-topbar .ws-panel");
		expect(css()).not.toContain(".cv-topbar .ws-panel");
		expect(css()).not.toContain(".ws-root.collapsed .ws-panel");
	});

	test("it keeps no scroll or resize listener of its own", () => {
		// It used to close itself when its anchor moved, because its fixed panel
		// did not follow. The shared Popover follows the trigger instead.
		const src = read("components/workspace/workspace-switcher.tsx");
		expect(src).not.toContain("addEventListener");
	});
});

describe("the switcher tells the two apart before a switch", () => {
	test("it renders a per-workspace count, so an empty one is expected", () => {
		const src = read("components/workspace/workspace-switcher.tsx");
		expect(src).toContain("countLabel(workspace.project_count)");
		expect(src).toContain('return "no projects yet"');
	});

	test("a failed registry load reads as a failure, not as no workspaces", () => {
		const src = read("components/workspace/workspace-switcher.tsx");
		expect(src).toContain("Could not load workspaces.");
		expect(src).toContain("!loading && !error && items.length === 0");
	});
});
