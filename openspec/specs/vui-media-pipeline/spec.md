# vui-media-pipeline Specification

## Purpose

TBD - created by syncing change rebuild-vui-video-editor-library. Update Purpose after archive.

## Requirements

### Requirement: Waveform and filmstrip work happens off the main thread

Decoding and decimation for waveforms and filmstrips SHALL run in a worker. The main thread SHALL receive only summarised, paint-ready data.

A decode on the main thread stalls the frame, and a timeline is judged on whether it keeps up with a finger.

#### Scenario: A long asset is summarised

- **WHEN** a waveform is requested for an asset several minutes long
- **THEN** decoding and decimation occur off the main thread, and the timeline continues to scroll and respond while it proceeds

#### Scenario: A worker is unavailable

- **WHEN** the environment provides no worker
- **THEN** the library reports that the summary is unavailable rather than decoding on the main thread, and the timeline paints without it

### Requirement: Summaries are produced at a density the current zoom can use

Waveform and filmstrip summaries SHALL be requested at a density derived from the pixels available to draw them. A zoom change SHALL request a new density only when the existing summary is insufficient for the new one.

#### Scenario: The timeline is zoomed in

- **WHEN** zoom increases so that an item is drawn several times wider
- **THEN** a higher-density summary is requested for the visible region only

#### Scenario: The timeline is zoomed out

- **WHEN** zoom decreases and an existing summary already exceeds the density needed
- **THEN** no new work is requested and the existing summary is reused

### Requirement: Summaries are cached with a bound, and keyed by content

A summary SHALL be cached under a key derived from the asset's identity, the requested density, and the source range. The cache SHALL have a declared bound and SHALL evict least-recently-used entries when it is reached.

#### Scenario: The same item is revisited

- **WHEN** an item scrolls out of the visible range and back at the same zoom
- **THEN** its summary is served from cache and no new decode is requested

#### Scenario: The cache bound is reached

- **WHEN** cached summaries exceed the declared bound
- **THEN** least-recently-used entries are evicted, and the bound is not exceeded

### Requirement: Work for content that is no longer needed is cancelled

A summary request SHALL be cancellable, and the library SHALL cancel outstanding requests for content that has left the visible range or whose density is superseded.

A fast scroll through a long project otherwise queues work for every item it passes, and the queue outlives the reason for it.

#### Scenario: A scroll passes over many items

- **WHEN** the viewport is scrolled quickly across a region and does not stop there
- **THEN** requests issued for items in that region are cancelled rather than completed

#### Scenario: A cancelled request completes anyway

- **WHEN** a worker finishes work whose request was already cancelled
- **THEN** the result is discarded and no paint is scheduled for it

### Requirement: A degraded extraction path is declared rather than silent

Where the library supports more than one extraction path for a media kind and the paths differ in achievable quality, it SHALL report which path was taken and the density actually achieved, rather than silently returning a weaker result at the requested density.

A consumer that cannot tell a full-quality summary from a degraded one cannot decide whether to show it, cache it, or ask for it again elsewhere. Filmstrip extraction in particular varies by an order of magnitude between environments, and the difference is worth stating rather than absorbing.

#### Scenario: The preferred path is unavailable

- **WHEN** the environment does not support the preferred extraction path for a media kind
- **THEN** the fallback is used, the result reports both the path taken and the achieved density, and the achieved density is not misreported as the requested one

#### Scenario: Only one path exists for a media kind

- **WHEN** a media kind has a single supported path
- **THEN** results report that path and no fallback machinery is exercised

### Requirement: A missing or failed summary degrades rather than breaks

An item whose summary is unavailable, still in flight, or failed SHALL still paint, still be selectable, and still be editable.

#### Scenario: An asset cannot be decoded

- **WHEN** decoding fails for an asset
- **THEN** the item paints without its summary, reports the failure to the consumer, and remains fully interactive

#### Scenario: A summary arrives after the item is drawn

- **WHEN** a summary completes for an item already painted without one
- **THEN** only the region that item occupies is repainted
