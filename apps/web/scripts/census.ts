/* The class census: who defines a class, who renders it, and what is hiding
 * from every check the repository has.
 *
 * The structural checks in check-layers.ts answer whether a sheet styles only
 * its own cluster. They say nothing about who RENDERS those classes, and that is
 * the half that drifted: create-content.css declares `cv-` legitimately, styles
 * nothing outside it, passes every rule — and seven directories render `cv-`
 * classes. A prefix names where a component was born, not who uses it, and
 * nothing reported the difference as it grew.
 *
 * So this reports, per class: the sheet that defines it, its call-site count,
 * and the set of source directories that consume it. Cross-cluster consumption
 * is the promotion signal; call count alone finds the busiest local component
 * and misses the widely copied one.
 *
 * It also reports what no check can currently see at all. Every structural rule
 * reads CSS or reads a `className`, so an inline `style={{…}}` object routes
 * around all of them: a literal colour in one passes every gate. Per-file inline
 * density and literal-colour counts are here for that reason, as a standing
 * number to work down rather than a problem declared solved.
 *
 * This is a check rather than a script someone ran once. A document holding
 * these numbers is stale the week after it is written, and then candidate
 * membership is an opinion again.
 *
 * Run: bun run check:census
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

/* The tree to scan, overridable so the zero-find failure is demonstrable:
 * `bun scripts/census.ts scripts` scans a tree with no stylesheets in it and
 * must exit non-zero. A guard nobody can trigger is a guard nobody has tested. */
const ROOT = resolve(import.meta.dir, "..", process.argv[2] ?? "src");

/* How many rows of each report to print. The full picture is hundreds of
 * classes; the reason to read this output in CI is the head of each list.
 * `CENSUS_ALL=1` prints every row, which is how a baseline is recorded and how
 * a class below the cut-off is looked up. */
const ALL = process.env.CENSUS_ALL === "1";
const TOP_CLASSES = ALL ? Number.POSITIVE_INFINITY : 40;
const TOP_FILES = ALL ? Number.POSITIVE_INFINITY : 15;

function walk(dir: string, exts: string[], out: string[] = []): string[] {
	let names: string[];
	// A missing tree is a zero find, so orFail names what was searched rather
	// than the scan dying with an ENOENT that says nothing about why.
	try {
		names = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of names) {
		const p = resolve(dir, name);
		if (statSync(p).isDirectory()) walk(p, exts, out);
		else if (exts.includes(extname(p))) out.push(p);
	}
	return out;
}

/* A scan that finds nothing fails, following the collision scan's precedent:
 * silently matching zero is the worst outcome available, because it looks like
 * the answer you wanted. */
function orFail<T>(found: T[], what: string, where: string): T[] {
	if (found.length === 0) {
		console.error(`census found no ${what} under ${where} — the scan is pointed at the wrong tree`);
		process.exit(1);
	}
	return found;
}

/* The cluster a file belongs to: `components/editor/create-content.css` ->
 * `components/editor`, `pages/create-form.tsx` -> `pages`. Two segments at most,
 * and never the filename — a module sitting directly in a role directory belongs
 * to that role, not to a cluster of its own. */
function dirOf(file: string): string {
	const parts = relative(ROOT, file).split("/");
	return parts.slice(0, Math.min(2, parts.length - 1)).join("/") || parts[0]!;
}

const sheets = orFail(walk(ROOT, [".css"]), "stylesheets", ROOT);
/* Tests name classes to assert cascade order; they render nothing. Counting them
 * as consumers makes a class look shared because a test file mentions it. */
const sources = orFail(
	walk(ROOT, [".ts", ".tsx"]).filter((f) => !/\.test\.tsx?$/.test(f)),
	"source modules",
	ROOT,
);

/* Class definitions. Comments are stripped first: a sheet's own prose names the
 * classes it removed, and reading those would define classes that do not exist. */
