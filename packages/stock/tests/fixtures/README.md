# Recorded provider responses

Real responses from the third-party search APIs this package decodes, recorded
2026-08-21 and trimmed to the first result so the shape stays readable.

They are the evidence the schemas in `parse-external-responses` were written
against, and the regression test for when a provider changes: a schema that
stops parsing its fixture means either the provider moved or the schema is
wrong, and the fixture says which.

## What is NOT here, and why

Three responses this repository decodes are deliberately absent:

- **B2 `b2_authorize_account`** returns an `authorizationToken`.
- **Threads `refresh_access_token`** returns an `access_token` — and calling it
  rotates the token it refreshes, so recording has a side effect on a live
  secret.
- **Telegram `getUpdates`** can carry private message content.

Recording any of those would commit a live credential or someone's messages.
Their schemas are written from the fields the call site reads instead, with a
redacted skeleton standing in — weaker evidence than a recording, and labelled
as such wherever it is relied on.

**Pixabay** is absent for a duller reason: no key was available when these were
recorded, so its schema is unverified against a live response.

## Re-recording

Fixtures go stale. Re-record with the script in the change's scratch notes, then
check the diff: a changed shape is a provider change worth reading, not noise to
accept.
