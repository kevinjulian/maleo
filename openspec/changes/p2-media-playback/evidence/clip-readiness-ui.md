# Clip readiness presentation

Task 6.1 extends the feature-owned TimelineClip badge. Its owning contract was
updated before production integration. Upload and preview states remain separate.
The badge uses existing icon, inset and progress geometry. It owns no gestures.

`bun run --cwd apps/web test src/components/timeline/media/preview-loading.test.tsx`
passed all seven state cases. Tests check accessible names, measured and unknown
byte totals, no progress for ready/failure, and no interactive descendants.

`bun run --cwd apps/web build-storybook` passed. The first browser check exposed
the missing clip stylesheet import in the new story. The import was corrected
and the built story was checked again.

`bun apps/web/visual/preview-loading-stories.ts` passed at 1440px and 320px in light
and dark themes. Each case checked twelve badges, named states, 40% progress,
hidden lines on compact clips, pointer transparency, no horizontal overflow and
no page errors. The phone context used coarse touch. Screenshots in
`/tmp/maleo-preview-loading-stories` were inspected. No production reachability
is claimed by these story checks. Task 6.2 owns that integration.

`bun run check` passed version, references, formatting, lint and all twelve
workspace typechecks. `bun run --cwd apps/web check:layers` passed with 196
cross-cluster imports.

Task 6.2 integrates native states into scene, image, video and audio bars. Extra
scene visuals retain their own canonical clip IDs. Scene actions include their
additional visual clips. The existing upload badge remains separate. A feature
context supplies current native snapshots without document or undo writes.

Production `preview-clip-loading.spec.ts` passed at 1440px and coarse-touch 320px
(three tests including warmup, 20.4 seconds). Fixtures include hidden video,
muted audio, a 100 ms image clip, shared failed bytes, and a scene with two
source images. Desktop menu and phone Sheet Retry recovered both shared users.
The ready sibling downloaded once. The failed shared source downloaded once
before Retry and once after. Geometry remained `left: 108px; width: 16px` on
desktop and `left: 108px; width: 44px` on phone. Both runs recorded zero document
writes and page errors. Failure and ready screenshots were inspected.
Reports are `clip-readiness-1440.json` and `clip-readiness-320.json`.

The native-state hook test verifies shared failure, Retry from either user,
pending File reuse, complete sibling retention and unchanged document bytes.
All three composition hook tests passed. Badge and subject tests also passed.
The test worker now records the actual nested File field. Failure replies retain
the required `bytesComplete` field, and fake object URLs are unique per owner.
`bun run check` and UI layers passed for this integration.

Task 6.4 adds a canonical Note below the existing transport. Play references its
loading or failure explanation through `aria-describedby`. Template Studio
names lookup/download failures and offers the same native Retry. Media-free
clips need no source badge. No control styling or overlay owner was added.

The latest production controls run passed four tests including warmup (one
minute). Desktop pointer and keyboard Enter and phone coarse touch reached Retry.
The desktop chat input retained Space/K. Adding a held source during playback
paused and disabled Play. Removing its last clip while loading restored readiness
without autoplay. Later completion could not recreate it. The unplaced library
asset did not remain a blocker. Compact widths remained 16px and 44px.
The composition hook independently verified replacement while loading, ignored
old completion, and removal of the last loading dependency. All four hook tests
passed. The combined transport, badge, session, cue and composition checks passed
36 tests across five files.

Write monitoring covers current command submissions and presentation patches as
well as legacy storyboard writes. The repeated desktop/320px controls runs
recorded zero readiness writes and one expected add/remove edit submission each.
These are separate fields in `clip-controls-1440.json` and
`clip-controls-320.json`. Earlier report files recorded legacy writes only.

Template Studio's held cue lookup and held WAV download both disabled Play.
The first download returned HTTP 503. Its named failure and Retry were reachable,
and Retry recovered from complete local bytes without autoplay. Fresh offline
Play advanced audio and transport. Remotion retains pooled audio tags before
source assignment; their existence alone does not indicate source playback.
Failure and ready screenshots were inspected.

Four focused baselines cover transport explanations and clip actions at desktop
and 320px. They were created with a scoped snapshot update and inspected.
UI layers and census passed: 196 cross-cluster imports, 337 cross-cluster classes
and 229 standing inline style objects. Repository checks and all twelve workspace
typechecks passed. Full CI and physical-device acceptance remain separate tasks.

Broader animation regression checks exposed SVG readiness loss. The browser's
worker `createImageBitmap(File)` rejected SVG, and OPFS Files also lost their
response MIME type. MIME retention was fixed without reading files into arrays.
SVG bytes now have a distinct `svg-bytes` reply. The main client requires a DOM
decode and a one-pixel raster before resolving readiness. Probes serialize,
abort on removal/disposal and release their bitmap and object URL. Normal preview
keeps the original vector File. A focused actual SVG animation/replay case passed
after the fix. Renderer-worker SVG rasterization was unsupported before this
phase and is unchanged. The gate was not bypassed and fixtures were not replaced.

The final focused browser run passed all nine cases (3.5 minutes): animation and
transition editing/replay at 1440px, 320px and 844px in both themes, plus desktop
and phone readiness/control baselines. Snapshot comparison ran without updates.
All seventeen source-client/storage/SVG probe tests passed. They cover MIME
retention, deferred SVG readiness, serialized decode, malformed input, required
image identity, abort and disposal cleanup. Repository checks and UI layers
passed again after the SVG fix.

Task 6.5 updates web authoring, clip/transport contracts, runtime documentation,
renderer codemap and Unreleased notes. Four new focused baseline images were
inspected. Existing snapshot thresholds remain unchanged. The main readiness
context omits source badges on media-free clips while retaining native readiness.