const TOP_SELECTOR = /(?:^|\})\s*([^{}@][^{}]*?)\{/gm;
const definedIn = new Map<string, Set<string>>();
/* The rules themselves, kept for the one consumer that needs to show a class
 * rather than count it. The inventory's whole job is letting someone see that
 * `cv-field` and `tl2-field` differ by a padding and a font size, and that
 * difference lives in the declarations. Collected here, in the scan that is
 * already reading every stylesheet, so the generator never opens one. */
type Rule = { sheet: string; selector: string; body: string };
const rulesFor = new Map<string, Rule[]>();
for (const file of sheets) {
	const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const show = relative(ROOT, file);
	for (const m of css.matchAll(TOP_SELECTOR)) {
		const sel = m[1]!.trim();
		if (!sel || sel.startsWith("@") || sel.startsWith(":")) continue;
		/* The declaration block, taken to the matching close brace so a nested
		 * rule does not truncate it at the first `}`. */
		let i = m.index + m[0].length;
		let depth = 0;
		const start = i;
		for (; i < css.length; i++) {
			if (css[i] === "{") depth++;
			else if (css[i] === "}") {
				if (depth === 0) break;
				depth--;
			}
		}
		const body = css.slice(start, i).trim();
		for (const c of [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]!)) {
			definedIn.set(c, new Set([...(definedIn.get(c) ?? []), show]));
			rulesFor.set(c, [...(rulesFor.get(c) ?? []), { sheet: show, selector: sel, body }]);
		}
	}
}
orFail([...definedIn.keys()], "class definitions", "the stylesheets");

/* Call sites, counted from the string literals inside a class-carrying region:
 * a `className` attribute or a `cn()` call.
 *
 * Narrower than scanning the module, and it has to be. An unprefixed class must
 * be counted — `pill` is a bare global at 37 sites and is one of the sets this
 * change retires — but a one-word class name read from free text counts every
 * string that happens to spell it: `.text`, `.timeline` and `.video` are state
 * classes that only ever appear as `.tl2-lane.video`, and a whole-module scan
 * reported them at 286, 363 and 243 sites against discriminator strings.
 *
 * `cn()` is included because the repository routes className composition through
 * it, so the classes it is handed are call sites that no `className="…"` holds.
 *
 * The token match is greedy over hyphens: `cv-input-wrap` is its own class, not
 * a use of `cv-input`, and a substring scan would count it as both. */
const CLASS_REGION = /class[Nn]ame=|\bcn(?=\()/g;
const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
const TOKEN = /[A-Za-z][A-Za-z0-9-]*/g;
const PREFIXED_UTILITY = /\btw:(?:[a-z-]+:)*(?:\[[^\]]+\]|[a-z0-9][a-z0-9/-]*(?:\[[^\]]+\])?)/g;

