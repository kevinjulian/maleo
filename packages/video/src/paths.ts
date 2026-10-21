/* Where this package lives on disk, for the processes that bundle and serve it.
 *
 * The render server and the Lambda deploy script run from their own app directory, not
 * from here, so a cwd-relative `src/index.ts` would point at the wrong tree.
 * Remotion's bundler defaults its root to the cwd; passing these keeps the
 * bundle rooted at this package.
 *
 * `public/` is NOT here on purpose: it holds only runtime caches (voiceover,
 * scene images) that `src/lib` writes cwd-relative, so it belongs to whichever
 * process renders, not to this package. */
import { fileURLToPath } from "node:url";

/** Absolute path of the `@maleo/video` package root. */
export const VIDEO_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The Remotion entry point that calls `registerRoot`. */
export const VIDEO_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));
