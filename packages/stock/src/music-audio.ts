/* What publishing needs to know about an audio file it is not going to modify.
 *
 * Beds are uploaded exactly as downloaded — nothing is transcoded, nothing is
 * loudness-normalised, and nothing is refused for its length. What is left is
 * measurement: the manifest carries a duration, and the resolver uses it to
 * prefer a bed long enough to hold a section over one that will loop often.
 *
 * Duration cannot be known without decoding, so the test generates a tone with
 * ffmpeg and measures it rather than asserting on the command line that was
 * built — a test that only checked arguments would keep passing if a flag
 * changed meaning. */

/** Only ffprobe is needed now: nothing is re-encoded. Its absence is a warning
 *  rather than a failure — a manifest without durations still resolves, it just
 *  loses the length check and one tie-break. */
export function hasAudioTools(): boolean {
	return Boolean(Bun.which("ffprobe"));
}

async function run(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	return { code: proc.exitCode ?? 1, stdout, stderr };
}

export async function probeDurationSec(path: string): Promise<number> {
	const { stdout } = await run([
		"ffprobe",
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"csv=p=0",
		path,
	]);
	const seconds = Number.parseFloat(stdout.trim());
	return Number.isFinite(seconds) ? seconds : 0;
}

export function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "bed"
	);
}
