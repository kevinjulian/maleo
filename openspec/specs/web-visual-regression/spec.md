# web-visual-regression Specification

## Purpose

How the web client proves a change did not alter what a screen looks like or how
it behaves, and why that proof is not the type checker's or the test suite's to
give. A `domain` module importing a component is legal TypeScript; so is a
stylesheet whose rules never match, a token that resolves to the wrong value,
and a component whose handlers are never wired.

The checks live under `apps/web/visual/` and run with `bun run visual`. They are
four kinds, and the split is deliberate: screenshots for appearance, computed
probes for the values a diff cannot name, driven interactions for what a frame
cannot show, and per-surface baselines for the panels a default view hides.

## Requirements

### Requirement: A refactor proves it did not change what a screen looks like

The web client SHALL carry committed screenshot baselines for its screens, and a
check SHALL compare a run against them. A change that alters rendering SHALL
fail that check until the baseline is updated deliberately.

This exists because the type checker and the test suite cannot see rendering. A
malformed `@media` rule silently discarded a thousand lines of stylesheet, a
stylesheet split resolved a token to its mobile value on desktop, and a state
class inherited a button's colours — none of which failed a test.

#### Scenario: A refactor changes rendering by accident

- **WHEN** a change alters the computed appearance of a covered screen
- **THEN** the check fails, names the screen and breakpoint, and stores the expected, actual and diff images for the reviewer

#### Scenario: A change is meant to alter rendering

- **WHEN** the diff is the intended result of the change
- **THEN** the baseline is regenerated and committed in the same change, so the new appearance is reviewed as a diff rather than assumed

### Requirement: A check that a screenshot cannot perform covers what it cannot see

Screenshots SHALL NOT be treated as sufficient proof that a refactor preserved
behaviour. A screenshot compares a rendered frame; it cannot see a pointer
interaction, and it cannot name which value moved when one does.

The client SHALL therefore also carry checks that drive the interactions its
surfaces are built from, and checks that assert the computed layout values by
name. These SHALL run alongside the screenshots.

A pixel comparison also SHALL NOT be treated as proof that a surface's controls
are unchanged. A surface whose requirements name its controls SHALL carry an
assertion that names them too — the controls it has, by accessible name —
alongside its screenshot.

That qualification is the rule, and it is deliberately not "every surface". An
inventory is exact by design: it fails on a control added, removed, renamed or
reordered, which is what makes it worth having and also what makes it a list to
keep in step with the UI. On a surface whose controls are the behaviour that
cost is the point — the set of controls IS the requirement, so a deliberate
change to it should touch a test. On a surface that merely happens to contain
buttons it is a tax paid on every edit for a failure nobody asked for, and an
assertion that fails for reasons its readers do not care about is deleted rather
than fixed. The screenshot plus the interaction and layout checks above already
cover those surfaces adequately.

Which surfaces qualify is a judgement made from the requirements, not a rule a
tool can apply, so this is not enforced: nothing stops a future surface shipping
with only a screenshot. Today the qualifying set is the timeline's transport bar
at both widths, the contextual clip bar, and the two studios' bottom bars —
each of which has a requirement that lists its controls by name.

This is a different failure from the two below, and the difference is the point:
the screenshot did not miss the change, it saw it and forgave it. A studio's
bottom bar lost a control, gained a label and gained six more controls, and both
phone captures passed against their old baselines; `--update-snapshots` declined
to rewrite them. Measured at zero tolerance, the redesign moved **189 pixels**
against a budget of **518** (`maxDiffPixelRatio: 0.002` over 393x659).

The remedy is not a smaller budget. The budget exists because font rasterisation
differs across machines, and catching 189 pixels on that capture needs a budget
near 150 — below the noise it was set to absorb. A threshold cannot separate
them, and a visual check that fails on antialiasing is muted within a week. What
separates them is asserting the controls rather than the pixels.

