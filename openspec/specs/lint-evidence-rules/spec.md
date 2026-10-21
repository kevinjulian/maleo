# lint-evidence-rules Specification

## Purpose

Which anti-slop lint rules gate this repository, how a rule earns its gate, and
what a contributor does when one fires.

Written because a lint rule set is only as good as the severity behind it, and
the obvious approach — turn every rule on — would have failed on 3192 existing
violations.

The less obvious lesson came second. Counting a rule's violations says how loud
it is, not whether it is right: two of the nine fire mostly on code that is
already correct, one of them flagging a third-party library's own property name.
So a rule earns its severity from a sample of its violations, and a rule that
does not fit is retired with its reason rather than left warning about work that
would make the code worse.

The third lesson came from working against the gated rules rather than the
warned ones. A gated count reads as outstanding work, so noise in it actively
misdirects effort — and the noise had one cause worth naming: a type that is
open on purpose, because the shape arrived from outside unparsed, or the key set
is a runtime string, or the value was flattened for the wire. Those are scoped
away by cause, never by a file list, and the floor that remains is written down.

The gate runs on the lines a change touches. The remaining debt is spread about
four violations per file across hundreds of files, so a repository-wide gate
could only ever be a warning — and a warning gates nothing.

That reasoning expires per rule. Two rules have since reached zero, and a rule
with nothing left to fail on costs nothing to check everywhere, so those are
gated across the repository as well as on the diff. Zero reached mostly by
scoping is worth less than zero reached by changing code, and the split is
recorded with the rule rather than left to the count.

## Requirements

### Requirement: Every Enabled Rule Has A Disposition

Each enabled rule SHALL be gated, scoped then gated, or retired. A rule SHALL
NOT remain a warning with no recorded decision.

#### Scenario: A rule fires mostly on genuine defects

- **WHEN** sampling shows a rule's violations are largely worth changing
- **THEN** those violations are fixed and the rule is set to `error`

#### Scenario: A rule is right in some places and wrong in others

- **WHEN** the difference is a construct that can be named, and the files
  carrying it can be matched
- **THEN** the rule is narrowed to where it holds, and gated there

#### Scenario: A rule does not fit the codebase

- **WHEN** sampling shows its violations are mostly domain-correct code, code it
  cannot apply to, or third-party API surface
- **THEN** the rule is turned off with the reason recorded in the config, rather
  than left warning about work that should not be done

### Requirement: Severity Follows The True-Positive Rate

A rule's disposition SHALL be decided from a recorded sample of its violations,
not from its violation count alone. A rule gated at `error` SHALL record, beside
its configuration, what share of its findings land on correct code, established
by reading its violations rather than counting them.

#### Scenario: A rule has a high count

- **WHEN** a rule reports many violations
- **THEN** the count alone does not decide anything, because a count says how
  loud a rule is and a sample says whether it is right

#### Scenario: Recording a disposition

- **WHEN** a rule is gated, scoped, or retired
- **THEN** the sample behind the decision is recorded with it, so the call can be
  re-checked rather than taken on faith

#### Scenario: A gated rule accumulates noise

- **WHEN** work against a gated rule finds that a category of its findings is on
  code that is already correct
- **THEN** the rate is measured across that whole category and recorded with the
  disposition, so the count stops reading as a to-do list

#### Scenario: A rule fires on unrelated constructs

- **WHEN** one rule's findings span several causes with different rates
- **THEN** each cause carries its own rate and no single figure is published,
  because an aggregate hides both the category that is entirely noise and the
  category that is entirely real

#### Scenario: The sample is taken while fixes are underway

- **WHEN** a rule's disposition is decided after work on its findings has begun
- **THEN** it is not trusted, because effort already spent argues for the
  disposition that justifies it — establishing a rate and repairing what it
  measures are separate changes

#### Scenario: A sample is taken from a handful of sites

- **WHEN** a category is judged from a few examples rather than measured
- **THEN** the judgement is not trusted, because a handful is not a sample — a
  category read this way has already been wrong twice in this repository

#### Scenario: A rule cannot reach zero

- **WHEN** a rule's remaining violations are all domain-correct or impossible to
  change
- **THEN** it is scoped or retired, and is not left warning on the expectation
  that the count will fall

#### Scenario: Two sites share a syntax and not a cause

- **WHEN** a construct matches a category measured as mostly noise — a lookup
  table declared `Record<K, V>` — but is indexed by a statically known key rather
  than a runtime string
