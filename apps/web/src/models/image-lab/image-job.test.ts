import { describe, expect, it } from "vite-plus/test";
import {
	canGenerate,
	healthDotColor,
	historyToMessages,
	toggleReference,
	MAX_REFS,
	type LedgerImage,
} from "./image-job.ts";

const entry = (over: Partial<LedgerImage> & { id: string }): LedgerImage => ({
	workspace: "w",
	project_id: null,
	source: "lab",
	prompt: "p",
	asset_url: "i.png",
	aspect: "1:1",
	backfilled: 0,
	starred: 0,
	created_at: 0,
	...over,
});

describe("healthDotColor", () => {
	it("shows unknown as muted, not as down — they are different answers", () => {
		expect(healthDotColor(null)).toBe("var(--muted)");
	});
	it("shows unconfigured and unhealthy alike as an error", () => {
		expect(healthDotColor({ configured: false, ok: false })).toBe("var(--err)");
		expect(healthDotColor({ configured: true, ok: false })).toBe("var(--err)");
	});
	it("shows a configured, healthy service as ok", () => {
		expect(healthDotColor({ configured: true, ok: true })).toBe("var(--ok)");
	});
});

describe("canGenerate", () => {
	const base = { health: { configured: true, ok: true }, workspace: "w", prompt: "a", busy: false };
	it("allows a generation when service, workspace and prompt are all present", () => {
		expect(canGenerate(base)).toBe(true);
	});
	it("blocks on a whitespace-only prompt", () => {
		expect(canGenerate({ ...base, prompt: "   " })).toBe(false);
	});
	it("blocks with no workspace, an unhealthy service, or one already running", () => {
		expect(canGenerate({ ...base, workspace: "" })).toBe(false);
		expect(canGenerate({ ...base, health: { configured: true, ok: false } })).toBe(false);
		expect(canGenerate({ ...base, busy: true })).toBe(false);
	});
});

describe("historyToMessages", () => {
	it("drops entries that never produced an image", () => {
		const out = historyToMessages([entry({ id: "1" }), entry({ id: "2", asset_url: "" })], "w");
		expect(out.map((m) => m.id)).toEqual(["1"]);
	});
	it("keeps two generations of one prompt as two entries", () => {
		// prompt_library was UNIQUE(workspace, prompt), so a regenerated prompt
		// overwrote its own image and these collapsed into a single feed entry.
		const out = historyToMessages(
			[
				entry({ id: "b", prompt: "a red coat", asset_url: "/2.png", created_at: 20 }),
				entry({ id: "a", prompt: "a red coat", asset_url: "/1.png", created_at: 10 }),
			],
			"w",
		);
		expect(out.map((m) => m.image_url)).toEqual(["/1.png", "/2.png"]);
	});
	it("renders a recovered row with no prompt rather than dropping it", () => {
		const out = historyToMessages([entry({ id: "bf", prompt: null, backfilled: 1 })], "w");
		expect(out).toHaveLength(1);
		expect(out[0]?.prompt).toBe("");
	});
	it("reverses newest-first history into an oldest-first feed", () => {
		const out = historyToMessages(
			[entry({ id: "2", created_at: 20 }), entry({ id: "1", created_at: 10 })],
			"w",
		);
		expect(out.map((m) => m.created_at)).toEqual([10, 20]);
	});
});

describe("toggleReference", () => {
	it("adds and removes", () => {
		expect(toggleReference([], "a")).toEqual(["a"]);
		expect(toggleReference(["a", "b"], "a")).toEqual(["b"]);
	});
	it("refuses to exceed the cap, but still allows removal at the cap", () => {
		const full = Array.from({ length: MAX_REFS }, (_, i) => `r${i}`);
		expect(toggleReference(full, "new")).toEqual(full);
		expect(toggleReference(full, "r0")).toHaveLength(MAX_REFS - 1);
	});
});
