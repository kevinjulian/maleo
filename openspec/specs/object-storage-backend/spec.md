# object-storage-backend Specification

## Purpose

Where media bytes live and what owns them: one storage seam every durable write
goes through, a backend chosen by configuration rather than code, objects keyed
by their owner, and credentials held only in deployment secrets. Written because
media written straight to local disk is lost with the container that wrote it,
and a storage call made outside the seam is a write no migration can find.

## Requirements

### Requirement: One seam owns media storage

All application-side durable managed-media writes and reads SHALL pass through
a single storage module. No route, provider, or render step SHALL call the
filesystem or an object-store client directly for durable managed media.
Browser reads of signed object-store URLs, temporary render files, and legacy
reads during migration are exempt. The module SHALL expose put, get, delete,
and address operations without backend-specific callers.

#### Scenario: A provider writes generated output

- **WHEN** a media provider produces bytes to persist
- **THEN** it calls the storage seam, and the code contains no path construction or bucket reference at the provider

#### Scenario: A new backend is added

- **WHEN** a further storage backend is introduced
- **THEN** only the storage module changes, and no route, provider, or render step is edited

### Requirement: The backend is configuration, not a code path

The system SHALL select its storage backend explicitly. Production SHALL require
a complete S3-compatible configuration and SHALL fail startup if it is absent.
Local disk SHALL require an explicit development selection. MinIO, R2, and S3
SHALL use the same application code and key layout.

#### Scenario: Pointing at MinIO and at R2

- **WHEN** the configured endpoint names a MinIO instance, and separately an R2 bucket
- **THEN** both work without any code change, and the same key layout is used for each

#### Scenario: Production starts without object storage

- **WHEN** a production API, media worker, or video service starts without complete object-storage configuration
- **THEN** startup fails naming the missing storage configuration and does not select local disk

#### Scenario: Development selects local disk

- **WHEN** local disk is explicitly selected in development without an object store
- **THEN** the application starts and writes under `MALEO_DATA_DIR`

### Requirement: Object storage is ready before production media work

The self-hosted object-store deployment SHALL have a durable data volume, a
private bucket created idempotently, and readiness gating for services that use
it. Production configuration SHALL identify both the endpoint used by services
and the browser-reachable endpoint used to sign reads of the same bucket.

The deployed server SHALL be one whose images are published and pullable. An
image that resolves only from a local daemon cache is not deployable, and the
deployment SHALL fail at pull rather than appear configured.

#### Scenario: A new self-hosted stack starts

- **WHEN** the object server starts with an empty durable volume
- **THEN** the private bucket is created before API, media-worker, or video media operations begin

#### Scenario: An app instance is replaced

- **WHEN** an API or worker instance is replaced while the object-store data volume remains
- **THEN** previously stored media remains readable from the replacement instance

#### Scenario: The pinned image is withdrawn

- **WHEN** the pinned object-store image no longer resolves from its registry
- **THEN** the deployment fails at pull, and the fix is a different server rather than a re-pin, because no tag of the withdrawn image resolves

### Requirement: Objects are addressed by an owner-scoped unique key

An object key SHALL be scoped by owning workspace, then media kind, then the
owning project where one exists, and SHALL end in a per-write unique identifier
followed by a readable filename. A media registry SHALL bind a stable opaque ID
to that key, its owning workspace, content type, size, and the SHA-256 of its
bytes. Each write SHALL produce its own object and its own registry identity; a
key SHALL NOT be reused or overwritten.

The workspace segment SHALL be the workspace name itself, and a name that is not
usable as a single path segment SHALL fail the write rather than be rewritten
into one, so two workspaces can never share a prefix.

#### Scenario: A bucket listing is navigable by owner

- **WHEN** an operator lists the bucket
- **THEN** keys group by workspace, then media kind, then project, and each object's filename is readable

#### Scenario: The same file is uploaded twice

- **WHEN** identical bytes are stored twice
- **THEN** each write has its own key and its own media identity, and deleting one leaves the other readable

#### Scenario: Keys carry the workspace

- **WHEN** two workspaces store media
- **THEN** the keys differ by workspace, so deleting one workspace's media cannot remove the other's

#### Scenario: A workspace name cannot escape its prefix

- **WHEN** a write names a workspace that is not usable as one path segment
- **THEN** the write fails and no object is stored under a rewritten name

#### Scenario: Two writes race

- **WHEN** two writes of the same bytes, workspace, and kind complete concurrently
- **THEN** both succeed with distinct keys and distinct identities, and neither overwrites the other

### Requirement: Managed-media ownership comes from trusted context

The owning workspace SHALL be derived from a persisted project or a validated
workspace-level request before bytes are stored or a media identity is issued.
Worker output SHALL use the durable job's workspace. A client-provided workspace,
object key, or URL alone SHALL NOT establish ownership.

#### Scenario: A project upload disagrees with active workspace

- **WHEN** an operator uploads to a project while another workspace is active in the client
- **THEN** the media is stored under the project's persisted workspace

