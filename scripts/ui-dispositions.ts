/* What the repository has decided about each UI candidate.
 *
 * This file holds decisions and nothing else. It deliberately does not record a
 * candidate's defining stylesheet, call-site count or consuming directories,
 * because the census already measures those and a second copy would be a second
 * source — the failure the token layer spent a change removing when the palette
 * was declared twice and the unread half went on looking authoritative. The
 * generator joins these decisions to census evidence at publish time.
 *
 * There is no status service and no runtime lookup. A disposition changes by
 * someone editing this file in a reviewed commit, which is the only mechanism
 * that keeps the repository the authority the design tool reads from.
 *
 * Approval is not granted here. Every entry is a `candidate` until
 * `converge-web-design-system` decides otherwise; presence in the inventory is
 * evidence that something exists, never that it is sanctioned.
 */

/** The six states a candidate can be in. `candidate` is where all of them start. */
export const DISPOSITIONS = [
	/** Observed in production. Not judged. */
	"candidate",
	/** Passed convergence. The only state that reaches `Maleo UI Kit`. */
	"approved",
	/** Stays where it is on purpose — one surface, or genuinely local. */
	"retained-local",
	/** Folded into another entry, which now renders it. */
	"merged",
	/** Superseded by a different entry. */
	"replaced",
	/** On its way out, with nothing taking it over. */
	"deprecated",
] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/** A disposition that must name where the candidate went. */
const REDIRECTING: readonly Disposition[] = ["merged", "replaced"];
/** A disposition that must say why, because the reason is the whole decision. */
const NEEDS_REASON: readonly Disposition[] = ["retained-local", "deprecated"];

export type Candidate = {
	/** Stable key. Usually the class; the component path when there is no class. */
	readonly id: string;
	/** The concept, which is what makes two spellings comparable. */
	readonly group: string;
	readonly status: Disposition;
	/** The class as the census names it, without the leading dot. */
	readonly cls?: string;
	/** Repo-relative source, for a candidate with no class of its own. */
	readonly component?: string;
	/** Where it went. Required for `merged` and `replaced`; an `id` here. */
	readonly becomes?: string;
	/** Required for `retained-local` and `deprecated`. */
	readonly why?: string;
	/* The representative surfaces this component was DRIVEN on, as the spec files
	 * that drive them. Required for `approved`.
	 *
	 * `web-design-system-convergence` says call-site count identifies a candidate
	 * and never approves one, and that approval needs the affected surfaces
	 * exercised at desktop and phone widths. Without a field for it, "approved"
	 * is a word someone typed; with one, the entry names what would fail if the
	 * component broke. Section 5 filled these in — task 2 set every status, and
	 * approval was not final until the surfaces ran. */
	readonly provenBy?: readonly string[];
};

/* Dispositions decided by `converge-web-design-system` section 2.
 *
 * Each one is a judgement about the component's JOB, taken after reading its
 * declarations side-by-side with the others in its group. Call-site count is
 * cited where it settles which of two spellings survives a merge; it never
 * decides whether a merge is right. Two things that differ by 1px of padding
 * are one thing badly copied, and two things that differ in anatomy are two
 * things however similar they look. */
