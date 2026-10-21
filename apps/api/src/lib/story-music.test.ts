import { afterEach, describe, expect, it } from "vite-plus/test";
import { DEFAULT_TIMELINE_TEMPLATE } from "@maleo/shared";
import type { Emotion } from "@maleo/shared";
import {
	musicCueForSection,
	musicSpansFor,
	planMusicSpans,
	resolveMusicCueUrls,
	resolveMusicSpans,
} from "./story-music.ts";
import {
	clearStockAudioCache,
	setStockAudioResolverForTests,
	setStockSearchForTests,
} from "@maleo/stock";

const template = (over: Partial<typeof DEFAULT_TIMELINE_TEMPLATE> = {}) => ({
	...DEFAULT_TIMELINE_TEMPLATE,
	...over,
});

const arc = (...emotions: Array<Emotion | undefined>) => emotions.map((emotion) => ({ emotion }));

afterEach(() => {
	setStockAudioResolverForTests(null);
	setStockSearchForTests(null);
	clearStockAudioCache();
});

describe("musicCueForSection — cue precedence", () => {
	it("uses the emotion's cue when the template maps it", () => {
		expect(musicCueForSection(template(), "tension")).toBe("dark driving pulse");
	});

	it("falls back to the default cue for an unmapped emotion", () => {
		const t = template({ musicEmotionCues: { tension: { cue: "dark driving pulse", url: "" } } });
		expect(musicCueForSection(t, "hope")).toBe(DEFAULT_TIMELINE_TEMPLATE.musicCue);
	});

	it("falls back to the default cue when the section has no emotion", () => {
		expect(musicCueForSection(template(), undefined)).toBe(DEFAULT_TIMELINE_TEMPLATE.musicCue);
	});

	it("treats a blank mapped cue as unset", () => {
		const t = template({ musicEmotionCues: { hope: { cue: "   ", url: "" } } });
		expect(musicCueForSection(t, "hope")).toBe(DEFAULT_TIMELINE_TEMPLATE.musicCue);
	});
});

describe("planMusicSpans — merging adjacent cues", () => {
	const perEmotion = template({ musicPolicy: "per_emotion" });

	it("collapses three consecutive same-emotion sections into one span", () => {
		const spans = planMusicSpans(perEmotion, arc("calm", "calm", "calm"));
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({ fromIndex: 0, toIndex: 2, cue: "soft ambient pad" });
	});

	it("keeps an A-B-A arc as three spans", () => {
		const spans = planMusicSpans(perEmotion, arc("calm", "tension", "calm"));
		expect(spans).toHaveLength(3);
		expect(spans.map((s) => s.fromIndex)).toEqual([0, 1, 2]);
	});

	it("merges by resolved cue, not by emotion name", () => {
		// Two different emotions mapped to the same cue are musically one stretch.
		const t = template({
			musicPolicy: "per_emotion",
			musicEmotionCues: {
				calm: { cue: "soft ambient pad", url: "" },
				relief: { cue: "soft ambient pad", url: "" },
			},
		});
		expect(planMusicSpans(t, arc("calm", "relief"))).toHaveLength(1);
	});

	it("covers every section with no gaps and no overlaps", () => {
		const spans = planMusicSpans(perEmotion, arc("calm", "tension", "tension", "hope"));
		expect(spans[0]!.fromIndex).toBe(0);
		expect(spans[spans.length - 1]!.toIndex).toBe(3);
		for (let i = 1; i < spans.length; i++) {
			expect(spans[i]!.fromIndex).toBe(spans[i - 1]!.toIndex + 1);
		}
	});

	it("collapses the whole video to one span under the single policy", () => {
		const spans = planMusicSpans(template(), arc("calm", "tension", "hope"));
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({
			fromIndex: 0,
			toIndex: 2,
			cue: DEFAULT_TIMELINE_TEMPLATE.musicCue,
		});
	});

	it("returns nothing for an empty section list", () => {
		expect(planMusicSpans(perEmotion, [])).toEqual([]);
	});

	it("groups emotionless sections onto the default cue", () => {
		const spans = planMusicSpans(perEmotion, arc(undefined, undefined, "tension"));
		expect(spans).toHaveLength(2);
		expect(spans[0]).toMatchObject({
			fromIndex: 0,
			toIndex: 1,
			cue: DEFAULT_TIMELINE_TEMPLATE.musicCue,
		});
	});
});