#### Scenario: A reference-library upload names an inaccessible workspace

- **WHEN** an upload names a workspace the caller cannot access
- **THEN** the upload is refused before an object or registry record is created

#### Scenario: A worker completes a job

- **WHEN** a worker stores generated media for a durable job
- **THEN** the media is registered under that job's persisted workspace

### Requirement: Shared objects are removed only when unreferenced

Deleting one asset SHALL remove its logical reference without deleting bytes
still used by another persisted asset, project document, timeline, or active job.
Physical deletion SHALL require a successful reachability check after a grace
period; an incomplete check SHALL retain the object.

#### Scenario: Two projects reuse one object

- **WHEN** one of two projects in a workspace removes its reference to a shared object
- **THEN** the other project's media remains readable

#### Scenario: Reachability cannot be proved

- **WHEN** cleanup cannot inspect a persisted reference source or active job
- **THEN** it retains the object and reports the incomplete cleanup

### Requirement: Existing local media survives the object-storage cutover

Before legacy file routes or volumes are removed, the system SHALL inventory
their live references, copy available bytes to the selected object store,
associate each copy with its trusted workspace, and rebind live references to a
stable media URL or an owner-scoped compatibility mapping. Missing legacy bytes
SHALL be reported and SHALL NOT be claimed as migrated. A legacy route SHALL
remain while any live reference still needs bytes available only through it.

#### Scenario: An old project is opened after migration

- **WHEN** a project stored before the cutover refers to a local upload or worker file
- **THEN** its media loads from migrated storage without requiring the original app instance

#### Scenario: A legacy file is missing

- **WHEN** inventory finds a persisted local URL whose bytes are absent
- **THEN** migration reports that URL and does not claim the media was migrated

#### Scenario: Historical ledger rows share identical bytes

- **WHEN** distinct backfilled ledger rows in one project resolve to one stored media object
- **THEN** each ledger row keeps its own ID and provenance while both use the same stable media URL

### Requirement: Media written on disk lives under the data directory

Any media the local-disk backend writes SHALL be placed under the path resolved
from `MALEO_DATA_DIR`. The system SHALL NOT resolve a media path relative to the
process working directory.

This requirement exists because `path.resolve("public/uploads")` placed uploads
outside the mounted volume, so a container redeploy destroyed them.

#### Scenario: The process runs from a different directory

- **WHEN** the API is started with a working directory other than the repository root
- **THEN** media is written under the configured data directory, at the same location as when started from the root

#### Scenario: A deployment mounts a volume

- **WHEN** the data directory is a mounted volume and the container is replaced
- **THEN** previously written media is still present and readable

### Requirement: A storage failure fails the operation

When the store cannot be reached, the operation SHALL fail and SHALL name
storage as the cause. The system SHALL NOT silently fall back to another
backend, and SHALL NOT report success for media it did not persist.

#### Scenario: The object store is unreachable during a generation

- **WHEN** a generation completes but the store cannot be written to
- **THEN** the job fails naming storage, and no record claims a stored asset

#### Scenario: A read misses

- **WHEN** a stored object is requested and is absent from the store
- **THEN** the caller receives a not-found result, not an empty object or a placeholder

### Requirement: Credentials stay in deployment secrets

Object-store access keys SHALL be supplied to the API, media worker, and video
service through deployment secrets. They SHALL NOT be written to project data,
persisted as plaintext in the database, sent to the browser, or logged.

#### Scenario: A deployment injects credentials

- **WHEN** each service starts with injected object-store credentials
- **THEN** it can use the same bucket without reading infrastructure credentials from project data

#### Scenario: A media URL is issued

- **WHEN** an authorized browser requests managed media
- **THEN** its response contains a time-limited read URL and no object-store credential

### Requirement: Browser origins are allowed on the bucket

The origin allowed to read media in a browser SHALL be configured as bucket CORS
through the S3 API, applied by the same initialization that creates the bucket.

The previous server's community build did not implement `PutBucketCors`, which
forced a server-wide origin variable. Bucket configuration is where the rest of
the S3 settings already live, and it survives a server swap.

#### Scenario: The bucket is initialized

- **WHEN** initialization runs against an empty server
- **THEN** the bucket exists, is private, and carries a CORS rule naming the web origin for GET and HEAD with range headers exposed

#### Scenario: A browser reads media cross-origin

- **WHEN** the web client reads a presigned media URL from the web origin
- **THEN** the read succeeds, and a request from an origin not in the rule does not

### Requirement: The self-hosted store's credential scoping is recorded

Deployment guidance SHALL state whether the credentials given to the
application are scoped to the bucket or administer the server, so an operator
knows the blast radius of a leaked key without reading the init script.

RustFS 1.0 exposes a single access key, so the application credential is also
the administrative one — a reduction from the bucket-scoped user the previous
server allowed.

#### Scenario: An operator reads the storage guidance

- **WHEN** an operator opens the object-store README
- **THEN** it states that the configured credentials administer the server, and names hosted storage as the path to narrower scoping
