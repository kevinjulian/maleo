## Context

TTS in this repository resolves through one seam. `packages/media`'s registry
holds the providers, each declaring `meta.tts.voices`; `apps/api`'s
`voice-catalogue-source.ts` builds every surface's catalogue from whichever
providers are registered; `synthesizeTts` submits a job to the media worker,
which parses a style bundle and calls the selected provider. Adding Kokoro
required no change to any surface, which is the property this change must not
spend.

Two facts about that seam shape everything below.

**A voice is an id from a fixed list.** `TtsInput` carries `voice?: string`, and
the id is a speaker the provider already knows — `af_heart`, `M1`. Pocket TTS
does not work that way: `model.get_state_for_audio_prompt("voice.wav")` takes an
audio file, and the "voice" is whatever is in it.

**A voice id is load-bearing far past the picker.** The media-worker cache keys
on `(base url, voice, text)`. `storySpeechInputHash` in
`packages/shared/src/asset-staleness.ts` hashes `narration, voice, provider,
language, delivery` to decide whether a scene's audio must be regenerated. The
speech ledger stores `voice` per billed synthesis. Anything that changes what a
voice sounds like without changing its id silently breaks all three.

The deployment side has a precedent to copy: `apps/kokoro-tts` is a Dockerfile
and an `AGENTS.md`, built straight from its path by Coolify, with its client in
`packages/media/src/providers/kokoro/` and the service URL as the only wiring.

## Goals / Non-Goals

**Goals:**

- Indonesian narration, through a self-hosted provider that never displaces
  Kokoro for other languages.
- An operator can supply a voice and narrate with it anywhere a voice is chosen.
- The number of layers that learn about cloning stays as close to one as the
  design allows.
- Cache keys and staleness hashes stay correct with no new fields in them.

**Non-Goals:**

- Cloning for providers other than `pocket-tts-id`. Whether Kokoro ever gains it
  is a separate question about Kokoro.
- Sharing a clone between workspaces, or a global clone library.
- Consent capture, liveness checking, or any verification that the uploaded
  speech belongs to the person uploading it.
- Replacing the static provider catalogue. Provider-declared voices stay
  declared in the repository and readable with the service down.

## Decisions

### A clone is a stored row, and `voice` stays the only voice identity

**Decision.** Uploading a sample creates a `voice_clone` row with an id. That id
is what travels as `voice` through every layer that exists today. The API
resolves it to the reference audio exactly once, at the provider boundary, into
a new optional `TtsInput.voiceRefUrl`.

**Alternative rejected: thread the reference URL from the UI.** A
`voiceRefUrl` beside `voice` through the picker, the route body, `synthesizeTts`,
the media client, the worker schema, the style bundle, and `TtsInput` — eight
hops carrying two fields that can disagree, plus three consequences:
`storySpeechInputHash` must grow a field or scenes go stale-blind when the
sample changes; the worker cache key must hash the audio; the ledger's `voice`
column stores a URL for some rows and an id for others.

The row avoids all of it by construction. A different sample is a different
clone is a different id, so the hash and the cache key are already right. That
is the whole argument: not that a library is nicer, but that an id is the thing
every downstream consumer already treats as the identity of a voice.

### The clone row is its own table, not a `reference_entity`

**Decision.** A new `voice_clone` table.

**Alternative rejected: `reference_entity` with `role: "voice"`.** It is
workspace-scoped, has `label` and `origin` and a canonical URL, and looks like a
fit. But `unified-schema.ts` records that `content_references` was deliberately
split because it conflated _role in the story_ with _medium_, and
`reference_entity` took the story-role axis — it is the roster of castable
subjects. Filing a voice clone there, with a wav in `canonical_image_url`,
re-merges the two axes that split was paid for.

### A clone belongs to the provider that can speak it

**Decision.** `voice_clone.provider_id` is not null. A clone appears in the
catalogue only under its own provider, and a stored selection naming a clone
that the effective provider cannot speak is reported as unusable.

Pocket's cloning is its model's, not a property of TTS. Offering a clone under
Kokoro would produce a voice that fails at the point of use — the exact
invisible-substitution failure `effectiveVoiceCatalogue` already refuses when a
provider is unconfigured.

### The catalogue becomes a union, and therefore workspace-aware

**Decision.** `voicesForProvider(provider, workspace)` returns provider-declared
voices followed by that workspace's clones for that provider. `/api/tts/status`
takes a workspace.

This is the one rule the change bends. `media-provider-kokoro` states that
voices are declared in the repository so a surface can list them with the
service down — a DB read satisfies that just as well, since neither consults the
service. What genuinely changes is that the catalogue is no longer the same for
every caller, which is new and is why `/status` grows a required parameter.

The clone half of the union is not a second source of truth for provider voices:
a clone is never a provider-declared voice, and a provider-declared voice is
never a row. The two sets cannot collide, which is what makes the union safe.

### A provider declares whether its voices are declared or cloned

**Decision.** `meta.tts` states its voice source. Conformance requires a
non-empty declared list only from a provider whose voices are declared; absence
of the declaration means declared, so no existing provider changes.

