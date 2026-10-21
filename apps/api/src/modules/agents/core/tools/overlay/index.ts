/* overlay domain — on-canvas text, data callouts, clip layout and keyframes. */
import type { AnyToolDef } from "../../types.ts";
import { addText } from "./add-text.ts";
import { addInfographic } from "./add-infographic.ts";
import { setClipLayout } from "./set-clip-layout.ts";
import { setKeyframes } from "./set-keyframes.ts";

export const overlayTools: AnyToolDef[] = [addText, addInfographic, setClipLayout, setKeyframes];
