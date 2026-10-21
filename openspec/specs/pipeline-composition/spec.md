# Pipeline Composition

## Purpose

Every pipeline the product runs is declared as data in one place — a named stage
order — and every stage is registered once with the context it reads. A call site
selects a pipeline; it never assembles one, and never defines a stage body.

## Requirements

### Requirement: Stages are registered once per profile

A pipeline stage SHALL be defined exactly once, by id, in the registry its profile
resolves against. A call site SHALL NOT construct stage bodies, and a stage id SHALL
NOT have more than one implementation within a registry.

#### Scenario: A stage has one implementation within its profile

- **WHEN** a profile runs a stage id, whether starting fresh or resuming
- **THEN** it resolves to the same registered implementation every time

#### Scenario: One id may mean different work in different profiles

- **WHEN** two content types both run a stage id that denotes different work, such as
  drafting slides from a brief versus generating assets from an approved plan
- **THEN** each profile resolves its own implementation, and neither is forced to
  branch on content type to decide what it is or whether it costs assets

#### Scenario: Duplicate registration is refused

- **WHEN** a stage id is registered twice in one registry
- **THEN** registration fails, naming the duplicated id

### Requirement: A stage is one unit, including deferred commits

A stage that parks for approval SHALL have its commit defined with it, not in the
code that resumes the run. A registered stage SHALL NOT be identified by whatever
cursor a parked run happens to carry.

#### Scenario: Gate and commit are declared together

- **WHEN** a stage parks for approval and is later approved
- **THEN** the commit that runs is the one declared with that stage

#### Scenario: Stage identity is known before parking

- **WHEN** a stage is registered
- **THEN** its id is fixed at registration, not derived from run state

#### Scenario: A run parked before this change still resumes

- **WHEN** a run parked with a cursor written by earlier code is resumed
- **THEN** it resolves to the stage that now owns that work, and completes

### Requirement: Profiles are data referencing registered stages

A pipeline profile SHALL be declared as data naming registered stage ids in order.
A call site SHALL select a profile rather than assembling a stage order.

#### Scenario: Profile names an unregistered stage

- **WHEN** a profile lists a stage id that is not registered
- **THEN** registration fails, naming the profile and the missing id

#### Scenario: Call site selects rather than assembles

- **WHEN** a pipeline run starts
- **THEN** its stage order comes from the selected profile, and no stage order is
  written at the call site

### Requirement: A stage declares the context it consumes

Each registered stage SHALL declare the context it reads, drawn from a defined set
of context keys covering the brief, material channels, style lock, timeline
template, and prior stage output.

#### Scenario: Declared context is rendered in a trace

- **WHEN** a stage runs
- **THEN** the trace records which context the stage declared it consumes

#### Scenario: Unknown context key is refused

- **WHEN** a stage declares a context key that does not exist
- **THEN** the declaration fails to compile

### Requirement: Stage behavior is unchanged by centralization

Moving a stage into the registry SHALL NOT change its prompts, gating, outputs, or
approval behavior.

#### Scenario: Moved stage behaves identically

- **WHEN** a stage that previously lived at a call site runs from the registry
- **THEN** it produces the same draft, gates on the same condition, and commits the
  same result as before the move
