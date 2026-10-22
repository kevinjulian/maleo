// bun spikes/rust-captions/remotion/render.ts
// Writes reference/<fixture>-<frame>.png for every fixture and frame.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "../../../packages/video/node_modules/@remotion/bundler";
import {
	renderStill,
	selectComposition,
} from "../../../packages/video/node_modules/@remotion/renderer";

const here = import.meta.dir;
const videoModules = join(here, "../../../packages/video/node_modules");
const doc = JSON.parse(readFileSync(join(here, "../fixtures/fixtures.json"), "utf8"));
const out = join(here, "..", process.env.REFERENCE_DIR ?? "reference");
mkdirSync(out, { recursive: true });

const serveUrl = await bundle({
	entryPoint: join(here, "Root.tsx"),
	webpackOverride: (config) => ({
		...config,
		resolve: { ...config.resolve, modules: [videoModules, "node_modules"] },
	}),
});

const only = process.argv[2];
for (const fixture of doc.fixtures) {
	if (only && fixture.id !== only) continue;
	const inputProps = {
		background: doc.background,
		fgColor: doc.fgColor,
		accentColor: doc.accentColor,
		fixture,
	};
	const composition = await selectComposition({ serveUrl, id: "CaptionFixture", inputProps });
	for (const frame of doc.frames) {
		const output = join(out, `${fixture.id}-${frame}.png`);
		await renderStill({ composition, serveUrl, output, frame, inputProps, imageFormat: "png" });
		console.log(output);
	}
}