describe("resolveMusicSpans — provider lookups", () => {
	const perEmotion = template({ musicPolicy: "per_emotion" });

	it("resolves each distinct cue exactly once per build", async () => {
		const queries: string[] = [];
		setStockAudioResolverForTests(async (_kind, query) => {
			queries.push(query);
			return { url: `https://stock.test/${encodeURIComponent(query)}.mp3` };
		});
		// A-B-A: three spans, but only two distinct cues.
		const spans = await resolveMusicSpans(perEmotion, arc("calm", "tension", "calm"));
		expect(spans).toHaveLength(3);
		expect(queries).toHaveLength(2);
		expect(spans[0]!.url).toBe(spans[2]!.url);
		expect(spans[1]!.url).not.toBe(spans[0]!.url);
	});

	it("uses the pinned template url for the single bed without any lookup", async () => {
		let calls = 0;
		setStockAudioResolverForTests(async () => {
			calls++;
			return { url: "https://stock.test/should-not-be-used.mp3" };
		});
		const t = template({ musicUrl: "/pinned.mp3" });
		const spans = await resolveMusicSpans(t, arc("calm", "tension"));
		expect(spans).toHaveLength(1);
		expect(spans[0]!.url).toBe("/pinned.mp3");
		expect(calls).toBe(0);
	});

	it("uses a per-emotion pinned track without any lookup for that span", async () => {
		const queries: string[] = [];
		setStockAudioResolverForTests(async (_kind, query) => {
			queries.push(query);
			return { url: `/${query}.mp3` };
		});
		const t = template({
			musicPolicy: "per_emotion",
			musicEmotionCues: { tension: { cue: "dark driving pulse", url: "/my-tension-track.mp3" } },
		});
		const spans = await resolveMusicSpans(t, arc("calm", "tension"));
		expect(spans[1]!.url).toBe("/my-tension-track.mp3");
		// Only the unpinned span cost a lookup.
		expect(queries).toEqual([DEFAULT_TIMELINE_TEMPLATE.musicCue]);
	});

	it("does not let a template-level pinned url flatten per-emotion choices", async () => {
		// "one pinned bed everywhere" and "a bed per emotion" are opposite intents;
		// under per_emotion the template url only backs emotions with no entry.
		setStockAudioResolverForTests(async (_kind, query) => ({ url: `/${query}.mp3` }));
		const t = template({
			musicPolicy: "per_emotion",
			musicUrl: "/template-wide.mp3",
			musicEmotionCues: { tension: { cue: "dark driving pulse", url: "/my-tension-track.mp3" } },
		});
		const spans = await resolveMusicSpans(t, arc("calm", "tension"));
		expect(spans[0]!.url).toBe("/template-wide.mp3"); // calm is unset → default
		expect(spans[1]!.url).toBe("/my-tension-track.mp3"); // tension keeps its own
	});

	it("merges adjacent emotions pinned to the same track into one bed", async () => {
		setStockAudioResolverForTests(async (_kind, query) => ({ url: `/${query}.mp3` }));
		const t = template({
			musicPolicy: "per_emotion",
			musicEmotionCues: {
				tension: { cue: "dark driving pulse", url: "/shared.mp3" },
				suspense: { cue: "suspense ambient", url: "/shared.mp3" },
			},
		});
		// Different cue text, same asset — musically one continuous stretch.
		const spans = await resolveMusicSpans(t, arc("tension", "suspense"));
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({ fromIndex: 0, toIndex: 1, url: "/shared.mp3" });
	});

	it("falls back to the default cue's bed when an emotion cue resolves to nothing", async () => {
		// A transient empty result can blank a good cue. A slightly-wrong bed beats
		// a silent chapter.
		setStockAudioResolverForTests(async (_kind, query) =>
			query === "dark driving pulse" ? null : { url: `/${query}.mp3` },
		);
		const spans = await resolveMusicSpans(perEmotion, arc("calm", "tension"));
		expect(spans[0]!.url).toBe("/soft ambient pad.mp3");
		expect(spans[1]!.url).toBe(`/${DEFAULT_TIMELINE_TEMPLATE.musicCue}.mp3`);
	});

	it("leaves a span silent only when the default cue also fails", async () => {
		setStockAudioResolverForTests(async () => null);
		const spans = await resolveMusicSpans(perEmotion, arc("calm", "tension"));
		expect(spans.every((s) => s.url === undefined)).toBe(true);
	});

	it("prefers a candidate long enough to hold a bed over an earlier short one", async () => {
		setStockSearchForTests(async () => [
			{ url: "/sting.mp3", durationSec: 9 },
			{ url: "/bed.mp3", durationSec: 180 },
		]);
		const spans = await resolveMusicSpans(perEmotion, arc("calm"));
		expect(spans[0]!.url).toBe("/bed.mp3");
	});

	it("settles for the longest candidate when none reaches the bed threshold", async () => {
		setStockSearchForTests(async () => [
			{ url: "/short.mp3", durationSec: 9 },
			{ url: "/less-short.mp3", durationSec: 41 },
		]);
		const spans = await resolveMusicSpans(perEmotion, arc("calm"));
		expect(spans[0]!.url).toBe("/less-short.mp3");
	});

	it("falls back to the placeholder url when the provider has nothing", async () => {
		setStockAudioResolverForTests(async () => null);
		const spans = await resolveMusicSpans(perEmotion, arc("calm"), "/placeholder.mp3");
		expect(spans[0]!.url).toBe("/placeholder.mp3");
	});

	it("degrades to the placeholder when the resolver throws", async () => {
		setStockAudioResolverForTests(async () => {
			throw new Error("no provider key");
		});
		const spans = await resolveMusicSpans(perEmotion, arc("calm"), "/placeholder.mp3");
		expect(spans[0]!.url).toBe("/placeholder.mp3");
	});

	it("survives a resolver failure with no placeholder configured", async () => {
		setStockAudioResolverForTests(async () => {
			throw new Error("network down");
		});
		const spans = await resolveMusicSpans(perEmotion, arc("calm"));
		expect(spans[0]!.url).toBeUndefined();
	});

	it("produces one span under the single policy regardless of emotions", async () => {
		setStockAudioResolverForTests(async (_kind, query) => ({ url: `/${query}.mp3` }));
		const spans = await resolveMusicSpans(template(), arc("calm", "tension", "chaos"));
		expect(spans).toHaveLength(1);
		expect(spans[0]!.toIndex).toBe(2);
	});
});

