import { describe, expect, test, vi } from "vite-plus/test";
import type { ManifestEntry } from "@models/render/export-preflight.ts";
import {
	browserProbes,
	runExportPreflight,
	type PreflightInput,
	type PreflightProbes,
} from "./export-preflight.ts";

const HASH = "a".repeat(64);
const clip: ManifestEntry = {
	id: "m1",
	url: "/api/media/m1",
	state: "ready",
	size: 3,
	sha256: HASH,
	label: "beach.mp4",
	used: true,
};
const stock: ManifestEntry = { id: "s", url: "https://stock/x.jpg", state: "external", used: true };
const unused: ManifestEntry = {
	...clip,
	id: "m2",
	url: "/api/media/m2",
	state: "failed",
	used: false,
};

function probes(overrides: Partial<PreflightProbes> = {}): PreflightProbes {
	return {
		webgpu: async () => true,
		encoders: async () => true,
		digest: async () => HASH,
		...overrides,
	};
}

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
	const file = new File([new Uint8Array([1, 2, 3])], "beach.mp4");
	return {
		width: 1080,
		height: 1920,
		bitrate: 8_000_000,
		seconds: 30,
		coverage: { state: "eligible" },
		manifest: Object.freeze([clip, stock, unused]),
		localFile: () => file,
		...overrides,
	};
}

describe("runExportPreflight", () => {
	test("passes when every used file is local and matches the manifest", async () => {
		const digest = vi.fn(async () => HASH);
		expect(await runExportPreflight(input(), probes({ digest }))).toEqual({ ok: true });
		// External entries have no hash; unused entries are not read.
		expect(digest).toHaveBeenCalledTimes(2);
	});

	test.each([
		[
			"size",
			probes(),
			input({ seconds: 600 }),
			/about 6\d\d MiB, more than a browser export holds \(512 MiB\)/,
			true,
		],
		["webgpu", probes({ webgpu: async () => false }), input(), /no WebGPU adapter/, true],
		["encoder", probes({ encoders: async () => false }), input(), /cannot encode H\.264/, true],
		[
			"coverage",
			probes(),
			input({
				coverage: {
					state: "ineligible",
					entries: [
						{ kind: "text", path: "t", reason: "`lower-third` preset", frame: 45, time: 1.5 },
					],
				},
			}),
			/`lower-third` preset at 1\.50 s/,
			true,
		],
		[
			"pending",
			probes(),
			input({ manifest: [{ ...clip, state: "pending" }] }),
			/beach\.mp4 is still uploading/,
			false,
		],
		[
			"failed",
			probes(),
			input({ manifest: [{ ...clip, state: "failed" }] }),
			/beach\.mp4 is unavailable/,
			false,
		],
		[
			"download",
			probes(),
			input({ localFile: () => undefined }),
			/beach\.mp4 could not be downloaded/,
			true,
		],
		[
			"download",
			probes({ digest: async () => Promise.reject(new Error("read failed")) }),
			input(),
			/beach\.mp4 could not be downloaded/,
			true,
		],
		[
			"hash",
			probes({ digest: async () => "b".repeat(64) }),
			input(),
			/beach\.mp4 does not match/,
			true,
		],
		[
			"hash",
			probes(),
			input({ manifest: [{ ...clip, size: 4 }] }),
			/beach\.mp4 does not match/,
			true,
		],
	] as const)("refuses for %s with a named cause", async (cause, probe, given, message, offer) => {
		const result = await runExportPreflight(given, probe);
		expect(result).toMatchObject({ ok: false, cause, offerServer: offer });
		if (!result.ok) expect(result.message).toMatch(message);
	});

	test("checks the browser before coverage, coverage before the manifest", async () => {
		const failed = input({
			coverage: { state: "error", message: "x" },
			manifest: [{ ...clip, state: "failed" }],
		});
		expect(await runExportPreflight(failed, probes({ webgpu: async () => false }))).toMatchObject({
			cause: "webgpu",
		});
		expect(await runExportPreflight(failed, probes())).toMatchObject({ cause: "coverage" });
	});

	test("a pending file wins over a failed one and neither reads local bytes", async () => {
		const localFile = vi.fn();
		const result = await runExportPreflight(
			input({
				manifest: [
					{ ...clip, state: "failed" },
					{ ...clip, id: "p", label: "voice.wav", state: "pending" },
				],
				localFile,
			}),
			probes(),
		);
		expect(result).toMatchObject({ cause: "pending" });
		expect(localFile).not.toHaveBeenCalled();
	});

	test("an uppercase manifest hash matches", async () => {
		const result = await runExportPreflight(
			input({ manifest: [{ ...clip, sha256: HASH.toUpperCase() }] }),
			probes(),
		);
		expect(result).toEqual({ ok: true });
	});

	test("the browser digest is the file's SHA-256 in lowercase hex", async () => {
		expect(await browserProbes.digest(new File(["abc"], "abc.txt"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
