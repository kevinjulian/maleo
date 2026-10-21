# curated-music-library Specification

## Purpose

How a background-music bed is obtained, labelled, published and matched to a cue.

The library is small, curated and self-hosted, which is what makes it dependable: a live third-party search answered valid queries with an empty success roughly a quarter of the time, was not licensed for commercial output on its free tier, and could not be steered toward a tone. Tens of well-labelled beds beat hundreds of thousands of unlabelled ones, because a cue is matched against words a human chose.

Covers what a bed must carry to be findable and defensible, how it is captured and labelled, how the library is published without shrinking when it is rebuilt, and the guarantees that let generation depend on it — chiefly that a cue never silently resolves to nothing.

## Requirements

### Requirement: A bed carries the labels that make it findable

Every bed in the library SHALL carry a title, a description, and a set of tags, and MAY carry an emotion from the system's fixed vocabulary. Those labels SHALL be what the library is searched against.

Title, tags and provenance come from the source page. Description and emotion are not stated by any page and are written afterwards, either by an operator or by the labelling step.

Every bed SHALL also record where it was obtained and under what licence.

#### Scenario: Fully labelled bed

- **WHEN** a bed is published with a title, description, tags, and a source and licence
- **THEN** it is searchable by every one of those labels

#### Scenario: Bed with no tags

- **WHEN** a bed is prepared with an empty or missing tag list
- **THEN** the operator is warned that it will be hard to find, and the bed is still indexed on its remaining labels

#### Scenario: Bed with no provenance

- **WHEN** a bed is prepared without a source or without a licence
- **THEN** it is rejected, because a bed that cannot be traced cannot answer a copyright claim

### Requirement: Labels are captured from the page the operator is viewing

The system SHALL provide a capture tool that reads a track's title, tags, licence and source URL from the page an operator has open, on an explicit action, and emits them in the manifest format. The description and emotion are not read from the page, which never states them; they MAY be supplied by the operator, and are otherwise written by the labelling step.

The tool MAY, in the same action, operate the download control the page itself provides, so that the captured entry and the downloaded file are produced together and their names cannot drift apart.

The tool MAY also capture a batch of tracks listed on a results page the operator is viewing, opening each in turn and operating that page's own download control. This is automated collection, which the source's terms prohibit; it exists because the operator decided to accept that, and the decision is recorded here rather than left implicit in the code.

Batch collection SHALL be bounded, paced, interruptible, and honest:

- It SHALL only take tracks already listed on the page in front of the operator, and SHALL NOT follow pagination.
- It SHALL have an upper bound on how many tracks one run can take, and a floor on the delay between them, neither of which the operator can remove from the interface.
- It SHALL open one track at a time and report progress, and SHALL stop when asked.
- It SHALL abandon a run after repeated consecutive failures, since that is what a rate limit, a block, or a login wall looks like from inside the tool.
- It SHALL NOT disguise itself or evade any control: no spoofed identity, no rotated origin, and no attempt to get past a login, a challenge, or a rate limit.

Capture SHALL be recorded before the download is triggered, so a download that fails leaves the labels captured rather than requiring the operator to start again.

#### Scenario: Capturing the open track page

- **WHEN** the operator triggers capture on a single track page
- **THEN** the track's title, tags, licence and source URL are recorded, and the page's own download is started, and the recorded file name is the one the download will produce

#### Scenario: The download cannot be started

- **WHEN** the page offers no usable download control
- **THEN** the labels are still captured and the operator is told to download the file themselves, rather than losing the capture

#### Scenario: A batch is taken from a results page

- **WHEN** the operator asks for a number of the tracks listed on the page they are viewing
- **THEN** each is opened in turn, captured and downloaded, one at a time and no faster than the floor allows, with progress reported

#### Scenario: More is asked for than is reasonable or available

- **WHEN** the requested count exceeds what the page lists, or the run ceiling
- **THEN** it is reduced to whichever is smaller, rather than the request being taken at face value

#### Scenario: The site starts refusing

- **WHEN** several tracks in a row fail to capture or download
- **THEN** the run stops and says so, rather than continuing or retrying harder

#### Scenario: The operator stops a run

- **WHEN** stop is pressed during a run
- **THEN** the current track finishes and no further tracks are opened

