import { expect, test, vi } from "vite-plus/test";
import { probeSvgSource } from "./svg-probe.ts";

test("DOM SVG probes serialize, close their bitmap and release URLs on abort or failure", async () => {
	const images: ImageProbe[] = [];
	class ImageProbe {
		naturalWidth = 64;
		naturalHeight = 64;
		value = "";
		finish!: () => void;
		fail!: (error: Error) => void;
		pending: Promise<void>;
		constructor() {
			this.pending = new Promise((resolve, reject) => {
				this.finish = resolve;
				this.fail = reject;
			});
			images.push(this);
		}
		set src(value: string) {
			this.value = value;
			if (!value) this.fail(new Error("Canceled"));
		}
		get src() {
			return this.value;
		}
		decode() {
			return this.pending;
		}
	}
	const close = vi.fn();
	vi.stubGlobal("Image", ImageProbe);
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn(async () => ({ close })),
	);
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:svg-probe");
	const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const controllers = Array.from({ length: 3 }, () => new AbortController());
	const file = new File(["<svg/>"], "source.svg", { type: "image/svg+xml" });
	const probes: Promise<void>[] = [];
	try {
		probes.push(probeSvgSource(file, controllers[0]!.signal));
		probes.push(probeSvgSource(file, controllers[1]!.signal));
		await vi.waitFor(() => expect(images).toHaveLength(1));
		images[0]!.finish();
		await probes[0];
		expect(close).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(images).toHaveLength(2));
		const aborted = expect(probes[1]).rejects.toThrow(/abort/i);
		controllers[1]!.abort();
		await aborted;
		probes.push(probeSvgSource(file, controllers[2]!.signal));
		const invalid = expect(probes[2]).rejects.toThrow("Image source cannot be decoded");
		await vi.waitFor(() => expect(images).toHaveLength(3));
		images[2]!.fail(new Error("Malformed SVG"));
		await invalid;
		expect(revoke).toHaveBeenCalledTimes(3);
		expect(images.every((image) => image.src === "")).toBe(true);
	} finally {
		for (const controller of controllers) controller.abort();
		await Promise.allSettled(probes);
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	}
});
