import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

test("current Remotion Player pitch behavior is measured from its real audio element", async ({
	page,
	context,
}, info) => {
	test.setTimeout(60_000);
	const wav = info.outputPath("reference-tone.wav");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-y",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000:duration=4",
		"-c:a",
		"pcm_s16le",
		wav,
	]);
	const entry = info.outputPath("reference.tsx"),
		bundle = info.outputPath("reference.js");
	writeFileSync(
		entry,
		`
import React, {useRef} from "react";
import {createRoot} from "react-dom/client";
import {Player} from "@remotion/player";
import {Audio} from "remotion";
const options=new URLSearchParams(location.search),rate=Number(options.get("rate"));
const Tone=()=> <Audio src="/reference-tone.wav"/>;
function App(){const player=useRef(null);return <><Player ref={player} component={Tone} durationInFrames={120} fps={30} compositionWidth={320} compositionHeight={160} playbackRate={rate} numberOfSharedAudioTags={0}/><button onClick={async()=>{
 const audio=[...document.querySelectorAll("audio")].find(audio=>audio.src.endsWith("/reference-tone.wav"));if(!audio)throw Error("Reference audio element missing");
 if(options.get("pitch")==="off")audio.preservesPitch=false;
 const context=new AudioContext(),analyser=context.createAnalyser();analyser.fftSize=16384;
 context.createMediaElementSource(audio).connect(analyser);analyser.connect(context.destination);await context.resume();await player.current.play();
 Object.assign(globalThis,{readReferencePitch:()=>{const bins=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(bins);let peak=0;for(let i=1;i<bins.length;i++)if(bins[i]>bins[peak])peak=i;return {rate:audio.playbackRate,preservesPitch:audio.preservesPitch,sampleRate:context.sampleRate,hz:peak*context.sampleRate/analyser.fftSize,db:bins[peak],playing:!audio.paused};}});
}}>Play reference</button></>;}
createRoot(document.getElementById("root")).render(<App/>);
`,
	);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	await context.route("**/reference-tone.wav", (route) =>
		route.fulfill({ path: wav, contentType: "audio/wav" }),
	);
	await context.route("**/reference-pitch*", (route) =>
		route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' }),
	);
	const observations = [];
	for (const [rate, disabled] of [
		[0.5, false],
		[1, false],
		[2, false],
		[2, true],
	] as const) {
		await page.goto(`/reference-pitch?rate=${rate}${disabled ? "&pitch=off" : ""}`);
		await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
		await expect(page.locator("audio")).toHaveCount(1);
		await page.getByRole("button", { name: "Play reference" }).click();
		const read = () =>
			page.evaluate(() => {
				// SAFETY: this test's generated entry owns this measurement function.
				return (
					globalThis as typeof globalThis & {
						readReferencePitch(): {
							rate: number;
							preservesPitch: boolean;
							sampleRate: number;
							hz: number;
							db: number;
							playing: boolean;
						};
					}
				).readReferencePitch();
			});
		await expect.poll(async () => (await read()).db).toBeGreaterThan(-50);
		await expect.poll(async () => (await read()).rate).toBe(rate);
		await expect.poll(async () => (await read()).hz).toBeGreaterThan(disabled ? 870 : 430);
		const observation = await read();
		expect(observation.hz).toBeLessThan(disabled ? 890 : 450);
		expect(observation.preservesPitch).toBe(!disabled);
		expect(observation.playing).toBe(true);
		observations.push(observation);
	}
	writeFileSync(
		info.outputPath("reference-audio-pitch.json"),
		JSON.stringify({ observations }, null, "\t") + "\n",
	);
});
