import { useEffect, useState } from "react";
import type { JSX } from "react";
import {
	PRESENTATION_CATEGORIES,
	STORY_EDITORIAL_PURPOSES,
	bindingIdentity,
	type StoryboardCommand,
	type StoryDraftSection,
	type StoryExtensionPolicy,
	type StorySemanticBeat,
} from "@maleo/shared";
import { AudioPreview } from "@design-system/components/audio-preview.tsx";
import { Button } from "@design-system/components/button.tsx";
import { PageTitle } from "@design-system/components/page.tsx";
import { Chip } from "@design-system/components/chip.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { useStoryboardDraft } from "@hooks/storyboard/use-storyboard-draft.ts";
import {
	splitBeatNarration,
	storyboardBeatOutput,
	storyboardChatInstruction,
	storyboardPhase,
} from "@models/storyboard/storyboard-authoring-view.ts";
import { Toolbar } from "@design-system/patterns/toolbar.tsx";
import "./storyboard-view.css";

type DraftController = ReturnType<typeof useStoryboardDraft>;
type AssistAction = "rewrite" | "improve" | "regenerate";
const POLICIES = ["review_additions", "auto_approve_additions"] as const;

function blankBeat(title = "Opening beat"): StorySemanticBeat {
	return { id: crypto.randomUUID(), title, narration: "", visualPrompt: "" };
}

function blankSection(title = "Opening"): StoryDraftSection {
	return { id: crypto.randomUUID(), title, beats: [blankBeat()] };
}

function focusBeat(beatId: string): void {
	requestAnimationFrame(() => document.getElementById(`story-beat-${beatId}`)?.focus());
}

function phaseLabel(phase: ReturnType<typeof storyboardPhase>): string {
	return {
		loading: "Loading",
		failed: "Failed",
		empty: "Empty",
		legacy: "Legacy plan",
		draft: "Draft",
		approved: "Approved",
		generating: "Generating",
		conflict: "Conflict",
	}[phase];
}

interface BeatCardProps {
	beat: StorySemanticBeat;
	section: StoryDraftSection;
	index: number;
	draft: DraftController;
	approvedRevisionId?: string;
	onAssist: (action: AssistAction, beatId: string) => Promise<void>;
}

