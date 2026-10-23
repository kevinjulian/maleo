## MODIFIED Requirements

### Requirement: One path admits an asset to the project

Admission to the project's media set SHALL go through a single operation that deduplicates on the asset's URL and returns the identity of the asset — the existing one when the URL is already admitted, a newly minted one otherwise. The server SHALL decide admission against the project's stored library, so two clients that admit the same URL receive one asset.

Every surface that can place an asset SHALL admit it through that operation before creating the clip, so that placing and saving cannot produce two assets for the same file. A client MAY show the admitted asset before the server confirms it, and SHALL adopt the server's identity when the server already held the URL.

#### Scenario: The same asset arrives twice

- **WHEN** the same URL is admitted a second time, from the same surface or a different one
- **THEN** one asset exists and both callers receive the same identity

#### Scenario: Saving and then placing

- **WHEN** an asset is saved from a browsing surface and then dragged onto the timeline
- **THEN** one asset exists, and the clip references it

#### Scenario: Two devices admit the same file

- **WHEN** two clients of one project admit the same URL before either has read the other's admission
- **THEN** the project holds one asset, and both clients show it under one identity after their next read
