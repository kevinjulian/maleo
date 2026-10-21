/* Cloned voices — the workspace's own voices, created from a recording.
 *
 * The reference audio receives a workspace-owned stable media URL, which the
 * worker resolves through the internal media route. The clone row is the
 * voice: `id` is what a selection stores, and nothing here hands the audio
 * location to a surface that binds a voice.
 *
 * The workspace comes from `workspaceScope()`, never from the multipart body. A
 * body field would let a caller pick a tenant by sending different form data —
 * the same rule the scene-image and TTS routes already follow.
 */
import { Hono } from "hono";
import { getProvider } from "@maleo/media/providers";
import { VOICE_CLONE_AUDIO_EXTENSIONS, voiceCloneAudioFormat, textOf } from "@maleo/shared";
import { createVoiceClone, listVoiceClones, softDeleteVoiceClone } from "@maleo/db/voice-clone";
import { activeWorkspace, workspaceScope } from "../lib/active-workspace.ts";
import { storeManagedMedia } from "../lib/media-storage.ts";

/* Which containers are accepted lives in `@maleo/shared` because the picker
 * and the form's hint read the same list. A format outside it is refused at
 * upload rather than at synthesis, where it would already have cost a
 * generation. */

/* 25 MB. A voice prompt is seconds of speech, not a recording session; the cap
 * is generous for that and small enough that a mistaken video upload is refused
 * rather than stored. */
const MAX_PROMPT_BYTES = 25 * 1024 * 1024;

export function voiceCloneRoutes(): Hono {
	const app = new Hono();
	app.use("*", workspaceScope());

	/* One provider's clones for this workspace. The provider is required rather
	 * than defaulted: a clone belongs to the model that can speak it, and a
	 * listing that spanned providers would offer voices that fail at the point of
	 * use under whichever one is effective. */
	app.get("/", async (c) => {
		const providerId = c.req.query("provider")?.trim();
		if (!providerId) return c.json({ error: "provider is required" }, 400);
		return c.json({ items: await listVoiceClones(activeWorkspace(c), providerId) });
	});

	app.post("/", async (c) => {
		const workspace = activeWorkspace(c);
		const form = await c.req.formData().catch(() => null);
		if (!form) return c.json({ error: "multipart body required" }, 400);

		const providerId = textOf(form.get("provider")).trim();
		const label = textOf(form.get("label")).trim();
		const genderField = textOf(form.get("gender")).trim();
		const file = form.get("audio");

		if (!providerId) return c.json({ error: "provider is required" }, 400);
		if (!label) return c.json({ error: "label is required" }, 400);

		/* The provider must exist AND clone. Offering to create a clone for a
		 * provider that speaks only its own declared voices would mint a voice
		 * nothing can ever use. */
		const provider = getProvider(providerId);
		if (!provider?.meta.tts)
			return c.json({ error: "unknown_tts_provider", provider: providerId }, 400);
		if (provider.meta.tts.voiceSource !== "cloned") {
			return c.json({ error: "provider_does_not_clone", provider: providerId }, 400);
		}
		/* A cloning provider with no declared language is a misconfigured provider,
		 * not a clone to guess a language for: every voice it minted would be filed
		 * under a language its model does not speak. */
		const lang = provider.meta.tts.language?.trim();
		if (!lang) return c.json({ error: "provider_declares_no_language", provider: providerId }, 500);

		if (!(file instanceof File)) return c.json({ error: "audio file is required" }, 400);
		/* Resolved by extension first. A browser's type for one container differs
		 * by platform — macOS calls `.m4a` `audio/x-m4a` where others say
		 * `audio/mp4` — so matching on type alone refused real recordings. */
		const format = voiceCloneAudioFormat(file.name, file.type);
		if (!format) {
			return c.json(
				{
					error: "unsupported_audio_type",
					filename: file.name,
					type: file.type,
					supported: VOICE_CLONE_AUDIO_EXTENSIONS,
				},
				400,
			);
		}
		const ext = format.ext;
		if (file.size === 0) return c.json({ error: "audio file is empty" }, 400);
		if (file.size > MAX_PROMPT_BYTES) {
			return c.json({ error: "audio_too_large", limit: MAX_PROMPT_BYTES, size: file.size }, 413);
		}

		const contentType = ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : `audio/${ext}`;
		const refUrl = await storeManagedMedia({
			workspace,
			kind: "audio",
			body: file,
			contentType,
			filename: file.name,
		});

		const gender = genderField === "male" || genderField === "female" ? genderField : null;
		const clone = await createVoiceClone({
			workspace,
			providerId,
			label,
			/* The provider's language, not the caller's: a cloning provider is
			 * language-locked by its weights, and a caller-supplied tag could only
			 * contradict what the model will actually speak. */
			lang,
			gender,
			refUrl,
		});
		return c.json(clone, 201);
	});

	/* A hide, not a delete. A metered synthesis names this voice, and tidying a
	 * library must not make that spend unattributable. */
	app.delete("/:id", async (c) => {
		const removed = await softDeleteVoiceClone(activeWorkspace(c), c.req.param("id"));
		if (!removed) return c.json({ error: "not_found" }, 404);
		return c.json({ ok: true });
	});

	return app;
}
