/* The one generator behind both design-tool publications.
 *
 * Two files come out of here, never one. `Maleo UI Inventory` holds every
 * candidate the repository can see, duplicates and awkward variants included,
 * so a designer can compare implementations that consolidation is about to
 * delete. `Maleo UI Kit` holds only what convergence approved. They stay
 * separate because a candidate sitting in a shared library is selectable as
 * though it were sanctioned, and nobody reads a status field before dragging a
 * component onto a board.
 *
 * Three inputs, and nothing else: the token sheets, the census, and the
 * dispositions. In particular this never scans component source. The census
 * already does that, and a second scanner would drift from the first while both
 * stayed internally consistent — which is precisely how the palette came to be
 * declared twice, with the unread half looking authoritative.
 *
 * One-way. Nothing in the repository reads the design tool back, so the
 * published form is regenerated rather than reconciled, and its absence blocks
 * no gate.
 *
 * Run: bun scripts/publish-ui.ts [--mode inventory|kit] [--out DIR]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { CANDIDATES, type Candidate, relatedTo, validate } from "./ui-dispositions";

const REPO = resolve(import.meta.dirname, "..");
const CENSUS = resolve(REPO, "apps/web/scripts/census.ts");
/* The app's palette, declared on :root. (VUI's opt-in theme was a second
 * system here until the package retired.) */
const TOKEN_SHEETS = [
	{ system: "App", file: "apps/web/src/design-system/tokens/tokens.css" },
] as const;

type Rule = { sheet: string; selector: string; body: string };
type CensusClass = {
	cls: string;
	sheets: string[];
	count: number;
	dirs: string[];
	foreign: string[];
	rules: Rule[];
};
type Census = {
	stylesheets: number;
	sourceModules: number;
	definedClasses: number;
	crossClusterClasses: number;
	inlineStyleObjects: number;
	classes: CensusClass[];
};

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const mode = arg("mode", "inventory");
if (mode !== "inventory" && mode !== "kit") {
	console.error(`publish-ui: unknown mode ${mode} — expected inventory or kit`);
	process.exit(1);
}
const outDir = resolve(REPO, arg("out", `build/ui-${mode}`));

/** The commit every entry is pinned to, so a stale publication is detectable. */
function sourceCommit(): string {
	const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" });
	if (r.status !== 0) {
		console.error("publish-ui: cannot read HEAD — every entry must name the commit it came from");
		process.exit(1);
	}
	return r.stdout.trim();
}

/** Census evidence, from the census itself rather than from a second scan. */
function readCensus(): Census {
	const r = spawnSync("bun", [CENSUS], {
		cwd: resolve(REPO, "apps/web"),
		encoding: "utf8",
		env: { ...process.env, CENSUS_JSON: "1" },
		maxBuffer: 64 * 1024 * 1024,
	});
	if (r.status !== 0) {
		console.error(
			`publish-ui: census failed — publication has no evidence without it\n${r.stderr}`,
		);
		process.exit(1);
	}
	// SAFETY: the shape is census.ts's own CENSUS_JSON emit, which this repository
	// owns and which the exit-status check above proves ran to completion. A
	// mismatch is a change to that emit, and the tests read every field asserted
	// here, so it fails there rather than silently producing an empty inventory.
	return JSON.parse(r.stdout) as Census;
}

/** Declared tokens of one theming system, in declaration order. */
function readTokens(file: string): Array<{ name: string; value: string }> {
	const css = readFileSync(resolve(REPO, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const seen = new Set<string>();
	const out: Array<{ name: string; value: string }> = [];
	for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
		const name = m[1]!;
		if (seen.has(name)) continue; // first declaration wins, as the cascade does
		seen.add(name);
		out.push({ name, value: m[2]!.trim() });
	}
	return out;
}

const esc = (s: string): string =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Wrap to a column width, so a long directory list does not run off the board. */
function wrap(text: string, width: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const w of words) {
		if (line && line.length + 1 + w.length > width) {
			lines.push(line);
			line = w;
		} else line = line ? `${line} ${w}` : w;
	}
	if (line) lines.push(line);
	return lines.length ? lines : [""];
}