describe("regeneration agrees with a full rebuild", () => {
	const perEmotion = template({ musicPolicy: "per_emotion" });
	const plan = arc("calm", "tension", "tension", "hope");

	it("resolves the same spans whether assembled progressively or in one pass", async () => {
		setStockAudioResolverForTests(async (_kind, query) => ({ url: `/${query}.mp3` }));
		// Full pass: cue urls resolved once over every section, spans built for the
		// ready subset. Regeneration: resolved directly over the ready subset. The two
		// paths must not disagree, or a regenerated section restarts the score.
		const urls = await resolveMusicCueUrls(perEmotion, plan);
		const progressive = musicSpansFor(perEmotion, plan, urls);
		const oneShot = await resolveMusicSpans(perEmotion, plan);
		expect(progressive).toEqual(oneShot);
	});

	it("keeps the spans of already-placed sections stable as later sections land", async () => {
		setStockAudioResolverForTests(async (_kind, query) => ({ url: `/${query}.mp3` }));
		const urls = await resolveMusicCueUrls(perEmotion, plan);
		const partial = musicSpansFor(perEmotion, plan.slice(0, 2), urls);
		const complete = musicSpansFor(perEmotion, plan, urls);
		// The first span is settled once its sections are placed; only the trailing
		// span extends as more sections arrive.
		expect(complete[0]).toEqual(partial[0]!);
	});

	it("needs no further provider call once cue urls are resolved", async () => {
		let calls = 0;
		setStockAudioResolverForTests(async (_kind, query) => {
			calls++;
			return { url: `/${query}.mp3` };
		});
		const urls = await resolveMusicCueUrls(perEmotion, plan);
		const before = calls;
		musicSpansFor(perEmotion, plan.slice(0, 1), urls);
		musicSpansFor(perEmotion, plan.slice(0, 3), urls);
		musicSpansFor(perEmotion, plan, urls);
		expect(calls).toBe(before);
	});

	it("resolves cues for sections that are not ready yet", async () => {
		setStockAudioResolverForTests(async (_kind, query) => ({ url: `/${query}.mp3` }));
		// "hope" only appears in the last section; its cue must already be resolved
		// when that section finally lands, without a fresh lookup.
		const urls = await resolveMusicCueUrls(perEmotion, plan);
		expect(urls.get(`cue:${DEFAULT_TIMELINE_TEMPLATE.musicEmotionCues.hope!.cue}`)).toBe(
			`/${DEFAULT_TIMELINE_TEMPLATE.musicEmotionCues.hope!.cue}.mp3`,
		);
	});
});