- **THEN** it is treated as a genuine finding, because the rate belongs to the
  USE and not to the shape it is written in, and a category read from its syntax
  has already been measured wrong here

#### Scenario: The residue is not debt

- **WHEN** a rule stays gated because part of its output is genuine, but its
  remaining findings describe something true about the code
- **THEN** the configuration states what the floor is and why, so no later change
  spends effort driving a number that should not reach zero

### Requirement: A Rule Is Scoped By Cause, Not By Path

Narrowing where a rule runs SHALL name the construct that makes the flagged type
correct, rather than listing the files that happen to contain it.

#### Scenario: A category of correct code is identified

- **WHEN** a rule fires on a type that is open on purpose — a model's unparsed
  output, a map whose keys are runtime strings, a value flattened for the wire
- **THEN** the scope names that cause, so the entry can be checked and reversed
  rather than growing silently as an ignore list

#### Scenario: A category turns out to be fixable

- **WHEN** the sample shows a category has a real fix
- **THEN** it is left in scope and handed to the change that fixes it, rather
  than scoped away

#### Scenario: A construct is mandated by a library

- **WHEN** a rule's findings concentrate on a signature a dependency requires —
  a `z.preprocess` callback whose `(unknown) => unknown` shape Zod mandates, a
  presentation type a renderer declares open
- **THEN** the rule is scoped away from that construct and the sample recorded,
  because the code cannot be changed to satisfy it without breaking the call

#### Scenario: A scope is written for a third-party constraint

- **WHEN** a type is open because a dependency declares it open
- **THEN** the entry names the call that stops compiling if it were narrowed, so
  a later reader can test the claim against that dependency's current types
  rather than trusting it

#### Scenario: The noise has no shared location

- **WHEN** a rule's false positives are a construct rather than a place, so the
  only available scope would be a bare list of the files that contain them
- **THEN** the rule is not scoped by path, and the construct is separated in the
  rule itself if the rule's output can tell the cases apart; where it cannot, the
  floor is recorded instead

### Requirement: Debt Is Reduced By Typing Boundaries

Outstanding evidence-rule findings SHALL be reduced by parsing payloads into
named domain types at their boundaries, not by annotating the casts that a
missing parse forced.

#### Scenario: A cluster of findings shares one cause

- **WHEN** many findings assert to the same type, or a declared
  `Record<string, unknown>` forces casts at its consumers
- **THEN** the boundary that failed to parse is fixed, and the downstream casts
  are deleted rather than justified

#### Scenario: A domain type already exists

- **WHEN** a boundary parses a payload the codebase already has a type or schema
  for
- **THEN** that existing type is used, rather than a new one written beside it

#### Scenario: One file carries many findings

- **WHEN** a file's findings all read the same dictionary or assert the same
  union arm
- **THEN** the boundary that produced it is typed and the findings are deleted
  as a consequence, rather than annotated where they surface

#### Scenario: A check the code already performs

- **WHEN** an assertion restates a discriminant the surrounding code tests on the
  same line
- **THEN** the type is declared as the union it already is, so the compiler
  carries what the check proves

#### Scenario: A boundary is genuinely structural

- **WHEN** code transforms arbitrary payloads without a domain type — a
  migration reading historical rows, a structural comparator
- **THEN** it is left alone with the reason recorded, because a named type there
  would misdescribe what the code does

### Requirement: A Row Type Is Declared At The Query

A database row's type SHALL be declared where the query is built, not asserted
where its result is used.

#### Scenario: A query result is asserted at the call site

- **WHEN** a reader writes `db.query(sql).get(id) as Row`
- **THEN** it declares `db.query<Row, Params>(sql)` instead, so the driver
  carries the row type and the query's parameters are checked too

#### Scenario: The declared parameters disagree with the statement

- **WHEN** typing a query reveals that its declared parameters do not match its
  placeholders
- **THEN** that is treated as a defect the assertion was concealing, not as an
  obstacle to the conversion

#### Scenario: The parameter arity is not statically readable

- **WHEN** a query's placeholders are built at runtime, so no parameter tuple
  can be written for it
- **THEN** the row type is still declared and the parameters are typed as the
  driver's open binding array, because the readable half of the contract is not
  given up for the unreadable one

### Requirement: A Parse Must Not Narrow What A Boundary Accepts

Replacing a structural walk with a parse SHALL NOT reject payloads the previous
code accepted.

