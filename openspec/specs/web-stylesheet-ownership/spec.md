# web-stylesheet-ownership Specification

## Purpose

TBD - created by archiving change restructure-web-role-first. Update Purpose after archive.

## Requirements

### Requirement: A stylesheet has exactly one importer

Every stylesheet under `apps/web/src` SHALL be brought into the bundle from exactly one place: a global sheet through the single entry sheet's explicit `@import` list, and a cluster sheet through the one module that owns it.

`timeline.css` is imported from four separate modules today. The imports are idempotent, so nothing breaks and nothing fails — which is the problem: no module owns the sheet, and deleting the last real user leaves three imports that look load-bearing.

#### Scenario: A cluster stylesheet is loaded

- **WHEN** a cluster stylesheet is imported from more than one module
- **THEN** the structural check fails, naming the sheet and every importer

#### Scenario: An owner is removed

- **WHEN** the module that imports a cluster stylesheet is deleted
- **THEN** the stylesheet has no importer and the structural check names it, rather than the sheet surviving on an incidental import

### Requirement: A stylesheet may only style its own cluster

Every cluster stylesheet SHALL declare its selector prefixes, and every top-level selector in that sheet SHALL be anchored to one of them somewhere in its structural part. A cluster stylesheet SHALL NOT define a rule that is anchored to nothing it owns.

Anchored, not "carried by the subject": a sheet may style anything inside what it owns, so `.tl2-clippanel .cv-input` is the timeline customising a control within its own panel and is allowed. `:has()` and `:not()` arguments are excluded from that test because they are conditions rather than ancestors — `.shell-main > main:has(.imagelab-chat)` paints the shell's element however it is qualified, and belongs to the shell.

A sheet may declare more than one prefix. The timeline cluster carries `tl2-` and `fc-` together; listing both is honest, where collapsing them would mean renaming classes and changing what renders.

`create-content.css` is 691 lines of unprefixed global selectors and can restyle the settings screen today. The class-collision tooling exists because bare state selectors land on elements that never named them.

#### Scenario: An unprefixed rule is added

- **WHEN** a top-level selector in a cluster stylesheet does not carry that sheet's declared prefix
- **THEN** the structural check fails and names the selector

#### Scenario: A state class is defined bare

- **WHEN** a stylesheet defines a rule matching a bare state class such as `.ok` or `.active` with no component qualifier
- **THEN** the structural check fails, because such a rule matches every element carrying that state class anywhere in the app

#### Scenario: A shared visual token is needed

- **WHEN** two clusters need the same value
- **THEN** it is defined as a custom property in the global token sheet and referenced, rather than duplicated or reached for across a cluster boundary

### Requirement: Cascade order is declared where it is guaranteed

A stylesheet split into parts SHALL be combined through a single entry sheet whose `@import` order is explicit. Order SHALL NOT be left to link-tag sequence, bundler traversal, or module import order.

#### Scenario: A sheet is split

- **WHEN** a stylesheet is divided into more than one file
- **THEN** the parts are re-combined through one entry sheet that lists them in the order the cascade requires

#### Scenario: A selector is defined twice

- **WHEN** a selector is defined more than once and the later definition is the one that renders
- **THEN** both definitions stay in the same sheet in their original order, because splitting the pair across two sheets swaps which one wins

### Requirement: The collision check runs against the real tree

The repository SHALL keep the class-collision and fixture-recording tooling pointed at the directories that hold stylesheets, and a run that finds no stylesheets SHALL fail rather than report success.

This tooling walks `src/` by directory name. A move that renames those directories makes it scan nothing and pass, which is worse than it failing.

#### Scenario: Stylesheets move

- **WHEN** stylesheets relocate to new directories
- **THEN** the tooling is retargeted in the same commit, and it reports the same known collisions before and after the move

#### Scenario: The scan finds nothing

- **WHEN** the collision scan discovers zero stylesheets
- **THEN** it exits with an error naming the directory it searched, rather than reporting a clean result

### Requirement: A rule styles something the app renders

A cluster stylesheet SHALL NOT keep a rule whose selector matches nothing in the rendered application. The structural check SHALL report such a rule and name it.

Ownership and liveness are different questions, and the existing check only answers the first. Thirteen rules in `stage.css` and `editing.css` styled the inspector's sub-category headings — `tl2-acc`, `tl2-acc-h`, `tl2-acc-body`, `tl2-acc-label`, `tl2-acc-chev` — and every one of them carried the timeline cluster's own prefix, so every one of them passed. None had matched anything since `AccordionSection` moved into `@maleo/vui` and began rendering `vui-accordion` instead. The headings were left with the package's defaults while the app's intended metrics sat in the sheet looking authoritative.

