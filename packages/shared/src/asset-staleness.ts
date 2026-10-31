/* Whether a generated asset still matches the text or prompt it came from.
 *
 * Nothing recorded WHAT produced an asset before this. `mediaAssetId` says which
 * asset a scene uses and `seed` records the sampling input, but neither notices
 * that the narration has been rewritten since — so a scene could show a frame of
 * a prompt nobody wrote any more, or speak words that are no longer on the page,
 * with nothing in the document able to tell.
 *
 * The fix is to hash the inputs at the moment an asset is admitted and compare
 * that hash against the current inputs on read. One direction only: text produces
 * an asset, and prose is never derived back from a waveform.
 *
 * Absence reads as FRESH, never stale. Every asset generated before hashes
 * existed carries none, and reporting those as stale would mark whole back
 * catalogues for regeneration — which spends credits to fix nothing.
 */

/* ── The digest ──
 *
 * Change detection, not security: a collision costs a stale asset read as fresh,
 * not an exploit, so this is a fast non-cryptographic hash rather than SHA. What
 * it must be is STABLE — the same inputs must hash the same across processes and
 * releases, or every asset in the library reads as stale after a deploy.
 */

/** Fold one string into two accumulators. cyrb53, whose two lanes give ~53 bits
 *  of output — enough that an accidental collision between two prompts is not a
 *  thing that happens in a project's lifetime. */
