# workspace-scoping Specification

## Purpose

TBD - created by archiving change workspace-scoped-content. Update Purpose after archive.

## Requirements

### Requirement: An operator works inside one chosen workspace

The system SHALL let an operator choose which registered workspace they are working
in, and SHALL make that choice visible rather than implied.

The chosen workspace SHALL survive a reload, and SHALL be carried in the address so
that opening a shared link lands in the same workspace it was shared from.

Every registered workspace SHALL be reachable. A workspace that holds data and
cannot be opened is the defect this requirement exists to close.

A chosen workspace can now cease to exist. When the active workspace is deleted,
the system SHALL move the operator to another workspace they belong to rather
than leaving the application scoped to a tenant that is gone. An address naming
a deleted workspace SHALL be refused the same way an unknown one is, because
after deletion the two are the same thing.

#### Scenario: Choosing a workspace

- **WHEN** an operator selects a workspace
- **THEN** the application works within it, and says which one is active

#### Scenario: The choice survives a reload

- **WHEN** an operator reloads after choosing a workspace
- **THEN** they are still in that workspace

#### Scenario: A shared link opens its own workspace

- **WHEN** an operator opens a link shared from another workspace
- **THEN** they land in the workspace the link names, not the one they last used

#### Scenario: Every registered workspace can be opened

- **WHEN** an operator lists the workspaces available to them
- **THEN** each registered workspace appears and can be entered

#### Scenario: The active workspace is deleted

- **WHEN** an operator deletes the workspace they are currently working in
- **THEN** they are moved to another workspace they belong to, and the application is never left scoped to the deleted one

#### Scenario: A link to a deleted workspace

- **WHEN** an operator opens a saved link naming a workspace that has since been deleted
- **THEN** it is refused as an unknown workspace rather than served another workspace's data

### Requirement: The active workspace is visible without interaction

The active workspace SHALL be shown on screen at every viewport, not only inside a
menu the operator must open.

This change's visible effect is that an operator sees LESS than before. Someone who
switches, forgets, and returns to a shortened list needs the reason present rather
than one interaction away, or the scoping reads as data having disappeared.

Switching SHALL be immediate and SHALL NOT require confirmation. The action is
reversible and addressable, so a prompt would charge friction on every switch to
guard against a mistake that costs one action to undo.

#### Scenario: Knowing which workspace is active

- **WHEN** an operator looks at any screen, at any viewport
- **THEN** the active workspace is identifiable without opening anything

#### Scenario: Switching takes effect at once

- **WHEN** an operator chooses another workspace
- **THEN** the application re-scopes immediately, with no confirmation step

#### Scenario: Switching while editing

- **WHEN** an operator switches workspace while a project is open
- **THEN** the switch is permitted, and the work they were doing is not lost

### Requirement: An empty workspace explains itself

A scoped surface with nothing to show SHALL name the workspace it is empty for, and
SHALL offer a way forward — creating something, or returning to a workspace that has
work.

It SHALL be distinguishable from a failure to load. Most workspaces own nothing
today, so after scoping the ordinary case is a correct empty app that looks exactly
like a broken one.

Where an operator chooses between workspaces, the choice SHALL indicate which
workspaces hold work, so an empty one is expected before it is entered rather than
discovered after.

#### Scenario: Landing in a workspace with no content

- **WHEN** an operator switches to a workspace that owns nothing
- **THEN** the surface names that workspace, says it has no work yet, and offers a
  way forward

#### Scenario: Empty is not failure

- **WHEN** a scoped surface has nothing to show
- **THEN** an operator can tell it loaded successfully and is genuinely empty

#### Scenario: Choosing with foreknowledge

- **WHEN** an operator opens the list of workspaces
- **THEN** they can tell which hold work before switching to one

### Requirement: An operator can create a workspace

The system SHALL let an operator add a workspace, and a new one SHALL start empty —
it inherits, adopts and copies nothing from any existing workspace.

Creation SHALL produce everything a workspace needs to be usable, not merely an
entry in a list. A workspace that can be selected and then fails on first read is
not created.

A workspace SHALL exist by default, so the system is never in a state with no
workspace to work in.

#### Scenario: Adding a workspace

- **WHEN** an operator creates a workspace and switches to it
- **THEN** it is usable, and it contains none of another workspace's work

#### Scenario: A new workspace is empty, not broken

- **WHEN** an operator opens a workspace they have just created
- **THEN** the emptiness is presented as having no work yet, distinguishably from a
  failure to load

#### Scenario: The workspace list carries what a chooser needs

- **WHEN** the available workspaces are listed
- **THEN** each carries the identity a chooser must show — its name, how it is
  displayed, its visual identity, and how much work it holds — rather than a bare
  identifier

#### Scenario: There is always a workspace

- **WHEN** the system starts with no workspace ever having been created
- **THEN** a default workspace exists and can be worked in

### Requirement: Content is scoped to the active workspace

The project list, project creation, and project outputs SHALL be scoped to the
active workspace. A project created while a workspace is active SHALL belong to it.

