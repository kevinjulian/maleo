# Voice Sample Previews

## Purpose

How an operator hears a voice before choosing it. Every catalogued TTS voice is represented by a short clip of one fixed sentence, baked ahead of time and served as a static file, so a narrator can be auditioned from the surface where it is selected. Previewing is deliberately outside the metered generation path: the clip is a file, not a synthesis, so it can be played freely and a missing clip degrades to a name-only entry rather than an error.

## Requirements

### Requirement: Every catalogued voice is auditionable before it is chosen

The system SHALL make each voice in the TTS catalogue auditionable from every surface that lists it, not only from the surfaces where a voice is bound to a scene or project. A voice SHALL be represented by a short sample clip spoken in that voice, in a language that voice can actually speak, so a voice is auditioned as it would really be heard. The operator SHALL NOT have to synthesize a project voiceover to hear a voice.

Voices that share a language SHALL speak identical words, so any two of them are compared on the same sentence. Voices of different languages SHALL NOT be forced onto one sentence: a language-locked voice given words outside its language is not an audition of that voice.

A cloned voice SHALL be auditioned through the reference audio it was created from, not through a baked sample. The sample bake is an ahead-of-time pass over the voices declared in the repository and cannot contain a voice created after it ran; the reference audio is also the more faithful preview, being the recording the model imitates. A clone therefore SHALL NOT be treated as missing its audition merely because no baked clip exists for it, and SHALL NOT be compared against declared voices on the fixed sentence, because it does not speak one.

A surface whose purpose is to present the voice catalogue SHALL offer the play control. A surface that receives a voice's sample location and lists that voice without a play control is a defect, not a lesser presentation: the location is already carried in the payload it fetched.

#### Scenario: Operator auditions a voice from the scene voice picker

- **WHEN** the operator opens the scene-level voice picker
- **THEN** each voice that has a baked sample offers a play control, and activating it plays that voice's sample clip

#### Scenario: Operator auditions a voice from Project Settings

- **WHEN** the operator opens the Voice Defaults section of Project Settings for the effective provider
- **THEN** each voice in that provider's list offers the same play control, playing the same sample clip as the scene picker

#### Scenario: Operator auditions a voice from the library's voice surface

- **WHEN** the operator opens the library surface that lists the voice catalogue
- **THEN** each voice that has a baked sample offers the same play control, playing the same sample clip as the scene picker

#### Scenario: Operator auditions a voice while composing speech

- **WHEN** the operator chooses a voice in the speech lab before synthesizing
- **THEN** that voice offers the same play control, so the choice is made by ear rather than by name

#### Scenario: A listing surface does not discard a sample it was given

- **WHEN** a payload carries a sample location for a voice
- **THEN** the surface rendering that voice exposes it as a play control rather than dropping the field

#### Scenario: Two voices of the same language are compared on the same words

- **WHEN** samples for any two voices of the same provider and the same language are played
- **THEN** both speak the identical sample sentence, differing only in voice

#### Scenario: A language-locked voice is auditioned in its own language

- **WHEN** a sample is baked for a voice whose language differs from the default sample language
- **THEN** it speaks that language's sample text, not the default one

#### Scenario: A voice's language has no sample text

- **WHEN** a voice's language carries no sample text of its own
- **THEN** the default sample text is used rather than skipping the voice, so it is still auditionable

#### Scenario: Operator auditions a cloned voice

- **WHEN** the operator plays the audition for a cloned voice
- **THEN** the reference audio that clone was created from is played, on the same play control as every other voice

#### Scenario: A clone is not reported as missing its audition

- **WHEN** a surface lists a cloned voice for which no baked sample exists
- **THEN** it offers the play control rather than degrading to a name-only entry

#### Scenario: The sample bake does not attempt clones

- **WHEN** the sample bake runs
- **THEN** it bakes the voices declared in the repository and does not attempt to bake clones, which may be created after it has run

### Requirement: A sample is baked ahead of time, never synthesized on demand

A sample clip SHALL be produced by an explicit offline bake step and served as a static file. The system SHALL NOT synthesize a sample in response to a preview request, and SHALL NOT reach a TTS provider on the request path that serves a sample.

#### Scenario: Preview plays without contacting a provider

- **WHEN** an operator plays a voice sample
- **THEN** the audio is served from the baked static asset, and no text-to-speech provider request is issued

#### Scenario: Bake is invoked deliberately

- **WHEN** samples are needed for a provider's voices
- **THEN** an operator or deploy step runs the bake explicitly; no user-facing action triggers a bake

### Requirement: Previewing a voice is never a billed generation

Serving or playing a voice sample SHALL NOT record a metered generation, SHALL NOT consume workspace quota, and SHALL NOT pass through the billed synthesis path used by project voiceovers. The bake step is the only place a sample's synthesis cost is incurred.

#### Scenario: Repeated previews cost nothing

- **WHEN** an operator plays voice samples any number of times
- **THEN** no usage record is written and no quota is decremented for those plays

#### Scenario: Preview does not fall back to billed synthesis

- **WHEN** a voice has no baked sample
- **THEN** the system serves no audio for it and does not synthesize one through the billed path

### Requirement: A sample's identity is its provider, voice, and sample text

A baked sample SHALL be identified by the provider that produced it, the voice id within that provider, and the version of the sample text. Re-running the bake with an unchanged identity SHALL reuse the existing clip and produce no new synthesis. Changing the sample text SHALL invalidate every existing sample, so no two voices of a language are ever compared on different words and no clip of superseded text remains addressable.

#### Scenario: Re-running the bake is a no-op

