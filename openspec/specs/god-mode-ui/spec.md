# god-mode-ui Specification

## Purpose

Provides a distinct, responsive instance administration interface whose navigation and controls make the global scope and its authority clear.

## Requirements

### Requirement: God Mode has a separate navigable shell

The app SHALL show a God Mode entry in its sidebar footer and phone navigation only to an active instance owner. God Mode SHALL use a distinct shell with a static instance header, a Back to app action, and grouped Management and Instance sections. It SHALL NOT show a workspace switcher as the scope of God Mode is the deployment. God Mode SHALL use the same top bar as the app shell — sidebar toggle, the title "God Mode", search, theme toggle and user menu — without the workspace credit balance. Each section and selected detail SHALL have a stable URL, and browser Back SHALL restore the previous selection.

#### Scenario: Owner enters God Mode

- **WHEN** an instance owner selects God Mode from the app sidebar
- **THEN** the God Mode shell opens with Management and Instance navigation and a visible way back

#### Scenario: Non-owner navigates directly

- **WHEN** a signed-in non-owner opens a God Mode URL directly
- **THEN** no admin data or controls render and the access refusal is clear

#### Scenario: Deep link to a detail

- **WHEN** an owner opens a saved URL for a user, workspace, or project detail
- **THEN** that detail opens directly and browser Back returns to the prior page

#### Scenario: Account reachable from God Mode

- **WHEN** an owner in God Mode opens the user menu
- **THEN** Profile, Security, Preferences and Sign out are available, exactly as in the app shell

### Requirement: Management sections expose readable directories and details

Management SHALL contain Users, Workspaces, and Projects. Each section SHALL show search, bounded results, loading, empty, and error states. Selecting a result SHALL open a detail panel with relevant metadata and actions. Dangerous actions SHALL be visually separated, name their target, and require explicit confirmation; unavailable actions SHALL explain the blocking condition.

#### Scenario: Search has no matches

- **WHEN** an owner searches a directory and no rows match
- **THEN** the page identifies the empty result without appearing to have failed to load

#### Scenario: User cannot be deleted

- **WHEN** the selected account is a last workspace owner
- **THEN** the detail panel names the workspace and offers the transfer path instead of an ineffective delete control

### Requirement: Instance sections reuse Maleo settings behavior

Instance navigation SHALL contain General, Authentication, Providers, Security & Storage, Usage, and AI Explorer. General SHALL summarize deployment status and link to actionable sections; the existing settings sections SHALL place their applicable settings flows under the instance shell. Provider capability hierarchy, secret masking, environment override explanations, and existing responsive settings behavior SHALL remain available. Workspace-specific controls SHALL remain in Workspace. AI Explorer SHALL expose read-only deployed AI definitions at `/god/pipelines` to active instance owners, independently of workspace or project selection.

#### Scenario: Owner follows an old Settings link

- **WHEN** an instance owner opens an existing `/settings` deep link
- **THEN** the matching God Mode section and detail open at a stable URL

#### Scenario: Member follows an old Settings link

- **WHEN** a non-owner opens a former global Settings deep link
- **THEN** global configuration is not rendered or returned

#### Scenario: Owner opens template explorer

- **WHEN** an active instance owner selects AI Explorer in God Mode
- **THEN** `/god/pipelines` opens inside the existing instance shell
- **AND** workflow/profile definitions and the tool catalog are available without selecting a project

### Requirement: Sidebar and admin pages work at phone and desktop widths

God Mode SHALL use Maleo's approved tokens and shared controls for navigation, tables or lists, forms, and overlays. At phone width, the same sections SHALL remain reachable through the app drawer and the God Mode menu; detail panels SHALL fit the viewport and restore focus when closed. Keyboard navigation, visible focus, readable labels, and reduced-motion behavior SHALL be preserved.

#### Scenario: Phone navigation

- **WHEN** an instance owner opens the app at phone width
- **THEN** God Mode is reachable without a desktop-only control, and every admin section remains reachable after entry

#### Scenario: Detail closes by keyboard

- **WHEN** an owner closes a detail panel with Escape
- **THEN** focus returns to its triggering row and no hidden panel remains interactive

### Requirement: Template explorer provides progressive read-only inspection

AI Explorer SHALL expose exactly three peer destinations: Workflows (how AI tasks execute), Tools (what capabilities AI can invoke), and Instructions (what guides AI behavior, including prompts). Definitions, Operations and Profiles SHALL NOT be navigation destinations. Operations SHALL remain contextual stage details and profiles SHALL remain contextual configuration with complete contracts. No topology editing, prompt mutation or AI execution action SHALL be offered.