Materials, references and assets SHALL be scoped the same way, through the same
resolution, rather than each surface deciding for itself.

#### Scenario: The project list shows one workspace's work

- **WHEN** an operator lists content while a workspace is active
- **THEN** they see that workspace's projects

#### Scenario: A new project joins the active workspace

- **WHEN** an operator creates a project while a workspace is active
- **THEN** the project belongs to that workspace

#### Scenario: Library surfaces agree with the content list

- **WHEN** an operator views materials or references while a workspace is active
- **THEN** they see that workspace's, not another's and not every workspace's

#### Scenario: The catalogue serves one tenant

- **WHEN** an operator reads the reference catalogue while a workspace is active
- **THEN** it returns that workspace's images, not every workspace's

#### Scenario: A surface off the project path is not missed

- **WHEN** a surface reads tenant-owned data without going through the project list
- **THEN** it is scoped too, because scoping only what the project path touches
  leaves an endpoint quietly serving everything

#### Scenario: Generated images are scoped too

- **WHEN** an operator browses generated images while a workspace is active
- **THEN** they see that workspace's images, across its projects

### Requirement: Settings and credits are not scoped by workspace

Application settings and credits SHALL remain global. Switching workspace SHALL NOT
change what either shows.

They are app and administration scope, not tenant-owned work. A balance or a service
configuration that changed on switch would be reporting a different account, not a
different view of the same one.

A surface that is deliberately unscoped SHALL be distinguishable from one that was
missed. The scoping sweep treats an unscoped read as a defect, so these two must be
recorded as intended, or a later pass will "fix" them.

#### Scenario: Credits do not move with the workspace

- **WHEN** an operator switches workspace and looks at their credit balance
- **THEN** it is the same balance, drawn from the same account, as before the switch

#### Scenario: Settings do not move with the workspace

- **WHEN** an operator switches workspace and opens settings
- **THEN** the configuration shown is unchanged

#### Scenario: Being unscoped is deliberate, not overlooked

- **WHEN** a reader audits which surfaces carry the active workspace
- **THEN** settings and credits are recorded as intentionally global

### Requirement: One control decides the workspace

The active workspace SHALL be the only thing that decides which tenant a surface
shows or writes to. No individual surface SHALL carry its own workspace control.

A second control is not a convenience but a contradiction: it lets an operator read
or generate into a workspace other than the one the application says is active,
without the application ever saying so.

The consequence is deliberate — two workspaces cannot be viewed side by side.

#### Scenario: Generating uses the active workspace

- **WHEN** an operator generates an image from the generation surface
- **THEN** it is produced in the active workspace, with no separate choice offered

#### Scenario: No surface offers its own tenant control

- **WHEN** an operator looks at any surface that shows workspace-owned work
- **THEN** the only way to change which workspace it shows is to switch workspace

### Requirement: An unknown workspace is refused, not silently replaced

The system SHALL resolve the active workspace at one point, and SHALL validate it
against the registered workspaces.

A workspace that is not registered SHALL be refused. It SHALL NOT fall back to a
default, because a silent fallback shows an operator another tenant's data while
appearing to honour their choice — indistinguishable, from the outside, from the
data having moved.

#### Scenario: An unregistered workspace is rejected

- **WHEN** a request names a workspace that is not registered
- **THEN** it is refused rather than served with a default workspace's data

#### Scenario: No workspace named

- **WHEN** a request names no workspace at all
- **THEN** the system resolves one deliberately, and the same way for every surface

### Requirement: Scoping is not isolation

Workspace scoping SHALL NOT be presented or relied upon as a security boundary.
Scoping decides what an operator is shown; `workspace-membership` decides what a
caller is permitted, and the two SHALL NOT be conflated in either direction.

The premise this requirement was written on — that any caller may name any
workspace because there is no identity to check it against — no longer holds.
The system authenticates operators and records membership, so a request naming a
workspace is checked against the caller's membership before it is served. What
remains true is that scoping itself does no checking: a surface that filters by
the active workspace is choosing what to display, and a route that omits the
membership check is open regardless of how carefully it scopes.

Where an operator is shown less than they are permitted — the active workspace
narrowing a list — that is scoping. Where a caller is refused something they are
not permitted, that is membership. A reader asking whether tenancy protects data
SHALL find the answer that membership does and scoping does not, recorded rather
than inferred.

#### Scenario: A caller names another workspace

- **WHEN** an authenticated caller names a workspace they are not a member of
- **THEN** they are refused by the membership check, not by scoping

#### Scenario: Scoping is the only control on a route

- **WHEN** a workspace-scoped route filters by the active workspace but performs no membership check
- **THEN** it is treated as unprotected, because filtering what is returned is not deciding who may ask

#### Scenario: The limitation is documented where it would be assumed

- **WHEN** a reader looks for whether tenancy protects data here
- **THEN** they find that membership is the boundary and scoping is presentation, in the same place the previous answer was recorded

### Requirement: A generation's workspace depends on whether it has a project