#### Scenario: Stored data uses a legacy shape

- **WHEN** a boundary reads rows written by an earlier version of the document
  contract
- **THEN** the parse accepts them, because tolerance at a boundary is usually an
  unfinished migration rather than sloppiness

#### Scenario: A handler coerces rather than rejects

- **WHEN** the code being replaced makes a DECISION about a value, such as a
  `typeof` that routes a non-string to "clear this field"
- **THEN** the schema reproduces that decision, because a schema stricter than
  the checks it replaces is a behaviour break wearing a correctness argument

#### Scenario: A handler performs no check at all

- **WHEN** the code being replaced only supplies a default, as in
  `limit: body.limit ?? current.limit`, and writes whatever arrived
- **THEN** the schema adds the check, because that is an absence rather than a
  tolerance — nothing was deciding anything, and the value reaches storage
  unexamined

#### Scenario: A declared type is more optimistic than the handler

- **WHEN** a body's asserted type marks a field required while the handler reads
  it defensively
- **THEN** the schema follows the HANDLER, because the assertion was a wish and
  the guard is the contract

#### Scenario: A table holds too few rows to check against

- **WHEN** the stored corpus for a boundary is small enough that scanning it
  would pass without exercising the parse
- **THEN** that is recorded as unverified rather than reported as checked

### Requirement: A Surviving Assertion Carries Its Invariant

An assertion that remains after its boundary is typed SHALL state the invariant
that makes it sound.

#### Scenario: The assertion is not a missing parse

- **WHEN** an assertion narrows a supertype the caller has genuine knowledge
  about, such as a DOM query result
- **THEN** it keeps the assertion and states that knowledge in a `SAFETY:`
  comment

#### Scenario: Justifications written to clear a count

- **WHEN** a change would add justification comments in bulk
- **THEN** it does not, because a sentence written to satisfy a linter is the
  low-evidence text the rule exists to catch

### Requirement: The Gate Runs On Changed Files, Until A Rule Is Closed

The repository SHALL replace differential lint filtering and separate closed-rule selection with one repository-wide standard static gate after measured debt resolution. Every enabled lint rule SHALL fail the gate on genuine findings anywhere in maintained source, regardless of Git history or which lines changed. Rule dispositions SHALL remain evidence-based and cause-scoped. The historical requirement title SHALL NOT imply that changed-file filtering remains supported after cutover.

#### Scenario: A pull request touches a file with existing violations

- **WHEN** a contributor edits a file that violates a gated rule
- **THEN** the repository-wide gate reports the violation without a changed-line filter

#### Scenario: A file nobody touched still violates a rule

- **WHEN** an enabled rule is violated outside the diff
- **THEN** the repository-wide gate fails and identifies the finding

#### Scenario: Measuring the remaining debt

- **WHEN** migration measures existing lint findings
- **THEN** it records per-rule findings and causes before repairs or disposition changes

#### Scenario: A rule reaches zero

- **WHEN** every finding is fixed or scoped by a named cause
- **THEN** the standard gate checks that rule across the repository without a separate closed-rule list

#### Scenario: Zero was reached mostly by scoping

- **WHEN** a rule reads zero because most findings were scoped away
- **THEN** the split between fixed and scoped is recorded rather than presenting zero as evidence of code repairs

#### Scenario: The repo-wide report is treated as a target

- **WHEN** migration proposes clearing repository-wide findings
- **THEN** it first records which findings describe correct code and does not change correct code merely to clear a count

#### Scenario: Migration has unresolved genuine findings

- **WHEN** repository-wide static checks still report genuine errors
- **THEN** cutover and custom-runner deletion remain incomplete rather than disabling rules or reporting success

### Requirement: A Payload This System Did Not Write Is Parsed On Arrival

A response from a third party, a tool call from a model, or a request body from
a client SHALL be parsed against a schema at the point it enters the system.

#### Scenario: A third-party response is read field by field

- **WHEN** code asserts the shape of an external HTTP response, as in
  `(await res.json()) as { items: T[] }`
- **THEN** it parses instead, against a schema covering the fields it reads, so
  a provider changing its response is detected where it arrives

#### Scenario: A route handler asserts the shape of a request body

- **WHEN** a route reads `(await c.req.json()) as { field?: T }`
- **THEN** it parses against a schema covering the fields it reads, because the
  browser that sent it is not this system either, and nothing downstream will
  reject a wrong type

#### Scenario: A route param is narrowed to a domain union

