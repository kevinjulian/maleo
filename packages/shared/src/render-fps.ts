/** Frames per second of every render and preview. Legacy normalized text keys
 *  convert to seconds over `floor(dur * RENDER_FPS)` frames, so changing this
 *  changes how old documents read (see legacy-text-animation.ts). */
export const RENDER_FPS = 30;