This exists because it happened: an editor region was extracted with none of
its gestures wired up, and all fifty-four screenshots passed. Separately, a
token override was lost and the screenshots showed the change without naming
the token, which cost a bisect.

#### Scenario: A refactor moves interaction state

- **WHEN** a change relocates the state behind a drag, a scrub, a selection or a menu
- **THEN** a check drives that interaction and asserts its observable effect, because the rendered frame before the interaction is identical either way

#### Scenario: A layout token changes value

- **WHEN** a token that positions the shell resolves to a different value
- **THEN** a probe fails naming the token and the expected value, rather than a set of images differing by some pixels

#### Scenario: A probe derives its own expectation

- **WHEN** a computed-value check reads its expected value from the stylesheet it is checking
- **THEN** it is rewritten to state the value explicitly, since a probe that agrees with itself asserts nothing

#### Scenario: A surface's controls change

- **WHEN** a surface whose requirements name its controls gains, loses or renames one
- **THEN** an assertion naming that surface's controls fails, whether or not the screenshot does

#### Scenario: A surface's controls are not part of its contract

- **WHEN** a surface holds controls that no requirement names
- **THEN** it carries no inventory, and its coverage stays the screenshot plus the interaction and layout checks

#### Scenario: A sparse change lands inside the pixel budget

- **WHEN** a change moves fewer pixels than the comparison tolerates
- **THEN** it is caught by an assertion about structure, and the tolerance is not tightened toward the rasterisation noise it exists to absorb

### Requirement: Coverage spans the screens and widths the project targets

The harness SHALL cover every top-level screen the app shell routes to, and
SHALL capture each at the breakpoints the project designs against: 320, 768,
1024 and 1440 CSS pixels — except where the screen does not exist at a width, in
which case it SHALL declare the widths it does exist at and the reason SHALL be
recorded beside them.

The exception is narrow on purpose. It is for a screen that is a DIFFERENT
surface at that width, not one that is merely awkward there — awkward at 320 is
exactly what these baselines are for. The editor's chat and audit panels are the
case: they are the default rail, so below 860px they sit in a sheet that the
screen's own navigation never opens, and the docked clip inspector is not
narrowed below 1440 but replaced by `TimelineClipInspectorSheet` outright.
Capturing those names at those widths would photograph something else.

The limit is measured per screen rather than applied to a region as a class.
Two editor screens added in the same change needed no restriction, because
clicking a rail button opens the panel on the way — "the editor is desktop-only"
would have been false and would have dropped four working captures.

#### Scenario: A new screen is added

- **WHEN** a feature adds a screen reachable from the app shell
- **THEN** it is added to the covered list, because an uncovered screen is one no baseline protects

#### Scenario: A screen renders differently across breakpoints

- **WHEN** a screen has a distinct mobile and desktop layout
- **THEN** both are captured, since the regressions this catches have been desktop-only token overrides and mobile-only chrome

#### Scenario: A screen holds surfaces the default view does not show

- **WHEN** a screen has panels, rails or modes that only appear after interaction
- **THEN** each is captured as its own baseline, because one screenshot of the default view leaves the rest of the screen unprotected

#### Scenario: A candidate baseline would render empty

- **WHEN** a surface renders nothing under the fixture data — an empty state standing in for the real one
- **THEN** it is left uncaptured with the reason recorded, because an image of an empty page stays green when the surface breaks entirely, which is worse than having no baseline

#### Scenario: A screen is a different surface below a breakpoint

- **WHEN** a screen's composition is replaced rather than narrowed at a width — a panel that becomes a closed sheet, a docked region swapped for a different component
- **THEN** it declares the widths it is captured at and records why, rather than capturing a name at a width where it photographs something else

#### Scenario: A region is assumed to need the same restriction throughout

- **WHEN** one screen in a region is restricted to a subset of widths
- **THEN** the others are still measured individually, because a restriction applied to a region as a class drops captures that work