#### Scenario: Bed captured with too few labels

- **WHEN** a captured bed has no tags, or a duration below the usable minimum
- **THEN** the operator is warned before export, rather than discovering it when preparation rejects or under-indexes the bed

#### Scenario: The source page's markup changes

- **WHEN** the page's structure changes and fields can no longer be read
- **THEN** only the page-reading step is affected; the parsing, normalising and export behaviour is unchanged and independently verified

### Requirement: Captured labels land beside the audio, on every capture path

A capture SHALL write the track's labels to a file beside the downloaded audio, named after it, so that the pair travels together and a run that dies halfway leaves a usable half. This SHALL hold for a single track captured on its own and for a track captured as part of a batch alike, through one shared implementation rather than two that happen to agree.

The name the labels are filed under SHALL be taken from what the page states — the download URL a track page embeds names the file it serves — rather than from waiting for the browser to report a download starting. A capture SHALL NOT depend on that report, which arrives after the download begins and may not arrive at all.

Where the page states no name, the capture MAY wait for the browser's report as a fallback, and SHALL correct the recorded name once the real name is known.

#### Scenario: A single track is captured

- **WHEN** the operator captures one track on its own
- **THEN** the audio and its labels both land, named to match

#### Scenario: A batch track is captured

- **WHEN** a track is captured as part of a batch run
- **THEN** the audio and its labels both land, named to match, by the same means as a single capture

#### Scenario: The page states the file name

- **WHEN** the track page embeds the download URL it will use, and that URL names the file
- **THEN** the labels are filed under that name, without waiting for the download to start

#### Scenario: The browser never reports a download

- **WHEN** no download-started report arrives
- **THEN** the labels have already landed, because they did not depend on it

### Requirement: A capture reports what it verified, not what it attempted

A capture SHALL report success only for the steps it has confirmed. Operating the page's download control, capturing the labels, and filing them are separate outcomes, and a capture that achieved some of them SHALL say which.

A failure to file the labels SHALL reach the operator. It SHALL NOT be discarded, since the labels are the only part of a capture the pipeline reads, and a capture that quietly produced none is indistinguishable from one that was never made.

#### Scenario: The labels cannot be filed

- **WHEN** filing the labels fails
- **THEN** the capture is reported as failed and the reason is shown, rather than being reported as successful

#### Scenario: A batch track downloads but files nothing

- **WHEN** a track's audio lands but its labels do not
- **THEN** the run does not count it as done

#### Scenario: Everything succeeds

- **WHEN** the labels are captured, the download starts, and the labels are filed
- **THEN** the confirmation reflects all three, and is emitted after they have happened rather than on the assumption that they will

### Requirement: Rebuilding the library cannot shrink it

Each captured track SHALL be recorded in its own file beside its audio, and the source manifest SHALL be compiled from those together with the already-published library.

A published bed SHALL survive that compilation even when its audio is no longer available locally: it SHALL be carried through preparation untouched and recognised at publication as unchanged. Nobody retains every file they have ever published, and a bed dropped at any of those steps would be reported as unreferenced and disappear from the library.

Recapturing a published bed SHALL NOT discard the labels it already carries.

#### Scenario: A bed is published, its audio later deleted, and the library rebuilt

- **WHEN** the library is compiled, prepared and published again while that bed's audio is absent
- **THEN** the bed remains in the published library, at the same url, and is not reported as unreferenced

#### Scenario: A published bed is captured again

- **WHEN** an operator recaptures a track to correct its tags
- **THEN** its existing description and emotion are kept, and it is not published a second time

#### Scenario: The published library cannot be read before compiling

- **WHEN** the step that retrieves the published library cannot reach it
- **THEN** it stops rather than recording an empty library, which the next publication would treat as every bed having been removed

#### Scenario: Capture is interrupted partway

- **WHEN** a run ends early
- **THEN** the tracks already captured are complete on disk, each with its own record, and are usable without the rest

### Requirement: The labels a page cannot supply are written automatically

A bed's description and emotion SHALL be generated rather than typed, as a step that reads the published library, labels the beds lacking either, and writes the library's index back. That step SHALL NOT alter any audio.

It SHALL only add labels: an existing description or emotion SHALL survive, including on a forced re-run, so a hand correction is never overwritten by silence.

