# media-url-resolution Specification

## Purpose

How a browser, a service, and the render pipeline reach stored media: private
by default, authorized per read through a stable route, persisted as stable
references rather than signed URLs, and still usable after a signature expires.
Written because a signed URL persisted into a document is a document that breaks
on a timer, and a public bucket is every workspace's media readable by anyone
who guesses a key.

## Requirements

### Requirement: Stored media is private by default

An object holding workspace media SHALL NOT be anonymously readable. The bucket
SHALL refuse public reads, and access SHALL be granted per request for a limited
time.

A content-addressed key is unguessable but permanent. Serving media from a public
bucket means any URL that is ever shared, logged, or forwarded grants access to
that object forever, across tenants.

#### Scenario: An object key is requested directly

- **WHEN** an object key is requested from the store without an authorisation
- **THEN** the store refuses it

#### Scenario: A previously issued URL is replayed after expiry

- **WHEN** a URL issued earlier is used after its lifetime has elapsed
- **THEN** it is refused, and a new URL must be issued

### Requirement: A stable media route authorizes every browser read

Persisted managed media SHALL use a stable API media URL. On each request, the
API SHALL look up its registry identity and authorize the caller for the owning
workspace. The object-store backend SHALL redirect authorized reads to a fresh
time-limited URL; the explicit local backend SHALL serve the same stable route
directly. Redirects SHALL NOT be cached past the signature's lifetime.

#### Scenario: A member loads media

- **WHEN** an authenticated member of the owning workspace requests a stable media URL
- **THEN** the API issues a fresh time-limited read URL and the media loads

#### Scenario: A non-member requests media

- **WHEN** an authenticated account that does not belong to the owning workspace requests a stable media URL
- **THEN** the request is refused and no signed URL is issued

#### Scenario: A local development media URL is read

- **WHEN** the local backend is explicitly selected and an authorized caller requests the stable URL
- **THEN** the API serves the local bytes through that URL with the same content type and range behavior

### Requirement: Persisted media fields hold stable references

Database URL columns and nested project, reference-library, storyboard, and
timeline documents SHALL persist the stable API media URL for managed media.
They SHALL NOT persist a time-limited signed URL, because it would expire in
place and break later reads. Unmanaged stock and external URLs SHALL continue to
pass through unchanged.

#### Scenario: A stored reference is read a month later

- **WHEN** a project or media record written a month ago is read
- **THEN** its stable media URL obtains a fresh authorized destination and loads

#### Scenario: A signed URL is written to the database

- **WHEN** code attempts to persist a signed, time-limited URL in a media column or nested project/timeline field
- **THEN** the write is refused and no signed URL is persisted

#### Scenario: A stock URL is stored

- **WHEN** a project stores an unmanaged stock or external URL
- **THEN** managed-media resolution does not rewrite that URL

### Requirement: Editor media remains usable after URL expiry

The editor SHALL load, seek, replay, decode, and export managed media from stable
URLs after a signed destination expires. A browser SHALL obtain a fresh read
without persisting that destination. Storage failures SHALL be visible to the
operator rather than appearing as a successful upload, generation, or export.

#### Scenario: A timeline stays open past URL expiry

- **WHEN** an operator seeks or replays media on a timeline kept open beyond the URL lifetime
- **THEN** the media loads from a freshly authorized destination

#### Scenario: Browser draft export reads media

- **WHEN** a draft export decodes audio and draws managed images to a canvas
- **THEN** both byte reads succeed and the export contains the expected media

#### Scenario: Storage fails during an upload

- **WHEN** a managed upload cannot write its bytes
- **THEN** the operator sees a storage failure and no media appears as successfully saved

### Requirement: Browser-reachable object URLs permit media byte reads

Signed object-store URLs SHALL use a hostname reachable by the browser. The
private bucket's CORS configuration SHALL allow the web origin to GET and HEAD
managed objects, including browser range requests, and SHALL expose the headers
needed to inspect content length and ranges. CORS SHALL NOT make unsigned object
keys anonymously readable.

#### Scenario: A browser reads from self-hosted MinIO

- **WHEN** application services reach MinIO by an internal hostname and a browser loads managed media
- **THEN** the signed destination uses the public hostname and the browser can read its bytes

#### Scenario: A waveform fetches object bytes

- **WHEN** the editor fetches managed audio to decode a waveform across origins
- **THEN** the fetch passes CORS and exposes the response headers needed by the decoder

### Requirement: Trusted service consumers resolve managed media at use time

The media worker, video service, and external generation handoffs SHALL resolve
managed media from its stable identity when they need bytes. Internal services
SHALL use the storage seam or a service-authorized read. An external provider
SHALL receive a narrowly scoped, browser-reachable read URL valid for its fetch
window. Arbitrary client URLs SHALL NOT bypass existing reference-URL safety
checks.

#### Scenario: A stored reference is used for image generation

- **WHEN** generation uses a project reference stored as a stable media URL
- **THEN** the reference passes managed-media validation and its bytes reach the provider

#### Scenario: An external video provider receives an image

- **WHEN** an image-to-video request uses a managed frame
- **THEN** the server supplies a fresh reachable read URL rather than a cookie-protected stable URL or expired signature

### Requirement: Bytes the render pipeline needs are fetched, not assumed local

A render step that requires a local file SHALL fetch managed bytes through the
storage seam to a temporary location and SHALL clean it up. It SHALL NOT assume
the bytes are already on the filesystem or persist a temporary signed URL.

#### Scenario: A render runs against object-stored media

- **WHEN** a render needs image, audio, or manifest bytes held in the object store
- **THEN** the bytes are fetched to a temporary path, used, and removed

#### Scenario: A fetch for render input fails

- **WHEN** an object a render needs cannot be fetched
- **THEN** the render fails naming the missing object, rather than rendering without it

### Requirement: Imported media is referenced by its final identity from import

A client SHALL mint the media identity of a file when it starts the import. A
document that references a file still being imported SHALL persist the stable
media URL of that identity. The reference SHALL NOT change when the import
finishes. Until then, the editor SHALL resolve the identity to the browser's
local copy when one exists, and every server consumer SHALL treat it as
unavailable.

Persistence boundaries SHALL refuse `blob:` media URLs, and `data:` media URLs
other than small inline images, in project, storyboard, and timeline
documents.

#### Scenario: Save while uploading

- **WHEN** a project with a placed clip whose import is still running is saved
- **THEN** the saved document holds the clip's stable media URL and no browser-local URL

#### Scenario: The import finishes

- **WHEN** the import of a placed clip becomes ready
- **THEN** the document's reference is unchanged and now resolves to the stored bytes

#### Scenario: A browser-local URL reaches persistence

- **WHEN** a save contains a `blob:` media URL, or a `data:` media URL that is not a small inline image, in a clip, scene, or media asset
- **THEN** the save is refused, no version is appended, and the reason names the field

### Requirement: The stable media route reports a pending import

An authorized read of a stable media URL whose identity belongs to an import
that has not finished SHALL return `409` with error `media_pending`. A read of
an identity whose import failed or was cancelled SHALL be answered as unknown
media. A caller who is not a member of the owning workspace SHALL receive the
same refusal as for any media, whatever the import state.

#### Scenario: A member reads a pending identity

- **WHEN** a workspace member requests the stable URL of an import that is processing
- **THEN** the response is `409` with `media_pending` and no signed URL

#### Scenario: A non-member reads a pending identity

- **WHEN** an account outside the workspace requests the same URL
- **THEN** the refusal matches the refusal for any other media of that workspace
