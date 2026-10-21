#!/usr/bin/env bun
/* Turn a module's `style={{…}}` objects into CSS declarations.
 *
 *   bun scripts/extract-inline-styles.ts apps/web/src/components/editor/audit-panel.tsx
 *
 * Naming a surface's appearance means moving ~40 style objects into classes, and
 * the whole proof that the move changed nothing is that the visual suite passes
 * against unchanged baselines. Transcribing 40 objects by hand puts a typo
 * between the code and that proof: `fontSize: 10.5` read as `font-size: 10px` is
 * a pixel change that looks like a refactor in review. So the declarations are
 * generated from the objects themselves and the rules are pasted, not typed.
 *
 * What it does NOT do is name the classes or edit the file. Which objects are
 * one component is a judgement — two objects with identical declarations may be
 * the same thing or may be a coincidence — and a tool that guessed would produce
 * a vocabulary nobody chose. It emits the declarations and where they came from;
 * the naming is the human half.
 *
 * Objects carrying a conditional, a template literal or any identifier are
 * reported as DYNAMIC and left alone. A value computed per element — a measured
 * width, a drag's transform, a colour chosen by status — cannot be a class, and
 * that is the same carve-out `scripts/census.ts` makes when it counts literal
 * colours rather than inline styles as such.
 */
import { readFileSync } from "node:fs";

/** React renders a bare number as `px` for every property except these. */
const UNITLESS = new Set([
	"animationIterationCount",
	"aspectRatio",
	"borderImageOutset",
	"borderImageSlice",
	"borderImageWidth",
	"boxFlex",
	"boxFlexGroup",
	"boxOrdinalGroup",
	"columnCount",
	"columns",
	"flex",
	"flexGrow",
	"flexPositive",
	"flexShrink",
	"flexNegative",
	"flexOrder",
	"gridArea",
	"gridRow",
	"gridRowEnd",
	"gridRowSpan",
	"gridRowStart",
	"gridColumn",
	"gridColumnEnd",
	"gridColumnSpan",
	"gridColumnStart",
	"fontWeight",
	"lineClamp",
	"lineHeight",
	"opacity",
	"order",
	"orphans",
	"tabSize",
	"widows",
	"zIndex",
	"zoom",
	"fillOpacity",
	"floodOpacity",
	"stopOpacity",
	"strokeDasharray",
	"strokeDashoffset",
	"strokeMiterlimit",
	"strokeOpacity",
	"strokeWidth",
]);

const kebab = (prop: string): string =>
	prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The `style={{…}}` object bodies in a module, with the line each starts on.
 *
 *  Brace matching rather than a parser, and the same matching `census.ts` uses,
 *  so the two agree about what an object is. A count from one and a listing from
 *  the other that disagreed would be worse than either alone. */
function styleObjects(text: string): Array<{ body: string; line: number }> {
	const out: Array<{ body: string; line: number }> = [];
	for (const m of text.matchAll(/style=\{\{/g)) {
		let depth = 2;
		let i = m.index + m[0].length;
		const start = i;
		for (; i < text.length && depth > 0; i++) {
			if (text[i] === "{") depth++;
			else if (text[i] === "}") depth--;
		}
		/* `i - 2`, not `i`: the loop exits one PAST the closing `}}`, and `census.ts`
		 * — which this matching is copied from — keeps both braces because it only
		 * regex-searches the slice for colours. Here the slice is parsed, so a
		 * trailing brace lands in the last entry and turns `padding: 8` into
		 * `padding: 8 }`, which reads as dynamic. It reported all 45 of the first
		 * file as dynamic before this line said `- 2`. */
		out.push({ body: text.slice(start, i - 2), line: text.slice(0, m.index).split("\n").length });
	}
	return out;
}

/** Split an object body on top-level commas. */
function entries(body: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quote: string | null = null;
	let at = 0;
	for (let i = 0; i < body.length; i++) {
		const c = body[i]!;
		if (quote) {
			if (c === "\\") i++;
			else if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			quote = c;
			continue;
		}
		if ("{[(".includes(c)) depth++;
		else if ("}])".includes(c)) depth--;
		else if (c === "," && depth === 0) {
			out.push(body.slice(at, i));
			at = i + 1;
		}
	}
	out.push(body.slice(at));
	return out.map((s) => s.trim()).filter(Boolean);
}

interface Declaration {
	prop: string;
	value: string;
}

/** One `key: value` pair as CSS, or null if the value is not a literal.
 *
 *  "Literal" is deliberately narrow: a quoted string with no interpolation, or a
 *  number. A `var(--border)` inside a quoted string is a literal here and stays
 *  exactly as written, which is the point — the token reference survives the
 *  move rather than being resolved. */
function declaration(entry: string): Declaration | null {
	const colon = entry.indexOf(":");
	if (colon === -1) return null;
	const rawKey = entry.slice(0, colon).trim();
	const rawValue = entry.slice(colon + 1).trim();
	const key = rawKey.replace(/^["']|["']$/g, "");
	if (!/^(?:--)?[A-Za-z][A-Za-z0-9-]*$/.test(key)) return null;

	const quoted = rawValue.match(/^"([^"\\]*)"$|^'([^'\\]*)'$/);
	if (quoted) return { prop: kebab(key), value: quoted[1] ?? quoted[2] ?? "" };

	if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
		const n = Number(rawValue);
		if (n === 0) return { prop: kebab(key), value: "0" };
		return { prop: kebab(key), value: UNITLESS.has(key) ? String(n) : `${n}px` };
	}
	return null;
}

const file = process.argv[2];
if (!file) {
	console.error("usage: bun scripts/extract-inline-styles.ts <file.tsx>");
	process.exit(1);
}

const text = readFileSync(file, "utf8");
const objects = styleObjects(text);
let staticCount = 0;
const seen = new Map<string, number[]>();

for (const [i, object] of objects.entries()) {
	const parts = entries(object.body);
	const decls = parts.map(declaration);
	const dynamic = decls.some((d) => d === null);
	const css = decls
		.filter((d): d is Declaration => d !== null)
		.map((d) => `${d.prop}: ${d.value};`)
		.join(" ");
	if (dynamic) {
		const kept = css ? ` — static part: { ${css} }` : "";
		console.log(`#${i + 1} L${object.line}  DYNAMIC${kept}`);
		continue;
	}
	staticCount++;
	console.log(`#${i + 1} L${object.line}  { ${css} }`);
	seen.set(css, [...(seen.get(css) ?? []), object.line]);
}

console.log(
	`\n${objects.length} style object(s): ${staticCount} static, ${objects.length - staticCount} dynamic`,
);
const repeats = [...seen].filter(([, lines]) => lines.length > 1);
if (repeats.length) {
	/* Repeats are reported rather than merged: identical declarations may be one
	 * component used twice or two that happen to agree today, and only a reader
	 * knows which. */
	console.log(
		`\n${repeats.length} declaration set(s) appear more than once — candidates for one class:`,
	);
	for (const [css, lines] of repeats.sort((a, b) => b[1].length - a[1].length)) {
		console.log(`  ${lines.length}x L${lines.join(", L")}  { ${css} }`);
	}
}