#### Scenario: Choose a stage

- **WHEN** an owner chooses Plan Story then Direction
- **THEN** purpose, related operations, tools, instructions, conditions and repeat scope appear immediately without another expansion

#### Scenario: Inspect carousel tool and prompt

- **WHEN** an owner selects carousel drafting and follows tool and instruction links
- **THEN** selected workflow/stage remain while inspector shows corresponding deployed definitions and copyable fixed text without starting AI

#### Scenario: View repeated internal work

- **WHEN** an owner selects a story asset generation stage
- **THEN** operations and repetition scopes are immediately available in inspector without opening every technical section

#### Scenario: Search has no results

- **WHEN** an owner searches tools and no definition matches
- **THEN** the explorer shows a filtered-empty state and a way to clear the search
- **AND** does not present the catalog as failed or empty

### Requirement: Definition selections survive navigation and reload

Workflow, stage, inspector identity, bounded dependency trail, active destination, inventory query and Implementation disclosure SHALL survive URL reload and browser Back/Forward. Selection navigation SHALL push history; query typing and disclosure changes SHALL replace history. Following a dependency SHALL retain selected workflow and stage. Unknown IDs SHALL remain explicitly unavailable, and a stage outside selected workflow SHALL NOT silently select another stage. Legacy tool and prompt routes SHALL normalize to Tools and Instructions; operation/profile links SHALL preserve identity through contextual inspection. Orphan entities SHALL NOT be assigned invented workflow ownership.

#### Scenario: Reload and return

- **WHEN** an owner follows Direction to an instruction, reloads, then presses Back
- **THEN** the instruction reloads with workflow/stage context and Back restores the preceding selection

#### Scenario: Deep link to prompt

- **WHEN** an owner opens a saved prompt-definition URL and reloads
- **THEN** the same prompt and current deployed revision are displayed

#### Scenario: Return from tool details

- **WHEN** an owner follows a step's tool link and presses browser Back
- **THEN** the previous workflow and step selection return

#### Scenario: Definition no longer exists

- **WHEN** an owner opens a URL whose definition ID is absent from the deployed catalog
- **THEN** the unavailable definition is identified and catalog navigation remains usable

### Requirement: Catalog request and authorization states remain explicit

The explorer SHALL distinguish loading, successful empty catalog, request failure, filtered-empty results, unavailable definition, and denied access. Failed catalog reads SHALL offer retry without showing stale definitions as current. Non-owners SHALL see no catalog content through direct navigation. If access is refused after definitions were loaded, the explorer SHALL clear their rendered content and show the refusal.

#### Scenario: Backend is unavailable

- **WHEN** the catalog request fails
- **THEN** the explorer shows the request error and retry action
- **AND** does not claim there are no pipelines or render fixture definitions as current

#### Scenario: Member opens explorer directly

- **WHEN** a non-owner opens `/god/pipelines` or a definition deep link
- **THEN** no stage pipeline, tool contract, or prompt instruction renders
- **AND** the existing God Mode access refusal is shown

#### Scenario: Ownership is revoked during inspection

- **WHEN** a catalog refresh receives an authorization refusal after an earlier successful read
- **THEN** previously displayed definitions are removed from the rendered explorer
- **AND** access refusal replaces the definition view

### Requirement: Type tabs and stages explain definitions

Desktop exploration SHALL contain a compact selectable workflow list, ordered executable stages and a nonmodal contextual inspector for the selected workflow or stage. Following a related reference from the inspector SHALL open the same detail view in a routed right drawer rather than replacing the inspector. Workflow selection SHALL update stages and inspector without replacing shell or workflow list. Large cards and specification tables SHALL NOT be primary browsing. At narrow widths including 320px, list, stages and inspector SHALL become sequential screens with visible contextual Back. Existing shell, approved controls and semantic tokens SHALL be reused; no graph gesture SHALL be required.

#### Scenario: Switch workflow

- **WHEN** an owner selects another workflow
- **THEN** the same explorer shell and workflow list remain while stages update in place

#### Scenario: Inspect stage dependency

- **WHEN** an owner selects a stage then follows a dependency
- **THEN** related definition opens in the right drawer while the selected workflow, stage and inspector remain behind it

#### Scenario: Close routed detail

- **WHEN** an owner returns from dependency detail using contextual Back or applicable Escape
- **THEN** stage inspector and originating focus return and URL reflects restored selection

### Requirement: Maintenance dashboard keeps pipeline context

