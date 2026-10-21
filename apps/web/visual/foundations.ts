/* The foundation board: every type role, surface, tone, step and elevation the
 * app decides on, on one page.
 *
 * This exists because `converge-web-design-system` decides foundations before
 * components, and a decision about a type scale is not reviewable as a diff of
 * `tokens.css`. Eight roles whose sizes are `clamp()` expressions cannot be
 * compared by reading them; they have to be rendered, at both ends of the
 * clamp, in both themes.
 *
 * It is markup rather than a route on purpose. A real screen shows the roles it
 * happens to use, mixed with its own content, and no screen in the app uses all
 * eight. The board is the only place the scale is visible as a scale.
 *
 * The board reads the product's compiled stylesheet — the spec mounts it over
 * the running app rather than re-linking a subset — so what it shows is what
 * ships. Same trade as `visual/inventory/fixtures.ts`: this proves the token
 * layer, not any particular call site.
 */

import { buttonClass } from "../src/design-system/components/button-recipe.ts";
import { fieldClass } from "../src/design-system/components/field-recipe.ts";
import { chipClass } from "../src/design-system/components/chip.tsx";

/** A labelled row. The label is mono-small so it never competes with the sample. */
const row = (label: string, sample: string): string =>
	`<div class="fb-row"><div class="fb-key">${label}</div><div class="fb-val">${sample}</div></div>`;

const section = (title: string, body: string): string =>
	`<section class="fb-sec"><h2 class="fb-sec-h">${title}</h2>${body}</section>`;

/* The eight type roles. Each renders the class a surface actually writes, so a
 * role that is only a token and has no class would show up here as missing. */
const TYPE = [
	["display", `<h1>Storyboard</h1>`],
	["title", `<h2>Pre-production plan</h2>`],
	["section", `<h3>Voiceover pacing</h3>`],
	["subsection", `<h4>Silence between clauses</h4>`],
	[
		"body",
		`<p class="body">Shape semantic beats here. Script and Timeline keep generated execution state.</p>`,
	],
	["caption", `<p class="caption">Estimated from the script; re-align after recording.</p>`],
	["caption-muted", `<p class="caption-muted">No runs yet.</p>`],
	["label", `<span class="label">Rendered</span>`],
	["data", `<span class="data">00:04:12.480 · 1920x1080 · 24fps</span>`],
] as const;

/* Every semantic tone, foreground on its own derived wash. Rendered as the pill
 * because the pill is where the tone/wash pairing went wrong. */
const TONES = ["ok", "warn", "err", "info", "accent"] as const;

const SURFACES = [
	["--bg", "bg"],
	["--surface", "surface"],
	["--surface-tint", "surface-tint"],
	["--surface-hover", "surface-hover"],
	["--surface-strong", "surface-strong"],
] as const;

const SPACE = ["1", "2", "3", "4", "5", "6", "8", "12", "16"] as const;
const RADII = ["1", "2", "3"] as const;
const SHADOWS = ["1", "2", "3"] as const;

/** The board's own layout. Deliberately plain: it must not style the samples. */
const CSS = `
/* Absolute and full-width, not fixed to the viewport. A fixed mount clips: the
 * first capture stopped partway down the spacing ramp, and the elevation and
 * focus sections were never in the baseline at all. */
#__foundations__ { position: absolute; top: 0; left: 0; width: 100%; z-index: 2147483647;
	min-height: 100vh; box-sizing: border-box;
	background: var(--bg); color: var(--fg); font-family: var(--font-body);
	padding: var(--page-pad); display: grid; gap: var(--s-8); align-content: start; }
.fb-sec { display: grid; gap: var(--s-3); }
.fb-sec-h { font-family: var(--font-mono); font-size: 10px; font-weight: 700;
	text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted);
	border-bottom: 1px solid var(--border); padding-bottom: var(--s-2); margin: 0; }
.fb-row { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: var(--s-4);
	align-items: baseline; }
@media (max-width: 640px) { .fb-row { grid-template-columns: 1fr; gap: var(--s-1); } }
.fb-key { font-family: var(--font-mono); font-size: 10px; color: var(--muted);
	letter-spacing: 0.04em; }
.fb-val { min-width: 0; }
.fb-swatches, .fb-inline { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: flex-end; }
.fb-swatch { display: grid; gap: 4px; font-family: var(--font-mono); font-size: 9px; color: var(--muted); }
.fb-chip { width: 72px; height: 40px; border: 1px solid var(--border); border-radius: var(--r-1); }
.fb-step { background: var(--ai); height: 12px; border-radius: 2px; }
.fb-box { width: 64px; height: 44px; background: var(--surface); border: 1px solid var(--border); }
.fb-shadow { width: 72px; height: 44px; background: var(--surface); border-radius: var(--r-2); }
`;

