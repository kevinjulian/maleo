/* overlay domain — on-canvas text, motion design, clip layout and keyframes. */
import type { AnyToolDef } from "../../types.ts";
import { addMotionDesign } from "./add-motion-design.ts";
import { addText } from "./add-text.ts";
import { setClipLayout } from "./set-clip-layout.ts";
import { setKeyframes } from "./set-keyframes.ts";

export const overlayTools: AnyToolDef[] = [addText, addMotionDesign, setClipLayout, setKeyframes];
