# @maleo/stock

Pexels results retain provider and creator links required by its
[API guidance](https://www.pexels.com/api/documentation/). Freesound use requires
an API key plus explicit operator confirmation that commercial API permission was
granted under its [API terms](https://freesound.org/help/tos_api/). Each asset's
own license still controls reuse; operator must verify it before publication.

Licensed media the app **fetches**, as opposed to `@maleo/media`, which
**generates** it. Pexels for images and video, Freesound for sound effects, and
a curated background-music library published to Backblaze B2.

The music library is the part with a pipeline.

## Adding beds to the music library

```bash
cd packages/stock

bun run fetch:manifest     # 1. bring down what is already published
bun run compile:manifest   # 2. merge it with operator-supplied tracks
bun run enrich:music       # 3. write the descriptions and emotions
bun run publish:music      # 4. upload new audio + the whole manifest
```

Step 0 is manual or permissioned input. Put two files per track into
`music-source/`: audio you may redistribute and a JSON sidecar naming its source,
creator, license, and source URL. Maleo does not ship a browser downloader.

```
music-source/
  published.json                  ← fetch:manifest
  example-sad-piano-001.mp3   ┐ operator-supplied pair
  example-sad-piano-001.json  ┘
  manifest.json                   ← compile:manifest, then enrich:music
```

## Audio is uploaded as it was downloaded

Nothing is transcoded and nothing is loudness-normalised. The bytes that land
in `music-source/` are the bytes that get served.

The uploaded **name** is the downloaded name, unchanged, so a bed reads the same
everywhere:

```
music-source/example-sad-piano-001.mp3
             ↓
https://stock.example.com/file/example-bucket/music/example-sad-piano-001.mp3
```

Because the name is not content-addressed, it can hold different bytes after a
track is replaced — so beds carry a **one-day** cache, not a year, and not
`immutable`. Nothing revalidates a url pinned into a template row, so a long
cache on a reusable name would serve the superseded bed for as long as it lived.

Publishing refuses to run if two beds would upload to the same name: the second
would overwrite the first, and both manifest entries would point at one file.

The one thing lost with normalisation is loudness consistency: beds come from
different uploaders at different levels, so switching between them mid-video can
be an audible jump.

Nothing is refused for its length. `ffprobe` measures duration when present, and
the resolver uses it to _prefer_ a bed of a minute or more, falling back to the
longest it has — so a short bed is worth publishing, it is simply picked less
often.

## Why the steps are separate

Each has a different failure mode, a different frequency, and different
credentials. Compile is offline and deterministic. Enrich needs a model but no
network storage. Publish needs B2 write access. Folding them together would mean
holding all of it at once to do any of it.

## The thing most likely to bite

**A published bed whose audio is no longer on disk must survive a rebuild.**

Nobody keeps every mp3 they ever published. If such a bed fell out at compile,
publish would call it orphaned, and the library would
silently shrink every time you added a track.

So `compile:manifest` carries published beds through with their url and hash,
and `publish:music` passes them through as `carried`, sees them as unchanged,
and reuses the url. If you ever see the
published bed count drop after adding one, this is the chain that broke.

For the same reason `fetch:manifest` refuses to write an empty `published.json`
when it cannot reach B2 — an empty one would look like a fresh library, and the
publish after it would drop everything.

## Identity

A bed is identified by its **source url** at every step, never by its filename.
Filenames are content-hashed, so re-baking at a different loudness renames every
file; a name-based check would read that as a brand new library and upload a
duplicate of everything.

## Configuration

| Variable                              | Needed by                                               | Default |
| ------------------------------------- | ------------------------------------------------------- | ------- |
| `B2_KEY_ID`, `B2_APP_KEY`             | `publish:music`                                         | —       |
| `B2_BUCKET_NAME`                      | `publish:music`, and the public url                     | —       |
| `STOCK_MUSIC_HOST`                    | the public url                                          | —       |
| `STOCK_MUSIC_PREFIX`                  | the folder inside the bucket                            | `music` |
| `STOCK_MUSIC_BASE_URL`                | replaces host + bucket outright, for a bucket elsewhere | —       |
| `PEXELS_API_KEY`, `FREESOUND_API_KEY` | the search adapters                                     | —       |

Set stock-search credentials in Settings → Capabilities → Stock visuals or
Settings → Capabilities → Sound effects. Canonical environment variables above
still override stored values. `MALEO_PEXELS_API_KEY` was removed; use
`PEXELS_API_KEY` only.

The public url is composed, not stated:

```
<STOCK_MUSIC_HOST>/file/<B2_BUCKET_NAME>/<STOCK_MUSIC_PREFIX>/manifest.json
https://stock.example.com/file/example-bucket/music/manifest.json
```

`B2_BUCKET_NAME` appears once and is used by both sides — publishing uploads
there, the app reads from there. Two copies of a bucket name is one copy too
many: if they drifted, the app would read from a bucket nothing was written to,
and the 404 that produces is exactly how an unpublished library looks.

Set either host and bucket or `STOCK_MUSIC_BASE_URL`; no maintainer-specific
public library is assumed. `publish:music` refuses to run if
`STOCK_MUSIC_BASE_URL` names a different bucket than the one it is uploading to — the one misconfiguration
that would otherwise succeed at upload and 404 on read.

`enrich:music` needs the `pi` CLI on `PATH` and no key of its own.