/** The declarations that make one spelling differ from another. */
function declarations(entry: CensusClass | undefined): string[] {
	if (!entry) return [];
	/* The rule whose selector is the bare class, when there is one. A candidate's
	 * own rule is what a reader is comparing; a contextual override such as
	 * `.tl2-clippanel .tl2-field` describes a container, not the component. */
	const base = entry.rules.find((r) => r.selector.trim() === `.${entry.cls}`) ?? entry.rules[0];
	if (!base) return [];
	return base.body
		.split(";")
		.map((d) => d.trim().replace(/\s+/g, " "))
		.filter(Boolean);
}

const CARD_W = 340;
const PAD = 20;
const LINE = 15;

type Line = { text: string; kind: "label" | "value" | "code" | "head" };

function cardLines(c: Candidate, census: Map<string, CensusClass>, sourceLabel: string): Line[] {
	const ev = c.cls ? census.get(c.cls) : undefined;
	const lines: Line[] = [
		{ text: c.cls ? `.${c.cls}` : (c.component ?? c.id), kind: "head" },
		{ text: `status  ${c.status}`, kind: "label" },
	];
	if (c.becomes) lines.push({ text: `becomes  ${c.becomes}`, kind: "label" });
	if (c.why) for (const l of wrap(`why  ${c.why}`, 44)) lines.push({ text: l, kind: "label" });

	if (ev) {
		lines.push({
			text: `used  ${ev.count} site(s) in ${ev.dirs.length} directory(ies)`,
			kind: "value",
		});
		for (const s of ev.sheets)
			for (const l of wrap(`defined  ${s}`, 44)) lines.push({ text: l, kind: "value" });
		if (ev.dirs.length) {
			for (const l of wrap(`consumed by  ${ev.dirs.join(", ")}`, 44))
				lines.push({ text: l, kind: "value" });
		}
		if (ev.foreign.length) {
			for (const l of wrap(`outside its cluster  ${ev.foreign.join(", ")}`, 44)) {
				lines.push({ text: l, kind: "value" });
			}
		}
	} else if (c.component) {
		/* No class at all. Every structural check in the repository reads CSS or a
		 * className, so a surface built from inline style objects is invisible to
		 * all of them — which is the finding, not an omission in this card. */
		lines.push({ text: `source  ${c.component}`, kind: "value" });
		lines.push({ text: "no class — built from inline style objects,", kind: "value" });
		lines.push({ text: "so no structural check can see it", kind: "value" });
	}

	const decls = declarations(ev);
	if (decls.length) {
		lines.push({ text: "declares", kind: "label" });
		for (const d of decls.slice(0, 10))
			for (const l of wrap(d, 42)) lines.push({ text: l, kind: "code" });
		if (decls.length > 10) lines.push({ text: `… ${decls.length - 10} more`, kind: "code" });
	}

	const related = relatedTo(c, CANDIDATES).map((r) => r.id);
	if (related.length) {
		for (const l of wrap(`compare with  ${related.join(", ")}`, 44))
			lines.push({ text: l, kind: "label" });
	}
	lines.push({ text: `source  ${sourceLabel}`, kind: "label" });
	return lines;
}

const FILL: Record<Line["kind"], string> = {
	head: "#111827",
	label: "#6b7280",
	value: "#374151",
	code: "#7c3aed",
};