An emotion outside the system's fixed vocabulary SHALL be rejected rather than mapped to the nearest member, and declining to assign one SHALL be an accepted outcome. Emotion outranks every other search signal, so a confident wrong answer costs more than a blank.

#### Scenario: Bed published without a description or emotion

- **WHEN** the labelling step runs over a library containing such a bed
- **THEN** the bed gains a description of what is audible and, where it clearly serves one, an emotion

#### Scenario: Bed already carries both labels

- **WHEN** the step runs again over an unchanged library
- **THEN** that bed is not relabelled, so repeating the step costs nothing and yields the same library

#### Scenario: An emotion outside the vocabulary is proposed

- **WHEN** the generated emotion is not one of the fixed set
- **THEN** the bed is left with no emotion rather than being assigned the closest match

#### Scenario: A label already written by hand

- **WHEN** labelling is forced over a bed whose description was corrected by a human, and the new answer offers none
- **THEN** the existing description is kept

#### Scenario: The published library cannot be read

- **WHEN** the step cannot fetch the library it is meant to label
- **THEN** it stops without writing, because publishing an index it never read would unpoint every bed at once

#### Scenario: The library's index is a shape this step does not know

- **WHEN** the index reports a schema version other than the one the step writes
- **THEN** it refuses to rewrite it rather than dropping fields it does not recognise

### Requirement: Beds are published as they were obtained

Audio SHALL be published byte-for-byte as downloaded. It SHALL NOT be transcoded or altered in level.

No bed SHALL be refused for its length. Duration SHALL be recorded where it can be measured, and resolution SHALL prefer a bed long enough to hold a section while falling back to the longest available — so a short bed is picked less often rather than being unusable. Where duration cannot be measured, the bed SHALL still be published without one.

A bed SHALL be published under the name it was obtained with, so that the local file, the stored object and the url all read the same.

Because that name is not derived from the audio, it can hold different audio over time, and beds SHALL therefore NOT be cached as immutable. Nothing revalidates a url pinned into a template row, so a long cache lifetime on a reusable name would serve a superseded bed for as long as that cache lived.

Publication SHALL refuse to proceed when two beds would be stored under one name, since the second would replace the first while both remain listed.

#### Scenario: A bed is published

- **WHEN** a downloaded file is published
- **THEN** the bytes served are identical to the bytes downloaded

#### Scenario: Bed shorter than a section

- **WHEN** a bed shorter than the preferred minimum is published
- **THEN** it is published with its measured duration, and resolution prefers a longer bed where one matches the cue

#### Scenario: Duration cannot be measured

- **WHEN** no audio toolchain is available
- **THEN** beds are published without durations, and the operator is told, rather than publishing being blocked

#### Scenario: A bed is published

- **WHEN** a downloaded file is published
- **THEN** its stored name and its url carry the name it was downloaded with

#### Scenario: Two beds share a name

- **WHEN** two different tracks would be stored under one name
- **THEN** publication stops and names both, rather than one silently replacing the other

#### Scenario: A track is replaced by a different recording of itself

- **WHEN** a bed's audio changes but its name does not
- **THEN** the url is unchanged and is not reported as unreferenced, and the cache lifetime is short enough that the replacement is served the same day

#### Scenario: A bed is unchanged

- **WHEN** publishing runs again over an unchanged bed
- **THEN** the filename is unchanged and the bed is not re-uploaded

### Requirement: A bed is identified by where it came from

Publishing SHALL decide what to upload by comparing the prepared set against the already-published library, keyed on each bed's source rather than on its filename. A published bed whose audio is unchanged SHALL be reused without uploading; one whose audio changed SHALL be uploaded and its previous file reported as superseded.

The filename encodes the normalised audio, so it changes whenever preparation settings change. Treating it as identity would read a re-normalised library as an entirely new one, upload a duplicate of every bed, and strand the originals.

#### Scenario: Nothing has changed since the last publish

- **WHEN** publishing runs again over a library whose beds are byte-identical to what is published
- **THEN** no bed is uploaded and each keeps its existing URL

#### Scenario: A bed is re-normalised and published again

- **WHEN** a bed's audio changes but its source is the same
- **THEN** it is uploaded once as a replacement, not added alongside the old one, and the superseded file is reported

#### Scenario: A bed is removed from the library

