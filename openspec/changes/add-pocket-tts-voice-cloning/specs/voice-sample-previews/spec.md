## MODIFIED Requirements

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

#### Scenario: Operator auditions a cloned voice

- **WHEN** the operator plays the audition for a cloned voice
- **THEN** the reference audio that clone was created from is played, on the same play control as every other voice

#### Scenario: A clone is not reported as missing its audition

- **WHEN** a surface lists a cloned voice for which no baked sample exists
- **THEN** it offers the play control rather than degrading to a name-only entry

#### Scenario: The sample bake does not attempt clones

- **WHEN** the sample bake runs
- **THEN** it bakes the voices declared in the repository and does not attempt to bake clones, which may be created after it has run
