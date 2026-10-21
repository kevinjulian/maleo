/* Representative markup for each inventory candidate.
 *
 * These exist because the published inventory could not be judged: an entry
 * saying `.cv-field` declares `display: block` tells a designer nothing about
 * what a field looks like, and choosing between four field implementations is
 * exactly what the inventory is for.
 *
 * The markup is copied from real call sites, not invented — `cv-field` is a
 * `<label>` wrapping `cv-field-lbl`, a `cv-input` and a `cv-field-hint` because
 * that is what `references/entity-editor.tsx` renders. Copy from a call site
 * when adding one; a fixture that renders markup nothing writes proves nothing.
 *
 * IMPORTANT, and the cost of this approach: these fixtures prove the
 * STYLESHEET, not the call sites. A candidate whose real usage differs from the
 * markup here will look right in the inventory and wrong in the application.
 * The images support a comparison between implementations; they do not certify
 * that a component renders correctly where it is used.
 *
 * Icons are a neutral placeholder glyph rather than the product's icon set: the
 * call sites pass `Ic.spark(10)` and friends from a React module, and importing
 * that here would make this a second rendering path. The glyph occupies the
 * same box so spacing is honest; the shape is not the product's.
 */

/** A stand-in for the product's icons, at the size the call site asks for. */
export const icon = (size: number): string =>
	`<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="flex:none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.6"/></svg>`;

export type Fixture = {
	/** Matches the candidate id in `scripts/ui-dispositions.ts`. */
	readonly id: string;
	/** Rendered variants. One entry means the candidate has no variant axis. */
	readonly variants: ReadonlyArray<{ label: string; html: string }>;
	/** Width of the mount, where the component needs a container to fill. */
	readonly width?: number;
	/** Set when the candidate cannot be rendered on its own, with the reason. */
	readonly noIsolatedAppearance?: string;
};

const field = (cls: string, label: string, hintCls?: string): string =>
	`<label class="${cls}"><span${cls === "cv-field" ? ' class="cv-field-lbl"' : ""}>${label}</span>` +
	`<input class="cv-input" value="Anna" readonly />` +
	(hintCls
		? `<span class="${hintCls}">${icon(11)} Default use-when text for materials.</span>`
		: "") +
	`</label>`;

