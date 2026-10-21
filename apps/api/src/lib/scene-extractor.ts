import type { SceneOverrides } from "@maleo/shared";
import { runPrompt } from "./text-runner.ts";

// One-pass scene-field extractor, on the selected text provider. Returns an
// empty object when extraction fails so the rest of the pipeline
// still works, just less precise.

const SYSTEM = `You extract structured scene fields from a short image-generation prompt.
Return ONLY a JSON object inside a fenced \`\`\`json code block, with these optional keys (omit any you cannot infer):
- action          (string) what the subject is doing
- framing         (string) "full-body" | "half-body" | "closeup" | "wide" | "medium"
- angle           (string) eye-level / low / high / overhead / dutch / etc.
- time_of_day     (string) golden hour, blue hour, midnight, noon, etc.
- weather         (string) overcast, rain, fog, clear, etc.
- lighting        (string) describe key light direction and quality
- mood            (string) emotional tone
- gaze            (string) where the subject looks
- props           (string) notable items in scene
- location        (string) environment / setting

No prose outside the fenced block.`;

const TIMEOUT_MS = Number(process.env.SCENE_EXTRACTOR_TIMEOUT_MS ?? 30_000);
const DISABLED = process.env.SCENE_EXTRACTOR_DISABLED === "1";

export async function extractSceneOverrides(prompt: string): Promise<SceneOverrides> {
	if (DISABLED) return {};
	const trimmed = prompt.trim();
	if (trimmed.length < 3) return {};

	try {
		const { stdout } = await runPrompt(`${SYSTEM}\n\nPROMPT:\n${trimmed}\n`, {
			timeoutMs: TIMEOUT_MS,
		});
		return parseSceneJson(stdout);
	} catch (err) {
		console.warn(`[scene-extractor] failed: ${err instanceof Error ? err.message : err}`);
		return {};
	}
}

function parseSceneJson(stdout: string): SceneOverrides {
	// Extract fenced ```json ... ``` block if present, otherwise try the
	// first {...} JSON object in the output.
	let raw = stdout.trim();
	const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence?.[1]) {
		raw = fence[1].trim();
	} else {
		const obj = raw.match(/\{[\s\S]*\}/);
		if (obj) raw = obj[0];
	}
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
	const out: SceneOverrides = {};
	for (const k of [
		"action",
		"framing",
		"angle",
		"time_of_day",
		"weather",
		"lighting",
		"mood",
		"gaze",
		"props",
		"location",
	] as const) {
		const v = parsed[k];
		if (typeof v === "string" && v.trim()) out[k] = v.trim();
	}
	return out;
}
