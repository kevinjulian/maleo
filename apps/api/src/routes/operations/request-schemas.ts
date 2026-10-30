/* Request-body schemas for the operations routes.
 *
 * Each mirrors the shape its handler already declared, because that declaration
 * IS what the handler reads — it was simply never checked. Handlers keep their
 * own semantic tests (`!body.title?.trim()`, a status set membership) since
 * those produce specific messages; the schema decides only whether the value is
 * the kind of thing the handler believes it received.
 *
 * `Record<string, unknown>` survives where the field is a JSON column travelling
 * to storage — `brief_json`, `payload_json`, `content_json`, `meta_json`,
 * `budget_json`, `storyboard_json`, `editor_state`. Those are the wire form of a
 * stored document and have no value contract, which is the cause
 * `oxlint.config.ts` already scopes this directory for.
 */
import { z } from "zod";
import {
	storyboardCommandSchema,
	CaptionSetSchema,
	storyClarificationSubmissionSchema,
	storyExtensionPolicySchema,
	textSelectionSchema,
} from "@maleo/shared";

const jsonObject = z.record(z.string(), z.unknown());
const nullableString = z.string().nullable();
const contentType = z.enum(["video", "image", "text"]);

/* --- generation ---------------------------------------------------------- */

export const storyboardCommandBody = z
	.object({
		expectedRevisionId: z.string().min(1),
		command: storyboardCommandSchema,
	})
	.strict();

export const storyboardApprovalBody = z
	.object({
		expectedRevisionId: z.string().min(1),
		extensionPolicy: storyExtensionPolicySchema,
	})
	.strict();

/* `scenes`, `slides` and `posts` are arrays of the agent's own document types,
 * which have no schema yet. Declared `unknown[]` rather than as dictionaries,
 * because "an array of things this schema has not described" is true and
 * "an array of dictionaries" is a claim about their shape that nothing checked. */
/* A chat command: the document it edits, plus the envelope describing what it
 * was told. The prompt inputs that used to sit loose at this level — brief,
 * aspect, direction, materials, project references, and a twelve-field `context`
 * bag — now live inside the envelope, validated as one shape by one schema. */
export const agentRunBody = z
	.object({
		instruction: z.string(),
		text_selection: textSelectionSchema,
		scenes: z.array(z.unknown()),
		style_image_url: z.string(),
		clips: z.array(jsonObject),
		captionSet: CaptionSetSchema,
		content_type: contentType,
		slides: z.array(z.unknown()),
		posts: z.array(z.unknown()),
		/* The typed context envelope. Validated by the compiler rather than here:
		 * one malformed memory entry must not reject the whole request, and this
		 * boundary cannot express "drop the bad entry, keep the rest". */
		envelope: z.unknown(),
	})
	.partial();

/* `answer` is the legacy string every other gate still sends. `batch_answer` is
 * the structured submission a pre-research story clarification card sends; both
 * are optional, so an old client and a new one both parse. */
export const answerBody = z
	.object({
		answer: z.string(),
		action_id: z.string(),
		batch_answer: storyClarificationSubmissionSchema,
	})
	.partial();

export const editVideoBody = z
	.object({
		scenes: z.array(z.unknown()),
		instruction: z.string(),
		audience: z.string(),
		format: z.string(),
	})
	.partial();

/* --- references ---------------------------------------------------------- */

export const projectNoteBody = z
	.object({
		label: z.string(),
		body: z.string(),
		tags: z.unknown(),
		is_default: z.boolean(),
	})
	.partial();

export const attachEntityBody = z.object({ entity_id: z.string() }).partial();
export const primaryEntityBody = z.object({ entity_id: z.string().nullable() }).partial();
export const referenceEntityBody = z
	.object({
		role: z.string(),
		label: z.string(),
		description: z.string(),
		imageUrl: z.string().nullable(),
		tags: z.array(z.string()),
		origin: z.string(),
	})
	.partial();

/* --- projects ------------------------------------------------------------ */

/* Writes accept video only. Image and text projects are retired: existing ones
 * still load and save by hand (their type is never sent back on update), but no
 * project may be created as, or turned into, either. */
const projectType = z.enum(["video"]);
const projectStatus = z.enum(["brief", "storyboard", "assets", "rendering", "ready", "archived"]);

const projectFields = {
	title: z.string(),
	type: projectType,
	status: projectStatus,
	target_platform: nullableString,
	target_audience: nullableString,
	target_duration_sec: z.number().nullable(),
	target_format: nullableString,
	language: nullableString,
	campaign_id: nullableString,
	reference_notes: nullableString,
	brief_json: jsonObject.nullable(),
};

/* A seeded output and a seeded speaker are rows the handler reads field by
 * field, not opaque JSON columns — so they get a shape here rather than
 * `jsonObject`. The handler keeps its own `?? ""` defaults and its filters,
 * because those decide which rows are worth creating; the schema only says what
 * kind of thing each field is. Every field is optional, since the handler
 * already defaults each one. */
