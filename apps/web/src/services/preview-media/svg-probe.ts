let queue = Promise.resolve();

/** SVG needs the DOM image decoder. Probe complete local bytes, one source at a time. */
export function probeSvgSource(file: File, signal: AbortSignal): Promise<void> {
	const probe = queue.then(async () => {
		signal.throwIfAborted();
		const url = URL.createObjectURL(file);
		const image = new Image();
		const abort = () => {
			image.src = "";
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			image.src = url;
			await image.decode();
			signal.throwIfAborted();
			if (!image.naturalWidth || !image.naturalHeight) throw new Error("Invalid image dimensions");
			const bitmap = await createImageBitmap(image, { resizeWidth: 1, resizeHeight: 1 });
			bitmap.close();
			signal.throwIfAborted();
		} catch {
			signal.throwIfAborted();
			throw new Error("Image source cannot be decoded");
		} finally {
			signal.removeEventListener("abort", abort);
			image.src = "";
			URL.revokeObjectURL(url);
		}
	});
	queue = probe.catch(() => {});
	return probe;
}
