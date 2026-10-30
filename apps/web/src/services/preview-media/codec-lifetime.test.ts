import { afterEach, expect, test, vi } from "vite-plus/test";
import { installCodecLifetime } from "./codec-lifetime.ts";
afterEach(() => vi.unstubAllGlobals());

test("hidden library codecs cannot exceed a native grant and cleanup closes every owned instance once", () => {
	const closed = vi.fn();
	class Codec {
		state: "configured" | "closed" = "configured";
		close() {
			closed();
			this.state = "closed";
		}
	}
	vi.stubGlobal("VideoDecoder", Codec);
	vi.stubGlobal("AudioDecoder", Codec);
	const life = installCodecLifetime();
	const video = { output: () => {}, error: () => {} };
	expect(() => new VideoDecoder(video)).toThrow("native decoder lease");
	life.video.allow(2);
	const first = new VideoDecoder(video),
		second = new VideoDecoder(video);
	expect(() => new VideoDecoder(video)).toThrow("native decoder lease");
	life.audio.allow(1);
	new AudioDecoder(video);
	life.video.close();
	expect(closed).toHaveBeenCalledTimes(2);
	first.close();
	second.close();
	expect(closed).toHaveBeenCalledTimes(2);
	life.audio.close();
	expect(closed).toHaveBeenCalledTimes(3);
	expect(() => new VideoDecoder(video)).toThrow("native decoder lease");
});