### Requirement: Screenshots are deterministic

The harness SHALL remove the sources of difference that are not the code:
network responses SHALL be served from recorded fixtures rather than a live
api, animations SHALL be disabled, and any rendered clock or relative timestamp
SHALL be frozen.

#### Scenario: A run is compared on a different day

- **WHEN** the suite runs against the same code a week later
- **THEN** it passes, because "2 days ago" and a spinner mid-frame are not part of what the baseline asserts

#### Scenario: The api is unavailable

- **WHEN** the api is not running, as in CI
- **THEN** the screens still render from fixtures, so the check measures the client rather than the environment

### Requirement: The suite builds what it photographs

The visual suite SHALL build the workspace packages the application under test imports through their build output, before it captures anything. A baseline SHALL therefore describe the application as built from the source in the tree, not as built from whatever artifact happens to exist on the machine running the suite.

`packages/vui/dist` is gitignored and the web app imports the package through it. Nothing built it, so the suite photographed whatever each machine happened to have. Rebuilding it moved **47 screenshots** across screens unrelated to the change that triggered the rebuild — one page from 1579px tall to 2168px — which is a release of package work that no screenshot had ever seen.

This failure is invisible by construction, and that is why it is written down rather than left to care. A screenshot of the wrong build looks exactly like a screenshot of the right one: there is no error, no warning, and no diff — the suite simply agrees with itself. Two developers with different build states get different answers from the same command and neither is told which is real.

#### Scenario: The build output is absent

- **WHEN** the visual suite runs with no build output for a workspace package the application imports
- **THEN** it builds that package before capturing, rather than failing or photographing a stale artifact

#### Scenario: The build output is stale

- **WHEN** a package's source has changed since its build output was produced
- **THEN** the suite rebuilds it, so a screenshot that passes is a statement about current source

#### Scenario: A build drifts in CI

- **WHEN** the built output differs from the one the suite ran against
- **THEN** CI fails and names the package, rather than reporting a green suite

### Requirement: Image lab polish is proven across desktop and mobile

Changes to the image lab visual layout SHALL include route-level proof for desktop and phone-width viewports. The proof SHALL verify that the chat feed, bottom composer, provider control, reference control, aspect control, prompt input, and send button render without overlap and remain reachable.

#### Scenario: Desktop lab proof

- **WHEN** `/images/lab` is checked at a desktop viewport
- **THEN** the centered feed and bottom composer render within the app shell
- **AND** the provider selector is present near the prompt input
- **AND** no primary composer control overlaps another

#### Scenario: Mobile lab proof

- **WHEN** `/images/lab` is checked at a phone-width viewport
- **THEN** the composer remains within the viewport
- **AND** the prompt input and send button remain reachable
- **AND** the app bottom navigation and `imagelab-header` are absent
- **AND** provider selection opens through a compact popover that lists all provider options
- **AND** ratio selection opens through a compact popover and applies the selected ratio

### Requirement: Reference media rendering is proven across desktop and mobile

Reference Library visual checks SHALL assert that catalogue-backed image cards render actual media when fixture or live test data contains image sources. A passing check SHALL NOT rely only on labels, empty states, or colored placeholders.

#### Scenario: Desktop reference media proof

- **WHEN** `/library/references` is checked at a desktop viewport with catalogue entries that include image sources
- **THEN** at least one reference card renders an image element or equivalent painted media sourced from the catalogue image URL
- **AND** the rendered image area is non-empty

#### Scenario: Mobile reference media proof

- **WHEN** `/library/references` is checked at a phone-width viewport with catalogue entries that include image sources
- **THEN** reference cards fit within the viewport
- **AND** at least one card renders actual image media rather than only a solid fallback

### Requirement: The fixture is authored, and contains nobody's data

The visual suite's API fixture SHALL be authored rather than recorded from a
live database, and SHALL contain no real user, workspace, project, reference or
media content. Every committed artifact of the suite, the baseline images
included, SHALL be free of it.