- **WHEN** a handler asserts `c.req.param("id")` into an id or enum type
- **THEN** it checks membership instead, because a path segment is client input
  and the assertion is the only thing claiming it is valid

#### Scenario: A model produces tool arguments

- **WHEN** a tool handler reads arguments out of an unparsed dictionary
- **THEN** the arguments are parsed against that tool's schema, and a call that
  does not match is reported as a failed call rather than absorbed into defaults

### Requirement: A Schema Describes What The Code Reads

A schema for an external payload SHALL cover the fields its call site uses, and
SHALL pass unknown fields through.

#### Scenario: A provider adds a field

- **WHEN** a third party adds a field the code does not read
- **THEN** the parse still succeeds, because the schema was derived from the
  call site rather than copied from the provider's documentation

#### Scenario: A field the code depends on disappears

- **WHEN** a field the call site reads is absent from a response
- **THEN** the parse fails, and the failure names the field

### Requirement: A Parse Failure Is Handled As That Boundary Fails

Handling for a failed parse SHALL match how failures at that boundary actually
behave.

#### Scenario: A provider's response stops matching

- **WHEN** a third-party response fails to parse
- **THEN** the call fails, because a silent fallback turns a provider's breaking
  change into slowly corrupted output

#### Scenario: A model sends a malformed tool call

- **WHEN** tool arguments fail to parse
- **THEN** the failure is reported back to the model as a failed tool call, so it
  can retry — a model error is ordinary and recoverable, unlike a provider change

### Requirement: An External Schema Is Verified Against Observed Payloads

A schema for an external boundary SHALL be checked against payloads the system
has actually received before it ships.

#### Scenario: No stored corpus exists

- **WHEN** a boundary has no history of stored payloads to scan
- **THEN** a real payload is recorded and committed as the fixture the schema is
  written against and tested with

#### Scenario: A corpus does exist

- **WHEN** past accepted payloads are recoverable, as tool calls are from
  `content_project_events`
- **THEN** the schema is checked against them, and one that rejects a previously
  accepted payload is treated as a bug in the schema

### Requirement: A Control's Options And Its Handler Share One Source

Where a form control offers a fixed set of values, the list it renders and the
handler that receives them SHALL come from the same array.

#### Scenario: A select asserts its own value

- **WHEN** a handler reads `e.target.value as SomeUnion` while the `<option>`s
  render from a constant
- **THEN** the handler checks against that same constant, because the assertion
  claims the browser can only return a member and nothing enforces it

#### Scenario: The options are written inline

- **WHEN** a control's values exist only as literal `<option>` children
- **THEN** they are named as a constant and both sides read it, so the set has
  one definition rather than two that can drift

### Requirement: A Rejected Value Is Not Silently Dropped

Replacing an assertion with a membership check SHALL NOT turn an invalid value
into a no-op without saying so.

#### Scenario: A check replaces a cast in an event handler

- **WHEN** `oneOf` returns undefined for a value the old cast would have applied
- **THEN** what happens instead is decided and stated, because a control that
  quietly ignores a change is a worse defect than the assertion it replaced

### Requirement: A Response Is Parsed On The Way Back

A body read from a service over the network SHALL be parsed before it is used as
a domain type, in the same way an inbound request body is.

#### Scenario: The two sides can already share a module

- **WHEN** a client and the route it calls both import a common package
- **THEN** the schema is defined once there, so that a change to the response is
  a type error rather than a runtime surprise

#### Scenario: Sharing would add a dependency that does not exist yet

- **WHEN** the two sides could import a common module only by taking a NEW
  dependency, as a standalone deployable service would
- **THEN** the schema is copied to the reading side instead, because adding a
  compile-time edge between separately deployed services is a deployment
  decision and not a side effect of removing an assertion

#### Scenario: The dependency direction forbids sharing outright

- **WHEN** the two sides cannot import a common module, as `@maleo/video`
  cannot import `@maleo/shared`
- **THEN** the schema is copied to the reading side and a test asserts it still
  accepts what the other side produces, because a copy with nothing linking it
  is two definitions that drift

### Requirement: An Assertion The Compiler Does Not Need Is Deleted

An assertion that narrows nothing SHALL be removed rather than documented.

#### Scenario: The asserted type is what the expression already has

- **WHEN** deleting an assertion leaves the file type-checking with the same
  inferred type
- **THEN** it is deleted, because a `SAFETY:` comment on a no-op teaches the
  reader that the claim mattered

