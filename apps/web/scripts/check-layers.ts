/* Structural checks for the web client.
 *
 * Eleven rules, none of which a type checker or the test suite can see:
 *   1. Imports point one way: pages -> components -> design-system -> hooks
 *      -> stores -> api -> controllers -> services -> models. Every rank is one
 *      directory name, so a store cannot import a hook, the api layer cannot
 *      reach either, and a browser mechanism (controllers, services) cannot
 *      read application state or issue a request. Controllers and services
 *      also import no React: they drive the browser for components, not as one.
 *   2. No import crosses a top-level directory by a relative path; those use
 *      the @app / @pages / @components / @hooks / @stores / @api /
 *      @controllers / @services / @models aliases so a move stays local.
 *   3. No source module sits at the root of a CLUSTERED role directory. A role
 *      root with loose modules is how an unclassified bucket starts — `shared/`
 *      held three, and all three sat outside every import rule because they
 *      were in no layer directory. `api` and `stores` are flat by design and
 *      are not clustered roles, so the rule does not apply to them.
 *   4. A page does not reach the api layer. Without this the page layer is a
 *      rename: the screen that motivated it held sixteen useState calls.
 *   5. No file goes over the 800-line ceiling; a page goes over 200.
 *   6. Filenames are kebab-case, read from git rather than from disk, because
 *      macOS sets core.ignorecase and a case-only rename leaves the index
 *      holding the old spelling while the working tree shows the new one.
 *   7. A variant class registered to a design-system/components primitive does not appear
 *      in a className. Written as a string a variant cannot be renamed,
 *      enumerated or checked: a typo renders an unstyled control and nothing
 *      fails.
 *   8. Icons come from one registry — no inline `*Icon` outside it in either
 *      declaration form, and no direct import of an icon package. There were
 *      three sources, and which glyph you got depended on which one the author
 *      reached for. A glyph needing more than a size argument stays with its
 *      surface, which is the registry's own stated carve-out.
 *   9. Only components/, app/ and pages/ render. A module in any other role
 *      that returns JSX is a component filed under a name that says it is not
 *      one.
 *  10. A cluster stylesheet has one importer, and every top-level selector in
 *      it carries one of that sheet's declared prefixes.
 *  11. Cross-cluster imports WITHIN one role are counted and reported, not
 *      failed. A downward role crossing is layering, not coupling. Withdrawing
 *      the feature boundary removed what kept clusters apart; counting the
 *      coupling makes its growth visible before it is load-bearing.
 *
 *  12. The design system is a boundary, not a folder. Inside it tokens and
 *      icons are leaves, components build on them, patterns build on
 *      components; nothing in it reads a store; and a behaviour primitive
 *      (Base UI) is imported only from design-system/, so a feature composes
 *      the canonical control instead of growing a second one.
 *
 * Run: bun run check:layers
 */
import { spawnSync } from "bun";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../src");

/* One rank per role, so a rank is a directory name and nothing else.
 *
 * This used to need a longest-matching-prefix resolver, because `api` had a
 * rank but no directory of its own and had to be picked out of `services`.
 * Giving it the directory removed the mechanism. */
const RANK: Array<[string, number]> = [
	["models", 0],
	["services", 1],
	["controllers", 2],
	["api", 3],
	["stores", 4],
	["hooks", 5],
	["design-system", 6],
	["components", 7],
	["pages", 8],
];
const TOP = [
	"app",
	"pages",
	"components",
	"design-system",
	"hooks",
	"stores",
	"api",
	"controllers",
	"services",
	"models",
];
/* Roles that drive the browser without React (migrate-editor-to-shared-rust-core). */
const BROWSER_MECHANISMS = ["controllers", "services"];
/* A rendering framework: React, its DOM renderer, or a renderer integration
 * (moved here from @maleo/vui's host-layer rule with the layers it guarded). */
const RENDERING_FRAMEWORK = /^(react|react-dom|@remotion\/player)(\/|$)/;

/* Layers inside design-system/, lowest first. A component that imported a
 * pattern would make the pattern unremovable; an icon that imported a component
 * would make the registry depend on what it serves. */
const DS_LAYER: Array<[string, number]> = [
	["tokens", 0],
	["icons", 0],
	["components", 1],
	["patterns", 2],
];
function dsLayerOf(show: string): [string, number] | null {
	const parts = show.split("/");
	if (parts[0] !== "design-system") return null;
	return DS_LAYER.find(([name]) => name === parts[1]) ?? null;
}

/* Behaviour primitives belong to the design system. The exception list is
 * empty, and kept: the one entry it held (the workspace switcher's own Base UI
 * popover) moved onto the shared Popover. An entry here is a named debt, with
 * its reason, not a pattern to copy. */
