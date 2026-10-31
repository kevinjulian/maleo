# Evidence: the `composition-generated` golden case

`add-motion-design-generation` built this case from the compiled reference
intents. Save the script below as `packages/shared/build-composition-generated.ts`,
run it from `packages/shared` with `bun build-composition-generated.ts`, then
delete it. It writes `storyboard.json` and `case.json` into
`crates/renderer/corpus/composition-generated/`. Render the references with the
pinned image as `crates/renderer/AGENTS.md` describes, and add
`motion-comp.generated` to `corpus/manifest.json` (task 1.1).

```ts
import { writeFileSync } from "node:fs";
import {
	compileMotion,
	compositionParams,
	lintMotion,
	MOTION_EXAMPLES,
	type MotionIntent,
} from "@maleo/shared";
const dir = new URL("../../../../crates/renderer/corpus/composition-generated", import.meta.url)
	.pathname;
const headline = MOTION_EXAMPLES.find((e) => e.presentation === "headline")!;
const explainer = MOTION_EXAMPLES.find((e) => e.presentation === "explainer")!;
const withExit: MotionIntent = {
	...headline.intent,
	layers: headline.intent.layers.map((l) =>
		l.id === "title" ? { ...l, exit: { state: "out", to: "up" } } : l,
	),
	states: [...headline.intent.states, { id: "out", atSec: 1.8, changes: [] }],
};
const full = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "contain" };
const a = compileMotion(withExit, { spanSec: 2.4 });
const b = compileMotion(explainer.intent, { spanSec: 3.6 });
console.log("lint a", JSON.stringify(lintMotion(a)), "lint b", JSON.stringify(lintMotion(b)));
const storyboard = {
	scenes: [{ image: "", durationSec: 6, movement: "Static", transition: "cut" }],
	showLabels: false,
	bgColor: "#10182b",
	accentColor: "#FF3E6C",
	textOverlays: [
		{
			preset: "motion-comp",
			content: "",
			startSec: 0,
			durationSec: 2.4,
			layout: full,
			params: compositionParams(a),
		},
		{
			preset: "motion-comp",
			content: "",
			startSec: 2.4,
			durationSec: 3.6,
			layout: full,
			params: compositionParams(b),
		},
	],
};
writeFileSync(`${dir}/storyboard.json`, JSON.stringify(storyboard, null, "\t") + "\n");
const c = {
	width: 1920,
	height: 1080,
	frames: [0, 5, 10, 15, 25, 50, 56, 60, 64, 72, 75, 80, 90, 120, 138, 142, 146, 152, 179],
	regions: [{ name: "content", rect: [0, 0, 1920, 1080] }],
	options: ["motion-comp.generated"],
};
writeFileSync(`${dir}/case.json`, JSON.stringify(c, null, "\t") + "\n");
```