export const CANDIDATES: readonly Candidate[] = [
	/* ── Button ──────────────────────────────────────────────────────────────
	 * `btn` and `cv-btn` are one button written twice. Side by side: gap 8 vs
	 * 7px, padding 10/16 vs 9/15, size 14 vs 13px, weight 500 vs 550, disabled
	 * opacity 0.50 vs 0.45. Nobody chose 0.45 over 0.50; that is a copy that
	 * drifted. `button.tsx` says the merge "is a visual decision and belongs
	 * with the stylesheet work" — this is that work.
	 *
	 * `btn` survives as the class: it is unprefixed and already lives in the
	 * shared `controls.css` rather than a cluster sheet.
	 *
	 * That is a decision about the NAME and nothing else, because the call-site
	 * evidence runs the other way and the inventory hides it. The census reports
	 * one site each, since `button.tsx` is the only place either class is
	 * written — but through that file `EditorButton` is rendered 241 times and
	 * `Button` 28. The editor is the larger surface, not the shell.
	 *
	 * So the merged metrics must not silently restyle the editor. Density is a
	 * foundation now (`--control-h` / `--control-h-sm`), and the editor's
	 * treatment becomes the `sm` size rather than a second class family. Moving
	 * those 241 call sites onto it is the substance of task 3.2 and needs the
	 * editor driven at both widths before it counts as done.
	 *
	 * `cv-textbtn` is NOT the same button without a border. It has no padding
	 * box, no background, no border, carries `--ai`, and its hover is opacity
	 * rather than a fill — a link-shaped action, not a button. 21 call sites. */
	{
		id: "btn",
		group: "Button",
		status: "approved",
		component: "apps/web/src/design-system/components/button.tsx",
		provenBy: [
			"apps/web/visual/settings-form.spec.ts",
			"apps/web/visual/library-chrome.spec.ts",
			"apps/web/visual/mobile-editor.spec.ts",
			"apps/web/visual/touch-targets.spec.ts",
		],
	},
	/* Reviewed at both widths across Content, Create, Library, Settings and editor;
	 * keyboard, focus, disabled, hover, busy and dark states are driven below. */
	{
		id: "design-system/components/button.tsx#primary",
		group: "Button",
		status: "approved",
		component: "apps/web/src/design-system/components/button.tsx",
		provenBy: [
			"apps/web/visual/base-ui-button.spec.ts",
			"apps/web/visual/create-flow.spec.ts",
			"apps/web/visual/library-primitives.spec.ts",
			"apps/web/visual/settings-form.spec.ts",
			"apps/web/visual/editor-shell-primitives.spec.ts",
		],
	},
	{ id: "cv-btn", group: "Button", status: "merged", cls: "cv-btn", becomes: "btn" },
	{
		id: "cv-textbtn",
		group: "Button",
		status: "approved",
		cls: "cv-textbtn",
		provenBy: ["apps/web/visual/settings-form.spec.ts", "apps/web/visual/screens.spec.ts"],
	},

	/* ── Field ───────────────────────────────────────────────────────────────
	 * One labelled control stack, four spellings, and two of them are literally
	 * the same rule: `tl2-field` and `fc-cap-field` are both
	 * `display:flex; flex-direction:column; gap:6px` with a mono-uppercase
	 * `> span` label. `settings-field` is `display:grid; gap:6px`, which is the
	 * same stack, plus `max-width:520px` and `margin-bottom` — those two are
	 * form layout, not field anatomy, and move to the form pattern (task 4.2).
	 *
	 * `cv-field` is `display: block` and nothing else. It is not a smaller
	 * Field, it is the absence of one: the gap its callers need comes from
	 * whatever happens to be inside it. Replaced rather than merged.
	 *
	 * Task 3.4 collapsed all four, and the survivor is `.field` — unprefixed, in
	 * shared `controls.css`. Same rename `settings-note` → `.note` and
	 * `cv-provider-warning` → `.callout` got in 3.2, for the same reason: `tl2-`
	 * named the timeline and six directories render this. The entry keeps its
	 * `tl2-field` id, which is the stable key every `becomes` points at, and
	 * carries the class that now renders. */
	{
		id: "tl2-field",
		group: "Field",
		status: "approved",
		cls: "field",
		provenBy: [
			"apps/web/visual/settings-form.spec.ts",
			"apps/web/visual/mobile-editor.spec.ts",
			"apps/web/visual/screens.spec.ts",
		],
	},
	{
		id: "fc-cap-field",
		group: "Field",
		status: "merged",
		cls: "fc-cap-field",
		becomes: "tl2-field",
	},
	{
		id: "settings-field",
		group: "Field",
		status: "merged",
		cls: "settings-field",
		becomes: "tl2-field",
	},
	{ id: "cv-field", group: "Field", status: "replaced", cls: "cv-field", becomes: "tl2-field" },

	/* ── Note ────────────────────────────────────────────────────────────────
	 * `standardize-web-component-vocabulary` task 3.3 left this open by design:
	 * whether the status banner belongs with the advisory paragraph. Read as
	 * anatomy, it does not.
	 *
	 * `settings-note` (12px/1.6), `tl2-dsec-note` (11px/1.5 muted, `.warn`
	 * turning it `--err`) and `settings-field-warn` (`--err`, 1.6) are all one
	 * thing: a bare paragraph that takes a tone. They differ only in size, which
	 * is now the caption role, and in which tone they hardcode, which becomes a
	 * prop. `settings-note` survives on 20 call sites against 11 and 5.
	 *
	 * `cv-provider-warning` is not a paragraph. It has a border, a `--warn-bg`
	 * fill and 9x10 padding — a banner that occupies a block, where the others
	 * are a line of text under a control. Different anatomy is a different
	 * component, however close the words are; folding it in would need a variant
	 * that swaps the box on and off, which is the "variant that only preserves a
	 * duplicate" the spec rejects. Kept, and renamed by its job in section 3. */
	/* The two approved entries carry their NEW class and their original `id`.
	 * The id is the stable key the inventory and every `becomes` reference are
	 * keyed on, so renaming it would rewrite history at a pinned commit; the
	 * `cls` is what actually renders and has to track the stylesheet.
	 *   settings-note       → .note     (a shared primitive, not a settings one)
	 *   cv-provider-warning → .callout  (named for its job, not for one caller) */
	{
		id: "settings-note",
		group: "Note",
		status: "approved",
		cls: "note",
		provenBy: ["apps/web/visual/settings-form.spec.ts", "apps/web/visual/screens.spec.ts"],
	},
	{
		id: "tl2-dsec-note",
		group: "Note",
		status: "merged",
		cls: "tl2-dsec-note",
		becomes: "settings-note",
	},
	{
		id: "settings-field-warn",
		group: "Note",
		status: "merged",
		cls: "settings-field-warn",
		becomes: "settings-note",
	},
	{
		id: "cv-provider-warning",
		group: "Note",
		status: "approved",
		component: "apps/web/src/design-system/components/note.tsx",
		provenBy: ["apps/web/visual/settings-form.spec.ts", "apps/web/visual/screens.spec.ts"],
	},

	/* ── Chip ────────────────────────────────────────────────────────────────
	 * The group the inventory got most wrong: five entries, and only two of them
	 * are chips.
	 *
	 * `pill` is the status tag — mono, uppercase, 10px, pill radius, a tone, and
	 * not interactive. 17 call sites across 8 directories, the widest spread in
	 * the whole inventory. It is the Chip.
	 *
	 * `fc-quickchip` is the same tag made pressable: same pill radius and inline
	 * flex, but a border, a pointer cursor and a hover that goes to `--ai`.
	 * Interactive-vs-static is a real distinction, but it is a distinction
	 * within one concept and one element swap, so it is Chip's `interactive`
	 * variant rather than a second component.
	 *
	 * CORRECTED IN 3.4, and recorded because it changes where eight call sites
	 * went. That reading compared the boxes and skipped the type: `pill` is mono
	 * 10px UPPERCASE, `fc-quickchip` was 11px/500 in the body font, sentence
	 * case. Where the label is a word of state — a tab, a disclosure with a
	 * count — the merge holds and those three sites are `pill interactive`.
	 * Where it is prose it does not: "Accept outcome", a tool call's arguments
	 * and editor-chat's suggested questions came out as shouting mono. A
	 * bordered control with a sentence on it is a small button, so those ten are
	 * `btn` at `sm`. `becomes` still points at `pill`, which is where the
	 * concept went; the eight are recorded here because a `becomes` cannot say
	 * "and the rest became a button".
	 *
	 * The other three are not chips at all:
	 *  - `sc-flag` has no background, border or padding. It is mono 10px text in
	 *    `--warn` with a 4px gap — the label role plus a tone, wearing a chip's
	 *    name. Local to the script table.
	 *  - `fc-em-chip` is a wrapper that holds a `<select>` and caps it at 132px.
	 *    A compact control container, local to the editing surface.
	 *  - `tl2-ref-chip` is a two-row grid with a 30px thumbnail and a 220px cap.
	 *    That is a card. Local to timeline media. */
	{
		id: "pill",
		group: "Chip",
		status: "approved",
		component: "apps/web/src/design-system/components/chip.tsx",
		provenBy: [
			"apps/web/visual/library-chrome.spec.ts",
			"apps/web/visual/touch-targets.spec.ts",
			"apps/web/visual/screens.spec.ts",
		],
	},
	{ id: "fc-quickchip", group: "Chip", status: "merged", cls: "fc-quickchip", becomes: "pill" },
	{
		id: "sc-flag",
		group: "Chip",
		status: "retained-local",
		cls: "sc-flag",
		why: "not a chip — mono text in a tone with no box at all, and only the script table renders it",
	},
	{
		id: "fc-em-chip",
		group: "Chip",
		/* Was `retained-local` as a timeline class. The Chip primitive now draws it
		 * as its `inline` variant, so it is the same component as `pill`. */
		status: "merged",
		cls: "fc-em-chip",
		becomes: "pill",
	},
	{
		id: "tl2-ref-chip",
		group: "Chip",
		status: "retained-local",
		cls: "tl2-ref-chip",
		why: "a 30px-thumbnail card in a two-row grid, not a chip; timeline media is its only caller",
	},

	// Input and IconButton — one spelling each, no competitor to choose against,
	// and both already funnel through a primitive. Approved on their contracts
	// (section 2.2) rather than on being unopposed.
	{
		id: "cv-input",
		group: "Input",
		status: "approved",
		component: "apps/web/src/design-system/components/input.tsx",
		provenBy: ["apps/web/visual/settings-form.spec.ts", "apps/web/visual/mobile-editor.spec.ts"],
	},
	{
		id: "cv-iconbtn",
		group: "IconButton",
		status: "approved",
		component: "apps/web/src/design-system/components/icon-button.tsx",
		provenBy: [
			"apps/web/visual/library-chrome.spec.ts",
			"apps/web/visual/mobile-editor.spec.ts",
			"apps/web/visual/touch-targets.spec.ts",
		],
	},

	/* The panel hierarchy. Three tiers of containment and three real jobs:
	 * `tl2-panel` is a bordered column that owns a width, `tl2-dsec` is a
	 * titled group inside one, `tl2-ctl` is a single labelled control. Kept as
	 * three, per `design.md` — flattening them would leave the editor with no
	 * way to express depth. */
	{
		id: "tl2-panel",
		group: "Panel",
		status: "approved",
		cls: "tl2-panel",
		provenBy: [
			"apps/web/visual/mobile-editor.spec.ts",
			"apps/web/src/design-system/components/panel.test.tsx",
			"apps/web/visual/screens.spec.ts",
		],
	},
	{
		id: "tl2-dsec",
		group: "Section",
		status: "approved",
		cls: "tl2-dsec",
		provenBy: [
			"apps/web/visual/mobile-editor.spec.ts",
			"apps/web/src/design-system/components/panel.test.tsx",
			"apps/web/visual/screens.spec.ts",
		],
	},
	/* Replaced, not merged: PropertyRow is a different anatomy (a label column
	 * beside the control, with reset and state read from the control), built on
	 * canonical components rather than on this class. */
	{
		id: "tl2-ctl",
		group: "Control",
		status: "replaced",
		cls: "tl2-ctl",
		becomes: "design-system/patterns/inspector.tsx#property-row",
	},
	{
		id: "design-system/patterns/inspector.tsx#property-row",
		group: "Control",
		status: "approved",
		component: "apps/web/src/design-system/patterns/inspector.tsx",
		provenBy: [
			"apps/web/visual/clip-inspector-rows.spec.ts",
			"apps/web/visual/data-style-rows.spec.ts",
			"apps/web/visual/mobile-editor.spec.ts",
		],
	},

	/* Overlays. `consolidate-overlay-mechanism` gave these one mechanism; this
	 * change decides they keep three appearances, because they answer three
	 * questions: Modal interrupts, Sheet slides in from an edge and is the phone
	 * form of a panel, Lightbox shows one piece of media at full bleed.
	 *
	 * Lightbox is approved on its job, not its present state: it carries no
	 * class at all, being built entirely from inline style objects, so no
	 * structural check in the repository can see it. Section 3.3 gives it a
	 * stylesheet; that is the condition of the approval rather than a follow-up. */
	{
		id: "cv-modal",
		group: "Overlay",
		status: "approved",
		cls: "cv-modal",
		provenBy: [
			"apps/web/src/design-system/components/modal.test.tsx",
			"apps/web/visual/library-chrome.spec.ts",
			"apps/web/visual/mobile-editor.spec.ts",
		],
	},
	{
		id: "ui-sheet",
		group: "Overlay",
		status: "approved",
		cls: "ui-sheet",
		provenBy: [
			"apps/web/src/design-system/components/modal.test.tsx",
			"apps/web/visual/mobile-editor.spec.ts",
			"apps/web/visual/touch-targets.spec.ts",
		],
	},
	{
		id: "design-system/components/lightbox.tsx",
		group: "Overlay",
		status: "approved",
		component: "apps/web/src/design-system/components/lightbox.tsx",
		/* Driven through the shared overlay mechanism it routes through, not
		 * through a stylesheet it does not have: giving it one is
		 * `adopt-base-ui-primitives` task 3.1, where defect 8 went. */
		provenBy: [
			"apps/web/src/design-system/components/modal.test.tsx",
			"apps/web/visual/screens.spec.ts",
		],
	},
];