/** The class-carrying regions of a module: attribute values and cn() arguments. */
function classRegions(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(CLASS_REGION)) {
		let i = m.index + m[0].length;
		if (text[i] === '"' || text[i] === "'") {
			const end = text.indexOf(text[i]!, i + 1);
			if (end !== -1) out.push(text.slice(i + 1, end));
			continue;
		}
		/* A braced attribute or a call: take to the matching close. Depth
		 * counting is enough here — a brace inside a string literal within one of
		 * these regions would be a class name containing a brace. */
		const open = text[i] === "{" ? "{" : "(";
		const close = open === "{" ? "}" : ")";
		if (text[i] !== open) continue;
		let depth = 0;
		const start = ++i;
		for (; i < text.length; i++) {
			if (text[i] === open) depth++;
			else if (text[i] === close) {
				if (depth === 0) break;
				depth--;
			}
		}
		out.push(text.slice(start, i));
	}
	return out;
}
const INLINE_STYLE = /style=\{\{/g;
const LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;

/* Literal colours inside a `style={{…}}` object, which is the one place a colour
 * can be written that NOTHING in this repository checks.
 *
 * The token layer is single-sourced and enforced, the dead-token check runs both
 * directions, and the cluster-prefix rule holds every stylesheet to its own
 * cluster — and all of it reads CSS or reads `className`. `style={{ color:
 * "#fff" }}` is invisible to every one of them, so a surface can hardcode a
 * colour that is not in the palette and pass every gate.
 *
 * Geometry is deliberately not covered. A drag writes `transform` and a
 * measured lane writes a `width`; those are computed per element and cannot be a
 * class, which is why this looks for colours rather than for inline styles as
 * such. A transform never contains a colour, so the carve-out needs no rule.
 *
 * The counts below are a DEBT LIST, not permission. Each is a colour written
 * outside the token layer; the check fails when a file exceeds its entry or when
 * a file not listed gains one, so the number can only go down. Lower it by
 * moving the colour into a class that reads a token — never by editing the
 * number to match. */
const INLINE_COLOUR_DEBT: Record<string, number> = {
	/* `chat-run-cards.tsx` was 4 and is gone: three `var(--warn, #9a6700)`
	 * fallbacks and one inside a ternary, all now in `chat-run-cards.css`. The
	 * entry is deleted rather than set to 0, because the list is what a file must
	 * not exceed and an absent file is allowed none — which is the stronger
	 * statement of the same fact. */
	"components/editor/launcher.tsx": 3,
};

/** The `style={{…}}` object bodies in a module, by brace matching. */
function styleObjects(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(INLINE_STYLE)) {
		let depth = 2;
		let i = m.index + m[0].length;
		const start = i;
		for (; i < text.length && depth > 0; i++) {
			if (text[i] === "{") depth++;
			else if (text[i] === "}") depth--;
		}
		out.push(text.slice(start, i));
	}
	return out;
}

const sites = new Map<string, number>();
const consumers = new Map<string, Set<string>>();
const inlineByFile: Array<[string, number, number]> = [];
const inlineColourByFile = new Map<string, number>();
let inlineTotal = 0;
let colourTotal = 0;

for (const file of sources) {
	const text = readFileSync(file, "utf8");
	const show = relative(ROOT, file);
	const dir = dirOf(file);
	for (const region of classRegions(text)) {
		/* String literals within the region, not the region itself: a
		 * `cond && "cv-on"` carries a condition whose identifiers are not
		 * classes. A bare attribute value is its own literal already. */
		const literals = [...region.matchAll(STRING_LITERAL)].map((l) => l[1] ?? l[2] ?? l[3] ?? "");
		for (const lit of literals.length ? literals : [region]) {
			for (const m of lit.replace(PREFIXED_UTILITY, "").matchAll(TOKEN)) {
				const token = m[0]!;
				if (!definedIn.has(token)) continue;
				sites.set(token, (sites.get(token) ?? 0) + 1);
				consumers.set(token, new Set([...(consumers.get(token) ?? []), dir]));
			}
		}
	}
	if (extname(file) !== ".tsx") continue;
	const inline = [...text.matchAll(INLINE_STYLE)].length;
	const colours = [...text.matchAll(LITERAL_COLOUR)].length;
	inlineTotal += inline;
	colourTotal += colours;
	if (inline || colours) inlineByFile.push([show, inline, colours]);
	/* A fresh non-global matcher per test: `.test()` on a /g regex advances
	 * lastIndex between calls, so a shared LITERAL_COLOUR silently skips every
	 * other object and under-reports the debt. */
	const hasColour = new RegExp(LITERAL_COLOUR.source);
	const inlineColours = styleObjects(text).filter((o) => hasColour.test(o)).length;
	if (inlineColours) inlineColourByFile.set(show, inlineColours);
}
orFail([...sites.keys()], "call sites for any defined class", ROOT);

/* Sharing that is deliberate, and therefore not a finding.
 *
 * `tl2-` and `fc-` are one vocabulary declared across the timeline cluster's
 * sheets and rendered by the surfaces that make up the editor; the split into
 * two prefixes is historical, not a boundary. Declaring them keeps the report
 * about drift rather than about a decision already made.
 *
 * `app/styles/` is the global layer by construction — shell, controls,
 * typography. A class defined only there is meant to be rendered anywhere, so
 * counting it as cross-cluster measures the design rather than a violation. A
 * class defined there AND in a cluster sheet is not covered: that is a duplicate
 * definition, which is a different problem and stays reported. */
const SHARED_PREFIXES = ["tl2-", "fc-"];
const GLOBAL_SHEETS = "app/styles/";

/* Cross-cluster consumption: a class rendered by a directory that is not the one
 * whose sheet defines it. This is the signal the ownership rule cannot see. */
type Row = { cls: string; sheets: string[]; count: number; dirs: string[]; foreign: string[] };
const rows: Row[] = [];
for (const [cls, sheetSet] of definedIn) {
	const count = sites.get(cls) ?? 0;
	const dirs = [...(consumers.get(cls) ?? [])].sort();
	const owning = new Set([...sheetSet].map((s) => dirOf(resolve(ROOT, s))));
	rows.push({
		cls,
		sheets: [...sheetSet].sort(),
		count,
		dirs,
		foreign: dirs.filter((d) => !owning.has(d)),
	});
}

const candidates = rows
	.filter((r) => r.foreign.length > 0)
	.sort((a, b) => b.foreign.length - a.foreign.length || b.count - a.count);

/* The cross-cluster uses that a declaration does NOT explain: not global, not
 * one of the deliberately shared prefixes. This is the number that means
 * something — a class that leaked out of the cluster that owns it. */
const explained = (r: Row): boolean =>
	r.sheets.every((sheet) => sheet.startsWith(GLOBAL_SHEETS)) ||
	SHARED_PREFIXES.some((pre) => r.cls.startsWith(pre));
const unexplained = candidates
	.filter((r) => !explained(r))
	.map((r) => r.cls)
	.sort();

/* Machine-readable emit, for the one consumer that must not rescan.
 *
 * The inventory generator needs the same class evidence this prints, and the
 * cheapest way to give it that is a second scanner — which is the way the token
 * layer was once declared twice. Two scanners drift, and the drift is invisible
 * because each is self-consistent. So there is one scan, and the generator reads
 * its output rather than the source tree.
 *
 * Every row is emitted, not the printed head: a cut-off is a reading aid and has
 * no business deciding what an inventory contains. */
const utilityClasses = new Map<string, string[]>();
for (const file of sources) {
	const show = relative(ROOT, file);
	for (const [cls] of readFileSync(file, "utf8").matchAll(
		/\b(tw:(?:[a-z-]+:)*[a-z0-9][a-z0-9/-]*)/g,
	)) {
		utilityClasses.set(cls!, [...(utilityClasses.get(cls!) ?? []), show]);
	}
}
if (process.env.CENSUS_JSON === "1") {
	console.log(
		JSON.stringify(
			{
				root: relative(resolve(import.meta.dir, ".."), ROOT),
				stylesheets: sheets.length,
				sourceModules: sources.length,
				definedClasses: definedIn.size,
				crossClusterClasses: candidates.length,
				deadClasses: rows.filter((r) => r.count === 0).length,
				inlineStyleObjects: inlineTotal,
				literalColours: colourTotal,
				utilityClasses: [...utilityClasses].map(([cls, files]) => ({ cls, files })),
				classes: [...rows]
					.sort(
						(a, b) =>
							b.foreign.length - a.foreign.length ||
							b.count - a.count ||
							a.cls.localeCompare(b.cls),
					)
					.map((r) => ({ ...r, rules: rulesFor.get(r.cls) ?? [] })),
				inlineByFile: [...inlineByFile]
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
					.map(([file, inline, colours]) => ({ file, inline, colours })),
			},
			null,
			"\t",
		),
	);
	process.exit(0);
}

console.log(
	`census — ${definedIn.size} CSS classes and ${utilityClasses.size} prefixed utility classes in ${sheets.length} stylesheets, ${sources.length} source modules\n`,
);

console.log(
	`cross-cluster classes (${candidates.length}) — defined in one cluster, rendered by another:`,
);
for (const r of candidates.slice(0, TOP_CLASSES)) {
	console.log(`  .${r.cls}  ${r.count} sites  ${r.sheets.join(", ")}`);
	console.log(`      consumed by: ${r.dirs.join(", ")}`);
}
if (candidates.length > TOP_CLASSES) console.log(`  … ${candidates.length - TOP_CLASSES} more`);

const busiest = [...rows].sort((a, b) => b.count - a.count).slice(0, TOP_CLASSES);
console.log(`\nbusiest classes — call count is context, not the promotion test:`);
for (const r of busiest) {
	console.log(
		`  .${r.cls}  ${r.count} sites across ${r.dirs.length} dir(s)  ${r.sheets.join(", ")}`,
	);
}

const dead = rows.filter((r) => r.count === 0);
console.log(
	`\n${dead.length} defined classes have zero call sites (the liveness check in check-layers.ts owns the prefixed ones).`,
);

console.log(`\ninline style objects: ${inlineTotal}   literal colours in .tsx: ${colourTotal}`);
console.log(`heaviest files — an inline style object is a component that was never named:`);
for (const [show, inline, colours] of [...inlineByFile]
	.sort((a, b) => b[1] - a[1])
	.slice(0, TOP_FILES)) {
	console.log(`  ${show}  ${inline} inline  ${colours} literal colour(s)`);
}
/* Rendered but never defined: the other direction, which nothing checked.
 *
 * `check-layers.ts` fails on a class defined and never rendered, and on a token
 * read but never declared. It had no rule for a CLASS written into a className
 * that no stylesheet defines — and that is a live visual defect, not a tidiness
 * one. Three were found by hand while consolidating, each rendering something
 * other than what its author asked for:
 *
 *   cv-field-lbl   every cv-field label sat at inherited 16px while every other
 *                  field's label is a 9.5px mono caption
 *   cv-input sm    an input asked to be small; neither `.cv-input.sm` nor a bare
 *                  `.sm` exists
 *   cv-textarea    one MentionTextarea rendered unstyled beside three siblings
 *                  that get `cv-input`
 *
 * State classes are excluded: `.on`, `.active` and friends are defined as
 * compounds (`.tl2-lane.video`), so a bare-name scan would report every one of
 * them. The check looks only at names with a hyphen, which is what a component
 * class looks like here and what a state class does not. */
const UNDEFINED_ALLOW = new Set([
	/* Every one of these is a live defect: a class written into markup that no
	 * stylesheet defines, so the thing its author asked for has never rendered.
	 * Defining them CHANGES PIXELS, and the change that added this check is not
	 * allowed to. They are listed so the check can land now and each can be fixed
	 * under a change that may move them. Deleting a line here is the work.
	 *
	 * This list may only shrink. A new name is a new defect and fails. */

	// Every `cv-field` label renders at inherited 16px, while every other
	// field's label is a 9.5px mono caption. Reads as deliberate; is not.
	"cv-field-lbl",
	// A removable chip is styled identically to a fixed one. `.chip-remove` IS
	// defined in library.css, so this looks like the modifier that was meant to
	// pair with it and never got written.
	"chip-removable",
	// The gesturing state of a template range renders nothing, so a drag in
	// progress looks the same as one that is not.
	"is-gesturing",
	// A motion clip's body is styled as a plain text clip body.
	"tl2-clip-motionbody",
	// The clip bar's overflow control is styled as an ordinary bar button.
	"tl2-clipbar-more",
]);
const rendered = new Set<string>();
for (const file of sources) {
	for (const region of classRegions(readFileSync(file, "utf8"))) {
		for (const lit of [...region.matchAll(STRING_LITERAL)].map((l) => l[1] ?? l[2] ?? l[3] ?? "")) {
			for (const m of lit.replace(PREFIXED_UTILITY, "").matchAll(TOKEN)) rendered.add(m[0]!);
		}
	}
}
const undefinedClasses = [...rendered]
	/* A trailing hyphen is half a name: `` `mode-${mode}` `` tokenises to `mode-`,
	 * which nobody wrote and no stylesheet could define. The composed result is a
	 * dynamic class this scan cannot resolve either way, so reporting the stub
	 * would be reporting the scanner's own limitation. */
	.filter(
		(c) => c.includes("-") && !c.endsWith("-") && !definedIn.has(c) && !UNDEFINED_ALLOW.has(c),
	)
	.sort();

/* Cross-cluster leaks, named rather than counted.
 *
 * A count alone cannot say WHICH class leaked, and "435 -> 436" is not something
 * anyone can act on. The baseline is the list of names, so a new one is reported
 * by name and a fixed one shows up as a line to delete. */
const baselinePath = resolve(import.meta.dir, "cross-cluster-baseline.txt");
const baseline = new Set(
	readFileSync(baselinePath, "utf8")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#")),
);
const leaked = unexplained.filter((c) => !baseline.has(c));
const fixed = [...baseline].filter((c) => !unexplained.includes(c)).sort();
console.log(
	`\ncross-cluster: ${candidates.length} total — ${candidates.length - unexplained.length} explained by app/styles globals or the deliberate tl2-/fc- vocabulary, ${unexplained.length} not`,
);
if (fixed.length) {
	console.log(
		`  ${fixed.length} fewer than the baseline: ${fixed.slice(0, 8).join(", ")}${fixed.length > 8 ? ", …" : ""}`,
	);
	console.log(`  delete them from scripts/cross-cluster-baseline.txt`);
}

/* The debt list, enforced. A file over its entry, or an unlisted file with any,
 * fails — so this number only goes down. */
const violationsOut: string[] = [];
for (const cls of undefinedClasses) {
	violationsOut.push(
		`  .${cls}\n    written into a className, defined by no stylesheet\n` +
			"    it renders nothing — define it, or delete it from the markup",
	);
}
for (const cls of leaked) {
	violationsOut.push(
		`  .${cls}\n    rendered outside the cluster whose stylesheet defines it, and nothing declares that\n` +
			"    move it to the cluster that renders it, or promote it to a primitive that owns the spelling",
	);
}
for (const [file, count] of [...inlineColourByFile].sort(([a], [b]) =>
	a < b ? -1 : a > b ? 1 : 0,
)) {
	const allowed = INLINE_COLOUR_DEBT[file] ?? 0;
	if (count > allowed) {
		violationsOut.push(
			`  ${file}\n    ${count} literal colour(s) in style objects, ${allowed} allowed\n` +
				"    move the colour into a class that reads a token — a colour in a style object is invisible to every check here",
		);
	}
}
for (const file of Object.keys(INLINE_COLOUR_DEBT)) {
	const count = inlineColourByFile.get(file) ?? 0;
	if (count < (INLINE_COLOUR_DEBT[file] ?? 0)) {
		violationsOut.push(
			`  ${file}\n    debt is now ${count}, listed as ${INLINE_COLOUR_DEBT[file]} — lower the entry in census.ts`,
		);
	}
}
const inlineColourTotal = [...inlineColourByFile.values()].reduce((a, b) => a + b, 0);
console.log(
	`\nliteral colours inside style objects: ${inlineColourTotal} across ${inlineColourByFile.size} file(s) — a standing debt, not a solved problem`,
);
if (violationsOut.length) {
	console.error(`\n${violationsOut.length} census violation(s):\n\n${violationsOut.join("\n\n")}`);
	process.exit(1);
}

console.log(
	`\ncensus ok — ${candidates.length} cross-cluster classes, ${inlineTotal} inline style objects standing`,
);
