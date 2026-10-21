## 1. Prep: Named Synthesis Arguments

- [x] 1.1 Convert `synthesizeTts` and `synthesizeBilledTts` from positional parameters to one named options object, updating every call site and the test seam's `Synthesizer` type. Proof: typecheck passes with no call site padding a slot, and the existing TTS tests pass unchanged. Land this as its own `refactor:` commit before any cloning work.

## 2. The Deployed Service

- [ ] 2.1 Create `apps/pocket-tts-id/` with a `Dockerfile` that bakes the 6-layer student model and its config at a pinned published revision, a stateless service exposing an OpenAI-shaped speech endpoint plus `GET /health`, a `.dockerignore` excluding repository source, and an `AGENTS.md` recording the Coolify settings as production configuration. Proof: `docker build` succeeds locally and the container answers `/health` with no network fetch at start.
- [ ] 2.2 Accept text plus voice-prompt bytes per request and apply the model's required end-of-speech threshold server-side, never as a client knob. Proof: two local requests with different voice prompts and identical text return audibly different audio.
- [ ] 2.3 Install `wget` for the platform's generated healthcheck and confirm the container does not end up running as root. Proof: `docker run` plus `id` in the container shows a non-root user, and `wget` resolves.
- [x] 2.4 Create the Coolify application in the `maleo` project on the `localhost` server: base directory `/apps/pocket-tts-id`, watch paths scoped to it, the documented port exposed, health check configured, and `https://pocket-tts-id.example.com` as the domain. Proof: the app reports `running:healthy` and the domain answers `/health`.

## 3. The Provider

- [x] 3.1 Add `packages/media/src/providers/pocket-tts-id/` with `service.ts`, `meta.ts`, `synth.ts` and `index.ts`, mirroring the Kokoro provider's layout. Declare the service URL as a `ProviderConfigField` so it is entered in Settings, with no root `.env` entry. Proof: provider unit tests cover `unconfigured` with no URL and `ready` with one.
- [x] 3.2 Implement `reachable` as a real request to the service health path, distinct from the offline `health`. Proof: tests cover a healthy service, a URL where nothing listens, and that `health` issues no request.
- [x] 3.0 Let `meta.tts` declare whether its voices are declared or cloned, and require a non-empty voice list in the conformance suite only from the declaring kind, with absence meaning declared. Proof: conformance tests cover a declaring provider with no voices failing, a cloning provider with no voices passing, and an undeclared provider keeping the strict check.
- [x] 3.3 Declare the provider's voices as Indonesian-only, and append `pocket-tts-id` to the registry after `kokoro`. Proof: a registry test asserts the default TTS provider is unchanged by the addition, and the provider conformance suite passes for the new entry.
- [x] 3.4 Cache synthesized audio on a key including the voice identity, and state the model's input constraints — digits as words, no exclamation marks — rather than passing unusable text through silently. Proof: tests cover two voices not sharing a cache entry, and text containing digits producing a stated outcome rather than silent mangling.

## 4. The Clone Library

- [x] 4.1 Add the `voice_clone` table to `unified-schema.ts` — id, workspace, provider id, label, language, gender, reference audio location, timestamps, soft-delete — with the schema comment recording why it is its own table rather than a `reference_entity` role. Proof: schema tests cover creation and the workspace index.
- [x] 4.2 Add `packages/db/src/db/voice-clone.ts` with create, list-by-workspace-and-provider, get, and soft-delete. Proof: unit tests cover workspace isolation, that a soft-deleted clone leaves listings, and that it still resolves for a ledger lookup.
- [x] 4.3 Add clone routes in `apps/api`: create from an uploaded audio file with a label and provider, list, and remove. Derive the workspace from the authoritative record rather than the request body, and refuse audio the provider cannot take as a voice prompt. Proof: route tests cover creation, refusal of a non-audio upload, cross-workspace invisibility, and that a body-supplied workspace does not determine ownership.

## 5. Catalogue And Seam

- [x] 5.1 Extend `TtsInput` with an optional reference-audio location, filled by the API when it resolves a clone id, and carry it through the media client, the worker schema and the style bundle. Proof: tests prove the value reaches the provider and that a synthesis naming a provider-declared voice carries none.
- [x] 5.2 Make `voicesForProvider` return declared voices unioned with the calling workspace's clones for that provider, and require a workspace on the catalogue endpoints. Proof: tests cover a workspace with clones, a workspace without (byte-identical to today's list), cross-workspace isolation, and a catalogue request with no workspace being refused.
- [x] 5.3 Refuse a synthesis naming a voice the resolved provider does not know, with a message naming both, and report a stored selection invalidated by a provider change rather than substituting. Proof: tests cover a clone under the wrong provider, and a provider switch invalidating a bound clone.
- [x] 5.4 Serve a clone's audition from its reference audio, and keep the sample bake over declared voices only. Proof: tests cover a clone exposing a play control with no baked sample, and the bake not attempting clones.

## 6. Web Surface

- [x] 6.1 Add the clone surface: upload reference audio with a label, see the workspace's clones under their provider, and remove one. Proof: the created clone is selectable in the voice picker with no manual refresh, driven in the live app.
- [x] 6.2 Render a clone in the voice pickers as an ordinary voice with its audition control, and render the invalidated-selection state when the effective provider cannot speak it. Proof: browser evidence records both states with screenshots.

## 7. Verification

- [x] 7.1 Update the owning codemap and the workspace map in `AGENTS.md` for `apps/pocket-tts-id`. Proof: `bun run check:references` passes.
- [x] 7.2 Add a `CHANGELOG.md` Unreleased entry. Proof: `bun run check:version` and `bun run check:references` pass.
- [ ] 7.3 Exercise the deployed service end to end: configure the URL in Settings, test-before-save reports success, create a clone from a real recording, and synthesize Indonesian narration that resolves `provider_id: pocket-tts-id` and returns playable audio in the cloned voice. Proof: the resulting clip and the ledger row are recorded.
- [x] 7.4 Confirm the existing TTS path is untouched: a Kokoro synthesis still resolves to Kokoro with the same default voice, and a workspace with no clones sees an unchanged voice list. Proof: both driven in the live app after the deploy.
- [x] 7.5 Run `bun run ci` and `openspec validate add-pocket-tts-voice-cloning --strict`. Proof: both commands pass, or remaining unrelated failures are reported with exact output and ownership.
