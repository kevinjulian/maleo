/* Creating, listing and removing a workspace's cloned voices.
 *
 * The workspace comes from the query scope, never from the multipart body, for
 * the same reason as the TTS and scene-image routes: a body field would let a
 * caller pick a tenant by sending different form data. Two of these tests exist
 * only to pin that.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { listVoiceClones } from "@maleo/db/voice-clone";
import { getMediaObject } from "@maleo/db/media-objects";
import { voiceCloneRoutes } from "./voice-clones.ts";
import { testApp } from "../middleware/auth-testing.ts";

const dbPath = join(
	tmpdir(),
	`voice-clones-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
);
const priorDbPath = process.env.MALEO_DB_PATH;
const priorUploads = process.env.MALEO_UPLOADS_DIR;
const uploadDir = join(tmpdir(), `voice-clone-uploads-${Date.now()}`);

const PROVIDER = "pocket-tts-id";

async function seedWorkspace(name: string): Promise<void> {
	const now = Date.now();
	await openDb().run(
		`INSERT INTO workspaces (name, display_name, workspace_dir, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
		[name, name, `/tmp/${name}`, now, now],
	);
}

function audio(type = "audio/wav", bytes = new Uint8Array([1, 2, 3, 4])): File {
	return new File([bytes as unknown as BlobPart], "voice.wav", { type });
}

function createForm(
	over: Partial<{ provider: string; label: string; gender: string; audio: File | null }> = {},
): FormData {
	const form = new FormData();
	form.set("provider", over.provider ?? PROVIDER);
	form.set("label", over.label ?? "Narrator");
	if (over.gender) form.set("gender", over.gender);
	const file = over.audio === undefined ? audio() : over.audio;
	if (file) form.set("audio", file);
	return form;
}

async function post(form: FormData, workspace = "default"): Promise<Response> {
	return await testApp(voiceCloneRoutes()).request(`/?workspace=${encodeURIComponent(workspace)}`, {
		method: "POST",
		body: form,
	});
}

async function list(workspace = "default", provider = PROVIDER): Promise<Response> {
	return await testApp(voiceCloneRoutes()).request(
		`/?workspace=${encodeURIComponent(workspace)}&provider=${encodeURIComponent(provider)}`,
	);
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	process.env.MALEO_UPLOADS_DIR = uploadDir;
	await closeMaleoDb();
	await openDb().run("DELETE FROM voice_clone");
	await seedWorkspace("default");
	await seedWorkspace("globex");
});

afterAll(async () => {
	await closeMaleoDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	if (priorUploads === undefined) delete process.env.MALEO_UPLOADS_DIR;
	else process.env.MALEO_UPLOADS_DIR = priorUploads;
	rmSync(dbPath, { force: true });
	rmSync(uploadDir, { recursive: true, force: true });
});

describe("creating a clone", () => {
	it("stores the clone and returns it with an id and the provider's language", async () => {
		const res = await post(createForm({ gender: "female" }));
		expect(res.status).toBe(201);
		const body = (await res.json()) as Record<string, unknown>;
		expect(String(body.id)).toStartWith("vc_");
		expect(body.providerId).toBe(PROVIDER);
		expect(body.label).toBe("Narrator");
		expect(body.gender).toBe("female");
		// Indonesian comes from the provider, not from the request.
		expect(body.lang).toBe("id");
		expect(String(body.refUrl)).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
	});

	it("is immediately listable, with no rebake or refresh", async () => {
		await post(createForm());
		const items = (await (await list()).json()) as { items: unknown[] };
		expect(items.items).toHaveLength(1);
	});

	it("refuses a label-less clone", async () => {
		const res = await post(createForm({ label: "" }));
		expect(res.status).toBe(400);
	});

	it("refuses a missing audio file", async () => {
		const res = await post(createForm({ audio: null }));
		expect(res.status).toBe(400);
	});

	/* The file that failed in the field: macOS reports .m4a as audio/x-m4a, and
	 * a MIME-only check refused a real recording. */
	it("accepts an m4a the browser labels audio/x-m4a", async () => {
		const m4a = new File([new Uint8Array([5, 6, 7, 8])], "Suara Kevin.m4a", {
			type: "audio/x-m4a",
		});
		const res = await post(createForm({ audio: m4a }));
		expect(res.status).toBe(201);
		const id = String((await res.json()).refUrl)
			.split("/")
			.at(-1)!;
		expect((await getMediaObject(id))?.content_type).toBe("audio/mp4");
	});

	it("accepts a recording whose type the browser could not determine", async () => {
		const unlabelled = new File([new Uint8Array([1, 2, 3, 4])], "memo.wav", { type: "" });
		expect((await post(createForm({ audio: unlabelled }))).status).toBe(201);
	});

	it("refuses audio the provider cannot take as a voice prompt", async () => {
		const notAudio = new File([new Uint8Array([1, 2]) as unknown as BlobPart], "x.pdf", {
			type: "application/pdf",
		});
		const res = await post(createForm({ audio: notAudio }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("unsupported_audio_type");
		// The supported list, not the type we rejected: "application/pdf is
		// unsupported" tells an operator nothing they can act on.
		expect(body.supported).toContain("m4a");
	});

	it("refuses an empty audio file", async () => {
		const empty = new File([new Uint8Array(0) as unknown as BlobPart], "voice.wav", {
			type: "audio/wav",
		});
		const res = await post(createForm({ audio: empty }));
		expect(res.status).toBe(400);
	});

	it("refuses an unknown provider", async () => {
		const res = await post(createForm({ provider: "nope" }));
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("unknown_tts_provider");
	});

	/* Kokoro speaks its own declared voices and cannot imitate a recording. A
	 * clone minted for it would be a voice nothing can ever use. */
	it("refuses a provider that does not clone", async () => {
		const res = await post(createForm({ provider: "kokoro" }));
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("provider_does_not_clone");
	});
});

