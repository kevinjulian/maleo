/* An agent edit to an existing timeline, as an editor command
 * (`move-agent-tools-to-editor-commands`).
 *
 * The run's document is projected from the job (`agentTimelineDoc`), the command
 * executes against it in the Rust engine — the executor the web editor uses
 * (`migrate-editor-to-shared-rust-core` 4.6) — and the result is read back
 * into the job's families with the readers seeding already uses. Generation tools
 * keep reading and writing the job, so a run that does both sees one state.
 *
 * The executed commands are recorded on the job in order. A settled run that made
 * no other document change carries them, and the editor applies exactly those. */
import {
	agentSceneFromScene,
	fromTimelineDoc,
	referencesPendingMedia,
	type Clip,
	type EntityFingerprint,
	type TimelineDoc,
} from "@maleo/shared";
import { batch, insertClip, type EditorCommand, type EditScope } from "@maleo/shared/editor";
import { editorEngine } from "../../../lib/editor-engine.ts";
import { agentTimelineDoc } from "./document.ts";
import { overlaysFromV2Clips } from "./persistence.ts";
import type { AgentJob, AgentScene } from "./model.ts";

type JobFamilies = Pick<AgentJob, "scenes" | "textOverlays" | "videoOverlays" | "audioOverlays">;

/* Clips the agent does not own: the same rule run-bracket.ts seeds `clientClips` by. */
const isClientClip = (clip: Clip): boolean =>
	clip.type === "effect" ||
	clip.type === "transition" ||
	clip.type === "caption" ||
	clip.id.startsWith("vis:");

/** The job's families a document projects back to — the inverse of
 *  `agentEditorViews`. A scene field the document has no slot for (`audioUrl`,
 *  `transitionLocked`) is the run's own, carried from the prior scene of the same id. */
export function jobFamiliesOf(doc: TimelineDoc, prior: readonly AgentScene[]): JobFamilies {
	const priorById = new Map(
		prior.flatMap((scene) => (scene.id === undefined ? [] : [[scene.id, scene] as const])),
	);
	const scenes = fromTimelineDoc(doc).scenes.map((scene): AgentScene => ({
		...priorById.get(scene.id),
		...agentSceneFromScene(scene),
	}));
	return { scenes, ...overlaysFromV2Clips(doc.clips.filter((clip) => !isClientClip(clip))) };
}

/** The run's document, for building a command against. An agent-created scene is
 *  minted the same id here every time until an edit writes it back to the job. */
export function runDocument(job: AgentJob): TimelineDoc {
	return agentTimelineDoc(job, job.clientClips ?? []);
}

/* What each family's index numbers, and the label an error names it by. The order
 * is the job's own, which is what `view_timeline` lists and the document projects. */
const FAMILIES = {
	scene: { prefix: "scene:", label: "scene" },
	text: { prefix: "text:", label: "text overlay" },
	video: { prefix: "video:", label: "overlay clip" },
	audio: { prefix: "audio:", label: "audio clip" },
} as const;
export type EditFamily = keyof typeof FAMILIES;

/** The run document's clip at a family index, or an error naming the index. */
export function clipAt(doc: TimelineDoc, family: EditFamily, index: number): Clip {
	const { prefix, label } = FAMILIES[family];
	const clip = doc.clips.filter((c) => c.id.startsWith(prefix))[index];
	if (!clip) throw new Error(`No ${label} at index ${index}`);
	return clip;
}

/* A file still uploading is the editor's alone: no agent edit creates, changes or
 * removes a clip that references one. */
function touchesPendingMedia(
	before: TimelineDoc,
	after: TimelineDoc,
	pendingIds: readonly string[],
): boolean {
	const pending = (doc: TimelineDoc) =>
		new Map(
			doc.clips
				.filter((clip) => referencesPendingMedia(clip, pendingIds))
				.map((clip) => [clip.id, JSON.stringify(clip)]),
		);
	const was = pending(before),
		now = pending(after);
	return (
		[...was].some(([id, clip]) => now.get(id) !== clip) ||
		[...now.keys()].some((id) => !was.has(id))
	);
}

export type EditOutcome = { ok: true } | { ok: false; error: string };

/** Execute one editor command against the run's document and record it. A command
 *  the executor refuses, or one that changes nothing, leaves the job exactly as it was. */
