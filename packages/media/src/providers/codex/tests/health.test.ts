import { afterEach, describe, expect, it } from "vite-plus/test";
import { codexImageHealth } from "../index.ts";
import { restoreEnv, snapshotEnv, useFakeCodex, useNoCodex } from "./env.ts";

const snapshot = snapshotEnv();

afterEach(() => restoreEnv(snapshot));

describe("codex image health", () => {
	it("reports unconfigured when the codex CLI is not on PATH", async () => {
		useNoCodex();
		expect(await codexImageHealth()).toBe("unconfigured");
	});

	it("reports ready when the CLI answers its self-check", async () => {
		useFakeCodex();
		expect(await codexImageHealth()).toBe("ready");
	});

	it("reports down when the CLI is present but its self-check fails", async () => {
		useFakeCodex();
		process.env.FAKE_CODEX_MODE = "version-fail";
		expect(await codexImageHealth()).toBe("down");
	});
});
