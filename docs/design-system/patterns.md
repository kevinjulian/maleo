# UI patterns and actual usages

Snapshot 2026-10-01. Patterns are recurring compositions with behavior, hierarchy and state rules. A shared Button does not standardize toolbar grouping, route navigation, property rows, or loading/error presentation. The [catalogue](#catalogue) says which patterns are built; the [agent protocol](#agent-protocol) says how to use it. The usage families further down record what the app rendered when it was audited.

Current definitions and all consumers live in [components.md](components.md); source/ARIA/style details are in inventory.json (private historical record). Findings are ranked in [audit.md](audit.md).

## Component and pattern contract

[principles.md](principles.md#component-versus-pattern) defines the target component and Maleo pattern vocabularies. A component supplies a control/presentation primitive; a pattern supplies the semantic composition around those controls. Existing source definitions are inventoried separately from this classification.

Agents can choose approved controls inside a pattern’s documented extension points. They must retain its hierarchy, density, layout, accessibility and state rules. A PropertyRow may contain Input, Select or Slider; its label/control/hint/error/reset arrangement does not become a new local row design. Toolbar grouping and responsive behavior belong to Toolbar/ToolbarGroup/ToolbarAction, not the chosen Button variant.

The families below record current usages and candidate convergence; the approved-pattern registry is the catalogue. The target vocabulary includes PropertyRow, InspectorSection, PanelHeader; Toolbar, ToolbarGroup, ToolbarAction; MediaCard, MediaGrid, AssetPicker; EmptyState, ErrorState, LoadingState, Pager; GenerationCard, GenerationProgress, GenerationError; ChatMessage, ToolCall, PromptComposer; TimelineTrack, TimelineClip and TransportControls. Reuse existing implementations, distinguish semantic differences and document contracts before creating APIs. Timeline contracts preserve the public VUI engine; generation/chat patterns receive presentation data and authorized commands from features.

If an existing pattern cannot express the task, record the semantic gap and actual consumers in OpenSpec. Review a supported variant or NEW_PATTERN before implementation. Do not add a parallel layout because a local styling choice is easier.

## Catalogue

The 24 named patterns, and which of them exist. This table is the registry: `catalogue.test.ts` beside the patterns fails when it and the code disagree.

- **Approved** — built, exported from `apps/web/src/design-system/patterns/`, rendered in Storybook and used in production. Import it; do not rebuild it. Its spec has an Implementation section that records the shipped contract.
- **Feature-owned** — specified, and deliberately not a shared component. The timeline's tracks and clips are drawn by `apps/web/src/components/timeline/` on geometry, time and gestures that `@maleo/vui` owns; a design-system wrapper would sit between the two and fight both. The spec is the contract that feature keeps. There is no export.
- **Candidate** — an intent specification only. There is no export. The spec says what the pattern must do when it is built; until then the screens it describes keep their current markup, composed from approved components.

| Pattern                                               | Status        | Import                                           | Story                                                          | Purpose                                                                                         |
| ----------------------------------------------------- | ------------- | ------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [PropertyRow](patterns/property-row.md)               | Approved      | `@design-system/patterns/inspector.tsx`          | `stories/patterns/inspector/property-row.stories.tsx`          | Display one editable object or project-local editor property inside an inspector.               |
| [InspectorSection](patterns/inspector-section.md)     | Approved      | `@design-system/patterns/inspector.tsx`          | `stories/patterns/inspector/inspector-section.stories.tsx`     | Group related object or project-local editor properties under one named inspector section.      |
| [PanelHeader](patterns/panel-header.md)               | Approved      | `@design-system/patterns/panel-header.tsx`       | `stories/patterns/panel-header/panel-header.stories.tsx`       | Identify a panel and place its contextual state, actions and close control consistently.        |
| [Toolbar](patterns/toolbar.md)                        | Approved      | `@design-system/patterns/toolbar.tsx`            | `stories/patterns/toolbar/toolbar.stories.tsx`                 | Arrange actions and controls for one clearly identified work region.                            |
| [ToolbarGroup](patterns/toolbar-group.md)             | Approved      | `@design-system/patterns/toolbar.tsx`            | `stories/patterns/toolbar/toolbar.stories.tsx`                 | Keep related toolbar actions visually and behaviorally grouped.                                 |
| [ToolbarAction](patterns/toolbar-action.md)           | Approved      | `@design-system/patterns/toolbar.tsx`            | `stories/patterns/toolbar/toolbar.stories.tsx`                 | Express one toolbar command with consistent priority, placement and feedback.                   |
| [MediaCard](patterns/media-card.md)                   | Approved      | `@design-system/patterns/media.tsx`              | `stories/patterns/media/media.stories.tsx`                     | Present one asset with consistent preview, metadata and relevant actions.                       |
| [MediaGrid](patterns/media-grid.md)                   | Approved      | `@design-system/patterns/media.tsx`              | `stories/patterns/media/media.stories.tsx`                     | Lay out a media collection with predictable responsive geometry and collection states.          |
| [AssetPicker](patterns/asset-picker.md)               | Candidate     | —                                                | —                                                              | Let a user choose assets for a specified task with clear selection and commitment.              |
| [EmptyState](patterns/empty-state.md)                 | Approved      | `@design-system/patterns/collection.tsx`         | `stories/patterns/collection/request-states.stories.tsx`       | Explain a successfully loaded region with no usable items and offer a relevant next action.     |
| [ErrorState](patterns/error-state.md)                 | Approved      | `@design-system/patterns/collection.tsx`         | `stories/patterns/collection/request-states.stories.tsx`       | Explain a failed task or region and expose meaningful recovery without losing context.          |
| [LoadingState](patterns/loading-state.md)             | Approved      | `@design-system/patterns/collection.tsx`         | `stories/patterns/collection/request-states.stories.tsx`       | Communicate pending work in a known region while preserving usable context.                     |
| [Pager](patterns/pager.md)                            | Approved      | `@design-system/patterns/collection.tsx`         | `stories/patterns/collection/pager.stories.tsx`                | Move a server-paged collection to its previous or next page and state the rows shown.           |
| [GenerationCard](patterns/generation-card.md)         | Approved      | `@design-system/patterns/generation.tsx`         | `stories/patterns/generation/generation.stories.tsx`           | Present one generation run and its outputs, state and authorized actions.                       |
| [GenerationProgress](patterns/generation-progress.md) | Approved      | `@design-system/patterns/generation.tsx`         | `stories/patterns/generation/generation.stories.tsx`           | Show trustworthy stage/progress for one generation run.                                         |
| [GenerationError](patterns/generation-error.md)       | Approved      | `@design-system/patterns/generation.tsx`         | `stories/patterns/generation/generation.stories.tsx`           | Explain a generation-run failure with preserved outputs and valid recovery choices.             |
| [ChatMessage](patterns/chat-message.md)               | Approved      | `@design-system/patterns/chat.tsx`               | `stories/patterns/chat/chat.stories.tsx`                       | Present one conversational entry with clear speaker, content and attached outputs.              |
| [ToolCall](patterns/tool-call.md)                     | Approved      | `@design-system/patterns/chat.tsx`               | `stories/patterns/chat/chat.stories.tsx`                       | Present one tool invocation and its lifecycle without overwhelming conversation.                |
| [PromptComposer](patterns/prompt-composer.md)         | Approved      | `@design-system/patterns/prompt-composer.tsx`    | `stories/patterns/prompt-composer/prompt-composer.stories.tsx` | Compose and submit a prompt with predictable keyboard, attachment and busy semantics.           |
| [TimelineTrack](patterns/timeline-track.md)           | Feature-owned | —                                                | —                                                              | Present one timeline lane with its identity, controls and clips in shared time geometry.        |
| [TimelineClip](patterns/timeline-clip.md)             | Feature-owned | —                                                | —                                                              | Represent one editable time interval with consistent selection, content and action affordances. |
| [SidebarNavigation](patterns/sidebar-navigation.md)   | Approved      | `@design-system/patterns/sidebar-navigation.tsx` | `stories/patterns/shell/shell.stories.tsx`                     | Route navigation with shared header, groups, rail and footer.                                   |
| [Topbar](patterns/topbar.md)                          | Approved      | `@design-system/patterns/topbar.tsx`             | `stories/patterns/shell/shell.stories.tsx`                     | App/editor header with leading content, status and actions.                                     |
| [TransportControls](patterns/transport-controls.md)   | Approved      | `@design-system/patterns/transport.tsx`          | `stories/patterns/transport/transport-controls.stories.tsx`    | Expose playback and time position with a consistent, accessible control group.                  |

Every spec has the same sections: purpose, use and avoid cases, structure (slots), allowed controls and composition, rules, variants with density and responsive behaviour, accessibility and states, examples, current usages and ownership, and acceptance evidence. The 34 usage families below are evidence of what the app renders today, not further approved patterns.

## Agent protocol

For any change that adds or alters UI, in this order:

1. **Name the screen and the state.** Which surface, and which of resting, loading, empty, failed, busy, selected or disabled is being built.
2. **Look the pattern up in the catalogue.** Match on purpose, not on appearance.
3. **Approved pattern fits** — import it from the listed module and compose approved components inside its documented slots. Keep its hierarchy, density, labels and state rules; pick among its variants, do not restyle it from the feature.
4. **Approved pattern almost fits** — do not fork it and do not override it with local CSS. Record the gap and the real consumers as a task in the active OpenSpec change, and get the variant reviewed before writing it.
5. **Candidate pattern fits** — read its spec and follow its rules with approved components, in the feature. Do not create the shared component as a side effect of a feature change; building a Candidate is its own reviewed task, and on landing it moves to Approved here with its export, story and Implementation section.
6. **Nothing fits** — use components directly if the UI is one control or a plain form. If it is a recurring composition, record `NEW_PATTERN` in OpenSpec with at least two real usages before implementing.
7. **Values** — spacing, type, weight, radius, elevation, layer and colour come from the roles in [foundations.md](foundations.md). A literal is allowed only for the recorded exceptions: hairlines, media and canvas geometry, local stacking inside a stage or track.
8. **Boundaries** — features do not import `@base-ui/react`; `design-system/` does not import features or stores. `bun run check:layers` enforces both.
9. **Prove it** — drive the changed control in the app at desktop and phone width, by keyboard as well as pointer, and run the visual suite. A changed baseline is looked at before it is accepted.

## Pattern map

| Pattern family | Classification | Existing component definitions |
|---|---|
| App shell and route navigation | KEEP | App, AppSidebar, TopBar, Breadcrumb, BareShell, WorkspaceSwitcher, UserMenu |
| Page and Library headers | STANDARDIZE | PageHeader, PageTitle, LibraryHeader, StudioHeading, ColumnHead |
| Collection search and filters | MERGE | LibraryToolbar, ContentToolbar, ImagesGallery, SpeechGallery |
| Library collection rows and cards | KEEP | ReferencesLibrary, ReferenceImage, MaterialsLibrary, MaterialGroupRow, PresetsLibrary, TemplatesLibrary, VoicesLibrary, ElementsLibrary, ElementTile |
| Element preview catalogue | KEEP | LazyPreview, BuiltInTextTiles, BuiltInMotionTiles, CustomTilePreview |
| Pagination and directory tables | STANDARDIZE | Pager, GodPager, ContentTable, GodDirectory, ContentRow |
| Library editor forms | STANDARDIZE | MaterialEditor, PresetEditor, TimelineTemplateEditorModal, EntityEditor, TemplateFieldsEditor |
| Destructive confirmation | KEEP | DeleteConfirm, ConfirmAction, DangerPanel, GodUserDetail, GodWorkspaceDetail |
| Labelled field composition | STANDARDIZE | Field, ML, LabelledInput, RailField, DirectionFields, Setup |
| Inspector property rows | NEW_PATTERN | Control, ClipControls, TransformSection, RevealControls, DurationField |
| Panel hierarchy and disclosure | KEEP | Panel, Section, Control, AccordionSection, TimelinePanelHost, VuiInspectorRail |
| Editor mode and local tabs | REFACTOR | ModeTabs, TabsRoot, TabsList, TabsTab, TabsPanel, TimelinePhoneWorkspace |
| Usage route selection | REFACTOR | CreditsPanel, SettingsPage, GodModePage |
| Timeline, template and motion toolbars | STANDARDIZE | TimelineToolbar, TimelineToolbarFrame, TemplateToolbar, MotionToolbar, EditorTopbar, StudioActionBar, TimelineBottomBar |
| Transport and timecode | KEEP | TransportPlay, TransportTimecode, VuiTimecode, VuiTransport, VuiRendererTransport |
| Anchored popup lifecycle | REFACTOR | Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, OptionPopover, AlphaColorControl, WorkspaceSwitcher |
| Menus and clip actions | STANDARDIZE | Menu, MenuItem, MenuLabel, MenuSeparator, ExportMenu, TimelineClipBar |
| Modal, sheet and lightbox | KEEP | Modal, Sheet, Lightbox, VuiSheet, VuiOverlay, EditModal, MotionStudioModal |
| Color and swatch editing | REFACTOR | AlphaColorControl, SwatchGroup, Swatch |
| References, mentions and entity pickers | STANDARDIZE | SceneReferenceChips, SceneCastPicker, VoicePicker, MentionTextarea, ReferenceLibrary, StyleReferencePicker, PresetMaterialPicker |
| Materials and preset selection | KEEP | CreateMaterials, PresetPickerModal, PresetOverrideWarning, PresetUsageLine, ProjectMaterialsDrawer |
| Chat and generation composers | STANDARDIZE | ChatComposerBox, PromptComposer, SpeechLabPage, TextProviderSelect, TagsInput |
| Agent run and output cards | KEEP | ThinkingCard, WorkflowProgressCard, LedgerCard, ToolRow, RunView, RunResult, OutcomeCard, AgentErrorCard, ResearchCard, ChatOutput |
| Clarification and blocker forms | KEEP | ClarificationCard, BlockerBatch, CreditLimitCard, PinnedDecision, SubmittedContext |
| Audit and historical activity | KEEP | AuditPanel, RunActivity, ChangeCard, ActivityItem, QueueStatusPanel |
| Media frames and previews | STANDARDIZE | Frame, Lightbox, AudioPreview, MediaHoverPreview, VideoPoster, VuiPreviewFrame, VuiRemotionPreview |
| Empty, filtered-empty, loading and failure | STANDARDIZE | EmptyState, Shimmer, Note, Callout, FormOutcome, ErrBar, Toast |
| Settings/provider readiness | KEEP | ProviderSetup, ProviderList, CapabilityColumn, CapabilitiesTab, StateDot, EnvTable, SecurityPanel |
| Workspace and instance administration | KEEP | WorkspaceManage, GeneralPanel, MembersPanel, DangerPanel, GodDirectory, GodUserDetail, GodWorkspaceDetail, ProjectDetail, Authentication |
| Auth, invite and personal account | KEEP | AuthGate, SignInPage, InvitePage, ProfilePanel, PasswordForm, Sessions, PreferencesPanel |
| Script density and action strip | REFACTOR | ScriptView, ScriptTable, TextWorkspace |
| Storyboard and scene authoring | KEEP | StoryboardView, StoryboardSurface, BeatCard, SceneStudio, SceneBoard, SceneList, SceneEditorDrawer |
| Timeline clips, lanes and drag geometry | KEEP | TimelineTracks, TimelineLane, TimelineBaseLane, ClipRange, FreeClipRange, TimelineClipInspector, TimelineClipInspectorSheet |
| Editor workspace composition | KEEP | VuiEditorWorkspace, VuiWorkspaceShell, WorkspaceSurface, VuiTimelineView, VuiKeyboardScope, VuiInspector, VuiStatus |

## App shell and route navigation

**KEEP.** Addressed destinations, sidebar versus mobile bottom navigation, workspace context and account actions. Preserve access boundaries; unify navigation chrome only where the destination contract matches.

**Current implementations and consumers:**

- **App** — [apps/web/src/app/app.tsx](../../apps/web/src/app/app.tsx):130. [app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx): 55
- **AppSidebar** — [apps/web/src/components/shell/app-sidebar.tsx](../../apps/web/src/components/shell/app-sidebar.tsx):56. [app/app.tsx](../../apps/web/src/app/app.tsx): 309, 352
- **Breadcrumb** — [apps/web/src/components/shell/breadcrumb.tsx](../../apps/web/src/components/shell/breadcrumb.tsx):6. [app/app.tsx](../../apps/web/src/app/app.tsx): 360
- **BareShell** — [apps/web/src/components/shell/bare-shell.tsx](../../apps/web/src/components/shell/bare-shell.tsx):8. [app/app.tsx](../../apps/web/src/app/app.tsx): 281, 283
- **UserMenu** — [apps/web/src/components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx):33. [components/shell/top-bar.tsx](../../apps/web/src/components/shell/top-bar.tsx): 62
- **TopBar** — [apps/web/src/components/shell/top-bar.tsx](../../apps/web/src/components/shell/top-bar.tsx):32. [app/app.tsx](../../apps/web/src/app/app.tsx): 359; [components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx): 85
- **WorkspaceSwitcher** — [apps/web/src/components/workspace/workspace-switcher.tsx](../../apps/web/src/components/workspace/workspace-switcher.tsx):137. [app/app.tsx](../../apps/web/src/app/app.tsx): 371; [components/shell/app-sidebar.tsx](../../apps/web/src/components/shell/app-sidebar.tsx): 84; [pages/create-form.tsx](../../apps/web/src/pages/create-form.tsx): 55

**Screens:** [content-list-1440](screenshots/content-list-1440.png); [content-list-320](screenshots/content-list-320.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Page and Library headers

**STANDARDIZE.** Page title/lead/count/action versus panel title/close/state are separate purposes. A future PanelHeader recipe may merge repeated header chrome, but PageHeader/LibraryHeader already exist; do not add a second page header.

**Current implementations and consumers:**

- **PageTitle** — [apps/web/src/design-system/components/page.tsx](../../apps/web/src/design-system/components/page.tsx):52. [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 167; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 124; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 28, 97; [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 216; [design-system/components/page.tsx](../../apps/web/src/design-system/components/page.tsx): 68
- **PageHeader** — [apps/web/src/design-system/components/page.tsx](../../apps/web/src/design-system/components/page.tsx):64. [components/catalog/library-chrome.tsx](../../apps/web/src/components/catalog/library-chrome.tsx): 32; [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 122; [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 72; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 113; [pages/account.tsx](../../apps/web/src/pages/account.tsx): 26; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 36; [pages/video.tsx](../../apps/web/src/pages/video.tsx): 12
- **ColumnHead** — [apps/web/src/components/settings/column-head.tsx](../../apps/web/src/components/settings/column-head.tsx):10. [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 69, 83; [components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx): 123
- **LibraryHeader** — [apps/web/src/components/catalog/library-chrome.tsx](../../apps/web/src/components/catalog/library-chrome.tsx):29. [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 72; [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 352; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 283; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 212; [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 94; [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 119
- **StudioHeading** — [apps/web/src/components/timeline/studio-heading.tsx](../../apps/web/src/components/timeline/studio-heading.tsx):25. [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 524; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 502

**Screens:** [library-templates-1440](screenshots/library-templates-1440.png); [god-general-1440](screenshots/god-general-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Collection search and filters

**MERGE.** F01/F12. Six libraries already share LibraryToolbar. Content and galleries implement separate search/filter bars; merge adornments and matching control chrome while retaining taxonomy, pagination and scope. Groups are buttons with aria-pressed, not tab panels.

**Current implementations and consumers:**

- **ImagesGallery** — [apps/web/src/components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx):44. [pages/images.tsx](../../apps/web/src/pages/images.tsx): 31
- **LibraryToolbar** — [apps/web/src/components/catalog/library-toolbar.tsx](../../apps/web/src/components/catalog/library-toolbar.tsx):52. [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 73; [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 360; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 288; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 213; [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 107; [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 120
- **ContentToolbar** — [apps/web/src/components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx):62. [pages/content.tsx](../../apps/web/src/pages/content.tsx): 57
- **SpeechGallery** — [apps/web/src/components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx):40. [pages/speech.tsx](../../apps/web/src/pages/speech.tsx): 26

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [images-1440](screenshots/images-1440.png); [speech-1440](screenshots/speech-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Library collection rows and cards

**KEEP.** References use images/notes, Materials group reusable instructions, Presets bundle materials/template, Templates store timing policy, Elements include built-ins/custom composition. Same collection chrome does not make these records interchangeable.

**Current implementations and consumers:**

- **ReferenceImage** — [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):41. [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 52, 159
- **ReferencesLibrary** — [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):203. [pages/library.tsx](../../apps/web/src/pages/library.tsx): 26
- **MaterialGroupRow** — [apps/web/src/components/catalog/preset-material-picker.tsx](../../apps/web/src/components/catalog/preset-material-picker.tsx):66. [components/catalog/preset-material-picker.tsx](../../apps/web/src/components/catalog/preset-material-picker.tsx): 122
- **ElementTile** — [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx):43. [components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx): 65, 81, 97
- **TemplatesLibrary** — [apps/web/src/components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx):46. [pages/library.tsx](../../apps/web/src/pages/library.tsx): 24
- **PresetsLibrary** — [apps/web/src/components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx):218. [pages/library.tsx](../../apps/web/src/pages/library.tsx): 22
- **MaterialsLibrary** — [apps/web/src/components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx):263. [pages/library.tsx](../../apps/web/src/pages/library.tsx): 23
- **VoicesLibrary** — [apps/web/src/components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx):91. [pages/library.tsx](../../apps/web/src/pages/library.tsx): 21
- **ElementsLibrary** — [apps/web/src/components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx):55. [pages/library.tsx](../../apps/web/src/pages/library.tsx): 25

**Screens:** [library-references-1440](screenshots/library-references-1440.png); [library-materials-1440](screenshots/library-materials-1440.png); [library-elements-data-1440](screenshots/library-elements-data-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Element preview catalogue

**KEEP.** Intersection-mounted, frozen authored previews versus editor autoplay are intentional differences. Full-page screenshots can contain unmounted offscreen tiles; filtered Data capture proves those visible previews. Do not call every blank lazy tile a rendering bug.

**Current implementations and consumers:**

- **LazyPreview** — [apps/web/src/components/catalog/lazy-preview.tsx](../../apps/web/src/components/catalog/lazy-preview.tsx):20. [components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx): 46
- **BuiltInTextTiles** — [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx):60. [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 86
- **BuiltInMotionTiles** — [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx):76. [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 91
- **BuiltInDataTiles** — [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx):92. [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 96
- **CustomTilePreview** — [apps/web/src/components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx):88. [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 244

**Screens:** [library-elements-data-1440](screenshots/library-elements-data-1440.png); [library-elements-1440](screenshots/library-elements-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Pagination and directory tables

**STANDARDIZE.** Current list paging and table rows have domain-specific query and action logic. Standardize count/paging affordances, selected/disabled states and contained overflow; do not merge backend authority.

**Current implementations and consumers:**

- **GodDirectory** — [apps/web/src/components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx):19. [components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx): 97
- **GodPager** — [apps/web/src/components/admin/god-pager.tsx](../../apps/web/src/components/admin/god-pager.tsx):5. [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 71; [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 127
- **ContentRow** — [apps/web/src/components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx):35. [components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx): 94
- **ContentTable** — [apps/web/src/components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx):90. [pages/content.tsx](../../apps/web/src/pages/content.tsx): 84
- **Pager** — [apps/web/src/design-system/patterns/collection.tsx](../../apps/web/src/design-system/patterns/collection.tsx). [Projects](../../apps/web/src/pages/content.tsx) and [Video exports](../../apps/web/src/pages/video.tsx).

**Screens:** [content-list-320](screenshots/content-list-320.png); [god-users-320](screenshots/god-users-320.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Library editor forms

**STANDARDIZE.** Inline/modal/full workspace forms differ in width, label association, footer action placement and loading/error contracts. Reuse existing Field/Input/Select/Button and VUI overlay ownership. Template previews require media geometry that ordinary settings forms do not.

**Current implementations and consumers:**

- **EntityEditor** — [apps/web/src/components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx):49. [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 170; [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 393
- **PresetEditor** — [apps/web/src/components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx):52. [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 278
- **MaterialEditor** — [apps/web/src/components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx):42. [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 341
- **TemplateFieldsEditor** — [apps/web/src/components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx):15. [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 272; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 184; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 578
- **TimelineTemplateEditorModal** — [apps/web/src/components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx):344. [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 149; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 786

**Screens:** [library-materials-create-1440](screenshots/library-materials-create-1440.png); [library-presets-create-1440](screenshots/library-presets-create-1440.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png); [reference-edit-1440](screenshots/reference-edit-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Destructive confirmation

**KEEP.** Named destructive target, busy/error feedback, cancellation and impact details are necessary. Keep separate instance/workspace/project authority. Shared visual chrome can standardize without collapsing safety or membership rules.

**Current implementations and consumers:**

- **DeleteConfirm** — [apps/web/src/components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx):488. [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 423
- **DeleteConfirm** — [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):69. [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 171
- **DangerPanel** — [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):256. [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 75
- **GodWorkspaceDetail** — [apps/web/src/components/admin/god-workspace-detail.tsx](../../apps/web/src/components/admin/god-workspace-detail.tsx):6. [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 82
- **ConfirmAction** — [apps/web/src/components/admin/confirm-action.tsx](../../apps/web/src/components/admin/confirm-action.tsx):7. [components/admin/god-user-detail.tsx](../../apps/web/src/components/admin/god-user-detail.tsx): 59, 74; [components/admin/god-workspace-detail.tsx](../../apps/web/src/components/admin/god-workspace-detail.tsx): 79, 80, 104
- **GodUserDetail** — [apps/web/src/components/admin/god-user-detail.tsx](../../apps/web/src/components/admin/god-user-detail.tsx):18. [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 81

**Screens:** [reference-delete-1440](screenshots/reference-delete-1440.png); [workspace-danger-320](screenshots/workspace-danger-320.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Labelled field composition

**STANDARDIZE.** F03. Visible micro-labels are not automatically associations. Explicit label/control relationships, hint/error ID links, validation and disabled/busy meaning belong to compositions, not only Input styles.

**Current implementations and consumers:**

- **Field** — [apps/web/src/design-system/components/field.tsx](../../apps/web/src/design-system/components/field.tsx):38. [components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx): 42, 46; [components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx): 113, 120, 123, 132, 134, 151; [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 256, 257, 259, 263, 264, 268; [components/editor/create-materials.tsx](../../apps/web/src/components/editor/create-materials.tsx): 56, 97, 99, 117; [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 193; [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 300, 306, 309, 312, 315, 318, 335, 338, 344, 347, 353, 358, 379, 382, 383, 384, 385, 626, 629, 632, 637, 640, 653, 665, 671, 694, 697; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 102, 108, 110, 116, 119, 122, 126, 142; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 333, 335, 336, 339, 340, 343, 344, 346, 347, 376, 378, 379, 384, 385; [components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx): 95, 111, 115, 126, 128, 139; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 159, 162, 174, 181, 183, 186, 188, 201; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 115, 163; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 547, 550, 551, 554; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 126, 189; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 119, 122, 126, 131, 132, 137, 139, 144, 146, 151, 154, 159, 160, 165, 168, 174, 175, 178, 313, 314, 317, 318, 342, 343, 357, 380, 436, 460; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 418, 432; `components/settings/image-provider-select.tsx` (deleted): 21, 36; [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 126, 132, 133, 136, 304, 309; [pages/invite.tsx](../../apps/web/src/pages/invite.tsx): 71, 79, 80, 90, 91, 102; [pages/sign-in.tsx](../../apps/web/src/pages/sign-in.tsx): 52, 60, 63, 73, 75, 88
- **ML** — [apps/web/src/design-system/components/field-label.tsx](../../apps/web/src/design-system/components/field-label.tsx):17. [components/editor/create-materials.tsx](../../apps/web/src/components/editor/create-materials.tsx): 58, 101; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 104, 112, 119, 122, 127; [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 106, 107, 108, 111, 112; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 333, 335, 336, 339, 340, 343, 344, 346, 348, 378, 379, 384, 385; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 324
- **LabelledInput** — [apps/web/src/components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx):38. [components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx): 41; [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 45, 46, 47
- **RailField** — [apps/web/src/components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx):188. [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 89, 99, 101, 102, 105, 110, 112, 123, 125, 129, 142, 144
- **Setup** — [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx):66. [components/editor/project-setup.tsx](../../apps/web/src/components/editor/project-setup.tsx): 106
- **DirectionFields** — [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):375. [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 294

**Screens:** [create-setup-1440](screenshots/create-setup-1440.png); [account-1440](screenshots/account-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Inspector property rows

**NEW_PATTERN.** F13. Candidate PropertyRow recipe should specify label/value/control/reset/hint/error and dense numeric/range editing. Field/Control already exist; define their composition before inventing a large universal inspector component.

**Current implementations and consumers:**

- **Control** — [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx):66. [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 140, 143; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 391, 392, 393, 437, 461, 462
- **ClipControls** — [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx):210. [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 85
- **TransformSection** — [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx):270. [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 332, 360, 371
- **RevealControls** — [apps/web/src/components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx):106. [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 320, 369
- **DurationField** — [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx):54. [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 339

**Screens:** [editor-clip-data-1440](screenshots/editor-clip-data-1440.png); [editor-data-style-1440](screenshots/editor-data-style-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Panel hierarchy and disclosure

**KEEP.** Panel, Section and Control are distinct containment tiers. Docked inspector is not a rail Panel child. Maleo and VUI AccordionSection share a name but not automatically a public ownership contract; no blind merge.

**Current implementations and consumers:**

- **Panel** — [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx):40. [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 587, 590, 593
- **Section** — [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx):56. [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 164, 189, 200, 206, 221, 257; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 68, 81, 83, 86, 87, 149, 151, 154
- **Control** — [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx):66. [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 140, 143; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 391, 392, 393, 437, 461, 462
- **AccordionSection** — [apps/web/src/components/timeline/inspector-section.tsx](../../apps/web/src/components/timeline/inspector-section.tsx):22. [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 266, 280, 294, 295, 300, 302, 305; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 546, 555, 575, 583, 584, 591, 592, 600, 601, 612, 613, 618; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 118, 186, 303, 304, 307, 312, 315, 316, 319, 328, 330, 339, 340, 345, 346, 349, 354, 356, 357, 363, 365, 367, 370, 374, 377, 379, 380, 383, 390, 394, 398, 402, 403, 409, 413, 415, 419, 421, 432, 434, 435, 438, 453, 458, 459, 463; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 542, 545, 548, 552, 555, 568, 571, 585, 588, 639, 642, 645
- **TimelinePanelHost** — [apps/web/src/components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx):134. [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 696
- **VuiInspectorRail** — [apps/web/src/components/editor-workspace/primitives.tsx](../../apps/web/src/components/editor-workspace/primitives.tsx):21. [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 544, 621; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 535, 648
- **AccordionSection** — [apps/web/src/components/editor-workspace/primitives.tsx](../../apps/web/src/components/editor-workspace/primitives.tsx):34. [components/timeline/inspector-section.tsx](../../apps/web/src/components/timeline/inspector-section.tsx): 20, 23

**Screens:** [editor-data-style-1440](screenshots/editor-data-style-1440.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Editor mode and local tabs

Elements category navigation uses the canonical `TabsList variant="bar"` beneath SearchField, with icon-free labels, underline selection and associated panels. Its defaults and creation actions remain feature-owned; keyboard behavior and appearance stay in Tabs.

**REFACTOR.** F05. True local tabs need roving focus and keyboard/panel association. Addressed destinations need navigation semantics; phone sheets/navigation are a different composition from desktop columns.

**Current implementations and consumers:**

- **TabsRoot** — [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx):9. [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 267, 289
- **TabsList** — [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx):13. [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 268, 271
- **TabsTab** — [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx):17. [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 269, 270
- **TabsPanel** — [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx):21. [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 278, 280, 281, 287
- **TimelinePhoneWorkspace** — [apps/web/src/components/timeline/timeline-phone-workspace.tsx](../../apps/web/src/components/timeline/timeline-phone-workspace.tsx):21. [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 680, 795
- **ModeTabs** — [apps/web/src/components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx):54. [components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx): 119

**Screens:** [editor-studio-1440](screenshots/editor-studio-1440.png); [editor-timeline-320](screenshots/editor-timeline-320.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Usage route selection

**REFACTOR.** F02. Route-addressed Balance/Activity/Transactions/Policy should not borrow incomplete local-tab behavior. Overflow exists on all four narrow sections; tables and selectors require separate containment.

**Current implementations and consumers:**

- **SettingsPage** — [apps/web/src/components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx):53. [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 29; [pages/settings.tsx](../../apps/web/src/pages/settings.tsx): 1
- **CreditsPanel** — [apps/web/src/components/settings/credits-panel.tsx](../../apps/web/src/components/settings/credits-panel.tsx):46. [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 91
- **GodModePage** — [apps/web/src/components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx):27. [app/app.tsx](../../apps/web/src/app/app.tsx): 264; [pages/god-mode.tsx](../../apps/web/src/pages/god-mode.tsx): 1

**Screens:** [settings-usage-320](screenshots/settings-usage-320.png); [god-usage-transactions-320](screenshots/god-usage-transactions-320.png); [god-usage-policy-320](screenshots/god-usage-policy-320.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Timeline, template and motion toolbars

**STANDARDIZE.** Different tools own different undo, selection, transport and export contexts. Standardize group/action/density chrome and keyboard discoverability; retain domain commands, timeline geometry and mobile studio control inventory.

**Current implementations and consumers:**

- **TemplateToolbar** — [apps/web/src/components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx):32. [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 657
- **TimelineToolbarFrame** — [apps/web/src/components/timeline/timeline-toolbar-frame.tsx](../../apps/web/src/components/timeline/timeline-toolbar-frame.tsx):28. [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 72, 83; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 41, 49; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 208, 229
- **MotionToolbar** — [apps/web/src/components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx):49. [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 624
- **TimelineBottomBar** — [apps/web/src/components/timeline/timeline-bottom-bar.tsx](../../apps/web/src/components/timeline/timeline-bottom-bar.tsx):27. [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 682
- **StudioActionBar** — [apps/web/src/components/timeline/studio-action-bar.tsx](../../apps/web/src/components/timeline/studio-action-bar.tsx):52. [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 506; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 482
- **TimelineToolbar** — [apps/web/src/components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx):25. [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 634
- **EditorTopbar** — [apps/web/src/components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx):76. [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 625

**Screens:** [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-studio-320](screenshots/editor-studio-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Transport and timecode

**KEEP.** Transport targets differ: domain renderer versus renderer-neutral VUI. Preserve playback authority and time precision. A shared play icon alone does not justify merging state stores.

**Current implementations and consumers:**

- **TransportPlay** — [apps/web/src/design-system/patterns/transport.tsx](../../apps/web/src/design-system/patterns/transport.tsx):30. [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 68; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 39; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 115
- **TransportTimecode** — [apps/web/src/design-system/patterns/transport.tsx](../../apps/web/src/design-system/patterns/transport.tsx):47. [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 68; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 39; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 116
- **VuiTransport** — [apps/web/src/components/editor-workspace/primitives.tsx](../../apps/web/src/components/editor-workspace/primitives.tsx):16. No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Screens:** [editor-timeline-1440](screenshots/editor-timeline-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Anchored popup lifecycle

**REFACTOR.** F06/F04. Timeline and WorkspaceSwitcher directly import Base Popover; labs/color use local positioning/state. Consolidate focus/dismissal/collision behavior through the existing shared authoring boundary. Nonmodal anchored popups differ from modal Sheet/Modal.

**Current implementations and consumers:**

- **AlphaColorControl** — [apps/web/src/design-system/components/color-control.tsx](../../apps/web/src/design-system/components/color-control.tsx):31. [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 200; [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 302; [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 248; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 172; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 329, 414
- **WorkspaceSwitcher** — [apps/web/src/components/workspace/workspace-switcher.tsx](../../apps/web/src/components/workspace/workspace-switcher.tsx):137. [app/app.tsx](../../apps/web/src/app/app.tsx): 371; [components/shell/app-sidebar.tsx](../../apps/web/src/components/shell/app-sidebar.tsx): 84; [pages/create-form.tsx](../../apps/web/src/pages/create-form.tsx): 55
- **OptionPopover** — [apps/web/src/components/speech/composer-options.tsx](../../apps/web/src/components/speech/composer-options.tsx):16. [components/speech/composer-options.tsx](../../apps/web/src/components/speech/composer-options.tsx): 30, 46, 56, 71
- **Popover** — [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):6. [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 39, 54, 113, 134
- **PopoverTrigger** — [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):10. [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 40, 44, 114, 116
- **PopoverContent** — [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):17. [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 45, 53, 117, 133
- **PopoverHeader** — [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):27. [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 46, 118
- **PopoverTitle** — [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):31. [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 46, 118

**Screens:** [color-control-open-1440](screenshots/color-control-open-1440.png); [image-lab-references-1440](screenshots/image-lab-references-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Menus and clip actions

**STANDARDIZE.** Base UI menu wrappers exist. Clip/header/export menus carry distinct action sets; standardize focus, dismissal, disabled labels and trigger chrome. ContextMenu is a candidate recipe only if pointer-context semantics are required; no new menu stack is authorized by this audit.

**Current implementations and consumers:**

- **Menu** — [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx):22. [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 37, 51
- **MenuItem** — [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx):47. [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 44, 47, 49
- **MenuLabel** — [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx):57. [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 38, 41
- **MenuSeparator** — [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx):61. [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 42, 46
- **TimelineClipBar** — [apps/web/src/components/timeline/timeline-clip-bar.tsx](../../apps/web/src/components/timeline/timeline-clip-bar.tsx):33. [components/timeline/timeline-bottom-bar.tsx](../../apps/web/src/components/timeline/timeline-bottom-bar.tsx): 16, 32
- **ExportMenu** — [apps/web/src/components/editor/export-menu.tsx](../../apps/web/src/components/editor/export-menu.tsx):35. [components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx): 121

**Screens:** [editor-timeline-1440](screenshots/editor-timeline-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Modal, sheet and lightbox

**KEEP.** VUI DOM owns modal/sheet/lightbox lifecycle. Maleo wrappers add product layout. Preserve nested dismiss/focus rules; F09 changes chrome, not ownership. Do not add Radix Dialog or a parallel Base UI modal stack.

**Current implementations and consumers:**

- **Sheet** — [apps/web/src/design-system/components/sheet.tsx](../../apps/web/src/design-system/components/sheet.tsx):107. [components/timeline/timeline-clip-bar.tsx](../../apps/web/src/components/timeline/timeline-clip-bar.tsx): 126, 139; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 552, 567; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 569, 579; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 213, 223
- **Modal** — [apps/web/src/design-system/components/modal.tsx](../../apps/web/src/design-system/components/modal.tsx):33. [components/catalog/material-assets.tsx](../../apps/web/src/components/catalog/material-assets.tsx): 221, 311; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 188, 204; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 50, 65, 77, 86; [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 790, 792; [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 104, 137; [components/editor/preset-picker.tsx](../../apps/web/src/components/editor/preset-picker.tsx): 38, 55, 85, 120; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 103, 229; [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 493, 510
- **Lightbox** — [apps/web/src/design-system/components/lightbox.tsx](../../apps/web/src/design-system/components/lightbox.tsx):9. [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 303; [design-system/components/frame.tsx](../../apps/web/src/design-system/components/frame.tsx): 96
- **EditModal** — [apps/web/src/components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx):264. [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 94, 119, 137, 176
- **MotionStudioModal** — [apps/web/src/components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx):64. [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 287
- **VuiSheet** — [apps/web/src/components/editor-workspace/sheet.tsx](../../apps/web/src/components/editor-workspace/sheet.tsx):6. [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 131, 139, 140, 144; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 66, 70; [react/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx): 188
- **VuiOverlay** — [apps/web/src/components/editor-workspace/overlay.tsx](../../apps/web/src/components/editor-workspace/overlay.tsx):16. [react/sheet.tsx](../../apps/web/src/components/editor-workspace/sheet.tsx): 7; [react/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx): 195

**Screens:** [reference-detail-1440](screenshots/reference-detail-1440.png); [library-templates-create-320](screenshots/library-templates-create-320.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Color and swatch editing

**REFACTOR.** F06/F10. Media color/alpha is editable content; popup trigger/actions/focus/placement are UI chrome. Retain react-colorful, avoid per-feature overlay lifecycle.

**Current implementations and consumers:**

- **AlphaColorControl** — [apps/web/src/design-system/components/color-control.tsx](../../apps/web/src/design-system/components/color-control.tsx):31. [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 200; [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 302; [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 248; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 172; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 329, 414
- **SwatchGroup** — [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):390. [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 326, 327
- **Swatch** — [apps/web/src/components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx):196. [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 160, 161, 162, 163, 164

**Screens:** [color-control-open-1440](screenshots/color-control-open-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## References, mentions and entity pickers

**STANDARDIZE.** Search, selected chips, empty groups and attachment provenance recur, but role/scoping rules differ. Standardize action names, limits/disabled reasons and selection feedback; preserve trusted project/workspace boundaries.

**Current implementations and consumers:**

- **SceneCastPicker** — [apps/web/src/components/references/scene-cast.tsx](../../apps/web/src/components/references/scene-cast.tsx):34. [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 280
- **VoicePicker** — [apps/web/src/components/references/panels.tsx](../../apps/web/src/components/references/panels.tsx):25. [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 348
- **ReferenceLibrary** — [apps/web/src/components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx):80. [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 766; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 227; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 501
- **PresetMaterialPicker** — [apps/web/src/components/catalog/preset-material-picker.tsx](../../apps/web/src/components/catalog/preset-material-picker.tsx):118. [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 160
- **MentionTextarea** — [apps/web/src/components/timeline/mention-textarea.tsx](../../apps/web/src/components/timeline/mention-textarea.tsx):42. [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 279; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 90; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 280; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 644
- **SceneReferenceChips** — [apps/web/src/components/timeline/scene-reference-chips.tsx](../../apps/web/src/components/timeline/scene-reference-chips.tsx):21. [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 309; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 153
- **StyleReferencePicker** — [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):708. [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 297

**Screens:** [image-lab-references-1440](screenshots/image-lab-references-1440.png); [reference-edit-1440](screenshots/reference-edit-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Materials and preset selection

**KEEP.** Project Materials and reusable preset bundles have separate meanings. Show inherited versus override state and reference reuse without flattening content ownership.

**Current implementations and consumers:**

- **PresetUsageLine** — [apps/web/src/components/catalog/preset-usage-line.tsx](../../apps/web/src/components/catalog/preset-usage-line.tsx):33. [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 317
- **ProjectMaterialsDrawer** — [apps/web/src/components/timeline/project-materials-drawer.tsx](../../apps/web/src/components/timeline/project-materials-drawer.tsx):76. [components/timeline/timeline-stage.tsx](../../apps/web/src/components/timeline/timeline-stage.tsx): 333
- **PresetPickerModal** — [apps/web/src/components/editor/preset-picker.tsx](../../apps/web/src/components/editor/preset-picker.tsx):22. [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 217; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 154
- **PresetOverrideWarning** — [apps/web/src/components/editor/preset-picker.tsx](../../apps/web/src/components/editor/preset-picker.tsx):80. [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 227
- **CreateMaterials** — [apps/web/src/components/editor/create-materials.tsx](../../apps/web/src/components/editor/create-materials.tsx):49. [components/editor/project-setup.tsx](../../apps/web/src/components/editor/project-setup.tsx): 115

**Screens:** [create-setup-320](screenshots/create-setup-320.png); [library-presets-1440](screenshots/library-presets-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Chat and generation composers

**STANDARDIZE.** F04/F15. Share explicit names, submit/newline/IME contract, attachment state and disabled reason. Chat, image and speech payloads and output layouts remain separate.

**Current implementations and consumers:**

- **PromptComposer** — [apps/web/src/components/image-lab/prompt-composer.tsx](../../apps/web/src/components/image-lab/prompt-composer.tsx):16. [pages/image-lab.tsx](../../apps/web/src/pages/image-lab.tsx): 58
- **TagsInput** — [apps/web/src/components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx):47. [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 108
- **TextProviderSelect** — [apps/web/src/components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx):69. [components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx): 196
- **ChatComposerBox** — [apps/web/src/components/editor/chat-composer-box.tsx](../../apps/web/src/components/editor/chat-composer-box.tsx):47. [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 401
- **SpeechLabPage** — [apps/web/src/pages/speech-lab.tsx](../../apps/web/src/pages/speech-lab.tsx):24. [app/app.tsx](../../apps/web/src/app/app.tsx): 390

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png); [image-lab-1440](screenshots/image-lab-1440.png); [speech-lab-1440](screenshots/speech-lab-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Agent run and output cards

**KEEP.** Thinking/progress/tool/output/error are meaningful states, not interchangeable cards. Classify chrome only after tracing newest frontier actions and settled/historical runs; current route capture is a settled authored fixture.

**Current implementations and consumers:**

- **RunResult** — [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):84. [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 186
- **RunView** — [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):151. [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 346
- **ThinkingCard** — [apps/web/src/components/editor/chat-run-cards.tsx](../../apps/web/src/components/editor/chat-run-cards.tsx):10. [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 57
- **WorkflowProgressCard** — [apps/web/src/components/editor/chat-run-cards.tsx](../../apps/web/src/components/editor/chat-run-cards.tsx):31. [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 58
- **LedgerCard** — [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx):122. [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 285
- **ToolRow** — [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx):143. [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 209
- **ResearchCard** — [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):26. [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 186
- **AgentErrorCard** — [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):45. [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 162
- **OutcomeCard** — [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):69. [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 161
- **ChatOutput** — [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):159. [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 176; [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 353

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Clarification and blocker forms

**KEEP.** Structured answers, credit limitation and trusted context have separate business contracts. Existing behavior tests cover more than one screenshot; no redesign or authority changes here.

**Current implementations and consumers:**

- **PinnedDecision** — [apps/web/src/components/editor/chat-pinned-decision.tsx](../../apps/web/src/components/editor/chat-pinned-decision.tsx):28. [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 376
- **SubmittedContext** — [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):46. [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 344
- **BlockerBatch** — [apps/web/src/components/editor/chat-blocker-batch.tsx](../../apps/web/src/components/editor/chat-blocker-batch.tsx):47. [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 389
- **CreditLimitCard** — [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):116. [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 399
- **ClarificationCard** — [apps/web/src/components/editor/chat-clarification-card.tsx](../../apps/web/src/components/editor/chat-clarification-card.tsx):111. [components/editor/chat-blocker-batch.tsx](../../apps/web/src/components/editor/chat-blocker-batch.tsx): 52; [components/editor/chat-pinned-decision.tsx](../../apps/web/src/components/editor/chat-pinned-decision.tsx): 36

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Audit and historical activity

**KEEP.** Audit trace, queued work and historical activity serve distinct purposes. Neutral/read-only settled history versus active frontier actions must remain visible in future state catalogue.

**Current implementations and consumers:**

- **QueueStatusPanel** — [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx):199. [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 315
- **ActivityItem** — [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):56. [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 174
- **RunActivity** — [apps/web/src/components/editor/chat-run-cards.tsx](../../apps/web/src/components/editor/chat-run-cards.tsx):60. [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 174
- **ChangeCard** — [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx):167. [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 279
- **AuditPanel** — [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx):218. [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 295; [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 257

**Screens:** [editor-audit-1440](screenshots/editor-audit-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Media frames and previews

**STANDARDIZE.** F09. Preserve crop/aspect/letterbox/playback/content colors. Standardize close/enlarge action names, shared chrome tokens, loading/failure and focus treatment. Duplicate Frame names have different contexts; merging requires contract review.

**Current implementations and consumers:**

- **AudioPreview** — [apps/web/src/design-system/components/audio-preview.tsx](../../apps/web/src/design-system/components/audio-preview.tsx):34. [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 213; [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 176; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 314; [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 183; [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 64; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 135; [design-system/components/audio-preview.tsx](../../apps/web/src/design-system/components/audio-preview.tsx): 74
- **Frame** — [apps/web/src/design-system/components/frame.tsx](../../apps/web/src/design-system/components/frame.tsx):37. [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 722, 741; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 263, 305, 310, 315, 320, 430, 434, 468; [components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx): 93, 96; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 107, 109; [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 233, 359; [components/references/scene-cast.tsx](../../apps/web/src/components/references/scene-cast.tsx): 97, 129; [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 220; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 174, 179
- **Lightbox** — [apps/web/src/design-system/components/lightbox.tsx](../../apps/web/src/design-system/components/lightbox.tsx):9. [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 303; [design-system/components/frame.tsx](../../apps/web/src/design-system/components/frame.tsx): 96
- **Frame** — [apps/web/src/components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx):106. [components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx): 240
- **MediaHoverPreview** — [apps/web/src/components/timeline/media/media-hover-preview.tsx](../../apps/web/src/components/timeline/media/media-hover-preview.tsx):70. [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 301; [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 208
- **VideoPoster** — [apps/web/src/components/timeline/media/media-thumb.tsx](../../apps/web/src/components/timeline/media/media-thumb.tsx):7. [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 306
- **VuiRemotionPreview** — [apps/web/src/components/timeline/remotion-preview.tsx](../../apps/web/src/components/timeline/remotion-preview.tsx):8. [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 530; [components/timeline/timeline-stage.tsx](../../apps/web/src/components/timeline/timeline-stage.tsx): 351; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 507

**Screens:** [library-references-1440](screenshots/library-references-1440.png); [reference-detail-1440](screenshots/reference-detail-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Empty, filtered-empty, loading and failure

**STANDARDIZE.** F07. EmptyState already has busy support. Different messages and async scopes are legitimate; contradictory empty-plus-error is not. Retry and status/alert announcements must describe the failed request, not imply no records.

**Current implementations and consumers:**

- **Toast** — [apps/web/src/app/toast.tsx](../../apps/web/src/app/toast.tsx):10. [app/app.tsx](../../apps/web/src/app/app.tsx): 343, 428
- **Note** — [apps/web/src/design-system/components/note.tsx](../../apps/web/src/design-system/components/note.tsx):36. [components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx): 108, 110, 148, 150, 156, 159, 161; [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 91, 107, 113; [components/settings/capability-column.tsx](../../apps/web/src/components/settings/capability-column.tsx): 20; [components/settings/env-table.tsx](../../apps/web/src/components/settings/env-table.tsx): 27; [components/settings/provider-list.tsx](../../apps/web/src/components/settings/provider-list.tsx): 31, 33; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 52, 60, 63, 76, 78, 143, 148, 150; [components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx): 143, 155, 159, 161, 163, 166, 171, 175, 182, 185, 194, 197, 208, 212, 222, 224, 233, 237, 241, 252, 257, 263, 265; [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 88; [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 172, 175, 205; [components/timeline/clip-frame-trim.tsx](../../apps/web/src/components/timeline/clip-frame-trim.tsx): 77; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 80; [components/timeline/scene-reference-chips.tsx](../../apps/web/src/components/timeline/scene-reference-chips.tsx): 51, 54, 60; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 305, 404; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 299; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 782
- **Callout** — [apps/web/src/design-system/components/note.tsx](../../apps/web/src/design-system/components/note.tsx):59. [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 683; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 151; [components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx): 155, 158, 162, 166, 202; [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 171; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 53; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 160; [components/timeline/motion/motion-editor.tsx](../../apps/web/src/components/timeline/motion/motion-editor.tsx): 326, 334; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 51, 54
- **Shimmer** — [apps/web/src/design-system/components/shimmer.tsx](../../apps/web/src/design-system/components/shimmer.tsx):9. [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 263, 306, 316, 431, 468; [components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx): 94; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 108; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 175; [components/timeline/timeline-base-lane.tsx](../../apps/web/src/components/timeline/timeline-base-lane.tsx): 111, 112, 132, 133
- **EmptyState** — [apps/web/src/design-system/patterns/collection.tsx](../../apps/web/src/design-system/patterns/collection.tsx):30. [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 372, 379; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 292; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 140, 146, 183; [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 111; [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 131, 133; [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 174, 180; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 163, 168; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 73, 78
- **FormOutcome** — [apps/web/src/components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx):29. [components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx): 47; [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 51, 94
- **ErrBar** — [apps/web/src/components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx):14. [components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx): 74

**Screens:** [templates-loading-320](screenshots/templates-loading-320.png); [templates-error-320](screenshots/templates-error-320.png); [images-320](screenshots/images-320.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Settings/provider readiness

**KEEP.** Readiness, provider setup, secret masking and account security are different state models. A matching row style cannot merge deployment administration with personal settings. Review empty/error and disabled permission states separately.

**Current implementations and consumers:**

- **ProviderSetup** — [apps/web/src/components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx):34. [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 97
- **CapabilitiesTab** — [apps/web/src/components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx):30. [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 108
- **SecurityPanel** — [apps/web/src/components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx):50. [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 99
- **EnvTable** — [apps/web/src/components/settings/env-table.tsx](../../apps/web/src/components/settings/env-table.tsx):18. [components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx): 266
- **StateDot** — [apps/web/src/components/settings/state-dot.tsx](../../apps/web/src/components/settings/state-dot.tsx):19. [components/settings/capability-column.tsx](../../apps/web/src/components/settings/capability-column.tsx): 31; [components/settings/provider-list.tsx](../../apps/web/src/components/settings/provider-list.tsx): 45; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 48
- **CapabilityColumn** — [apps/web/src/components/settings/capability-column.tsx](../../apps/web/src/components/settings/capability-column.tsx):13. [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 70
- **ProviderList** — [apps/web/src/components/settings/provider-list.tsx](../../apps/web/src/components/settings/provider-list.tsx):26. [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 85
- **SecurityPanel** — [apps/web/src/components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx):113. [pages/account.tsx](../../apps/web/src/pages/account.tsx): 28

**Screens:** [settings-capability-320](screenshots/settings-capability-320.png); [settings-provider-1440](screenshots/settings-provider-1440.png); [account-security-1440](screenshots/account-security-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Workspace and instance administration

**KEEP.** Instance ownership and workspace membership remain separate. Shared directory/form chrome is eligible for standardization; account suspension, final-owner guards and impact confirmation are behavior contracts, not redundant UI.

**Current implementations and consumers:**

- **WorkspaceManage** — [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):34. [pages/workspace.tsx](../../apps/web/src/pages/workspace.tsx): 18
- **GeneralPanel** — [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):84. [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 72
- **MembersPanel** — [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):147. [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 73
- **DangerPanel** — [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):256. [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 75
- **GodDirectory** — [apps/web/src/components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx):19. [components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx): 97
- **ProjectDetail** — [apps/web/src/components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx):124. [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 83
- **GodWorkspaceDetail** — [apps/web/src/components/admin/god-workspace-detail.tsx](../../apps/web/src/components/admin/god-workspace-detail.tsx):6. [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 82
- **GodUserDetail** — [apps/web/src/components/admin/god-user-detail.tsx](../../apps/web/src/components/admin/god-user-detail.tsx):18. [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 81
- **Authentication** — [apps/web/src/components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx):76. [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 21

**Screens:** [workspace-members-1440](screenshots/workspace-members-1440.png); [god-user-detail-1440](screenshots/god-user-detail-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Auth, invite and personal account

**KEEP.** First owner, signed-out sign-in, invitation validity and current-session settings are separate states. Captures use fake accounts/tokens; no live account mutation. Busy/failure submissions remain source/test evidence, not all captured states.

**Current implementations and consumers:**

- **AuthGate** — [apps/web/src/app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx):23. [app/main.tsx](../../apps/web/src/app/main.tsx): 9
- **PreferencesPanel** — [apps/web/src/components/account/preferences-panel.tsx](../../apps/web/src/components/account/preferences-panel.tsx):8. [pages/account.tsx](../../apps/web/src/pages/account.tsx): 29
- **PasswordForm** — [apps/web/src/components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx):10. [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 118
- **Sessions** — [apps/web/src/components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx):56. [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 120
- **ProfilePanel** — [apps/web/src/components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx):9. [pages/account.tsx](../../apps/web/src/pages/account.tsx): 27
- **InvitePage** — [apps/web/src/pages/invite.tsx](../../apps/web/src/pages/invite.tsx):20. [app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx): 48
- **SignInPage** — [apps/web/src/pages/sign-in.tsx](../../apps/web/src/pages/sign-in.tsx):21. [app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx): 54

**Screens:** [sign-in-320](screenshots/sign-in-320.png); [first-owner-1440](screenshots/first-owner-1440.png); [invitation-valid-320](screenshots/invitation-valid-320.png); [account-preferences-1440](screenshots/account-preferences-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Script density and action strip

**REFACTOR.** F17. Outline/Read/Write are addressed densities. All narrow screenshots overflow; fix composition/reflow before any primitive restyling. Preserve script hierarchy, editing and export/import paths.

**Current implementations and consumers:**

- **ScriptTable** — [apps/web/src/components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx):278. [components/script/script-view.tsx](../../apps/web/src/components/script/script-view.tsx): 259
- **ScriptView** — [apps/web/src/components/script/script-view.tsx](../../apps/web/src/components/script/script-view.tsx):52. [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 674
- **TextWorkspace** — [apps/web/src/components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx):37. [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 763

**Screens:** [script-outline-320](screenshots/script-outline-320.png); [script-read-320](screenshots/script-read-320.png); [script-write-320](screenshots/script-write-320.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Storyboard and scene authoring

**KEEP.** Story intent, storyboard, scene studio and rendered scene list are domain distinctions. Repeated card/header chrome can converge; scene identity, visual intent and edit semantics must remain traceable.

**Current implementations and consumers:**

- **BeatCard** — [apps/web/src/components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx):51. [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 245
- **StoryboardSurface** — [apps/web/src/components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx):203. [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 261
- **StoryboardView** — [apps/web/src/components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx):254. [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 667
- **SceneEditorDrawer** — [apps/web/src/components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx):45. [components/timeline/timeline-scene-drawer.tsx](../../apps/web/src/components/timeline/timeline-scene-drawer.tsx): 17, 37
- **StoryboardView** — [apps/web/src/components/editor/storyboard-export.tsx](../../apps/web/src/components/editor/storyboard-export.tsx):55. [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 395
- **SceneStudio** — [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx):84. [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 718, 739
- **SceneBoard** — [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx):419. [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 392
- **SceneList** — [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx):450. [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 393

**Screens:** [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-studio-1440](screenshots/editor-studio-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Timeline clips, lanes and drag geometry

**KEEP.** Position, duration, track, zoom, gesture, snap and virtualization are data/geometry. Audit app chrome around them without replacing the renderer-neutral edit/gesture engine. Coarse-pointer behavior is exercised by the existing mobile suite.

**Current implementations and consumers:**

- **TimelineBaseLane** — [apps/web/src/components/timeline/timeline-base-lane.tsx](../../apps/web/src/components/timeline/timeline-base-lane.tsx):47. [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 727
- **ClipRange** — [apps/web/src/components/timeline/clip-range.tsx](../../apps/web/src/components/timeline/clip-range.tsx):67. [components/timeline/clip-range.tsx](../../apps/web/src/components/timeline/clip-range.tsx): 67; [components/timeline/timeline-base-lane.tsx](../../apps/web/src/components/timeline/timeline-base-lane.tsx): 90; [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 197
- **TimelineTracks** — [apps/web/src/components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx):212. [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 761
- **FreeClipRange** — [apps/web/src/components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx):186. [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 226, 251, 327
- **TimelineLane** — [apps/web/src/components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx):383. [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 383; [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 746
- **TimelineClipInspector** — [apps/web/src/components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx):211. [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 208, 566
- **TimelineClipInspectorSheet** — [apps/web/src/components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx):539. [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 774

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Editor workspace composition

**KEEP.** The composition the three editors share, owned by the app in `components/editor-workspace` since `migrate-editor-to-shared-rust-core` moved it out of `@maleo/vui`. It is no longer a public package API, so a component here with no production consumer is dead code rather than reserved surface; the components it listed without a production reference (the workspace shell, inspector, status, preview frame, timecode, renderer transport and timeline view) were deleted in that change's task 3.7.

**Current implementations and consumers:**

- **VuiKeyboardScope** — [apps/web/src/components/editor-workspace/keyboard-scope.tsx](../../apps/web/src/components/editor-workspace/keyboard-scope.tsx):33. [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 497, 746; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 473, 739
- **WorkspaceSurface** — [apps/web/src/components/editor-workspace/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx):146. [react/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx): 194, 195
- **VuiEditorWorkspace** — [apps/web/src/components/editor-workspace/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx):191. [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 498; [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 723; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 474

**Screens:** [editor-timeline-1440](screenshots/editor-timeline-1440.png)

**State review:** default and captured state are evidence only. Apply loading/empty/filtered-empty/error, disabled/busy, selected/open, focus/keyboard, narrow/coarse-pointer and theme criteria when relevant. Domain-specific tests remain authority for behavior.

## Suggested shared composition targets

| Existing usage | Problem | Proposed target | Classification |
|---|---|
| Existing Button variants plus sb-item page actions | Action role and density depend on borrowed local styles | Existing Button / IconButton | STANDARDIZE |
| PageHeader, LibraryHeader, ColumnHead, local panel headers | Title/actions/close/state hierarchy lacks one documented panel recipe | PanelHeader recipe around existing Panel/Section | NEW_PATTERN |
| Clip/data/motion/settings control rows | Label/value/control/hint/reset composition varies | PropertyRow recipe around Field/Control | NEW_PATTERN |
| Image composer and chat actions | Icon names, disabled feedback and popup behavior differ | Existing IconButton plus composer recipe | STANDARDIZE |
| Timeline/export/menu and popup variants | Dismissal/focus/action grouping differ | Existing Menu and anchored popup contract; ContextMenu only when needed | REFACTOR |
| Per-feature empty/error/loading screens | Request failure sometimes masquerades as empty records | Existing EmptyState, Callout, Shimmer and retry recipe | STANDARDIZE |
| Content/Library/gallery toolbar chrome | Similar questions rendered through unrelated control arrangements | Shared search/adornment/filter recipes | MERGE |

These are audit dispositions, not approved APIs. Avoid a single universal Toolbar or Inspector with every domain prop. Define smallest repeated recipe and verify its real consumers first.
