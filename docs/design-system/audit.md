# UI system audit

**Audit first; implementation unchanged.** Snapshot 2026-10-01 at `9c21b786cb852e445f782ece9d288f55f726f967`. The current Base UI/shadcn/Maleo token foundation is worth retaining. Actual compositions still diverge, so the next work should standardize reviewed usages and states before redesigning or publishing an approved UI library.

Read [principles.md](principles.md) for the target architecture, [foundations.md](foundations.md) for the target visual grammar and current token/style evidence, [patterns.md](patterns.md) for composition families, and [components.md](components.md) for every inventoried definition and consumer. Lifecycle/proof belongs to OpenSpec audit-ui-system (private historical record); these docs are the audit/reference map, not a second task tracker.

## Migration backlog

**P0 — systemic inconsistency; P1 — frequently visible; P2 — reusable improvement; P3 — cleanup.** Priority describes migration order using those meanings, not incident severity. UI implementation remains untouched.

Usage counts refer to scoped source occurrences in the audited snapshot, not rendered instances, people or screen visits. Loops render many instances. Counts can overlap; do not sum rows. Inspector/header scopes are candidates for semantic review, not proof every site is defective. Exact sites, dependencies and acceptance criteria are in migration-backlog.json (private historical record). OpenSpec tasks section 4 (private historical record) tracks pending migration; this table is its reviewable summary.

