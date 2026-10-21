/* The two `TemplateParams` copies have to agree.
 *
 * The renderer reads a text overlay's params through `TemplateParams`
 * (`@maleo/video`), and the editor writes them through `TemplateParams`
 * (`@maleo/shared`). They are two copies for the same reason the duck tables
 * are: neither package can import the other — the render package declares no
 * workspace dependencies, and shared must not depend on the renderer.
 *
 * This is the only place that can see both, so it is where the copy is checked
 * rather than trusted. A params value the editor can write and the renderer
 * cannot represent is a clip that saves and then renders as something else.
 */
import { describe, expect, test } from "vite-plus/test";
import type {
	TemplateParams as SharedParams,
	TemplateParamValue as SharedValue,
} from "@maleo/shared";
import type {
	TemplateParams as VideoParams,
	TemplateParamValue as VideoValue,
} from "@maleo/video/composition";

/** Compile-time: each must be assignable to the other, in both directions. */
type Extends<A, B> = A extends B ? true : false;
const sharedValueFitsVideo: Extends<SharedValue, VideoValue> = true;
const videoValueFitsShared: Extends<VideoValue, SharedValue> = true;
const sharedParamsFitVideo: Extends<SharedParams, VideoParams> = true;
const videoParamsFitShared: Extends<VideoParams, SharedParams> = true;

describe("TemplateParams copies agree", () => {
	test("each package's value type is assignable to the other's", () => {
		expect([sharedValueFitsVideo, videoValueFitsShared]).toEqual([true, true]);
	});

	test("each package's params type is assignable to the other's", () => {
		expect([sharedParamsFitVideo, videoParamsFitShared]).toEqual([true, true]);
	});

	test("every JSON shape a template field can produce round-trips through both", () => {
		// text/textarea/image -> string, number -> number, list -> rows,
		// and motion-comp -> a nested composition bundle.
		const written: SharedParams = {
			title: "Your Story Begins",
			fontSize: 64,
			muted: false,
			cleared: null,
			cast: [{ role: "Host", name: "Ada" }],
			overlays: [{ relStart: 0, dur: 3, params: { title: "nested" } }],
		};
		const read: VideoParams = written;
		expect(read).toEqual(written);
	});
});