const seedOutputRow = z
	.object({
		channel: nullableString,
		platform: nullableString,
		kind: z.string(),
		title: z.string(),
		status: z.string(),
		notes: nullableString,
		content_json: jsonObject.nullable(),
	})
	.partial()
	.passthrough();

const seedSpeakerRow = z
	.object({
		voice_key: z.string(),
		name: z.string(),
		hue: z.number().nullable(),
		is_default: z.boolean(),
	})
	.partial()
	.passthrough();

export const createProjectBody = z
	.object({
		...projectFields,
		editor_state: jsonObject.nullable(),
		speakers: z.array(seedSpeakerRow),
		reference_entity_ids: z.unknown(),
		lead_entity_id: z.unknown(),
		seed_storyboard: z
			.object({
				source_prompt: nullableString,
				reference_notes: nullableString,
				status: z.string(),
				storyboard_json: jsonObject,
			})
			.partial()
			.nullable(),
		seed_outputs: z.array(seedOutputRow),
	})
	.partial();

export const patchProjectBody = z.object(projectFields).partial();
export const editorStateBody = z.object({ editor_state: jsonObject });

/* --- events -------------------------------------------------------------- */

export const feedbackBody = z
	.object({
		action: z.string(),
		run_id: z.string(),
		target_ref: z.string(),
	})
	.partial();

export const recordEventBody = z
	.object({
		output_id: nullableString,
		storyboard_id: nullableString,
		actor_type: z.string(),
		actor_id: nullableString,
		kind: z.string(),
		summary: z.string(),
		payload_json: jsonObject.nullable(),
	})
	.partial();

/* --- campaigns ----------------------------------------------------------- */

const campaignStatus = z.enum(["draft", "active", "paused", "done", "archived"]);

export const createCampaignBody = z
	.object({
		name: z.string(),
		goal: z.string(),
		status: campaignStatus,
		workspaces: z.array(z.string()),
		budget_json: jsonObject.nullable(),
		start_at: z.number().nullable(),
		end_at: z.number().nullable(),
	})
	.partial();

export const patchCampaignBody = z
	.object({
		name: z.string(),
		goal: z.string(),
		status: campaignStatus,
		workspaces: z.array(z.string()),
	})
	.partial();

/* --- storyboards --------------------------------------------------------- */

export const restoreStoryboardBody = z
	.object({ expectedRevisionId: z.string().min(1).nullable() })
	.strict();

export const createStoryboardBody = z
	.object({
		expectedCaptionState: z.string().regex(/^[a-f0-9]{16}$/),
		source_prompt: nullableString,
		reference_notes: nullableString,
		status: z.string(),
		storyboard_json: jsonObject,
	})
	.partial();

/* --- outputs ------------------------------------------------------------- */

const outputFields = {
	storyboard_id: nullableString,
	channel: nullableString,
	platform: nullableString,
	kind: z.string(),
	title: z.string(),
	status: z.string(),
	draft_id: nullableString,
	render_id: nullableString,
	publish_job_id: nullableString,
	content_json: jsonObject.nullable(),
	notes: nullableString,
};
export const createOutputBody = z.object(outputFields).partial();
export const patchOutputBody = z.object(outputFields).partial();

/* --- renders ------------------------------------------------------------- */

export const createRenderBody = z
	.object({
		output_id: nullableString,
		storyboard_id: nullableString,
		draft_id: nullableString,
		video_job_id: nullableString,
		status: z.string(),
		phase: nullableString,
		duration_sec: z.number().nullable(),
	})
	.partial();

/* --- assets -------------------------------------------------------------- */

export const createAssetBody = z
	.object({
		scope: z.enum(["workspace", "campaign", "project"]),
		campaign_id: nullableString,
		project_id: nullableString,
		workspace: nullableString,
		kind: z.string(),
		label: z.string(),
		tags: z.array(z.string()),
		note: nullableString,
		seed: z.number(),
		default: z.boolean(),
		src: z.string(),
		source_type: z.string(),
		source_ref: nullableString,
		collection: nullableString,
		item_id: nullableString,
		meta_json: jsonObject.nullable(),
	})
	.partial();

/* --- project command log ------------------------------------------------- */

/* The command itself is admitted by the engine, which owns the vocabulary and
 * names what it refuses; the schema checks only the envelope. */
export const submitCommandsBody = z
	.object({
		baseSeq: z.number().int().min(0),
		commands: z
			.array(
				z
					.object({
						clientCommandId: z.string().min(1).max(200),
						command: z.object({ type: z.string().min(1) }).passthrough(),
					})
					.strict(),
			)
			.min(1)
			.max(500)
			.refine(
				(commands) => new Set(commands.map((c) => c.clientCommandId)).size === commands.length,
				"client command ids repeat",
			),
	})
	.strict();

export const presentationPatchBody = z
	.object({
		pacingDevices: jsonObject.nullable().optional(),
		presentation: jsonObject.nullable().optional(),
	})
	.strict();