| UI                                                  | Usage | Problem                                                                                                                              | Action      | Target                                                                               | Priority |
| --------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------ | -------- |
| [Visual grammar · M00](#m00)                        |     — | Current token vocabulary lacks explicit semantic roles and permits too many local visual choices.                                    | STANDARDIZE | Maleo semantic foundation grammar                                                    | P0       |
| [Design-system dependency boundary · M18](#m18)     |     9 | Shared popup adapter lives in timeline; WorkspaceSwitcher composes Base UI directly. No dedicated design-system boundary exists yet. | REFACTOR    | design-system public tokens / components / patterns boundary                         | P0       |
| [Library action buttons · M01](#m01)                |    16 | 16 actions across Templates, Presets and Materials borrow sidebar navigation styling.                                                | STANDARDIZE | Button / IconButton                                                                  | P0       |
| [Inspector property rows · M02](#m02)               |    46 | Field/Control compositions vary across timeline label/value/control/hint/reset layouts.                                              | NEW_PATTERN | PropertyRow recipe over Field / Control                                              | P0       |
| [Library search · M03](#m03)                        |     6 | Input utility padding overrides leading-icon space on every Library toolbar.                                                         | STANDARDIZE | Input adornment / LibraryToolbar recipe                                              | P0       |
| [Collection search/filter composition · M04](#m04)  |     9 | Four composition families use different search/select/chip chrome; galleries have four native filter sites.                          | MERGE       | Collection search/filter recipes using Input, Select and ChipButton                  | P0       |
| [Chrome foundation usage · M15](#m15)               |     — | Literal type/radius/shadow/z-index/spacing coexist with named tokens; 3,554 raw source candidates include intentional values.        | STANDARDIZE | Verified semantic typography, spacing, radius, elevation, focus and stacking recipes | P0       |
| [Panel headers · M05](#m05)                         |    16 | 16 title/action/close declarations repeat tl2-panel-h JSX across rails, drawers and sheets.                                          | MERGE       | PanelHeader recipe                                                                   | P1       |
| [Unnamed image icon actions · M06](#m06)            |     2 | Send and reference-picker close bypass shared named action contract.                                                                 | STANDARDIZE | IconButton                                                                           | P1       |
| [Empty/loading/error presentation · M07](#m07)      |    15 | Existing EmptyState is reused, but Templates shows empty during loading and alongside error.                                         | STANDARDIZE | EmptyState + Callout / retry recipe                                                  | P1       |
| [Usage section navigation · M08](#m08)              |     1 | One implementation overflows four addressed sections at 320px.                                                                       | REFACTOR    | Responsive route navigation + contained data table                                   | P1       |
| [Script density toolbar · M09](#m09)                |     1 | Outline, Read and Write widen 320px document to 388px.                                                                               | REFACTOR    | Responsive script action/density recipe                                              | P1       |
| [Editor mode tabs · M10](#m10)                      |     1 | Four local tabs are all tab stops; ArrowRight does not move focus; no panel links.                                                   | REFACTOR    | TabsRoot / TabsList / TabsTab / TabsPanel, or route navigation where addressed       | P1       |
| [Color popup · M11](#m11)                           |    10 | Shared color control owns geometry and misses outside/Escape dismissal.                                                              | REFACTOR    | AlphaColorControl + canonical anchored popup lifecycle                               | P1       |
| [Create description field · M12](#m12)              |     1 | Visible Description micro-label lacks explicit control association.                                                                  | STANDARDIZE | Field + Textarea label association                                                   | P1       |
| [Media preview action chrome · M13](#m13)           |    17 | Shared frame/lightbox controls retain local literal chrome and manual enlargement actions.                                           | STANDARDIZE | Frame / Lightbox + IconButton + semantic tokens                                      | P2       |
| [Composer submission semantics · M14](#m14)         |     2 | Lab Enter handlers lack composition guard present in editor chat; IME concern is source-only.                                        | REFACTOR    | Composer submit/newline/IME recipe                                                   | P2       |
| [Agent-facing visual/pattern catalogue · M17](#m17) |   347 | Current map needs reviewed pattern/state recipes and canonical discovery rules before approved publication.                          | NEW_PATTERN | Usage/state catalogue and agent authoring protocol                                   | P2       |
| [Unreferenced legacy definitions · M16](#m16)       |     8 | Eight definitions have no resolved production reference in audited UI modules.                                                       | REMOVE      | Remove after public/export/consumer check                                            | P3       |

M00 and M18 are prerequisite gates for every downstream migration. Their target grammar and architecture are documented; token implementation and folder moves remain pending. M18 counts import modules, not defective controls.

## Native controls and raw styling

The expanded source scan records **466 direct native button/input/select/textarea sites**. **22 known wrapper-adoption candidates** comprise 16 catalog actions, two unnamed image actions and four gallery input/select controls. The remaining 444 are provisionally retained native/domain implementations, including canonical wrappers; this is not an accessibility approval. A complex timeline/selection/media control is not equivalent to a plain action button. Review the native record's reason and target before replacement. All sites and determinations: native-controls.json (private historical record).

The raw-value scan records **3,554 candidates**: 36 arbitrary utilities, 481 color occurrences, and 3,037 type/radius/shadow/stacking/spacing declarations or object properties. CSS comments and test/build files are excluded. Token declarations, token-backed values, VUI geometry and user media styles intentionally remain in the evidence; these are not 3,554 defects. Values such as segment `tw:px-[11px]`/`tw:py-[5px]`, label typography and literal z-index/shadows must be classified by semantic chrome role before migration. Full file/line/property/value evidence: raw-visual-values.json (private historical record).

## Component records and inspection coverage

Every named target pattern now has an [intent specification](patterns.md#pattern-intent-specifications) with semantic rules, use/avoid cases, structure, allowed composition, examples and acceptance evidence. These contracts guide future migration; examples are not current APIs and no visual approval is inferred.

Design-system controls and Maleo compositions have distinct contracts in [principles.md](principles.md#component-versus-pattern). This audit’s source “component” records include both. Agents may compose approved controls within pattern extension points; alternative PropertyRow/Toolbar/state layouts require semantic review, not local styling invention.

Every one of the 347 entries in [components.md](components.md) and inventory.json (private historical record) records component, file, category, primitive evidence, usages, variants, styling, similar implementations, problems, recommended canonical target and exact action. The recommendation distinguishes matching shared chrome from domain behavior; KEEP stays provisional where no individual defect was verified.

Inspection covers component modules and pages/routing plus dialogs, anchored popovers, menu/clip actions, toolbar families, inspectors, timeline, chat/run cards and empty/loading/error states. This checkout organizes features under domain component folders; there is no separate features directory. Actual screen/form/popup captures and state/keyboard probes remain linked below. No claim is made that every native control, offscreen component or variant received an isolated browser certification.

## Migration scopes and acceptance

These are concrete pending scopes, not instructions to apply fixes during this audit. Capture/semantic acceptance criteria constrain future implementation; new patterns are recipes first and components only where a matching reusable contract is proven.

### M00

**Visual grammar → Maleo semantic foundation grammar.** One small semantic vocabulary defines space, surfaces, text, borders, type, shape, density, focus and motion. Reuse existing owners and verify theme/state mappings before applying them to components.

**Scope:** No JSX usage count; related findings [F10](#f10), [F11](#f11); OpenSpec task **4.1**. No backlog dependency.

**Done when:** Establish six spacing roles and semantic surfaces/text/borders; resolve missing roles, light/dark values, compatibility mapping and shadcn bridge. Verify contrast, inverted foregrounds, hover/selected/focus/disabled/busy/error specimens, and real Library/inspector/timeline at desktop, 320px and coarse pointer. Record geometry/media exceptions and approval evidence; do not publish candidates as approved kit.

### M18

**Design-system dependency boundary → design-system public tokens / components / patterns boundary.** Features own domain data/IO and use public patterns/components. Components combine primitives with tokens; patterns depend downward without feature imports. Existing VUI modal lifecycle stays authoritative.

**Scope:** 9 direct Base UI importing modules; seven wrappers and two convergence candidates; related findings [F11](#f11), [F12](#f12); OpenSpec task **4.2**. Depends on M00.

**Done when:** Establish target apps/web/src/design-system boundary through bounded moves of existing implementations, one token owner/import path and preserved cascade. Shared popup contract serves current consumers and WorkspaceSwitcher; enforce import direction and reviewed exceptions. Keep native controls where appropriate, preserve VUI dialog/sheet/lightbox ownership, verify actual nested popup/overlay and Library/editor flows; remove compatibility exports after last callers move. Classify primitive components versus semantic patterns; keep feature IO outside patterns and permit component composition only within pattern contracts.

### M01

**Library action buttons → Button / IconButton.** Page/form actions invoke commands; sidebar items navigate. Reuse existing command wrappers and preserve save/cancel/copy/delete meanings. Nine supported Button variants are not nine defects.

**Scope:** 16 JSX source occurrences; related findings [F08](#f08); OpenSpec task **4.3**. Depends on M00, M18.

**Done when:** No sb-item usage remains in these 16 action sites; named actions, disabled/busy feedback and existing create/edit/copy/delete flows work at 320/1440px.

### M02

**Inspector property rows → PropertyRow recipe over Field / Control.** One editable property has a name, current value, input and optional hint/reset/error. Numeric/range, color and complex media editing can use distinct recipes. Agree that semantic contract before creating a component; 46 candidate invocations are not 46 proven defects.

**Scope:** 46 JSX source occurrences; related findings [F13](#f13); OpenSpec task **4.4**. Depends on M00, M18.

**Done when:** Classify each candidate invocation by semantics; review label association, spacing, hint/error/reset and dense keyboard editing. Migrate only matching rows; confirm inspector/data/motion/phone flows. Match the PropertyRow intent spec, including inspector-only scope, allowed controls, shared label/control layout and hover/focus/touch reset discovery.

### M03

**Library search → Input adornment / LibraryToolbar recipe.** A labelled search field owns icon space, clear action and focus restoration; group taxonomy remains outside the input.

**Scope:** 6 JSX source occurrences; related findings [F01](#f01); OpenSpec task **4.5**. Depends on M00, M18.

**Done when:** Text and icon never overlap at 320/1440px on all six Library routes; clear and Escape preserve field focus.

### M04

**Collection search/filter composition → Collection search/filter recipes using Input, Select and ChipButton.** A collection query combines text, optional scope/taxonomy and result feedback. Preserve domain data and filtering; share matching chrome/recipes without a universal Toolbar component.

**Scope:** 9 JSX source occurrences; related findings [F12](#f12); OpenSpec task **4.6**. Depends on M00, M18, M03.

**Done when:** Document variants and mobile reflow; migrate four gallery controls and matching repeated chrome; verify filter/reset/no-results/focus across Content, six libraries, Images and Speech. Apply Toolbar/ToolbarGroup/ToolbarAction intent contracts where composition matches; retain collection-query domain semantics.

### M15

**Chrome foundation usage → Verified semantic typography, spacing, radius, elevation, focus and stacking recipes.** Review semantic chrome roles first. Editable media styles, canvas/timeline geometry, canonical palette declarations and dependency styles are not automatic violations.

**Scope:** 0 Not a JSX-use count; raw evidence below; related findings [F10](#f10); OpenSpec task **4.7**. Depends on M00, M18.

**Done when:** Classify candidates by token definition, chrome, geometry and media data; review dense/editor/Library screens before value changes; record deliberate exceptions and compare light/dark/mobile captures.

### M05

**Panel headers → PanelHeader recipe.** A panel header identifies its region and may offer actions/back/close. Separate it from page titles and section labels; preserve complex subject/sheet headers as explicit variants or local exceptions.

**Scope:** 16 JSX source occurrences; related findings [F18](#f18); OpenSpec task **4.8**. Depends on M00, M18.

**Done when:** Review all 16 declarations; migrate semantically equivalent title/actions/close structures, retain documented exceptions, and verify named close, focus return and mobile sheet headings. Apply the PanelHeader intent contract; page headers remain separate.

### M06

**Unnamed image icon actions → IconButton.** Icon actions require a stable accessible name and busy/disabled meaning. Existing IconButton has four named size options; this is not proof of five incompatible rendered sizes.

**Scope:** 2 JSX source occurrences; related findings [F04](#f04); OpenSpec task **4.9**. Depends on M00, M18.

**Done when:** Send and close have explicit accessible names; prompt has persistent label; verify disabled/busy state and keyboard popup close with no lost input.

### M07

**Empty/loading/error presentation → EmptyState + Callout / retry recipe.** No records, no matches, a pending read, and failed read are different outcomes. Reuse existing controls; do not introduce another EmptyState.

**Scope:** 15 JSX source occurrences; related findings [F07](#f07); OpenSpec task **4.10**. Depends on M00, M18.

**Done when:** Forced delay/500/retry never announce empty success; loading, empty, filtered-empty, error and populated states remain distinct. Check all 15 existing EmptyState sites for matching semantics. Apply the distinct EmptyState, ErrorState and LoadingState intent specifications, including recovery and data retention.

### M08

**Usage section navigation → Responsive route navigation + contained data table.** Balance/Activity/Transactions/Policy are addressed destinations, not unnamed local panels. Navigation and wide data-table containment are independent responsibilities.

**Scope:** 1 JSX source occurrences; related findings [F02](#f02); OpenSpec task **4.11**. Depends on M00, M18.

**Done when:** All four destinations keep document width <= viewport at 320px; Back/deep links and keyboard access work; wide tables scroll within their intended container.

### M09

**Script density toolbar → Responsive script action/density recipe.** Density changes how script is presented; export/import are commands. Preserve addressable density, prose hierarchy and editing while reflowing action chrome.

**Scope:** 1 JSX source occurrences; related findings [F17](#f17); OpenSpec task **4.12**. Depends on M00, M18.

**Done when:** All three densities fit 320px and desktop; density URLs/Back and export/import remain reachable with pointer and keyboard.

### M10

**Editor mode tabs → TabsRoot / TabsList / TabsTab / TabsPanel, or route navigation where addressed.** Tab semantics apply to associated local panels; addressed script/storyboard navigation must keep destination semantics.

**Scope:** 1 JSX source occurrences; related findings [F05](#f05); OpenSpec task **4.13**. Depends on M00, M18.

**Done when:** Local tabs implement roving focus, arrows/Home/End and panel association; verify addressed destinations and phone modes independently.

### M11

**Color popup → AlphaColorControl + canonical anchored popup lifecycle.** Editable color/alpha is media content; anchored popup focus/dismissal/collision handling is UI lifecycle. Keep react-colorful and the existing modal/Sheet owner.

**Scope:** 10 JSX source occurrences; related findings [F06](#f06); OpenSpec task **4.14**. Depends on M00, M18.

**Done when:** Outside/Escape dismiss only the color popup and restore focus; verify nested rail/sheet cases, viewport placement, alpha editing and shared stylesheet ownership at 320/1440px.

### M12

**Create description field → Field + Textarea label association.** A labelled editable description needs a programmatic name independent of placeholder.

**Scope:** 1 JSX source occurrences; related findings [F03](#f03); OpenSpec task **4.15**. Depends on M00, M18.

**Done when:** Accessible name is Description via label/ID association; keyboard focus, description persistence and disabled/busy behavior remain intact.

### M13

**Media preview action chrome → Frame / Lightbox + IconButton + semantic tokens.** Preview geometry, crop/aspect and content colors remain data. Only chrome/action naming and lifecycle conformance should converge.

**Scope:** 17 JSX source occurrences; related findings [F09](#f09); OpenSpec task **4.16**. Depends on M00, M18.

**Done when:** Preserve geometry/aspect/media playback; standardize close/enlarge names, focus and chrome colors in light/dark and nested overlays; do not replace VUI modal lifecycle. Preserve MediaCard/MediaGrid/AssetPicker semantic boundaries where these patterns apply; media frame chrome alone does not imply a whole-card pattern migration.

### M14

**Composer submission semantics → Composer submit/newline/IME recipe.** Submit gestures must distinguish Enter, Shift+Enter and an active IME composition. Different generation payloads remain separate.

**Scope:** 2 JSX source occurrences; related findings [F15](#f15); OpenSpec task **4.17**. Depends on M00, M18.

**Done when:** A meaningful composition-event/browser check proves composition Enter does not submit; Enter/Shift+Enter and busy/disabled behavior remain correct in image, speech and chat composers. Apply PromptComposer intent rules for IME/newline/submission, labels, draft retention and feature-owned authority.

### M17

**Agent-facing visual/pattern catalogue → Usage/state catalogue and agent authoring protocol.** Catalogue should explain purpose, when to use, variants, actual composition, states and evidence. Inventory membership never implies kit approval. A tool or new React component is not implied.

**Scope:** 347 Inventoried component definitions; related findings [F11](#f11); OpenSpec task **4.18**. Depends on M00, M18, M01, M02, M03, M04, M05.

**Done when:** Reviewed recipes cover foundations, controls and actual usages/states; candidates and approved entries are distinct, and source/route/evidence links stay traceable. Choose explorer/MCP only after requirements are agreed. Every approved pattern documents purpose, usages, slots, permitted component composition, variants/density, responsive and accessibility/state rules, owner and evidence. Agent protocol reuses matching patterns and requires review of variants or NEW_PATTERN before an alternative implementation. Use the 21 linked intent specifications as candidate contract inputs; review real consumers and validate eventual examples against actual exports/types before approving the catalogue.

### M16

**Unreferenced legacy definitions → Remove after public/export/consumer check.** Obsolete internal implementation can disappear. Public VUI exports and same-name live components require different treatment.

**Scope:** 8 Component definitions; related findings [F14](#f14); OpenSpec task **4.19**. Depends on M00, M18.

**Done when:** Confirm external/export consumers, remove only these definitions and obsolete imports/tests, and keep timeline audio Waveform and SegmentStoryboardReel alive.

## Scope and method

- Scanned **549 non-test modules**: 475 web and 74 VUI. Inventoried **347 component definitions** plus three JSX-bearing glyph object catalogues. Source-level scan includes actual consumers, calls/component-valued expressions, composition edges, typed variants, primitive imports, raw utility constants, inline style attributes, native controls, ARIA/state signals and duplicate candidates.
- Reviewed app routing, all six Project Library destinations, galleries/labs, create flow, editor modes/rails, script densities, provider/security/Usage, God Mode, workspace administration, personal account, auth and invites. Public VUI APIs are included; backend-only code and other deployables are not UI surfaces.
- Captured actual browser renders using repository Bun/Playwright, existing authored/recorded HAR fixtures and explicitly mocked missing account/workspace/speech/auth states. API misses abort; no real generation, database mutation, secret entry or account writes.
- Captures use 320px and 1440px, with desktop-only editor panels constrained by actual composition. They are full-page route/state evidence, not new regression baselines or isolated-component approval. React mounted-name observation associates uniquely named definitions with captures; ambiguous/local/public/transient entries retain explicit coverage gaps.
- Source and browser findings are distinguished. Exact request-state/keyboard/measurement proof is in interactions.json (private historical record), route capture metadata/accessibility snapshots in browser.json (private historical record), and raw literal declarations in style-values.json (private historical record).

The initial browser pass overlapped audit capture/build activity and returned 515 passed / 19 failed. All 19 failed cases passed on isolated rerun (20 tests including warmup). A transient VUI build/CSS-resolution artifact affected exploratory captures; those were discarded and recaptured on a restarted stable server with computed app-font/stylesheets checks. Harness failures are not classified as product defects. The final serial run passed all 534 tests in 9.1 minutes; no baseline updates.

## Classification meanings

| Classification | Decision                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| KEEP           | Retain current purpose/implementation provisionally. Not an approval badge or full accessibility certification. |
| STANDARDIZE    | Same purpose; apply canonical chrome, variants, tokens and state semantics at real consumers.                   |
| REFACTOR       | Correct ownership, composition or interaction/state contract while retaining purpose.                           |
| MERGE          | Collapse verified repeated implementations/recipes with matching semantics.                                     |
| REMOVE         | Obsolete or unreferenced candidate; confirm public/external consumers before deletion.                          |
| NEW_PATTERN    | Recurring need lacks a reviewed composition contract; define recipe before building.                            |

## Detailed findings

Priorities follow the requested definitions below; actions recommend migration and do not authorize UI edits during this audit.

| ID          | Priority | Action      | Finding                                                             |
| ----------- | -------- | ----------- | ------------------------------------------------------------------- |
| [F01](#f01) | P0       | STANDARDIZE | Library search text overlaps its icon                               |
| [F08](#f08) | P0       | STANDARDIZE | Library page/form actions borrow sidebar button styling             |
| [F10](#f10) | P0       | STANDARDIZE | Foundation roles coexist with local value scales                    |
| [F12](#f12) | P0       | MERGE       | Gallery and Library search/filter chrome diverges                   |
| [F13](#f13) | P0       | NEW_PATTERN | Inspector property rows lack a complete shared composition contract |
| [F02](#f02) | P1       | REFACTOR    | Usage navigation overflows 320px                                    |
| [F03](#f03) | P1       | STANDARDIZE | Create description has no explicit associated label                 |
| [F04](#f04) | P1       | STANDARDIZE | Image composer send and picker-close buttons are unnamed            |
| [F05](#f05) | P1       | REFACTOR    | Editor mode tabs do not provide tab keyboard behavior               |
| [F06](#f06) | P1       | REFACTOR    | Color control owns incomplete local popover lifecycle               |
| [F07](#f07) | P1       | STANDARDIZE | Templates report empty while loading and after failure              |
| [F17](#f17) | P1       | REFACTOR    | Script density toolbar widens every phone view                      |
| [F18](#f18) | P1       | MERGE       | Panel header markup repeats in 16 places                            |
| [F09](#f09) | P2       | STANDARDIZE | Lightbox and frame action chrome retains literal styles             |
| [F11](#f11) | P2       | NEW_PATTERN | Agent guidance lacks a complete composition catalogue               |
| [F15](#f15) | P2       | REFACTOR    | Labs submit Enter without composition-event guard                   |
| [F14](#f14) | P3       | REMOVE      | Unreferenced legacy UI definitions remain                           |
| [F16](#f16) | P3       | KEEP        | Existing boundary and ratchets are useful but incomplete            |

### F01

**P0 · STANDARDIZE — Library search text overlaps its icon.** The shared toolbar uses Input standard with tw:px-3. The utility layer outranks the feature rule reserving 34px for its leading icon. Stable-server capture and computed padding show the text starts inside the icon region.

**Evidence:** [apps/web/src/components/catalog/library-toolbar.tsx](../../apps/web/src/components/catalog/library-toolbar.tsx) (`LibraryToolbar`). [library-templates-1440](screenshots/library-templates-1440.png); [library-elements-320](screenshots/library-elements-320.png)

**Target:** Give the existing search composition an explicit leading/trailing adornment contract; fix it at the shared toolbar/Input boundary, then verify all six libraries.

### F02

**P1 · REFACTOR — Usage navigation overflows 320px.** Balance, Activity, Transactions and Policy exceed the narrow viewport. The route navigation uses a segmented tablist while its actions change addressed sections; table and navigation containment need separate checks.

**Evidence:** [apps/web/src/components/settings/credits-panel.tsx](../../apps/web/src/components/settings/credits-panel.tsx) (`CreditsPanel`). [settings-usage-320](screenshots/settings-usage-320.png); [settings-usage-activity-320](screenshots/settings-usage-activity-320.png); [god-usage-transactions-320](screenshots/god-usage-transactions-320.png); [god-usage-policy-320](screenshots/god-usage-policy-320.png)

**Target:** Use responsive route navigation semantics and contain wide data tables without widening the document.

### F03

**P1 · STANDARDIZE — Create description has no explicit associated label.** Description is rendered through Field as div and ML, followed by Textarea without a label association or aria-label. A visible micro-label is not a programmatic association. Placeholder fallback does not establish the intended field label.

**Evidence:** [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx) (`Setup`). [create-setup-1440](screenshots/create-setup-1440.png)

**Target:** Use existing Field label semantics or an explicit id/htmlFor or aria-labelledby association.

### F04

**P1 · STANDARDIZE — Image composer send and picker-close buttons are unnamed.** Browser accessibility snapshot shows an unnamed disabled send button and an unnamed reference-picker close button. The textarea receives its placeholder as fallback name; it has no explicit persistent label. Ratio/reference toggles also implement a local popover vocabulary.

**Evidence:** [apps/web/src/components/image-lab/prompt-composer.tsx](../../apps/web/src/components/image-lab/prompt-composer.tsx) (`PromptComposer`). [image-lab-references-1440](screenshots/image-lab-references-1440.png); [image-lab-320](screenshots/image-lab-320.png)

**Target:** Use named IconButton actions and explicit prompt label. Standardize popover state, dismissal, focus, selection, and disabled feedback with the existing overlay boundaries.

### F05

**P1 · REFACTOR — Editor mode tabs do not provide tab keyboard behavior.** Four segment Buttons have role tab and aria-selected, but all have tabIndex 0, none link a panel with aria-controls, and ArrowRight leaves focus unchanged. Shared Base UI Tabs already exist; phone mode navigation is a separate composition.

**Evidence:** [apps/web/src/components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx) (`ModeTabs`). [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-studio-1440](screenshots/editor-studio-1440.png)

**Target:** Adopt the existing Tabs contract for genuine local tab panels; preserve addressed script/storyboard destinations as navigation where appropriate.

### F06

**P1 · REFACTOR — Color control owns incomplete local popover lifecycle.** The shared control implements fixed placement, resize and scroll listeners itself. Outside click leaves it open. Escape also leaves the popup open in the stable styled capture. Styling remains owned by timeline/stage.css.

**Evidence:** [apps/web/src/design-system/components/color-control.tsx](../../apps/web/src/design-system/components/color-control.tsx) (`AlphaColorControl`). [color-control-open-1440](screenshots/color-control-open-1440.png); [editor-data-style-1440](screenshots/editor-data-style-1440.png)

**Target:** Reuse an anchored nonmodal popup lifecycle with outside/Escape dismissal and focus restoration; move shared-control styling to its owner with reviewed captures. Retain react-colorful and editable media colors.

### F07

**P1 · STANDARDIZE — Templates report empty while loading and after failure.** The initial list request has no loading flag. A delayed response renders No video templates yet; a forced 500 renders Failed to load templates plus the same empty-state instruction, without an alert/retry contract. Write busy state does not represent the read request.

**Evidence:** [apps/web/src/components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx) (`TemplatesLibrary`). [templates-loading-320](screenshots/templates-loading-320.png); [templates-error-320](screenshots/templates-error-320.png)

**Target:** Use existing EmptyState loading support and explicit error/retry presentation. Separate loading, empty, filtered-empty, success, and error states.

### F17

**P1 · REFACTOR — Script density toolbar widens every phone view.** All three addressed script densities produce document scrollWidth 388px at a 320px viewport. The density/export/import strip clips horizontally while the script prose remains narrow. This is a distinct toolbar composition defect beyond Button styling.

**Evidence:** [apps/web/src/components/script/script-view.tsx](../../apps/web/src/components/script/script-view.tsx) (`ScriptView`). [script-outline-320](screenshots/script-outline-320.png); [script-read-320](screenshots/script-read-320.png); [script-write-320](screenshots/script-write-320.png)

**Target:** Reflow or deliberately contain toolbar actions at phone widths; preserve addressed density and export/import behavior.

### F08

**P0 · STANDARDIZE — Library page/form actions borrow sidebar button styling.** Templates, Presets and Materials contain 16 native command-action sites styled with sb-item. Existing Button/IconButton already cover their roles.

**Evidence:** native-controls.json (private historical record), 16 catalog command-action sites; [Templates](screenshots/library-templates-1440.png), [Preset form](screenshots/library-presets-create-1440.png), [Material form](screenshots/library-materials-create-1440.png).

**Target:** Migrate the 16 enumerated action sites to Button/IconButton while preserving save/cancel/copy/edit/delete/default behavior. Do not restyle sidebar navigation.

### F09

**P2 · STANDARDIZE — Lightbox and frame action chrome retains literal styles.** Lightbox/Frame share the correct VUI overlay mechanism but retain local literal colors, shadows, dimensions, and hand-built action chrome. Frame enlargement implements keyboard events locally. The census permits this debt; permission is not convergence.

**Evidence:** [apps/web/src/design-system/components/lightbox.tsx](../../apps/web/src/design-system/components/lightbox.tsx) (`Lightbox`). [library-references-1440](screenshots/library-references-1440.png)

**Target:** Keep the overlay owner. Standardize action controls and semantic surface tokens; preserve aspect-ratio and media sizing geometry.

### F10

**P0 · STANDARDIZE — Foundation roles coexist with local value scales.** Current sheets still contain feature-specific half-pixel typography, radius, padding, z-index and focus values beside named foundation roles. Some are content or timeline geometry and must remain data-driven; the report retains exact evidence rather than treating every literal as a defect.

**Evidence:** [apps/web/src/design-system/tokens/tokens.css](../../apps/web/src/design-system/tokens/tokens.css). [library-materials-1440](screenshots/library-materials-1440.png); [god-general-1440](screenshots/god-general-1440.png)

**Target:** Review chrome values by role and real screen density. Map repeated chrome values to existing tokens; approve explicit exceptions for media/geometry.

### F11

**P2 · NEW_PATTERN — Agent guidance lacks a complete composition catalogue.** Current authoring guide and 25-disposition registry describe the substrate and selected convergence decisions. They do not inventory every route composition or specify toolbar/header/inspector/empty/error families. No Storybook dependency is installed. Registry validation currently passes; historical IDs alone are not broken entries.

**Evidence:** [apps/web/src/app/styles.css](../../apps/web/src/app/styles.css). [content-list-1440](screenshots/content-list-1440.png); [library-presets-1440](screenshots/library-presets-1440.png)

**Target:** Use this inventory as the starting map. Define reviewed pattern recipes and usage/state criteria before selecting a visual explorer or MCP integration. Do not publish candidates as approved components.

### F12

**P0 · MERGE — Gallery and Library search/filter chrome diverges.** LibraryToolbar, ContentToolbar, image GalleryFilters and speech gallery controls answer similar collection questions with distinct input/select/chip compositions. Their taxonomies and scopes differ, so merging entire pages is not warranted.

**Evidence:** [apps/web/src/components/catalog/library-toolbar.tsx](../../apps/web/src/components/catalog/library-toolbar.tsx) (`LibraryToolbar`). [images-1440](screenshots/images-1440.png); [speech-1440](screenshots/speech-1440.png); [library-voices-1440](screenshots/library-voices-1440.png)

**Target:** Merge repeated search/adornment and filter-control chrome where semantics match. Preserve independent domain filtering and mobile reflow requirements.

### F13

**P0 · NEW_PATTERN — Inspector property rows lack a complete shared composition contract.** Panel, Section, Control and Field already cover parts of hierarchy. Label/value/control/hint/reset compositions still live across clip, caption, data, motion and settings fields with local grid and spacing helpers. A generic PropertyRow cannot safely replace every control without defining editing and state semantics.

**Evidence:** [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx) (`Control`). [editor-clip-data-1440](screenshots/editor-clip-data-1440.png); [editor-data-style-1440](screenshots/editor-data-style-1440.png)

**Target:** Define a PropertyRow recipe around existing Field/Control, with label association, value, optional reset/hint/error, numeric/range density and keyboard requirements; keep timeline geometry local.

### F14

**P3 · REMOVE — Unreferenced legacy UI definitions remain.** Resolved production references are absent for StyleKnobEditor, catalog Chip, render-chrome Field, ProjectReferencesPopover, TextProviderPanel, decorative editor Waveform, VoiceDot and ImageProviderSelect. Test-only references or unused imports can remain. This is a removal candidate, not permission to delete exported VUI APIs.

**Evidence:** `StyleKnobEditor` (`components/catalog/style-knob-editor.tsx`) had no importer and has since been deleted; the other definitions named above remain. Source/census/consumer evidence; no dedicated screenshot.

**Target:** Confirm no external/public contract, then remove obsolete definitions and their tests/imports in a separate implementation change. Do not remove timeline/audio Waveform or SegmentStoryboardReel; both have real uses.

### F15

**P2 · REFACTOR — Labs submit Enter without composition-event guard.** Image and speech lab Enter handlers do not check isComposing, whereas editor chat guards composition. Source proves an inconsistent submit contract; no real IME end-to-end reproduction was performed.

**Evidence:** [apps/web/src/components/image-lab/prompt-composer.tsx](../../apps/web/src/components/image-lab/prompt-composer.tsx) (`PromptComposer`). [image-lab-1440](screenshots/image-lab-1440.png); [speech-lab-1440](screenshots/speech-lab-1440.png)

**Target:** Standardize the submit gesture contract across composers, preserving Shift+Enter and IME composition; test with an appropriate composition sequence before calling this a reproduced bug.

### F16

**P3 · KEEP — Existing boundary and ratchets are useful but incomplete.** Layers and disposition validation pass. Standing census debt includes cross-cluster classes, static no-caller classes, inline objects and color literals. A passing gate constrains growth; it does not certify pattern consistency or all transient states.

**Evidence:** [apps/web/src/app/styles.css](../../apps/web/src/app/styles.css). Source/census/consumer evidence; no dedicated screenshot.

**Target:** Retain current layer/census/control-name/browser gates. Add focused recipe/state coverage only after agreeing pattern contracts; do not drive heuristic counts to zero.

### F18

**P1 · MERGE — Panel header markup repeats in 16 places.** AST scan finds 16 tl2-panel-h declarations. Templates and Style both repeat title plus named IconButton close; other declarations include context/action variants needing semantic review. Shared CSS alone does not prevent duplicate markup/state handling.

**Evidence:** panel-headers.json (private historical record) lists all 16 exact declarations. [Templates header](../../apps/web/src/components/timeline/timeline-template-panel.tsx) and [Style header](../../apps/web/src/components/editor/editor-settings.tsx) demonstrate the matching title/close structure.

**Target:** Review title/actions/back/close semantics, define a PanelHeader recipe, merge equivalent declarations and document purposeful exceptions. Preserve PageHeader/LibraryHeader as different hierarchy.

## Real-screen coverage

125 successful route/state captures across 64 named views. Additional targeted popup/loading/error images accompany the relevant findings. Capture state descriptions and accessibility trees are in browser.json. A screenshot of an empty mocked gallery proves that state, not populated media playback.

| Screen/state             | Path                                                                   | 320px                                                   | 1440px                                                   | Narrow overflow |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- | --------------- |
| content-list             | `/content`                                                             | [capture](screenshots/content-list-320.png)             | [capture](screenshots/content-list-1440.png)             | None detected   |
| create-picker            | `/create`                                                              | [capture](screenshots/create-picker-320.png)            | [capture](screenshots/create-picker-1440.png)            | None detected   |
| create-setup             | `/create`                                                              | [capture](screenshots/create-setup-320.png)             | [capture](screenshots/create-setup-1440.png)             | None detected   |
| library-references       | `/library/references`                                                  | [capture](screenshots/library-references-320.png)       | [capture](screenshots/library-references-1440.png)       | None detected   |
| library-voices           | `/library/voices`                                                      | [capture](screenshots/library-voices-320.png)           | [capture](screenshots/library-voices-1440.png)           | None detected   |
| library-presets          | `/library/presets`                                                     | [capture](screenshots/library-presets-320.png)          | [capture](screenshots/library-presets-1440.png)          | None detected   |
| library-materials        | `/library/materials`                                                   | [capture](screenshots/library-materials-320.png)        | [capture](screenshots/library-materials-1440.png)        | None detected   |
| library-templates        | `/library/templates`                                                   | [capture](screenshots/library-templates-320.png)        | [capture](screenshots/library-templates-1440.png)        | None detected   |
| library-elements         | `/library/elements`                                                    | [capture](screenshots/library-elements-320.png)         | [capture](screenshots/library-elements-1440.png)         | None detected   |
| video                    | `/video`                                                               | [capture](screenshots/video-320.png)                    | [capture](screenshots/video-1440.png)                    | None detected   |
| image-lab                | `/imagelab`                                                            | [capture](screenshots/image-lab-320.png)                | [capture](screenshots/image-lab-1440.png)                | None detected   |
| settings-root            | `/god/providers`                                                       | [capture](screenshots/settings-root-320.png)            | [capture](screenshots/settings-root-1440.png)            | None detected   |
| settings-usage           | `/god/usage`                                                           | [capture](screenshots/settings-usage-320.png)           | [capture](screenshots/settings-usage-1440.png)           | 370px           |
| settings-usage-activity  | `/god/usage/activity`                                                  | [capture](screenshots/settings-usage-activity-320.png)  | [capture](screenshots/settings-usage-activity-1440.png)  | 378px           |
| settings-capabilities    | `/god/providers`                                                       | [capture](screenshots/settings-capabilities-320.png)    | [capture](screenshots/settings-capabilities-1440.png)    | None detected   |
| settings-capability      | `/god/providers/tts`                                                   | [capture](screenshots/settings-capability-320.png)      | [capture](screenshots/settings-capability-1440.png)      | None detected   |
| settings-provider        | `/god/providers/tts/kokoro`                                            | [capture](screenshots/settings-provider-320.png)        | [capture](screenshots/settings-provider-1440.png)        | None detected   |
| settings-stock-visuals   | `/god/providers/stock-visuals/pexels`                                  | [capture](screenshots/settings-stock-visuals-320.png)   | [capture](screenshots/settings-stock-visuals-1440.png)   | None detected   |
| settings-sound-effects   | `/god/providers/sound-effects/freesound`                               | [capture](screenshots/settings-sound-effects-320.png)   | [capture](screenshots/settings-sound-effects-1440.png)   | None detected   |
| settings-security        | `/god/security`                                                        | [capture](screenshots/settings-security-320.png)        | [capture](screenshots/settings-security-1440.png)        | None detected   |
| settings-security-topic  | `/god/security/master-key`                                             | [capture](screenshots/settings-security-topic-320.png)  | [capture](screenshots/settings-security-topic-1440.png)  | None detected   |
| god-general              | `/god/general`                                                         | [capture](screenshots/god-general-320.png)              | [capture](screenshots/god-general-1440.png)              | None detected   |
| god-users                | `/god/users`                                                           | [capture](screenshots/god-users-320.png)                | [capture](screenshots/god-users-1440.png)                | None detected   |
| god-user-detail          | `/god/users/user-2`                                                    | [capture](screenshots/god-user-detail-320.png)          | [capture](screenshots/god-user-detail-1440.png)          | None detected   |
| god-workspaces           | `/god/workspaces`                                                      | [capture](screenshots/god-workspaces-320.png)           | [capture](screenshots/god-workspaces-1440.png)           | None detected   |
| god-workspace-detail     | `/god/workspaces/alpha`                                                | [capture](screenshots/god-workspace-detail-320.png)     | [capture](screenshots/god-workspace-detail-1440.png)     | None detected   |
| god-projects             | `/god/projects`                                                        | [capture](screenshots/god-projects-320.png)             | [capture](screenshots/god-projects-1440.png)             | None detected   |
| god-project-detail       | `/god/projects/project-1`                                              | [capture](screenshots/god-project-detail-320.png)       | [capture](screenshots/god-project-detail-1440.png)       | None detected   |
| god-authentication       | `/god/authentication`                                                  | [capture](screenshots/god-authentication-320.png)       | [capture](screenshots/god-authentication-1440.png)       | None detected   |
| god-audit                | `/god/audit`                                                           | [capture](screenshots/god-audit-320.png)                | [capture](screenshots/god-audit-1440.png)                | None detected   |
| editor-timeline          | `/content/00000000-0000-4000-8000-000000000001`                        | [capture](screenshots/editor-timeline-320.png)          | [capture](screenshots/editor-timeline-1440.png)          | None detected   |
| editor-storyboard        | `/content/00000000-0000-4000-8000-000000000001/storyboard`             | [capture](screenshots/editor-storyboard-320.png)        | [capture](screenshots/editor-storyboard-1440.png)        | None detected   |
| editor-chat              | `/content/00000000-0000-4000-8000-000000000003`                        | Not applicable / not captured                           | [capture](screenshots/editor-chat-1440.png)              | Not applicable  |
| editor-audit             | `/content/00000000-0000-4000-8000-000000000003`                        | Not applicable / not captured                           | [capture](screenshots/editor-audit-1440.png)             | Not applicable  |
| editor-studio            | `/content/00000000-0000-4000-8000-000000000003`                        | [capture](screenshots/editor-studio-320.png)            | [capture](screenshots/editor-studio-1440.png)            | None detected   |
| editor-clip-data         | `/content/00000000-0000-4000-8000-000000000003`                        | Not applicable / not captured                           | [capture](screenshots/editor-clip-data-1440.png)         | Not applicable  |
| library-elements-data    | `/library/elements`                                                    | [capture](screenshots/library-elements-data-320.png)    | [capture](screenshots/library-elements-data-1440.png)    | None detected   |
| sign-in                  | `/login`                                                               | [capture](screenshots/sign-in-320.png)                  | [capture](screenshots/sign-in-1440.png)                  | None detected   |
| first-owner              | `/login`                                                               | [capture](screenshots/first-owner-320.png)              | [capture](screenshots/first-owner-1440.png)              | None detected   |
| invitation-invalid       | `/invite/audit-token`                                                  | [capture](screenshots/invitation-invalid-320.png)       | [capture](screenshots/invitation-invalid-1440.png)       | None detected   |
| invitation-valid         | `/invite/audit-token`                                                  | [capture](screenshots/invitation-valid-320.png)         | [capture](screenshots/invitation-valid-1440.png)         | None detected   |
| images                   | `/images`                                                              | [capture](screenshots/images-320.png)                   | [capture](screenshots/images-1440.png)                   | None detected   |
| speech                   | `/speech`                                                              | [capture](screenshots/speech-320.png)                   | [capture](screenshots/speech-1440.png)                   | None detected   |
| speech-lab               | `/speech/lab`                                                          | [capture](screenshots/speech-lab-320.png)               | [capture](screenshots/speech-lab-1440.png)               | None detected   |
| workspace                | `/workspace`                                                           | [capture](screenshots/workspace-320.png)                | [capture](screenshots/workspace-1440.png)                | None detected   |
| workspace-members        | `/workspace/members`                                                   | [capture](screenshots/workspace-members-320.png)        | [capture](screenshots/workspace-members-1440.png)        | None detected   |
| workspace-danger         | `/workspace/danger`                                                    | [capture](screenshots/workspace-danger-320.png)         | [capture](screenshots/workspace-danger-1440.png)         | None detected   |
| account                  | `/account`                                                             | [capture](screenshots/account-320.png)                  | [capture](screenshots/account-1440.png)                  | None detected   |
| account-security         | `/account/security`                                                    | [capture](screenshots/account-security-320.png)         | [capture](screenshots/account-security-1440.png)         | None detected   |
| account-preferences      | `/account/preferences`                                                 | [capture](screenshots/account-preferences-320.png)      | [capture](screenshots/account-preferences-1440.png)      | None detected   |
| god-usage-transactions   | `/god/usage/transactions`                                              | [capture](screenshots/god-usage-transactions-320.png)   | [capture](screenshots/god-usage-transactions-1440.png)   | 386px           |
| god-usage-policy         | `/god/usage/policy`                                                    | [capture](screenshots/god-usage-policy-320.png)         | [capture](screenshots/god-usage-policy-1440.png)         | 370px           |
| script-outline           | `/content/00000000-0000-4000-8000-000000000003/script?density=outline` | [capture](screenshots/script-outline-320.png)           | [capture](screenshots/script-outline-1440.png)           | 388px           |
| script-read              | `/content/00000000-0000-4000-8000-000000000003/script?density=read`    | [capture](screenshots/script-read-320.png)              | [capture](screenshots/script-read-1440.png)              | 388px           |
| script-write             | `/content/00000000-0000-4000-8000-000000000003/script?density=write`   | [capture](screenshots/script-write-320.png)             | [capture](screenshots/script-write-1440.png)             | 388px           |
| editor-data-style        | `/content/00000000-0000-4000-8000-000000000003`                        | [capture](screenshots/editor-data-style-320.png)        | [capture](screenshots/editor-data-style-1440.png)        | None detected   |
| library-templates-create | `/library/templates`                                                   | [capture](screenshots/library-templates-create-320.png) | [capture](screenshots/library-templates-create-1440.png) | None detected   |
| library-presets-create   | `/library/presets`                                                     | [capture](screenshots/library-presets-create-320.png)   | [capture](screenshots/library-presets-create-1440.png)   | None detected   |
| library-materials-create | `/library/materials`                                                   | [capture](screenshots/library-materials-create-320.png) | [capture](screenshots/library-materials-create-1440.png) | None detected   |
| reference-detail         | `/library/references`                                                  | [capture](screenshots/reference-detail-320.png)         | [capture](screenshots/reference-detail-1440.png)         | None detected   |
| reference-edit           | `/library/references`                                                  | [capture](screenshots/reference-edit-320.png)           | [capture](screenshots/reference-edit-1440.png)           | None detected   |
| reference-delete         | `/library/references`                                                  | [capture](screenshots/reference-delete-320.png)         | [capture](screenshots/reference-delete-1440.png)         | None detected   |
| library-references-notes | `/library/references`                                                  | [capture](screenshots/library-references-notes-320.png) | [capture](screenshots/library-references-notes-1440.png) | None detected   |
| library-templates-dark   | `/library/templates`                                                   | [capture](screenshots/library-templates-dark-320.png)   | [capture](screenshots/library-templates-dark-1440.png)   | None detected   |

## What this audit does not prove

- Every source definition is inventoried; every variant and transient state is **not** individually captured. Open menus, all upload failures, nested overlays, all provider readiness variants, agent streaming/cancellation, stale runs, real IME input, populated speech/gallery playback and every VUI consumer theme remain bounded follow-up evidence needs. Existing browser tests cover some of these; this report does not replace them with screenshot-only claims.
- 320px viewport captures use desktop pointer unless an existing mobile test config supplies coarse pointer. Narrow width does not prove touch targets, drag/scroll gestures or mobile keyboard behavior.
- Main captures mostly use light theme. Library Templates dark view is an explicit sample, not full dark-theme certification.
- Static raw values and CSS class matching are heuristics. Dynamic classes, user media styling, canvas/timeline geometry, package APIs and contextual duplicate names need manual contract review. No-caller counts are not deletion instructions.
- Line numbers and counts belong to this source snapshot. Re-run inventories/captures after implementation; never mark a current candidate approved merely because a historical registry entry exists.
- Browser screenshots may show lazy previews only when mounted. The filtered Data catalogue intentionally brings its previews into view; full catalogue images are not proof of all offscreen previews.

## Existing infrastructure and library visualization

The repo already owns Maleo wrappers, Base UI primitives, shadcn semantic recipes, native simple selects, scoped VUI rendering/overlays, a stylesheet census, layer ratchets, named control inventories, browser fixtures and screenshot baselines. The publication registry validates cleanly: 25 candidates, 15 approved, six merged, one replaced, three retained local. This audit supplements that selected registry with the full current definition/usages map; it does not rewrite historical decisions.

No Storybook dependency is installed. No UI inventory/kit was externally published. The existing code-to-design publication scripts can reuse a reviewed disposition set; they should not imply all candidates are sanctioned. A visual catalogue should include foundations, isolated control variants, actual toolbar/header/property-row recipes, and loading/empty/error/disabled/open/focus/mobile states. Select the tool after reviewing this map and prioritizing current P1 defects.

## Proposed next sequence

Establish and verify the semantic foundation grammar (M00) → establish the public design-system dependency boundary using existing implementations (M18) → standardize matching actual component/pattern consumers in priority order → remove confirmed legacy definitions → establish a maintained visual catalogue and agent usage protocol. Use bounded implementation batches with relevant OpenSpec requirements and real route/interaction proof. Target folders are direction, not a bulk rename mandate; components and recipes must retain domain semantics and VUI lifecycle ownership. No UI implementation, dependency addition, baseline refresh, publication, commit or archive was performed by this audit.

## Validation

- Source inventory: 549 modules, 347 definitions, resolved usage references and full evidence JSON.
- `bun run --cwd apps/web check:layers`: passed; 471 cross-cluster imports.
- Disposition registry validation against current census: passed; no missing live classes or invalid redirects.
- Census: current metrics and standing allowances recorded in foundations.md/inventory.json.
- `bun run --cwd apps/web visual --workers=1`: passed, 534 tests in 9.1 minutes, exit 0.
- OpenSpec strict validation: passed (no product behavior deltas). Version gate: passed, 0.1.0. Reference gate and local documentation links: passed. Validation record (private historical record) contains exact results.
- Product implementation, accepted specs, dependencies and regression baselines remain unchanged.

## Actionable audit validation

The revised component schema, action/priority vocabulary, counted migration scopes, source targets, Markdown links, exact lowercase filename and added-file whitespace checks pass. OpenSpec strict validation, version/reference gates and diff checks pass. UI-path diff is empty; unrelated workspace changes remain untouched. Prior 534-test browser run remains snapshot proof; no UI behavior changed in this documentation pass. Migration tasks remain unchecked until a separately authorized implementation batch supplies its acceptance proof.

## Foundation and architecture documentation validation

The target grammar and boundary references are reconciled with proposal/design/tasks. All 19 pending migration rows have valid actions/priorities, linked scopes/tasks and acyclic dependencies; M00 precedes M18, and both precede downstream migrations. Local document targets and whitespace checks pass. OpenSpec strict validation, version 0.1.0 and reference gates pass. UI source, VUI implementation, accepted specs, dependencies and browser baselines remain unchanged. Target directories are not created; contrast/specimen/kit approval is pending, not inferred from existing screenshots. The prior browser suite is retained snapshot evidence, not a fresh validation of the planned architecture. See the appended record in evidence/validation.json.

## Pattern intent specification validation

All 21 named target patterns have linked intent specifications with all 11 required sections, good/bad semantic examples, current usage/source provenance and acceptance evidence. Local link/anchor checks, backlog/task acceptance consistency, OpenSpec strict validation, version/reference gates and whitespace checks pass. UI/source, accepted product specs, dependencies and browser baselines remain unchanged. Examples are illustrative contracts; no current API or visual approval is claimed. Exact proof is appended to the validation record; prior browser evidence was not rerun for this documentation-only pass.