function BeatCard({
	beat,
	section,
	index,
	draft,
	approvedRevisionId,
	onAssist,
}: BeatCardProps): JSX.Element {
	const [referenceId, setReferenceId] = useState("");
	const [editorial, setEditorial] = useState(beat.editorial);
	useEffect(() => {
		setEditorial(beat.editorial);
	}, [beat.editorial]);
	const output = storyboardBeatOutput(
		draft.generatedByBeatId[beat.id] ?? [],
		approvedRevisionId,
		beat,
	);
	const local = draft.textDrafts[beat.id];
	const submit = async (command: StoryboardCommand, returnFocus = true): Promise<void> => {
		await draft.submit(command);
		if (returnFocus) focusBeat(beat.id);
	};
	const split = (): void => {
		const [first, second] = splitBeatNarration(local?.narration ?? beat.narration);
		if (!second) return;
		void submit({
			type: "split_beat",
			beatId: beat.id,
			first: { narration: first },
			second: {
				...blankBeat(`${beat.title || "Beat"} continued`),
				narration: second,
				visualPrompt: beat.visualPrompt,
			},
		});
	};
	const updateEditorial = (next: NonNullable<typeof editorial>, commit = false): void => {
		setEditorial(next);
		if (commit) {
			const { shots: _shots, ...editable } = next;
			void submit(
				{
					type: "update_beat",
					beatId: beat.id,
					fields: { editorial: editable, motionGraphic: next.motionGraphic },
				},
				false,
			);
		}
	};
	const commitEditorial = (): void => {
		if (editorial && JSON.stringify(editorial) !== JSON.stringify(beat.editorial)) {
			const { shots: _shots, ...editable } = editorial;
			void submit(
				{
					type: "update_beat",
					beatId: beat.id,
					fields: { editorial: editable, motionGraphic: editorial.motionGraphic },
				},
				false,
			);
		}
	};
	const refs = [...(beat.refKeys ?? []), ...(beat.refIds ?? [])];
	return (
		<article
			id={`story-beat-${beat.id}`}
			data-story-beat-id={beat.id}
			className={`sb-author-beat${draft.selectedBeatId === beat.id ? " selected" : ""}`}
			tabIndex={-1}
			onFocus={() => draft.selectBeat(beat.id)}
			onClick={() => draft.selectBeat(beat.id)}
		>
			<header className="sb-author-beat-head">
				<div>
					<span className="sb-author-order">Beat {index + 1}</span>
					<strong>{beat.title || "Untitled beat"}</strong>
				</div>
				<div className="sb-author-tags">
					{beat.locked && <Chip tone="warn">Locked</Chip>}
					<Chip
						tone={output.status === "failed" ? "err" : output.status === "ready" ? "ok" : "plain"}
					>
						{output.status}
					</Chip>
				</div>
			</header>

			<label className="sb-author-field">
				Narration
				<Textarea
					aria-label={`Narration for ${beat.title || `beat ${index + 1}`}`}
					rows={4}
					value={local?.narration ?? beat.narration}
					disabled={beat.locked}
					onChange={(event) => draft.setTextDraft(beat.id, { narration: event.target.value })}
					onBlur={() => {
						const narration = draft.textDrafts[beat.id]?.narration;
						if (narration !== undefined && narration !== beat.narration)
							void submit({ type: "update_beat", beatId: beat.id, fields: { narration } }, false);
					}}
				/>
			</label>
			<label className="sb-author-field">
				Visual intent
				<Textarea
					aria-label={`Visual intent for ${beat.title || `beat ${index + 1}`}`}
					rows={3}
					value={local?.visualPrompt ?? beat.visualPrompt}
					disabled={beat.locked}
					onChange={(event) => draft.setTextDraft(beat.id, { visualPrompt: event.target.value })}
					onBlur={() => {
						const visualPrompt = draft.textDrafts[beat.id]?.visualPrompt;
						if (visualPrompt !== undefined && visualPrompt !== beat.visualPrompt)
							void submit(
								{ type: "update_beat", beatId: beat.id, fields: { visualPrompt } },
								false,
							);
					}}
				/>
			</label>
			{editorial && (
				<section
					className="sb-author-editorial"
					aria-label={`Editorial direction for ${beat.title || `beat ${index + 1}`}`}
				>
					<strong>Editorial direction</strong>
					<div className="sb-author-editorial-selects">
						<label>
							Purpose
							<Select
								disabled={beat.locked}
								value={editorial.purpose}
								onValueChange={(event) => {
									const purpose = STORY_EDITORIAL_PURPOSES.find((value) => value === event);
									if (purpose) updateEditorial({ ...editorial, purpose }, true);
								}}
								options={[
									...(STORY_EDITORIAL_PURPOSES.map((value) => ({ value: value, label: value })) ??
										[]),
								]}
							/>
						</label>
						<label>
							Presentation
							<Select
								disabled={beat.locked}
								value={editorial.presentation}
								onValueChange={(event) => {
									const presentation = PRESENTATION_CATEGORIES.find((value) => value === event);
									if (presentation) updateEditorial({ ...editorial, presentation }, true);
								}}
								options={[
									...(PRESENTATION_CATEGORIES.map((value) => ({ value: value, label: value })) ??
										[]),
								]}
							/>
						</label>
					</div>
					<label>
						Visual concept
						<Textarea
							rows={2}
							disabled={beat.locked}
							value={editorial.visualConcept}
							onChange={(event) =>
								updateEditorial({ ...editorial, visualConcept: event.target.value })
							}
							onBlur={commitEditorial}
						/>
					</label>
					<label>
						Novelty
						<Textarea
							rows={1}
							disabled={beat.locked}
							value={editorial.noveltyKey}
							onChange={(event) =>
								updateEditorial({ ...editorial, noveltyKey: event.target.value })
							}
							onBlur={commitEditorial}
						/>
					</label>
					<label>
						On-screen text
						<Textarea
							rows={1}
							disabled={beat.locked}
							placeholder="None"
							value={editorial.onScreenText ?? ""}
							onChange={(event) =>
								updateEditorial({ ...editorial, onScreenText: event.target.value || undefined })
							}
							onBlur={commitEditorial}
						/>
					</label>
					<label>
						SFX cue
						<Textarea
							rows={1}
							disabled={beat.locked}
							placeholder="Silence"
							value={editorial.sfxCue ?? ""}
							onChange={(event) =>
								updateEditorial({ ...editorial, sfxCue: event.target.value || null })
							}
							onBlur={commitEditorial}
						/>
					</label>
					<span>
						Infographic: {editorial.motionGraphic?.needed ? editorial.motionGraphic.kind : "none"}
					</span>
				</section>
			)}
			{editorial?.shots?.length ? (
				<section
					className="sb-author-shots"
					aria-label={`Planned visual direction for ${beat.title || `beat ${index + 1}`}`}
				>
					<header>
						<strong>Planned visual direction</strong>
						<span>
							{editorial.shots.length} shot{editorial.shots.length === 1 ? "" : "s"}
						</span>
					</header>
					{editorial.shots.map((shot) => (
						<article className="sb-author-shot" data-shot-index={shot.index} key={shot.index}>
							<div className="sb-author-shot-head">
								<span>Shot {shot.index + 1}</span>
								<Chip>{shot.role}</Chip>
							</div>
							<p>{shot.visualIntent}</p>
							{shot.bindings.length > 0 ? (
								<div className="sb-author-reference-chips">
									{shot.bindings.map((binding) => {
										const identity = bindingIdentity(binding);
										const reference = draft.references[identity];
										return (
											<span
												className={`sb-author-reference ${reference?.source ?? (binding.entityId ? "existing" : "planned")}`}
												data-reference-id={identity}
												key={identity}
											>
												<b>{reference?.label ?? identity}</b>
												<small>
													{reference?.role ?? "reference"} ·{" "}
													{reference?.source ?? (binding.entityId ? "existing" : "planned")}
												</small>
											</span>
										);
									})}
								</div>
							) : (
								<span className="sb-author-muted">No reference needed</span>
							)}
							<p className="sb-author-rationale">{shot.rationale}</p>
						</article>
					))}
				</section>
			) : null}

			<div className="sb-author-intent" aria-label="Beat direction">
				<span>
					<b>Voice</b>
					{output.voiceDirection ?? "Project voice"}
				</span>
				<span>
					<b>Pacing</b>
					{output.pacing ?? "Default"}
				</span>
				<span>
					<b>Emotion</b>
					{output.emotion ?? "Not set"}
				</span>
			</div>

			<details className="sb-author-details">
				<summary>References and generated outputs</summary>
				<div className="sb-author-ref-row">
					<Input
						aria-label={`Reference id for ${beat.title || `beat ${index + 1}`}`}
						placeholder="Reference ID"
						value={referenceId}
						onChange={(event) => setReferenceId(event.target.value)}
					/>
					<Button
						size="sm"
						variant="secondary"
						disabled={!referenceId.trim() || beat.locked || draft.pending}
						onClick={() => {
							void submit({
								type: "attach_reference",
								beatId: beat.id,
								referenceId: referenceId.trim(),
								referenceKind: "entity",
							});
							setReferenceId("");
						}}
					>
						Attach
					</Button>
				</div>
				{refs.length > 0 && (
					<div className="sb-author-tags">
						{refs.map((ref) => (
							<Chip key={ref}>{ref}</Chip>
						))}
					</div>
				)}
				{output.error && (
					<p className="sb-author-error" role="alert">
						{output.error}
					</p>
				)}
				<div className="sb-author-outputs">
					{output.images.map((image, imageIndex) => (
						<figure key={`${image.url}:${imageIndex}`}>
							<img
								src={image.url}
								alt={`Generated visual ${imageIndex + 1} for ${beat.title || "beat"}`}
							/>
							<figcaption>{image.stale ? "Stale visual" : "Current visual"}</figcaption>
						</figure>
					))}
					{output.voices.map((voice, voiceIndex) => (
						<div className="sb-author-voice" key={`${voice.url}:${voiceIndex}`}>
							<span>{voice.stale ? "Stale voice" : "Current voice"}</span>
							<AudioPreview
								src={voice.url}
								durationSec={voice.durationSec}
								label={`voice ${voiceIndex + 1} for ${beat.title || "beat"}`}
							/>
						</div>
					))}
					{!output.images.length && !output.voices.length && (
						<p className="sb-author-muted">No generated outputs yet.</p>
					)}
				</div>
			</details>

			<div
				className="sb-author-actions"
				aria-label={`Actions for ${beat.title || `beat ${index + 1}`}`}
			>
				<Button
					size="sm"
					variant="secondary"
					disabled={index === 0 || draft.pending}
					onClick={() =>
						void submit({
							type: "reorder_beat",
							beatId: beat.id,
							sectionId: section.id,
							afterBeatId: index <= 1 ? null : section.beats[index - 2]!.id,
						})
					}
				>
					Move up
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={index === section.beats.length - 1 || draft.pending}
					onClick={() =>
						void submit({
							type: "reorder_beat",
							beatId: beat.id,
							sectionId: section.id,
							afterBeatId: section.beats[index + 1]!.id,
						})
					}
				>
					Move down
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={beat.locked || draft.pending}
					onClick={split}
				>
					Split
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={index === 0 || beat.locked || section.beats[index - 1]?.locked || draft.pending}
					onClick={() =>
						void submit({
							type: "merge_beats",
							firstBeatId: section.beats[index - 1]!.id,
							secondBeatId: beat.id,
						})
					}
				>
					Merge previous
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={draft.pending}
					onClick={() =>
						void submit({ type: beat.locked ? "unlock_beat" : "lock_beat", beatId: beat.id })
					}
				>
					{beat.locked ? "Unlock" : "Lock"}
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={beat.locked || draft.pending}
					onClick={() =>
						void submit({
							type: "add_beat",
							sectionId: section.id,
							afterBeatId: beat.id,
							beat: blankBeat("New beat"),
						})
					}
				>
					Add after
				</Button>
				<Button
					size="sm"
					variant="danger"
					disabled={beat.locked || section.beats.length === 1 || draft.pending}
					onClick={() => void submit({ type: "remove_beat", beatId: beat.id })}
				>
					Remove
				</Button>
			</div>
			<div className="sb-author-assist" aria-label="Chat assistance">
				{(["rewrite", "improve", "regenerate"] as const).map((action) => (
					<Button
						key={action}
						size="sm"
						variant={action === "improve" ? "primary" : "ghost"}
						disabled={beat.locked || draft.pending}
						onClick={() => void onAssist(action, beat.id)}
					>
						{action[0]!.toUpperCase() + action.slice(1)}
					</Button>
				))}
			</div>
		</article>
	);
}