Tools SHALL be browsable by meaningful production-owned capability and Instructions by purpose and named consumers. Grouped compact rows SHALL show human-readable labels and short useful purpose, without primary specification tables. Complete inventories SHALL NOT be implicitly limited by background workflow. Each active inventory SHALL have one search field and clear/reset recovery; instruction search SHALL include fixed text without an extra toggle. Basic browsing SHALL be reviewed before adding filters. Any filter accepted through that review SHALL address capability or consumer, derive choices from catalog and preserve URL state. Source modules, gate/repeat filters and additional search bars SHALL NOT dominate browsing.

#### Scenario: Browse shared instructions

- **WHEN** an owner enters Instructions from Plan Story
- **THEN** all deployed instruction definitions remain discoverable by purpose and actual consumer without a hidden workflow scope

#### Scenario: Inspect shared prompt without losing pipeline

- **WHEN** an owner follows a prompt or tool from a selected pipeline
- **THEN** pipeline context persists independently from selected definition after reload and Back
- **AND** selected definition is inspectable through stage pipelines, typed inventories and inspector

#### Scenario: Search instructions and narrow inventory

- **WHEN** an owner searches Instructions by text or consumer name
- **THEN** compact rows narrow to matching definitions without changing stage order or adding a prompt-text toggle; any review-approved consumer filter remains independent of Tools

### Requirement: Details explain maintenance impact

Inspector SHALL prioritize purpose, linked work/tools/instructions and applicable conditions/repetition. A workflow's detail SHALL explain that it is one complete job whose steps run in order, and SHALL present workflow-level instructions and optional availability as the chat assistant's context rather than as workflow or step dependencies; a tool's detail SHALL name workflows whose assistant can call it separately from workflows whose steps use it. A step's detail SHALL state its position in the workflow. Primary inspector copy SHALL use plain operator language, present facts as labelled rows and omit facts the catalog does not expose rather than reporting their absence. Tool details SHALL identify effect and actual public/internal exposure. Instruction details SHALL retain complete readable selectable/copyable fixed text. Expandable Implementation, labelled Technical details, SHALL retain complete original descriptions, validated contracts, raw schemas, prompt composition and branches, variable bindings/defaults/transforms, output constraints, canonical IDs/aliases, sources, revisions and fidelity/coverage evidence. Direct consumers, transitive workflow reachability and optional availability SHALL remain distinct. On-request potential impact SHALL exclude availability from dependency traversal. Tables retained for technical data SHALL preserve the previous right drawer’s rounded bordered frame, 620px minimum table measure, native headers and labeled focusable local scrolling without page overflow through canonical TableScroll and Table.

#### Scenario: Inspect instructions

- **WHEN** an owner opens an instruction and expands Implementation
- **THEN** full fixed text remains copyable and complete recipe, variables, raw identity and evidence remain available without replacing primary purpose

#### Scenario: Shared definition affects multiple workflows

- **WHEN** an owner requests affected pipelines for a shared definition
- **THEN** actual direct and transitive dependency consumers are shown
- **AND** optional availability is identified separately and excluded from dependency impact traversal

### Requirement: Definition navigation uses consistent text links

Workflow names, stages, stage dependencies, inventory names and related definitions in the drawer SHALL use native unpadded clickable text with valid typed-route hrefs. Execution-order references, dependencies, consumers, optional availability and affected workflows SHALL use the same link behavior. Card/row highlights and accessible current-selection state SHALL remain without redundant Selected labels. Copy, refresh, close and impact disclosure SHALL retain action semantics.

#### Scenario: Follow related definition with keyboard

- **WHEN** an owner activates a workflow or drawer definition text link with Enter
- **THEN** the linked definition opens without running an agent call
- **AND** Back, reload, closing focus and native modified-click destinations remain usable

#### Scenario: Selected card has no repeated badge

- **WHEN** an owner selects a workflow stage or inventory definition
- **THEN** its card or row stays highlighted and its link exposes current selection
- **AND** no Selected text badge appears

### Requirement: Related definitions stay in a drawer navigation stack

