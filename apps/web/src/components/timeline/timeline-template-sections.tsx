/* The template inspector's six destinations, one drawn at a time beside the
 * rail. Each edits the draft the editor modal owns; the modal decides which is
 * open and hands the focus key that scrolls a freshly opened one into view. */
import type { Dispatch, JSX, SetStateAction } from "react";
import {
	DEFAULT_MUSIC_EMOTION_CUES,
	EMOTIONS,
	TIMELINE_SCENE_TRANSITIONS,
	type Emotion,
	type RefImage,
	type TimelineTemplateInput,
} from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { Input } from "@design-system/components/input.tsx";
import { MentionTextarea } from "./mention-textarea.tsx";
import { AccordionSection } from "./inspector-section.tsx";
import {
	TitlePresetPicker,
	StockSfxPicker,
	TransitionPresetPicker,
} from "./timeline-template-pickers.tsx";
import type { PreviewSfx, TemplateInspectorSection } from "./timeline-template-preview.ts";

/* The option lists these selects render from. Sharing one array between the
 * typed options and the handler is what removes the assertion: the handler can
 * only ever be handed a value the control actually offered. */
const SECTION_TITLE_POLICIES: TimelineTemplateInput["sectionTitlePolicy"][] = [
	"every_section",
	"first_only",
	"none",
];
const SECTION_TITLE_POLICY_LABEL = {
	every_section: "Every section",
	first_only: "Opening only",
	none: "No section titles",
} satisfies Record<TimelineTemplateInput["sectionTitlePolicy"], string>;
const MUSIC_POLICIES: TimelineTemplateInput["musicPolicy"][] = ["single", "per_emotion"];
const MUSIC_POLICY_LABEL = {
	single: "One bed for the whole video",
	per_emotion: "A bed per section emotion",
} satisfies Record<TimelineTemplateInput["musicPolicy"], string>;

const SCENE_TRANSITION_OPTIONS = TIMELINE_SCENE_TRANSITIONS ?? [
	"cut",
	"fade",
	"slide",
	"zoom",
	"wipe",
	"flip",
	"clock_wipe",
	"pixel",
];