export function executeEdit(job: AgentJob, command: EditorCommand): EditOutcome {
	const doc = runDocument(job);
	const before: EditScope = { mediaAssets: [], doc, slides: [], posts: [] };
	// Executing computes the inverse too, which is the check that what the command
	// acts on exists (a removed clip must be in `before`).
	const executed = editorEngine().executeOnce(JSON.stringify(before), JSON.stringify(command));
	if (!executed.ok) return { ok: false, error: executed.error.message };
	// SAFETY: `{scope, inverse}` as the engine writes it; the scope is the admitted one, edited.
	const after = (JSON.parse(executed.value) as { scope: EditScope }).scope;
	if (touchesPendingMedia(doc, after.doc, job.pendingMediaIds ?? []))
		return {
			ok: false,
			error:
				"That clip uses a file that is still uploading; it can be edited once the upload finishes",
		};
	// Recording a command that changes nothing would hand the editor an edit that is not there.
	if (JSON.stringify(after.doc) === JSON.stringify(doc))
		return { ok: false, error: `${command.type} changed nothing` };
	const families = jobFamiliesOf(after.doc, job.scenes);
	job.scenes = families.scenes;
	job.textOverlays = families.textOverlays;
	job.videoOverlays = families.videoOverlays;
	job.audioOverlays = families.audioOverlays;
	job.editorScenes = fromTimelineDoc(after.doc).scenes;
	if (job.clientClips) job.clientClips = after.doc.clips.filter(isClientClip);
	job.clientCaptionSet = after.doc.captionSet;
	job.editCommands = [...(job.editCommands ?? []), command];
	return { ok: true };
}

type Placements = Pick<AgentJob, "textOverlays" | "videoOverlays" | "audioOverlays">;

/** Place one more overlay of a family: the clip the job's projection builds for
 *  it, inserted through `executeEdit`. */
export function placeOverlay<K extends keyof Placements>(
	job: AgentJob,
	family: K,
	overlay: Placements[K][number],
): void {
	const existing = new Set(runDocument(job).clips.map((clip) => clip.id));
	const projected = agentTimelineDoc(
		{ ...job, [family]: [...job[family], overlay] },
		job.clientClips ?? [],
	);
	const clip = projected.clips.find((c) => !existing.has(c.id));
	if (!clip) throw new Error(`placing a ${family} clip produced no new clip`);
	runEdit(job, insertClip(clip));
}

/** Place several overlays of one family as ONE batch command, so the editor
 *  records them as one undo step (motion design places a clip per layer). */
export function placeOverlays<K extends keyof Placements>(
	job: AgentJob,
	family: K,
	overlays: Placements[K],
	label?: string,
): void {
	const existing = new Set(runDocument(job).clips.map((clip) => clip.id));
	const projected = agentTimelineDoc(
		{ ...job, [family]: [...job[family], ...overlays] },
		job.clientClips ?? [],
	);
	const clips = projected.clips.filter((c) => !existing.has(c.id));
	if (clips.length !== overlays.length)
		throw new Error(`placing ${overlays.length} ${family} clips produced ${clips.length}`);
	runEdit(
		job,
		batch(
			clips.map((clip) => insertClip(clip)),
			label,
		),
	);
}

/** What a run carries to the editor for its edits: every command its editing tools
 *  executed, as long as nothing else wrote the job, and the fingerprints of the
 *  document it started from to fence them against. Empty otherwise, and the editor
 *  merges the run whole. Sent while the run works too, so the editor knows not to
 *  preview. */
export interface RunCommandWire {
	commands?: EditorCommand[];
	commandBase?: EntityFingerprint[];
	/** The commands could not be saved onto the latest document; see `edit-rebase.ts`. */
	commandConflict?: string;
	/** The run that executed them: what a saved version's `agentEdit` marker names. */
	commandRun?: string;
}

export function runCommandWire(job: AgentJob): RunCommandWire {
	if (job.run?.jobWrites || !job.editCommands?.length) return {};
	return {
		commands: job.editCommands,
		commandRun: job.id,
		...(job.baseFingerprints ? { commandBase: job.baseFingerprints } : {}),
		...(job.editConflict ? { commandConflict: job.editConflict } : {}),
	};
}

/** `executeEdit` for a tool: a refusal becomes the tool's error. */
export function runEdit(job: AgentJob, command: EditorCommand): void {
	const outcome = executeEdit(job, command);
	if (!outcome.ok) throw new Error(outcome.error);
}
