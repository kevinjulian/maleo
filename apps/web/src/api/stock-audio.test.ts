import { describe, expect, test } from "vite-plus/test";
import { STOCK_AUDIO_HOSTS } from "@maleo/shared";
import { readHosts } from "./stock-audio.ts";

describe("readHosts", () => {
	test("keeps the deployment's music base beside the shared hosts", () => {
		expect(readHosts({ music: "https://files.example.org/file/example-bucket" })).toEqual({
			...STOCK_AUDIO_HOSTS,
			music: "https://files.example.org/file/example-bucket",
		});
	});

	test("drops unknown keys and anything that is not an https base", () => {
		expect(
			readHosts({
				music: "http://plain.example.org",
				elsewhere: "https://x.example",
				freesound: 3,
			}),
		).toEqual(STOCK_AUDIO_HOSTS);
		expect(readHosts(null)).toEqual(STOCK_AUDIO_HOSTS);
	});
});
