/* visual domain — image/video generation (frames, animation, characters, overlays). */
import type { AnyToolDef } from "../../types.ts";
import { generateFrame } from "./generate-frame.ts";
import { animateScene } from "./animate-scene.ts";
import { createCharacter } from "./create-character.ts";
import { addOverlay } from "./add-overlay.ts";
import { generateStyle } from "./generate-style.ts";

export const visualTools: AnyToolDef[] = [
	generateFrame,
	generateStyle,
	animateScene,
	createCharacter,
	addOverlay,
];