export type DispositionProblem = string;

/**
 * Structural coherence of the disposition data, given the classes the census
 * found. Returns the problems; an empty array means the data is usable.
 *
 * This checks that the decisions refer to things that exist and that a decision
 * carrying an obligation meets it. It cannot check whether a decision is right —
 * that is what convergence is for.
 */
export function validate(
	candidates: readonly Candidate[],
	definedClasses: ReadonlySet<string>,
): DispositionProblem[] {
	const problems: DispositionProblem[] = [];
	const byId = new Map<string, Candidate>();

	for (const c of candidates) {
		if (byId.has(c.id)) problems.push(`${c.id}: listed twice — one entry per candidate`);
		byId.set(c.id, c);

		if (!c.cls && !c.component) {
			problems.push(
				`${c.id}: names neither a class nor a component, so nothing can be rendered for it`,
			);
		}
		/* A class the census does not know is a candidate that has already been
		 * renamed or deleted. Left unchecked, the inventory would publish an entry
		 * for something that no longer renders, which is the stale-evidence failure
		 * this whole publication exists to avoid.
		 *
		 * It applies only to the states that still render. `merged` and `replaced`
		 * mean the class is GONE — that is what the disposition says happened — so
		 * requiring it to still be defined would make convergence unrepresentable:
		 * the moment `.cv-btn` was folded into `.btn`, publication failed. Those
		 * two keep their `cls` as the historical name, which is what makes the
		 * inventory a record of what was retired rather than a list of what is
		 * left, and `becomes` already points at a live entry. */
		const mustStillRender = !REDIRECTING.includes(c.status);
		if (c.cls && mustStillRender && !definedClasses.has(c.cls)) {
			problems.push(`${c.id}: .${c.cls} is not defined in any stylesheet the census scanned`);
		}
		if (REDIRECTING.includes(c.status) && !c.becomes) {
			problems.push(`${c.id}: is ${c.status} but does not say what it becomes`);
		}
		if (NEEDS_REASON.includes(c.status) && !c.why) {
			problems.push(`${c.id}: is ${c.status} but does not say why — the reason is the decision`);
		}
		/* Approval is the one status that makes a claim about quality rather than
		 * about location, so it is the one that has to cite evidence. */
		if (c.status === "approved" && !c.provenBy?.length) {
			problems.push(`${c.id}: is approved but names no surface it was driven on`);
		}
		if (c.provenBy?.length && c.status !== "approved") {
			problems.push(`${c.id}: is ${c.status}, which is not a state that carries surface proof`);
		}
		if (c.becomes && !REDIRECTING.includes(c.status)) {
			problems.push(`${c.id}: is ${c.status} and so cannot become ${c.becomes}`);
		}
	}

	for (const c of candidates) {
		if (!c.becomes) continue;
		const target = byId.get(c.becomes);
		if (!target) {
			problems.push(`${c.id}: becomes ${c.becomes}, which is not a candidate`);
			continue;
		}
		if (target.id === c.id) problems.push(`${c.id}: becomes itself`);
		/* No chains. If A merges into B and B is replaced by C, then A's recorded
		 * destination renders nothing and the reader has to walk the graph to find
		 * out. Repoint A at C instead, so every destination is a real one. */
		if (REDIRECTING.includes(target.status)) {
			problems.push(
				`${c.id}: becomes ${target.id}, which is itself ${target.status} — point it at the surviving entry`,
			);
		}
	}

	return problems;
}

/** Candidates sharing a group, which is what makes two spellings comparable. */
export function relatedTo(candidate: Candidate, candidates: readonly Candidate[]): Candidate[] {
	return candidates.filter((c) => c.group === candidate.group && c.id !== candidate.id);
}
