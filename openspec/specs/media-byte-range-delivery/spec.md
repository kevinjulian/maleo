# media-byte-range-delivery Specification

## Purpose

TBD - created by archiving change fix-media-range-requests. Update Purpose after archive.

## Requirements

### Requirement: Locally served media answers range requests

A request for a stable managed-media URL that carries a `Range` header SHALL
result in `206 Partial Content`, a `Content-Range` header naming the served
interval and total size, a `Content-Length` matching the returned bytes, and a
body containing only that interval. This SHALL hold for direct local delivery
and for an object-store URL reached through the authenticated API redirect.

Object-store range support SHALL be verified through the stable API URL and
redirect against the configured store. If a supported browser loses its Range
header across that hop, the API SHALL provide a range-preserving delivery path
for that browser. A direct bucket test alone does not discharge this requirement.

iOS Safari will not play network media from a server that does not honour ranges. It probes with a small range, and a `200` carrying the whole body is read as a refusal — playback never starts, with no error surfaced to the page. Because `fetch()` imposes no such requirement, a file can decode for a waveform and be unplayable in the same session, which is what made this invisible for as long as it was.

#### Scenario: A media element probes with a range

- **WHEN** a request for a media object carries `Range: bytes=0-1`
- **THEN** the response status is `206`, `Content-Range` is `bytes 0-1/<total size>`, and the body is exactly two bytes

#### Scenario: A range runs to the end of the file

- **WHEN** a request carries `Range: bytes=<n>-` with no end position
- **THEN** the response serves from `n` to the final byte and reports that interval in `Content-Range`

#### Scenario: A suffix range is requested

- **WHEN** a request carries `Range: bytes=-<n>`
- **THEN** the response serves the final `n` bytes of the file and reports their absolute interval in `Content-Range`

#### Scenario: Voiceover is played on a mobile browser

- **WHEN** an operator plays a timeline whose voiceover was synthesized to the configured media backend, on a browser that requires range support
- **THEN** the voiceover is audible

#### Scenario: Media is served from the object store

- **WHEN** a range request is made against a media URL issued by the object-store backend
- **THEN** it is answered with `206` and a correct `Content-Range`, verified against the configured store rather than assumed

#### Scenario: A media URL redirects before serving bytes

- **WHEN** a range request for a stable media URL is answered with a redirect to the object store
- **THEN** the range is honoured at the destination, and the client receives `206`

#### Scenario: A browser loses Range across a redirect

- **WHEN** a supported browser cannot preserve its range request across the object-store redirect
- **THEN** a range-preserving API delivery path returns `206` with the correct interval

#### Scenario: A timeline seeks after URL expiry

- **WHEN** a timeline seeks managed audio or video after a prior signed destination expires
- **THEN** the stable media URL yields a fresh destination and the requested byte range plays

### Requirement: Range support is advertised on every media response

A final media response SHALL carry `Accept-Ranges: bytes` whether or not the
request asked for a range, for every backend that serves managed media.

A client that cannot see the capability advertised may decline to seek, or may decline to start at all. Advertising it on the plain `200` is what lets a client choose to range-request the next time rather than discovering support by trial.

#### Scenario: A file is requested without a range

- **WHEN** a request for a media object carries no `Range` header
- **THEN** the response status is `200`, the body is the whole object, and `Accept-Ranges: bytes` is present

#### Scenario: Existing response headers are preserved

- **WHEN** a media object is served, with or without a range
- **THEN** the response carries the same caching directive and the same inferred content type it carried before the storage backend changed

#### Scenario: The object store advertises range support

- **WHEN** a media object is served from the object-store backend without a `Range` header
- **THEN** the response carries `Accept-Ranges: bytes`

### Requirement: An unsatisfiable range is refused, not silently widened

A request whose range cannot be satisfied SHALL be answered with `416 Range Not Satisfiable` and a `Content-Range: bytes */<total size>` header. It SHALL NOT fall back to returning the whole file with `200`.

Falling back to `200` is what the route does today for every request, and it is the exact response that makes iOS abandon playback. A client that asked for an interval past the end of the file has a bug or a stale length, and answering with the whole body tells it neither of those things while costing a full transfer.

#### Scenario: A range starts past the end of the file

- **WHEN** a request carries a range whose first position is greater than or equal to the file size
- **THEN** the response status is `416` and `Content-Range` is `bytes */<total size>`

#### Scenario: A malformed range header is received

- **WHEN** a request carries a `Range` header that cannot be parsed
- **THEN** the response serves the whole file with `200` and `Accept-Ranges: bytes`, rather than failing the request

### Requirement: Range behaviour is covered by tests that assert on the wire

The upload route SHALL have tests asserting response status, `Content-Range`, `Content-Length`, `Accept-Ranges` and body length for ranged, unranged and unsatisfiable requests.

Every browser used for development tolerates a missing range header, so this defect cannot be observed by opening the app. It was found by reading the response, and only a test that reads the response will keep it fixed.

#### Scenario: Range support regresses

- **WHEN** the upload route stops answering a ranged request with `206`
- **THEN** the test suite fails

#### Scenario: A missing file is requested

- **WHEN** a request names a file that does not exist under the upload path, with or without a range
- **THEN** the response status is `404` and no partial content is returned