export const FIXTURES: readonly Fixture[] = [
	// ── Button ──────────────────────────────────────────────────────────────
	{
		id: "btn",
		variants: [
			{ label: "default", html: `<button class="btn">${icon(15)} Generate</button>` },
			{ label: "dark", html: `<button class="btn btn-dark">${icon(15)} Generate</button>` },
			{ label: "light", html: `<button class="btn btn-light">${icon(15)} Generate</button>` },
			{ label: "ghost", html: `<button class="btn btn-ghost">${icon(15)} Generate</button>` },
			{ label: "sm", html: `<button class="btn btn-sm">${icon(13)} Generate</button>` },
			{ label: "disabled", html: `<button class="btn" disabled>${icon(15)} Generate</button>` },
		],
	},
	{
		id: "cv-btn",
		variants: [
			{ label: "default", html: `<button class="cv-btn">${icon(14)} Save</button>` },
			{ label: "ai", html: `<button class="cv-btn cv-btn-ai">${icon(14)} Ask AI</button>` },
			{ label: "dark", html: `<button class="cv-btn cv-btn-dark">${icon(14)} Save</button>` },
			{ label: "light", html: `<button class="cv-btn cv-btn-light">${icon(14)} Save</button>` },
			{ label: "ghost", html: `<button class="cv-btn cv-btn-ghost">${icon(14)} Save</button>` },
			{ label: "danger", html: `<button class="cv-btn cv-btn-danger">${icon(14)} Delete</button>` },
			{ label: "sm", html: `<button class="cv-btn sm">${icon(12)} Save</button>` },
			{ label: "disabled", html: `<button class="cv-btn" disabled>${icon(14)} Save</button>` },
		],
	},
	{
		id: "cv-textbtn",
		variants: [
			{ label: "default", html: `<button class="cv-textbtn">Add from workspace library</button>` },
		],
	},

	// ── Chip ────────────────────────────────────────────────────────────────
	{ id: "pill", variants: [{ label: "default", html: `<span class="pill">12 images</span>` }] },
	{
		id: "fc-quickchip",
		variants: [
			{ label: "default", html: `<button class="fc-quickchip">${icon(10)} 3 sources ▾</button>` },
		],
	},
	{
		id: "fc-em-chip",
		variants: [{ label: "default", html: `<span class="fc-em-chip">${icon(11)} 00:42</span>` }],
	},
	{
		id: "sc-flag",
		variants: [
			{
				label: "default",
				html: `<div class="sc-flag">${icon(10)} text changed since this speech was generated</div>`,
			},
		],
	},
	{
		id: "tl2-ref-chip",
		variants: [
			{
				label: "with image",
				html: `<div class="tl2-ref-chip"><span class="tl2-ref-chip-empty">A</span><span>Anna</span></div>`,
			},
			{
				label: "label only",
				html: `<div class="tl2-ref-chip"><span>Establishing shot</span></div>`,
			},
		],
	},

	// ── Field ───────────────────────────────────────────────────────────────
	{
		id: "cv-field",
		width: 360,
		variants: [{ label: "default", html: field("cv-field", "Label", "cv-field-hint") }],
	},
	{
		id: "tl2-field",
		width: 360,
		variants: [{ label: "default", html: field("tl2-field", "Name") }],
	},
	{
		id: "fc-cap-field",
		width: 360,
		variants: [{ label: "default", html: field("fc-cap-field", "Max visual beat") }],
	},
	{
		id: "settings-field",
		width: 560,
		variants: [
			{
				label: "default",
				html:
					`<label class="settings-field"><span class="settings-field-label">API key<em class="settings-field-optional">optional</em></span>` +
					`<input class="cv-input" value="sk-…" readonly /><span class="settings-field-help">Stored encrypted at rest.</span></label>`,
			},
		],
	},

	// ── Input / IconButton ──────────────────────────────────────────────────
	{
		id: "cv-input",
		width: 360,
		variants: [
			{ label: "text", html: `<input class="cv-input" value="Anna" readonly />` },
			{
				label: "placeholder",
				html: `<input class="cv-input" placeholder="/uploads/anna.png" readonly />`,
			},
			{
				label: "textarea",
				html: `<textarea class="cv-input" rows="3" readonly>A wide establishing shot.</textarea>`,
			},
			{ label: "disabled", html: `<input class="cv-input" value="Anna" disabled />` },
		],
	},
	{
		id: "cv-iconbtn",
		variants: [
			{
				label: "default",
				html: `<button class="cv-iconbtn" aria-label="Close">${icon(16)}</button>`,
			},
		],
	},

	// ── Note ────────────────────────────────────────────────────────────────
	{
		id: "settings-note",
		width: 440,
		variants: [
			{
				label: "default",
				html: `<p class="settings-note">Save this now as <code>MALEO_MASTER_KEY</code> in your deployment environment. It is shown once.</p>`,
			},
		],
	},
	{
		id: "tl2-dsec-note",
		width: 440,
		variants: [
			{
				label: "default",
				html: `<p class="tl2-dsec-note">No project references selected yet — open the library and use “Use as project reference”.</p>`,
			},
		],
	},
	{
		id: "cv-provider-warning",
		width: 440,
		variants: [
			{
				label: "default",
				html: `<p class="cv-provider-warning" role="status">No image provider is configured for this workspace.</p>`,
			},
		],
	},
	{
		id: "settings-field-warn",
		width: 440,
		variants: [
			{
				label: "default",
				html: `<span class="settings-field-warn">That key was rejected by the provider.</span>`,
			},
		],
	},

	// ── Panel hierarchy ─────────────────────────────────────────────────────
	{
		id: "tl2-dsec",
		width: 320,
		variants: [
			{
				label: "default",
				html:
					`<section class="tl2-dsec"><div class="tl2-dsec-h">${icon(13)} Audio Controls</div>` +
					`<p class="tl2-dsec-note">Under voice, this drops to −12 dB.</p></section>`,
			},
		],
	},
	{
		id: "tl2-panel",
		width: 300,
		variants: [
			{
				label: "default",
				html:
					`<aside class="tl2-panel" style="height:260px"><header class="ui-phead"><div class="ui-phead-text"><h2 class="ui-phead-title">References</h2></div></header>` +
					`<div class="tl2-panel-body"><div class="tl2-ref-chip"><span>Anna</span></div></div></aside>`,
			},
		],
	},

	// ── Overlay ─────────────────────────────────────────────────────────────
	{
		id: "cv-modal",
		width: 460,
		variants: [
			{
				label: "default",
				html:
					`<div class="cv-modal" style="width:440px"><div class="cv-modal-h"><strong>Edit reference</strong>` +
					`<button class="cv-iconbtn" aria-label="Close">${icon(16)}</button></div>` +
					`<div style="padding:16px 18px 18px">${field("cv-field", "Label", "cv-field-hint")}</div>` +
					`<div class="cv-modal-actions"><button class="cv-btn cv-btn-ghost">Cancel</button><button class="cv-btn cv-btn-dark">Save</button></div></div>`,
			},
		],
	},
	{
		id: "ui-sheet",
		variants: [],
		noIsolatedAppearance:
			"`.ui-sheet` declares only `z-index: 701`. It has no appearance of its own — what a viewer sees is the sheet's chrome in `sheet.css` and whatever it contains.",
	},
	{
		id: "design-system/components/lightbox.tsx",
		variants: [],
		noIsolatedAppearance:
			"Built entirely from inline style objects and carries no class, so there is nothing for a stylesheet-driven harness to mount. That is the finding, not a gap: no structural check in the repository can see it either.",
	},
];