The fixture was a recording of one developer's database, and that is why it held
real content: the only way to produce it was to point the recorder at whatever
database was to hand. A recorded fixture also cannot be reviewed — 693KB of
recorded JSON is not read before it is committed — so nothing catches what it
carried, and nothing catches when it stops matching what the surfaces need.

`37a1c75b`, preparing an MIT release, emptied that recording to
`"images":[]` and left the pictures of the same data in place: 104 baseline
PNGs, of which `content-list-1440.png` renders twenty real project titles and a
row count of 18,150. Emptying the JSON and keeping the screenshots of the JSON
is not a partial fix, it is the appearance of one.

Fixture content SHALL be recognisably synthetic on sight. A reviewer deciding
whether a committed image is safe to publish must be able to answer from the
image, not by tracing each name back to a source.

#### Scenario: The fixture is produced

- **WHEN** the suite's API fixture is created or updated
- **THEN** its contents are authored, and no field is copied from a real database

#### Scenario: A recorder can only capture real data

- **WHEN** a fixture-recording tool cannot seed from an authored source
- **THEN** it is removed rather than kept, because a recorder that can only record real data is the defect

#### Scenario: A baseline is committed

- **WHEN** a baseline image is added or refreshed
- **THEN** it renders only fixture content, and a reviewer can tell that from the image

#### Scenario: Someone reads the fixture

- **WHEN** a reviewer opens the fixture to see what a surface will render
- **THEN** it is short enough and plain enough to read, rather than a recording that is only executable

### Requirement: The fixture is sufficient for every surface's populated state

The fixture SHALL carry enough data for each photographed surface to render the
state that surface exists to show. A surface whose purpose is to list SHALL
render a list; a surface with filters SHALL carry data matching each filter; a
surface with pagination SHALL carry enough rows to page.

Sufficiency is judged per surface against what that surface's tests already
assert, not by a row count. The current fixture demonstrates why: it answers
`images: 0, products: 0`, every library surface renders its empty state, and the
suite reported **290 tests passing** while doing it. An empty fixture is not a
failing fixture — it is a fixture that has quietly stopped asking the question.

The three `library-chrome` reference tests are the worked example. They open the
first `.catalog-ref-image-card` and assert a detail sheet, a phone bottom sheet,
and a constrained edit. Against a fixture with no images they time out, and the
timeout is indistinguishable from a broken component: `references-library.tsx`
renders the workspace-scoped empty state entirely correctly, with no failed
requests.

#### Scenario: A surface lists records

- **WHEN** a photographed surface renders a list
- **THEN** the fixture carries enough rows that the capture shows a populated list rather than an empty state

#### Scenario: A surface offers filters

- **WHEN** a surface filters by a set of kinds or types
- **THEN** the fixture carries at least one record matching each, so a filter that stops working fails rather than showing the same empty result either way

#### Scenario: A test asserts on a record that must exist

- **WHEN** a test opens, selects or edits the first record on a surface
- **THEN** the fixture guarantees that record, and its absence is a fixture defect rather than a component failure

#### Scenario: The fixture is emptied

- **WHEN** data is removed from the fixture
- **THEN** the surfaces that read it are re-checked in the same change, because a suite can pass in bulk against a fixture that answers nothing

### Requirement: A fixture change re-records every baseline it moves

When the fixture changes, every baseline the fixture feeds SHALL be re-recorded
in the same change. A subset SHALL NOT be refreshed while the rest are left
photographing the previous fixture.

`37a1c75b` emptied the fixture and re-recorded 24 baselines. The rest kept the
pre-scrub captures, so the suite compared a populated past against an empty
present and reported 27 screenshot differences and 3 behaviour failures, none of
which was a regression. The mixture is worse than either state alone, because the
differences carry no single cause and reading one tells you nothing about the
next.