Related links SHALL open in, or replace the frame of, one routed right drawer while retaining background destination, workflow, stage, inspector and inventory query. On Workflows, links to a workflow or one of its stages SHALL navigate the main view and close the drawer; on Tools and Instructions every related link, workflows and stages included, SHALL open in the drawer so the inventory stays in view, and a workflow shown in the drawer SHALL list its ordered steps. Drawer Back SHALL restore the prior drawer frame and Close SHALL dismiss the drawer; browser Back/Forward and reload SHALL restore typed trail. List, stages and inspector SHALL be sequential at narrow widths; the drawer SHALL fit 320px without page overflow. Legacy workflow links naming a related definition through `inspect` SHALL open it in the drawer. Existing application history owner SHALL remain authoritative without a second overlay/history stack. Contextual Back on direct links SHALL use URL parent context rather than unrelated browser history. Malformed trail data SHALL be ignored safely; unknown IDs SHALL remain unavailable. Returning from dependency inspection SHALL restore originating link or surviving context focus.

#### Scenario: Nested inspection

- **WHEN** an owner follows stage to operation to instruction then reloads
- **THEN** same instruction and trail return and contextual Back restores prior operation without changing parent stage

#### Scenario: Inspect tool from workflow

- **WHEN** an owner follows a workflow stage tool link in the inspector
- **THEN** the tool opens in the right drawer while Workflows remains the selected active destination
- **AND** background workflow, expansion, query and originating stage state remains intact

#### Scenario: Navigate and reload nested definitions

- **WHEN** an owner follows several related definitions, reloads and presses contextual Back
- **THEN** each Back returns one previous frame and preserves background workflow/stage or inventory context

#### Scenario: Invalid trail query

- **WHEN** a URL contains invalid section/ID records or malformed trail JSON
- **THEN** invalid entries are ignored and valid typed selections remain usable

### Requirement: Template inspection communicates executable fidelity

Explorer SHALL preserve executable-derived conditions, possible continuations, operation relationships and production prompt assembly. Derived, declared and opaque provenance SHALL apply per fact; verification SHALL remain a separate evidence dimension requiring passed relationship-specific evidence at current relevant revision. Primary explanations SHALL retain conditional and opaque qualifications, with detailed provenance and evidence under Implementation. Runtime input slots SHALL remain unresolved. Unsupported schema versions SHALL show explicit compatibility error without fabricated or stale successful data.

#### Scenario: Inspect planning condition

- **WHEN** an owner selects a conditional planning stage
- **THEN** inspector explains possible behavior without resolving runtime inputs, and Implementation exposes executable structure and provenance

#### Scenario: Inspect a conditional planning operation

- **WHEN** an owner selects a planning stage or operation
- **THEN** contextual inspector shows purpose, condition, possible continuation and dependencies; Implementation exposes fidelity boundaries without a canvas

#### Scenario: Inspect prompt assembly

- **WHEN** an owner opens a pilot prompt definition
- **THEN** the inspector shows production composition order, conditional blocks, variable bindings, defaults or transforms, and unresolved input slots
- **AND** the existing full fixed text remains selectable and copyable

#### Scenario: Follow a dependency on a phone

- **WHEN** an owner follows a tool or instruction at phone width
- **THEN** next sequential detail screen opens and Back restores preceding detail with workflow, query and originating focus intact

#### Scenario: Catalog schema is unsupported

- **WHEN** the backend returns any catalog schema version other than 2
- **THEN** the explorer shows an explicit compatibility error
- **AND** does not display a fabricated or stale successful pilot view

### Requirement: Workflow overview explains purpose and authority

Selected workflow SHALL show purpose in one or two sentences and executable stages as primary content. Triggers or callable entry point, input/output contracts, runtime ownership, source paths and bounded coverage SHALL be grouped under expandable Implementation. Missing facts SHALL remain explicitly unexposed. A callable entry point SHALL NOT imply a schedule and source ownership SHALL NOT imply runtime host. First visit SHALL offer workflow selection without silently assigning a workflow.

#### Scenario: Read purpose first

- **WHEN** an owner chooses Plan Story
- **THEN** short purpose and ordered stages appear immediately while technical fact groups remain under Implementation

#### Scenario: Owner starts without technical names

- **WHEN** an owner opens AI Explorer and chooses a workflow
- **THEN** short purpose and ordered stages appear before technical inventories, with triggers/contracts/authority/coverage under Implementation

#### Scenario: Runtime authority is not published

- **WHEN** the current workflow catalog exposes source ownership but no runtime host
- **THEN** overview shows the known source ownership and identifies runtime host as not exposed
- **AND** does not guess authority from identifier text

### Requirement: Inline stages distinguish association from execution

