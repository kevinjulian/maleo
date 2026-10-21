import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getLocalWhisperStatus, setupLocalWhisper } from "./whisper.ts";

const KEYS = ["MALEO_WHISPER_CPP_BIN", "MALEO_WHISPER_CPP_DIR"] as const;
const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const directories: string[] = [];

afterEach(async () => {
	for (const key of KEYS) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}
	await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "whisper-prebuilt-"));
	directories.push(directory);
	return directory;
}

test("status reads the prebuilt binary, not the model folder", async () => {
	const directory = await scratch();
	const binary = join(directory, "main");
	await writeFile(binary, "");
	process.env.MALEO_WHISPER_CPP_BIN = binary;
	process.env.MALEO_WHISPER_CPP_DIR = join(directory, "models");
	expect((await getLocalWhisperStatus()).mainInstalled).toBe(true);
});

test("setup with a missing prebuilt binary fails without building from source", async () => {
	const directory = await scratch();
	process.env.MALEO_WHISPER_CPP_BIN = join(directory, "absent");
	process.env.MALEO_WHISPER_CPP_DIR = join(directory, "models");
	await expect(setupLocalWhisper()).rejects.toThrow("Image has no whisper.cpp");
});
