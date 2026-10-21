/* The screens the visual suite covers, and the widths it covers them at.
 *
 * Every screen the app shell routes to is here: an uncovered screen is one no
 * baseline protects. Widths are the breakpoints the project designs against —
 * the regressions this catches have been a desktop-only token override and
 * mobile-only chrome, so both sides of 1024 have to be captured.
 */
export interface Screen {
	/** Baseline filenames are built from this, so it must stay stable. */
	name: string;
	path: string;
	/** A selector that only exists once the screen has its data. */
	ready: string;
	/** A screen a route alone does not reach. The setup form is behind a type
	 *  choice on `/create`, so without this the suite covers the picker and the
	 *  editor and nothing in between — which is most of what `/create` is.
	 *
	 *  Navigation only — choosing a destination, opening a panel, selecting a
	 *  subject. A step that submits, types, drags or asserts is a behaviour test
	 *  wearing a screenshot and does not belong here.
	 *
	 *  The rule used to be "one click", which read as a limit on how FAR a screen
	 *  could be from its route. It is not: the editor has one route and nine
	 *  rails, and the data-callout controls sit behind a rail and then a row
	 *  inside it. Refusing the second click never kept a behaviour test out — it
	 *  just left the surface uncovered, which is the condition this list exists
	 *  to end. So the rule is about kind, and the count follows from the app. */
	click?: string | readonly string[];
	/** The widths this screen is captured at. Defaults to all of `WIDTHS`.
	 *
	 *  Only for a screen that does not EXIST at a width — not for one that is
	 *  merely awkward there, which is exactly what these baselines are for. Three
	 *  editor screens qualify, and the reason differs by one: the chat and audit
	 *  panels are the DEFAULT rail, so on a phone they sit in a closed sheet that
	 *  no navigation here opens, while the docked clip inspector is not narrowed
	 *  at all below 1440 — it is replaced by `TimelineClipInspectorSheet`.
	 *
	 *  A rail the navigation clicks is a different matter: clicking a rail button
	 *  opens the panel, so `editor-data-style` captures at all four widths. The
	 *  restriction is measured per screen rather than applied to the editor as a
	 *  class, because "the editor is desktop-only" is not true and would have
	 *  dropped four working captures.
	 *
	 *  The phone composition of the editor is not left uncovered by this: it has
	 *  its own project, `mobile-editor.spec.ts`, because the thing under test
	 *  there is a coarse pointer and not a narrow window. What IS still uncovered
	 *  is these two panels inside it — see tasks.md 4.4. */
	widths?: readonly number[];
	/** Which recorded fixture this screen replays. Defaults to `api.har`.
	 *
	 *  `api.har` is a project with two text clips, no scenes and no chat — small
	 *  on purpose, see `FIXTURE_PROJECT_ID`. The screens that need a story chat,
	 *  an audit trace or an infographic clip name the second fixture instead,
	 *  rather than every timeline capture paying for data it does not show. */
	har?: string;
}

/** The project the editor baseline is taken from.
 *
 * Chosen for a small history, not at random: `/api/operations/projects/:id`
 * returns every storyboard version and every event with no bound, so a
 * long-lived project's detail response is megabytes. The first project tried
 * carried 3,135 versions and 3,142 events — a 5.7 MB fixture. This one has 3
 * versions and 2 clips, and still exercises a populated timeline. */
export const FIXTURE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

/** The project the editor's chat, audit and data surfaces are taken from.
 *
 * A second fixture rather than a bigger first one. The project above is small
 * because a long-lived one produced a 5.7 MB response, and that trade is still
 * right for the sixteen screens that only need a populated timeline. This one
 * carries three scenes, an infographic clip, a chat log and a completed audit
 * session, and only the screens below replay it. Authored, not recorded — see
 * `fixtures/editor-chat-data.ts`. */
export const EDITOR_CHAT_FIXTURE_PROJECT_ID = "00000000-0000-4000-8000-000000000003";
const EDITOR_CHAT_HAR = "fixtures/api-editor-chat.har";
const EDITOR_CHAT_PATH = `/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`;

/** The widths at which the editor's rail panel is a column beside the stage.
 *
 *  `usePhoneLayout` switches at 860px, so 320 and 768 are the sheet composition:
 *  the rail is a bottom bar and the panel starts closed. A screen whose
 *  navigation clicks a rail button opens it on the way and needs no restriction;
 *  these two start on the default rail and never open it. */
const COLUMN_WIDTHS = [1024, 1440] as const;

