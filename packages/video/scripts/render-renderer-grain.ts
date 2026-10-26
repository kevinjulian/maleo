// Run in the pinned production image, like render-golden.ts. This freezes the
// source's constant SVG tile, not a general SVG/noise implementation.
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const root = new URL("../../../crates/renderer/assets/", import.meta.url).pathname;
mkdirSync(root, { recursive: true });
const serveUrl = await bundle({
	entryPoint: new URL("./renderer-grain-entry.tsx", import.meta.url).pathname,
});
const composition = await selectComposition({ serveUrl, id: "Grain" });
const { buffer: png } = await renderStill({ serveUrl, composition, frame: 0, imageFormat: "png" });
if (!png) throw new Error("Grain render returned no pixels");
const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.width !== 200 || info.height !== 200 || info.channels !== 4)
	throw new Error("Unexpected grain tile dimensions");
writeFileSync(`${root}/grain.rgba`, data);
console.log(`Wrote ${data.length} bytes to ${root}/grain.rgba`);