Generated work that belongs to a project SHALL be attributed to that project's
workspace, and SHALL NOT take the active workspace even when the two agree.

Generated work that belongs to no project — a lab generation, a workspace-scoped
reference image — SHALL be attributed to the active workspace, because there is no
project to ask and the operator's current tenant is the honest answer.

The project case is the one that must not be simplified. The active workspace is
where the operator is looking; a project's workspace is who owns the work. An
operator can open a project by direct link while another workspace is active, and
billing the tenant they happen to be viewing would be wrong.

#### Scenario: Generating inside a project opened from elsewhere

- **WHEN** an operator has one workspace active, opens a project owned by another,
  and generates an image for it
- **THEN** the image is attributed and billed to the project's workspace

#### Scenario: Generating outside any project

- **WHEN** an operator generates an image that belongs to no project
- **THEN** it is attributed to the active workspace

#### Scenario: Attribution does not follow a switch

- **WHEN** an operator switches workspace
- **THEN** already-recorded work keeps the workspace it was produced under

### Requirement: Every workspace holding data is registered

A workspace that owns content SHALL appear in the registry. The system SHALL NOT
carry a tenant that owns data but is unknown to the list of workspaces, because
such a tenant cannot be chosen, cannot be named in a switcher, and its data cannot
be reached.

Reconciling an existing unregistered tenant SHALL preserve the work it owns.

#### Scenario: The tenant holding existing work is reachable

- **WHEN** an operator opens the workspace list
- **THEN** the workspace owning the existing projects is among them and can be entered

#### Scenario: Reconciliation preserves work

- **WHEN** an unregistered tenant is reconciled into the registry
- **THEN** every project it owned is still present and still reachable

### Requirement: A Declared Capability Is Honoured Or Removed

Where a workspace's configuration declares a capability grant, the system SHALL
enforce it. A grant no code reads SHALL NOT remain in the configuration format.

The `tools:` grant is resolved by removal. The only operation it ever gated —
`GET /api/tools/:name` — is retired, so there is nothing left to authorise and
the key SHALL NOT remain in the workspace config schema. A grant SHALL NOT
outlive the operation it guards: a key that denies access to a route that no
longer exists misleads exactly as much as one that enforces nothing.

#### Scenario: A grant is declared and ignored

- **WHEN** a workspace config carries a key an operator sets to control access,
  such as `tools:`, and no code path reads it
- **THEN** either the check is implemented or the key is removed from the
  format, because a setting that reads as a control and enforces nothing is
  worse than no setting — an operator who writes `tools: []` believes they have
  denied something

#### Scenario: The schema strips the key the grant lives in

- **WHEN** the grant is declared in the file but dropped by the parse before any
  reader sees it
- **THEN** that is treated as part of the same defect, because a check added
  against a stripped key reads as enforcement and denies nothing

#### Scenario: Documentation describes a gate that does not exist

- **WHEN** a comment states that capability is checked before an operation runs
  and no such check exists
- **THEN** the comment is corrected in the same pass the gap is found, even when
  the gate itself is deferred, because a false claim about an access control is
  the part that misleads a reader deciding whether to add one

#### Scenario: Absence and an empty grant are not the same

- **WHEN** enforcement is added for a grant that most existing configs do not
  declare at all
- **THEN** absent and empty are decided separately and stated, because `[]` is an
  operator denying everything and a missing key is an operator who never met the
  feature

#### Scenario: The guarded operation is retired

- **WHEN** the only operation a grant gates is removed from the system
- **THEN** the grant is removed from the config format in the same change, rather
  than kept as a setting with nothing left to deny

#### Scenario: An existing config still carries the retired key

- **WHEN** a workspace `config.yaml` written before the removal still declares
  `tools:`
- **THEN** the workspace loads normally and the key is preserved as an undeclared
  key, because the config schema is open over keys it does not declare

### Requirement: Parsing A Workspace Config Does Not Drop What The File Carries

A schema over a workspace's `config.yaml` SHALL preserve keys it does not
declare. A closed object SHALL NOT be used where the document is partly open.

#### Scenario: The document has runtime-keyed sections

- **WHEN** part of a config's key set is built at runtime, as
  `collections_${collection}` is from a caller's argument
- **THEN** no closed schema can describe the file, and one used anyway deletes
  the sections it does not know without reporting anything

#### Scenario: A parsed config is handed on whole

- **WHEN** a caller passes a parsed workspace to a consumer that reads fields the
  schema does not declare
- **THEN** those fields must survive the parse, because the consumer sees
  `undefined` rather than an error and cannot tell a missing setting from a
  stripped one

#### Scenario: Keys are declared one at a time

- **WHEN** a block is added to the schema
- **THEN** its shape comes from the stored files, not from what a call site
  asserts about it — an assertion records what someone believed the block held
  and has never been checked

#### Scenario: An open schema is mistaken for a complete one

- **WHEN** a schema passes unknown keys through
- **THEN** what it does and does not describe is stated with it, because passing
  a key through types it as `unknown` rather than describing it, and a reader who
  assumes coverage gets a value the schema never validated
