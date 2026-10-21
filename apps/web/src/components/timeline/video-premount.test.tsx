import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { Thumbnail } from "@remotion/player";
import { StoryboardReel, storyboardSchema } from "@maleo/video/composition";
import { Window } from "happy-dom";

test.each(["overlay", "visual timeline", "scene"])(
	"%s video mounts hidden before its first frame",
	(path) => {
		const clip = {
			kind: "video",
			url: "https://example.com/clip.mp4",
			startSec: 3,
			durationSec: 3,
		};
		const storyboard = storyboardSchema.parse({
			scenes: path === "scene" ? [{ image: "", durationSec: 6, visualClips: [clip] }] : [],
			...(path === "overlay" ? { videoOverlays: [clip] } : {}),
			...(path === "visual timeline" ? { visualTimeline: [clip] } : {}),
		});
		const html = renderToStaticMarkup(
			<Thumbnail
				component={StoryboardReel}
				inputProps={storyboard}
				frameToDisplay={40}
				durationInFrames={210}
				fps={30}
				compositionWidth={640}
				compositionHeight={360}
			/>,
		);
		const document = new Window().document;
		document.body.innerHTML = html;
		const video = document.querySelector("video");
		expect(video).not.toBeNull();
		expect(video?.hasAttribute("muted")).toBe(true);
		expect(video?.closest('[style*="pointer-events:none"]')?.getAttribute("style")).toContain(
			"opacity:0",
		);
	},
);