export interface StoryboardSurfaceProps {
	draft: DraftController;
	onAssist: (action: AssistAction, beatId: string) => Promise<void>;
}

export function StoryboardSurface({ draft, onAssist }: StoryboardSurfaceProps): JSX.Element {
	const [policy, setPolicy] = useState<StoryExtensionPolicy>("review_additions");
	const state = draft.storyboard;
	const phase = storyboardPhase({
		state,
		legacy: draft.legacy,
		loading: draft.loading,
		error: draft.error,
		conflict: draft.conflict,
		generatedByBeatId: draft.generatedByBeatId,
	});
	if (phase === "loading")
		return (
			<main className="sb-author-state" aria-busy="true">
				<h2>Loading storyboard…</h2>
			</main>
		);
	if (phase === "failed")
		return (
			<main className="sb-author-state">
				<h2>Storyboard unavailable</h2>
				<p>{draft.error}</p>
				<Button onClick={() => void draft.refresh()}>Try again</Button>
			</main>
		);
	if (phase === "empty")
		return (
			<main className="sb-author-state">
				<h2>Build story before production</h2>
				<p>Create first section and beat directly. Chat remains optional.</p>
				<Button
					variant="primary"
					onClick={() => void draft.submit({ type: "add_section", section: blankSection() })}
				>
					Create storyboard
				</Button>
			</main>
		);
	if (!state)
		return (
			<main className="sb-author-state">
				<h2>Storyboard unavailable</h2>
			</main>
		);

	const approved = state.approvedSnapshot;
	return (
		<main className="sb-author-view">
			<header className="sb-author-toolbar">
				<div>
					<span className="sb-author-eyebrow">Pre-production plan</span>
					<PageTitle level="sub">Storyboard</PageTitle>
					<p>Shape semantic beats here. Script and Timeline keep generated execution state.</p>
				</div>
				<Toolbar label="Plan approval" className="sb-author-approval">
					<Chip
						tone={
							phase === "conflict"
								? "err"
								: approved
									? "ok"
									: phase === "generating"
										? "info"
										: "plain"
						}
					>
						{phaseLabel(phase)}
					</Chip>
					<Select
						aria-label="Duration extension policy"
						width="auto"
						value={policy}
						onValueChange={onSelect(POLICIES, setPolicy)}
						options={[
							{ value: "review_additions", label: "Review duration additions" },
							{ value: "auto_approve_additions", label: "Auto-approve duration additions" },
						]}
					/>
					<Button
						variant="primary"
						disabled={draft.pending || Boolean(draft.conflict)}
						onClick={() => void draft.approve(policy)}
					>
						{draft.pending ? "Saving…" : "Approve draft"}
					</Button>
				</Toolbar>
			</header>

			{phase === "legacy" && (
				<div className="sb-author-banner">
					Legacy plan loaded. First edit assigns stable authoring identity.
				</div>
			)}
			{approved && (
				<div className="sb-author-banner">
					Approved revision {approved.revisionId} · {approved.approvalMode.replaceAll("_", " ")} ·{" "}
					{approved.extensionPolicy.replaceAll("_", " ")}
				</div>
			)}
			{draft.conflict && (
				<div className="sb-author-banner conflict" role="alert">
					<b>Revision conflict.</b> Server plan loaded; structural queue stopped. Review current
					plan, then retry retained text explicitly.{" "}
					<Button size="sm" variant="secondary" onClick={() => void draft.refresh()}>
						Review latest
					</Button>
				</div>
			)}
			{draft.error && (
				<div className="sb-author-banner conflict" role="alert">
					{draft.error}
				</div>
			)}

			<div className="sb-author-sections">
				{state.draft.sections.map((section, sectionIndex) => (
					<section
						className="sb-author-section"
						key={section.id}
						aria-labelledby={`story-section-${section.id}`}
					>
						<header className="sb-author-section-head">
							<label>
								Section {sectionIndex + 1}
								<Input
									id={`story-section-${section.id}`}
									defaultValue={section.title}
									aria-label={`Title for section ${sectionIndex + 1}`}
									onBlur={(event) => {
										if (event.target.value !== section.title)
											void draft.submit({
												type: "update_section",
												sectionId: section.id,
												fields: { title: event.target.value },
											});
									}}
								/>
							</label>
							<div className="sb-author-actions">
								<Button
									size="sm"
									variant="secondary"
									disabled={sectionIndex === 0 || draft.pending}
									onClick={() =>
										void draft.submit({
											type: "reorder_section",
											sectionId: section.id,
											afterSectionId:
												sectionIndex <= 1 ? null : state.draft.sections[sectionIndex - 2]!.id,
										})
									}
								>
									Move section up
								</Button>
								<Button
									size="sm"
									variant="secondary"
									disabled={sectionIndex === state.draft.sections.length - 1 || draft.pending}
									onClick={() =>
										void draft.submit({
											type: "reorder_section",
											sectionId: section.id,
											afterSectionId: state.draft.sections[sectionIndex + 1]!.id,
										})
									}
								>
									Move section down
								</Button>
								<Button
									size="sm"
									variant="secondary"
									disabled={draft.pending}
									onClick={() =>
										void draft.submit({
											type: "add_section",
											afterSectionId: section.id,
											section: blankSection("New section"),
										})
									}
								>
									Add section
								</Button>
								<Button
									size="sm"
									variant="danger"
									disabled={
										state.draft.sections.length === 1 ||
										section.beats.some((beat) => beat.locked) ||
										draft.pending
									}
									onClick={() =>
										void draft.submit({ type: "remove_section", sectionId: section.id })
									}
								>
									Remove section
								</Button>
							</div>
						</header>
						<div className="sb-author-beats">
							{section.beats.map((beat, index) => (
								<BeatCard
									key={beat.id}
									beat={beat}
									section={section}
									index={index}
									draft={draft}
									approvedRevisionId={approved?.revisionId}
									onAssist={onAssist}
								/>
							))}
						</div>
					</section>
				))}
			</div>
		</main>
	);
}

export function StoryboardView({
	projectId,
	runChat,
}: {
	projectId: string;
	runChat: (instruction: string) => Promise<unknown>;
}): JSX.Element {
	const draft = useStoryboardDraft(projectId);
	const assist = async (action: AssistAction, beatId: string): Promise<void> => {
		draft.selectBeat(beatId);
		await runChat(storyboardChatInstruction(action, beatId));
		await draft.refresh();
	};
	return <StoryboardSurface draft={draft} onAssist={assist} />;
}