This is the cost of moving a component out of the app, and it recurs: the rules do not follow the markup unless something notices they no longer reach it. A dead rule is worse than an absent one, because the next person to change the design edits it and sees nothing happen.

The check SHALL distinguish a rule that matches nothing from a rule whose state the fixture does not happen to reach. A selector for a hover, an error, or a mode the fixture does not exercise is live and SHALL NOT be reported; the test is whether the rule's structural part can match, not whether the fixture put it in that state.

#### Scenario: A component's markup moves and its rules do not

- **WHEN** a stylesheet keeps a rule for a class that no component renders any more
- **THEN** the structural check fails and names the rule and its sheet

#### Scenario: A rule matches only in a state the fixture does not reach

- **WHEN** a rule's structural part matches a rendered element but its state qualifier does not currently apply
- **THEN** the rule is live and is not reported

#### Scenario: A rule is added for markup that does not exist yet

- **WHEN** a stylesheet adds a rule ahead of the component that will render it
- **THEN** the check fails, so the rule and its markup land together rather than the rule waiting silently for markup that may never arrive

### Requirement: A design token has exactly one declaration

Every design token the web client renders with SHALL be declared in exactly one
place. A token SHALL NOT be declared twice under two naming conventions, and a
declaration that nothing reads SHALL be reported by the structural check.

This sheet declared its whole palette twice: once as `--color-bg` / `--radius-1`
/ `--font-display` inside Tailwind's `@theme`, and once as `--bg` / `--r-1` /
`--font` in a `:root` block fifty lines below. The stylesheets read the second
set over two thousand times and the first set zero times, so half the token layer
rendered nothing while looking authoritative.

This is the same failure the sheet already names for dead rules, one level up: a
dead declaration is worse than an absent one, because the next person to change
the design edits it and sees nothing happen. The existing check answers that
question for rules and is silent about tokens.

Tokens injected at runtime are declared in CSS as defaults and are live even
though no `var()` in the tree resolves to the CSS declaration — `--accent`,
`--accent-bright`, `--accent-deep` and `--persona-gradient` are set on `<body>`
from workspace data. The check SHALL carry an explicit allowance for them rather
than reporting them.

#### Scenario: A token is declared under two naming conventions

- **WHEN** the same design value is declared both as a framework-namespaced
  custom property and as the property the stylesheets read
- **THEN** the structural check fails and names both declarations, rather than
  leaving the unread one in place

#### Scenario: A token is declared and never read

- **WHEN** a custom property is declared in the global token sheet and no `var()`
  under `src/` reads it
- **THEN** the structural check fails and names the token and its sheet

#### Scenario: A token is set at runtime rather than read from CSS

- **WHEN** a token is declared in CSS as a default and written onto an element at
  runtime from application data
- **THEN** it is live and is not reported, because the CSS declaration is the
  fallback for a value the app supplies

#### Scenario: A token is added ahead of the rule that will read it

- **WHEN** the token sheet declares a custom property before any stylesheet
  references it
- **THEN** the check fails, so the token and its first consumer land together
  rather than the token waiting silently for a consumer that may never arrive

### Requirement: The app carries no styling framework it does not render through

The web client SHALL NOT depend on a CSS framework, utility generator, or class
composition library whose output the rendered application does not use. A
styling dependency SHALL be justified by markup that consumes it.

Tailwind, `tw-animate-css`, `bun-plugin-tailwind`, `tailwind-merge`, `clsx` and
`class-variance-authority` were carried for nineteen utility class tokens across
the entire application — `text-muted` eleven times and eight others once each —
plus sixty-two lines mapping shadcn's token names onto ours for a single
component. The framework was installed, wired into the design system, and then
not used; what remained was a second way to express every value, with no
enforcement that either way was the real one.

This requirement is about unused output, not about dependencies in general. A
dependency supplying behavior the app runs — focus management, dismissal,
collision-aware positioning — is justified by that behavior and is out of scope
here.

#### Scenario: A styling framework's output is unused

- **WHEN** a CSS framework is a dependency and the rendered markup uses none or
  almost none of the classes it generates
- **THEN** the framework is removed rather than retained for the few usages,
  which are rewritten in the app's own CSS

#### Scenario: The framework supplies element defaults as well as utilities

- **WHEN** a CSS framework is removed for having unused utilities
- **THEN** the element defaults it also supplied — a reset applied through
  element selectors that appear in no `className`, and which no census of markup
  can see — are vendored into the app's own sheets at the same cascade position
  first, because those were being used