#### Scenario: A helper's return type is narrower than what it returns

- **WHEN** several callers re-assert the same helper's result
- **THEN** the helper's return type is corrected, so the fix lands once instead
  of at every call site

### Requirement: A Decoder That Takes A Type Parameter Is Not A Parse

A helper that returns `T` because its caller named `T` SHALL NOT be counted as
validating anything.

#### Scenario: A generic JSON decoder is converted

- **WHEN** a decoder like `parseJsonValue<T>` gains the ability to take a schema
- **THEN** callers move to it one family at a time, each verified against rows
  that already exist, because a schema too strict for older rows degrades them
  to the fallback with no error

### Requirement: Evidence Tooling Is Verified Against What It Reads

A script that classifies or counts lint findings SHALL be checked against the
findings it extracts before its output is recorded as a sample.

#### Scenario: A classifier extracts source text by offset

- **WHEN** a tool slices a diagnostic's source span to decide what a finding is
- **THEN** the extraction is verified on findings whose text is known, because a
  slice taken with the wrong unit — a byte offset applied to a character index —
  produces plausible text from the wrong place and reports as measured

#### Scenario: A recorded sample was produced by a tool later found to be wrong

- **WHEN** a defect is found in a script whose output a disposition was decided
  from
- **THEN** the affected numbers are re-run and the record corrected, rather than
  the defect being fixed only for future runs

#### Scenario: One assertion is reported more than once

- **WHEN** a nested construct such as `x as unknown as T` produces a finding for
  each assertion
- **THEN** the count distinguishes findings from sites, so a total is not read as
  a number of places to change

### Requirement: A Type Argument Replaces An Assertion Only If It Is Checked

Converting an asserted result into a type argument SHALL preserve the checking
the conversion exists to add.

#### Scenario: The parameter tuple does not match the statement

- **WHEN** declaring a query's parameters reveals a disagreement with its
  placeholders
- **THEN** the disagreement is fixed as the defect it is, and the tuple is not
  loosened until it compiles — a site converted that way removes the finding and
  keeps the bug

#### Scenario: The row type is copied from the assertion being replaced

- **WHEN** a row type is moved from a cast into a type argument
- **THEN** it is checked against the table's columns, because the asserted type
  was never verified either and relocating it proves nothing

### Requirement: One File Has One Parse

Where more than one reader exists for the same file or record, they SHALL share
a parse. A reader that returns the raw value SHALL NOT coexist with one that
parses it.

#### Scenario: A second reader bypasses an existing schema

- **WHEN** one function parses a file with a schema and another reads the same
  file and returns `unknown`
- **THEN** the unparsed reader is routed through the schema, because its callers
  are asserting a contract that is already written and in reach

#### Scenario: The parsing reader is in another package

- **WHEN** the schema lives in a package the unparsed reader's package already
  depends on
- **THEN** the dependency is used, because the reason to duplicate a schema is a
  dependency that does not exist, not one that does

#### Scenario: The schema does not cover every block the callers read

- **WHEN** routing a reader through an existing schema would drop fields its
  callers depend on, because the schema is a closed object and those fields are
  undeclared
- **THEN** the fields are declared from the STORED FILES before the reader is
  routed, and never from what the call sites assert — an assertion records what
  someone believed the field held, and a schema derived from it reproduces that
  belief with more authority

#### Scenario: The file is edited by hand

- **WHEN** the boundary being parsed is a configuration file an operator edits
  directly
- **THEN** what a parse failure does is decided per call site before the parse
  lands, because converting a typo in one block into a failure of every reader is
  a larger regression than the assertions being removed

### Requirement: A Type Left Open For A Consumer Is Parsed By That Consumer

Where a shared module keeps a field open because its domain type belongs to a
consuming package, the parse SHALL be written in that consumer, and the shared
type SHALL NOT be narrowed to reach it.

#### Scenario: A shared schema records why a field is open

- **WHEN** a field is typed `z.record(z.unknown())` with a stated reason that the
  domain type is owned by a client and the shared module stays decoupled from it
- **THEN** the reason is re-read and either agreed with or overturned explicitly,
  and agreeing with it does not end the work — the parse moves to the consumer
  rather than disappearing

#### Scenario: Narrowing the shared type would invert a dependency

- **WHEN** naming the consumer's type in the shared schema would make the shared
  package import from its consumer
