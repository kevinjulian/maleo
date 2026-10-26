import { describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Storyboard } from "@maleo/video/composition";
import { compositionConfigSchema, compositionParams } from "@maleo/shared";

const { previews } = vi.hoisted(() => ({
	previews: [] as { inputProps: Storyboard; durationInFrames: number; initialFrame?: number }[],
}));
vi.mock("@remotion/player", () => ({
	Player: (props: (typeof previews)[number]) => {
		previews.push(props);
		return null;
	},
}));
import { TextPresetPreview } from "./timeline-editor-panels.tsx";

describe("saved composition preview", () => {
	it("keeps every layer and the saved span instead of showing only its first layer", () => {
		const config = compositionConfigSchema.parse({
			spanSec: 7,
			overlays: [
				{ preset: "plain", content: "", relStart: 2, dur: 1 },
				{ preset: "shape-star", content: "", relStart: 4, dur: 2, params: { opacity: 0 } },
			],
		});
		renderToStaticMarkup(
			<TextPresetPreview
				preset="motion-comp"
				content="Saved"
				params={compositionParams(config)}
				still={900}
			/>,
		);
		const preview = previews.at(-1)!;
		expect(preview.durationInFrames).toBe(210);
		expect(preview.initialFrame).toBe(209);
		expect(preview.inputProps.textOverlays?.[0]).toMatchObject({
			preset: "motion-comp",
			durationSec: 7,
			layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
		});
		expect(preview.inputProps.textOverlays?.[0]?.params).toEqual(config);
	});
});