function board(title: string, subtitle: string, cards: Array<{ lines: Line[] }>): string {
	const height = Math.max(...cards.map((c) => c.lines.length), 1) * LINE + PAD * 2;
	const w = PAD + cards.length * (CARD_W + PAD);
	const svgH = height + 92;
	const parts = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${svgH}" viewBox="0 0 ${w} ${svgH}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
		`<rect width="${w}" height="${svgH}" fill="#ffffff"/>`,
		`<text x="${PAD}" y="34" font-size="20" font-weight="700" fill="#111827">${esc(title)}</text>`,
		`<text x="${PAD}" y="56" font-size="12" fill="#6b7280">${esc(subtitle)}</text>`,
	];
	cards.forEach((card, i) => {
		const x = PAD + i * (CARD_W + PAD);
		parts.push(
			`<rect x="${x}" y="76" width="${CARD_W}" height="${height}" rx="10" fill="#f9fafb" stroke="#e5e7eb"/>`,
		);
		card.lines.forEach((line, j) => {
			const y = 76 + PAD + 4 + j * LINE;
			const size = line.kind === "head" ? 14 : 11;
			const weight = line.kind === "head" ? "700" : "400";
			parts.push(
				`<text x="${x + 14}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${FILL[line.kind]}">${esc(line.text)}</text>`,
			);
		});
	});
	parts.push("</svg>");
	return parts.join("\n");
}

function tokenBoard(
	system: string,
	file: string,
	tokens: Array<{ name: string; value: string }>,
): string {
	const COLS = 4;
	const rowH = 46;
	const colW = 300;
	const rows = Math.ceil(tokens.length / COLS);
	const h = rows * rowH + 96;
	const w = PAD + COLS * colW + PAD;
	const parts = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
		`<rect width="${w}" height="${h}" fill="#ffffff"/>`,
		`<text x="${PAD}" y="34" font-size="20" font-weight="700" fill="#111827">${esc(`${system} foundations`)}</text>`,
		`<text x="${PAD}" y="56" font-size="12" fill="#6b7280">${esc(`${tokens.length} declared tokens — ${file}`)}</text>`,
	];
	tokens.forEach((t, i) => {
		const x = PAD + (i % COLS) * colW;
		const y = 80 + Math.floor(i / COLS) * rowH;
		/* A swatch only where the value is a colour a viewer can resolve on its
		 * own. A var() reference or a shadow renders nothing useful in a box, and
		 * an empty box reads as a bug rather than as "not a colour". */
		const isColour = /^(#|rgb|hsl|oklch)/i.test(t.value);
		if (isColour) {
			parts.push(
				`<rect x="${x}" y="${y}" width="30" height="30" rx="6" fill="${esc(t.value)}" stroke="#e5e7eb"/>`,
			);
		}
		parts.push(
			`<text x="${x + (isColour ? 38 : 0)}" y="${y + 13}" font-size="11" font-weight="700" fill="#111827">${esc(t.name)}</text>`,
			`<text x="${x + (isColour ? 38 : 0)}" y="${y + 27}" font-size="10" fill="#6b7280">${esc(t.value.slice(0, 34))}</text>`,
		);
	});
	parts.push("</svg>");
	return parts.join("\n");
}

// ---- generate ----

const commit = sourceCommit();
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
	cwd: REPO,
	encoding: "utf8",
});
if (status.status !== 0) throw new Error("publish-ui: cannot read working-tree state");
const sourceTreeState = status.stdout.trim() ? "modified" : "clean";
const sourceLabel = `${commit.slice(0, 12)}${sourceTreeState === "modified" ? " + local edits" : ""}`;
const census = readCensus();
const byClass = new Map(census.classes.map((c) => [c.cls, c]));

const problems = validate(CANDIDATES, new Set(byClass.keys()));
if (problems.length) {
	console.error(
		`publish-ui: disposition data does not match the census\n  ${problems.join("\n  ")}`,
	);
	process.exit(1);
}

/* Inventory publishes every candidate. The kit publishes only what convergence
 * approved — it cannot promote by usage count, or by a candidate merely being
 * present in the inventory. */
const selected = mode === "kit" ? CANDIDATES.filter((c) => c.status === "approved") : CANDIDATES;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const groups = [...new Set(selected.map((c) => c.group))].sort();
const files: string[] = [];