const BEHAVIOUR_PACKAGE = "@base-ui/react";
const BEHAVIOUR_EXCEPTIONS = new Set<string>([]);
/* Roles whose modules must sit inside a cluster directory.
 *
 * `api` and `stores` stay flat and are deliberately absent. api/ is 21 modules
 * already named by domain noun (chat.ts, projects.ts, media.ts) and the
 * api-separation requirement asks for exactly that shape, so a directory per
 * module would restate the filename. stores/ is 5. The precedent is explicit —
 * models/clip-templates/ is 41 files flat because uniform contents do not need
 * directories — and forcing 5 store modules into two- and three-file
 * subdirectories reproduces the `shared/` shape this check exists to prevent. */
const CLUSTERED = ["models", "hooks", "components", "controllers", "services"];

const CEILING = 800;
const PAGE_CEILING = 200;

/* Variant classes are props, not strings. Written as strings they cannot
 * be renamed, cannot be enumerated, and cannot be checked: a typo renders an
 * unstyled button and nothing fails. The primitives in design-system/components own these
 * tokens, so they are the one file allowed to name them. */
const UI_CLASSES = [
	"btn",
	"btn-dark",
	"btn-light",
	"btn-ghost",
	"btn-sm",
	"cv-btn",
	"cv-btn-ai",
	"cv-btn-dark",
	"cv-btn-light",
	"cv-btn-ghost",
	"cv-btn-danger",
	"cv-select",
	"cv-select-full",
	/* Retired spellings. Each of these was one of several names for a single
	 * component, and each now has exactly one application point in
	 * design-system/components. Listing them here is what stops the vocabulary sliding
	 * back: writing `cv-field` into a className fails, and names the file.
	 *
	 * The primitive is named beside each group, because the failure message says
	 * "use the component in @design-system/components that owns it" and a reader who does
	 * not know which one gets no further. */
	// Field
	"cv-field",
	"tl2-field",
	"fc-cap-field",
	"settings-field",
	// Note
	"settings-note",
	"tl2-dsec-note",
	"settings-field-warn",
	// Chip / ChipButton
	"pill",
	"fc-em-chip",
	"fc-quickchip",
	// Input / Textarea / SelectInput
	"cv-input",
	// IconButton
	"cv-iconbtn",
	// Panel / Section / Control
	"tl2-panel",
	"tl2-dsec",
	"tl2-ctl",
];
const CLASS_ATTR = /class[Nn]ame=(?:\{`([^`]*)`\}|"([^"]*)")/g;

/* Merging a CALLER's className into a component's own goes through cn().
 *
 * Not every conditional class: a self-contained `${on ? " active" : ""}` is
 * fine and there are ~110 of them. The case that needs one path is a caller's
 * string meeting the component's, where composition order and duplicates
 * decide the result — that was a hand-rolled filter/join in one component and
 * a template plus `.trim()` in another. */
const CLASSNAME_MERGE = /class[Nn]ame=\{`[^`]*\$\{\s*(?:props\.)?className/g;

/* Icons come from one registry. There were three sources — the registry, the
 * shell's own fourteen inline `*Icon()` components in a file that ALSO
 * imported the registry, and an icon package — so which glyph you got depended
 * on which one the author reached for. */
/* Matches both declaration forms, because `TlExportIcon` was an arrow constant
 * — `export const TlExportIcon = (s = 14) =>` — and walked past a pattern that
 * only knew `function XIcon(`.
 *
 * The parameter list is captured because the registry's own carve-out turns on
 * it: "editor-only glyphs that need more than a size argument stay with the
 * editor". A glyph taking only a size is one the registry can hold and is
 * therefore required to; one taking a `flip`, an `end` or a `kind` cannot be
 * expressed as `(size?: number) => JSX.Element` and stays with its surface. */
const ICON_DECL =
	/^(?:export\s+)?(?:function\s+([A-Z][A-Za-z0-9]*Icon)\s*\(([^)]*)\)|const\s+([A-Z][A-Za-z0-9]*Icon)\s*(?::[^=]+)?=\s*\(([^)]*)\)\s*(?::[^=]*)?=>)/gm;

/** A size-only parameter list: one parameter, and not a destructured object. */
function sizeOnlyGlyph(params: string): boolean {
	const p = params.trim();
	if (p.startsWith("{")) return false;
	return !p.includes(",");
}
const ICON_PACKAGES = ["lucide-react", "react-icons", "@heroicons/react", "@tabler/icons-react"];

/* Only components/ render. A module in any other role that returns JSX is a
 * component filed under a name that says it is not one — which is exactly how
 * `TlExportIcon` sat in services/editor for as long as it did, invisible to the
 * icon rule because it was an arrow constant rather than a function.
 *
 * The test is a JSX-returning arrow or return statement, not the mere presence
 * of angle brackets: a generic call like `get<{ items: T[] }>(...)` is not JSX,
 * and a type parameter is not a tag. */
const RETURNS_JSX =
	/(?:=>\s*\(\s*<[A-Za-z]|return\s*\(\s*<[A-Za-z]|=>\s*<[A-Za-z]|return\s+<[A-Za-z])/;

/* A cluster stylesheet has exactly one importer.
 *
 * timeline.css was imported from four modules. The imports are idempotent, so
 * nothing broke and nothing failed — which is the problem: no module owned the
 * sheet, and deleting the last real user would have left three imports that
 * look load-bearing.
 *
 * Sheets reached through another sheet's @import chain have zero TS importers
 * by design, so zero is allowed and two is not. */
const SHEET_IMPORT = /import\s+["']([^"']+\.css)["']/g;

/* Every top-level selector in a cluster sheet carries one of that sheet's
 * declared prefixes, so a sheet cannot restyle a surface it does not own —
 * create-content.css is 691 lines and could otherwise reach Settings.
 *
 * Some sheets legitimately carry two: the timeline cluster grew `fc-` beside
 * `tl2-`. Listing them is honest; collapsing them would mean renaming classes,
 * which is a visual change and belongs to its own pass. */
const SHEET_PREFIXES: Record<string, string[]> = {
	"components/timeline/timeline.css": [],
	"components/editor-workspace/editor-workspace.css": ["vui-"],
	"components/timeline/tracks.css": ["tl2", "fc-"],
	"components/timeline/stage.css": ["tl2", "fc-"],
	"components/timeline/rail.css": ["tl2", "fc-"],
	"components/timeline/editing.css": ["tl2", "fc-"],
	"components/timeline/media.css": ["tl2", "fc-"],
	"components/timeline/studio.css": ["tl2", "fc-"],
	"components/timeline/stage-layout.css": ["tl2", "fc-"],
	"components/timeline/tracks-clips.css": ["tl2", "fc-"],
	"components/timeline/tracks-interaction.css": ["tl2", "fc-"],
	"components/timeline/studio-motion.css": ["tl2", "fc-"],
	"components/timeline/studio-assistant.css": ["tl2", "fc-"],
	"components/timeline/editing-elements.css": ["tl2", "fc-"],
	"components/timeline/scene-drawer.css": ["tl2", "fc-"],
	"design-system/components/sheet.css": ["ui-sheet"],
	"design-system/patterns/inspector.css": ["ui-insp"],
	"design-system/patterns/panel-header.css": ["ui-phead"],
	"design-system/patterns/toolbar.css": ["ui-tbar"],
	"design-system/patterns/media.css": ["ui-media"],
	"design-system/patterns/prompt-composer.css": ["ui-prompt"],
	"design-system/patterns/chat.css": ["ui-chat"],
	"design-system/patterns/generation.css": ["ui-gen"],
	"design-system/components/slider.css": ["ui-slider"],
	"design-system/components/spinner.css": ["ui-spinner"],
	"design-system/components/progress.css": ["ui-progress"],
	"design-system/components/shimmer.css": ["cv-shimmer"],
	"design-system/components/color-control.css": ["alpha-color"],
	"components/editor/create-content.css": ["cv-", "fc-"],
	"components/editor/create-content-shell.css": ["cv-", "fc-"],
	"components/editor/create-content-workspace.css": ["cv-", "fc-"],
	"components/editor/create-content-studio.css": ["cv-", "fc-"],
	"components/editor/create-content-views.css": ["cv-", "fc-"],
	"components/editor/create-content-storyboard.css": ["cv-", "fc-"],
	"components/editor/create-content-references.css": ["cv-", "fc-"],
	"components/catalog/library.css": ["gallery-", "catalog-", "chip-"],
	"components/content/content.css": ["content-"],
	"components/settings/settings.css": ["credits-", "settings-"],
	"components/image-lab/image-lab.css": ["imagelab-"],
	/* `pg-` rather than `page-`: `.page-head` is already the shell's sticky
	 * breadcrumb bar, so the page frame could not take the obvious prefix. */
	"design-system/components/page.css": ["pg"],
	"components/images/images-gallery.css": ["gal-"],
};

/* Selectors that break their sheet's ownership and are known to.
 *
 * Empty, and deliberately kept: the nine entries it held were fixed rather
 * than tolerated. `.data-table` was a generic name squatting the global
 * namespace from the settings sheet and is `.settings-table`; the `.dark`
 * accent tokens moved to tokens.css, where tokens live; `.provider-warning`
 * is prefixed; the `.cv-*` rules moved out of the timeline sheets into the
 * sheet that owns cv-; and the `.shell-main` rule moved from image-lab.css
 * into the shell sheet that paints it.
 *
 * An exception list with entries is fine. This one is empty because the list
 * shrank to nothing, which is the outcome it existed to drive. */
const SHEET_LEAKS = new Set<string>([]);

const TOP_SELECTOR = /(?:^|\})\s*([^{}@][^{}]*?)\{/gm;

function walk(dir: string, out: string[] = [], exts = [".ts", ".tsx"]): string[] {
	for (const name of readdirSync(dir)) {
		const p = resolve(dir, name);
		if (statSync(p).isDirectory()) walk(p, out, exts);
		else if (exts.includes(extname(p))) out.push(p);
	}
	return out;
}

function rankOf(file: string): number | null {
	const first = relative(ROOT, file).split("/")[0]!;
	return RANK.find(([role]) => role === first)?.[1] ?? null;
}

function topOf(file: string): string | null {
	const first = relative(ROOT, file).split("/")[0]!;
	return TOP.includes(first) ? first : null;
}

/** `models/timeline/x.ts` -> `models/timeline`; null when there is no cluster. */
function clusterOf(file: string): string | null {
	const parts = relative(ROOT, file).split("/");
	if (!CLUSTERED.includes(parts[0]!) || parts.length < 3) return null;
	return `${parts[0]}/${parts[1]}`;
}

/* The requirement counts imports crossing a cluster boundary WITHIN one role.
 * Comparing the qualified names alone also counted every downward role
 * crossing — `components/timeline -> models/core` is legal layering, not
 * coupling, and 532 of the 796 previously reported edges were exactly that. */
function sameRoleCrossCluster(here: string | null, there: string | null): boolean {
	if (!here || !there || here === there) return false;
	return here.split("/")[0] === there.split("/")[0];
}

function resolveSpec(from: string, spec: string): string | null {
	let base: string;
	const alias = TOP.find((t) => spec.startsWith(`@${t}/`));
	if (alias) base = resolve(ROOT, alias, spec.slice(alias.length + 2));
	else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
	else return null;
	for (const c of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		resolve(base, "index.ts"),
		resolve(base, "index.tsx"),
	]) {
		try {
			if (statSync(c).isFile()) return c;
		} catch {
			/* keep looking */
		}
	}
	return null;
}

const SPEC = /(?:from\s*|import\s*)["']([^"']+)["']/g;
const violations: string[] = [];
let crossCluster = 0;

for (const file of walk(ROOT)) {
	const src = readFileSync(file, "utf8");
	const show = relative(ROOT, file);
	const here = { rank: rankOf(file), top: topOf(file), cluster: clusterOf(file) };

	if (here.top && CLUSTERED.includes(here.top) && here.cluster === null) {
		violations.push(
			`${show}\n    sits at the root of a role directory\n    move it into a cluster: ${here.top}/<cluster>/${show.split("/").pop()}`,
		);
	}

	if (!show.startsWith("design-system/icons/")) {
		for (const m of src.matchAll(ICON_DECL)) {
			const name = m[1] ?? m[3]!;
			if (!sizeOnlyGlyph(m[2] ?? m[4] ?? "")) continue;
			violations.push(
				`${show}\n    defines an inline icon component: ${name}\n    add the glyph to design-system/icons and read it from Ic`,
			);
		}
		for (const pkg of ICON_PACKAGES) {
			if (src.includes(`"${pkg}"`)) {
				violations.push(
					`${show}\n    imports an icon package directly: ${pkg}\n    the registry is the only module that knows where a glyph came from`,
				);
			}
		}
		/* Icon sizes are a scale, not a number. 300 of 494 call sites had picked a
		 * size off it (9, 11, 13, 15, 17…), each because it looked right there. */
		for (const m of src.matchAll(/\bIc\.[a-zA-Z0-9]+\((\d+)\)/g)) {
			violations.push(
				`${show}\n    sizes an icon with a number: ${m[0]}\n    name a step instead: Ic.name(ICON.xs | sm | md | lg | xl | display)`,
			);
		}
	}

	/* `app` and `pages` compose screens, so they render by definition; every
	 * other role is a non-rendering one and returning JSX from it files a
	 * component under a name that says it is not one. */
	if (
		here.top &&
		!["components", "design-system", "app", "pages"].includes(here.top) &&
		RETURNS_JSX.test(src)
	) {
		violations.push(
			`${show}\n    a module in ${here.top}/ returns JSX\n    only components/, design-system/, app/ and pages/ render; move the markup into a component`,
		);
	}

	if (
		here.top !== "design-system" &&
		!BEHAVIOUR_EXCEPTIONS.has(show) &&
		src.includes(`"${BEHAVIOUR_PACKAGE}/`)
	) {
		violations.push(
			`${show}\n    imports a behaviour primitive directly: ${BEHAVIOUR_PACKAGE}\n    compose the component in @design-system/components that wraps it, or add one there`,
		);
	}

	for (const m of src.matchAll(CLASSNAME_MERGE)) {
		void m;
		violations.push(
			`${show}\n    merges a caller's className by hand\n    use cn() from @models/core/cn.ts so composition order is the same everywhere`,
		);
	}

	// design-system/components owns these tokens; everywhere else uses the component.
	if (!show.startsWith("design-system/components/")) {
		for (const m of src.matchAll(CLASS_ATTR)) {
			const tokens = (m[1] ?? m[2] ?? "").split(/[\s${}?:"'`]+/).filter(Boolean);
			const owned = tokens.filter((t) => UI_CLASSES.includes(t));
			if (owned.length) {
				violations.push(
					`${show}\n    ui primitive class in a className: ${owned.join(" ")}\n    use the component in @design-system/components that owns it`,
				);
			}
		}
	}

	for (const m of src.matchAll(SPEC)) {
		const spec = m[1]!;
		if (here.top && BROWSER_MECHANISMS.includes(here.top) && RENDERING_FRAMEWORK.test(spec)) {
			violations.push(
				`${show}\n    ${here.top} imports a rendering framework: ${spec}\n    a browser mechanism is driven by components; move the React part to components/ or hooks/`,
			);
		}
		const target = resolveSpec(file, spec);
		if (!target) continue;
		const there = { rank: rankOf(target), top: topOf(target), cluster: clusterOf(target) };
		const to = relative(ROOT, target);

		if (here.rank !== null && there.rank !== null && there.rank > here.rank) {
			violations.push(`${show}\n    imports upward: ${here.top} <- ${there.top}  (${to})`);
		}
		if (spec.startsWith(".") && here.top && there.top && here.top !== there.top) {
			violations.push(
				`${show}\n    relative import across a top-level directory: ${spec}\n    use the @${there.top} alias`,
			);
		}
		if (here.top === "design-system" && there.top === "stores") {
			violations.push(
				`${show}\n    the design system reads application state: ${to}\n    take the value as a prop; a control that reads a store cannot be reused or shown in isolation`,
			);
		}
		const [dsHere, dsThere] = [dsLayerOf(show), dsLayerOf(to)];
		if (dsHere && dsThere && dsThere[1] > dsHere[1]) {
			violations.push(
				`${show}\n    imports upward inside the design system: ${dsHere[0]} <- ${dsThere[0]}  (${to})\n    tokens and icons are leaves, components build on them, patterns build on components`,
			);
		}
		if (here.top === "pages" && there.top === "api") {
			violations.push(
				`${show}\n    a page reaches the api layer directly: ${to}\n    render a component that calls a hook in hooks/ instead; a page composes, it does not fetch`,
			);
		}
		if (sameRoleCrossCluster(here.cluster, there.cluster)) crossCluster++;
	}
}

/* The files nearest the ceiling, reported on success.
 *
 * A limit that only speaks at 801 lines is a trailing indicator: it fires while
 * someone is doing unrelated work, so the decomposition competes with whatever
 * change is in flight. `timeline-editor.tsx` was found at 796 by hand, with four
 * lines to spare, and `timeline-tracks.tsx` at 740. Reporting the headroom makes
 * the next split a choice rather than an interruption. Reported, never failed —
 * a large file is not a violation. */
const HEADROOM_REPORT = 3;
const sizes: Array<[string, number]> = [];

for (const file of walk(ROOT, [], [".ts", ".tsx", ".css"])) {
	const show = relative(ROOT, file);
	// Count newlines, the same convention `wc -l` uses.
	const lines = readFileSync(file, "utf8").split("\n").length - 1;
	sizes.push([show, lines]);
	if (lines > CEILING)
		violations.push(
			`${show}\n    ${lines} lines, over the ${CEILING}-line ceiling\n    split it by ownership: the region that owns a piece of state should own the code that draws it`,
		);
	if (topOf(file) === "pages" && lines > PAGE_CEILING) {
		violations.push(
			`${show}\n    ${lines} lines, over the ${PAGE_CEILING}-line page ceiling\n    move composition into a component; do not raise the limit`,
		);
	}
}

/* Filenames, not identifiers: `timeline-editor.tsx` still exports
 * `TimelineEditor`. Read from git rather than from disk — macOS sets
 * core.ignorecase, so a case-only rename leaves the working tree lowercase
 * while the index keeps the old spelling, and Linux CI checks out the one you
 * did not want. Nine files renamed exactly that way passed a disk-based check. */
const tracked = new TextDecoder()
	.decode(
		spawnSync(["git", "ls-files", "-z", "src"], {
			cwd: resolve(import.meta.dir, ".."),
			stdout: "pipe",
		}).stdout,
	)
	.split("\0")
	.filter((p) => [".ts", ".tsx", ".css"].includes(extname(p)));

for (const path of tracked) {
	const base = path.split("/").pop()!;
	if (/[A-Z]/.test(base)) {
		const suggestion = base.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
		violations.push(
			`${path}\n    filename is not kebab-case as git records it\n    rename it: ${base} -> ${suggestion}\n    a case-only rename needs two steps on macOS: git mv -f ${base} tmp && git mv tmp ${suggestion}`,
		);
	}
}

/* Stylesheet ownership: one importer per cluster sheet, and every top-level
 * selector inside one carries a prefix that sheet declared. */
const sheetImporters = new Map<string, string[]>();
for (const file of walk(ROOT)) {
	const src = readFileSync(file, "utf8");
	for (const m of src.matchAll(SHEET_IMPORT)) {
		const target = resolve(dirname(file), m[1]!);
		let rel: string;
		try {
			rel = relative(ROOT, target);
		} catch {
			continue;
		}
		if (rel.startsWith("..")) continue;
		sheetImporters.set(rel, [...(sheetImporters.get(rel) ?? []), relative(ROOT, file)]);
	}
}
for (const [sheet, importers] of sheetImporters) {
	if (importers.length > 1) {
		violations.push(
			`${sheet}\n    imported by ${importers.length} modules: ${importers.join(", ")}\n    give the sheet one owner; idempotent imports mean nothing fails when nobody owns it`,
		);
	}
}

for (const [sheet, prefixes] of Object.entries(SHEET_PREFIXES)) {
	if (prefixes.length === 0) continue;
	let css: string;
	try {
		css = readFileSync(resolve(ROOT, sheet), "utf8");
	} catch {
		continue;
	}
	for (const m of css.matchAll(TOP_SELECTOR)) {
		const raw = m[1]!;
		const cut = raw.lastIndexOf("*/");
		const sel = (cut === -1 ? raw : raw.slice(cut + 2)).trim();
		if (!sel || sel.startsWith("@") || sel.startsWith(":")) continue;
		for (const arm of sel
			.split(",")
			.map((a) => a.trim())
			.filter(Boolean)) {
			/* A sheet may style anything INSIDE what it owns, so the test is
			 * whether the selector is anchored to one of its prefixes anywhere —
			 * not what the subject is. `.tl2-clippanel .cv-input` is the timeline
			 * customising a control within its own panel; `.data-table` is
			 * anchored to nothing and paints a surface the sheet does not own.
			 *
			 * Two earlier versions of this got it wrong in opposite directions:
			 * reading the first class called `.dark .cv-shimmer` a leak, and
			 * reading the subject called `.catalog-grid .gallery-card` one. */
			// `:has(.x)` / `:not(.x)` are conditions, not ancestors: a rule that
			// paints `.shell-main > main` is the shell's, however it is qualified.
			const structural = arm.replace(/:[a-z-]+\([^)]*\)/g, "");
			const classes = [...structural.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((c) => c[1]!);
			if (classes.length === 0) continue;
			if (SHEET_LEAKS.has(`${sheet} ${arm}`)) continue;
			if (!classes.some((c) => prefixes.some((p) => c.startsWith(p)))) {
				violations.push(
					`${sheet}\n    selector paints an element outside this sheet's prefixes (${prefixes.join(", ")}): ${arm}\n    a cluster sheet may only style its own cluster`,
				);
			}
		}
	}
}

/* Stylesheet liveness: a cluster sheet's rules style something that renders.
 *
 * Ownership and liveness are different questions, and the pass above only
 * answers the first. Thirteen rules styled the inspector's sub-category
 * headings — `tl2-acc-h`, `tl2-acc-body`, `tl2-acc-label`, `tl2-acc-tools`,
 * `tl2-acc-chev` — and every one carried the timeline cluster's own prefix, so
 * every one passed. None had matched anything since `AccordionSection` moved
 * into `@maleo/vui` and began rendering `vui-accordion`. The headings fell back
 * to package defaults while the app's intended metrics sat in the sheet looking
 * authoritative, and the next person to change that design would have edited
 * them and seen nothing happen.
 *
 * Cross-checked against the SOURCE rather than against a rendered tree, which
 * is a change from how this was first planned. Walking the DOM answers a
 * narrower question — did this fixture, on these screens, put that element on
 * screen — so every rule for a state the fixture never reaches reads as dead
 * and the check needs a running server to say anything at all. Presence in the
 * source is the honest test of "something renders this", and it runs here,
 * beside the ownership pass, with no browser.
 *
 * The blind spot is a class assembled at runtime: `tl2-${kind}` is never in the
 * source as a whole word. `LIVENESS_DYNAMIC` carries those, with the reason.
 */
const LIVENESS_DYNAMIC = new Set<string>([
	/* `tl2-density-${timelineDensity}` in timeline-tracks.tsx — the suffix is the
	   stored preference, so neither whole class name appears in the source. The
	   `tl2-density-btn` beside them is NOT dynamic and is in the backlog below. */
	"tl2-density-comfortable",
	"tl2-density-compact",
]);

/* Dead rules the liveness pass found and that were swept rather than held.
 *
 * It found 48 classes across seven sheets on the day it was written — 71 rules
 * for components renamed or removed over time with their styling left behind —
 * and they were deleted rather than listed. Empty, and kept, for the same reason
 * `SHEET_LEAKS` above is kept empty: a list with entries is a decision to
 * tolerate, and an empty one records that the decision went the other way.
 *
 * Nothing should be added here. A rule written today for markup that does not
 * exist is the case this pass is for.
 */
const LIVENESS_BACKLOG = new Set<string>([]);

const sourceText = walk(ROOT)
	.filter((f) => /\.tsx?$/.test(f))
	.map((f) => readFileSync(f, "utf8"))
	.join("\n");

const deadByClass = new Map<string, Set<string>>();
for (const [sheet, prefixes] of Object.entries(SHEET_PREFIXES)) {
	if (prefixes.length === 0) continue;
	let css: string;
	try {
		css = readFileSync(resolve(ROOT, sheet), "utf8");
	} catch {
		continue;
	}
	/* Comments stripped first. This file's own prose names the classes it
	 * removed, and a scanner that read those would report them as live. */
	const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
	for (const m of rules.matchAll(TOP_SELECTOR)) {
		const sel = m[1]!.trim();
		if (!sel || sel.startsWith("@") || sel.startsWith(":")) continue;
		for (const arm of sel
			.split(",")
			.map((a) => a.trim())
			.filter(Boolean)) {
			for (const c of [...arm.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]!)) {
				if (!prefixes.some((prefix) => c.startsWith(prefix))) continue;
				if (LIVENESS_DYNAMIC.has(c) || LIVENESS_BACKLOG.has(c)) continue;
				if (sourceText.includes(c)) continue;
				deadByClass.set(c, new Set([...(deadByClass.get(c) ?? []), sheet]));
			}
		}
	}
}
for (const [cls, inSheets] of [...deadByClass].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
	violations.push(
		`${[...inSheets].join(", ")}\n    .${cls} is styled but nothing renders it\n    delete the rule, or point it at what the markup actually carries`,
	);
}

/* Token liveness: a design token declared in the global sheet that nothing reads.
 *
 * The sibling of the dead-rule check above, and it exists for the same reason at
 * one level down. A declaration nothing reads is worse than an absent one,
 * because the next person to change the design edits it and sees nothing happen.
 *
 * This is not hypothetical either. `tokens.css` declared its whole palette
 * twice — once as Tailwind's `--color-*` and once as the `--bg` / `--r-1` set
 * the stylesheets actually read — and the unread half sat there looking
 * authoritative through every design change. It also still carried four tokens
 * from the persona system (`--accent-bright`, `--accent-deep`, `--accent-glow`,
 * `--persona-gradient`) that the workspace pivot removed, plus a comment
 * describing the runtime injection that used to set them.
 *
 * Reads counted from both CSS `var(--x)` and the `"--x":` form used in React
 * `style` objects, because `cssVars()` writes custom properties from TSX. A
 * token set at runtime via `setProperty` and never declared here is invisible to
 * this check by construction, which is correct — it is not declared here. */
const TOKEN_SHEET = resolve(ROOT, "design-system/tokens/tokens.css");
const tokenSrc = readFileSync(TOKEN_SHEET, "utf8");
const declaredTokens = new Set(
	[...tokenSrc.matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!),
);
/* Each shadcn alias must have a real utility reader, and must point at a
 * canonical token. Tailwind inlines the aliases, so scanning emitted CSS for
 * --color-primary cannot prove liveness: that name is intentionally erased. */
const bridgeSrc = readFileSync(resolve(ROOT, "app/styles/shadcn.css"), "utf8");
const utilityRefs = new Set(
	[...sourceText.matchAll(/\b(tw:(?:[a-z-]+:)*[a-z0-9][a-z0-9/-]*)/g)].map((m) => m[1]!),
);
const bridgeReaders: Record<string, RegExp> = {
	"--color-primary": /^tw:(?:[a-z-]+:)*bg-primary(?:\/\d+)?$/,
	"--color-primary-foreground": /^tw:(?:[a-z-]+:)*text-primary-foreground$/,
	"--color-ring": /^tw:(?:[a-z-]+:)*outline-ring$/,
	"--color-border": /^tw:(?:[a-z-]+:)*border-border$/,
	"--color-background": /^tw:(?:[a-z-]+:)*bg-background$/,
	"--color-foreground": /^tw:(?:[a-z-]+:)*text-foreground$/,
	"--color-muted-foreground": /^tw:(?:[a-z-]+:)*text-muted-foreground$/,
	"--color-secondary": /^tw:(?:[a-z-]+:)*bg-secondary(?:\/\d+)?$/,
	"--color-accent": /^tw:(?:[a-z-]+:)*bg-accent(?:\/\d+)?$/,
	"--color-pressed": /^tw:(?:[a-z-]+:)*bg-pressed$/,
	"--color-destructive": /^tw:(?:[a-z-]+:)*(?:bg|border|text)-destructive(?:\/\d+)?$/,
	"--color-destructive-foreground": /^tw:(?:[a-z-]+:)*text-destructive-foreground$/,
	"--color-ai": /^tw:(?:[a-z-]+:)*(?:bg|text)-ai(?:\/\d+)?$/,
	"--color-ai-foreground": /^tw:(?:[a-z-]+:)*text-ai-foreground$/,
	"--color-ai-border": /^tw:(?:[a-z-]+:)*border-ai-border$/,
	"--color-input": /^tw:(?:[a-z-]+:)*border-input$/,
	"--radius-md": /^tw:(?:[a-z-]+:)*rounded-md$/,
	"--radius-lg": /^tw:rounded-lg$/,
	"--radius-full": /^tw:rounded-full$/,
	"--font-sans": /^tw:(?:[a-z-]+:)*font-sans$/,
	"--text-sm": /^tw:text-sm$/,
	"--text-xs": /^tw:(?:[a-z-]+:)*text-xs$/,
	"--font-weight-medium": /^tw:font-medium$/,
	"--font-weight-semibold": /^tw:(?:[a-z-]+:)*font-semibold$/,
	"--spacing": /^tw:(?:gap|px|py|min-h)-\d+$/,
	"--color-warning": /^tw:(?:[a-z-]+:)*text-warning$/,
	"--color-popover": /^tw:(?:[a-z-]+:)*bg-popover$/,
	"--shadow-md": /^tw:(?:[a-z-]+:)*shadow-md$/,
};
for (const [, alias, canonical] of bridgeSrc.matchAll(/(--[a-z-]+):\s*var\((--[a-z0-9-]+)\)/g)) {
	if (!declaredTokens.has(canonical!))
		violations.push(
			`app/styles/shadcn.css: ${alias} reads undeclared canonical token ${canonical}`,
		);
	if (![...utilityRefs].some((cls) => bridgeReaders[alias!]?.test(cls)))
		violations.push(`app/styles/shadcn.css: ${alias} has no rendered utility reader`);
}
const readTokens = new Set<string>();
/* The other direction: a var() naming a custom property nothing declares.
 *
 * Same rule, and it was the half that could not be seen. `.tl2-dsec-note.warn`
 * read `var(--danger, #e5484d)` while the app's error colour is `--err:
 * #dc2626`, so every timeline warning rendered a red that appears nowhere else
 * in the product — and the fallback is what kept it quiet. The rule works, so
 * nothing is broken enough to notice. A fallback earns no exemption here; it is
 * exactly the case that renders plausibly while being wrong.
 *
 * Declaration is counted anywhere under src, not only in tokens.css. A cluster
 * sheet owning its own geometry knob (`--tl2-lane-h` in tracks.css) is the
 * established shape and is not what this looks for; a name no sheet and no
 * runtime write ever sets is. Runtime writes count as declarations because
 * cssVars() and setProperty() are how several tokens are set at all. */
const declaredAnywhere = new Set<string>(declaredTokens);
for (const file of walk(ROOT, [], [".ts", ".tsx", ".css"])) {
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(/(?:^|[;{]|\s)(--[a-z0-9-]+)\s*:/gm)) declaredAnywhere.add(m[1]!);
	for (const m of text.matchAll(/\btw:\[(--[a-z0-9-]+):/g)) declaredAnywhere.add(m[1]!);
	for (const m of text.matchAll(/["'`](--[a-z0-9-]+)["'`]\s*:/g)) declaredAnywhere.add(m[1]!);
	for (const m of text.matchAll(/setProperty\(\s*["'`](--[a-z0-9-]+)/g))
		declaredAnywhere.add(m[1]!);
}
const readIn = new Map<string, Set<string>>();
for (const file of walk(ROOT, [], [".ts", ".tsx", ".css"])) {
	/* Comments stripped before counting reads. reset.css explains in prose that
	 * Tailwind resolved `var(--default-font-family, …)` against a token this
	 * project never defined — and a scanner reading that sentence reports the
	 * explanation as the defect it describes. */
	const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
		readTokens.add(m[1]!);
		readIn.set(m[1]!, new Set([...(readIn.get(m[1]!) ?? []), relative(ROOT, file)]));
	}
	for (const m of text.matchAll(/["'`](--[a-z0-9-]+)["'`]\s*:/g)) readTokens.add(m[1]!);
}
for (const token of [...declaredTokens].filter((t) => !readTokens.has(t)).sort()) {
	violations.push(
		`${relative(ROOT, TOKEN_SHEET)}\n    ${token} is declared but nothing reads it\n    delete it, or point a rule at it — a token no rule reads renders nothing`,
	);
}
for (const token of [...readIn.keys()].filter((t) => !declaredAnywhere.has(t)).sort()) {
	violations.push(
		`${[...readIn.get(token)!].sort().join(", ")}\n    ${token} is read but nothing declares it\n    point the reader at a declared token — a fallback renders plausibly and hides this`,
	);
}

if (violations.length === 0) {
	const nearest = sizes
		.filter(([, n]) => n <= CEILING)
		.sort((a, b) => b[1] - a[1])
		.slice(0, HEADROOM_REPORT)
		.map(([show, n]) => `${show} ${n} (${CEILING - n} left)`);
	console.log(`layers ok — ${crossCluster} cross-cluster imports`);
	console.log(`nearest the ${CEILING}-line ceiling — ${nearest.join(", ")}`);
	process.exit(0);
}
console.error(`${violations.length} layering violation(s):\n`);
for (const v of violations) console.error(`  ${v}\n`);
process.exit(1);
