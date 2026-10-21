import { expect, test } from "vite-plus/test";
import { posterSrc } from "./media-thumb.tsx";

test("a poster asks for a time just past zero so iOS Safari paints the first frame", () => {
	expect(posterSrc("/api/media/abc")).toBe("/api/media/abc#t=0.001");
	expect(posterSrc("https://s3.example/k.mp4?X-Amz-Signature=s")).toBe(
		"https://s3.example/k.mp4?X-Amz-Signature=s#t=0.001",
	);
	expect(posterSrc("blob:https://app.example/1234")).toBe("blob:https://app.example/1234#t=0.001");
});

test("a URL that already carries a fragment is left as it is", () => {
	expect(posterSrc("/clip.mp4#t=2")).toBe("/clip.mp4#t=2");
});
