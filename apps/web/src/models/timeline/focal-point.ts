/* The point a scene's camera zooms toward, in percent of the frame.
 *
 * Picked by clicking the frame, or by arrow keys from where it is now, the
 * keyboard path the picker would otherwise lack. The rules live in the shared
 * core (`crates/app-core/src/controls.rs`, `p1-envelope-inspector`). */
export {
	focalPointAt,
	nudgeFocalPoint,
	type FocalPoint,
} from "@maleo/shared/editor/inspector-rules";
