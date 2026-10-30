import { describe, expect, test, vi } from "vite-plus/test";

const audioTrack = (codec: string, decodable: boolean) => ({
	getCodec: async () => codec,
	canDecode: async () => decodable,
	getFirstTimestamp: async () => 0,
	getSampleRate: async () => 48_000,
	getNumberOfChannels: async () => 2,
	computeDuration: async () => 1,
});
const primary = audioTrack("aac", true);
const secondary = audioTrack("ac3", false);

vi.mock("mediabunny", () => ({
	ALL_FORMATS: [],
	HLS: {},
	BlobSource: class {},
	VideoSampleSink: class {},
	AudioSampleSink: class {
		async *samplesAtTimestamps() {
			yield { numberOfFrames: 1024, numberOfChannels: 2, close() {} };
		}
	},
	Input: class {
		canRead = async () => true;
		getVideoTracks = async () => [];
		getAudioTracks = async () => [primary, secondary];
		getPrimaryAudioTrack = async () => primary;
		getPrimaryVideoTrack = async () => null;
		getFormat = async () => ({ name: "MP4" });
		dispose() {}
	},
}));

const { validateSource } = await import("./source-validation.ts");

describe("validateSource", () => {
	test("an undecodable secondary audio track does not block the source", async () => {
		const file = new File([new Uint8Array([1])], "two-audio.mp4");
		const result = await validateSource(file, ["audio"], (_kind, probe) =>
			probe({ id: 1, yielded: new Promise(() => {}), isYielded: () => false }),
		);
		expect(result.codecs).toEqual(["aac"]);
		expect(result.audioTracks).toBe(2);
		expect(result.audio).toEqual({
			sampleRate: 48_000,
			firstTimestamp: 0,
			channels: 2,
			frames: 48_000,
		});
	});
});