- **WHEN** the bake runs twice with the same sample text and voice catalogue
- **THEN** the second run synthesizes nothing and leaves the existing clips in place

#### Scenario: Changing the sample text rebakes everything

- **WHEN** the sample text version changes
- **THEN** every voice's sample is re-synthesized, and no clip of the previous text remains addressable as a current sample

#### Scenario: A new voice is added to a provider's catalogue

- **WHEN** the bake runs after a voice is added to the catalogue
- **THEN** only the new voice is synthesized and the existing clips are untouched

#### Scenario: One language's sample text is revised

- **WHEN** the sample text for any language changes
- **THEN** the sample text version changes with it, so no surviving clip can be compared against the revised wording

### Requirement: The sample reaches the client through the catalogue payloads that already list voices

Each voice entry returned by the TTS status payload and by the voice catalogue endpoint SHALL carry the location of its sample clip, or an explicit empty value when no sample has been baked. A client SHALL NOT need a second request per voice to discover whether a sample exists.

#### Scenario: Status payload carries sample locations

- **WHEN** a client reads the TTS status payload
- **THEN** every voice under every provider carries a sample location or an explicit empty value

#### Scenario: Voice catalogue payload carries sample locations

- **WHEN** a client reads the voice catalogue endpoint
- **THEN** every voice entry carries the same field, resolving to the same clip as the status payload does for that provider and voice

#### Scenario: One request describes the whole catalogue

- **WHEN** a picker renders a provider's full voice list
- **THEN** it determines which voices are auditionable from the single catalogue payload it already fetched

### Requirement: A missing sample degrades to a name-only entry

A voice without a baked sample SHALL remain listed and selectable. The system SHALL omit the play control for that voice rather than presenting a control that fails, and SHALL NOT block voice selection, project settings, or voiceover generation on the presence of a sample.

#### Scenario: Provider is not configured at bake time

- **WHEN** a provider's credentials are absent when the bake runs
- **THEN** that provider's voices are skipped without failing the bake, and its voices are still listed and selectable in the pickers with no play control

#### Scenario: A single voice fails to bake

- **WHEN** synthesis fails for one voice during a bake
- **THEN** the remaining voices are still baked, the failure is reported, and the failed voice is listed without a play control

### Requirement: Only one sample plays at a time

The system SHALL play at most one voice sample at any moment. Starting a sample SHALL stop whichever sample is currently playing, and the control state SHALL reflect which sample, if any, is playing.

The sample being played SHALL be identified by its provider AND its voice id, on every surface and wherever that identity is held in memory. A voice id alone does not identify a clip: ids are unique within a provider and not across them, so a surface listing more than one provider can otherwise show the wrong row as playing, or collide two rows that are different voices from different services. This is the identity the baked file already carries.

#### Scenario: Starting a second sample stops the first

- **WHEN** a sample is playing and the operator starts a different one
- **THEN** the first stops immediately, the second plays, and only the second is shown as playing

#### Scenario: Playback finishing clears the playing state

- **WHEN** a sample reaches its end
- **THEN** no sample is shown as playing and the control returns to its idle state

#### Scenario: Two providers ship a voice with the same id

- **WHEN** a surface lists voices from two providers that use the same voice id, and the operator plays one of them
- **THEN** only that provider's row is shown as playing, and the clip that sounds is that provider's

#### Scenario: One sample plays across surfaces

- **WHEN** a sample is playing on one surface and the operator starts a different sample on another mounted surface
- **THEN** the first stops, so at no point do two clips overlap

### Requirement: The bake covers every registered TTS provider

The sample bake SHALL derive the providers it bakes from the provider registry, and SHALL NOT hold its own list of providers or of a provider's voices. Registering a TTS provider SHALL bring its voices into the bake with no edit to the bake itself.

The bake was the last place a provider's voice list was restated. A list that must be edited when a provider is added is a list that will one day be missed, leaving a provider's voices listed everywhere and auditionable nowhere.

#### Scenario: A provider is registered

- **WHEN** a TTS provider is added to the registry and the bake is run
- **THEN** that provider's voices are baked, without the bake naming the provider

#### Scenario: A provider is limited for one run

- **WHEN** an operator restricts a bake run to one provider
- **THEN** the named provider is baked and the others are skipped, with the name checked against the registry rather than a list in the bake

#### Scenario: A registered provider is unconfigured at bake time

- **WHEN** a registered TTS provider reports itself unconfigured when the bake runs
- **THEN** its voices are skipped with a note and the bake continues for the rest, rather than failing

### Requirement: Every listed voice is auditionable, whichever provider it belongs to

A surface that lists a voice SHALL offer its play control regardless of whether that voice's provider is the effective one. A baked sample SHALL be servable for any registered provider, not only the one that would perform the next synthesis.

Auditioning is reading a static file. Gating it on the app-wide provider selection would mean an operator must change what every project renders with in order to hear a clip that is already on disk — which is the opposite of what an audition is for.

#### Scenario: A non-effective provider's voice is auditioned

- **WHEN** an operator plays the sample of a voice belonging to a registered provider that is not the effective one
- **THEN** the clip plays, and the app-wide provider selection is unchanged

#### Scenario: A browsing surface lists several providers' samples

- **WHEN** a surface lists voices from every registered provider
- **THEN** each voice that has a baked sample offers a play control, whichever provider it came from

#### Scenario: An unconfigured provider's baked voices stay auditionable

- **WHEN** a registered provider reports itself unconfigured but its voices were baked earlier
- **THEN** those samples still play, because serving one reaches no provider