- **THEN** the shared type stays open, because a lint count is not a reason to
  reverse a dependency direction

#### Scenario: An open shared type is read as nothing left to do

- **WHEN** a scoped or deliberately open type is cited as the reason its
  consumers may assert
- **THEN** that is rejected, because the consumer holds the domain type and is
  the one place where a real check is possible

### Requirement: A Reader That Asserts Once Is Not A Parse

Replacing many assertions with a single helper SHALL NOT be counted as parsing
unless the helper checks the value.

#### Scenario: A helper concentrates the cast

- **WHEN** a function takes an open type and returns a domain type by asserting
  inside itself
- **THEN** it has moved the findings rather than removed them, and the count
  falling is not evidence the boundary is checked

### Requirement: File-size gate violations are resolved by ownership splits

When the repository layer gate reports a file over its line ceiling, the fix SHALL preserve the configured ceiling and split the file by existing ownership boundaries. A change SHALL NOT raise the ceiling, add a waiver, or add a path ignore unless it also changes the rule's accepted disposition through a separate lint-rule decision.

An ownership split SHALL keep extracted code in the nearest owning folder and SHALL preserve existing public component contracts unless the change explicitly updates the affected behavior spec.

#### Scenario: Oversized timeline file is split

- **WHEN** `apps/web check:layers` reports a timeline component over the file-size ceiling
- **THEN** the file is reduced below the ceiling by moving a cohesive owned region into a nearby timeline module
- **AND** the layer gate passes without increasing the ceiling

#### Scenario: Gate behavior is unchanged

- **WHEN** the split lands
- **THEN** `check-layers.ts` still enforces the same line ceiling
- **AND** no new ignore or waiver is added for the oversized file

#### Scenario: Timeline behavior is preserved

- **WHEN** the extracted timeline component is exercised through focused tests or visual coverage
- **THEN** editor and Motion Studio behavior remains unchanged

### Requirement: A Union Has One Declaration

A union this repository owns SHALL be declared once, and every narrowing check
and every type position that needs it SHALL read that declaration.

#### Scenario: The same union is written out at several call sites

- **WHEN** a union's members appear as a repeated inline literal, as
  `"video" | "text" | "audio" | "effect" | "infographic"` written three times in
  one file
- **THEN** it is named once and imported, because copies cannot be shown to
  agree and this one did not — the function they were narrowing for accepts a
  member none of the copies list

#### Scenario: A narrowing check and a type declare the set separately

- **WHEN** the array a membership check runs against and the union a value is
  narrowed to are two definitions of the same set
- **THEN** the union is derived from the array, so a member added in one place
  cannot be missing from the other

#### Scenario: The copies disagree about the set

- **WHEN** reconciling duplicate declarations shows they do not contain the same
  members
- **THEN** which one is correct is established from the callers, not from
  whichever reconciliation makes the lint count fall, because both directions
  compile and only one of them preserves behaviour

### Requirement: An Assertion Into A Union Arm Is Not A Check

Naming a value as a member of a union SHALL NOT stand in for verifying that it
is one.

#### Scenario: A boundary casts rather than checks, and says so

- **WHEN** code asserts a loose string into a narrower union and documents the
  gap, as in a comment that the sender "sends these as loose strings" and the
  reader "narrows on read"
- **THEN** the value is checked against the union's members where it arrives,
  because a comment describing an unchecked narrowing documents the defect
  rather than discharging it

#### Scenario: The narrowing is deferred to a later reader

- **WHEN** the justification for an assertion is that something downstream will
  narrow the value again
- **THEN** it is not accepted, because the value is already typed as a member by
  then and the later reader has nothing left to reject

#### Scenario: A value that fails the check was previously stored

- **WHEN** adding the check would reject values already written to a document by
  an earlier build
- **THEN** the fallback for a non-member is decided per field and the stored
  corpus is checked before the narrowing ships, because rejecting a saved
  project is a worse outcome than the assertion being fixed

### Requirement: A Widening A Library Requires Is Carried Once

Where a dependency's signature forces an assertion that no invariant can
justify, the assertion SHALL exist in one named place rather than at each call.

#### Scenario: The same library widening repeats across a module

- **WHEN** a framework's parameter type forces the same cast at several call
  sites, as a status code narrowed to a literal for a response helper
- **THEN** one wrapper carries it with the reason stated once, so the claim has
  a single place to be checked and corrected

### Requirement: A Rule That Names Its Own Constructs Is Tuned, Not Floored