Stage selection SHALL immediately reveal related operations, tools and instructions with conditions and repeat scope in inspector. Direct use SHALL be distinguished from references reached via named operations. Workflow guidance and optional availability SHALL remain separate from stage use. Canonical shared definitions SHALL remain one entity. Stage order SHALL come from published executable steps; stage rows SHALL be compact numbered list items with stage name and unique tool/instruction reference totals, without table headers or continuation arrows. Totals SHALL include linked operation dependencies, exclude optional availability, deduplicate canonical IDs and never imply runtime invocation counts. Containment, availability and potential invocation SHALL NOT imply order. Missing conditions, repeat scope or relationships SHALL be labeled unexposed rather than nonexistent behavior.

#### Scenario: Available tool is not stage work

- **WHEN** a tool has only workflow availability
- **THEN** it remains optional availability and is not displayed as required stage use or ordered execution

#### Scenario: Stage contains shared instructions

- **WHEN** an owner selects two stages referencing the same prompt
- **THEN** both links resolve to the same canonical prompt and revision
- **AND** no copied prompt definition or exclusive parent ownership is invented

#### Scenario: Available tool is not required

- **WHEN** a tool has only an availability relationship to a workflow
- **THEN** it appears as optionally available rather than sequential stage work
- **AND** no arrow or dependency consumer is inferred

### Requirement: Named consumers preserve deliberate workflow context

Definitions SHALL have human-readable labels while canonical identifiers remain searchable, URL-addressable and visible in the technical inspector. Consumer presentation SHALL name actual consumers and distinguish direct use, transitive workflow/stage reachability and optional availability. Navigable consumer contexts and breadcrumbs SHALL preserve the chosen path, not assign exclusive ownership to shared definitions or silently select the first reachable workflow. Source locations SHALL remain in technical inspection rather than dominate prompt inventory columns.

#### Scenario: Prompt belongs to several workflow paths

- **WHEN** an owner opens a shared prompt and selects a named consumer in another workflow
- **THEN** the selected consumer's workflow and stage become the explicit context
- **AND** Back restores the original context and canonical prompt identity

#### Scenario: Consumer has no workflow association

- **WHEN** a direct consumer has no published workflow/stage path
- **THEN** its name remains navigable and the missing association is explicit

### Requirement: Workflow coverage communicates boundaries without percentages

Workflow coverage SHALL distinguish derived, declared, opaque and unexposed facts in named execution, relationship, instruction and contract groups. Verification SHALL be a separate evidence dimension with no positive claim unless corresponding passed checks support the specific relationship at its current deployed definition revision. Missing evidence SHALL mean not published, not failed verification. Coverage SHALL NOT show misleading completeness percentages, blanket workflow certification or infer verified neighbors through shared dependencies.

#### Scenario: Current catalog has no test attestations

- **WHEN** an owner opens coverage for a valid workflow without revision-bound test evidence
- **THEN** per-fact provenance and boundaries are shown with verification evidence identified as not published
- **AND** no Verified badge or completeness percentage is displayed

#### Scenario: Definition revision changes

- **WHEN** refreshed definitions no longer match revision referenced by evidence
- **THEN** the explorer makes no current verified claim for that relationship
- **AND** continues to show current provenance and explicit boundaries

### Requirement: Workflow discovery remains accessible across responsive layouts

Selection rows SHALL reuse Providers and Security & Storage styling and full-row hit targets: muted idle text, foreground selected text and thin foreground marker, without colored fill. Row metadata SHALL activate the same selection. Workflow exploration SHALL remain keyboard-operable at desktop and 320px coarse-pointer widths with visible focus, real links, modified-click behavior and current-selection semantics. Named navigation and skip links SHALL permit quick movement to stages and inspector. Desktop activation SHALL retain origin focus and announce updated region; sequential navigation SHALL focus destination heading and Back SHALL restore origin or surviving fallback. Inspector Escape SHALL return from dependency to stage without intercepting text entry or active overlays. Long labels, full prompt copy, local raw-data scrolling, canonical touch targets, themes and reduced motion SHALL remain usable without page overflow. Resize SHALL preserve URL selection without extra history or duplicate interactive regions.

#### Scenario: Keyboard phone round trip

- **WHEN** an owner opens workflow, stage and instruction at 320px then uses Back
- **THEN** each screen remains readable, Back restores selection and focus, and no compressed columns or hidden interactive duplicate remain

#### Scenario: Keyboard discovery without inventory switching

- **WHEN** an owner chooses a workflow, selects a stage and follows an instruction using keyboard
- **THEN** all actions have visible focus and meaningful names; Back restores originating link or surviving context

#### Scenario: Coarse pointer and long content

- **WHEN** an owner inspects long labels, schemas and prompt text at 320px with reduced motion
- **THEN** sequential screens and canonical touch targets remain usable without page overflow and full text is readable/copyable with local scrolling
