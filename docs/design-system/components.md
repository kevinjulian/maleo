# Component inventory

**Terminology:** “component” in this source inventory means a JSX-bearing definition, not necessarily a design-system primitive. [Component versus pattern](principles.md#component-versus-pattern) classifies controls separately from Maleo task compositions. Pattern implementations such as EmptyState remain in this inventory; their source location does not make them primitive controls or approved patterns.

Audit snapshot: 2026-10-01, source `9c21b786cb852e445f782ece9d288f55f726f967`. The import evidence below is as of that snapshot: `@maleo/vui/dom`, `/media`, `/react` and `/remotion` have since moved into `apps/web` (`controllers/`, `services/`, `components/editor-workspace/`, `hooks/editor-workspace/`; OpenSpec `migrate-editor-to-shared-rust-core`). File links point at the current locations; the kernel's host half moved to `apps/web/src/models/timeline-view/` and the rest retired with the package in task 4.10. 347 JSX-bearing component definitions across 549 non-test source modules in `apps/web/src` and `packages/vui/src`. Glyph object catalogues are listed separately. This is the current inventory, not an approved kit.

Read [audit.md](audit.md) for ranked findings, [patterns.md](patterns.md) for composition families, and [foundations.md](foundations.md) for styles. The source inventory (private historical record) records complete props, resolved references, JSX compositions, native controls, ARIA/state signals, inline styles, CSS-class candidates, recipe constants, and module-level primitive imports.

## Reading the evidence

- **KEEP** means provisional retention of current implementation, not reviewed approval. Other classifications identify a specific proposed action.
- Consumers include resolved JSX references, calls, and component-valued expressions. An unused import is not a consumer. Public VUI imports bridge generated declaration paths.
- Primitive paths below are direct module imports plus reachable local wrapper imports. Module imports can serve sibling definitions; the JSON keeps the composition graph so this is not mistaken for exact per-function ownership. Native HTML and VUI mechanisms are intentional alternatives.
- Variant fields describe the current typed API, including inherited HTML/ARIA state props; they are not a new design decision. Raw arbitrary utilities are module evidence. Recipe constants and inline styles remain in the JSON.
- Screenshot associations require a unique component name observed mounted in React. A route image does not prove all variants, transient states, focus, geometry, or asynchronous behavior. Ambiguous names remain explicitly uncaptured.

## Shared controls at a glance

| Component           | Current variants/state API                                                                                                                                                                                    | Primitive/import evidence                                                       | Production reference locations | Disposition |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -----------------------------: | ----------- |
| Note                | tone: "muted" \| "warn" \| "plain" \| "error" \| undefined; as: "p" \| "span" \| "div" \| undefined                                                                                                           | Native HTML / local composition; see definition                                 |                             58 | KEEP        |
| Callout             | tone: "warn" \| "error" \| "info" \| undefined; as: "p" \| "div" \| undefined                                                                                                                                 | Native HTML / local composition; see definition                                 |                             14 | KEEP        |
| TabsRoot            | See HTML/props contract                                                                                                                                                                                       | @base-ui/react/tabs                                                             |                              2 | KEEP        |
| TabsList            | See HTML/props contract                                                                                                                                                                                       | @base-ui/react/tabs                                                             |                              2 | KEEP        |
| TabsTab             | disabled: boolean \| undefined                                                                                                                                                                                | @base-ui/react/tabs                                                             |                              2 | KEEP        |
| TabsPanel           | See HTML/props contract                                                                                                                                                                                       | @base-ui/react/tabs                                                             |                              4 | KEEP        |
| AudioPreview        | See HTML/props contract                                                                                                                                                                                       | Native HTML / local composition; see definition                                 |                              7 | KEEP        |
| AlphaColorControl   | compact: boolean \| undefined                                                                                                                                                                                 | react-colorful                                                                  |                             10 | REFACTOR    |
| Sheet               | open: boolean; size: string \| undefined                                                                                                                                                                      | @maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)                        |                              8 | KEEP        |
| Field               | as: "span" \| "div" \| "label" \| undefined                                                                                                                                                                   | Native HTML / local composition; see definition                                 |                            158 | KEEP        |
| Shimmer             | See HTML/props contract                                                                                                                                                                                       | Native HTML / local composition; see definition                                 |                             12 | KEEP        |
| Chip                | variant: "tag" \| "inline" \| undefined; tone: "ok" \| "err" \| "warn" \| "plain" \| "info" \| "accent" \| undefined; on: boolean \| undefined; as: "span" \| "div" \| "label" \| undefined                   | Native HTML / local composition; see definition                                 |                             33 | KEEP        |
| ChipButton          | disabled: boolean \| undefined; variant: "tag" \| "inline" \| undefined; on: boolean \| undefined                                                                                                             | Native HTML / local composition; see definition                                 |                              5 | KEEP        |
| Switch              | disabled: boolean \| undefined                                                                                                                                                                                | @base-ui/react/switch                                                           |                              1 | KEEP        |
| IconButton          | disabled: boolean \| undefined; size: "sm" \| "xs" \| "default" \| "micro" \| undefined; on: boolean \| undefined                                                                                             | @base-ui/react/button                                                           |                             88 | KEEP        |
| Panel               | sheet: boolean \| undefined; as: "div" \| "aside" \| undefined                                                                                                                                                | Native HTML / local composition; see definition                                 |                              3 | KEEP        |
| Section             | as: "div" \| "section" \| undefined                                                                                                                                                                           | Native HTML / local composition; see definition                                 |                             14 | KEEP        |
| Control             | as: "div" \| "label" \| undefined                                                                                                                                                                             | Native HTML / local composition; see definition                                 |                             12 | NEW_PATTERN |
| Avatar              | See HTML/props contract                                                                                                                                                                                       | Native HTML / local composition; see definition                                 |                              1 | KEEP        |
| ML                  | See HTML/props contract                                                                                                                                                                                       | Native HTML / local composition; see definition                                 |                             40 | KEEP        |
| Menu                | See HTML/props contract                                                                                                                                                                                       | @base-ui/react/menu                                                             |                              2 | KEEP        |
| MenuItem            | disabled: boolean \| undefined                                                                                                                                                                                | @base-ui/react/menu                                                             |                              3 | KEEP        |
| MenuLabel           | See HTML/props contract                                                                                                                                                                                       | @base-ui/react/menu                                                             |                              2 | KEEP        |
| MenuSeparator       | See HTML/props contract                                                                                                                                                                                       | @base-ui/react/menu                                                             |                              2 | KEEP        |
| Button              | disabled: boolean \| undefined; variant: "default" \| "dark" \| "light" \| "ghost" \| "ai" \| "danger" \| "primary" \| "segment" \| "bare" \| null \| undefined; size: "sm" \| "default" \| null \| undefined | @base-ui/react/button                                                           |                            216 | KEEP        |
| ButtonLink          | variant: "default" \| "dark" \| "light" \| "ghost" \| "ai" \| "danger" \| "primary" \| "segment" \| "bare" \| null \| undefined; size: "sm" \| "default" \| null \| undefined                                 | @base-ui/react/button                                                           |                              2 | KEEP        |
| ButtonLabel         | variant: "default" \| "dark" \| "light" \| "ghost" \| "ai" \| "danger" \| "primary" \| "segment" \| "bare" \| null \| undefined; size: "sm" \| "default" \| null \| undefined                                 | @base-ui/react/button                                                           |                              2 | KEEP        |
| Modal               | width: number \| undefined                                                                                                                                                                                    | @maleo/vui/dom (overlay lifecycle; Maleo layout wrapper), @base-ui/react/button |                             20 | KEEP        |
| Page                | width: "default" \| "narrow" \| undefined                                                                                                                                                                     | Native HTML / local composition; see definition                                 |                             10 | KEEP        |
| PageTitle           | level: PageTitleLevel \| undefined                                                                                                                                                                            | Native HTML / local composition; see definition                                 |                              6 | KEEP        |
| PageHeader          | See HTML/props contract                                                                                                                                                                                       | Native HTML / local composition; see definition                                 |                              7 | KEEP        |
| ThemeToggle         | See HTML/props contract                                                                                                                                                                                       | Native HTML / local composition; see definition                                 |                              1 | KEEP        |
| Checkbox            | disabled: boolean \| undefined                                                                                                                                                                                | @base-ui/react/checkbox                                                         |                              1 | KEEP        |
| EmptyState          | busy: boolean \| undefined                                                                                                                                                                                    | Native HTML / local composition; see definition                                 |                             15 | KEEP        |
| Select              | disabled: boolean \| undefined; size: number \| undefined; width: "auto" \| "full" \| null \| undefined                                                                                                       | Native HTML / local composition; see definition                                 |                             85 | KEEP        |
| ExpandGlyph         | See HTML/props contract                                                                                                                                                                                       | Native HTML / local composition; see definition                                 |                              1 | KEEP        |
| Frame               | fit: "cover" \| "contain" \| undefined                                                                                                                                                                        | @maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)                        |                             21 | KEEP        |
| Input               | disabled: boolean \| undefined; size: number \| undefined; width: string \| number \| undefined; variant: "default" \| "standard" \| undefined                                                                | @base-ui/react/input                                                            |                             92 | KEEP        |
| Textarea            | disabled: boolean \| undefined; variant: "default" \| "standard" \| undefined                                                                                                                                 | @base-ui/react/input                                                            |                             22 | KEEP        |
| SelectInput         | disabled: boolean \| undefined; size: number \| undefined; variant: "default" \| "standard" \| undefined                                                                                                      | @base-ui/react/input                                                            |                              6 | KEEP        |
| ImageProviderSelect | busy: boolean; width: "auto" \| "full" \| undefined                                                                                                                                                           | Native HTML / local composition; see definition                                 |                              0 | REMOVE      |
| Lightbox            | See HTML/props contract                                                                                                                                                                                       | @maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)                        |                              2 | STANDARDIZE |

## Complete definitions

### AudioPreview — design-system/components/audio-preview.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/audio-preview.tsx](../../apps/web/src/design-system/components/audio-preview.tsx):34. Category: shared component.

