## Why

Every voice the product can speak today is one somebody else recorded: the
catalogue is a fixed list of provider-owned speaker ids, and no surface can
narrate in a voice an operator supplies. There is also no Indonesian voice at
all — Kokoro's catalogue does not contain one — so Indonesian narration is
currently impossible rather than merely generic.

Pocket TTS Indonesian answers both at once. It is a self-hostable CPU model
whose voice is not a catalogue entry but an audio prompt: hand it a few seconds
of speech and it narrates in that voice. Adding it gives the product its first
Indonesian voice and its first cloned one.

## What Changes

- A new TTS provider, `pocket-tts-id`, appended to the registry after `kokoro`.
  Kokoro remains the default for every language; the new provider declares
  Indonesian (`id`) only, so it is never selected by accident for other content.
- A new deployable service, `apps/pocket-tts-id`, serving the 6-layer student
  model behind an OpenAI-shaped speech endpoint at
  `https://pocket-tts-id.example.com`. It is stateless: the voice prompt travels
  with each request, so the service holds no voice library and needs no volume.
- Its service URL is configured through the provider's `ProviderConfigField`
  declaration and entered in Settings. No root `.env` entry, no compose wiring.
- A new workspace-scoped **voice clone library**. An operator uploads a sample
  of speech, names it, and it joins the voice catalogue as an ordinary voice
  with an ordinary id. Choosing it anywhere a voice is chosen narrates in that
  voice.
- The voice catalogue becomes the union of each provider's declared voices and
  the calling workspace's clones, and therefore becomes workspace-aware for the
  first time.
- `TtsInput` gains an optional reference-audio field, filled by the API when it
  resolves a clone id, so `voice` remains the single voice identity everywhere
  above the provider boundary.

No breaking changes. Every existing voice, stored selection, and ledger row
keeps its meaning.

## Capabilities

### New Capabilities

- `media-provider-pocket-tts-id`: the provider itself — what configures it, what
  it reports for health and reachability, why it declares one language, how a
  reference voice reaches the service, and what the deployed service guarantees.
- `voice-cloning`: the workspace-scoped clone library — what a clone is, how one
  is created and removed, why it belongs to the provider that can speak it, and
  why a clone is identified by an id rather than by the audio behind it.

### Modified Capabilities

- `voice-catalogue-source`: the catalogue is no longer derived from registered
  providers alone. It becomes provider-declared voices unioned with the calling
  workspace's clones, which makes the catalogue workspace-scoped and makes
  `/api/tts/status` require a workspace it does not take today.
- `voice-sample-previews`: a clone has no prebaked audition clip, because the
  bake runs ahead of time over a list that did not contain it. A clone is
  auditioned through the audio it was created from.
- `provider-conformance`: the suite requires every TTS provider to declare a
  non-empty voice list. That rule assumes voices are declared in the repository,
  which a cloning provider does not do. A provider now states where its voices
  come from, and the non-empty requirement applies only to the declaring kind.
- `tts-provider-surface`: a voice now belongs to a provider. Switching the
  effective provider invalidates a selection naming another provider's clone,
  and that is a state a surface reports rather than silently substitutes past.

## Impact

**New code**

- `apps/pocket-tts-id/` — `Dockerfile`, service entrypoint, `.dockerignore`,
  `AGENTS.md`. Deployed from this path by Coolify with auto-deploy enabled.
- `packages/media/src/providers/pocket-tts-id/` — `index.ts`, `meta.ts`,
  `service.ts`, `synth.ts`, mirroring the Kokoro provider's layout.
- `packages/db/src/db/voice-clone.ts` and its table in `unified-schema.ts`.
- Clone CRUD routes in `apps/api`, and the clone surface in `apps/web`.

**Modified code**

- `packages/media/src/providers/registry.ts` — one appended entry.
- `packages/media/src/providers/types.ts` — `TtsInput` gains the reference field.
- `packages/media/src/worker.ts` and `src/generation/impl.ts` — the reference
  travels in the existing style bundle, which already passes unknown keys
  through.
- `apps/api/src/lib/voice-catalogue-source.ts` — the union, and the
  workspace parameter.
- `apps/api/src/lib/tts-synth.ts` — clone resolution, and a prior
  signature change from five positional parameters to one options object,
  landed as its own commit so this change's diff stays about cloning.
- `apps/api/src/routes/tts.ts` — `/status` takes a workspace.

**Deployment**

Coolify gains one application in the `maleo` project on the `localhost`
server, built from `apps/pocket-tts-id` with `watch_paths` scoped to it. No
repository gate can see that configuration, so the deploy is verified by
exercising the running service.

**Data**

The uploaded sample is a recording of a person's voice. It is stored
workspace-scoped under the existing uploads path and is removable, and a
removal is a soft delete so that metered syntheses naming the clone stay
attributable.