Where a rule reports several constructs under one rule id, and its own output
distinguishes them, each construct SHALL carry its own disposition in the RULE
rather than a shared floor recorded beside a single severity.

#### Scenario: One rule id covers constructs with different rates

- **WHEN** a rule's findings split into sub-kinds its message text already names,
  and a sample measures those sub-kinds at materially different true-positive
  rates
- **THEN** the rule is split so each sub-kind can be gated, scoped or retired on
  its own evidence, because a single severity over a mixed rule publishes the
  aggregate this capability already forbids

#### Scenario: The rule source is vendored for tuning

- **WHEN** separating the sub-kinds requires editing the rule rather than the
  configuration
- **THEN** the vendored source is edited, because it is vendored on the stated
  grounds that the rules are opinions a team is expected to tune, and drift from
  upstream is recorded rather than avoided

#### Scenario: A sub-kind is measured and left alone

- **WHEN** a sub-kind's sample shows it is genuine
- **THEN** it keeps the gate it had, so splitting a rule cannot quietly weaken
  the half that was working

#### Scenario: Splitting is proposed without a per-sub-kind sample

- **WHEN** a split is argued from the rule's structure rather than from measured
  rates per sub-kind
- **THEN** it is not made, because the reason to split is evidence that the
  sub-kinds differ, and a split made without it is a severity reduction wearing a
  taxonomy

### Requirement: A Scope Accepted For One Rule Is Not Evidence For Another

Extending an existing scope entry to a further rule SHALL be decided from a
sample of that rule's findings in those files, not from the entry's existence.

#### Scenario: A file is already scoped for a different rule

- **WHEN** a rule fires in a file whose `overrides` entry names an accepted cause
  for another rule
- **THEN** the cause is tested against this rule's findings there before the
  entry is extended, because the entry records why one TYPE is open and says
  nothing about why an assertion beside it is sound

#### Scenario: The cause covers only part of a group

- **WHEN** sampling a scoped group shows some findings match its stated cause and
  others match a different cause with a real fix
- **THEN** the entry is not extended over the whole group; the matching findings
  are scoped and the rest are left in scope and handed to the change that fixes
  them

#### Scenario: A group is extended on its file list alone

- **WHEN** an extension is justified by which files are already listed rather
  than by what the findings in them are
- **THEN** it is rejected, because a scope inherited by location is the ignore
  list this vocabulary exists to avoid, arrived at one rule later

### Requirement: A Severity Change Applies To Both Gates

A rule disposition SHALL apply consistently to local staged checks and the complete CI static gate. Any severity change SHALL state its effect on both and retain recorded evidence. Migration SHALL NOT demote an enabled rule merely to clear existing findings.

#### Scenario: A sub-kind is demoted to clear the repo-wide count

- **WHEN** demoting a rule would make the repository-wide command pass
- **THEN** its effect on new-code enforcement is stated and the change is rejected unless evidence justifies the disposition

#### Scenario: A sub-kind is noise on old code and signal on new

- **WHEN** a construct is measured as mostly correct in existing code but should not be introduced in new code
- **THEN** detection is narrowed by cause rather than demoting the rule everywhere

#### Scenario: A rule is demoted to `warn`

- **WHEN** warning severity is proposed as a middle position
- **THEN** it is rejected unless the rule is being retired with evidence, because non-failing warnings do not enforce the policy

#### Scenario: Hooks check a subset of files

- **WHEN** staged checks inspect only staged paths
- **THEN** they use the same rule dispositions as full CI, which checks all maintained source

### Requirement: Promotion Of The Repository-Wide Command States Its Remainder

Promoting the standard repository-wide lint command to the required gate SHALL record each rule's remaining findings, code repairs, cause-based scopes, and retirements. Promotion SHALL require no unresolved genuine errors in enabled scope and SHALL NOT use a custom finding filter or baseline to manufacture success.

#### Scenario: The command reaches zero

- **WHEN** every enabled rule reports no findings repository-wide
- **THEN** the split between fixed, scoped, and retired findings is recorded per rule before promotion

#### Scenario: A change gets partway

- **WHEN** migration reduces findings without clearing genuine errors
- **THEN** it records remaining causes in OpenSpec tasks and does not declare cutover complete

#### Scenario: An undeclared workspace contributes findings

- **WHEN** a directory matched by workspace globs is absent from the workspace map
- **THEN** its ownership is settled before counting its findings or excluding it from the gate