A baseline SHALL NOT be refreshed under a cause that did not produce it. Doing so
records the wrong reason in the one place a future reader will look, and freezes
an empty-state capture as a populated screen's intended appearance.

#### Scenario: The fixture changes

- **WHEN** the fixture's contents change
- **THEN** every baseline that renders fixture data is re-recorded in the same change

#### Scenario: A surface reads no fixture data

- **WHEN** a photographed surface renders nothing from the fixture
- **THEN** its baseline is unaffected and is not refreshed

#### Scenario: A baseline differs for an unexplained reason

- **WHEN** a capture differs and the cause has not been established
- **THEN** the cause is established before the baseline is refreshed, rather than the refresh being the response

### Requirement: The suite states how to run it correctly

The suite SHALL make its port convention explicit, so that a run against the
wrong port fails as a harness error rather than as a regression.

The fixture is replayed through `routeFromHAR`, which matches on the full URL
including the port. A run on any port other than the recorded one aborts every
API request, and the resulting failure is indistinguishable from a broken
application: the shell renders, no data arrives, and `warmup` times out waiting
for `.tl2-timeline`. Nothing currently says so, and the failure invites a
diagnosis of the app rather than of the command.

#### Scenario: The suite is run on a different port

- **WHEN** the visual suite runs against a port the fixture was not recorded on
- **THEN** the mismatch is reported as such, rather than surfacing as an application that renders no data

#### Scenario: A developer reads how to run the suite

- **WHEN** someone runs the visual suite for the first time
- **THEN** the port constraint is stated where they will meet it, rather than learned from a failed run

### Requirement: A surface is covered before it is restructured

A surface SHALL have a visual baseline before a change restructures how its
appearance is expressed. Where no baseline exists, capturing one SHALL land as
its own commit, before the change that could move it.

The proof this repository uses for a restructuring is that `bun run visual`
passes against existing baselines with no snapshot updates. That proof is empty
for a surface nothing watches: moving 107 inline style objects with no baseline
is not a refactor with a check, it is a hope. `standardize-web-component-vocabulary`
stopped at exactly this line — it extracted the two heaviest files that were
covered and left the three that were not.

Capturing in the same commit as the change defeats the purpose, because the
baseline then records the result rather than the starting point. `screens.ts`
already states the practice for the library screens: added before the surfaces
are rewritten, so the rewrite has a before to be diffed against.

#### Scenario: A change would restructure an uncovered surface

- **WHEN** a change moves a surface's appearance between inline styles, classes or components
- **THEN** a baseline for that surface exists first, captured in an earlier commit

#### Scenario: A baseline is captured for a surface that renders nothing

- **WHEN** the fixture does not populate the surface being captured
- **THEN** the baseline is not accepted, because an image of an empty surface stays green when the surface stops rendering

### Requirement: A fixture is chosen for what it reaches

A visual fixture SHALL be chosen for the surfaces it makes reachable, and a
surface that no fixture reaches SHALL be recorded as uncovered rather than
treated as covered.

The suite replays one project with two clips and no scenes. That is deliberate —
the first project tried carried 3,135 storyboard versions and produced a 5.7 MB
fixture — but it leaves the story chat, the audit panel, the infographic controls
and the Studio unreachable, and an uncovered surface is indistinguishable from a
covered one unless somebody checks. Probing the running app for each surface's
markers is what tells them apart.

Where a second fixture is needed, it SHALL sit beside the first rather than
replace it, so the cheap fixture stays cheap for the screens that use it.

#### Scenario: A surface cannot be reached by any fixture

- **WHEN** a surface's markers are absent from every captured screen
- **THEN** it is recorded as uncovered, and a change that depends on its coverage says so rather than proceeding

#### Scenario: A new fixture is needed to reach a surface

- **WHEN** an existing fixture cannot populate a surface
- **THEN** a second fixture is added for the screens that need it, rather than growing the one every screen replays