export function TemplateInspectorSections({
	openSection,
	focusKey,
	draft,
	setDraft,
	sectionPreview,
	scenePreview,
	musicPreview,
	projectEmotions,
	refs,
}: {
	openSection: TemplateInspectorSection;
	focusKey: number;
	draft: TimelineTemplateInput;
	setDraft: Dispatch<SetStateAction<TimelineTemplateInput>>;
	sectionPreview: PreviewSfx;
	scenePreview: PreviewSfx;
	musicPreview: PreviewSfx;
	projectEmotions: Emotion[];
	refs: RefImage[];
}): JSX.Element {
	return (
		<>
			{openSection === "identity" && (
				<AccordionSection label="Template identity" defaultOpen focusKey={focusKey}>
					<label>
						<span>Name</span>
						<Input
							value={draft.name}
							maxLength={80}
							onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
						/>
					</label>
					<label>
						<span>Description</span>
						<Input
							value={draft.description}
							maxLength={240}
							onChange={(event) =>
								setDraft((value) => ({ ...value, description: event.target.value }))
							}
						/>
					</label>
				</AccordionSection>
			)}
			{openSection === "opening" && (
				<AccordionSection label="Opening · section 1" defaultOpen focusKey={focusKey}>
					<label>
						<span>Opening title (section 1)</span>
						<TitlePresetPicker
							label="Opening title"
							value={draft.introTextPreset}
							onChange={(introTextPreset) => setDraft((value) => ({ ...value, introTextPreset }))}
						/>
					</label>
					<label>
						<span>Title duration (s)</span>
						<Input
							type="number"
							min={0.1}
							step={0.1}
							value={draft.introTitleDurationSec}
							onChange={(event) =>
								setDraft((value) => ({
									...value,
									introTitleDurationSec: Math.max(0.1, Number(event.target.value) || 0.1),
								}))
							}
						/>
					</label>
				</AccordionSection>
			)}
			{openSection === "entries" && (
				<AccordionSection label="Section entries · every section" defaultOpen focusKey={focusKey}>
					<label>
						<span>Entry SFX</span>
						<StockSfxPicker
							label="Section entry SFX"
							value={draft.introEntrySfx}
							audio={sectionPreview.audio}
							onChange={(introEntrySfx, audio) =>
								setDraft((value) => ({
									...value,
									introEntrySfx,
									introEntrySfxUrl: audio?.url ?? "",
								}))
							}
						/>
					</label>
					<div className="tl2-template-editor-row">
						<label>
							<span>Entry SFX volume</span>
							<Input
								type="number"
								min={0}
								max={100}
								step={1}
								value={Math.round(draft.introEntrySfxVolume * 100)}
								onChange={(event) =>
									setDraft((value) => ({
										...value,
										introEntrySfxVolume:
											Math.max(0, Math.min(100, Number(event.target.value) || 0)) / 100,
									}))
								}
							/>
						</label>
						<label>
							<span>Entry SFX offset (s)</span>
							<Input
								type="number"
								min={0}
								step={0.1}
								value={draft.introEntrySfxOffsetSec}
								onChange={(event) =>
									setDraft((value) => ({
										...value,
										introEntrySfxOffsetSec: Math.max(0, Number(event.target.value) || 0),
									}))
								}
							/>
						</label>
					</div>
					<div className="tl2-template-editor-row">
						<label>
							<span>Silence before each section (s)</span>
							<Input
								type="number"
								min={0}
								step={0.1}
								value={draft.introLeadInSec}
								onChange={(event) =>
									setDraft((value) => ({
										...value,
										introLeadInSec: Math.max(0, Number(event.target.value) || 0),
									}))
								}
							/>
						</label>
						<label>
							<span>Gap between sections (s)</span>
							<Input
								type="number"
								min={0}
								step={0.1}
								value={draft.sectionGapSec}
								onChange={(event) =>
									setDraft((value) => ({
										...value,
										sectionGapSec: Math.max(0, Number(event.target.value) || 0),
									}))
								}
							/>
						</label>
					</div>
					<label>
						<span>Section title policy</span>
						<Select
							value={draft.sectionTitlePolicy}
							onValueChange={onSelect(SECTION_TITLE_POLICIES, (sectionTitlePolicy) =>
								setDraft((value) => ({ ...value, sectionTitlePolicy })),
							)}
							phoneBreakpoint={860}
							options={[
								...(SECTION_TITLE_POLICIES.map((p) => ({
									value: p,
									label: SECTION_TITLE_POLICY_LABEL[p],
								})) ?? []),
							]}
						/>
					</label>
					<label>
						<span>Following-section title (section 2+)</span>
						<TitlePresetPicker
							label="Following-section title"
							value={draft.sectionTextPreset}
							disabled={draft.sectionTitlePolicy !== "every_section"}
							onChange={(sectionTextPreset) =>
								setDraft((value) => ({ ...value, sectionTextPreset }))
							}
						/>
					</label>
				</AccordionSection>
			)}
			{openSection === "scene" && (
				<AccordionSection label="Scene behavior" defaultOpen focusKey={focusKey}>
					<div className="tl2-template-editor-row">
						<label>
							<span>Max visual beat (s)</span>
							<Input
								type="number"
								min={2}
								max={15}
								step={0.5}
								value={draft.maxVisualBeatSec}
								onChange={(event) =>
									setDraft((value) => ({
										...value,
										maxVisualBeatSec: Math.max(2, Math.min(15, Number(event.target.value) || 2)),
									}))
								}
							/>
						</label>
						<label>
							<span>Max voiceover segment (s)</span>
							<Input
								type="number"
								min={3}
								max={20}
								step={0.5}
								value={draft.maxVoiceoverSegmentSec}
								onChange={(event) =>
									setDraft((value) => ({
										...value,
										maxVoiceoverSegmentSec: Math.max(
											3,
											Math.min(20, Number(event.target.value) || 3),
										),
									}))
								}
							/>
						</label>
					</div>
					<label>
						<span>Scene entry SFX</span>
						<StockSfxPicker
							label="Scene entry SFX"
							value={draft.sceneEntrySfx}
							audio={scenePreview.audio}
							onChange={(sceneEntrySfx, audio) =>
								setDraft((value) => ({
									...value,
									sceneEntrySfx,
									sceneEntrySfxUrl: audio?.url ?? "",
								}))
							}
						/>
					</label>
					<div className="tl2-template-editor-row">
						<label>
							<span>Sentence breathing gap (s)</span>
							<Input
								type="number"
								min={0}
								step={0.05}
								value={draft.sentenceVoiceoverPauseSec}
								onChange={(event) =>
									setDraft((value) => ({
										...value,
										sentenceVoiceoverPauseSec: Math.max(0, Number(event.target.value) || 0),
									}))
								}
							/>
						</label>
						<label>
							<span>Sub-section breathing gap (s)</span>
							<Input
								type="number"
								min={0}
								step={0.05}
								value={draft.sceneVoiceoverPauseSec}
								onChange={(event) =>
									setDraft((value) => ({
										...value,
										sceneVoiceoverPauseSec: Math.max(0, Number(event.target.value) || 0),
									}))
								}
							/>
						</label>
					</div>
					<label className="tl2-template-editor-check">
						<input
							type="checkbox"
							checked={draft.staticSceneMovement}
							onChange={(event) =>
								setDraft((value) => ({ ...value, staticSceneMovement: event.target.checked }))
							}
						/>
						<span>Make scene movement static</span>
					</label>
					<label className="tl2-template-editor-check">
						<input
							type="checkbox"
							checked={draft.overrideSceneTransition}
							onChange={(event) =>
								setDraft((value) => ({
									...value,
									overrideSceneTransition: event.target.checked,
								}))
							}
						/>
						<span>Override scene transition</span>
					</label>
					{draft.overrideSceneTransition && (
						<label>
							<span>Scene transition</span>
							<TransitionPresetPicker
								value={draft.sceneTransition}
								choices={SCENE_TRANSITION_OPTIONS}
								onChange={(sceneTransition) => setDraft((value) => ({ ...value, sceneTransition }))}
							/>
						</label>
					)}
				</AccordionSection>
			)}
			{openSection === "music" && (
				<AccordionSection label="Background music" defaultOpen focusKey={focusKey}>
					<label>
						<span>Default music</span>
						<StockSfxPicker
							label="Background music"
							kind="music"
							value={draft.musicCue}
							audio={musicPreview.audio}
							onChange={(musicCue, audio) =>
								setDraft((value) => ({ ...value, musicCue, musicUrl: audio?.url ?? "" }))
							}
						/>
					</label>
					<label>
						<span>Music volume</span>
						<Input
							type="number"
							min={0}
							max={100}
							step={1}
							value={Math.round(draft.musicVolume * 100)}
							onChange={(event) =>
								setDraft((value) => ({
									...value,
									musicVolume: Math.max(0, Math.min(100, Number(event.target.value) || 0)) / 100,
								}))
							}
						/>
					</label>
					<label>
						<span>Music policy</span>
						<Select
							value={draft.musicPolicy}
							onValueChange={onSelect(MUSIC_POLICIES, (musicPolicy) =>
								setDraft((value) => ({ ...value, musicPolicy })),
							)}
							phoneBreakpoint={860}
							options={[
								...(MUSIC_POLICIES.map((p) => ({ value: p, label: MUSIC_POLICY_LABEL[p] })) ?? []),
							]}
						/>
					</label>
					{draft.musicPolicy === "per_emotion" && (
						<div className="tl2-emotion-summary" role="group" aria-label="Emotion palette overview">
							{EMOTIONS.map((emotion) => {
								const entry = draft.musicEmotionCues[emotion];
								const shipped = DEFAULT_MUSIC_EMOTION_CUES[emotion];
								const custom = Boolean(entry?.url) || (entry?.cue ?? "") !== shipped.cue;
								const used = projectEmotions.includes(emotion);
								return (
									<span
										key={emotion}
										className={`tl2-emotion-chip ${custom ? "custom" : ""} ${used ? "used" : ""}`}
										title={`${emotion}${used ? " · used by this project" : ""}${entry?.url ? " · pinned track" : custom ? " · customised" : " · shipped default"}`}
									>
										{entry?.url ? Ic.check(ICON.xs) : null}
										{emotion}
									</span>
								);
							})}
						</div>
					)}
					{draft.musicPolicy === "per_emotion" && (
						<div className="tl2-template-editor-emotions">
							{[...EMOTIONS]
								.sort(
									(a, b) =>
										Number(projectEmotions.includes(b)) - Number(projectEmotions.includes(a)),
								)
								.map((emotion) => {
									const entry = draft.musicEmotionCues[emotion];
									return (
										<label
											key={emotion}
											className={projectEmotions.includes(emotion) ? "used" : ""}
										>
											<span>{emotion}</span>
											<StockSfxPicker
												label={`${emotion} music`}
												kind="music"
												value={entry?.cue ?? ""}
												audio={entry?.url ? { url: entry.url, title: entry.cue } : null}
												onChange={(cue, audio) =>
													setDraft((value) => {
														const next = { ...value.musicEmotionCues };
														// Clearing an emotion drops it from the map entirely, so it falls
														// back to the default cue instead of persisting an empty entry.
														if (cue.trim() || audio?.url)
															next[emotion] = { cue, url: audio?.url ?? "" };
														else delete next[emotion];
														return { ...value, musicEmotionCues: next };
													})
												}
											/>
										</label>
									);
								})}
						</div>
					)}
				</AccordionSection>
			)}
			{openSection === "visual" && (
				<AccordionSection label="Visual framework" defaultOpen focusKey={focusKey}>
					<label className="tl2-template-editor-check">
						<input
							type="checkbox"
							checked={draft.useData}
							onChange={(event) =>
								setDraft((value) => ({ ...value, useData: event.target.checked }))
							}
						/>
						<span>Allow data and infographic overlays</span>
					</label>
					<label>
						<span>Image guidance prompt</span>
						<MentionTextarea
							rows={5}
							value={draft.imageGuidancePrompt}
							refs={refs}
							placeholder="Mention @reference and use {{section.title}} or {{section.narration}}"
							onChange={(imageGuidancePrompt) =>
								setDraft((value) => ({ ...value, imageGuidancePrompt }))
							}
						/>
					</label>
				</AccordionSection>
			)}
		</>
	);
}