export const SCREENS: Screen[] = [
	{ name: "content-list", path: "/content", ready: ".content-row" },
	{ name: "create-picker", path: "/create", ready: ".cv-type-grid" },
	// The form `/create` actually collects on — title, description, format, preset.
	// It is a separate screen from the picker and from the editor, and until the
	// split it shares a component with both, so this is the only "before" it has.
	{ name: "create-setup", path: "/create", ready: ".cv-setup", click: ".cv-typecard" },
	{ name: "library-references", path: "/library/references", ready: "main" },
	{ name: "library-voices", path: "/library/voices", ready: "main" },
	{ name: "library-presets", path: "/library/presets", ready: "main" },
	/* The other half of the library. These three were the uncovered ones, which is
	 * why their two layout defects — a catalogue body pinned to an editor panel's
	 * 420px column, and a scope strip that clips its last scopes on a phone —
	 * survived: no baseline was watching them at any width. Added before the
	 * surfaces are rewritten, so the rewrite has a before to be diffed against. */
	{ name: "library-materials", path: "/library/materials", ready: "main" },
	{ name: "library-templates", path: "/library/templates", ready: "main" },
	{ name: "library-elements", path: "/library/elements", ready: "main" },
	{ name: "video", path: "/video", ready: "main" },
	{ name: "image-lab", path: "/imagelab", ready: "main" },
	{ name: "speech-lab", path: "/speech/lab", ready: "[data-slot='prompt-composer']" },
	/* Settings is four levels deep and EVERY one of them is a route, so every one
	 * is photographable without a synthetic click.
	 *
	 * The screen this replaces needed `click:` because the Env tab was
	 * client-side state — and it went uncovered until a styling change landed on
	 * its input while 297 green snapshots said nothing, because none of them
	 * rendered it. A four-level tree in component state would have made that
	 * worse; `ready` on a region rather than on `main` is still what keeps a
	 * still-loading pane from being photographed as the baseline. */
	{ name: "settings-root", path: "/settings", ready: ".settings-col-caps .settings-rows" },
	{ name: "settings-usage", path: "/settings/usage", ready: ".credits-page" },
	{ name: "settings-usage-activity", path: "/settings/usage/activity", ready: ".credits-page" },
	{
		name: "settings-capabilities",
		path: "/settings/capabilities",
		ready: ".settings-col-caps .settings-rows",
	},
	{
		name: "settings-capability",
		path: "/settings/capabilities/tts",
		ready: ".settings-provider-list",
	},
	{
		name: "settings-provider",
		path: "/settings/capabilities/tts/kokoro",
		ready: ".settings-setup",
	},
	{
		name: "settings-stock-visuals",
		path: "/settings/capabilities/stock-visuals/pexels",
		ready: ".settings-setup",
	},
	{
		name: "settings-sound-effects",
		path: "/settings/capabilities/sound-effects/freesound",
		ready: ".settings-setup",
	},
	{
		name: "settings-security",
		path: "/settings/security",
		ready: ".settings-col-caps .settings-rows",
	},
	{
		name: "settings-security-topic",
		path: "/settings/security/master-key",
		ready: ".settings-security",
	},
	{ name: "god-general", path: "/god/general", ready: ".god-overview" },
	{ name: "god-pipelines", path: "/god/pipelines", ready: ".template-columns" },
	{ name: "god-users", path: "/god/users", ready: ".god-rows .god-row" },
	{ name: "god-user-detail", path: "/god/users/user-2", ready: ".god-detail-body" },
	{ name: "god-workspaces", path: "/god/workspaces", ready: ".god-rows .god-row" },
	{ name: "god-workspace-detail", path: "/god/workspaces/alpha", ready: ".god-detail-body" },
	{ name: "god-projects", path: "/god/projects", ready: ".god-rows .god-row" },
	{ name: "god-project-detail", path: "/god/projects/project-1", ready: ".god-detail .god-fields" },
	{
		name: "god-authentication",
		path: "/god/authentication",
		ready: ".god-action-section [role=combobox]",
	},
	{ name: "god-audit", path: "/god/audit", ready: ".god-audit-list > div" },
	/* Ready on the renderer stage, not on `.tl2-timeline`. A screen whose subject
	 * is a video preview must not be declared ready by its timeline: the preview
	 * went missing entirely and this screen kept screenshotting, because nothing
	 * in the suite named the region. Waiting here means a collapsed or absent
	 * preview times out instead of being captured as a baseline. */
	{ name: "editor-timeline", path: `/content/${FIXTURE_PROJECT_ID}`, ready: ".tl2-remotion-stage" },
	{
		name: "editor-storyboard",
		path: `/content/${FIXTURE_PROJECT_ID}/storyboard`,
		ready: ".sb-author-view",
	},

	/* The editor's chat surfaces, on the second fixture.
	 *
	 * These were the uncovered ones, and they were uncovered for a reason that was
	 * never tooling: the replayed project has no scenes, no chat log and no audit
	 * trace, so probing the running app for their markers returned 0, 0 and 1.
	 * `audit-panel.tsx`, `chat-run-cards.tsx` and the infographic controls carried
	 * 107 inline style objects between them with no baseline able to say whether
	 * moving one moved a pixel. Added before those files are rewritten, so the
	 * rewrite has a before to be diffed against.
	 *
	 * Each names the marker it exists for, because a screenshot of a surface that
	 * renders nothing stays green when the surface breaks — which is the reason
	 * the Studio below went uncaptured rather than captured empty. */

	/* The thinking trail is collapsed on a settled run, and `settleChat` settles
	 * every persisted note on load, so "view thinking" is the only way the card
	 * is ever on screen. Ready on the note body rather than on `.fc-chat`: the
	 * chat shell renders whether or not anything is in it. */
	{
		name: "editor-chat",
		path: EDITOR_CHAT_PATH,
		har: EDITOR_CHAT_HAR,
		widths: COLUMN_WIDTHS,
		click: ".fc-run-think-h",
		ready: ".fc-note-body",
	},
	/* The audit panel replaces the chat in the same column, behind the header's
	 * audit button. Ready on a change card, not on the panel: the panel renders
	 * its error state too, and that is exactly the capture to avoid — the trace
	 * endpoint was absent from the first fixture, so this surface has only ever
	 * shown "failed to load audit" under replay. */
	{
		name: "editor-audit",
		path: EDITOR_CHAT_PATH,
		har: EDITOR_CHAT_HAR,
		widths: COLUMN_WIDTHS,
		click: '[title="Changes + assets audit"]',
		ready: ".fc-sbtable-h",
	},
	/* `SceneStudio` returns null with no scenes, which is why this screen could
	 * not exist until a fixture had some — its own absence was recorded here as a
	 * comment for exactly that reason. Studio is the one editor mode with no
	 * route, so the mode tab is how it is reached. */
	{
		name: "editor-studio",
		path: EDITOR_CHAT_PATH,
		har: EDITOR_CHAT_HAR,
		click: '.cv-modeseg button[title="Studio editor"]',
		ready: ".cv-studio",
	},
	/* Selecting the infographic clip puts the docked inspector on its data tab,
	 * which is the only place `InfographicFields` renders in the editor. Ready on
	 * a field inside the accordion, not on the accordion: the inspector renders a
	 * section for every clip kind and only this one renders the data fields. */
	{
		name: "editor-clip-data",
		path: EDITOR_CHAT_PATH,
		har: EDITOR_CHAT_HAR,
		widths: [1440],
		click: '[data-clipid="infographic:1"]',
		ready: ".tl2-acc .field",
	},
	/* Two steps, and the reason the type takes a list: the callout style controls
	 * sit in a collapsed section of the Style rail, so the rail is one navigation and
	 * the section toggle is another. Neither asserts anything.
	 *
	 * a data-style property row is 0 with the section collapsed and 4 with it open —
	 * measured, not assumed — so it cannot go green on the row list alone. */
	{
		name: "editor-data-style",
		path: EDITOR_CHAT_PATH,
		har: EDITOR_CHAT_HAR,
		click: [
			'.tl2-railbtn[aria-label^="Style"]',
			'.fc-style-panel button.ui-insp-toggle:has-text("Data callout")',
		],
		ready: '.fc-data-style [data-slot="property-row"]',
	},

	/* The infographic type previews, on the first fixture — they need no project
	 * data, only the catalogue.
	 *
	 * A group filter rather than the unfiltered `library-elements` above, and the
	 * difference is not cosmetic: the tiles mount on intersection, so on the full
	 * page the data group renders only if the capture's scroll happens to reach
	 * it before the shot. Filtering puts the twelve tiles at the top of a short
	 * page, where they mount without racing anything. The catalogue's previews
	 * are also the frozen ones — `still={STILL_FRAME}` — while the editor's
	 * Elements rail autoplays the same component, which no screenshot can pin. */
	{
		name: "library-elements-data",
		path: "/library/elements",
		click: '.catalog-groups button:text-is("Data")',
		ready: ".fc-data-preview:not(.fc-text-preview)",
	},
];

export const WIDTHS = [320, 768, 1024, 1440] as const;
