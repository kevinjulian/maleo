/* Label the published library with a model.
 *
 * Runs over the compiled source manifest, between compiling and publishing:
 *
 *   fetch:manifest → compile:manifest → ENRICH → publish:music
 *
 * Separate from publishing on purpose. That step is about AUDIO — bytes,
 * hashes, uploads. This is about WORDS, and the words describe a bed rather
 * than a file, so enriching touches no audio at all.
 *
 * It reads and writes a local file rather than the published library. Labelling
 * before publishing means the manifest that goes up is already complete, and a
 * bad run costs nothing but a re-run — where writing straight to B2 would put
 * every mistake live.
 *
 *   bun run enrich:music              # label what is missing labels
 *   bun run enrich:music -- --force   # relabel everything
 *   bun run enrich:music -- --dry-run # print what would change, write nothing
 *
 * The labels come from the `pi` assistant on this machine, not from a hosted
 * API. That is one fewer key to hold, and it is the same shape the repo already
 * uses for generation: a CLI subprocess, not an SDK. It also means whichever
 * provider pi is already configured for is the one that answers, so there is no
 * second place to configure a model.
 *
 * Needs `pi` on PATH. No credentials: nothing here talks to B2.
 *
 * The manifest is its own cache: a bed carrying both labels is never sent
 * again, so a second run costs nothing and produces the same file. Beds carried
 * over from the published library arrive already labelled, so only genuinely
 * new ones are paid for.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EMOTIONS } from "@maleo/shared";
import {
	applyEnrichment,
	buildEnrichPrompt,
	buildLabelCommand,
	describeEnrichPlan,
	parseEnrichment,
	planEnrich,
	type EnrichableBed,
} from "../src/music-enrich.ts";

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);
const arg = (name: string): string | undefined =>
	process.argv
		.find((v) => v.startsWith(`--${name}=`))
		?.split("=")
		.slice(1)
		.join("=");

const COMMAND = buildLabelCommand({
	command: process.env.MALEO_LABEL_CLI,
	model: arg("model") ?? process.env.MALEO_LABEL_MODEL,
	provider: arg("provider") ?? process.env.MALEO_LABEL_PROVIDER,
});

interface SourceManifest {
	tracks?: EnrichableBed[];
}

/** One bed, one invocation. Fresh each time: labelling bed N must not be
 *  influenced by the answer given for bed N-1, which is what a shared session
 *  would allow — and beds are labelled in whatever order the manifest lists
 *  them, so that influence would not even be reproducible. */
async function label(bed: EnrichableBed): Promise<string> {
	const proc = Bun.spawn(COMMAND, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	await proc.stdin.write(buildEnrichPrompt(bed));
	await proc.stdin.end();
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	if (proc.exitCode !== 0)
		throw new Error(
			`${COMMAND[0]} exited ${proc.exitCode}: ${stderr.trim().split("\n").at(-1) ?? ""}`,
		);
	return stdout;
}

async function main(): Promise<void> {
	const dryRun = hasFlag("dry-run");
	if (!Bun.which(COMMAND[0]!)) {
		console.error(`Labelling runs the local assistant \`${COMMAND[0]}\`, which is not on PATH.`);
		console.error("Install it, or point MALEO_LABEL_CLI at the binary.");
		process.exit(1);
	}

	const path = resolve(arg("manifest") ?? join(arg("source") ?? "music-source", "manifest.json"));
	if (!existsSync(path)) {
		console.error(`No ${path}. Run: bun run compile:manifest`);
		process.exit(1);
	}
	// SAFETY: the manifest is written by `compile-manifest.ts` in this package.
	const manifest = JSON.parse(await readFile(path, "utf8")) as SourceManifest;
	const tracks = manifest.tracks ?? [];
	if (!tracks.length) {
		console.error(`${path} lists no beds.`);
		process.exit(1);
	}

	const plan = planEnrich(tracks, { force: hasFlag("force") });
	console.log(`${tracks.length} bed(s) in the manifest. ${describeEnrichPlan(plan)}.`);
	if (!plan.pending.length) {
		console.log("Nothing to do.");
		return;
	}
	console.log(`Labelling with: ${COMMAND.join(" ")}\n`);

	const labelled = new Map<string, EnrichableBed>();
	let failed = 0;

	for (const bed of plan.pending) {
		try {
			const enrichment = parseEnrichment(await label(bed));
			if (!enrichment) {
				console.warn(`  unusable  ${bed.title} — model returned nothing parseable`);
				failed++;
				continue;
			}
			const next = applyEnrichment(bed, enrichment);
			labelled.set(bed.source, next);
			console.log(`  labelled  ${bed.title}`);
			console.log(`            ${next.emotion ?? "(no emotion)"} — ${next.description ?? ""}`);
		} catch (error) {
			console.warn(
				`  failed    ${bed.title} — ${error instanceof Error ? error.message : String(error)}`,
			);
			failed++;
		}
	}

	if (!labelled.size) {
		console.error("\nNothing was labelled. Manifest left untouched.");
		process.exit(1);
	}

	// Rebuilt in order, from the original entries: every field this script does
	// not understand rides through unchanged.
	const next = tracks.map((bed) => labelled.get(bed.source) ?? bed);
	const withoutEmotion = next.filter((bed) => !bed.emotion).length;

	if (dryRun) {
		console.log(`\nDry run — ${labelled.size} bed(s) would change. ${path} not written.`);
		return;
	}

	await writeFile(path, `${JSON.stringify({ ...manifest, tracks: next }, null, 2)}\n`);

	console.log(`\nLabelled ${labelled.size}, failed ${failed}. Wrote ${path}.`);
	if (withoutEmotion) {
		console.log(
			`${withoutEmotion} bed(s) still carry no emotion — the model declined rather than guessing.`,
		);
		console.log(`Set one by hand if a bed clearly serves one of: ${EMOTIONS.join(", ")}.`);
	}
	console.log("Next: bun run publish:music");
}

await main();
