# @maleo/storage — agent instructions

## Purpose

`@maleo/storage` owns media object storage: where generated, uploaded and
rendered bytes live, under one key scheme, on the local filesystem (development)
or an S3-compatible store (production).

## Ownership

- `src/storage.ts` owns the key scheme (`mediaObjectKey`), the storage mode, and
  `putMedia` / `getMedia` / `deleteMedia` / `listMedia` / `addressMedia`.

## Local Contracts

- Library only. No routes, no Hono app, no process entrypoint. The API, the media
  worker and the render server import it; none of them is imported by it.
- Owner segments in a key are validated, never sanitized: two owners collapsing
  onto one prefix would let a delete for one remove the other's bytes.
- Local mode resolves its data directory from the repository root
  (`data/`, `MALEO_DATA_DIR`). Keep the file at its current depth or update that
  path in the same change.

## Verification

```bash
bun run --cwd packages/storage test
```

`storage.minio.bun.test.ts` runs only against a reachable S3-compatible store and
skips otherwise.