/** The whole board, as one HTML string. */
export function foundationsHtml(): string {
	const type = TYPE.map(([name, sample]) => row(name, sample)).join("");

	const tones = `<div class="fb-inline">${TONES.map((t) => `<span class="${chipClass(t)}">${t}</span>`).join("")}</div>`;

	const surfaces = `<div class="fb-swatches">${SURFACES.map(
		([token, name]) =>
			`<div class="fb-swatch"><div class="fb-chip" style="background: var(${token})"></div>${name}</div>`,
	).join("")}</div>`;

	const space = SPACE.map((n) =>
		row(`--s-${n}`, `<div class="fb-step" style="width: var(--s-${n})"></div>`),
	).join("");

	const radii = `<div class="fb-swatches">${RADII.map(
		(n) =>
			`<div class="fb-swatch"><div class="fb-box" style="border-radius: var(--r-${n})"></div>--r-${n}</div>`,
	).join(
		"",
	)}<div class="fb-swatch"><div class="fb-box" style="border-radius: var(--r-pill)"></div>--r-pill</div></div>`;

	const elevation = `<div class="fb-swatches">${SHADOWS.map(
		(n) =>
			`<div class="fb-swatch"><div class="fb-shadow" style="box-shadow: var(--shadow-${n})"></div>--shadow-${n}</div>`,
	).join("")}</div>`;

	/* Focus is rendered as a real ring on real controls rather than as a swatch:
	 * a ring is a width, a colour and an offset, and a swatch shows one of them. */
	const ring =
		"outline: var(--focus-w) solid var(--focus-color); outline-offset: var(--focus-offset)";
	const focus = `<div class="fb-inline">
		<button class="${buttonClass({})}" style="${ring}">focus-visible</button>
		<button class="${buttonClass({ size: "sm" })}" style="${ring}">editor</button>
		<span style="display:inline-block; width: 220px"><input class="${fieldClass("md")}" value="focused" readonly style="${ring}" /></span>
	</div>`;

	/* Density, as real controls at every step. Rendered because the question a
	 * density scale has to answer — does a control at this height still fit its
	 * label and icon — is not answerable from the number.
	 *
	 * The `touch` row was rendering at `auto` height for the whole of sections 1-3:
	 * task 1.3 deleted `--control-h-touch` as a token nothing read, and this board
	 * read it. Task 4.4 gave it a rule, so the row is a 44px control again — the
	 * board was right to keep asking. */
	const density = [
		["--control-h-xs", "xs"],
		["--control-h-sm", "sm"],
		["--control-h", "default"],
		["--control-h-touch", "touch"],
	]
		.map(([token, name]) =>
			row(
				name,
				`<button class="${buttonClass({})}" style="height: var(${token}); padding-block: 0">${name}</button>`,
			),
		)
		.join("");

	return (
		`<style>${CSS}</style>` +
		section("Type roles", type) +
		section("Semantic tones", tones) +
		section("Surfaces", surfaces) +
		section("Spacing", space) +
		section("Radius", radii) +
		section("Elevation", elevation) +
		section("Focus", focus) +
		section("Density", density)
	);
}