function digest(parts: readonly string[]): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (const part of parts) {
		for (let i = 0; i < part.length; i += 1) {
			const ch = part.charCodeAt(i);
			h1 = Math.imul(h1 ^ ch, 2654435761);
			h2 = Math.imul(h2 ^ ch, 1597334677);
		}
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Every field, LENGTH-PREFIXED, in one fixed order.
 *
 *  Both halves matter. Fixed order is why reordering the fields of an inputs
 *  object cannot change the hash — the object's key order is never read. Length
 *  prefixes are why `("ab", "c")` cannot hash the same as `("a", "bc")`: without
 *  them, a prompt ending in the separator would be indistinguishable from the
 *  next field beginning, and two different generations would read as identical. */
function fields(values: readonly (string | number | undefined)[]): string[] {
	return values.map((value) => {
		/* Absent is not empty. "no speaker chosen" and "speaker set to the empty
		 * string" are different inputs, and encoding both as a zero-length field
		 * would let one read as the other — which is a stale asset reported fresh.
		 * The sentinel cannot be confused with a real field, because a real one
		 * always begins with a digit. */
		if (value === undefined) return "~";
		const text = String(value);
		return `${text.length}:${text}`;
	});
}

export function stableInputHash(values: readonly (string | number | undefined)[]): string {
	return digest(fields(values));
}

/** What a generated motion composition was authored from (motion-design-generation).
 *  Equal inputs may share one composition; any change asks for a new one. */
export interface MotionInputHashInput {
	sourceText: string;
	presentation: string;
	startSec: number;
	durationSec: number;
	aspect: string;
	visualStyle?: string;
}

export function motionInputHash(input: MotionInputHashInput): string {
	return stableInputHash([
		"motion:v1",
		input.sourceText,
		input.presentation,
		Math.round(input.startSec * 1000),
		Math.round(input.durationSec * 1000),
		input.aspect,
		input.visualStyle,
	]);
}

export interface StorySpeechHashInput {
	narration: string;
	voice?: string;
	provider?: string;
	language?: string;
	delivery?: string;
}

export function storySpeechInputHash(input: StorySpeechHashInput): string {
	return stableInputHash([
		"story-speech-v1",
		input.narration,
		input.voice,
		input.provider,
		input.language,
		input.delivery,
	]);
}

export interface StoryVisualHashInput {
	speechHash: string;
	visualPrompt: string;
	plannedShots?: readonly string[];
	referenceIds?: readonly string[];
	style?: string;
	visualDirection?: string;
	rules?: string;
	editorialDirection?: string;
}

export function storyVisualInputHash(input: StoryVisualHashInput): string {
	return stableInputHash([
		"story-visual-v1",
		input.speechHash,
		input.visualPrompt,
		[...(input.plannedShots ?? [])].join("\u0000"),
		[...(input.referenceIds ?? [])].sort().join("\u0000"),
		input.style,
		input.visualDirection,
		input.rules,
		input.editorialDirection,
	]);
}

/* What direction was decided against. Approval recomputes this against the live
 * draft and roster: a plan parked while an entity was detached from the roster
 * must re-direct rather than approve bindings that no longer resolve. */
export interface StoryDirectionInputFingerprint {
	narrations: readonly string[];
	plannedShots: readonly (readonly string[])[];
	rosterIds: readonly string[];
	materials?: string;
	templateConstraints?: string;
}

export function storyDirectionInputFingerprint(input: StoryDirectionInputFingerprint): string {
	return stableInputHash([
		/* Deliberately no revision or plan id. A revision id changes on every
		 * command, including a title edit that direction does not care about; a plan
		 * id from `canonicalizeLegacyStoryPlan` is minted fresh per call, so a plan
		 * without persisted generation state could never match its own fingerprint
		 * and was refused approval forever. The content below is the input. */
		"story-direction-inputs-v1",
		digest(fields(input.narrations)),
		digest(fields(input.plannedShots.map((shots) => digest(fields(shots))))),
		[...input.rosterIds].sort().join("\u0000"),
		input.materials,
		input.templateConstraints,
	]);
}

export function storyFrameInputHash(
	input: StoryVisualHashInput & { authoredVisual: string },
): string {
	return stableInputHash(["story-frame-v1", storyVisualInputHash(input), input.authoredVisual]);
}

export interface StoryAssetStaleness {
	speech: boolean;
	captions: boolean;
	timing: boolean;
	visuals: boolean;
	frames: boolean;
}

export function storyAssetStaleness(
	section: { speechInputHash?: string; visualInputHash?: string; frameInputHash?: string },
	current: { speechHash: string; visualHash: string; frameHash: string },
): StoryAssetStaleness {
	const speech =
		section.speechInputHash !== undefined && section.speechInputHash !== current.speechHash;
	const visuals =
		speech ||
		(section.visualInputHash !== undefined && section.visualInputHash !== current.visualHash);
	const frames =
		visuals ||
		(section.frameInputHash !== undefined && section.frameInputHash !== current.frameHash);
	return { speech, captions: speech, timing: speech, visuals, frames };
}

/* ── Deriving the inputs from a scene ──
 *
 * There is more than one place an asset is admitted — the editor generates a
 * frame per scene, and an agent run merges a whole storyboard — so the rule that
 * matters is not "one call site" but "one derivation". Admission and the later
 * staleness check both go through the functions below, which read the SCENE's own
 * fields rather than whatever composed string a generator happened to send. Hash
 * the composed prompt at admission and the raw field at check, and every asset
 * reads as stale forever.
 */

/** Project-level inputs a scene does not carry itself. */
export interface SceneHashContext {
	provider?: string;
	speed?: number;
	stylePreset?: string;
}

/** The hash of what produced this scene's speech, from the scene's own fields. */
export function sceneSpeechHash(
	scene: { vo?: string; castId?: string; voiceId?: string },
	ctx: SceneHashContext = {},
): string {
	return digest(fields([scene.vo ?? "", scene.castId, scene.voiceId, ctx.provider, ctx.speed]));
}

/** The hash of what produced this scene's frame, from the scene's own fields. */
export function sceneFrameHash(
	scene: { vis?: string; refIds?: readonly string[]; seed?: number },
	ctx: SceneHashContext = {},
): string {
	/* Sorted, because the same references are the same input in any order — an
	 * editor that reorders a selection has not changed what was generated. */
	const refs = [...(scene.refIds ?? [])].sort().join(",");
	return digest(fields([scene.vis ?? "", refs, scene.seed, ctx.stylePreset]));
}

/** True when what is recorded no longer matches what the inputs now are.
 *
 *  A scene with no recorded hash is fresh: nothing was recorded, so nothing
 *  disagrees. That is the whole of the back-catalogue rule. */
function isStale(recorded: string | undefined, current: string): boolean {
	return recorded !== undefined && recorded !== current;
}

/** True when a scene's generated speech no longer matches its narration. */
export function speechIsStale(
	scene: { vo?: string; castId?: string; voiceId?: string; speechInputHash?: string },
	ctx: SceneHashContext = {},
): boolean {
	return isStale(scene.speechInputHash, sceneSpeechHash(scene, ctx));
}

/** One scene whose generated assets no longer match what it now says. */
export interface StaleScene {
	id: number;
	name: string;
	speech: boolean;
	frame: boolean;
}

/** Every scene carrying an asset that no longer matches its inputs.
 *
 *  What a render REPORTS, never what stops one. Blocking would be safer and much
 *  more annoying: an operator who knows a frame is a little out of date and wants
 *  the cut anyway is not making a mistake. The list is the whole obligation — say
 *  what is stale, then render what was asked for. */
export function staleScenes(
	scenes: readonly {
		id: number;
		name?: string;
		vo?: string;
		castId?: string;
		voiceId?: string;
		vis?: string;
		refIds?: readonly string[];
		seed?: number;
		speechInputHash?: string;
		frameInputHash?: string;
	}[],
	ctx: SceneHashContext = {},
): StaleScene[] {
	const out: StaleScene[] = [];
	for (const scene of scenes) {
		const speech = speechIsStale(scene, ctx);
		const frame = frameIsStale(scene, ctx);
		if (speech || frame)
			out.push({ id: scene.id, name: scene.name ?? `Scene ${scene.id}`, speech, frame });
	}
	return out;
}

/** True when a scene's generated frame no longer matches its visual prompt. */
export function frameIsStale(
	scene: { vis?: string; refIds?: readonly string[]; seed?: number; frameInputHash?: string },
	ctx: SceneHashContext = {},
): boolean {
	return isStale(scene.frameInputHash, sceneFrameHash(scene, ctx));
}
