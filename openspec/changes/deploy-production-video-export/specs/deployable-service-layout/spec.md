# Spec Delta

## ADDED Requirements

### Requirement: Production core includes authenticated video export execution

Both production deployment targets SHALL include video rendering on their internal service network. API SHALL submit exports using an explicit worker address and shared render credential. Render control endpoints SHALL reject missing or incorrect credentials. Worker ports SHALL remain unpublished. Missing required render credentials SHALL fail deployment configuration before serving export requests.

#### Scenario: Operator deploys either production target

- **WHEN** the core stack starts with required secrets
- **THEN** API can submit and poll render jobs through the internal worker address
- **AND** rendering requires no separate manual worker process

#### Scenario: Render credential is missing or incorrect

- **WHEN** the required render credential is absent from deployment configuration
- **THEN** configuration validation fails and identifies the missing variable
- **WHEN** a caller sends an incorrect credential to a render control endpoint
- **THEN** the worker refuses access

### Requirement: Production render execution retains state and accesses managed media

Production render execution SHALL retain its job queue across container recreation and publish completed artifacts to the configured media store. It SHALL retrieve managed inputs through authenticated workspace-scoped API access. Required render browser and system dependencies SHALL be available in the built image without a first-export browser installation. Existing completed exports SHALL remain retrievable after worker recreation.

#### Scenario: Project contains managed video and audio

- **WHEN** an authorized user exports a project with managed media
- **THEN** the worker fetches those inputs through authenticated workspace-scoped access
- **AND** produces a playable video containing the selected media
- **AND** the user retrieves the result through the existing authorized API flow

#### Scenario: Worker container is recreated

- **WHEN** a worker container is recreated using the same persistent storage
- **THEN** existing job records remain available
- **AND** completed export artifacts remain retrievable

### Requirement: Deployment verification covers functional video export

Repository deployment checks SHALL reject missing render service wiring in either deployment target, including when both targets have the same omission. Release verification SHALL distinguish static configuration validation, container render execution, and live production export evidence. Worker health alone SHALL NOT establish export success.

#### Scenario: Both deployment files lose export wiring

- **WHEN** both deployment files omit render worker connection settings or the render service
- **THEN** deployment checks fail despite parity between the files

#### Scenario: Production export is verified

- **WHEN** a rollout is reported as verified for video export
- **THEN** an authorized user submits an export through the deployed application
- **AND** observes successful completion and downloads a playable MP4
- **AND** verification records container restart persistence separately from service health