- **WHEN** a previously published bed is no longer part of the prepared set
- **THEN** it is reported as no longer referenced, so its file can be pruned rather than accumulating unnoticed

#### Scenario: A published bed's audio cannot be verified

- **WHEN** a published entry records no hash to compare against
- **THEN** it is re-uploaded rather than assumed current

### Requirement: The same bed is not published twice under different labels

Preparation SHALL detect beds that are byte-identical, beds that share a source, and beds that would share an identifier, and SHALL NOT emit a manifest in which one bed is unreachable.

The same track captured twice under slightly different titles produces different filenames, so only the audio hash notices. An identifier derived from a bed's emotion collides whenever two beds carry the same emotion, and lookup by emotion would then silently reach one and never the other.

#### Scenario: The same recording captured twice

- **WHEN** two prepared beds have identical audio under different titles
- **THEN** one is kept, and the one dropped is named rather than silently discarded

#### Scenario: Two beds curated for the same emotion

- **WHEN** two beds would receive the same identifier
- **THEN** both are made reachable with distinct identifiers, and those identifiers do not depend on the order the beds were prepared

### Requirement: The library is published as a manifest of stable public URLs

The library SHALL be published as a manifest listing every bed with its playable URL and its labels. Those URLs SHALL be stable and publicly readable, and SHALL NOT expire.

Template rows persist a bed's URL indefinitely, so an expiring URL would silently break a pinned template long after it was chosen.

#### Scenario: A pinned bed keeps working

- **WHEN** a template pinned a bed's URL and time passes
- **THEN** that URL still resolves, because it neither expires nor requires a credential

#### Scenario: Reading the library needs no credential

- **WHEN** the application fetches the manifest or plays a bed
- **THEN** no credential is required; only publishing requires one

### Requirement: The manifest is cached, and a stale copy beats none

The application SHALL cache the fetched manifest and SHALL retain the last good copy. When the manifest cannot be fetched, the retained copy SHALL be used.

Generation is long-running and costly; losing music to a transient outage after voice and images have been paid for is a worse outcome than scoring against a slightly stale library.

#### Scenario: Manifest unchanged since last fetch

- **WHEN** the manifest is fetched again within its cache lifetime
- **THEN** the cached copy is used and no request is made

#### Scenario: Manifest unreachable during generation

- **WHEN** the manifest cannot be fetched and a copy was previously retained
- **THEN** the retained copy is used and generation proceeds

#### Scenario: Manifest unreachable and nothing retained

- **WHEN** the manifest cannot be fetched and no copy was ever retained
- **THEN** the library reports itself unavailable rather than presenting an empty library

### Requirement: A cue resolves to the best-matching bed, never to nothing

A free-text cue SHALL be scored against every bed's tags, title, description, and emotion, and the best-scoring bed SHALL be returned. While the library is non-empty, resolution SHALL return a bed even when no bed scores above zero.

A library of tens of beds makes "no strong match" ordinary rather than exceptional, and a silently missing bed is the specific failure this change exists to remove.

#### Scenario: Cue matches a bed's tags

- **WHEN** a cue shares terms with a bed's tags
- **THEN** that bed outranks a bed matching only on description

#### Scenario: Cue matches nothing well

- **WHEN** a cue shares no terms with any bed
- **THEN** a bed is still returned rather than nothing

#### Scenario: Caller knows the emotion

- **WHEN** resolution is given an emotion and a bed carries that emotion
- **THEN** that bed outranks beds matching only on text

#### Scenario: Same cue asked twice

- **WHEN** the same cue is resolved again against an unchanged library
- **THEN** the same bed is returned, so a preview and the rendered video agree

#### Scenario: Several beds score equally

- **WHEN** more than one bed ties on score
- **THEN** the tie is broken deterministically rather than at random

#### Scenario: Library is empty

- **WHEN** no library has been published
- **THEN** resolution yields no bed, and the surface reports the library as unpublished rather than as having no matches

### Requirement: Sound effects are unaffected

Sound-effect and accent cues SHALL continue to resolve from the existing sound-effect provider, and SHALL NOT be served from the music library.

#### Scenario: SFX cue during the change

- **WHEN** a sound-effect cue is resolved
- **THEN** it resolves exactly as it did before the music library existed
