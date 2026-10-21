import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolveUploadFilePath } from "./upload-files.ts";
import {
	SAMPLE_TEXT,
	SAMPLE_TEXT_VERSION,
	voiceSampleFilename,
	voiceSampleUrl,
	withVoiceSampleUrl,
} from "./voice-samples.ts";

const UPLOADS = "public/uploads";
const written: string[] = [];

/** Bake a fake sample so `voiceSampleUrl` can find it. Returns the filename so
 *  the test can assert on the exact name the resolver looked for. */
function bakeFixture(provider: string, voiceId: string, ext: string): string {
	const name = voiceSampleFilename(provider, voiceId, ext);
	mkdirSync(UPLOADS, { recursive: true });
	writeFileSync(`${UPLOADS}/${name}`, "fake audio");
	written.push(`${UPLOADS}/${name}`);
	return name;
}

afterEach(() => {
	for (const path of written.splice(0)) rmSync(path, { force: true });
});

describe("voice sample filenames", () => {
	it("is flat, so the existing /uploads resolver accepts it", () => {
		const name = voiceSampleFilename("kokoro", "af_heart", "wav");
		expect(name).not.toInclude("/");
		expect(name).not.toInclude("\\");
		expect(name).not.toInclude("..");
		// The real gate: resolveUploadFilePath returns null for any name it
		// considers unsafe, which would make the sample unservable.
		expect(resolveUploadFilePath(`/uploads/${name}`)).not.toBeNull();
	});

	it("carries provider, voice, and text version", () => {
		expect(voiceSampleFilename("kokoro", "af_heart", "mp3")).toBe(
			`voice-sample-kokoro-af_heart-${SAMPLE_TEXT_VERSION}.mp3`,
		);
	});

	it("separates the same voice id across providers", () => {
		expect(voiceSampleFilename("provider-a", "shared", "wav")).not.toBe(
			voiceSampleFilename("provider-b", "shared", "wav"),
		);
	});

	it("sanitizes a voice id that would otherwise escape the uploads directory", () => {
		const name = voiceSampleFilename("kokoro", "../../etc/passwd", "wav");
		expect(name).not.toInclude("/");
		expect(name).not.toInclude("..");
		expect(resolveUploadFilePath(`/uploads/${name}`)).not.toBeNull();
	});

	it("changes every filename when the text version changes", () => {
		// The version is baked into the name, so a bump renames the whole set at
		// once — this asserts the mechanism rather than a specific future version.
		const name = voiceSampleFilename("kokoro", "af_heart", "wav");
		expect(name).toInclude(`-${SAMPLE_TEXT_VERSION}.`);
		expect(name.replace(`-${SAMPLE_TEXT_VERSION}.`, "-v99.")).not.toBe(name);
	});
});

describe("voice sample resolution", () => {
	it("returns null for a voice that was never baked", () => {
		expect(voiceSampleUrl("kokoro", "never-baked-voice")).toBeNull();
	});

	it("returns the url once the sample exists", () => {
		const name = bakeFixture("kokoro", "test-voice-wav", "wav");
		expect(voiceSampleUrl("kokoro", "test-voice-wav")).toBe(`/uploads/${name}`);
	});

	it("finds a sample whatever extension it was baked as", () => {
		const name = bakeFixture("kokoro", "test-voice-mp3", "mp3");
		expect(voiceSampleUrl("kokoro", "test-voice-mp3")).toBe(`/uploads/${name}`);
	});

	it("does not resolve one provider's sample for another provider", () => {
		bakeFixture("provider-a", "shared-id", "wav");
		expect(voiceSampleUrl("provider-a", "shared-id")).not.toBeNull();
		expect(voiceSampleUrl("provider-b", "shared-id")).toBeNull();
	});
});

describe("catalogue entry decoration", () => {
	it("adds sampleUrl without disturbing the entry", () => {
		bakeFixture("kokoro", "decorated", "wav");
		const entry = withVoiceSampleUrl("kokoro", {
			id: "decorated",
			name: "Decorated",
			desc: "test",
		});
		expect(entry.name).toBe("Decorated");
		expect(entry.desc).toBe("test");
		expect(entry.sampleUrl).toBe(`/uploads/${voiceSampleFilename("kokoro", "decorated", "wav")}`);
	});

	it("reports an explicit null rather than omitting the field", () => {
		const entry = withVoiceSampleUrl("kokoro", { id: "unbaked", name: "Unbaked" });
		expect("sampleUrl" in entry).toBe(true);
		expect(entry.sampleUrl).toBeNull();
	});
});

describe("sample text", () => {
	it("is one sentence in the length band that exposes prosody", () => {
		const words = SAMPLE_TEXT.trim().split(/\s+/).length;
		expect(words).toBeGreaterThanOrEqual(12);
		expect(words).toBeLessThanOrEqual(18);
	});
});