**Usages:** [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 213; [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 176; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 314; [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 183; [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 64; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 135; [design-system/components/audio-preview.tsx](../../apps/web/src/design-system/components/audio-preview.tsx): 74

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 2 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AudioPreview

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Avatar — design-system/components/avatar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/avatar.tsx](../../apps/web/src/design-system/components/avatar.tsx):13. Category: shared component.

**Usages:** [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 37

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Avatar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 90 associations in JSON.

### Button — design-system/components/button.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/button.tsx](../../apps/web/src/design-system/components/button.tsx):62. Category: shared component.

**Usages:** [components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx): 43, 45; [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 49, 89, 91; [components/catalog/material-assets.tsx](../../apps/web/src/components/catalog/material-assets.tsx): 257, 259, 260, 305, 306; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 62, 63, 82, 83; [components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx): 100, 102, 164, 166, 167, 169; [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 225, 227, 277, 278, 363; [components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx): 90, 130, 132; [components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx): 127, 131; [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 138, 148, 154, 191, 194; [components/editor/chat-composer-box.tsx](../../apps/web/src/components/editor/chat-composer-box.tsx): 130, 131; [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 216; [components/editor/chat-pinned-decision.tsx](../../apps/web/src/components/editor/chat-pinned-decision.tsx): 31, 47, 50, 52, 53; [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 96, 97, 112, 113, 143, 144, 145, 146, 147; [components/editor/chat-story-plan.tsx](../../apps/web/src/components/editor/chat-story-plan.tsx): 134; [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 652; [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 92, 94, 108, 110; [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 327; [components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx): 59, 60, 61, 62, 70, 72, 106, 131; [components/editor/export-menu.tsx](../../apps/web/src/components/editor/export-menu.tsx): 43, 52; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 148, 149, 317, 318; [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 128, 129, 133, 134; [components/editor/storyboard-export.tsx](../../apps/web/src/components/editor/storyboard-export.tsx): 110, 112, 127, 129; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 269, 327; [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 129, 131, 216, 218, 246, 248, 250, 252, 253, 255; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 135, 137, 151, 153, 223, 225, 226; [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 260, 261, 506, 507; [components/settings/credits-panel.tsx](../../apps/web/src/components/settings/credits-panel.tsx): 65; [components/settings/env-table.tsx](../../apps/web/src/components/settings/env-table.tsx): 47, 54, 76, 78, 79, 81; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 64, 71, 171, 173, 174, 181, 183, 185, 204, 216; [components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx): 179, 181, 213, 215, 219, 221; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 120, 122, 226, 228; [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 164, 167, 183, 184, 185, 186, 187, 188, 189, 192, 208, 209, 223, 229, 238, 239, 240, 241; [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 226, 304; [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 152; [components/timeline/motion/motion-editor.tsx](../../apps/web/src/components/timeline/motion/motion-editor.tsx): 67, 78, 80, 207, 213, 242, 247, 249, 341; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 517, 563, 571, 572, 742, 743; [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 74; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 140; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 306, 407, 422, 439, 464, 516, 517; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 330; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 498, 735, 736, 767; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 122; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 84, 89; [components/timeline/timeline-transport.tsx](../../apps/web/src/design-system/patterns/transport.tsx): 32, 40; [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 138, 140, 191, 197, 215, 221, 230, 232, 244, 246, 310, 312; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 43, 45, 53; [pages/invite.tsx](../../apps/web/src/pages/invite.tsx): 46, 48, 112, 114; [pages/sign-in.tsx](../../apps/web/src/pages/sign-in.tsx): 97, 99

**Primitive evidence:** `@base-ui/react/button`

**Variants:** `disabled: boolean | undefined`; `variant: "default" | "dark" | "light" | "ghost" | "ai" | "danger" | "primary" | "segment" | "bare" | null | undefined`; `size: "sm" | "default" | null | undefined`

**Styling:** `tw:px-[11px]` (module line 39; literal); `tw:py-[5px]` (module line 39; literal); `tw:tracking-[-0.01em]` (module line 43; literal); `tw:min-h-[var(--control-h)]` (module line 44; token-backed); `tw:min-h-[var(--control-h-sm)]` (module line 45; token-backed); `tw:px-[11px]` (module line 45; literal); `tw:py-[7px]` (module line 45; literal) 0 inline style attribute(s); 5 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Button

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 72 associations in JSON.

### ButtonLink — design-system/components/button.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/button.tsx](../../apps/web/src/design-system/components/button.tsx):72. Category: shared component.

**Usages:** [components/video/export-details.tsx](../../apps/web/src/components/video/export-details.tsx); [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx); [components/editor/caption-generate-form.tsx](../../apps/web/src/components/editor/caption-generate-form.tsx)

**Primitive evidence:** `@base-ui/react/button`

**Variants:** `variant: "default" | "dark" | "light" | "ghost" | "ai" | "danger" | "primary" | "segment" | "bare" | null | undefined`; `size: "sm" | "default" | null | undefined`

**Styling:** `tw:px-[11px]` (module line 39; literal); `tw:py-[5px]` (module line 39; literal); `tw:tracking-[-0.01em]` (module line 43; literal); `tw:min-h-[var(--control-h)]` (module line 44; token-backed); `tw:min-h-[var(--control-h-sm)]` (module line 45; token-backed); `tw:px-[11px]` (module line 45; literal); `tw:py-[7px]` (module line 45; literal) 0 inline style attribute(s); 5 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ButtonLink

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [video-320](screenshots/video-320.png); [video-1440](screenshots/video-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ButtonLabel — design-system/components/button.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/button.tsx](../../apps/web/src/design-system/components/button.tsx):81. Category: shared component.

**Usages:** [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 102, 105

**Primitive evidence:** `@base-ui/react/button`

**Variants:** `variant: "default" | "dark" | "light" | "ghost" | "ai" | "danger" | "primary" | "segment" | "bare" | null | undefined`; `size: "sm" | "default" | null | undefined`

**Styling:** `tw:px-[11px]` (module line 39; literal); `tw:py-[5px]` (module line 39; literal); `tw:tracking-[-0.01em]` (module line 43; literal); `tw:min-h-[var(--control-h)]` (module line 44; token-backed); `tw:min-h-[var(--control-h-sm)]` (module line 45; token-backed); `tw:px-[11px]` (module line 45; literal); `tw:py-[7px]` (module line 45; literal) 0 inline style attribute(s); 5 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ButtonLabel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Checkbox — design-system/components/checkbox.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/checkbox.tsx](../../apps/web/src/design-system/components/checkbox.tsx):7. Category: shared component.

**Usages:** [components/editor/preset-picker.tsx](../../apps/web/src/components/editor/preset-picker.tsx): 102

**Primitive evidence:** `@base-ui/react/checkbox`

**Variants:** `disabled: boolean | undefined`

**Styling:** `tw:rounded-[4px]` (module line 13; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Checkbox

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Chip — design-system/components/chip.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/chip.tsx](../../apps/web/src/design-system/components/chip.tsx):79. Category: shared component.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 47; [components/catalog/library-chrome.tsx](../../apps/web/src/components/catalog/library-chrome.tsx): 37; [components/catalog/material-assets.tsx](../../apps/web/src/components/catalog/material-assets.tsx): 216; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 311, 312; [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 126; [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 166, 167; [components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx): 57; [components/editor/create-materials.tsx](../../apps/web/src/components/editor/create-materials.tsx): 72; [components/editor/render-status-body.tsx](../../apps/web/src/components/editor/render-status-body.tsx): 21; [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 127; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 118; [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 89, 90, 139, 169, 218; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 108, 140, 151, 171, 173, 204, 206, 209, 211, 217; [components/timeline/project-materials-drawer.tsx](../../apps/web/src/components/timeline/project-materials-drawer.tsx): 268, 298, 340; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 41

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `variant: "tag" | "inline" | undefined`; `tone: "ok" | "err" | "warn" | "plain" | "info" | "accent" | undefined`; `on: boolean | undefined`; `as: "span" | "div" | "label" | undefined`

**Styling:** `tw:bg-[var(--chip-bg,var(--surface-tint))]` (module line 49; token-backed); `tw:px-[9px]` (module line 49; literal); `tw:py-[3px]` (module line 49; literal); `tw:font-[var(--font-mono)]` (module line 49; token-backed); `tw:text-[10px]` (module line 49; literal); `tw:tracking-[0.06em]` (module line 49; literal); `tw:text-[var(--chip-fg,var(--muted))]` (module line 49; token-backed) 0 inline style attribute(s); 2 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Chip", "ids": ["components/catalog/chip.tsx#Chip", "apps/web/src/components/editor/launcher.tsx#Chip"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Chip

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ChipButton — design-system/components/chip.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/chip.tsx](../../apps/web/src/design-system/components/chip.tsx):101. Category: shared component.

**Usages:** [components/research/source-links.tsx](../../apps/web/src/components/research/source-links.tsx): 35, 37; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 218, 219, 220

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `disabled: boolean | undefined`; `variant: "tag" | "inline" | undefined`; `on: boolean | undefined`

**Styling:** `tw:bg-[var(--chip-bg,var(--surface-tint))]` (module line 49; token-backed); `tw:px-[9px]` (module line 49; literal); `tw:py-[3px]` (module line 49; literal); `tw:font-[var(--font-mono)]` (module line 49; token-backed); `tw:text-[10px]` (module line 49; literal); `tw:tracking-[0.06em]` (module line 49; literal); `tw:text-[var(--chip-fg,var(--muted))]` (module line 49; token-backed) 0 inline style attribute(s); 2 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ChipButton

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### EmptyState — design-system/patterns/collection.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/patterns/collection.tsx](../../apps/web/src/design-system/patterns/collection.tsx):30. Category: shared component.

**Usages:** [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 372, 379; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 292; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 140, 146, 183; [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 111; [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 131, 133; [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 174, 180; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 163, 168; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 73, 78

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `busy: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** EmptyState + Callout / retry recipe ([M07](audit.md#m07))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [images-320](screenshots/images-320.png); [images-1440](screenshots/images-1440.png); [speech-320](screenshots/speech-320.png); [speech-1440](screenshots/speech-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### AlphaColorControl — design-system/components/color-control.tsx

**REFACTOR** — Finding F06 Source: [apps/web/src/design-system/components/color-control.tsx](../../apps/web/src/design-system/components/color-control.tsx):31. Category: shared component.

**Usages:** [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 200; [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 302; [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 248; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 172; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 329, 414

**Primitive evidence:** `react-colorful`

**Variants:** `compact: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F06](audit.md#f06).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** The shared control implements fixed placement, resize and scroll listeners itself. Outside click leaves it open. Escape also leaves the popup open in the stable styled capture. Styling remains owned by timeline/stage.css.

**Recommended canonical component/pattern:** AlphaColorControl + canonical anchored popup lifecycle ([M11](audit.md#m11))

**Action:** REFACTOR. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-data-style-320](screenshots/editor-data-style-320.png); [editor-data-style-1440](screenshots/editor-data-style-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Field — design-system/components/field.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/field.tsx](../../apps/web/src/design-system/components/field.tsx):38. Category: shared component.

**Usages:** [components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx): 42, 46; [components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx): 113, 120, 123, 132, 134, 151; [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 256, 257, 259, 263, 264, 268; [components/editor/create-materials.tsx](../../apps/web/src/components/editor/create-materials.tsx): 56, 97, 99, 117; [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 193; [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 300, 306, 309, 312, 315, 318, 335, 338, 344, 347, 353, 358, 379, 382, 383, 384, 385, 626, 629, 632, 637, 640, 653, 665, 671, 694, 697; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 102, 108, 110, 116, 119, 122, 126, 142; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 333, 335, 336, 339, 340, 343, 344, 346, 347, 376, 378, 379, 384, 385; [components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx): 95, 111, 115, 126, 128, 139; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 159, 162, 174, 181, 183, 186, 188, 201; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 115, 163; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 547, 550, 551, 554; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 126, 189; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 119, 122, 126, 131, 132, 137, 139, 144, 146, 151, 154, 159, 160, 165, 168, 174, 175, 178, 313, 314, 317, 318, 342, 343, 357, 380, 436, 460; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 418, 432; `components/settings/image-provider-select.tsx` (deleted): 21, 36; [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 126, 132, 133, 136, 304, 309; [pages/invite.tsx](../../apps/web/src/pages/invite.tsx): 71, 79, 80, 90, 91, 102; [pages/sign-in.tsx](../../apps/web/src/pages/sign-in.tsx): 52, 60, 63, 73, 75, 88

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `as: "span" | "div" | "label" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PropertyRow recipe over Field / Control ([M02](audit.md#m02))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ExpandGlyph — design-system/components/frame.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/frame.tsx](../../apps/web/src/design-system/components/frame.tsx):10. Category: shared component.

**Usages:** [design-system/components/frame.tsx](../../apps/web/src/design-system/components/frame.tsx): 87

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ExpandGlyph

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-studio-320](screenshots/editor-studio-320.png); [editor-studio-1440](screenshots/editor-studio-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Frame — design-system/components/frame.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/frame.tsx](../../apps/web/src/design-system/components/frame.tsx):37. Category: shared component.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 722, 741; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 263, 305, 310, 315, 320, 430, 434, 468; [components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx): 93, 96; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 107, 109; [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 233, 359; [components/references/scene-cast.tsx](../../apps/web/src/components/references/scene-cast.tsx): 97, 129; [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 220; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 174, 179

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`

**Variants:** `fit: "cover" | "contain" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 6 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Frame / Lightbox + IconButton + semantic tokens ([M13](audit.md#m13))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### IconButton — design-system/components/icon-button.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/icon-button.tsx](../../apps/web/src/design-system/components/icon-button.tsx):47. Category: shared component.

**Usages:** [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 172, 179; [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 254; [components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx): 87, 133; [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 246, 247; [components/editor/chat-composer-box.tsx](../../apps/web/src/components/editor/chat-composer-box.tsx): 138, 147, 194; [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 645; [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 80; [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 298, 299; [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 208, 304, 569, 724; [components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx): 83; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 254, 296, 297, 298, 299; [components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx): 18, 104; [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 270; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 270; [components/timeline/elements-panel.tsx](../../apps/web/src/components/timeline/elements-panel.tsx): 81; [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 251; [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 138; [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 67, 89, 97, 113, 121; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 64; [components/timeline/studio-action-bar.tsx](../../apps/web/src/components/timeline/studio-action-bar.tsx): 73, 85, 94, 104; [components/timeline/studio-heading.tsx](../../apps/web/src/components/timeline/studio-heading.tsx): 30, 32; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 38, 52, 60; [components/timeline/timeline-clip-bar.tsx](../../apps/web/src/components/timeline/timeline-clip-bar.tsx): 129; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 491, 493, 504, 506; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 208, 276, 311; [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 676; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 472; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 765, 779; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 70, 71, 75, 77, 79, 90, 107, 110, 145, 147, 148, 149, 150, 153, 155, 189, 191, 192, 196, 199, 201, 211, 216; [design-system/components/modal.tsx](../../apps/web/src/design-system/components/modal.tsx): 50; [pages/create-form.tsx](../../apps/web/src/pages/create-form.tsx): 53

**Primitive evidence:** `@base-ui/react/button`

**Variants:** `disabled: boolean | undefined`; `size: "sm" | "xs" | "default" | "micro" | undefined`; `on: boolean | undefined`

**Styling:** `tw:size-[var(--control-h)]` (module line 22; token-backed); `tw:size-[var(--control-h-xs)]` (module line 22; token-backed); `tw:size-[var(--control-h-xs)]` (module line 22; token-backed) 0 inline style attribute(s); 3 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** IconButton

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png); [create-setup-320](screenshots/create-setup-320.png); [create-setup-1440](screenshots/create-setup-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 29 associations in JSON.

### Input — design-system/components/input.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/input.tsx](../../apps/web/src/design-system/components/input.tsx):34. Category: shared component.

**Usages:** [components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx): 44; [components/catalog/library-toolbar.tsx](../../apps/web/src/components/catalog/library-toolbar.tsx): 118; [components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx): 125, 136; [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 256, 257, 355; [components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx): 39, 55, 79; [components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx): 72; [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 139; [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 303, 311, 317, 324, 383, 384, 385; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 107; [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 59, 106, 111, 112; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 62, 333, 344, 378, 379; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 161, 185; [components/settings/env-table.tsx](../../apps/web/src/components/settings/env-table.tsx): 62; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 129; [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 163, 236; [components/timeline/elements-panel.tsx](../../apps/web/src/components/timeline/elements-panel.tsx): 93; [components/timeline/motion/motion-editor.tsx](../../apps/web/src/components/timeline/motion/motion-editor.tsx): 216, 217, 218, 219, 234, 312; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 425, 442, 549, 553, 615, 616; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 125, 144; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 177, 317, 318, 357, 380, 406, 436; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 328; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 420; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 543, 544, 551, 559, 560, 563, 564, 574, 575, 579, 580, 591; [design-system/components/input.tsx](../../apps/web/src/design-system/components/input.tsx): 34; [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 128, 243, 308; [pages/invite.tsx](../../apps/web/src/pages/invite.tsx): 73, 82, 93; [pages/sign-in.tsx](../../apps/web/src/pages/sign-in.tsx): 54, 65, 77

**Primitive evidence:** `@base-ui/react/input`

**Variants:** `disabled: boolean | undefined`; `size: number | undefined`; `width: string | number | undefined`; `variant: "default" | "standard" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 2 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Input

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-setup-320](screenshots/create-setup-320.png); [create-setup-1440](screenshots/create-setup-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 53 associations in JSON.

### Textarea — design-system/components/input.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/input.tsx](../../apps/web/src/design-system/components/input.tsx):43. Category: shared component.

**Usages:** [components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx): 47; [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 380; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 115; [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 107; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 346, 349, 384, 385; [components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx): 90; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 120, 190; [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 95, 108, 127, 128, 129, 130; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 289; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 580; [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 135

**Primitive evidence:** `@base-ui/react/input`

**Variants:** `disabled: boolean | undefined`; `variant: "default" | "standard" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 2 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Textarea

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [create-setup-320](screenshots/create-setup-320.png); [create-setup-1440](screenshots/create-setup-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 10 associations in JSON.

### SelectInput — design-system/components/input.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/input.tsx](../../apps/web/src/design-system/components/input.tsx):55. Category: shared component.

**Usages:** [components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx): 115, 119; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 178, 180; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 122, 127

**Primitive evidence:** `@base-ui/react/input`

**Variants:** `disabled: boolean | undefined`; `size: number | undefined`; `variant: "default" | "standard" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 2 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SelectInput

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [reference-edit-320](screenshots/reference-edit-320.png); [reference-edit-1440](screenshots/reference-edit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Lightbox — design-system/components/lightbox.tsx

**STANDARDIZE** — Finding F09 Source: [apps/web/src/design-system/components/lightbox.tsx](../../apps/web/src/design-system/components/lightbox.tsx):9. Category: shared component.

**Usages:** [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 303; [design-system/components/frame.tsx](../../apps/web/src/design-system/components/frame.tsx): 96

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 6 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F09](audit.md#f09).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Lightbox/Frame share the correct VUI overlay mechanism but retain local literal colors, shadows, dimensions, and hand-built action chrome. Frame enlargement implements keyboard events locally. The census permits this debt; permission is not convergence.

**Recommended canonical component/pattern:** Frame / Lightbox + IconButton + semantic tokens ([M13](audit.md#m13))

**Action:** STANDARDIZE. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Menu — design-system/components/menu.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx):22. Category: shared component.

**Usages:** [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 37, 51

**Primitive evidence:** `@base-ui/react/menu`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:z-[950]` (module line 30; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Menu

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 90 associations in JSON.

### MenuItem — design-system/components/menu.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx):47. Category: shared component.

**Usages:** [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 44, 47, 49

**Primitive evidence:** `@base-ui/react/menu`

**Variants:** `disabled: boolean | undefined`

**Styling:** `tw:z-[950]` (module line 30; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MenuItem

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MenuLabel — design-system/components/menu.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx):57. Category: shared component.

**Usages:** [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 38, 41

**Primitive evidence:** `@base-ui/react/menu`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:z-[950]` (module line 30; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MenuLabel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MenuSeparator — design-system/components/menu.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx):61. Category: shared component.

**Usages:** [components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx): 42, 46

**Primitive evidence:** `@base-ui/react/menu`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:z-[950]` (module line 30; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MenuSeparator

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Modal — design-system/components/modal.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/modal.tsx](../../apps/web/src/design-system/components/modal.tsx):33. Category: shared component.

**Usages:** [components/catalog/material-assets.tsx](../../apps/web/src/components/catalog/material-assets.tsx): 221, 311; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 188, 204; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 50, 65, 77, 86; [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 790, 792; [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 104, 137; [components/editor/preset-picker.tsx](../../apps/web/src/components/editor/preset-picker.tsx): 38, 55, 85, 120; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 103, 229; [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 493, 510

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** `width: number | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 5 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Modal

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [reference-detail-320](screenshots/reference-detail-320.png); [reference-detail-1440](screenshots/reference-detail-1440.png); [reference-edit-320](screenshots/reference-edit-320.png); [reference-edit-1440](screenshots/reference-edit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### ML — design-system/components/mono-label.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/field-label.tsx](../../apps/web/src/design-system/components/field-label.tsx):17. Category: shared component.

**Usages:** [components/editor/create-materials.tsx](../../apps/web/src/components/editor/create-materials.tsx): 58, 101; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 104, 112, 119, 122, 127; [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 106, 107, 108, 111, 112; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 333, 335, 336, 339, 340, 343, 344, 346, 348, 378, 379, 384, 385; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 324

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ML

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [create-setup-320](screenshots/create-setup-320.png); [create-setup-1440](screenshots/create-setup-1440.png); [editor-studio-320](screenshots/editor-studio-320.png); [editor-studio-1440](screenshots/editor-studio-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### Note — design-system/components/note.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/note.tsx](../../apps/web/src/design-system/components/note.tsx):36. Category: shared component.

**Usages:** [components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx): 108, 110, 148, 150, 156, 159, 161; [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 91, 107, 113; [components/settings/capability-column.tsx](../../apps/web/src/components/settings/capability-column.tsx): 20; [components/settings/env-table.tsx](../../apps/web/src/components/settings/env-table.tsx): 27; [components/settings/provider-list.tsx](../../apps/web/src/components/settings/provider-list.tsx): 31, 33; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 52, 60, 63, 76, 78, 143, 148, 150; [components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx): 143, 155, 159, 161, 163, 166, 171, 175, 182, 185, 194, 197, 208, 212, 222, 224, 233, 237, 241, 252, 257, 263, 265; [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 88; [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 172, 175, 205; [components/timeline/clip-frame-trim.tsx](../../apps/web/src/components/timeline/clip-frame-trim.tsx): 77; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 80; [components/timeline/scene-reference-chips.tsx](../../apps/web/src/components/timeline/scene-reference-chips.tsx): 51, 54, 60; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 305, 404; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 299; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 782

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `tone: "muted" | "warn" | "plain" | "error" | undefined`; `as: "p" | "span" | "div" | undefined`

**Styling:** `tw:border-[color-mix(in_srgb,var(--warn)_25%,transparent)]` (module line 47; token-backed); `tw:bg-[var(--warn-bg)]` (module line 47; token-backed); `tw:text-[var(--warn)]` (module line 47; token-backed); `tw:border-[color-mix(in_srgb,var(--err)_25%,transparent)]` (module line 48; token-backed); `tw:bg-[var(--err-bg)]` (module line 48; token-backed); `tw:text-[var(--err)]` (module line 48; token-backed); `tw:border-[color-mix(in_srgb,var(--info)_25%,transparent)]` (module line 49; token-backed); `tw:bg-[var(--info-bg)]` (module line 49; token-backed); `tw:text-[var(--info)]` (module line 49; token-backed); `tw:py-[9px]` (module line 61; literal) 0 inline style attribute(s); 2 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Note

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-320](screenshots/settings-root-320.png); [settings-root-1440](screenshots/settings-root-1440.png); [settings-capabilities-320](screenshots/settings-capabilities-320.png); [settings-capabilities-1440](screenshots/settings-capabilities-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 12 associations in JSON.

### Callout — design-system/components/note.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/note.tsx](../../apps/web/src/design-system/components/note.tsx):59. Category: shared component.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 683; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 151; [components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx): 155, 158, 162, 166, 202; [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 171; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 53; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 160; [components/timeline/motion/motion-editor.tsx](../../apps/web/src/components/timeline/motion/motion-editor.tsx): 326, 334; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 51, 54

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `tone: "warn" | "error" | "info" | undefined`; `as: "p" | "div" | undefined`

**Styling:** `tw:border-[color-mix(in_srgb,var(--warn)_25%,transparent)]` (module line 47; token-backed); `tw:bg-[var(--warn-bg)]` (module line 47; token-backed); `tw:text-[var(--warn)]` (module line 47; token-backed); `tw:border-[color-mix(in_srgb,var(--err)_25%,transparent)]` (module line 48; token-backed); `tw:bg-[var(--err-bg)]` (module line 48; token-backed); `tw:text-[var(--err)]` (module line 48; token-backed); `tw:border-[color-mix(in_srgb,var(--info)_25%,transparent)]` (module line 49; token-backed); `tw:bg-[var(--info-bg)]` (module line 49; token-backed); `tw:text-[var(--info)]` (module line 49; token-backed); `tw:py-[9px]` (module line 61; literal) 0 inline style attribute(s); 2 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Callout

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Page — design-system/components/page.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/page.tsx](../../apps/web/src/design-system/components/page.tsx):31. Category: shared component.

**Usages:** [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 121, 263; [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 71, 116; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 112, 231; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 35, 108; [pages/video.tsx](../../apps/web/src/pages/video.tsx): 11, 34

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `width: "default" | "narrow" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Page

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [video-320](screenshots/video-320.png); [video-1440](screenshots/video-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 32 associations in JSON.

### PageTitle — design-system/components/page.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/page.tsx](../../apps/web/src/design-system/components/page.tsx):52. Category: shared component.

**Usages:** [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 167; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 124; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 28, 97; [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 216; [design-system/components/page.tsx](../../apps/web/src/design-system/components/page.tsx): 68

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `level: PageTitleLevel | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PageTitle

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 50 associations in JSON.

### PageHeader — design-system/components/page.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/page.tsx](../../apps/web/src/design-system/components/page.tsx):64. Category: shared component.

**Usages:** [components/catalog/library-chrome.tsx](../../apps/web/src/components/catalog/library-chrome.tsx): 32; [components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx): 122; [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 72; [components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx): 113; [pages/account.tsx](../../apps/web/src/pages/account.tsx): 26; [pages/content.tsx](../../apps/web/src/pages/content.tsx): 36; [pages/video.tsx](../../apps/web/src/pages/video.tsx): 12

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "PanelHeader", "ids": ["apps/web/src/components/catalog/elements-library.tsx#Group", "apps/web/src/components/account/account-group.tsx#AccountGroup", "apps/web/src/components/editor/panel-shell.tsx#ScanGroup", "apps/web/src/components/editor/editor-settings.tsx#SwatchGroup"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PageHeader

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 40 associations in JSON.

### Panel — design-system/components/panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx):40. Category: shared component.

**Usages:** [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 587, 590, 593

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `sheet: boolean | undefined`; `as: "div" | "aside" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Panel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 5 associations in JSON.

### Section — design-system/components/panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx):56. Category: shared component.

**Usages:** [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 164, 189, 200, 206, 221, 257; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 68, 81, 83, 86, 87, 149, 151, 154

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `as: "div" | "section" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Section

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Control — design-system/components/panel.tsx

**NEW_PATTERN** — Finding F13 Source: [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx):66. Category: shared component.

**Usages:** [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 140, 143; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 391, 392, 393, 437, 461, 462

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `as: "div" | "label" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F13](audit.md#f13).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Panel, Section, Control and Field already cover parts of hierarchy. Label/value/control/hint/reset compositions still live across clip, caption, data, motion and settings fields with local grid and spacing helpers. A generic PropertyRow cannot safely replace every control without defining editing and state semantics.

**Recommended canonical component/pattern:** PropertyRow recipe over Field / Control ([M02](audit.md#m02))

**Action:** NEW_PATTERN. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-data-style-320](screenshots/editor-data-style-320.png); [editor-data-style-1440](screenshots/editor-data-style-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Select — design-system/components/select.tsx

Canonical custom option picker. See [Select contract](select.md) for typed API, form behavior, responsive boundaries and acceptance evidence.

**Usages:** App Projects/Library/gallery filters, Settings/providers and account/admin forms; editor project/caption/scene/studio/material controls, toolbar aspect/playback speed and timeline inspector selectors. See exact migration inventory (private historical record).

**Primitive ownership:** Base UI Select owns option keyboard/typeahead and desktop placement. Existing Sheet through VUI owns phone modality, Back, focus and stacking. No native selection menu remains.

**Variants:** `size: "xs" | "sm" | "md"`; `width: "auto" | "full"`; app breakpoint 640px, editor breakpoint 860px; typed options with icon, description, group and disabled state. Controlled and uncontrolled values, unavailable and empty options, label associations, required/name/form/reset are preserved.

**Styling:** Field recipe plus adjacent `select.css`. Semantic tokens own surfaces, typography, spacing and touch floors; Base UI supplies popup geometry.

**Proof:** Select component tests, built `stories/components/select.stories.tsx`, production `visual/responsive-options.spec.ts` and built-story `visual/options-stories.ts`, desktop/320px light/dark. Domain writes stay in existing consumers and retain union validation.

### Sheet — design-system/components/sheet.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/sheet.tsx](../../apps/web/src/design-system/components/sheet.tsx):107. Category: shared component.

**Usages:** [components/timeline/timeline-clip-bar.tsx](../../apps/web/src/components/timeline/timeline-clip-bar.tsx): 126, 139; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 552, 567; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 569, 579; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 213, 223

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`

**Variants:** `open: boolean`; `size: string | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Sheet

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-data-style-320](screenshots/editor-data-style-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### Shimmer — design-system/components/shimmer.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/shimmer.tsx](../../apps/web/src/design-system/components/shimmer.tsx):9. Category: shared component.

**Usages:** [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 263, 306, 316, 431, 468; [components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx): 94; [components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx): 108; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 175; [components/timeline/timeline-base-lane.tsx](../../apps/web/src/components/timeline/timeline-base-lane.tsx): 111, 112, 132, 133

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Shimmer

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Switch — design-system/components/switch.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/switch.tsx](../../apps/web/src/design-system/components/switch.tsx):6. Category: shared component.

**Usages:** [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 118

**Primitive evidence:** `@base-ui/react/switch`

**Variants:** `disabled: boolean | undefined`

**Styling:** `tw:w-[42px]` (module line 10; literal); `tw:data-checked:translate-x-[18px]` (module line 13; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Switch

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TabsRoot — design-system/components/tabs.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx):9. Category: shared component.

**Usages:** [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 267, 289

**Primitive evidence:** `@base-ui/react/tabs`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TabsRoot

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TabsList — design-system/components/tabs.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx):13. Category: shared component.

**Usages:** [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 268, 271

**Primitive evidence:** `@base-ui/react/tabs`

**Variants:** `outline`, `segmented`, and `bar`. Bar is the shared tab-bar contract: icon-free labels, common baseline and accent underline, no pill/card surface. Base UI retains roving focus, Arrow/Home/End navigation, selected/disabled states and associated panels. Elements uses it below search. Tabs keep a 44px coarse-pointer target; narrow bars scroll horizontally. Story: `Components/Tabs/TabBar`. Production proof: `visual/basic-elements.spec.ts`.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TabsList

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TabsTab — design-system/components/tabs.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx):17. Category: shared component.

**Usages:** [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 269, 270

**Primitive evidence:** `@base-ui/react/tabs`

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TabsTab

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TabsPanel — design-system/components/tabs.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx):21. Category: shared component.

**Usages:** [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 278, 280, 281, 287

**Primitive evidence:** `@base-ui/react/tabs`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TabsPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ThemeToggle — design-system/components/theme-toggle.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/theme-toggle.tsx](../../apps/web/src/design-system/components/theme-toggle.tsx):8. Category: shared component.

**Usages:** [components/shell/top-bar.tsx](../../apps/web/src/components/shell/top-bar.tsx): 61

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ThemeToggle

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 90 associations in JSON.

### App — app/app.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/app/app.tsx](../../apps/web/src/app/app.tsx):130. Category: domain component/pattern.

**Usages:** [app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx): 55

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/checkbox`; `@base-ui/react/input`; `@base-ui/react/menu`; `@base-ui/react/popover`; `@base-ui/react/switch`; `@base-ui/react/tabs`; `@remotion/media-utils`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** App

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 117 associations in JSON.

### AuthGate — app/auth-gate.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx):23. Category: domain component/pattern.

**Usages:** [app/main.tsx](../../apps/web/src/app/main.tsx): 9

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/checkbox`; `@base-ui/react/input`; `@base-ui/react/menu`; `@base-ui/react/popover`; `@base-ui/react/switch`; `@base-ui/react/tabs`; `@remotion/media-utils`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AuthGate

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 125 associations in JSON.

### CommandPalette — app/command-palette.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/app/command-palette.tsx](../../apps/web/src/app/command-palette.tsx):28. Category: domain component/pattern.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 247

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CommandPalette

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Toast — app/toast.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/app/toast.tsx](../../apps/web/src/app/toast.tsx):10. Category: domain component/pattern.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 343, 428

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `tone: "ok" | "err" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Toast

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### AccountGroup — components/account/account-group.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx):8. Category: domain component/pattern.

**Usages:** [components/account/preferences-panel.tsx](../../apps/web/src/components/account/preferences-panel.tsx): 11, 21; [components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx): 36, 38, 39, 49; [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 85, 109, 117, 119

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "PanelHeader", "ids": ["apps/web/src/design-system/components/page.tsx#PageHeader", "apps/web/src/components/catalog/elements-library.tsx#Group", "apps/web/src/components/editor/panel-shell.tsx#ScanGroup", "apps/web/src/components/editor/editor-settings.tsx#SwatchGroup"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AccountGroup

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [account-320](screenshots/account-320.png); [account-1440](screenshots/account-1440.png); [account-security-320](screenshots/account-security-320.png); [account-security-1440](screenshots/account-security-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### FormOutcome — components/account/account-group.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx):29. Category: domain component/pattern.

**Usages:** [components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx): 47; [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 51, 94

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** FormOutcome

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### LabelledInput — components/account/account-group.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx):38. Category: domain component/pattern.

**Usages:** [components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx): 41; [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 45, 46, 47

**Primitive evidence:** `@base-ui/react/input`

**Variants:** `disabled: boolean | undefined`; `size: number | undefined`; `width: string | number | undefined`; `variant: "default" | "standard" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** LabelledInput

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [account-320](screenshots/account-320.png); [account-1440](screenshots/account-1440.png); [account-security-320](screenshots/account-security-320.png); [account-security-1440](screenshots/account-security-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### PreferencesPanel — components/account/preferences-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/account/preferences-panel.tsx](../../apps/web/src/components/account/preferences-panel.tsx):8. Category: domain component/pattern.

**Usages:** [pages/account.tsx](../../apps/web/src/pages/account.tsx): 29

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PreferencesPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [account-preferences-320](screenshots/account-preferences-320.png); [account-preferences-1440](screenshots/account-preferences-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ProfilePanel — components/account/profile-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx):9. Category: domain component/pattern.

**Usages:** [pages/account.tsx](../../apps/web/src/pages/account.tsx): 27

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:max-w-[24rem]` (module line 40; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 2 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ProfilePanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [account-320](screenshots/account-320.png); [account-1440](screenshots/account-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### PasswordForm — components/account/security-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx):10. Category: domain component/pattern.

**Usages:** [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 118

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:max-w-[24rem]` (module line 44; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 3 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PasswordForm

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [account-security-320](screenshots/account-security-320.png); [account-security-1440](screenshots/account-security-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Sessions — components/account/security-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx):56. Category: domain component/pattern.

**Usages:** [components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx): 120

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:max-w-[24rem]` (module line 44; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Sessions

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [account-security-320](screenshots/account-security-320.png); [account-security-1440](screenshots/account-security-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SecurityPanel — components/account/security-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx):113. Category: domain component/pattern.

**Usages:** [pages/account.tsx](../../apps/web/src/pages/account.tsx): 28

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:max-w-[24rem]` (module line 44; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SecurityPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ConfirmAction — components/admin/confirm-action.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/confirm-action.tsx](../../apps/web/src/components/admin/confirm-action.tsx):7. Category: domain component/pattern.

**Usages:** [components/admin/god-user-detail.tsx](../../apps/web/src/components/admin/god-user-detail.tsx): 59, 74; [components/admin/god-workspace-detail.tsx](../../apps/web/src/components/admin/god-workspace-detail.tsx): 79, 80, 104

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 2 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ConfirmAction

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-user-detail-320](screenshots/god-user-detail-320.png); [god-user-detail-1440](screenshots/god-user-detail-1440.png); [god-workspace-detail-320](screenshots/god-workspace-detail-320.png); [god-workspace-detail-1440](screenshots/god-workspace-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### GodDirectory — components/admin/god-directory.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx):19. Category: domain component/pattern.

**Usages:** [components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx): 97

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `kind: Kind`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 0 explicit state attribute(s), 7 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** GodDirectory

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-users-320](screenshots/god-users-320.png); [god-users-1440](screenshots/god-users-1440.png); [god-user-detail-320](screenshots/god-user-detail-320.png); [god-user-detail-1440](screenshots/god-user-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 12 associations in JSON.

### CreateWorkspace — components/admin/god-directory.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx):94. Category: domain component/pattern.

**Usages:** [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 59

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 1 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CreateWorkspace

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-workspaces-320](screenshots/god-workspaces-320.png); [god-workspaces-1440](screenshots/god-workspaces-1440.png); [god-workspace-detail-320](screenshots/god-workspace-detail-320.png); [god-workspace-detail-1440](screenshots/god-workspace-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ProjectDetail — components/admin/god-directory.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx):124. Category: domain component/pattern.

**Usages:** [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 83

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ProjectDetail

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-project-detail-320](screenshots/god-project-detail-320.png); [god-project-detail-1440](screenshots/god-project-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### GodInstance — components/admin/god-instance.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx):14. Category: domain component/pattern.

**Usages:** [components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx): 98

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** GodInstance

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-320](screenshots/settings-root-320.png); [settings-root-1440](screenshots/settings-root-1440.png); [settings-usage-320](screenshots/settings-usage-320.png); [settings-usage-1440](screenshots/settings-usage-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 30 associations in JSON.

### OverviewLink — components/admin/god-instance.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx):40. Category: domain component/pattern.

**Usages:** [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 66, 67, 68, 69, 70

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** OverviewLink

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-general-320](screenshots/god-general-320.png); [god-general-1440](screenshots/god-general-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Overview — components/admin/god-instance.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx):49. Category: domain component/pattern.

**Usages:** [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 20

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Overview

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-general-320](screenshots/god-general-320.png); [god-general-1440](screenshots/god-general-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Authentication — components/admin/god-instance.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx):76. Category: domain component/pattern.

**Usages:** [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 21

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Authentication

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-authentication-320](screenshots/god-authentication-320.png); [god-authentication-1440](screenshots/god-authentication-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Audit — components/admin/god-instance.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx):105. Category: domain component/pattern.

**Usages:** [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 22

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Audit

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-audit-320](screenshots/god-audit-320.png); [god-audit-1440](screenshots/god-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### GodPager — components/admin/god-pager.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-pager.tsx](../../apps/web/src/components/admin/god-pager.tsx):5. Category: domain component/pattern.

**Usages:** [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 71; [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 127

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 2 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** GodPager

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### GodModePage — components/admin/god-shell.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx):27. Category: domain component/pattern.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 264; [pages/god-mode.tsx](../../apps/web/src/pages/god-mode.tsx): 1

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`; `@base-ui/react/menu`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 0 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** GodModePage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-320](screenshots/settings-root-320.png); [settings-root-1440](screenshots/settings-root-1440.png); [settings-usage-320](screenshots/settings-usage-320.png); [settings-usage-1440](screenshots/settings-usage-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 42 associations in JSON.

### GodUserDetail — components/admin/god-user-detail.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-user-detail.tsx](../../apps/web/src/components/admin/god-user-detail.tsx):18. Category: domain component/pattern.

**Usages:** [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 81

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 12 native control node(s), 9 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** GodUserDetail

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-user-detail-320](screenshots/god-user-detail-320.png); [god-user-detail-1440](screenshots/god-user-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### GodWorkspaceDetail — components/admin/god-workspace-detail.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/admin/god-workspace-detail.tsx](../../apps/web/src/components/admin/god-workspace-detail.tsx):6. Category: domain component/pattern.

**Usages:** [components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx): 82

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 12 native control node(s), 7 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** GodWorkspaceDetail

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [god-workspace-detail-320](screenshots/god-workspace-detail-320.png); [god-workspace-detail-1440](screenshots/god-workspace-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ElementTile — components/catalog/built-in-elements.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx):43. Category: domain component/pattern.

**Usages:** [components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx): 65, 81, 97

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ElementTile

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png); [library-elements-data-320](screenshots/library-elements-data-320.png); [library-elements-data-1440](screenshots/library-elements-data-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### BuiltInTextTiles — components/catalog/built-in-elements.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx):60. Category: domain component/pattern.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 86

**Primitive evidence:** `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** BuiltInTextTiles

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### BuiltInMotionTiles — components/catalog/built-in-elements.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx):76. Category: domain component/pattern.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 91

**Primitive evidence:** `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** BuiltInMotionTiles

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### BuiltInDataTiles — components/catalog/built-in-elements.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx):92. Category: domain component/pattern.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 96

**Primitive evidence:** `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** BuiltInDataTiles

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png); [library-elements-data-320](screenshots/library-elements-data-320.png); [library-elements-data-1440](screenshots/library-elements-data-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Group — components/catalog/elements-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx):42. Category: domain component/pattern.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 85, 87, 90, 92, 95, 97, 100, 110, 113, 115

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "PanelHeader", "ids": ["apps/web/src/design-system/components/page.tsx#PageHeader", "apps/web/src/components/account/account-group.tsx#AccountGroup", "apps/web/src/components/editor/panel-shell.tsx#ScanGroup", "apps/web/src/components/editor/editor-settings.tsx#SwatchGroup"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Group

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png); [library-elements-data-320](screenshots/library-elements-data-320.png); [library-elements-data-1440](screenshots/library-elements-data-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ElementsLibrary — components/catalog/elements-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx):55. Category: domain component/pattern.

**Usages:** [pages/library.tsx](../../apps/web/src/pages/library.tsx): 25

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/input`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ElementsLibrary

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png); [library-elements-data-320](screenshots/library-elements-data-320.png); [library-elements-data-1440](screenshots/library-elements-data-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### LazyPreview — components/catalog/lazy-preview.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/lazy-preview.tsx](../../apps/web/src/components/catalog/lazy-preview.tsx):20. Category: domain component/pattern.

**Usages:** [components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx): 46

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** LazyPreview

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png); [library-elements-data-320](screenshots/library-elements-data-320.png); [library-elements-data-1440](screenshots/library-elements-data-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### LibraryHeader — components/catalog/library-chrome.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/library-chrome.tsx](../../apps/web/src/components/catalog/library-chrome.tsx):29. Category: domain component/pattern.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 72; [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 352; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 283; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 212; [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 94; [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 119

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** LibraryHeader

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png); [library-voices-320](screenshots/library-voices-320.png); [library-voices-1440](screenshots/library-voices-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 26 associations in JSON.

### LibraryToolbar — components/catalog/library-toolbar.tsx

**MERGE** — Finding F01, F12 Source: [apps/web/src/components/catalog/library-toolbar.tsx](../../apps/web/src/components/catalog/library-toolbar.tsx):52. Category: domain component/pattern.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 73; [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 360; [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 288; [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 213; [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 107; [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 120

**Primitive evidence:** `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 2 explicit state attribute(s), 8 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F01](audit.md#f01), [F12](audit.md#f12).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** The shared toolbar uses Input standard with tw:px-3. The utility layer outranks the feature rule reserving 34px for its leading icon. Stable-server capture and computed padding show the text starts inside the icon region. LibraryToolbar, ContentToolbar, image GalleryFilters and speech gallery controls answer similar collection questions with distinct input/select/chip compositions. Their taxonomies and scopes differ, so merging entire pages is not warranted.

**Recommended canonical component/pattern:** Input adornment / LibraryToolbar recipe ([M03](audit.md#m03)); Collection search/filter recipes using Input, Select and ChipButton ([M04](audit.md#m04))

**Action:** MERGE. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png); [library-voices-320](screenshots/library-voices-320.png); [library-voices-1440](screenshots/library-voices-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 26 associations in JSON.

### MaterialAssets — components/catalog/material-assets.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/material-assets.tsx](../../apps/web/src/components/catalog/material-assets.tsx):71. Category: domain component/pattern.

**Usages:** [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 240; [components/timeline/project-materials-drawer.tsx](../../apps/web/src/components/timeline/project-materials-drawer.tsx): 321

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** `selected: readonly string[]`

**Styling:** No arbitrary tw:[…] values found in module. 3 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 12 native control node(s), 4 explicit state attribute(s), 15 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MaterialAssets

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MaterialEditor — components/catalog/materials-library.tsx

**STANDARDIZE** — Finding F08 Source: [apps/web/src/components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx):42. Category: domain component/pattern.

**Usages:** [components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx): 341

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 8 native control node(s), 9 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Templates, Presets and Materials contain 16 native command-action sites styled with sb-item. Existing Button/IconButton already cover their roles.

**Recommended canonical component/pattern:** MaterialEditor

**Action:** STANDARDIZE. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-materials-create-320](screenshots/library-materials-create-320.png); [library-materials-create-1440](screenshots/library-materials-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### MaterialsLibrary — components/catalog/materials-library.tsx

**STANDARDIZE** — Finding F08 Source: [apps/web/src/components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx):263. Category: domain component/pattern.

**Usages:** [pages/library.tsx](../../apps/web/src/pages/library.tsx): 23

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Templates, Presets and Materials contain 16 native command-action sites styled with sb-item. Existing Button/IconButton already cover their roles.

**Recommended canonical component/pattern:** MaterialsLibrary

**Action:** STANDARDIZE. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-materials-320](screenshots/library-materials-320.png); [library-materials-1440](screenshots/library-materials-1440.png); [library-materials-create-320](screenshots/library-materials-create-320.png); [library-materials-create-1440](screenshots/library-materials-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### MaterialGroupRow — components/catalog/preset-material-picker.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/preset-material-picker.tsx](../../apps/web/src/components/catalog/preset-material-picker.tsx):66. Category: domain component/pattern.

**Usages:** [components/catalog/preset-material-picker.tsx](../../apps/web/src/components/catalog/preset-material-picker.tsx): 122

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 4 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MaterialGroupRow

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-presets-create-320](screenshots/library-presets-create-320.png); [library-presets-create-1440](screenshots/library-presets-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### PresetMaterialPicker — components/catalog/preset-material-picker.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/preset-material-picker.tsx](../../apps/web/src/components/catalog/preset-material-picker.tsx):118. Category: domain component/pattern.

**Usages:** [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 160

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PresetMaterialPicker

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-presets-create-320](screenshots/library-presets-create-320.png); [library-presets-create-1440](screenshots/library-presets-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### PresetUsageLine — components/catalog/preset-usage-line.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/preset-usage-line.tsx](../../apps/web/src/components/catalog/preset-usage-line.tsx):33. Category: domain component/pattern.

**Usages:** [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 317

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 7 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PresetUsageLine

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### PresetEditor — components/catalog/presets-library.tsx

**STANDARDIZE** — Finding F08 Source: [apps/web/src/components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx):52. Category: domain component/pattern.

**Usages:** [components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx): 278

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 9 native control node(s), 5 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Templates, Presets and Materials contain 16 native command-action sites styled with sb-item. Existing Button/IconButton already cover their roles.

**Recommended canonical component/pattern:** PresetEditor

**Action:** STANDARDIZE. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-presets-create-320](screenshots/library-presets-create-320.png); [library-presets-create-1440](screenshots/library-presets-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### PresetsLibrary — components/catalog/presets-library.tsx

**STANDARDIZE** — Finding F08 Source: [apps/web/src/components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx):218. Category: domain component/pattern.

**Usages:** [pages/library.tsx](../../apps/web/src/pages/library.tsx): 22

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Templates, Presets and Materials contain 16 native command-action sites styled with sb-item. Existing Button/IconButton already cover their roles.

**Recommended canonical component/pattern:** PresetsLibrary

**Action:** STANDARDIZE. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-presets-320](screenshots/library-presets-320.png); [library-presets-1440](screenshots/library-presets-1440.png); [library-presets-create-320](screenshots/library-presets-create-320.png); [library-presets-create-1440](screenshots/library-presets-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ReferenceImage — components/catalog/references-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):41. Category: domain component/pattern.

**Usages:** [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 52, 159

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ReferenceImage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png); [reference-detail-320](screenshots/reference-detail-320.png); [reference-detail-1440](screenshots/reference-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 8 associations in JSON.

### Detail — components/catalog/references-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):47. Category: domain component/pattern.

**Usages:** [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 169

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Detail

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [reference-detail-320](screenshots/reference-detail-320.png); [reference-detail-1440](screenshots/reference-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### DeleteConfirm — components/catalog/references-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):69. Category: domain component/pattern.

**Usages:** [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 171

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 2 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** DeleteConfirm

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ImagesTab — components/catalog/references-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):90. Category: domain component/pattern.

**Usages:** [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 227

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ImagesTab

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png); [reference-detail-320](screenshots/reference-detail-320.png); [reference-detail-1440](screenshots/reference-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 8 associations in JSON.

### NotesTab — components/catalog/references-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):176. Category: domain component/pattern.

**Usages:** [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 228

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 4 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** NotesTab

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-references-notes-320](screenshots/library-references-notes-320.png); [library-references-notes-1440](screenshots/library-references-notes-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ReferencesLibrary — components/catalog/references-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx):203. Category: domain component/pattern.

**Usages:** [pages/library.tsx](../../apps/web/src/pages/library.tsx): 26

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ReferencesLibrary

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png); [reference-detail-320](screenshots/reference-detail-320.png); [reference-detail-1440](screenshots/reference-detail-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 10 associations in JSON.

### TemplatesLibrary — components/catalog/templates-library.tsx

**STANDARDIZE** — Finding F07, F08 Source: [apps/web/src/components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx):46. Category: domain component/pattern.

**Usages:** [pages/library.tsx](../../apps/web/src/pages/library.tsx): 24

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/input`; `@base-ui/react/popover`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 7 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F07](audit.md#f07), [F08](audit.md#f08).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** The initial list request has no loading flag. A delayed response renders No video templates yet; a forced 500 renders Failed to load templates plus the same empty-state instruction, without an alert/retry contract. Write busy state does not represent the read request. Templates, Presets and Materials contain 16 native command-action sites styled with sb-item. Existing Button/IconButton already cover their roles.

**Recommended canonical component/pattern:** Button / IconButton ([M01](audit.md#m01)); EmptyState + Callout / retry recipe ([M07](audit.md#m07))

**Action:** STANDARDIZE. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-320](screenshots/library-templates-320.png); [library-templates-1440](screenshots/library-templates-1440.png); [library-templates-create-320](screenshots/library-templates-create-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### VoiceCloneCreate — components/catalog/voice-clone-create.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx):45. Category: domain component/pattern.

**Usages:** [components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx): 129

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 4 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VoiceCloneCreate

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VoicesLibrary — components/catalog/voices-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx):91. Category: domain component/pattern.

**Usages:** [pages/library.tsx](../../apps/web/src/pages/library.tsx): 21

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 6 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VoicesLibrary

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-voices-320](screenshots/library-voices-320.png); [library-voices-1440](screenshots/library-voices-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### CustomTilePreview — components/clip-templates/custom-clip-templates.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx):88. Category: domain component/pattern.

**Usages:** [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 244

**Primitive evidence:** `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### CustomTemplatesBlock — components/clip-templates/custom-clip-templates.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx):143. Category: domain component/pattern.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 101; [components/timeline/elements-panel.tsx](../../apps/web/src/components/timeline/elements-panel.tsx): 153, 187

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/input`; `@remotion/player`

**Variants:** `kind: DraftKind`

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 1 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SaveAsMotionBlock — components/clip-templates/custom-clip-templates.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx):335. Category: domain component/pattern.

**Usages:** [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 181

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TemplateFieldsEditor — components/clip-templates/template-fields-editor.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx):15. Category: domain component/pattern.

**Usages:** [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 272; [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 184; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 578

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TemplateFieldsEditor

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TemplateFieldInput — components/clip-templates/template-fields-editor.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx):30. Category: domain component/pattern.

**Usages:** [components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx): 24

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TemplateFieldInput

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TemplateImageField — components/clip-templates/template-fields-editor.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx):96. Category: domain component/pattern.

**Usages:** [components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx): 60

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TemplateImageField

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ContentRow — components/content/content-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx):35. Category: domain component/pattern.

**Usages:** [components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx): 94

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ContentRow

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ContentToolbar — components/content/content-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx):62. Category: domain component/pattern.

**Usages:** [pages/content.tsx](../../apps/web/src/pages/content.tsx): 57

**Primitive evidence:** `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Collection search/filter recipes using Input, Select and ChipButton ([M04](audit.md#m04))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ContentTable — components/content/content-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx):90. Category: domain component/pattern.

**Usages:** [pages/content.tsx](../../apps/web/src/pages/content.tsx): 84

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ContentTable

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Pager — design-system/patterns/collection.tsx

**KEEP** — Shared collection pagination. Source: [collection.tsx](../../apps/web/src/design-system/patterns/collection.tsx). Canonical contract: [Pager](patterns/pager.md).

**Usages:** [Projects](../../apps/web/src/pages/content.tsx) and [Video exports](../../apps/web/src/pages/video.tsx).

**Controls and variants:** Previous/Next secondary Buttons, row range, optional page position, and a busy state that disables both directions. Hidden when neither direction is available.

**Styling:** `.collection-pager*` in `app/styles/controls.css`; caption typography, tabular counts and wrapping actions.

**State/accessibility evidence:** Named navigation landmark; disabled directions remain visible. Component tests cover hidden, range/position and busy states. Production browser cases exercise pagination at desktop/320px in both themes.

**Story:** `Patterns/Pager`. OpenSpec `unify-video-export-experience` owns implementation and visual acceptance.

### LedgerCard — components/editor/audit-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx):122. Category: domain component/pattern.

**Usages:** [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 285

**Primitive evidence:** `@base-ui/react/button`

**Variants:** `busy: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ToolRow — components/editor/audit-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx):143. Category: domain component/pattern.

**Usages:** [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 209

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ChangeCard — components/editor/audit-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx):167. Category: domain component/pattern.

**Usages:** [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 279

**Primitive evidence:** `@base-ui/react/button`

**Variants:** `busy: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 2 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### AuditPanel — components/editor/audit-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx):218. Category: domain component/pattern.

**Usages:** [components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx): 295; [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 257

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/tabs`

**Variants:** `busy: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### BlockerBatch — components/editor/chat-blocker-batch.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-blocker-batch.tsx](../../apps/web/src/components/editor/chat-blocker-batch.tsx):47. Category: domain component/pattern.

**Usages:** [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 389

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** BlockerBatch

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ClarificationCard — components/editor/chat-clarification-card.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-clarification-card.tsx](../../apps/web/src/components/editor/chat-clarification-card.tsx):111. Category: domain component/pattern.

**Usages:** [components/editor/chat-blocker-batch.tsx](../../apps/web/src/components/editor/chat-blocker-batch.tsx): 52; [components/editor/chat-pinned-decision.tsx](../../apps/web/src/components/editor/chat-pinned-decision.tsx): 36

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 5 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ClarificationCard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ChatComposerBox — components/editor/chat-composer-box.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-composer-box.tsx](../../apps/web/src/components/editor/chat-composer-box.tsx):47. Category: domain component/pattern.

**Usages:** [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 401

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 3 explicit state attribute(s), 18 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Composer", "ids": ["apps/web/src/components/image-lab/prompt-composer.tsx#PromptComposer", "apps/web/src/pages/speech-lab.tsx#SpeechLabPage"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ChatComposerBox

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### ChatMarkdown — components/editor/chat-markdown.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-markdown.tsx](../../apps/web/src/components/editor/chat-markdown.tsx):58. Category: domain component/pattern.

**Usages:** [components/editor/chat-markdown.tsx](../../apps/web/src/components/editor/chat-markdown.tsx): 101; [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 361

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ChatMarkdown

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png); [editor-data-style-320](screenshots/editor-data-style-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### ResearchCard — components/editor/chat-output-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):26. Category: domain component/pattern.

**Usages:** [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 186

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ResearchCard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### AgentErrorCard — components/editor/chat-output-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):45. Category: domain component/pattern.

**Usages:** [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 162

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AgentErrorCard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### OutcomeCard — components/editor/chat-output-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):69. Category: domain component/pattern.

**Usages:** [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 161

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** OutcomeCard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### CreditMeter — components/editor/chat-output-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):97. Category: domain component/pattern.

**Usages:** [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 374

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CreditMeter

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### CreditLimitCard — components/editor/chat-output-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):116. Category: domain component/pattern.

**Usages:** [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 399

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CreditLimitCard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ChatOutput — components/editor/chat-output-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx):159. Category: domain component/pattern.

**Usages:** [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 176; [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 353

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ChatOutput

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png); [editor-data-style-320](screenshots/editor-data-style-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### ChatPaneResizeHandle — components/editor/chat-pane-resize.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-pane-resize.tsx](../../apps/web/src/components/editor/chat-pane-resize.tsx):8. Category: domain component/pattern.

**Usages:** [components/editor/chat-split.tsx](../../apps/web/src/components/editor/chat-split.tsx): 96; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 589

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 7 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ChatPaneResizeHandle

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 5 associations in JSON.

### PinnedDecision — components/editor/chat-pinned-decision.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-pinned-decision.tsx](../../apps/web/src/components/editor/chat-pinned-decision.tsx):28. Category: domain component/pattern.

**Usages:** [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 376

**Primitive evidence:** `@base-ui/react/button`

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 3 explicit state attribute(s), 7 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PinnedDecision

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ThinkingCard — components/editor/chat-run-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-run-cards.tsx](../../apps/web/src/components/editor/chat-run-cards.tsx):10. Category: domain component/pattern.

**Usages:** [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 57

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ThinkingCard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### WorkflowProgressCard — components/editor/chat-run-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-run-cards.tsx](../../apps/web/src/components/editor/chat-run-cards.tsx):31. Category: domain component/pattern.

**Usages:** [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 58

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** WorkflowProgressCard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### RunActivity — components/editor/chat-run-cards.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-run-cards.tsx](../../apps/web/src/components/editor/chat-run-cards.tsx):60. Category: domain component/pattern.

**Usages:** [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 174

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** RunActivity

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png); [editor-data-style-320](screenshots/editor-data-style-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### SubmittedContext — components/editor/chat-run.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):46. Category: domain component/pattern.

**Usages:** [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 344

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SubmittedContext

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ActivityItem — components/editor/chat-run.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):56. Category: domain component/pattern.

**Usages:** [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 174

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ActivityItem

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### RunResult — components/editor/chat-run.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):84. Category: domain component/pattern.

**Usages:** [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 186

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** RunResult

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StatusAction — components/editor/chat-run.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):142. Category: domain component/pattern.

**Usages:** [components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx): 168

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StatusAction

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### RunView — components/editor/chat-run.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx):151. Category: domain component/pattern.

**Usages:** [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 346

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** RunView

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png); [editor-data-style-320](screenshots/editor-data-style-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### ChatSplit — components/editor/chat-split.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-split.tsx](../../apps/web/src/components/editor/chat-split.tsx):32. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 666, 668, 738, 756, 760, 786

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/tabs`

**Variants:** `open: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ChatSplit

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SectionRow — components/editor/chat-story-plan.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-story-plan.tsx](../../apps/web/src/components/editor/chat-story-plan.tsx):25. Category: domain component/pattern.

**Usages:** [components/editor/chat-story-plan.tsx](../../apps/web/src/components/editor/chat-story-plan.tsx): 131

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SectionRow

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png); [editor-data-style-320](screenshots/editor-data-style-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### StoryPlanSummary — components/editor/chat-story-plan.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/chat-story-plan.tsx](../../apps/web/src/components/editor/chat-story-plan.tsx):54. Category: domain component/pattern.

**Usages:** [components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx): 165

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StoryPlanSummary

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png); [editor-data-style-320](screenshots/editor-data-style-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### CreateContent — components/editor/create-content.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx):98. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 800; [pages/content-editor.tsx](../../apps/web/src/pages/content-editor.tsx): 30

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/checkbox`; `@base-ui/react/input`; `@base-ui/react/popover`; `@base-ui/react/switch`; `@base-ui/react/tabs`; `@remotion/media-utils`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 5 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CreateContent

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 17 associations in JSON.

### CreateMaterials — components/editor/create-materials.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/create-materials.tsx](../../apps/web/src/components/editor/create-materials.tsx):49. Category: domain component/pattern.

**Usages:** [components/editor/project-setup.tsx](../../apps/web/src/components/editor/project-setup.tsx): 115

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 4 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CreateMaterials

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [create-setup-320](screenshots/create-setup-320.png); [create-setup-1440](screenshots/create-setup-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### CaptionsPanel — components/editor/editor-captions.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx):66. Category: domain component/pattern.

**Usages:** [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 205; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 102, 126, 127, 364

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`; `@base-ui/react/switch`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 3 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 13 native control node(s), 4 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Lbl — components/editor/editor-captions.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx):192. Category: domain component/pattern.

**Usages:** [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 123, 124, 127, 133, 135, 138, 139, 143, 144, 148, 149, 152, 154, 155, 157, 168, 169, 172, 173, 176, 185

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Swatch — components/editor/editor-captions.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx):196. Category: domain component/pattern.

**Usages:** [components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx): 160, 161, 162, 163, 164

**Primitive evidence:** `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ChatPanel — components/editor/editor-chat.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx):94. Category: domain component/pattern.

**Usages:** [components/editor/chat-split.tsx](../../apps/web/src/components/editor/chat-split.tsx): 56; [components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx): 424; [components/timeline/timeline-chat-panel.tsx](../../apps/web/src/components/timeline/timeline-chat-panel.tsx): 26

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/tabs`

**Variants:** `busy: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 8 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 8 associations in JSON.

### StylePanel — components/editor/editor-settings.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):149. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 300

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/checkbox`; `@base-ui/react/input`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 5 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 0 explicit state attribute(s), 14 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-data-style-320](screenshots/editor-data-style-320.png); [editor-data-style-1440](screenshots/editor-data-style-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### DirectionFields — components/editor/editor-settings.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):375. Category: domain component/pattern.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 294

**Primitive evidence:** `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SwatchGroup — components/editor/editor-settings.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):390. Category: domain component/pattern.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 326, 327

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `active: string`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "PanelHeader", "ids": ["apps/web/src/design-system/components/page.tsx#PageHeader", "apps/web/src/components/catalog/elements-library.tsx#Group", "apps/web/src/components/account/account-group.tsx#AccountGroup", "apps/web/src/components/editor/panel-shell.tsx#ScanGroup"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VoiceOptionList — components/editor/editor-settings.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):446. Category: domain component/pattern.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 656

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 2 explicit state attribute(s), 8 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SettingsPanel — components/editor/editor-settings.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):497. Category: domain component/pattern.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 751; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 103, 348

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 4 explicit state attribute(s), 10 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StyleReferencePicker — components/editor/editor-settings.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx):708. Category: domain component/pattern.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 297

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 6 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SaveBadge — components/editor/editor-topbar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx):44. Category: domain component/pattern.

**Usages:** [components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx): 116

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SaveBadge

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ModeTabs — components/editor/editor-topbar.tsx

**REFACTOR** — Finding F05 Source: [apps/web/src/components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx):54. Category: domain component/pattern.

**Usages:** [components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx): 119

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 4 explicit state attribute(s), 14 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F05](audit.md#f05).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Four segment Buttons have role tab and aria-selected, but all have tabIndex 0, none link a panel with aria-controls, and ArrowRight leaves focus unchanged. Shared Base UI Tabs already exist; phone mode navigation is a separate composition.

**Recommended canonical component/pattern:** TabsRoot / TabsList / TabsTab / TabsPanel, or route navigation where addressed ([M10](audit.md#m10))

**Action:** REFACTOR. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 17 associations in JSON.

### SubmitButton — components/editor/editor-topbar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx):67. Category: domain component/pattern.

**Usages:** [components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx): 132

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SubmitButton

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### EditorTopbar — components/editor/editor-topbar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx):76. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 625

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** EditorTopbar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 17 associations in JSON.

### ExportMenu — components/editor/export-menu.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/export-menu.tsx](../../apps/web/src/components/editor/export-menu.tsx):35. Category: domain component/pattern.

**Usages:** [components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx): 121

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 2 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ExportMenu

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 17 associations in JSON.

### Launcher — components/editor/launcher.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx):23. Category: domain component/pattern.

**Usages:** [pages/create-form.tsx](../../apps/web/src/pages/create-form.tsx): 88

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Launcher

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Setup — components/editor/launcher.tsx

**STANDARDIZE** — Finding F03 Source: [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx):66. Category: domain component/pattern.

**Usages:** [components/editor/project-setup.tsx](../../apps/web/src/components/editor/project-setup.tsx): 106

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** `busy: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 2 explicit state attribute(s), 7 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F03](audit.md#f03).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Description is rendered through Field as div and ML, followed by Textarea without a label association or aria-label. A visible micro-label is not a programmatic association. Placeholder fallback does not establish the intended field label.

**Recommended canonical component/pattern:** Field + Textarea label association ([M12](audit.md#m12))

**Action:** STANDARDIZE. Pattern-level recommendations are not automatic component replacements.

**Screens:** [create-setup-320](screenshots/create-setup-320.png); [create-setup-1440](screenshots/create-setup-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Chip — components/editor/launcher.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx):89. Category: domain component/pattern.

**Usages:** [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 119, 122

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `on: boolean`; `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Chip", "ids": ["apps/web/src/design-system/components/chip.tsx#Chip", "components/catalog/chip.tsx#Chip"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Chip

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### QueueStatusPanel — components/editor/launcher.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx):199. Category: domain component/pattern.

**Usages:** [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 315

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 10 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** QueueStatusPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### DoneView — components/editor/launcher.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx):309. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 661

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** DoneView

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TagsInput — components/editor/modals.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx):47. Category: domain component/pattern.

**Usages:** [components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx): 108

**Primitive evidence:** `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TagsInput

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### NoteModal — components/editor/modals.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx):95. Category: domain component/pattern.

**Usages:** [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 408

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 7 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** NoteModal

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### PhoneWorkspace — components/editor/phone-workspace.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/phone-workspace.tsx](../../apps/web/src/components/editor/phone-workspace.tsx):47. Category: domain component/pattern.

**Usages:** [components/editor/chat-split.tsx](../../apps/web/src/components/editor/chat-split.tsx): 78, 87; [components/timeline/timeline-phone-workspace.tsx](../../apps/web/src/components/timeline/timeline-phone-workspace.tsx): 51, 59

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 1 explicit state attribute(s), 10 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PhoneWorkspace

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-chat-1440](screenshots/editor-chat-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 8 associations in JSON.

### PresetPickerModal — components/editor/preset-picker.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/preset-picker.tsx](../../apps/web/src/components/editor/preset-picker.tsx):22. Category: domain component/pattern.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 217; [components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx): 154

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 3 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PresetPickerModal

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### PresetOverrideWarning — components/editor/preset-picker.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/preset-picker.tsx](../../apps/web/src/components/editor/preset-picker.tsx):80. Category: domain component/pattern.

**Usages:** [components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx): 227

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/checkbox`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 4 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PresetOverrideWarning

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ProjectSetup — components/editor/project-setup.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/project-setup.tsx](../../apps/web/src/components/editor/project-setup.tsx):36. Category: domain component/pattern.

**Usages:** [pages/create-form.tsx](../../apps/web/src/pages/create-form.tsx): 76

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ProjectSetup

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [create-setup-320](screenshots/create-setup-320.png); [create-setup-1440](screenshots/create-setup-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### RenderStatusBody — components/editor/render-status-body.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/render-status-body.tsx](../../apps/web/src/components/editor/render-status-body.tsx):6. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 791

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 13 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** RenderStatusBody

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StoryboardView — components/editor/storyboard-export.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/storyboard-export.tsx](../../apps/web/src/components/editor/storyboard-export.tsx):55. Category: domain component/pattern.

**Usages:** [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 395

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 2 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StoryboardView

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StoryboardDoc — components/editor/storyboard-export.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/storyboard-export.tsx](../../apps/web/src/components/editor/storyboard-export.tsx):162. Category: domain component/pattern.

**Usages:** [components/editor/storyboard-export.tsx](../../apps/web/src/components/editor/storyboard-export.tsx): 134

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StoryboardDoc

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### DurationField — components/editor/studio.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx):54. Category: domain component/pattern.

**Usages:** [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 339

**Primitive evidence:** `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** DurationField

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-studio-320](screenshots/editor-studio-320.png); [editor-studio-1440](screenshots/editor-studio-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SceneStudio — components/editor/studio.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx):84. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 718, 739

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 8 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 11 native control node(s), 5 explicit state attribute(s), 12 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SceneStudio

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-studio-320](screenshots/editor-studio-320.png); [editor-studio-1440](screenshots/editor-studio-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SceneBoard — components/editor/studio.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx):419. Category: domain component/pattern.

**Usages:** [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 392

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SceneBoard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SceneList — components/editor/studio.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx):450. Category: domain component/pattern.

**Usages:** [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 393

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SceneList

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TextProviderSelect — components/editor/text-provider-select.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx):69. Category: domain component/pattern.

**Usages:** [components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx): 196

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 4 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TextProviderSelect

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TextProviderPanel — components/editor/text-provider-select.tsx

**REMOVE** — Finding F14 Source: [apps/web/src/components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx):173. Category: domain component/pattern.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F14](audit.md#f14).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Resolved production references are absent for StyleKnobEditor, catalog Chip, render-chrome Field, ProjectReferencesPopover, TextProviderPanel, decorative editor Waveform, VoiceDot and ImageProviderSelect. Test-only references or unused imports can remain. This is a removal candidate, not permission to delete exported VUI APIs.

**Recommended canonical component/pattern:** Remove after public/export/consumer check ([M16](audit.md#m16))

**Action:** REMOVE. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ErrBar — components/editor/workspaces.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx):14. Category: domain component/pattern.

**Usages:** [components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx): 74

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ErrBar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TextWorkspace — components/editor/workspaces.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx):37. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 763

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 5 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TextWorkspace

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Spinner — components/image-lab/chat-bubble.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/image-lab/chat-bubble.tsx](../../apps/web/src/components/image-lab/chat-bubble.tsx):17. Category: domain component/pattern.

**Usages:** [components/image-lab/chat-bubble.tsx](../../apps/web/src/components/image-lab/chat-bubble.tsx): 46; [components/image-lab/prompt-composer.tsx](../../apps/web/src/components/image-lab/prompt-composer.tsx): 142; [pages/speech-lab.tsx](../../apps/web/src/pages/speech-lab.tsx): 139

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `size: number | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Spinner

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ChatBubble — components/image-lab/chat-bubble.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/image-lab/chat-bubble.tsx](../../apps/web/src/components/image-lab/chat-bubble.tsx):26. Category: domain component/pattern.

**Usages:** [pages/image-lab.tsx](../../apps/web/src/pages/image-lab.tsx): 55

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 13 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ChatBubble

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### PromptComposer — components/image-lab/prompt-composer.tsx

**REFACTOR** — Finding F04, F15 Source: [apps/web/src/components/image-lab/prompt-composer.tsx](../../apps/web/src/components/image-lab/prompt-composer.tsx):16. Category: domain component/pattern.

**Usages:** [pages/image-lab.tsx](../../apps/web/src/pages/image-lab.tsx): 58

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 8 native control node(s), 2 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F04](audit.md#f04), [F15](audit.md#f15).

**Duplicate candidates:** [{"group": "Composer", "ids": ["apps/web/src/components/editor/chat-composer-box.tsx#ChatComposerBox", "apps/web/src/pages/speech-lab.tsx#SpeechLabPage"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** Browser accessibility snapshot shows an unnamed disabled send button and an unnamed reference-picker close button. The textarea receives its placeholder as fallback name; it has no explicit persistent label. Ratio/reference toggles also implement a local popover vocabulary. Image and speech lab Enter handlers do not check isComposing, whereas editor chat guards composition. Source proves an inconsistent submit contract; no real IME end-to-end reproduction was performed.

**Recommended canonical component/pattern:** IconButton ([M06](audit.md#m06)); Composer submit/newline/IME recipe ([M14](audit.md#m14))

**Action:** REFACTOR. Pattern-level recommendations are not automatic component replacements.

**Screens:** [image-lab-320](screenshots/image-lab-320.png); [image-lab-1440](screenshots/image-lab-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ImagesGallery — components/images/images-gallery.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx):44. Category: domain component/pattern.

**Usages:** [pages/images.tsx](../../apps/web/src/pages/images.tsx): 31

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 3 explicit state attribute(s), 9 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Collection search/filter recipes using Input, Select and ChipButton ([M04](audit.md#m04))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [images-320](screenshots/images-320.png); [images-1440](screenshots/images-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### EntityEditor — components/references/entity-editor.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx):49. Category: domain component/pattern.

**Usages:** [components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx): 170; [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 393

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** `mode: "full" | "identity" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 4 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 3 explicit state attribute(s), 7 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** EntityEditor

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [reference-edit-320](screenshots/reference-edit-320.png); [reference-edit-1440](screenshots/reference-edit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### VoicePicker — components/references/panels.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/references/panels.tsx](../../apps/web/src/components/references/panels.tsx):25. Category: domain component/pattern.

**Usages:** [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 348

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 8 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VoicePicker

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-studio-320](screenshots/editor-studio-320.png); [editor-studio-1440](screenshots/editor-studio-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ReferenceLibrary — components/references/reference-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx):80. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 766; [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 227; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 501

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** `mode: ReferenceLibraryMode`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 13 native control node(s), 0 explicit state attribute(s), 12 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-studio-320](screenshots/editor-studio-320.png); [editor-studio-1440](screenshots/editor-studio-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### NoteRow — components/references/reference-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx):461. Category: domain component/pattern.

**Usages:** [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 377

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### DeleteConfirm — components/references/reference-library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx):488. Category: domain component/pattern.

**Usages:** [components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx): 423

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** `kind: "reference" | "note"`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 2 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SceneCastPicker — components/references/scene-cast.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/references/scene-cast.tsx](../../apps/web/src/components/references/scene-cast.tsx):34. Category: domain component/pattern.

**Usages:** [components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx): 280

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SceneCastPicker

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-studio-320](screenshots/editor-studio-320.png); [editor-studio-1440](screenshots/editor-studio-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SourceLinks — components/research/source-links.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/research/source-links.tsx](../../apps/web/src/components/research/source-links.tsx):30. Category: domain component/pattern.

**Usages:** [components/editor/chat-story-plan.tsx](../../apps/web/src/components/editor/chat-story-plan.tsx): 45; [components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx): 224

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 6 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SourceLinks

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Prose — components/script/script-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx):77. Category: domain component/pattern.

**Usages:** [components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx): 173, 232

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Prose

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [script-read-320](screenshots/script-read-320.png); [script-read-1440](screenshots/script-read-1440.png); [script-write-320](screenshots/script-write-320.png); [script-write-1440](screenshots/script-write-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Frame — components/script/script-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx):106. Category: domain component/pattern.

**Usages:** [components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx): 240

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Frame

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Stat — components/script/script-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx):124. Category: domain component/pattern.

**Usages:** [components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx): 382, 383, 384, 385, 386

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Stat

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [script-outline-320](screenshots/script-outline-320.png); [script-outline-1440](screenshots/script-outline-1440.png); [script-read-320](screenshots/script-read-320.png); [script-read-1440](screenshots/script-read-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### Row — components/script/script-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx):133. Category: domain component/pattern.

**Usages:** [components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx): 361

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `density: ScriptDensity`; `busy: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Row

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [script-outline-320](screenshots/script-outline-320.png); [script-outline-1440](screenshots/script-outline-1440.png); [script-read-320](screenshots/script-read-320.png); [script-read-1440](screenshots/script-read-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### ScriptTable — components/script/script-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx):278. Category: domain component/pattern.

**Usages:** [components/script/script-view.tsx](../../apps/web/src/components/script/script-view.tsx): 259

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `density: ScriptDensity`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ScriptTable

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [script-outline-320](screenshots/script-outline-320.png); [script-outline-1440](screenshots/script-outline-1440.png); [script-read-320](screenshots/script-read-320.png); [script-read-1440](screenshots/script-read-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### ScriptView — components/script/script-view.tsx

**REFACTOR** — Finding F17 Source: [apps/web/src/components/script/script-view.tsx](../../apps/web/src/components/script/script-view.tsx):52. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 674

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `density: ScriptDensity`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 1 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F17](audit.md#f17).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** All three addressed script densities produce document scrollWidth 388px at a 320px viewport. The density/export/import strip clips horizontally while the script prose remains narrow. This is a distinct toolbar composition defect beyond Button styling.

**Recommended canonical component/pattern:** Responsive script action/density recipe ([M09](audit.md#m09))

**Action:** REFACTOR. Pattern-level recommendations are not automatic component replacements.

**Screens:** [script-outline-320](screenshots/script-outline-320.png); [script-outline-1440](screenshots/script-outline-1440.png); [script-read-320](screenshots/script-read-320.png); [script-read-1440](screenshots/script-read-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### CapabilitiesTab — components/settings/capabilities-tab.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx):30. Category: domain component/pattern.

**Usages:** [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 108

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CapabilitiesTab

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-320](screenshots/settings-root-320.png); [settings-root-1440](screenshots/settings-root-1440.png); [settings-capabilities-320](screenshots/settings-capabilities-320.png); [settings-capabilities-1440](screenshots/settings-capabilities-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 12 associations in JSON.

### CapabilityColumn — components/settings/capability-column.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/capability-column.tsx](../../apps/web/src/components/settings/capability-column.tsx):13. Category: domain component/pattern.

**Usages:** [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 70

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `selected: string | null`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CapabilityColumn

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-320](screenshots/settings-root-320.png); [settings-root-1440](screenshots/settings-root-1440.png); [settings-capabilities-320](screenshots/settings-capabilities-320.png); [settings-capabilities-1440](screenshots/settings-capabilities-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 12 associations in JSON.

### ColumnHead — components/settings/column-head.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/column-head.tsx](../../apps/web/src/components/settings/column-head.tsx):10. Category: domain component/pattern.

**Usages:** [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 69, 83; [components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx): 123

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ColumnHead

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-320](screenshots/settings-root-320.png); [settings-root-1440](screenshots/settings-root-1440.png); [settings-capabilities-320](screenshots/settings-capabilities-320.png); [settings-capabilities-1440](screenshots/settings-capabilities-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 16 associations in JSON.

### CreditsPanel — components/settings/credits-panel.tsx

**REFACTOR** — Finding F02 Source: [apps/web/src/components/settings/credits-panel.tsx](../../apps/web/src/components/settings/credits-panel.tsx):46. Category: domain component/pattern.

**Usages:** [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 91

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 3 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F02](audit.md#f02).

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** Balance, Activity, Transactions and Policy exceed the narrow viewport. The route navigation uses a segmented tablist while its actions change addressed sections; table and navigation containment need separate checks.

**Recommended canonical component/pattern:** Responsive route navigation + contained data table ([M08](audit.md#m08))

**Action:** REFACTOR. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-usage-320](screenshots/settings-usage-320.png); [settings-usage-1440](screenshots/settings-usage-1440.png); [settings-usage-activity-320](screenshots/settings-usage-activity-320.png); [settings-usage-activity-1440](screenshots/settings-usage-activity-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 8 associations in JSON.

### EnvTable — components/settings/env-table.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/env-table.tsx](../../apps/web/src/components/settings/env-table.tsx):18. Category: domain component/pattern.

**Usages:** [components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx): 266

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 4 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 4 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** EnvTable

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ProviderList — components/settings/provider-list.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/provider-list.tsx](../../apps/web/src/components/settings/provider-list.tsx):26. Category: domain component/pattern.

**Usages:** [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 85

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `selected: string | null`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ProviderList

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-1440](screenshots/settings-root-1440.png); [settings-capabilities-1440](screenshots/settings-capabilities-1440.png); [settings-capability-320](screenshots/settings-capability-320.png); [settings-capability-1440](screenshots/settings-capability-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 10 associations in JSON.

### ProviderSetup — components/settings/provider-setup.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx):34. Category: domain component/pattern.

**Usages:** [components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx): 97

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 6 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ProviderSetup

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-capability-1440](screenshots/settings-capability-1440.png); [settings-provider-320](screenshots/settings-provider-320.png); [settings-provider-1440](screenshots/settings-provider-1440.png); [settings-stock-visuals-320](screenshots/settings-stock-visuals-320.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### SecurityPanel — components/settings/security-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx):50. Category: domain component/pattern.

**Usages:** [components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx): 99

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 3 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SecurityPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SettingsPage — components/settings/settings-page.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx):53. Category: domain component/pattern.

**Usages:** [components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx): 29; [pages/settings.tsx](../../apps/web/src/pages/settings.tsx): 1

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SettingsPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-320](screenshots/settings-root-320.png); [settings-root-1440](screenshots/settings-root-1440.png); [settings-usage-320](screenshots/settings-usage-320.png); [settings-usage-1440](screenshots/settings-usage-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 24 associations in JSON.

### StateDot — components/settings/state-dot.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/settings/state-dot.tsx](../../apps/web/src/components/settings/state-dot.tsx):19. Category: domain component/pattern.

**Usages:** [components/settings/capability-column.tsx](../../apps/web/src/components/settings/capability-column.tsx): 31; [components/settings/provider-list.tsx](../../apps/web/src/components/settings/provider-list.tsx): 45; [components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx): 48

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StateDot

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [settings-root-320](screenshots/settings-root-320.png); [settings-root-1440](screenshots/settings-root-1440.png); [settings-capabilities-320](screenshots/settings-capabilities-320.png); [settings-capabilities-1440](screenshots/settings-capabilities-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 12 associations in JSON.

### AppSidebar — components/shell/app-sidebar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/shell/app-sidebar.tsx](../../apps/web/src/components/shell/app-sidebar.tsx):56. Category: domain component/pattern.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 309, 352

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 0 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AppSidebar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 69 associations in JSON.

### BareShell — components/shell/bare-shell.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/shell/bare-shell.tsx](../../apps/web/src/components/shell/bare-shell.tsx):8. Category: domain component/pattern.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 281, 283

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:max-w-[44rem]` (module line 17; literal); `tw:px-[var(--page-pad)]` (module line 17; token-backed) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** BareShell

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [account-320](screenshots/account-320.png); [account-1440](screenshots/account-1440.png); [account-security-320](screenshots/account-security-320.png); [account-security-1440](screenshots/account-security-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### Breadcrumb — components/shell/breadcrumb.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/shell/breadcrumb.tsx](../../apps/web/src/components/shell/breadcrumb.tsx):6. Category: domain component/pattern.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 360

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Breadcrumb

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 48 associations in JSON.

### CreditPill — components/shell/credit-pill.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/shell/credit-pill.tsx](../../apps/web/src/components/shell/credit-pill.tsx):28. Category: domain component/pattern.

**Usages:** [components/shell/top-bar.tsx](../../apps/web/src/components/shell/top-bar.tsx): 59

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 1 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CreditPill

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 48 associations in JSON.

### TopBar — components/shell/top-bar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/shell/top-bar.tsx](../../apps/web/src/components/shell/top-bar.tsx):32. Category: domain component/pattern.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 359; [components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx): 85

**Primitive evidence:** `@base-ui/react/menu`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 0 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TopBar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 90 associations in JSON.

### UserMenu — components/shell/user-menu.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx):33. Category: domain component/pattern.

**Usages:** [components/shell/top-bar.tsx](../../apps/web/src/components/shell/top-bar.tsx): 62

**Primitive evidence:** `@base-ui/react/menu`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** UserMenu

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 90 associations in JSON.

### OptionPopover — components/speech/composer-options.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/speech/composer-options.tsx](../../apps/web/src/components/speech/composer-options.tsx):16. Category: domain component/pattern.

**Usages:** [components/speech/composer-options.tsx](../../apps/web/src/components/speech/composer-options.tsx): 30, 46, 56, 71

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Popover", "ids": ["apps/web/src/components/timeline/timeline-editor-panels.tsx#ProjectReferencesPopover", "apps/web/src/design-system/components/popover.tsx#Popover", "apps/web/src/design-system/components/popover.tsx#PopoverTrigger", "apps/web/src/design-system/components/popover.tsx#PopoverContent", "apps/web/src/design-system/components/popover.tsx#PopoverHeader", "apps/web/src/design-system/components/popover.tsx#PopoverTitle"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** OptionPopover

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ProviderOptions — components/speech/composer-options.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/speech/composer-options.tsx](../../apps/web/src/components/speech/composer-options.tsx):24. Category: domain component/pattern.

**Usages:** [pages/speech-lab.tsx](../../apps/web/src/pages/speech-lab.tsx): 101

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `selected: string`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ProviderOptions

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VoiceOptions — components/speech/composer-options.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/speech/composer-options.tsx](../../apps/web/src/components/speech/composer-options.tsx):50. Category: domain component/pattern.

**Usages:** [pages/speech-lab.tsx](../../apps/web/src/pages/speech-lab.tsx): 109

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `selected: string`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VoiceOptions

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SpeechBubble — components/speech/speech-bubble.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/speech/speech-bubble.tsx](../../apps/web/src/components/speech/speech-bubble.tsx):17. Category: domain component/pattern.

**Usages:** [pages/speech-lab.tsx](../../apps/web/src/pages/speech-lab.tsx): 72

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SpeechBubble

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SpeechGallery — components/speech/speech-gallery.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx):40. Category: domain component/pattern.

**Usages:** [pages/speech.tsx](../../apps/web/src/pages/speech.tsx): 26

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 6 native control node(s), 5 explicit state attribute(s), 11 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Collection search/filter recipes using Input, Select and ChipButton ([M04](audit.md#m04))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [speech-320](screenshots/speech-320.png); [speech-1440](screenshots/speech-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### BeatCard — components/storyboard/storyboard-view.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx):51. Category: domain component/pattern.

**Usages:** [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 245

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 17 explicit state attribute(s), 10 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** BeatCard

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### StoryboardSurface — components/storyboard/storyboard-view.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx):203. Category: domain component/pattern.

**Usages:** [components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx): 261

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 6 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StoryboardSurface

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### StoryboardView — components/storyboard/storyboard-view.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx):254. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 667

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StoryboardView

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Waveform — components/timeline/audio/audio-waveform.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/audio/audio-waveform.tsx](../../apps/web/src/components/timeline/audio/audio-waveform.tsx):117. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 321

**Primitive evidence:** `@remotion/media-utils`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Waveform

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ClipBox — components/timeline/clip-canvas.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx):43. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-stage.tsx](../../apps/web/src/components/timeline/timeline-stage.tsx): 396

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `kind: ClipKind`

**Styling:** No arbitrary tw:[…] values found in module. 3 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ClipBox

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-clip-data-1440](screenshots/editor-clip-data-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### Slider — components/timeline/clip-canvas.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx):138. Category: domain component/pattern.

**Usages:** [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 166, 183, 186, 187, 204, 225, 230, 231, 232, 233, 234, 235, 246, 282, 283, 284, 285, 297, 298, 303; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 181, 183, 347, 348

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Slider

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### AudioControls — components/timeline/clip-canvas.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx):148. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 383

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AudioControls

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VideoVolumeControl — components/timeline/clip-canvas.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx):195. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 370

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VideoVolumeControl

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ClipControls — components/timeline/clip-canvas.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx):210. Category: domain component/pattern.

**Usages:** [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 85

**Primitive evidence:** `@base-ui/react/button`; `react-colorful`

**Variants:** `kind: ClipKind`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ClipControls

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TransformSection — components/timeline/clip-canvas.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx):270. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 332, 360, 371

**Primitive evidence:** `@maleo/vui/react`; `@base-ui/react/button`

**Variants:** `kind: ClipKind`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TransformSection

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ClipFrameTrim — components/timeline/clip-frame-trim.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/clip-frame-trim.tsx](../../apps/web/src/components/timeline/clip-frame-trim.tsx):39. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 355, 366, 378

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ClipFrameTrim

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ClipRange — components/timeline/clip-range.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/clip-range.tsx](../../apps/web/src/components/timeline/clip-range.tsx):67. Category: domain component/pattern.

**Usages:** [components/timeline/clip-range.tsx](../../apps/web/src/components/timeline/clip-range.tsx): 67; [components/timeline/timeline-base-lane.tsx](../../apps/web/src/components/timeline/timeline-base-lane.tsx): 90; [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 197

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `selected: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 11 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ClipRange

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### EditTimelineItemModalHost — components/timeline/edit-item-modal.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx):76. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 284

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 7 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 0 explicit state attribute(s), 11 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** EditTimelineItemModalHost

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### EditModal — components/timeline/edit-item-modal.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx):264. Category: domain component/pattern.

**Usages:** [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 94, 119, 137, 176

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** `busy: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 2 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** EditModal

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ElementsPanel — components/timeline/elements-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/elements-panel.tsx](../../apps/web/src/components/timeline/elements-panel.tsx):50. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 62, 395

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/input`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 0 explicit state attribute(s), 12 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### InsightsCanvas — components/timeline/insights-canvas.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/insights-canvas.tsx](../../apps/web/src/components/timeline/insights-canvas.tsx):19. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 693

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `density: number[]`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** InsightsCanvas

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### AccordionSection — components/timeline/inspector-section.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/inspector-section.tsx](../../apps/web/src/components/timeline/inspector-section.tsx):22. Category: domain component/pattern.

**Usages:** [components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx): 266, 280, 294, 295, 300, 302, 305; [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 546, 555, 575, 583, 584, 591, 592, 600, 601, 612, 613, 618; [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 118, 186, 303, 304, 307, 312, 315, 316, 319, 328, 330, 339, 340, 345, 346, 349, 354, 356, 357, 363, 365, 367, 370, 374, 377, 379, 380, 383, 390, 394, 398, 402, 403, 409, 413, 415, 419, 421, 432, 434, 435, 438, 453, 458, 459, 463; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 542, 545, 548, 552, 555, 568, 571, 585, 588, 639, 642, 645

**Primitive evidence:** `@maleo/vui/react`

**Variants:** `open: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AccordionSection

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### AllMediaPanel — components/timeline/media/media-browser.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx):130. Category: domain component/pattern.

**Usages:** [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 308; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 63, 480

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 9 native control node(s), 4 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MediaHoverPreview — components/timeline/media/media-hover-preview.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/media/media-hover-preview.tsx](../../apps/web/src/components/timeline/media/media-hover-preview.tsx):70. Category: domain component/pattern.

**Usages:** [components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx): 301; [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 208

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MediaHoverPreview

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VideoPoster — components/timeline/media/media-thumb.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/media/media-thumb.tsx](../../apps/web/src/components/timeline/media/media-thumb.tsx):7. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 306

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VideoPoster

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StockAttribution — components/timeline/media/stock-browser.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx):25. Category: domain component/pattern.

**Usages:** [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 63, 198

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StockAudioResults — components/timeline/media/stock-browser.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx):33. Category: domain component/pattern.

**Usages:** [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 164; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 130

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StockPanel — components/timeline/media/stock-browser.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx):77. Category: domain component/pattern.

**Usages:** [components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx): 213; [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 528

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MentionTextarea — components/timeline/mention-textarea.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/mention-textarea.tsx](../../apps/web/src/components/timeline/mention-textarea.tsx):42. Category: domain component/pattern.

**Usages:** [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 279; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 90; [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 280; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 644

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `variant: "input" | "bare" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MentionTextarea

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### CurvePath — components/timeline/motion/motion-curve.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/motion/motion-curve.tsx](../../apps/web/src/components/timeline/motion/motion-curve.tsx):15. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-curve.tsx](../../apps/web/src/components/timeline/motion/motion-curve.tsx): 42

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CurvePath

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TrackCurve — components/timeline/motion/motion-curve.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/motion/motion-curve.tsx](../../apps/web/src/components/timeline/motion/motion-curve.tsx):38. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 705

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TrackCurve

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MotionEditor — components/timeline/motion/motion-editor.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/motion/motion-editor.tsx](../../apps/web/src/components/timeline/motion/motion-editor.tsx):39. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-editor.tsx](../../apps/web/src/components/timeline/motion/motion-editor.tsx): 319; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 113

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 4 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 3 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MotionEditor

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MotionPresetLibraryBlock — components/timeline/motion/motion-editor.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/motion/motion-editor.tsx](../../apps/web/src/components/timeline/motion/motion-editor.tsx):254. Category: domain component/pattern.

**Usages:** [components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx): 114

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 2 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MotionPresetLibraryBlock

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### MotionStudioModal — components/timeline/motion/motion-studio-modal.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx):64. Category: domain component/pattern.

**Usages:** [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 287

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/input`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 12 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 9 explicit state attribute(s), 14 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MotionStudioModal

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MotionTimelineViewport — components/timeline/motion/motion-timeline.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/motion/motion-timeline.tsx](../../apps/web/src/components/timeline/motion/motion-timeline.tsx):243. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 641, 736

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MotionTimelineViewport

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### MotionToolbar — components/timeline/motion/motion-toolbar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx):49. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 624

**Primitive evidence:** `@maleo/vui/react`; `@base-ui/react/button`

**Variants:** `compact: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 0 explicit state attribute(s), 7 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MotionToolbar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Popover — components/timeline/popover.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):6. Category: domain component/pattern.

**Usages:** [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 39, 54, 113, 134

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** `open: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Popover", "ids": ["apps/web/src/components/speech/composer-options.tsx#OptionPopover", "apps/web/src/components/timeline/timeline-editor-panels.tsx#ProjectReferencesPopover", "apps/web/src/design-system/components/popover.tsx#PopoverTrigger", "apps/web/src/design-system/components/popover.tsx#PopoverContent", "apps/web/src/design-system/components/popover.tsx#PopoverHeader", "apps/web/src/design-system/components/popover.tsx#PopoverTitle"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Popover

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### PopoverTrigger — components/timeline/popover.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):10. Category: domain component/pattern.

**Usages:** [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 40, 44, 114, 116

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Popover", "ids": ["apps/web/src/components/speech/composer-options.tsx#OptionPopover", "apps/web/src/components/timeline/timeline-editor-panels.tsx#ProjectReferencesPopover", "apps/web/src/design-system/components/popover.tsx#Popover", "apps/web/src/design-system/components/popover.tsx#PopoverContent", "apps/web/src/design-system/components/popover.tsx#PopoverHeader", "apps/web/src/design-system/components/popover.tsx#PopoverTitle"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PopoverTrigger

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 69 associations in JSON.

### PopoverContent — components/timeline/popover.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):17. Category: domain component/pattern.

**Usages:** [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 45, 53, 117, 133

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Popover", "ids": ["apps/web/src/components/speech/composer-options.tsx#OptionPopover", "apps/web/src/components/timeline/timeline-editor-panels.tsx#ProjectReferencesPopover", "apps/web/src/design-system/components/popover.tsx#Popover", "apps/web/src/design-system/components/popover.tsx#PopoverTrigger", "apps/web/src/design-system/components/popover.tsx#PopoverHeader", "apps/web/src/design-system/components/popover.tsx#PopoverTitle"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PopoverContent

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### PopoverHeader — components/timeline/popover.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):27. Category: domain component/pattern.

**Usages:** [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 46, 118

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Popover", "ids": ["apps/web/src/components/speech/composer-options.tsx#OptionPopover", "apps/web/src/components/timeline/timeline-editor-panels.tsx#ProjectReferencesPopover", "apps/web/src/design-system/components/popover.tsx#Popover", "apps/web/src/design-system/components/popover.tsx#PopoverTrigger", "apps/web/src/design-system/components/popover.tsx#PopoverContent", "apps/web/src/design-system/components/popover.tsx#PopoverTitle"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PopoverHeader

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### PopoverTitle — components/timeline/popover.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx):31. Category: domain component/pattern.

**Usages:** [design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx): 35; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 46, 118

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Popover", "ids": ["apps/web/src/components/speech/composer-options.tsx#OptionPopover", "apps/web/src/components/timeline/timeline-editor-panels.tsx#ProjectReferencesPopover", "apps/web/src/design-system/components/popover.tsx#Popover", "apps/web/src/design-system/components/popover.tsx#PopoverTrigger", "apps/web/src/design-system/components/popover.tsx#PopoverContent", "apps/web/src/design-system/components/popover.tsx#PopoverHeader"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PopoverTitle

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ProjectMaterialsDrawer — components/timeline/project-materials-drawer.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/project-materials-drawer.tsx](../../apps/web/src/components/timeline/project-materials-drawer.tsx):76. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-stage.tsx](../../apps/web/src/components/timeline/timeline-stage.tsx): 333

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 8 native control node(s), 3 explicit state attribute(s), 8 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ProjectMaterialsDrawer

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SceneEditorDrawer — components/timeline/scene-editor-drawer.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx):45. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-scene-drawer.tsx](../../apps/web/src/components/timeline/timeline-scene-drawer.tsx): 17, 37

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 4 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SceneEditorDrawer

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### FrameSlot — components/timeline/scene-editor-drawer.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx):170. Category: domain component/pattern.

**Usages:** [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 71, 75

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** FrameSlot

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### RailField — components/timeline/scene-editor-drawer.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx):188. Category: domain component/pattern.

**Usages:** [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 89, 99, 101, 102, 105, 110, 112, 123, 125, 129, 142, 144

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** RailField

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### SceneReferenceChips — components/timeline/scene-reference-chips.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/scene-reference-chips.tsx](../../apps/web/src/components/timeline/scene-reference-chips.tsx):21. Category: domain component/pattern.

**Usages:** [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 309; [components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx): 153

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SceneReferenceChips

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StudioActionBar — components/timeline/studio-action-bar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/studio-action-bar.tsx](../../apps/web/src/components/timeline/studio-action-bar.tsx):52. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 506; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 482

**Primitive evidence:** `@maleo/vui/react`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StudioActionBar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-320](screenshots/library-templates-create-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### StudioHeading — components/timeline/studio-heading.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/studio-heading.tsx](../../apps/web/src/components/timeline/studio-heading.tsx):25. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 524; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 502

**Primitive evidence:** `@base-ui/react/button`

**Variants:** `compact: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StudioHeading

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-320](screenshots/library-templates-create-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TemplateTimelineViewport — components/timeline/template-timeline.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/template-timeline.tsx](../../apps/web/src/components/timeline/template-timeline.tsx):305. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 678, 728

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TemplateTimelineViewport

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-320](screenshots/library-templates-create-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TemplateRangeBar — components/timeline/template-timeline.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/template-timeline.tsx](../../apps/web/src/components/timeline/template-timeline.tsx):358. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 716

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 10 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TemplateRangeBar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-320](screenshots/library-templates-create-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TemplateToolbar — components/timeline/template-toolbar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx):32. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 657

**Primitive evidence:** `@maleo/vui/react`; `@base-ui/react/button`

**Variants:** `compact: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TemplateToolbar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-320](screenshots/library-templates-create-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TimelineBaseLane — components/timeline/timeline-base-lane.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-base-lane.tsx](../../apps/web/src/components/timeline/timeline-base-lane.tsx):47. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 727

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 6 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 0 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineBaseLane

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelineBottomBar — components/timeline/timeline-bottom-bar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-bottom-bar.tsx](../../apps/web/src/components/timeline/timeline-bottom-bar.tsx):27. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 682

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** `sheet: import("apps/web/src/stores/editor-chrome-store").BottomSheet`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineBottomBar

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelineChatPanel — components/timeline/timeline-chat-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-chat-panel.tsx](../../apps/web/src/components/timeline/timeline-chat-panel.tsx):21. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 298; [components/timeline/timeline-phone-workspace.tsx](../../apps/web/src/components/timeline/timeline-phone-workspace.tsx): 56

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/tabs`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineChatPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### TimelineClipBar — components/timeline/timeline-clip-bar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-clip-bar.tsx](../../apps/web/src/components/timeline/timeline-clip-bar.tsx):33. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-bottom-bar.tsx](../../apps/web/src/components/timeline/timeline-bottom-bar.tsx): 16, 32

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** `sheet: BottomSheet`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 7 native control node(s), 0 explicit state attribute(s), 13 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### RevealControls — components/timeline/timeline-clip-inspector.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx):106. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 320, 369

**Primitive evidence:** `@maleo/vui/react`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** RevealControls

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TimelineClipInspector — components/timeline/timeline-clip-inspector.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx):211. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx): 208, 566

**Primitive evidence:** `@maleo/vui/react`; `@base-ui/react/button`; `@base-ui/react/input`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 7 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 7 native control node(s), 0 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineClipInspector

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelineClipInspectorSheet — components/timeline/timeline-clip-inspector.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx):539. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 774

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/react`; `@base-ui/react/button`; `@base-ui/react/input`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineClipInspectorSheet

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-data-style-320](screenshots/editor-data-style-320.png) Observed mounted component name in route capture; not isolated variant/state proof

### UndoIcon — components/timeline/timeline-editor-icons.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-icons.tsx](../../apps/web/src/components/timeline/timeline-editor-icons.tsx):12. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 70, 71

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** UndoIcon

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### JumpIcon — components/timeline/timeline-editor-icons.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-icons.tsx](../../apps/web/src/components/timeline/timeline-editor-icons.tsx):18. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 67, 142; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 38, 68; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 107, 110

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** JumpIcon

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### AspectIcon — components/timeline/timeline-editor-icons.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-icons.tsx](../../apps/web/src/components/timeline/timeline-editor-icons.tsx):24. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 121, 132, 165, 176

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `kind: string`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AspectIcon

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TextPresetPreview — components/timeline/timeline-editor-panels.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx):62. Category: domain component/pattern.

**Usages:** [components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx): 69, 85; [components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx): 91, 97; [components/timeline/elements-panel.tsx](../../apps/web/src/components/timeline/elements-panel.tsx): 118, 146; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 59

**Primitive evidence:** `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-elements-320](screenshots/library-elements-320.png); [library-elements-1440](screenshots/library-elements-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SegmentStoryboardReel — components/timeline/timeline-editor-panels.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx):121. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 138

**Primitive evidence:** `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ExactTimelinePreview — components/timeline/timeline-editor-panels.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx):129. Category: domain component/pattern.

**Usages:** [components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx): 98, 123, 192

**Primitive evidence:** `@remotion/player`

**Variants:** `width: number`

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TransitionPreview — components/timeline/timeline-editor-panels.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx):193. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx): 214; [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 65

**Primitive evidence:** `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TransitionsPanel — components/timeline/timeline-editor-panels.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx):203. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 64, 457

**Primitive evidence:** `@base-ui/react/button`; `@remotion/player`

**Variants:** `active: Scene | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### ProjectReferencesPopover — components/timeline/timeline-editor-panels.tsx

**REMOVE** — Finding F14 Source: [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx):225. Category: domain component/pattern.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** `@base-ui/react/button`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. See [F14](audit.md#f14).

**Duplicate candidates:** [{"group": "Popover", "ids": ["apps/web/src/components/speech/composer-options.tsx#OptionPopover", "apps/web/src/design-system/components/popover.tsx#Popover", "apps/web/src/design-system/components/popover.tsx#PopoverTrigger", "apps/web/src/design-system/components/popover.tsx#PopoverContent", "apps/web/src/design-system/components/popover.tsx#PopoverHeader", "apps/web/src/design-system/components/popover.tsx#PopoverTitle"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** Resolved production references are absent for StyleKnobEditor, catalog Chip, render-chrome Field, ProjectReferencesPopover, TextProviderPanel, decorative editor Waveform, VoiceDot and ImageProviderSelect. Test-only references or unused imports can remain. This is a removal candidate, not permission to delete exported VUI APIs.

**Recommended canonical component/pattern:** Remove after public/export/consumer check ([M16](audit.md#m16)); PanelHeader recipe ([M05](audit.md#m05))

**Action:** REMOVE. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### EffectsPanel — components/timeline/timeline-editor-panels.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx):307. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 467

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 5 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TimelineEditor — components/timeline/timeline-editor.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx):138. Category: domain component/pattern.

**Usages:** [components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx): 694

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/checkbox`; `@base-ui/react/input`; `@base-ui/react/popover`; `@base-ui/react/switch`; `@base-ui/react/tabs`; `@remotion/media-utils`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineEditor

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelineGutter — components/timeline/timeline-gutter.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-gutter.tsx](../../apps/web/src/components/timeline/timeline-gutter.tsx):48. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 637

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 6 native control node(s), 0 explicit state attribute(s), 9 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineGutter

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### LaneEnvProvider — components/timeline/timeline-lane.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx):119. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 632, 789

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** LaneEnvProvider

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### FreeClipRange — components/timeline/timeline-lane.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx):186. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 226, 251, 327

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `kind: ContentRangeKind`; `selected: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** FreeClipRange

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### EffectClipView — components/timeline/timeline-lane.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx):220. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 220, 468

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** EffectClipView

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### MediaClipView — components/timeline/timeline-lane.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx):289. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 289, 471

**Primitive evidence:** `@remotion/media-utils`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MediaClipView

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TimelineLane — components/timeline/timeline-lane.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx):383. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx): 383; [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 746

**Primitive evidence:** `@remotion/media-utils`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineLane

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelinePanelHost — components/timeline/timeline-panel-host.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx):134. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 696

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/checkbox`; `@base-ui/react/input`; `@base-ui/react/popover`; `@base-ui/react/switch`; `@base-ui/react/tabs`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 5 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 4 native control node(s), 3 explicit state attribute(s), 9 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png); [editor-clip-data-1440](screenshots/editor-clip-data-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### TimelinePhoneWorkspace — components/timeline/timeline-phone-workspace.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-phone-workspace.tsx](../../apps/web/src/components/timeline/timeline-phone-workspace.tsx):21. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 680, 795

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/tabs`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelinePhoneWorkspace

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelineRail — components/timeline/timeline-rail.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-rail.tsx](../../apps/web/src/components/timeline/timeline-rail.tsx):39. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-bottom-bar.tsx](../../apps/web/src/components/timeline/timeline-bottom-bar.tsx): 22, 30

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineRail

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelineSceneDrawer — components/timeline/timeline-scene-drawer.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-scene-drawer.tsx](../../apps/web/src/components/timeline/timeline-scene-drawer.tsx):29. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 777

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineSceneDrawer

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TimelineStage — components/timeline/timeline-stage.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-stage.tsx](../../apps/web/src/components/timeline/timeline-stage.tsx):202. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 735

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 6 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 24 native control node(s), 4 explicit state attribute(s), 26 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineStage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelineTemplateEditorModal — components/timeline/timeline-template-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx):344. Category: domain component/pattern.

**Usages:** [components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx): 149; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 786

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/input`; `@base-ui/react/popover`; `@remotion/player`

**Variants:** `busy: boolean`; `width: number`

**Styling:** No arbitrary tw:[…] values found in module. 7 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 3 explicit state attribute(s), 12 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-320](screenshots/library-templates-create-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### TimelineTemplatesPanel — components/timeline/timeline-template-panel.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx):743. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx): 441

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/input`; `@base-ui/react/popover`; `@remotion/player`

**Variants:** `busy: boolean`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 7 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Chevron — components/timeline/timeline-template-pickers.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx):23. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 42, 115

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Chevron

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### PreviewPicker — components/timeline/timeline-template-pickers.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx):27. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx): 58, 65

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 2 explicit state attribute(s), 6 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PreviewPicker

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TitlePresetPicker — components/timeline/timeline-template-pickers.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx):57. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 550, 567

**Primitive evidence:** `@base-ui/react/popover`; `@remotion/player`

**Variants:** `disabled: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TitlePresetPicker

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TransitionPresetPicker — components/timeline/timeline-template-pickers.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx):63. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 584

**Primitive evidence:** `@base-ui/react/popover`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TransitionPresetPicker

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### StockSfxPicker — components/timeline/timeline-template-pickers.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx):78. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 557, 577, 590, 621

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/popover`

**Variants:** `kind: "sfx" | "music" | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 6 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** StockSfxPicker

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### TimelineToolbarFrame — components/timeline/timeline-toolbar-frame.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-toolbar-frame.tsx](../../apps/web/src/components/timeline/timeline-toolbar-frame.tsx):28. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 72, 83; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 41, 49; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 208, 229

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineToolbarFrame

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 9 associations in JSON.

### TimelineToolbar — components/timeline/timeline-toolbar.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx):25. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx): 634

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 11 native control node(s), 9 explicit state attribute(s), 36 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** PanelHeader recipe ([M05](audit.md#m05))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TimelineTracks — components/timeline/timeline-tracks.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx):212. Category: domain component/pattern.

**Usages:** [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 761

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@remotion/media-utils`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 10 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TimelineTracks

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### TransportPlay — components/timeline/timeline-transport.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/patterns/transport.tsx](../../apps/web/src/design-system/patterns/transport.tsx):30. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 68; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 39; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 115

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TransportPlay

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 9 associations in JSON.

### TransportTimecode — components/timeline/timeline-transport.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/design-system/patterns/transport.tsx](../../apps/web/src/design-system/patterns/transport.tsx):47. Category: domain component/pattern.

**Usages:** [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 68; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 39; [components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx): 116

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** TransportTimecode

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 9 associations in JSON.

### WorkspaceManage — components/workspace/workspace-manage.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):34. Category: domain component/pattern.

**Usages:** [pages/workspace.tsx](../../apps/web/src/pages/workspace.tsx): 18

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** WorkspaceManage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [workspace-320](screenshots/workspace-320.png); [workspace-1440](screenshots/workspace-1440.png); [workspace-members-320](screenshots/workspace-members-320.png); [workspace-members-1440](screenshots/workspace-members-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### GeneralPanel — components/workspace/workspace-manage.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):84. Category: domain component/pattern.

**Usages:** [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 72

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** GeneralPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [workspace-320](screenshots/workspace-320.png); [workspace-1440](screenshots/workspace-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### MembersPanel — components/workspace/workspace-manage.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):147. Category: domain component/pattern.

**Usages:** [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 73

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** MembersPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [workspace-members-320](screenshots/workspace-members-320.png); [workspace-members-1440](screenshots/workspace-members-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### DangerPanel — components/workspace/workspace-manage.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx):256. Category: domain component/pattern.

**Usages:** [components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx): 75

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** DangerPanel

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [workspace-danger-320](screenshots/workspace-danger-320.png); [workspace-danger-1440](screenshots/workspace-danger-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### WorkspaceChip — components/workspace/workspace-switcher.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/workspace/workspace-switcher.tsx](../../apps/web/src/components/workspace/workspace-switcher.tsx):44. Category: domain component/pattern.

**Usages:** [components/workspace/workspace-switcher.tsx](../../apps/web/src/components/workspace/workspace-switcher.tsx): 179, 212

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** `size: number | undefined`

**Styling:** `tw:aria-[current=page]` (module line 175; literal) 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** WorkspaceChip

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 69 associations in JSON.

### CreateWorkspaceForm — components/workspace/workspace-switcher.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/workspace/workspace-switcher.tsx](../../apps/web/src/components/workspace/workspace-switcher.tsx):64. Category: domain component/pattern.

**Usages:** [components/workspace/workspace-switcher.tsx](../../apps/web/src/components/workspace/workspace-switcher.tsx): 235

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:aria-[current=page]` (module line 175; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 3 native control node(s), 1 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CreateWorkspaceForm

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### WorkspaceSwitcher — components/workspace/workspace-switcher.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/workspace/workspace-switcher.tsx](../../apps/web/src/components/workspace/workspace-switcher.tsx):137. Category: domain component/pattern.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 371; [components/shell/app-sidebar.tsx](../../apps/web/src/components/shell/app-sidebar.tsx): 84; [pages/create-form.tsx](../../apps/web/src/pages/create-form.tsx): 55

**Primitive evidence:** `@base-ui/react/popover`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** `tw:aria-[current=page]` (module line 175; literal) 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** WorkspaceSwitcher

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png); [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 69 associations in JSON.

### AccountPage — pages/account.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/account.tsx](../../apps/web/src/pages/account.tsx):14. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 282

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AccountPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [account-320](screenshots/account-320.png); [account-1440](screenshots/account-1440.png); [account-security-320](screenshots/account-security-320.png); [account-security-1440](screenshots/account-security-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### ContentEditorPage — pages/content-editor.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/content-editor.tsx](../../apps/web/src/pages/content-editor.tsx):28. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 331

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/checkbox`; `@base-ui/react/input`; `@base-ui/react/popover`; `@base-ui/react/switch`; `@base-ui/react/tabs`; `@remotion/media-utils`; `@remotion/player`; `react-colorful`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ContentEditorPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-storyboard-320](screenshots/editor-storyboard-320.png); [editor-storyboard-1440](screenshots/editor-storyboard-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 17 associations in JSON.

### ContentPage — pages/content.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/content.tsx](../../apps/web/src/pages/content.tsx):21. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 384

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 7 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ContentPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [content-list-320](screenshots/content-list-320.png); [content-list-1440](screenshots/content-list-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### CreateFormPage — pages/create-form.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/create-form.tsx](../../apps/web/src/pages/create-form.tsx):33. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 325

**Primitive evidence:** `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@base-ui/react/button`; `@base-ui/react/input`; `@base-ui/react/popover`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** CreateFormPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [create-picker-320](screenshots/create-picker-320.png); [create-picker-1440](screenshots/create-picker-1440.png); [create-setup-320](screenshots/create-setup-320.png); [create-setup-1440](screenshots/create-setup-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ImageLabPage — pages/image-lab.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/image-lab.tsx](../../apps/web/src/pages/image-lab.tsx):16. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 388

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ImageLabPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [image-lab-320](screenshots/image-lab-320.png); [image-lab-1440](screenshots/image-lab-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### ImagesPage — pages/images.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/images.tsx](../../apps/web/src/pages/images.tsx):12. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 387

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** ImagesPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [images-320](screenshots/images-320.png); [images-1440](screenshots/images-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### InvitePage — pages/invite.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/invite.tsx](../../apps/web/src/pages/invite.tsx):20. Category: page.

**Usages:** [app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx): 48

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** InvitePage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [invitation-invalid-320](screenshots/invitation-invalid-320.png); [invitation-invalid-1440](screenshots/invitation-invalid-1440.png); [invitation-valid-320](screenshots/invitation-valid-320.png); [invitation-valid-1440](screenshots/invitation-valid-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### LibraryPage — pages/library.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/library.tsx](../../apps/web/src/pages/library.tsx):20. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 386

**Primitive evidence:** `@maleo/vui/dom`; `@maleo/vui/dom (overlay lifecycle; Maleo layout wrapper)`; `@maleo/vui/kernel`; `@maleo/vui/react`; `@maleo/vui/remotion`; `@base-ui/react/button`; `@base-ui/react/input`; `@base-ui/react/popover`; `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** LibraryPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-references-320](screenshots/library-references-320.png); [library-references-1440](screenshots/library-references-1440.png); [library-voices-320](screenshots/library-voices-320.png); [library-voices-1440](screenshots/library-voices-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 30 associations in JSON.

### SignInPage — pages/sign-in.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/sign-in.tsx](../../apps/web/src/pages/sign-in.tsx):21. Category: page.

**Usages:** [app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx): 54

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SignInPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [sign-in-320](screenshots/sign-in-320.png); [sign-in-1440](screenshots/sign-in-1440.png); [first-owner-320](screenshots/first-owner-320.png); [first-owner-1440](screenshots/first-owner-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SpeechLabPage — pages/speech-lab.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/speech-lab.tsx](../../apps/web/src/pages/speech-lab.tsx):24. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 390

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 5 native control node(s), 3 explicit state attribute(s), 5 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** [{"group": "Composer", "ids": ["apps/web/src/components/image-lab/prompt-composer.tsx#PromptComposer", "apps/web/src/components/editor/chat-composer-box.tsx#ChatComposerBox"], "note": "Semantic comparison candidate, not proven duplication"}]

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Composer submit/newline/IME recipe ([M14](audit.md#m14))

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [speech-lab-320](screenshots/speech-lab-320.png); [speech-lab-1440](screenshots/speech-lab-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### SpeechPage — pages/speech.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/speech.tsx](../../apps/web/src/pages/speech.tsx):11. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 389

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** SpeechPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [speech-320](screenshots/speech-320.png); [speech-1440](screenshots/speech-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### VideoPage — pages/video.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/video.tsx](../../apps/web/src/pages/video.tsx):7. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 385

**Primitive evidence:** `@base-ui/react/button`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 6 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VideoPage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [video-320](screenshots/video-320.png); [video-1440](screenshots/video-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### WorkspacePage — pages/workspace.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/pages/workspace.tsx](../../apps/web/src/pages/workspace.tsx):16. Category: page.

**Usages:** [app/app.tsx](../../apps/web/src/app/app.tsx): 392

**Primitive evidence:** `@base-ui/react/button`; `@base-ui/react/input`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** WorkspacePage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [workspace-320](screenshots/workspace-320.png); [workspace-1440](screenshots/workspace-1440.png); [workspace-members-320](screenshots/workspace-members-320.png); [workspace-members-1440](screenshots/workspace-members-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 6 associations in JSON.

### VuiKeyboardScope — react/keyboard.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/keyboard-scope.tsx](../../apps/web/src/components/editor-workspace/keyboard-scope.tsx):33. Category: VUI.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 497, 746; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 473, 739

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiKeyboardScope

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-320](screenshots/library-templates-create-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### VuiOverlay — react/overlay.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/overlay.tsx](../../apps/web/src/components/editor-workspace/overlay.tsx):16. Category: VUI.

**Usages:** [react/sheet.tsx](../../apps/web/src/components/editor-workspace/sheet.tsx): 7; [react/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx): 195

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `open: boolean`; `kind: VuiOverlayKind | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiOverlay

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-320](screenshots/library-templates-create-320.png); [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### VuiPreviewFrame — react/preview.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: `preview.tsx` (editor workspace, deleted in task 3.7):26. Category: VUI.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiPreviewFrame

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiTimecode — react/preview.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: `preview.tsx` (editor workspace, deleted in task 3.7):41. Category: VUI.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiTimecode

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiRendererTransport — react/preview.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: `preview.tsx` (editor workspace, deleted in task 3.7):59. Category: VUI.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 2 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiRendererTransport

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiInspector — react/preview.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: `preview.tsx` (editor workspace, deleted in task 3.7):85. Category: VUI.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiInspector

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiStatus — react/preview.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: `preview.tsx` (editor workspace, deleted in task 3.7):109. Category: VUI.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiStatus

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiPreviewStage — react/primitives.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/primitives.tsx](../../apps/web/src/components/editor-workspace/primitives.tsx):12. Category: VUI.

**Usages:** [components/timeline/timeline-stage.tsx](../../apps/web/src/components/timeline/timeline-stage.tsx): 350, 367

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiPreviewStage

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 7 associations in JSON.

### VuiTransport — react/primitives.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/primitives.tsx](../../apps/web/src/components/editor-workspace/primitives.tsx):16. Category: VUI.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 2 native control node(s), 0 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiTransport

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiInspectorRail — react/primitives.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/primitives.tsx](../../apps/web/src/components/editor-workspace/primitives.tsx):21. Category: VUI.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 544, 621; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 535, 648

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `active: string`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 3 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiInspectorRail

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [library-templates-create-1440](screenshots/library-templates-create-1440.png) Observed mounted component name in route capture; not isolated variant/state proof

### AccordionSection — react/primitives.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/primitives.tsx](../../apps/web/src/components/editor-workspace/primitives.tsx):34. Category: VUI.

**Usages:** [components/timeline/inspector-section.tsx](../../apps/web/src/components/timeline/inspector-section.tsx): 20, 23

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `open: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 1 explicit state attribute(s), 2 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** AccordionSection

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiSheet — react/sheet.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/sheet.tsx](../../apps/web/src/components/editor-workspace/sheet.tsx):6. Category: VUI.

**Usages:** [components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx): 131, 139, 140, 144; [components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx): 66, 70; [react/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx): 188

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `open: boolean`; `placement: VuiSheetPlacement | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 1 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiSheet

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### Region — react/shell.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: `shell.tsx` (editor workspace, deleted in task 3.7):36. Category: VUI.

**Usages:** `react/shell.tsx` (deleted in task 3.7): 62, 63, 64, 65, 66

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** Region

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiWorkspaceShell — react/shell.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: `shell.tsx` (editor workspace, deleted in task 3.7):54. Category: VUI.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `mode: WorkspaceMode | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiWorkspaceShell

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### VuiTimelineView — react/timeline-view.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: `timeline-view.tsx` (editor workspace, deleted in task 3.7):83. Category: VUI.

**Usages:** No resolved production reference in audited modules. Public package exports and external consumers are not inferred absent.

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 1 explicit state attribute(s), 12 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiTimelineView

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** Not individually captured. No unambiguous mounted-name capture. Internal, public-library, offscreen, lazy, or transient state requires targeted proof.

### WorkspaceSurface — react/workspace.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx):146. Category: VUI.

**Usages:** [react/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx): 194, 195

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 2 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 1 native control node(s), 0 explicit state attribute(s), 4 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** WorkspaceSurface

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 9 associations in JSON.

### VuiEditorWorkspace — react/workspace.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/editor-workspace/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx):191. Category: VUI.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 498; [components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx): 723; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 474

**Primitive evidence:** No scanned third-party primitive import in the local composition graph; native/custom/VUI IO mechanisms may apply. See definition.

**Variants:** `mode: VuiWorkspaceMode`; `open: boolean | undefined`

**Styling:** No arbitrary tw:[…] values found in module. 0 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiEditorWorkspace

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 9 associations in JSON.

### VuiRemotionPreview — remotion/index.tsx

**KEEP** — Retain current definition provisionally; no individually verified remediation finding. This is not approval or complete accessibility/state certification. Source: [apps/web/src/components/timeline/remotion-preview.tsx](../../apps/web/src/components/timeline/remotion-preview.tsx):8. Category: VUI.

**Usages:** [components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx): 530; [components/timeline/timeline-stage.tsx](../../apps/web/src/components/timeline/timeline-stage.tsx): 351; [components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx): 507

**Primitive evidence:** `@remotion/player`

**Variants:** No selected named variant props; full props in JSON.

**Styling:** No arbitrary tw:[…] values found in module. 1 inline style attribute(s); 0 module recipe constant(s). Full literal source in JSON.

**State/accessibility evidence:** 0 native control node(s), 0 explicit state attribute(s), 0 ARIA/role/title/tabindex signal(s). Counts establish inventory only; zero is not automatically a defect. No individual behavioral audit claim for this definition.

**Duplicate candidates:** None in named comparison groups. Similar appearance alone does not establish equivalence.

**Problems:** No individually confirmed defect; KEEP remains provisional, not full state/accessibility approval.

**Recommended canonical component/pattern:** VuiRemotionPreview

**Action:** KEEP. Pattern-level recommendations are not automatic component replacements.

**Screens:** [editor-timeline-320](screenshots/editor-timeline-320.png); [editor-timeline-1440](screenshots/editor-timeline-1440.png); [editor-chat-1440](screenshots/editor-chat-1440.png); [editor-audit-1440](screenshots/editor-audit-1440.png) Observed mounted component name in route capture; not isolated variant/state proof All 9 associations in JSON.

## Glyph catalogues

| Catalogue         | Source                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ic                | [apps/web/src/design-system/icons/index.tsx](../../apps/web/src/design-system/icons/index.tsx):26                                    |
| TRANSITION_GLYPHS | [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx):182 |
| HeadIc            | [apps/web/src/components/timeline/timeline-editor-icons.tsx](../../apps/web/src/components/timeline/timeline-editor-icons.tsx):45    |

## All source modules

Includes APIs, hooks, routing, support JSX, and nonvisual VUI contracts. A module without a named JSX definition is still part of the scan. Tests, fixtures, build output, runtime data, backend-only code and vendored dependencies are excluded from this source-component count.

| Module                                                                                                                                       | JSX definitions                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/types/dom-vendor.d.ts](../../apps/web/src/types/dom-vendor.d.ts)                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/app/app.tsx](../../apps/web/src/app/app.tsx)                                                                                   | App                                                                                                                                         |
| [apps/web/src/app/main.tsx](../../apps/web/src/app/main.tsx)                                                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/app/api-proxy.ts](../../apps/web/src/app/api-proxy.ts)                                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/app/command-palette.tsx](../../apps/web/src/app/command-palette.tsx)                                                           | CommandPalette                                                                                                                              |
| [apps/web/src/app/auth-gate.tsx](../../apps/web/src/app/auth-gate.tsx)                                                                       | AuthGate                                                                                                                                    |
| [apps/web/src/app/history-sync.ts](../../apps/web/src/app/history-sync.ts)                                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/app/serve.ts](../../apps/web/src/app/serve.ts)                                                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/app/toast.tsx](../../apps/web/src/app/toast.tsx)                                                                               | Toast                                                                                                                                       |
| [apps/web/src/stores/as-one-step.ts](../../apps/web/src/stores/as-one-step.ts)                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/stores/timeline-document-store.ts](../../apps/web/src/stores/timeline-document-store.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/stores/editor-chrome-store.ts](../../apps/web/src/stores/editor-chrome-store.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/stores/document-writers.ts](../../apps/web/src/stores/document-writers.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/stores/selection-store.ts](../../apps/web/src/stores/selection-store.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/stores/shell-chrome-store.ts](../../apps/web/src/stores/shell-chrome-store.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/settings/image-provider.ts](../../apps/web/src/models/settings/image-provider.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/settings/capability-views.ts](../../apps/web/src/models/settings/capability-views.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/settings/status-views.ts](../../apps/web/src/models/settings/status-views.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/captions/srt.ts](../../apps/web/src/models/captions/srt.ts)                                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/video/render-job.ts](../../apps/web/src/models/video/render-job.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/materials/materials-seed.ts](../../apps/web/src/models/materials/materials-seed.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/materials/material-vocabulary.ts](../../apps/web/src/models/materials/material-vocabulary.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/source-url.ts](../../apps/web/src/models/core/source-url.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/cn.ts](../../apps/web/src/models/core/cn.ts)                                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/asset-url.ts](../../apps/web/src/models/core/asset-url.ts)                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/routing.ts](../../apps/web/src/models/core/routing.ts)                                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/measures.ts](../../apps/web/src/models/core/measures.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/user-agent.ts](../../apps/web/src/models/core/user-agent.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/active-workspace.ts](../../apps/web/src/models/core/active-workspace.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/format.ts](../../apps/web/src/models/core/format.ts)                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/shell.ts](../../apps/web/src/models/core/shell.ts)                                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/cc-helpers.ts](../../apps/web/src/models/core/cc-helpers.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/css-vars.ts](../../apps/web/src/models/core/css-vars.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/theme.ts](../../apps/web/src/models/core/theme.ts)                                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/set-state.ts](../../apps/web/src/models/core/set-state.ts)                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/core/time.ts](../../apps/web/src/models/core/time.ts)                                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/analysis/pacing-analysis.ts](../../apps/web/src/models/analysis/pacing-analysis.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/analysis/beat-detect.ts](../../apps/web/src/models/analysis/beat-detect.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/image-lab/image-job.ts](../../apps/web/src/models/image-lab/image-job.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/chat-feed.ts](../../apps/web/src/models/chat/chat-feed.ts)                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/chat-focus-descriptors.ts](../../apps/web/src/models/chat/chat-focus-descriptors.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/chat-commands.ts](../../apps/web/src/models/chat/chat-commands.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/chat-log.ts](../../apps/web/src/models/chat/chat-log.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/chat-pane-width.ts](../../apps/web/src/models/chat/chat-pane-width.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/build-chat-envelope.ts](../../apps/web/src/models/chat/build-chat-envelope.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/decision-record.ts](../../apps/web/src/models/chat/decision-record.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/chat-composer.ts](../../apps/web/src/models/chat/chat-composer.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/plan-emotions.ts](../../apps/web/src/models/chat/plan-emotions.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/chat/command-ledger.ts](../../apps/web/src/models/chat/command-ledger.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/images/gallery-filters.ts](../../apps/web/src/models/images/gallery-filters.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/tiers.ts](../../apps/web/src/models/references/tiers.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/reference-vocabulary.ts](../../apps/web/src/models/references/reference-vocabulary.ts)                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/voice-library.ts](../../apps/web/src/models/references/voice-library.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/mention-matching.ts](../../apps/web/src/models/references/mention-matching.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/pool.ts](../../apps/web/src/models/references/pool.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/entity-write.ts](../../apps/web/src/models/references/entity-write.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/ref-transforms.ts](../../apps/web/src/models/references/ref-transforms.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/reference-ops.ts](../../apps/web/src/models/references/reference-ops.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/references/entity-draft.ts](../../apps/web/src/models/references/entity-draft.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/storyboard/storyboard-chunk.ts](../../apps/web/src/models/storyboard/storyboard-chunk.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/storyboard/storyboard-controller.ts](../../apps/web/src/models/storyboard/storyboard-controller.ts)                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/storyboard/parse-loaded-project.ts](../../apps/web/src/models/storyboard/parse-loaded-project.ts)                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/storyboard/document-wire.ts](../../apps/web/src/models/storyboard/document-wire.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/storyboard/editor-doc.ts](../../apps/web/src/models/storyboard/editor-doc.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/storyboard/storyboard-mapper.ts](../../apps/web/src/models/storyboard/storyboard-mapper.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/storyboard/storyboard-authoring-view.ts](../../apps/web/src/models/storyboard/storyboard-authoring-view.ts)             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/admin/admin-errors.ts](../../apps/web/src/models/admin/admin-errors.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/render/render-queue.ts](../../apps/web/src/models/render/render-queue.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/render/export.ts](../../apps/web/src/models/render/export.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/render/draft-request.ts](../../apps/web/src/models/render/draft-request.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/content/filters.ts](../../apps/web/src/models/content/filters.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/content/content-types.ts](../../apps/web/src/models/content/content-types.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/content/note-payload.ts](../../apps/web/src/models/content/note-payload.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/content/project-title.ts](../../apps/web/src/models/content/project-title.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/content/create-content-model.ts](../../apps/web/src/models/content/create-content-model.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/content/feed-item.ts](../../apps/web/src/models/content/feed-item.ts)                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/content/feed-row.ts](../../apps/web/src/models/content/feed-row.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/content/engage-actions.ts](../../apps/web/src/models/content/engage-actions.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/agent/agent-context.ts](../../apps/web/src/models/agent/agent-context.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/agent/artifact-fixture.ts](../../apps/web/src/models/agent/artifact-fixture.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/agent/apply-agent-job.ts](../../apps/web/src/models/agent/apply-agent-job.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/agent/agent-request.ts](../../apps/web/src/models/agent/agent-request.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/agent/agent-wire.ts](../../apps/web/src/models/agent/agent-wire.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/speech/clip.ts](../../apps/web/src/models/speech/clip.ts)                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/speech/gallery-filters.ts](../../apps/web/src/models/speech/gallery-filters.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/script/script-rows.ts](../../apps/web/src/models/script/script-rows.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/script/arc-chapters.ts](../../apps/web/src/models/script/arc-chapters.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/audio/audio-preview-player.ts](../../apps/web/src/models/audio/audio-preview-player.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/clip-templates/shape-templates.ts](../../apps/web/src/models/clip-templates/shape-templates.ts)                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/clip-templates/types.ts](../../apps/web/src/models/clip-templates/types.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/clip-templates/registry.ts](../../apps/web/src/models/clip-templates/registry.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/clip-templates/composition-overlays.ts](../../apps/web/src/models/clip-templates/composition-overlays.ts)               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/clip-templates/composition-config.ts](../../apps/web/src/models/clip-templates/composition-config.ts)                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/preset-apply-sourced.ts](../../apps/web/src/models/presets/preset-apply-sourced.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/element-paths.ts](../../apps/web/src/models/presets/element-paths.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/creative-settings.ts](../../apps/web/src/models/presets/creative-settings.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/element-sources.ts](../../apps/web/src/models/presets/element-sources.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/element-labels.ts](../../apps/web/src/models/presets/element-labels.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/element-push.ts](../../apps/web/src/models/presets/element-push.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/generation-defaults.ts](../../apps/web/src/models/presets/generation-defaults.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/preset-apply.ts](../../apps/web/src/models/presets/preset-apply.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/element-resolution.ts](../../apps/web/src/models/presets/element-resolution.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/presets/element-writes.ts](../../apps/web/src/models/presets/element-writes.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/element-groups.ts](../../apps/web/src/models/timeline/element-groups.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/waveform-bars.ts](../../apps/web/src/models/timeline/waveform-bars.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/gutter-visibility.ts](../../apps/web/src/models/timeline/gutter-visibility.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/timeline-clips.ts](../../apps/web/src/models/timeline/timeline-clips.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/studio-modal-active.ts](../../apps/web/src/models/timeline/studio-modal-active.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/element-catalogue.ts](../../apps/web/src/models/timeline/element-catalogue.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/content-document-adapter.ts](../../apps/web/src/models/timeline/content-document-adapter.ts)                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/audio-fader.ts](../../apps/web/src/models/timeline/audio-fader.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/surface/geometry-probe.ts](../../apps/web/src/controllers/surface/geometry-probe.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/studio-base-storyboard.ts](../../apps/web/src/models/timeline/studio-base-storyboard.ts)                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/preview-frame.ts](../../apps/web/src/models/timeline/preview-frame.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/derived-arrays.ts](../../apps/web/src/models/timeline/derived-arrays.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/motion-document-adapter.ts](../../apps/web/src/models/timeline/motion-document-adapter.ts)                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/media-drag.ts](../../apps/web/src/models/timeline/media-drag.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/content-vui-adapter.ts](../../apps/web/src/models/timeline/content-vui-adapter.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/editor-chrome.ts](../../apps/web/src/models/timeline/editor-chrome.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/media-admission.ts](../../apps/web/src/models/timeline/media-admission.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/media-usage.ts](../../apps/web/src/models/timeline/media-usage.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/motion-vui-adapter.ts](../../apps/web/src/models/timeline/motion-vui-adapter.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/template-preview-lanes.ts](../../apps/web/src/models/timeline/template-preview-lanes.ts)                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/agent-result-scope.ts](../../apps/web/src/models/timeline/agent-result-scope.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/selection-model.ts](../../apps/web/src/models/timeline/selection-model.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/panel-brand.ts](../../apps/web/src/models/timeline/panel-brand.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/time-segments.ts](../../apps/web/src/models/timeline/time-segments.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/motion-editor-model.ts](../../apps/web/src/models/timeline/motion-editor-model.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/media-reconcile.ts](../../apps/web/src/models/timeline/media-reconcile.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/media-seeds.ts](../../apps/web/src/models/timeline/media-seeds.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/ruler-ticks.ts](../../apps/web/src/models/timeline/ruler-ticks.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/audio-decode-url.ts](../../apps/web/src/models/timeline/audio-decode-url.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/template-document-adapter.ts](../../apps/web/src/models/timeline/template-document-adapter.ts)                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/preload-assets.ts](../../apps/web/src/models/timeline/preload-assets.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/clip-layout.ts](../../apps/web/src/models/timeline/clip-layout.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/lane-bookkeeping.ts](../../apps/web/src/models/timeline/lane-bookkeeping.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/playhead-handle.ts](../../apps/web/src/models/timeline/playhead-handle.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/editor-media.ts](../../apps/web/src/models/timeline/editor-media.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/render-derivations.ts](../../apps/web/src/models/timeline/render-derivations.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/timeline-editor-model.ts](../../apps/web/src/models/timeline/timeline-editor-model.ts)                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/render-probe.ts](../../apps/web/src/models/timeline/render-probe.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/content-cross-axis.ts](../../apps/web/src/models/timeline/content-cross-axis.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/effects.ts](../../apps/web/src/models/timeline/effects.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline/timeline-drops.ts](../../apps/web/src/models/timeline/timeline-drops.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/research/source-links.tsx](../../apps/web/src/components/research/source-links.tsx)                                 | SourceLinks                                                                                                                                 |
| [apps/web/src/design-system/components/note.tsx](../../apps/web/src/design-system/components/note.tsx)                                       | Note, Callout                                                                                                                               |
| [apps/web/src/design-system/components/tabs.tsx](../../apps/web/src/design-system/components/tabs.tsx)                                       | TabsRoot, TabsList, TabsTab, TabsPanel                                                                                                      |
| [apps/web/src/design-system/components/audio-preview.tsx](../../apps/web/src/design-system/components/audio-preview.tsx)                     | AudioPreview                                                                                                                                |
| [apps/web/src/design-system/components/color-control.tsx](../../apps/web/src/design-system/components/color-control.tsx)                     | AlphaColorControl                                                                                                                           |
| [apps/web/src/design-system/components/sheet.tsx](../../apps/web/src/design-system/components/sheet.tsx)                                     | Sheet                                                                                                                                       |
| [apps/web/src/design-system/components/field.tsx](../../apps/web/src/design-system/components/field.tsx)                                     | Field                                                                                                                                       |
| [apps/web/src/design-system/components/shimmer.tsx](../../apps/web/src/design-system/components/shimmer.tsx)                                 | Shimmer                                                                                                                                     |
| [apps/web/src/design-system/components/chip.tsx](../../apps/web/src/design-system/components/chip.tsx)                                       | Chip, ChipButton                                                                                                                            |
| [apps/web/src/design-system/components/switch.tsx](../../apps/web/src/design-system/components/switch.tsx)                                   | Switch                                                                                                                                      |
| [apps/web/src/design-system/components/icon-button.tsx](../../apps/web/src/design-system/components/icon-button.tsx)                         | IconButton                                                                                                                                  |
| [apps/web/src/design-system/components/panel.tsx](../../apps/web/src/design-system/components/panel.tsx)                                     | Panel, Section, Control                                                                                                                     |
| [apps/web/src/design-system/components/avatar.tsx](../../apps/web/src/design-system/components/avatar.tsx)                                   | Avatar                                                                                                                                      |
| [apps/web/src/design-system/components/field-label.tsx](../../apps/web/src/design-system/components/field-label.tsx)                         | ML                                                                                                                                          |
| [apps/web/src/design-system/components/menu.tsx](../../apps/web/src/design-system/components/menu.tsx)                                       | Menu, MenuItem, MenuLabel, MenuSeparator                                                                                                    |
| [apps/web/src/design-system/components/button.tsx](../../apps/web/src/design-system/components/button.tsx)                                   | Button, ButtonLink, ButtonLabel                                                                                                             |
| [apps/web/src/design-system/components/modal.tsx](../../apps/web/src/design-system/components/modal.tsx)                                     | Modal                                                                                                                                       |
| [apps/web/src/design-system/components/page.tsx](../../apps/web/src/design-system/components/page.tsx)                                       | Page, PageTitle, PageHeader                                                                                                                 |
| [apps/web/src/design-system/components/theme-toggle.tsx](../../apps/web/src/design-system/components/theme-toggle.tsx)                       | ThemeToggle                                                                                                                                 |
| [apps/web/src/design-system/components/checkbox.tsx](../../apps/web/src/design-system/components/checkbox.tsx)                               | Checkbox                                                                                                                                    |
| [apps/web/src/design-system/patterns/collection.tsx](../../apps/web/src/design-system/patterns/collection.tsx)                               | EmptyState, Pager                                                                                                                           |
| [apps/web/src/design-system/components/select.tsx](../../apps/web/src/design-system/components/select.tsx)                                   | Select                                                                                                                                      |
| [apps/web/src/design-system/components/frame.tsx](../../apps/web/src/design-system/components/frame.tsx)                                     | ExpandGlyph, Frame                                                                                                                          |
| [apps/web/src/design-system/components/input.tsx](../../apps/web/src/design-system/components/input.tsx)                                     | Input, Textarea, SelectInput                                                                                                                |
| [apps/web/src/design-system/components/lightbox.tsx](../../apps/web/src/design-system/components/lightbox.tsx)                               | Lightbox                                                                                                                                    |
| [apps/web/src/components/settings/provider-setup.tsx](../../apps/web/src/components/settings/provider-setup.tsx)                             | ProviderSetup                                                                                                                               |
| [apps/web/src/components/settings/settings-page.tsx](../../apps/web/src/components/settings/settings-page.tsx)                               | SettingsPage                                                                                                                                |
| [apps/web/src/components/settings/capabilities-tab.tsx](../../apps/web/src/components/settings/capabilities-tab.tsx)                         | CapabilitiesTab                                                                                                                             |
| [apps/web/src/components/settings/security-panel.tsx](../../apps/web/src/components/settings/security-panel.tsx)                             | SecurityPanel                                                                                                                               |
| [apps/web/src/components/settings/env-table.tsx](../../apps/web/src/components/settings/env-table.tsx)                                       | EnvTable                                                                                                                                    |
| [apps/web/src/components/settings/state-dot.tsx](../../apps/web/src/components/settings/state-dot.tsx)                                       | StateDot                                                                                                                                    |
| [apps/web/src/components/settings/capability-column.tsx](../../apps/web/src/components/settings/capability-column.tsx)                       | CapabilityColumn                                                                                                                            |
| [apps/web/src/components/settings/security-topics.ts](../../apps/web/src/components/settings/security-topics.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/settings/credits-panel.tsx](../../apps/web/src/components/settings/credits-panel.tsx)                               | CreditsPanel                                                                                                                                |
| [apps/web/src/components/settings/column-head.tsx](../../apps/web/src/components/settings/column-head.tsx)                                   | ColumnHead                                                                                                                                  |
| [apps/web/src/components/settings/provider-list.tsx](../../apps/web/src/components/settings/provider-list.tsx)                               | ProviderList                                                                                                                                |
| [apps/web/src/components/image-lab/chat-bubble.tsx](../../apps/web/src/components/image-lab/chat-bubble.tsx)                                 | Spinner, ChatBubble                                                                                                                         |
| [apps/web/src/components/image-lab/prompt-composer.tsx](../../apps/web/src/components/image-lab/prompt-composer.tsx)                         | PromptComposer                                                                                                                              |
| [apps/web/src/components/images/images-gallery.tsx](../../apps/web/src/components/images/images-gallery.tsx)                                 | ImagesGallery                                                                                                                               |
| [apps/web/src/components/references/scene-cast.tsx](../../apps/web/src/components/references/scene-cast.tsx)                                 | SceneCastPicker                                                                                                                             |
| [apps/web/src/components/references/entity-editor.tsx](../../apps/web/src/components/references/entity-editor.tsx)                           | EntityEditor                                                                                                                                |
| [apps/web/src/components/references/panels.tsx](../../apps/web/src/components/references/panels.tsx)                                         | VoicePicker                                                                                                                                 |
| [apps/web/src/components/references/reference-library.tsx](../../apps/web/src/components/references/reference-library.tsx)                   | ReferenceLibrary, NoteRow, DeleteConfirm                                                                                                    |
| [apps/web/src/components/storyboard/storyboard-view.tsx](../../apps/web/src/components/storyboard/storyboard-view.tsx)                       | BeatCard, StoryboardSurface, StoryboardView                                                                                                 |
| [apps/web/src/components/shell/credit-pill.tsx](../../apps/web/src/components/shell/credit-pill.tsx)                                         | CreditPill                                                                                                                                  |
| [apps/web/src/components/shell/app-sidebar.tsx](../../apps/web/src/components/shell/app-sidebar.tsx)                                         | AppSidebar                                                                                                                                  |
| [apps/web/src/components/shell/breadcrumb.tsx](../../apps/web/src/components/shell/breadcrumb.tsx)                                           | Breadcrumb                                                                                                                                  |
| [apps/web/src/components/shell/bare-shell.tsx](../../apps/web/src/components/shell/bare-shell.tsx)                                           | BareShell                                                                                                                                   |
| [apps/web/src/components/shell/user-menu.tsx](../../apps/web/src/components/shell/user-menu.tsx)                                             | UserMenu                                                                                                                                    |
| [apps/web/src/components/shell/top-bar.tsx](../../apps/web/src/components/shell/top-bar.tsx)                                                 | TopBar                                                                                                                                      |
| [apps/web/src/components/catalog/references-library.tsx](../../apps/web/src/components/catalog/references-library.tsx)                       | ReferenceImage, Detail, DeleteConfirm, ImagesTab, NotesTab, ReferencesLibrary                                                               |
| [apps/web/src/components/catalog/preset-material-picker.tsx](../../apps/web/src/components/catalog/preset-material-picker.tsx)               | MaterialGroupRow, PresetMaterialPicker                                                                                                      |
| [apps/web/src/components/catalog/lazy-preview.tsx](../../apps/web/src/components/catalog/lazy-preview.tsx)                                   | LazyPreview                                                                                                                                 |
| [apps/web/src/components/catalog/library-chrome.tsx](../../apps/web/src/components/catalog/library-chrome.tsx)                               | LibraryHeader                                                                                                                               |
| [apps/web/src/components/catalog/voice-clone-create.tsx](../../apps/web/src/components/catalog/voice-clone-create.tsx)                       | VoiceCloneCreate                                                                                                                            |
| [apps/web/src/components/catalog/built-in-elements.tsx](../../apps/web/src/components/catalog/built-in-elements.tsx)                         | ElementTile, BuiltInTextTiles, BuiltInMotionTiles, BuiltInDataTiles                                                                         |
| [apps/web/src/components/catalog/templates-library.tsx](../../apps/web/src/components/catalog/templates-library.tsx)                         | TemplatesLibrary                                                                                                                            |
| [apps/web/src/components/catalog/presets-library.tsx](../../apps/web/src/components/catalog/presets-library.tsx)                             | PresetEditor, PresetsLibrary                                                                                                                |
| [apps/web/src/components/catalog/materials-library.tsx](../../apps/web/src/components/catalog/materials-library.tsx)                         | MaterialEditor, MaterialsLibrary                                                                                                            |
| [apps/web/src/components/catalog/library-toolbar.tsx](../../apps/web/src/components/catalog/library-toolbar.tsx)                             | LibraryToolbar                                                                                                                              |
| [apps/web/src/components/catalog/voices-library.tsx](../../apps/web/src/components/catalog/voices-library.tsx)                               | VoicesLibrary                                                                                                                               |
| [apps/web/src/components/catalog/material-assets.tsx](../../apps/web/src/components/catalog/material-assets.tsx)                             | MaterialAssets                                                                                                                              |
| [apps/web/src/components/catalog/preset-usage-line.tsx](../../apps/web/src/components/catalog/preset-usage-line.tsx)                         | PresetUsageLine                                                                                                                             |
| [apps/web/src/components/catalog/elements-library.tsx](../../apps/web/src/components/catalog/elements-library.tsx)                           | Group, ElementsLibrary                                                                                                                      |
| [apps/web/src/components/workspace/workspace-switcher.tsx](../../apps/web/src/components/workspace/workspace-switcher.tsx)                   | WorkspaceChip, CreateWorkspaceForm, WorkspaceSwitcher                                                                                       |
| [apps/web/src/components/workspace/workspace-manage.tsx](../../apps/web/src/components/workspace/workspace-manage.tsx)                       | WorkspaceManage, GeneralPanel, MembersPanel, DangerPanel                                                                                    |
| [apps/web/src/components/admin/god-directory.tsx](../../apps/web/src/components/admin/god-directory.tsx)                                     | GodDirectory, CreateWorkspace, ProjectDetail                                                                                                |
| [apps/web/src/components/admin/god-shell.tsx](../../apps/web/src/components/admin/god-shell.tsx)                                             | GodModePage                                                                                                                                 |
| [apps/web/src/components/admin/god-workspace-detail.tsx](../../apps/web/src/components/admin/god-workspace-detail.tsx)                       | GodWorkspaceDetail                                                                                                                          |
| [apps/web/src/components/admin/god-pager.tsx](../../apps/web/src/components/admin/god-pager.tsx)                                             | GodPager                                                                                                                                    |
| [apps/web/src/components/admin/confirm-action.tsx](../../apps/web/src/components/admin/confirm-action.tsx)                                   | ConfirmAction                                                                                                                               |
| [apps/web/src/components/admin/god-user-detail.tsx](../../apps/web/src/components/admin/god-user-detail.tsx)                                 | GodUserDetail                                                                                                                               |
| [apps/web/src/components/admin/god-instance.tsx](../../apps/web/src/components/admin/god-instance.tsx)                                       | GodInstance, OverviewLink, Overview, Authentication, Audit                                                                                  |
| [apps/web/src/components/content/content-table.tsx](../../apps/web/src/components/content/content-table.tsx)                                 | ContentRow, ContentToolbar, ContentTable                                                                                                    |
| [apps/web/src/components/speech/composer-options.tsx](../../apps/web/src/components/speech/composer-options.tsx)                             | OptionPopover, ProviderOptions, VoiceOptions                                                                                                |
| [apps/web/src/components/speech/speech-gallery.tsx](../../apps/web/src/components/speech/speech-gallery.tsx)                                 | SpeechGallery                                                                                                                               |
| [apps/web/src/components/speech/speech-bubble.tsx](../../apps/web/src/components/speech/speech-bubble.tsx)                                   | SpeechBubble                                                                                                                                |
| [apps/web/src/components/script/script-table.tsx](../../apps/web/src/components/script/script-table.tsx)                                     | Prose, Frame, Stat, Row, ScriptTable                                                                                                        |
| [apps/web/src/components/script/script-view.tsx](../../apps/web/src/components/script/script-view.tsx)                                       | ScriptView                                                                                                                                  |
| [apps/web/src/design-system/icons/index.tsx](../../apps/web/src/design-system/icons/index.tsx)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/clip-templates/custom-clip-templates.tsx](../../apps/web/src/components/clip-templates/custom-clip-templates.tsx)   | CustomTilePreview, CustomTemplatesBlock, SaveAsMotionBlock                                                                                  |
| [apps/web/src/components/clip-templates/template-fields-editor.tsx](../../apps/web/src/components/clip-templates/template-fields-editor.tsx) | TemplateFieldsEditor, TemplateFieldInput, TemplateImageField                                                                                |
| [apps/web/src/components/account/preferences-panel.tsx](../../apps/web/src/components/account/preferences-panel.tsx)                         | PreferencesPanel                                                                                                                            |
| [apps/web/src/components/account/security-panel.tsx](../../apps/web/src/components/account/security-panel.tsx)                               | PasswordForm, Sessions, SecurityPanel                                                                                                       |
| [apps/web/src/components/account/account-group.tsx](../../apps/web/src/components/account/account-group.tsx)                                 | AccountGroup, FormOutcome, LabelledInput                                                                                                    |
| [apps/web/src/components/account/profile-panel.tsx](../../apps/web/src/components/account/profile-panel.tsx)                                 | ProfilePanel                                                                                                                                |
| [apps/web/src/components/timeline/timeline-clip-bar.tsx](../../apps/web/src/components/timeline/timeline-clip-bar.tsx)                       | TimelineClipBar                                                                                                                             |
| [apps/web/src/components/timeline/timeline-rail.tsx](../../apps/web/src/components/timeline/timeline-rail.tsx)                               | TimelineRail                                                                                                                                |
| [apps/web/src/components/timeline/template-toolbar.tsx](../../apps/web/src/components/timeline/template-toolbar.tsx)                         | TemplateToolbar                                                                                                                             |
| [apps/web/src/components/timeline/timeline-toolbar-frame.tsx](../../apps/web/src/components/timeline/timeline-toolbar-frame.tsx)             | TimelineToolbarFrame                                                                                                                        |
| [apps/web/src/components/timeline/project-materials-drawer.tsx](../../apps/web/src/components/timeline/project-materials-drawer.tsx)         | ProjectMaterialsDrawer                                                                                                                      |
| [apps/web/src/components/timeline/timeline-phone-workspace.tsx](../../apps/web/src/components/timeline/timeline-phone-workspace.tsx)         | TimelinePhoneWorkspace                                                                                                                      |
| [apps/web/src/components/timeline/timeline-editor-panels.tsx](../../apps/web/src/components/timeline/timeline-editor-panels.tsx)             | TextPresetPreview, SegmentStoryboardReel, ExactTimelinePreview, TransitionPreview, TransitionsPanel, ProjectReferencesPopover, EffectsPanel |
| [apps/web/src/components/timeline/edit-item-modal.tsx](../../apps/web/src/components/timeline/edit-item-modal.tsx)                           | EditTimelineItemModalHost, EditModal                                                                                                        |
| [apps/web/src/components/timeline/timeline-editor-icons.tsx](../../apps/web/src/components/timeline/timeline-editor-icons.tsx)               | UndoIcon, JumpIcon, AspectIcon                                                                                                              |
| [apps/web/src/design-system/components/popover.tsx](../../apps/web/src/design-system/components/popover.tsx)                                 | Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle                                                                        |
| [apps/web/src/components/timeline/template-timeline.tsx](../../apps/web/src/components/timeline/template-timeline.tsx)                       | TemplateTimelineViewport, TemplateRangeBar                                                                                                  |
| [apps/web/src/components/timeline/insights-canvas.tsx](../../apps/web/src/components/timeline/insights-canvas.tsx)                           | InsightsCanvas                                                                                                                              |
| [apps/web/src/components/timeline/timeline-chat-panel.tsx](../../apps/web/src/components/timeline/timeline-chat-panel.tsx)                   | TimelineChatPanel                                                                                                                           |
| [apps/web/src/components/timeline/clip-canvas.tsx](../../apps/web/src/components/timeline/clip-canvas.tsx)                                   | ClipBox, Slider, AudioControls, VideoVolumeControl, ClipControls, TransformSection                                                          |
| [apps/web/src/components/timeline/clip-property-groups.tsx](../../apps/web/src/components/timeline/clip-property-groups.tsx)                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/timeline/clip-frame-trim.tsx](../../apps/web/src/components/timeline/clip-frame-trim.tsx)                           | ClipFrameTrim                                                                                                                               |
| [apps/web/src/components/timeline/timeline-template-panel.tsx](../../apps/web/src/components/timeline/timeline-template-panel.tsx)           | TimelineTemplateEditorModal, TimelineTemplatesPanel                                                                                         |
| [apps/web/src/components/timeline/timeline-editor.tsx](../../apps/web/src/components/timeline/timeline-editor.tsx)                           | TimelineEditor                                                                                                                              |
| [apps/web/src/components/timeline/timeline-scene-drawer.tsx](../../apps/web/src/components/timeline/timeline-scene-drawer.tsx)               | TimelineSceneDrawer                                                                                                                         |
| [apps/web/src/components/timeline/motion/motion-studio-modal.tsx](../../apps/web/src/components/timeline/motion/motion-studio-modal.tsx)     | MotionStudioModal                                                                                                                           |
| [apps/web/src/components/timeline/motion/motion-editor.tsx](../../apps/web/src/components/timeline/motion/motion-editor.tsx)                 | MotionEditor, MotionPresetLibraryBlock                                                                                                      |
| [apps/web/src/components/timeline/motion/motion-layer-sections.tsx](../../apps/web/src/components/timeline/motion/motion-layer-sections.tsx) | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/timeline/motion/motion-toolbar.tsx](../../apps/web/src/components/timeline/motion/motion-toolbar.tsx)               | MotionToolbar                                                                                                                               |
| [apps/web/src/components/timeline/motion/motion-keyframes.ts](../../apps/web/src/components/timeline/motion/motion-keyframes.ts)             | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/timeline/motion/motion-curve.tsx](../../apps/web/src/components/timeline/motion/motion-curve.tsx)                   | CurvePath, TrackCurve                                                                                                                       |
| [apps/web/src/components/timeline/motion/motion-timeline.tsx](../../apps/web/src/components/timeline/motion/motion-timeline.tsx)             | MotionTimelineViewport                                                                                                                      |
| [apps/web/src/design-system/patterns/transport.tsx](../../apps/web/src/design-system/patterns/transport.tsx)                                 | TransportPlay, TransportTimecode                                                                                                            |
| [apps/web/src/components/timeline/timeline-bottom-bar.tsx](../../apps/web/src/components/timeline/timeline-bottom-bar.tsx)                   | TimelineBottomBar                                                                                                                           |
| [apps/web/src/components/timeline/studio-heading.tsx](../../apps/web/src/components/timeline/studio-heading.tsx)                             | StudioHeading                                                                                                                               |
| [apps/web/src/components/timeline/studio-action-bar.tsx](../../apps/web/src/components/timeline/studio-action-bar.tsx)                       | StudioActionBar                                                                                                                             |
| [apps/web/src/components/timeline/audio/audio-waveform.tsx](../../apps/web/src/components/timeline/audio/audio-waveform.tsx)                 | Waveform                                                                                                                                    |
| [apps/web/src/components/timeline/inspector-section.tsx](../../apps/web/src/components/timeline/inspector-section.tsx)                       | AccordionSection                                                                                                                            |
| [apps/web/src/components/timeline/timeline-base-lane.tsx](../../apps/web/src/components/timeline/timeline-base-lane.tsx)                     | TimelineBaseLane                                                                                                                            |
| [apps/web/src/components/timeline/timeline-gutter.tsx](../../apps/web/src/components/timeline/timeline-gutter.tsx)                           | TimelineGutter                                                                                                                              |
| [apps/web/src/components/timeline/timeline-toolbar.tsx](../../apps/web/src/components/timeline/timeline-toolbar.tsx)                         | TimelineToolbar                                                                                                                             |
| [apps/web/src/components/timeline/timeline-template-pickers.tsx](../../apps/web/src/components/timeline/timeline-template-pickers.tsx)       | Chevron, PreviewPicker, TitlePresetPicker, TransitionPresetPicker, StockSfxPicker                                                           |
| [apps/web/src/components/timeline/timeline-stage.tsx](../../apps/web/src/components/timeline/timeline-stage.tsx)                             | TimelineStage                                                                                                                               |
| [apps/web/src/components/timeline/mention-textarea.tsx](../../apps/web/src/components/timeline/mention-textarea.tsx)                         | MentionTextarea                                                                                                                             |
| [apps/web/src/components/timeline/scene-reference-chips.tsx](../../apps/web/src/components/timeline/scene-reference-chips.tsx)               | SceneReferenceChips                                                                                                                         |
| [apps/web/src/components/timeline/timeline-panel-host.tsx](../../apps/web/src/components/timeline/timeline-panel-host.tsx)                   | TimelinePanelHost                                                                                                                           |
| [apps/web/src/components/timeline/clip-range.tsx](../../apps/web/src/components/timeline/clip-range.tsx)                                     | ClipRange                                                                                                                                   |
| [apps/web/src/components/timeline/elements-panel.tsx](../../apps/web/src/components/timeline/elements-panel.tsx)                             | ElementsPanel                                                                                                                               |
| [apps/web/src/components/timeline/timeline-tracks.tsx](../../apps/web/src/components/timeline/timeline-tracks.tsx)                           | TimelineTracks                                                                                                                              |
| [apps/web/src/components/timeline/timeline-lane.tsx](../../apps/web/src/components/timeline/timeline-lane.tsx)                               | LaneEnvProvider, FreeClipRange, EffectClipView, MediaClipView, TimelineLane                                                                 |
| [apps/web/src/components/timeline/timeline-clip-inspector.tsx](../../apps/web/src/components/timeline/timeline-clip-inspector.tsx)           | RevealControls, TimelineClipInspector, TimelineClipInspectorSheet                                                                           |
| [apps/web/src/components/timeline/media/media-browser.tsx](../../apps/web/src/components/timeline/media/media-browser.tsx)                   | AllMediaPanel                                                                                                                               |
| [apps/web/src/components/timeline/media/media-hover-preview.tsx](../../apps/web/src/components/timeline/media/media-hover-preview.tsx)       | MediaHoverPreview                                                                                                                           |
| [apps/web/src/components/timeline/media/media-thumb.tsx](../../apps/web/src/components/timeline/media/media-thumb.tsx)                       | VideoPoster                                                                                                                                 |
| [apps/web/src/components/timeline/media/stock-browser.tsx](../../apps/web/src/components/timeline/media/stock-browser.tsx)                   | StockAttribution, StockAudioResults, StockPanel                                                                                             |
| [apps/web/src/components/timeline/scene-editor-drawer.tsx](../../apps/web/src/components/timeline/scene-editor-drawer.tsx)                   | SceneEditorDrawer, FrameSlot, RailField                                                                                                     |
| [apps/web/src/components/editor/modals.tsx](../../apps/web/src/components/editor/modals.tsx)                                                 | TagsInput, NoteModal                                                                                                                        |
| [apps/web/src/components/editor/launcher.tsx](../../apps/web/src/components/editor/launcher.tsx)                                             | Launcher, Setup, Chip, QueueStatusPanel, DoneView                                                                                           |
| [apps/web/src/components/editor/preset-picker.tsx](../../apps/web/src/components/editor/preset-picker.tsx)                                   | PresetPickerModal, PresetOverrideWarning                                                                                                    |
| [apps/web/src/components/editor/storyboard-export.tsx](../../apps/web/src/components/editor/storyboard-export.tsx)                           | StoryboardView, StoryboardDoc                                                                                                               |
| [apps/web/src/components/editor/render-status-body.tsx](../../apps/web/src/components/editor/render-status-body.tsx)                         | RenderStatusBody                                                                                                                            |
| [apps/web/src/components/editor/workspaces.tsx](../../apps/web/src/components/editor/workspaces.tsx)                                         | ErrBar, TextWorkspace                                                                                                                       |
| [apps/web/src/components/editor/chat-pinned-decision.tsx](../../apps/web/src/components/editor/chat-pinned-decision.tsx)                     | PinnedDecision                                                                                                                              |
| [apps/web/src/components/editor/chat-run.tsx](../../apps/web/src/components/editor/chat-run.tsx)                                             | SubmittedContext, ActivityItem, RunResult, StatusAction, RunView                                                                            |
| [apps/web/src/components/editor/editor-topbar.tsx](../../apps/web/src/components/editor/editor-topbar.tsx)                                   | SaveBadge, ModeTabs, SubmitButton, EditorTopbar                                                                                             |
| [apps/web/src/components/editor/chat-run-cards.tsx](../../apps/web/src/components/editor/chat-run-cards.tsx)                                 | ThinkingCard, WorkflowProgressCard, RunActivity                                                                                             |
| [apps/web/src/components/editor/audit-panel.tsx](../../apps/web/src/components/editor/audit-panel.tsx)                                       | LedgerCard, ToolRow, ChangeCard, AuditPanel                                                                                                 |
| [apps/web/src/components/editor/panel-shell.tsx](../../apps/web/src/components/editor/panel-shell.tsx)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor/studio.tsx](../../apps/web/src/components/editor/studio.tsx)                                                 | DurationField, SceneStudio, SceneBoard, SceneList                                                                                           |
| [apps/web/src/components/editor/text-provider-select.tsx](../../apps/web/src/components/editor/text-provider-select.tsx)                     | TextProviderSelect, TextProviderPanel                                                                                                       |
| [apps/web/src/components/editor/panel-rows.ts](../../apps/web/src/components/editor/panel-rows.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor/create-materials.tsx](../../apps/web/src/components/editor/create-materials.tsx)                             | CreateMaterials                                                                                                                             |
| [apps/web/src/components/editor/chat-blocker-batch.tsx](../../apps/web/src/components/editor/chat-blocker-batch.tsx)                         | BlockerBatch                                                                                                                                |
| [apps/web/src/components/editor/chat-pane-resize.tsx](../../apps/web/src/components/editor/chat-pane-resize.tsx)                             | ChatPaneResizeHandle                                                                                                                        |
| [apps/web/src/components/editor/export-menu.tsx](../../apps/web/src/components/editor/export-menu.tsx)                                       | ExportMenu                                                                                                                                  |
| [apps/web/src/components/editor/reveal-entities.ts](../../apps/web/src/components/editor/reveal-entities.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor/chat-story-plan.tsx](../../apps/web/src/components/editor/chat-story-plan.tsx)                               | SectionRow, StoryPlanSummary                                                                                                                |
| [apps/web/src/components/editor/editor-settings.tsx](../../apps/web/src/components/editor/editor-settings.tsx)                               | StylePanel, DirectionFields, SwatchGroup, VoiceOptionList, SettingsPanel, StyleReferencePicker                                              |
| [apps/web/src/components/editor/references.tsx](../../apps/web/src/components/editor/references.tsx)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor/chat-markdown.tsx](../../apps/web/src/components/editor/chat-markdown.tsx)                                   | ChatMarkdown                                                                                                                                |
| [apps/web/src/components/editor/chat-output-cards.tsx](../../apps/web/src/components/editor/chat-output-cards.tsx)                           | ResearchCard, AgentErrorCard, OutcomeCard, CreditMeter, CreditLimitCard, ChatOutput                                                         |
| [apps/web/src/components/editor/chat-split.tsx](../../apps/web/src/components/editor/chat-split.tsx)                                         | ChatSplit                                                                                                                                   |
| [apps/web/src/components/editor/chat-panel-harness.tsx](../../apps/web/src/components/editor/chat-panel-harness.tsx)                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor/panel-groups.ts](../../apps/web/src/components/editor/panel-groups.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor/panel-copy.ts](../../apps/web/src/components/editor/panel-copy.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor/editor-captions.tsx](../../apps/web/src/components/editor/editor-captions.tsx)                               | CaptionsPanel, Lbl, Swatch                                                                                                                  |
| [apps/web/src/components/editor/chat-clarification-card.tsx](../../apps/web/src/components/editor/chat-clarification-card.tsx)               | ClarificationCard                                                                                                                           |
| [apps/web/src/components/editor/editor-chat.tsx](../../apps/web/src/components/editor/editor-chat.tsx)                                       | ChatPanel                                                                                                                                   |
| [apps/web/src/components/editor/chat-composer-box.tsx](../../apps/web/src/components/editor/chat-composer-box.tsx)                           | ChatComposerBox                                                                                                                             |
| [apps/web/src/components/editor/project-setup.tsx](../../apps/web/src/components/editor/project-setup.tsx)                                   | ProjectSetup                                                                                                                                |
| [apps/web/src/components/editor/phone-workspace.tsx](../../apps/web/src/components/editor/phone-workspace.tsx)                               | PhoneWorkspace                                                                                                                              |
| [apps/web/src/components/editor/create-content.tsx](../../apps/web/src/components/editor/create-content.tsx)                                 | CreateContent                                                                                                                               |
| [apps/web/src/hooks/ui/use-overlay.ts](../../apps/web/src/hooks/ui/use-overlay.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/ui/use-sidebar-collapsed.ts](../../apps/web/src/hooks/ui/use-sidebar-collapsed.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/ui/use-theme.ts](../../apps/web/src/hooks/ui/use-theme.ts)                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/settings/use-provider-config.ts](../../apps/web/src/hooks/settings/use-provider-config.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/settings/use-global-keys.ts](../../apps/web/src/hooks/settings/use-global-keys.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/settings/use-image-provider-status.ts](../../apps/web/src/hooks/settings/use-image-provider-status.ts)                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/settings/use-credit-console.ts](../../apps/web/src/hooks/settings/use-credit-console.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/settings/use-settings-columns.ts](../../apps/web/src/hooks/settings/use-settings-columns.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/settings/use-capabilities.ts](../../apps/web/src/hooks/settings/use-capabilities.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/video/use-video-render.ts](../../apps/web/src/hooks/video/use-video-render.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/speech-lab/use-speech-session.ts](../../apps/web/src/hooks/speech-lab/use-speech-session.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/image-lab/use-image-session.ts](../../apps/web/src/hooks/image-lab/use-image-session.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/image-lab/use-image-service-health.ts](../../apps/web/src/hooks/image-lab/use-image-service-health.ts)                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/image-lab/use-reference-picker.ts](../../apps/web/src/hooks/image-lab/use-reference-picker.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/auth/use-sign-out.ts](../../apps/web/src/hooks/auth/use-sign-out.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/auth/use-sign-in.ts](../../apps/web/src/hooks/auth/use-sign-in.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/auth/use-invitation.ts](../../apps/web/src/hooks/auth/use-invitation.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/storyboard/use-storyboard-draft.ts](../../apps/web/src/hooks/storyboard/use-storyboard-draft.ts)                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/catalog/use-content-catalogue.ts](../../apps/web/src/hooks/catalog/use-content-catalogue.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/workspace/use-active-workspace.ts](../../apps/web/src/hooks/workspace/use-active-workspace.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/workspace/use-workspace-admin.ts](../../apps/web/src/hooks/workspace/use-workspace-admin.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/workspace/use-workspace-registry.ts](../../apps/web/src/hooks/workspace/use-workspace-registry.ts)                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/admin/use-admin-audit.ts](../../apps/web/src/hooks/admin/use-admin-audit.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/admin/use-admin-directory.ts](../../apps/web/src/hooks/admin/use-admin-directory.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/admin/use-admin-actions.ts](../../apps/web/src/hooks/admin/use-admin-actions.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/admin/use-registration-policy.ts](../../apps/web/src/hooks/admin/use-registration-policy.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/content/use-content-feed.ts](../../apps/web/src/hooks/content/use-content-feed.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-remotion-playhead.ts](../../apps/web/src/hooks/timeline/use-remotion-playhead.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-preview-composition.ts](../../apps/web/src/hooks/timeline/use-preview-composition.ts)                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-playback-rate.ts](../../apps/web/src/hooks/timeline/use-playback-rate.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-reference-usage.ts](../../apps/web/src/hooks/timeline/use-reference-usage.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-track-flags.ts](../../apps/web/src/hooks/timeline/use-track-flags.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-timeline-zoom.ts](../../apps/web/src/hooks/timeline/use-timeline-zoom.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-tts-status.ts](../../apps/web/src/hooks/timeline/use-tts-status.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-effect-ops.ts](../../apps/web/src/hooks/timeline/use-effect-ops.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-canvas-selection.ts](../../apps/web/src/hooks/timeline/use-canvas-selection.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-transition-ops.ts](../../apps/web/src/hooks/timeline/use-transition-ops.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-voice-sample.ts](../../apps/web/src/hooks/timeline/use-voice-sample.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-base-track.ts](../../apps/web/src/hooks/timeline/use-base-track.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-clip-position.ts](../../apps/web/src/hooks/timeline/use-clip-position.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-follow-playhead.ts](../../apps/web/src/hooks/timeline/use-follow-playhead.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-content-timeline.ts](../../apps/web/src/hooks/timeline/use-content-timeline.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-transition-target.ts](../../apps/web/src/hooks/timeline/use-transition-target.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-selection.ts](../../apps/web/src/hooks/timeline/use-selection.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-captions.ts](../../apps/web/src/hooks/timeline/use-captions.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-selection-actions.ts](../../apps/web/src/hooks/timeline/use-selection-actions.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-clip-ops.ts](../../apps/web/src/hooks/timeline/use-clip-ops.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/remotion-preload.ts](../../apps/web/src/hooks/timeline/remotion-preload.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-hook-variants.ts](../../apps/web/src/hooks/timeline/use-hook-variants.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-scene-ops.ts](../../apps/web/src/hooks/timeline/use-scene-ops.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-marquee.ts](../../apps/web/src/hooks/timeline/use-marquee.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-video-overlay-ops.ts](../../apps/web/src/hooks/timeline/use-video-overlay-ops.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-keyboard-shortcuts.ts](../../apps/web/src/hooks/timeline/use-keyboard-shortcuts.ts)                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-scene-generation.ts](../../apps/web/src/hooks/timeline/use-scene-generation.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-free-clip-actions.ts](../../apps/web/src/hooks/timeline/use-free-clip-actions.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-scene-timing.ts](../../apps/web/src/hooks/timeline/use-scene-timing.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-beat-grid.ts](../../apps/web/src/hooks/timeline/use-beat-grid.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-text-overlay-ops.ts](../../apps/web/src/hooks/timeline/use-text-overlay-ops.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-visual-clip-ops.ts](../../apps/web/src/hooks/timeline/use-visual-clip-ops.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-aspect-ratio.ts](../../apps/web/src/hooks/timeline/use-aspect-ratio.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-audio-ops.ts](../../apps/web/src/hooks/timeline/use-audio-ops.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-playhead.ts](../../apps/web/src/hooks/timeline/use-playhead.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-pacing-insights.ts](../../apps/web/src/hooks/timeline/use-pacing-insights.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-content-vui-gestures.ts](../../apps/web/src/hooks/timeline/use-content-vui-gestures.ts)                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-scene-refs.ts](../../apps/web/src/hooks/timeline/use-scene-refs.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-timeline-rows.ts](../../apps/web/src/hooks/timeline/use-timeline-rows.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/timeline/use-overlay-authoring.ts](../../apps/web/src/hooks/timeline/use-overlay-authoring.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-blockers.ts](../../apps/web/src/hooks/editor/use-blockers.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-content-persistence.ts](../../apps/web/src/hooks/editor/use-content-persistence.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-timeline-templates.ts](../../apps/web/src/hooks/editor/use-timeline-templates.ts)                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-agent-apply.ts](../../apps/web/src/hooks/editor/use-agent-apply.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-chat-pane-width.ts](../../apps/web/src/hooks/editor/use-chat-pane-width.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-project-load.ts](../../apps/web/src/hooks/editor/use-project-load.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-media-reconcile.ts](../../apps/web/src/hooks/editor/use-media-reconcile.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-chat-session.ts](../../apps/web/src/hooks/editor/use-chat-session.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-phone-layout.ts](../../apps/web/src/hooks/editor/use-phone-layout.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-creative-settings.ts](../../apps/web/src/hooks/editor/use-creative-settings.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-project-materials-context.ts](../../apps/web/src/hooks/editor/use-project-materials-context.ts)               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-command-stack.ts](../../apps/web/src/hooks/editor/use-command-stack.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-render-flow.ts](../../apps/web/src/hooks/editor/use-render-flow.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-chat-scroll.ts](../../apps/web/src/hooks/editor/use-chat-scroll.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-content-agent.ts](../../apps/web/src/hooks/editor/use-content-agent.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-live-mirrors.ts](../../apps/web/src/hooks/editor/use-live-mirrors.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-coarse-pointer.ts](../../apps/web/src/hooks/editor/use-coarse-pointer.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-clamp-menu.ts](../../apps/web/src/hooks/editor/use-clamp-menu.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-defaulter-names.ts](../../apps/web/src/hooks/editor/use-defaulter-names.ts)                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-debounced-save.ts](../../apps/web/src/hooks/editor/use-debounced-save.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-render-poll.ts](../../apps/web/src/hooks/editor/use-render-poll.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-editor-sheet-bounds.ts](../../apps/web/src/hooks/editor/use-editor-sheet-bounds.ts)                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-initial-run.ts](../../apps/web/src/hooks/editor/use-initial-run.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-preset-selection.ts](../../apps/web/src/hooks/editor/use-preset-selection.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-reference-library.ts](../../apps/web/src/hooks/editor/use-reference-library.ts)                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/hooks/editor/use-create-project.ts](../../apps/web/src/hooks/editor/use-create-project.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/workspaces.ts](../../apps/web/src/api/workspaces.ts)                                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/base.ts](../../apps/web/src/api/base.ts)                                                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/blockers.ts](../../apps/web/src/api/blockers.ts)                                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/credits.ts](../../apps/web/src/api/credits.ts)                                                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/speech.ts](../../apps/web/src/api/speech.ts)                                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/projects.ts](../../apps/web/src/api/projects.ts)                                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/image-gen.ts](../../apps/web/src/api/image-gen.ts)                                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/workspace-admin.ts](../../apps/web/src/api/workspace-admin.ts)                                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/settings.ts](../../apps/web/src/api/settings.ts)                                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/admin.ts](../../apps/web/src/api/admin.ts)                                                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/capabilities.ts](../../apps/web/src/api/capabilities.ts)                                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/chat.ts](../../apps/web/src/api/chat.ts)                                                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/templates.ts](../../apps/web/src/api/templates.ts)                                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/video-jobs.ts](../../apps/web/src/api/video-jobs.ts)                                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/workspace-catalogue.ts](../../apps/web/src/api/workspace-catalogue.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/image-provider.ts](../../apps/web/src/api/image-provider.ts)                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/voice-clones.ts](../../apps/web/src/api/voice-clones.ts)                                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/feed.ts](../../apps/web/src/api/feed.ts)                                                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/materials.ts](../../apps/web/src/api/materials.ts)                                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/project-render.ts](../../apps/web/src/api/project-render.ts)                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/client.ts](../../apps/web/src/api/client.ts)                                                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/presets.ts](../../apps/web/src/api/presets.ts)                                                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/references.ts](../../apps/web/src/api/references.ts)                                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/storyboard-authoring.ts](../../apps/web/src/api/storyboard-authoring.ts)                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/media.ts](../../apps/web/src/api/media.ts)                                                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/reference-writes.ts](../../apps/web/src/api/reference-writes.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/api/auth.ts](../../apps/web/src/api/auth.ts)                                                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/pages/settings.tsx](../../apps/web/src/pages/settings.tsx)                                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/pages/create-form.tsx](../../apps/web/src/pages/create-form.tsx)                                                               | CreateFormPage                                                                                                                              |
| [apps/web/src/pages/god-mode.tsx](../../apps/web/src/pages/god-mode.tsx)                                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/pages/content.tsx](../../apps/web/src/pages/content.tsx)                                                                       | ContentPage                                                                                                                                 |
| [apps/web/src/pages/account.tsx](../../apps/web/src/pages/account.tsx)                                                                       | AccountPage                                                                                                                                 |
| [apps/web/src/pages/invite.tsx](../../apps/web/src/pages/invite.tsx)                                                                         | InvitePage                                                                                                                                  |
| [apps/web/src/pages/library.tsx](../../apps/web/src/pages/library.tsx)                                                                       | LibraryPage                                                                                                                                 |
| [apps/web/src/pages/video.tsx](../../apps/web/src/pages/video.tsx)                                                                           | VideoPage                                                                                                                                   |
| [apps/web/src/pages/content-editor.tsx](../../apps/web/src/pages/content-editor.tsx)                                                         | ContentEditorPage                                                                                                                           |
| [apps/web/src/pages/workspace.tsx](../../apps/web/src/pages/workspace.tsx)                                                                   | WorkspacePage                                                                                                                               |
| [apps/web/src/pages/sign-in.tsx](../../apps/web/src/pages/sign-in.tsx)                                                                       | SignInPage                                                                                                                                  |
| [apps/web/src/pages/image-lab.tsx](../../apps/web/src/pages/image-lab.tsx)                                                                   | ImageLabPage                                                                                                                                |
| [apps/web/src/pages/speech.tsx](../../apps/web/src/pages/speech.tsx)                                                                         | SpeechPage                                                                                                                                  |
| [apps/web/src/pages/speech-lab.tsx](../../apps/web/src/pages/speech-lab.tsx)                                                                 | SpeechLabPage                                                                                                                               |
| [apps/web/src/pages/images.tsx](../../apps/web/src/pages/images.tsx)                                                                         | ImagesPage                                                                                                                                  |
| `controllers/keyboard/keyboard.ts` (no production consumer; deleted in task 4.10)                                                            | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/surface/surface.ts](../../apps/web/src/controllers/surface/surface.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/surface/scroll-writer.ts](../../apps/web/src/controllers/surface/scroll-writer.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/a11y/a11y.ts](../../apps/web/src/controllers/a11y/a11y.ts)                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/media/environment.ts](../../apps/web/src/services/media/environment.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/overlay/overlay-stack.ts](../../apps/web/src/controllers/overlay/overlay-stack.ts)                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/overlay/focus-trap.ts](../../apps/web/src/controllers/overlay/focus-trap.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/a11y/motion.ts](../../apps/web/src/controllers/a11y/motion.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/surface/interpreter.ts](../../apps/web/src/controllers/surface/interpreter.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/paint/canvas-backend.ts](../../apps/web/src/services/paint/canvas-backend.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/paint/palette.ts](../../apps/web/src/services/paint/palette.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/keyboard/keymap.ts](../../apps/web/src/controllers/keyboard/keymap.ts)                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/paint/scene.ts](../../apps/web/src/services/paint/scene.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/paint/paint.ts](../../apps/web/src/services/paint/paint.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/frame-clock/clock.ts](../../apps/web/src/services/frame-clock/clock.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/surface/query.ts](../../apps/web/src/controllers/surface/query.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/surface/sparse-dom.ts](../../apps/web/src/controllers/surface/sparse-dom.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/overlay/focusable.ts](../../apps/web/src/controllers/overlay/focusable.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor-workspace/keyboard-scope.tsx](../../apps/web/src/components/editor-workspace/keyboard-scope.tsx)             | VuiKeyboardScope                                                                                                                            |
| `shell.tsx` (editor workspace, deleted in task 3.7)                                                                                          | Region, VuiWorkspaceShell                                                                                                                   |
| `preview.tsx` (editor workspace, deleted in task 3.7)                                                                                        | VuiPreviewFrame, VuiTimecode, VuiRendererTransport, VuiInspector, VuiStatus                                                                 |
| [apps/web/src/components/editor-workspace/sheet.tsx](../../apps/web/src/components/editor-workspace/sheet.tsx)                               | VuiSheet                                                                                                                                    |
| `timeline-view.tsx` (editor workspace, deleted in task 3.7)                                                                                  | VuiTimelineView                                                                                                                             |
| [apps/web/src/controllers/overlay/persistent.ts](../../apps/web/src/controllers/overlay/persistent.ts)                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor-workspace/primitives.tsx](../../apps/web/src/components/editor-workspace/primitives.tsx)                     | VuiPreviewStage, VuiTransport, VuiInspectorRail, AccordionSection                                                                           |
| [apps/web/src/hooks/editor-workspace/store-bindings.ts](../../apps/web/src/hooks/editor-workspace/store-bindings.ts)                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/components/editor-workspace/workspace.tsx](../../apps/web/src/components/editor-workspace/workspace.tsx)                       | WorkspaceSurface, VuiEditorWorkspace                                                                                                        |
| [apps/web/src/components/editor-workspace/overlay.tsx](../../apps/web/src/components/editor-workspace/overlay.tsx)                           | VuiOverlay                                                                                                                                  |
| [apps/web/src/components/timeline/remotion-preview.tsx](../../apps/web/src/components/timeline/remotion-preview.tsx)                         | VuiRemotionPreview                                                                                                                          |
| [apps/web/src/controllers/playback/remotion-renderer.ts](../../apps/web/src/controllers/playback/remotion-renderer.ts)                       | Support / nonvisual                                                                                                                         |
| VUI `kernel/contract.ts` (retired with the package, task 4.10)                                                                               | Support / nonvisual                                                                                                                         |
| VUI `kernel/host/document.ts` (retired with the package, task 4.10)                                                                          | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/playback/renderer-contract.ts](../../apps/web/src/controllers/playback/renderer-contract.ts)                       | Support / nonvisual                                                                                                                         |
| VUI `kernel/host/index.ts` (retired with the package, task 4.10)                                                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/tick.ts](../../apps/web/src/models/timeline-view/tick.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/timebase.ts](../../apps/web/src/models/timeline-view/timebase.ts)                                         | Support / nonvisual                                                                                                                         |
| VUI `kernel/time/index.ts` (retired with the package, task 4.10)                                                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/rational.ts](../../apps/web/src/models/timeline-view/rational.ts)                                         | Support / nonvisual                                                                                                                         |
| VUI `kernel/time/timecode.ts` (retired with the package, task 4.10)                                                                          | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/cross-axis.ts](../../apps/web/src/models/timeline-view/cross-axis.ts)                                     | Support / nonvisual                                                                                                                         |
| VUI `kernel/edit/policies.ts` (retired with the package, task 4.10)                                                                          | Support / nonvisual                                                                                                                         |
| VUI `kernel/edit/placement.ts` (retired with the package, task 4.10)                                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/engagement.ts](../../apps/web/src/models/timeline-view/engagement.ts)                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/geometry.ts](../../apps/web/src/models/timeline-view/geometry.ts)                                         | Support / nonvisual                                                                                                                         |
| VUI `kernel/edit/linking.ts` (retired with the package, task 4.10)                                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/operations.ts](../../apps/web/src/models/timeline-view/operations.ts)                                     | Support / nonvisual                                                                                                                         |
| VUI `kernel/edit/trim.ts` (retired with the package, task 4.10)                                                                              | Support / nonvisual                                                                                                                         |
| VUI `kernel/edit/transaction.ts` (retired with the package, task 4.10)                                                                       | Support / nonvisual                                                                                                                         |
| VUI `kernel/edit/index.ts` (retired with the package, task 4.10)                                                                             | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/fixtures.ts](../../apps/web/src/models/timeline-view/fixtures.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/viewport.ts](../../apps/web/src/models/timeline-view/viewport.ts)                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/types.ts](../../apps/web/src/models/timeline-view/types.ts)                                               | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/reducer.ts](../../apps/web/src/models/timeline-view/reducer.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/events.ts](../../apps/web/src/models/timeline-view/events.ts)                                             | Support / nonvisual                                                                                                                         |
| VUI `kernel/model/index.ts` (retired with the package, task 4.10)                                                                            | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/gesture.ts](../../apps/web/src/models/timeline-view/gesture.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/effects.ts](../../apps/web/src/models/timeline-view/effects.ts)                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/models/timeline-view/store.ts](../../apps/web/src/models/timeline-view/store.ts)                                               | Support / nonvisual                                                                                                                         |
| VUI `kernel/index.ts` (retired with the package, task 4.10)                                                                                  | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/media/pipeline.ts](../../apps/web/src/services/media/pipeline.ts)                                                     | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/media/density.ts](../../apps/web/src/services/media/density.ts)                                                       | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/media/extraction.ts](../../apps/web/src/services/media/extraction.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/media/engine.ts](../../apps/web/src/services/media/engine.ts)                                                         | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/media/cache-key.ts](../../apps/web/src/services/media/cache-key.ts)                                                   | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/media/cache.ts](../../apps/web/src/services/media/cache.ts)                                                           | Support / nonvisual                                                                                                                         |
| [apps/web/src/services/media/protocol.ts](../../apps/web/src/services/media/protocol.ts)                                                     | Support / nonvisual                                                                                                                         |
| VUI `conformance/document.ts` (retired with the package, task 4.10)                                                                          | Support / nonvisual                                                                                                                         |
| [packages/shared/src/editor/conformance.ts](../../packages/shared/src/editor/conformance.ts)                                                 | Support / nonvisual                                                                                                                         |
| [apps/web/src/controllers/playback/renderer-conformance.ts](../../apps/web/src/controllers/playback/renderer-conformance.ts)                 | Support / nonvisual                                                                                                                         |
| VUI `conformance/index.ts` (retired with the package, task 4.10)                                                                             | Support / nonvisual                                                                                                                         |