const foundations = TOKEN_SHEETS.map(({ system, file }) => ({
	system,
	file,
	tokens: readTokens(file),
}));
for (const { system, file, tokens } of foundations) {
	const name = `foundations-${system.toLowerCase()}.svg`;
	writeFileSync(resolve(outDir, name), tokenBoard(system, file, tokens));
	files.push(name);
}

for (const group of groups) {
	/* Side-by-side within the group, which is the only arrangement that answers
	 * the question the inventory exists for: how these implementations differ. */
	const members = selected
		.filter((c) => c.group === group)
		.sort((a, b) => a.id.localeCompare(b.id));
	const subtitle = `${members.length} implementation(s) — side by side, at ${sourceLabel}`;
	const svg = board(
		group,
		subtitle,
		members.map((c) => ({ lines: cardLines(c, byClass, sourceLabel) })),
	);
	const name = `${group.toLowerCase()}.svg`;
	writeFileSync(resolve(outDir, name), svg);
	files.push(name);
}

/* The manifest is what a publisher walks; the boards are what a designer reads.
 * No timestamp anywhere, so the same commit and mode produce identical bytes. */
const manifest = {
	file: mode === "kit" ? "Maleo UI Kit" : "Maleo UI Inventory",
	mode,
	sourceCommit: commit,
	sourceTreeState,
	generator: "scripts/publish-ui.ts",
	census: {
		stylesheets: census.stylesheets,
		sourceModules: census.sourceModules,
		definedClasses: census.definedClasses,
		crossClusterClasses: census.crossClusterClasses,
		inlineStyleObjects: census.inlineStyleObjects,
	},
	entryCount: selected.length,
	/* Carried so a publisher can build the boards in a design tool's own shapes
	 * rather than importing a flat image. The SVG boards stay for anyone without
	 * that tool; this is the same content in machine-readable form. */
	foundations,
	groups: groups.map((g) => ({
		group: g,
		board: `${g.toLowerCase()}.svg`,
		entries: selected
			.filter((c) => c.group === g)
			.map((c) => ({
				id: c.id,
				status: c.status,
				/* Where a retired entry went. The rendered board has carried this
				 * since `cardLines`, but the manifest did not — which did not show
				 * while every entry was a `candidate` and nothing had a destination.
				 * A machine reader of the manifest would have seen `merged` with no
				 * way to find the survivor. */
				becomes: c.becomes ?? null,
				/* What the approval rests on. The kit is the artifact a designer
				 * reads, and "approved" in it means a component was DRIVEN on the
				 * representative surfaces — so the manifest names them, for the same
				 * reason it names `becomes`: a reader should not have to take the
				 * status on trust. Empty for every other state, which cannot carry
				 * surface proof. */
				provenBy: c.provenBy ?? [],
				cls: c.cls ?? null,
				component: c.component ?? null,
				sheets: c.cls ? (byClass.get(c.cls)?.sheets ?? []) : [],
				usage: c.cls ? (byClass.get(c.cls)?.count ?? 0) : 0,
				consumedBy: c.cls ? (byClass.get(c.cls)?.dirs ?? []) : [],
				outsideItsCluster: c.cls ? (byClass.get(c.cls)?.foreign ?? []) : [],
				declares: c.cls ? declarations(byClass.get(c.cls)) : [],
				related: relatedTo(c, CANDIDATES).map((r) => r.id),
				sourceCommit: commit,
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
	})),
	boards: files.sort(),
};
writeFileSync(resolve(outDir, "index.json"), `${JSON.stringify(manifest, null, "\t")}\n`);

console.log(`${manifest.file} — ${selected.length} entries across ${groups.length} groups`);
console.log(`  at ${sourceLabel}, from tokens + census + dispositions`);
console.log(`  ${files.length + 1} files in ${relative(REPO, outDir)}`);
if (mode === "kit" && selected.length === 0) {
	console.log("  empty, because convergence has approved nothing yet — that is the correct state");
}
