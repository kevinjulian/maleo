/* App-global secrets: the AI provider key lives in a chmod-0600 file, never in
 * the plaintext settings table.
 *
 * The property that matters most is the negative one — the key must not reach
 * `global_settings`, because that is a SQLite file with no permission story
 * whose contents land in every backup and dump. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "maleo-global-secrets-"));
const priorDataDir = process.env.MALEO_DATA_DIR;
process.env.MALEO_DATA_DIR = dataDir;

// The data directory is process-wide: restore it, or every later suite in the run
// writes its media into this temp folder, which then outlives the run.
afterAll(() => {
	// The test preload always sets it, so there is a value to put back.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
	rmSync(dataDir, { recursive: true, force: true });
});

const {
	globalSecretsPath,
	loadGlobalSecretsIntoEnv,
	maskSecret,
	readGlobalSecrets,
	setGlobalSecret,
	unsetGlobalSecret,
	writeGlobalSecrets,
} = await import("./global-secrets.ts");

beforeEach(() => {
	writeGlobalSecrets({});
	delete process.env.MALEO_AI_API_KEY;
});

afterEach(() => {
	delete process.env.MALEO_AI_API_KEY;
});

describe("storage", () => {
	test("round-trips a secret", () => {
		setGlobalSecret("MALEO_AI_API_KEY", "sk-secret-value");
		expect(readGlobalSecrets().MALEO_AI_API_KEY).toBe("sk-secret-value");
	});

	test("the file is written 0600", () => {
		setGlobalSecret("MALEO_AI_API_KEY", "sk-secret-value");
		const mode = statSync(globalSecretsPath()).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	test("lives under the data dir, which is gitignored", () => {
		expect(globalSecretsPath()).toBe(join(dataDir, "secrets.yaml"));
	});

	test("an absent file reads as empty rather than throwing", () => {
		rmSync(globalSecretsPath(), { force: true });
		expect(existsSync(globalSecretsPath())).toBe(false);
		expect(readGlobalSecrets()).toEqual({});
	});

	test("unset removes the key without disturbing the others", () => {
		setGlobalSecret("A", "1");
		setGlobalSecret("B", "2");
		unsetGlobalSecret("A");
		expect(readGlobalSecrets()).toEqual({ B: "2" });
	});
});

describe("publishing into the environment", () => {
	test("a stored secret reaches process.env", () => {
		setGlobalSecret("MALEO_AI_API_KEY", "sk-from-file");
		loadGlobalSecretsIntoEnv();
		expect(process.env.MALEO_AI_API_KEY).toBe("sk-from-file");
	});

	test("an explicitly exported env var wins over the stored one", () => {
		// A key exported on the command line is a deliberate override — usually
		// someone debugging. A stale saved key silently beating it would be the
		// worst possible time for the file to win.
		setGlobalSecret("MALEO_AI_API_KEY", "sk-from-file");
		process.env.MALEO_AI_API_KEY = "sk-from-operator";
		loadGlobalSecretsIntoEnv();
		expect(process.env.MALEO_AI_API_KEY).toBe("sk-from-operator");
	});

	test("an empty stored value does not clobber anything", () => {
		writeGlobalSecrets({ MALEO_AI_API_KEY: "" });
		loadGlobalSecretsIntoEnv();
		expect(process.env.MALEO_AI_API_KEY).toBeUndefined();
	});
});

describe("the key never reaches the settings table", () => {
	test("nothing in the secrets module writes global_settings", async () => {
		const src = readFileSync(new URL("./global-secrets.ts", import.meta.url), "utf8");
		// Comments stripped: the module's own header explains at length why it
		// does not touch the settings table, and would match the scan.
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		expect(code).not.toContain("setGlobalSetting");
		expect(code).not.toContain("global_settings");
	});

	test("the settings route stores the key name, not the value", async () => {
		const src = readFileSync(new URL("../routes/settings.ts", import.meta.url), "utf8");
		// The route writes the secret through the secrets file helper...
		expect(src).toContain("setGlobalSecret(AI_API_KEY_SECRET");
		// ...and never through the settings-table helper.
		expect(src).not.toContain("setGlobalSetting(AI_API_KEY_SECRET");
	});
});

describe("masking", () => {
	test("shows only the last four characters", () => {
		expect(maskSecret("sk-abcdefghijkl")).toBe("••••ijkl");
	});

	test("a short value does not leak its length", () => {
		expect(maskSecret("abcd")).toBe("***");
	});

	test("an empty value masks to empty", () => {
		expect(maskSecret("")).toBe("");
	});
});