Found during implementation: the conformance suite refuses a TTS provider with
an empty voice list, on the grounds that such a provider is "selectable but has
nothing to speak with". That is the right check for Kokoro and was right for
every provider that existed when it was written — it encodes the assumption that
voices are declared in the repository. A cloning provider declares none by
construction, so it trips a rule aimed at a different defect.

**Alternative rejected: bake seed voices into the image** so the provider has
something to declare. It would satisfy the rule as written and give the service a
voice library — undoing the stateless decision above for the sake of a
conformance check.

**Alternative rejected: drop the empty-list rule.** Cheapest and wrong. It would
stop catching the defect it exists for on every provider that can still commit
it.

The declaration also earns its keep beyond conformance: the catalogue union has a
fact to key on rather than inferring "this provider is the special one" from an
empty array.

### The service is stateless; the reference travels with the request

**Decision.** `apps/pocket-tts-id` exposes a speech endpoint taking text plus
voice-prompt bytes, and `GET /health`. It keeps no voice library.

**Alternative rejected: a voice registry on the service** (upload endpoint,
mounted volume, `GET /voices`). It would make the catalogue dynamic and fetched,
put operator data on a box whose backups are not the application's, and give the
system two places a clone can exist and disagree. Stateless keeps the clone
library in one store — the one that already has workspaces, soft deletes, and
backups.

Cost: `get_state_for_audio_prompt()` runs per request rather than once per
voice. If that proves slow, the fix is an in-process LRU on the service keyed by
a hash of the prompt bytes — an optimization behind an unchanged interface, and
one to measure before building.

### The model is baked into the image

**Decision.** The build downloads the 438 MB student model and its config,
pinned to the published commit, so a cold start pays no download.

Coolify restarts containers far more often than it rebuilds them, and a first
boot that spends minutes fetching weights fails its healthcheck. Pinning the
config commit is the same load-bearing pin `apps/kokoro-tts` documents: auto-
deploy is on, so an unpinned reference lets an upstream change ride in on a push
that has nothing to do with this service.

### `synthesizeTts` takes an options object, in a prior commit

**Decision.** Convert the signature before this change, as its own mechanical
`refactor:` commit.

It is five positional parameters today, four of them optional strings, which the
type checker cannot protect from a swap; the live call already pads a slot
(`…, provider, undefined, { workspace })`) to reach the one it wants. Clone
resolution makes the workspace genuinely required rather than defaulted, and a
sixth parameter would add a second hole. Separating the commits keeps the
cloning diff about cloning and lets the conversion be verified on its own — a
missed call site is a typecheck failure, nothing subtler.

### A clone is auditioned through its source audio

**Decision.** No bake for clones. The picker plays the uploaded sample.

The sample bake is an ahead-of-time pass over a static list and cannot contain a
voice that does not exist yet. Baking at clone time would work but spends a
synthesis to approximate audio the operator just supplied — and the source is
the more honest preview anyway, since it is what the model is imitating.

## Risks / Trade-offs

- **Uploaded speech is biometric data, and this is the first upload here that is
  a person.** → Workspace-scoped, removable, and stored under the existing
  uploads path with its existing flat-name safety rule. No consent or identity
  verification is in scope; anyone deploying this to third parties needs more
  than this change provides, and the spec says so rather than implying the
  question is settled.
- **Deleting a clone orphans ledger rows that name it.** → Soft delete, matching
  `softDeleteImage`. A metered, billed synthesis must stay attributable after a
  library is tidied.
- **16 kHz output against Kokoro's 24 kHz.** → Audible if one timeline mixes
  both. Not corrected here; a project narrating in Indonesian uses one provider
  throughout, and resampling to hide the difference would misrepresent the
  model's real band limit.
- **The model refuses digits and exclamation marks, and drops enumeration items
  in long text.** → Narration reaching this provider needs numbers spelled out.
  The provider surfaces the constraint rather than silently mangling input;
  where normalization belongs in the writing pipeline is a separate question and
  is left open below.
- **The catalogue gaining a workspace parameter touches a route several surfaces
  call.** → The union is additive and a workspace with no clones gets exactly
  today's list, so the blast radius is the signature, not the behavior.
- **No repository gate can see the Coolify configuration.** → Same exposure
  `apps/kokoro-tts` documents. Verification is exercising the deployed service,
  and the tasks say so explicitly rather than trusting a green typecheck.
- **A second self-hosted TTS box on a single-server deployment.** → The model is
  CPU-only and runs at 2.23x real time, but it is resident memory that Kokoro,
  SearXNG and Crawl4AI are already sharing. Worth watching after the first
  deploy.

## Open Questions

- Where does Indonesian text normalization live — spelling out digits, removing
  exclamation marks — the narration writer, the provider, or a step between? The
  provider must refuse or normalize _something_ to avoid silent mangling; this
  change picks the minimum and leaves the pipeline-level answer open.
- `SAMPLE_TEXT_BY_LANGUAGE` in `voice-samples.ts` has no `id` entry, so any
  future baked Indonesian sample would audition in English. Clones do not need
  it; a provider-declared Indonesian voice would.
