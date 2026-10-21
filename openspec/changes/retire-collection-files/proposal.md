## Why

`apps/api/src/lib/collection-files.ts` keeps persona-era collection items as
files under `data/workspaces/<ws>/collections/<collection>/<id>/`: a
`prompt.md`, an optional `description.md`, and sheet images. Only one read path
remains — `listItems`, which the content catalogue uses to surface legacy items —
and every write path (`createItem`, `updateItem`, `deleteItem`, `saveSheet`) has
no caller. Reference entities replaced collections as the castable library.

`migrate-to-postgres` moved the collection _lists_ (the `collections_<slug>`
keys) into the workspace configuration row, but left the item files unchanged
(its task 6.5). Files on one host's disk are not visible to a second API
replica, so as long as the catalogue reads them the data directory has to be
shared or the items are inconsistent between replicas.

## What Changes

- Import any remaining collection items into reference entities, with sheet
  images in object storage.
- Remove the dead write paths and the file read from the catalogue.
- Remove `collections_<slug>` keys from stored workspace configuration once
  nothing reads them.

## Impact

- `apps/api/src/lib/collection-files.ts`, `content-catalogue.ts`.
- Deployed workspaces: none of the local ones hold collection items today; a
  deployment that does gets a one-time import.
