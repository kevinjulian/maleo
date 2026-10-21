import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoPlayer } from "./video-player.tsx";

test("stored MP4 player renders upstream controls without autoplay or native controls", () => {
	const html = renderToStaticMarkup(
		<VideoPlayer src="/api/media/export" poster="/api/media/poster" title="Project export" />,
	);
	expect(html).toContain('data-theme="compat"');
	expect(html).toContain('aria-label="Project export"');
	expect(html).toContain('src="/api/media/export"');
	expect(html).toContain('poster="/api/media/poster"');
	expect(html).toContain('preload="metadata"');
	expect(html).toContain('aria-label="Play"');
	expect(html).not.toContain('autoplay=""');
	expect(html).not.toContain("<video controls");
});