#### Scenario: A dependency supplies behavior rather than appearance

- **WHEN** a dependency provides interaction behavior the application invokes
- **THEN** it is justified by that behavior, and only its styling coupling is
  removed

#### Scenario: Removing the framework changes what renders

- **WHEN** a styling dependency is removed
- **THEN** the visual regression suite passes unchanged and without
  `--update-snapshots`. A failure means part of the framework's output was
  load-bearing after all, and that part is vendored rather than the baseline
  being refreshed to accept the loss

### Requirement: A var() reads a token that is declared

Every custom property read by a `var()` under `apps/web/src` SHALL be declared —
in the global token sheet, by the cluster stylesheet that owns it, or by a
runtime write. The structural check SHALL fail and name the reader when nothing
declares it.

The declaration may sit outside the global sheet on purpose. A cluster owning
its own geometry knob is the established shape: `--tl2-lane-h` belongs in
`tracks.css`, `--ui-sheet-size` is written by `design-system/components/sheet.tsx`, and
`--fc-asp` is computed per element. Requiring the global sheet would move a
timeline lane height into the app's palette to satisfy a check. The defect is a
name that **nothing** sets.

This capability already requires the opposite direction — a token declared and
never read is reported — and the reasoning given there applies unchanged here: a
declaration that renders nothing is worse than an absent one, because the next
person to change the design edits it and sees nothing happen. A _reader_ of an
undeclared token fails the same way and is currently invisible.

`.tl2-dsec-note.warn` in `components/timeline/media.css` reads
`var(--danger, #e5484d)`. `--danger` is declared nowhere; the app's error colour
is `--err: #dc2626`. Every warning note in the timeline therefore renders the
hardcoded fallback, in a red that appears nowhere else in the product, and the
fallback is what makes it silent: the rule works, so nothing is broken enough to
notice.

A fallback SHALL NOT exempt a reader. A `var()` with a fallback is exactly the
case that needs the check, because it is the case that renders plausibly while
being wrong.

#### Scenario: A rule reads a token nothing declares

- **WHEN** a stylesheet reads a custom property that no sheet and no runtime write declares
- **THEN** the structural check fails and names the sheet and the token

#### Scenario: A cluster reads a knob its own sheet declares

- **WHEN** a rule reads a custom property declared by the stylesheet that owns that cluster
- **THEN** the check accepts it, because a local knob is declared and a global palette is not where it belongs

#### Scenario: The reader supplies a fallback

- **WHEN** the undeclared token is read with a fallback value
- **THEN** the check still fails, because the fallback is what hides the defect

#### Scenario: The token is injected at runtime

- **WHEN** a token is written onto an element from application data and declared in CSS only as a default
- **THEN** it is live in both directions and is not reported, matching the existing allowance for runtime-injected tokens

#### Scenario: A component stylesheet reads a token before it is declared

- **WHEN** a rule references a new token and the token sheet does not yet declare it
- **THEN** the check fails, so the reader and the declaration land together

### Requirement: A cluster stylesheet declares who consumes it

Every cluster stylesheet SHALL be checkable against the set of source directories
that use its classes. A class defined in one cluster and consumed by a module in
another SHALL be reported.

This capability already requires that a sheet may only _style_ its own cluster.
It says nothing about who _renders_ the classes, and that is the half that
drifted: `create-content.css` declares the `cv-` prefix legitimately, styles
nothing outside it, and passes — while seven directories render `cv-` classes.
`cv-input` alone is at 95 call sites across the app. The sheet is well-behaved by
the existing rule and is nonetheless a shared vocabulary named as a private one.

The report is not automatically a failure. Two clusters legitimately share a
vocabulary — the timeline declares `tl2-` and `fc-` together, and this capability
already records that listing both is more honest than a rename. What the check
supplies is the fact; the response is promotion to a primitive, a rename, or a
recorded declaration that two clusters share the prefix on purpose.

#### Scenario: A class is rendered outside its declaring cluster

- **WHEN** a module renders a class defined by a stylesheet it does not own
- **THEN** the check reports the class, the defining sheet and the consuming directory

#### Scenario: Two clusters share a vocabulary deliberately

- **WHEN** a shared prefix is declared by more than one cluster on purpose
- **THEN** the declaration is recorded in the sheets that share it, and the check accepts it

#### Scenario: A shared vocabulary keeps a private name

- **WHEN** a prefix named for one cluster is consumed by several
- **THEN** it is promoted to a primitive or renamed, rather than left reading as local