describe("workspace ownership", () => {
	it("does not let the body pick the tenant", async () => {
		const form = createForm();
		form.set("workspace", "globex");
		const res = await post(form, "default");
		expect(res.status).toBe(201);
		expect(await listVoiceClones("default", PROVIDER)).toHaveLength(1);
		expect(await listVoiceClones("globex", PROVIDER)).toHaveLength(0);
	});

	it("hides one workspace's clones from another", async () => {
		await post(createForm(), "default");
		const items = (await (await list("globex")).json()) as { items: unknown[] };
		expect(items.items).toHaveLength(0);
	});

	it("refuses an unregistered workspace rather than serving default's", async () => {
		const res = await list("nosuchtenant");
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("unknown_workspace");
	});
});

describe("listing", () => {
	it("requires a provider, because a clone belongs to the model that speaks it", async () => {
		const res = await testApp(voiceCloneRoutes()).request("/?workspace=default");
		expect(res.status).toBe(400);
	});

	it("does not list a clone under another provider", async () => {
		await post(createForm());
		const items = (await (await list("default", "kokoro")).json()) as { items: unknown[] };
		expect(items.items).toHaveLength(0);
	});
});

describe("removal", () => {
	it("hides the clone from listings", async () => {
		const created = (await (await post(createForm())).json()) as { id: string };
		const res = await testApp(voiceCloneRoutes()).request(`/${created.id}?workspace=default`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);
		const items = (await (await list()).json()) as { items: unknown[] };
		expect(items.items).toHaveLength(0);
	});

	it("reports a second removal as finding nothing", async () => {
		const created = (await (await post(createForm())).json()) as { id: string };
		await testApp(voiceCloneRoutes()).request(`/${created.id}?workspace=default`, {
			method: "DELETE",
		});
		const again = await testApp(voiceCloneRoutes()).request(`/${created.id}?workspace=default`, {
			method: "DELETE",
		});
		expect(again.status).toBe(404);
	});

	it("does not let another workspace remove a clone it cannot see", async () => {
		const created = (await (await post(createForm(), "default")).json()) as { id: string };
		const res = await testApp(voiceCloneRoutes()).request(`/${created.id}?workspace=globex`, {
			method: "DELETE",
		});
		expect(res.status).toBe(404);
		expect(await listVoiceClones("default", PROVIDER)).toHaveLength(1);
	});
});
