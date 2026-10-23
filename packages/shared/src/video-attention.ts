export type AttentionLayerKind =
	| "scene_cut"
	| "motion"
	| "caption"
	| "voiceover"
	| "text"
	| "sfx"
	| "effect";

export interface AttentionSpan {
	start: number;
	dur: number;
	kind: AttentionLayerKind;
	content?: string;
}

export interface AttentionFinding {
	code: "viewer_overload" | "semantic_stack" | "unreadable_text" | "duplicate_message";
	severity: "warning" | "blocker";
	startSec: number;
	endSec: number;
	message: string;
}

const WEIGHT = {
	scene_cut: 1.4,
	motion: 0.5,
	caption: 0.25,
	voiceover: 0.4,
	text: 1,
	sfx: 0.8,
	effect: 1,
} satisfies Readonly<Record<AttentionLayerKind, number>>;
const PRIMARY = new Set<AttentionLayerKind>(["text"]);

function active(span: AttentionSpan, sec: number): boolean {
	return sec >= span.start && sec < span.start + Math.max(0, span.dur);
}

export function attentionLoadPerSecond(
	totalSec: number,
	spans: readonly AttentionSpan[],
): number[] {
	return Array.from({ length: Math.max(1, Math.ceil(totalSec)) }, (_, sec) => {
		const score = spans.reduce((sum, span) => {
			if (span.kind === "scene_cut" || span.kind === "sfx" || span.kind === "effect") {
				return sum + (span.start >= sec && span.start < sec + 1 ? WEIGHT[span.kind] : 0);
			}
			return sum + (active(span, sec) ? WEIGHT[span.kind] : 0);
		}, 0);
		return Math.round(score * 100) / 100;
	});
}

function words(value: string): string[] {
	return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function similarity(a: string, b: string): number {
	const left = new Set(words(a));
	const right = new Set(words(b));
	if (!left.size || !right.size) return 0;
	const shared = [...left].filter((word) => right.has(word)).length;
	return shared / Math.min(left.size, right.size);
}

export function lintAttention(
	totalSec: number,
	spans: readonly AttentionSpan[],
): AttentionFinding[] {
	const findings: AttentionFinding[] = [];
	const load = attentionLoadPerSecond(totalSec, spans);
	let run = -1;
	for (let sec = 0; sec <= load.length; sec++) {
		const overloaded = sec < load.length && (load[sec] ?? 0) >= 4.2;
		if (overloaded && run < 0) run = sec;
		if (!overloaded && run >= 0) {
			if (sec - run >= 2)
				findings.push({
					code: "viewer_overload",
					severity: "blocker",
					startSec: run,
					endSec: sec,
					message: `${sec - run}s carries too many simultaneous viewer cues.`,
				});
			else
				findings.push({
					code: "viewer_overload",
					severity: "warning",
					startSec: run,
					endSec: sec,
					message: "Short attention spike; verify it is intentional.",
				});
			run = -1;
		}
	}

	for (let sec = 0; sec < Math.ceil(totalSec); sec++) {
		const primary = spans.filter((span) => PRIMARY.has(span.kind) && active(span, sec));
		if (primary.length > 1)
			findings.push({
				code: "semantic_stack",
				severity: "blocker",
				startSec: sec,
				endSec: sec + 1,
				message: `${primary.length} primary overlays compete in the same second.`,
			});
	}

	const voice = spans.filter((span) => span.kind === "voiceover" && span.content?.trim());
	for (const text of spans.filter((span) => span.kind === "text" && span.content?.trim())) {
		const count = words(text.content!).length;
		if (count / 2.5 > text.dur)
			findings.push({
				code: "unreadable_text",
				severity: "blocker",
				startSec: text.start,
				endSec: text.start + text.dur,
				message: `${count} words cannot be read comfortably in ${text.dur.toFixed(1)}s.`,
			});
		if (count < 8) continue;
		const duplicate = voice.find(
			(vo) =>
				vo.start < text.start + text.dur &&
				vo.start + vo.dur > text.start &&
				similarity(text.content!, vo.content!) >= 0.7,
		);
		if (duplicate)
			findings.push({
				code: "duplicate_message",
				severity: "warning",
				startSec: text.start,
				endSec: text.start + text.dur,
				message: "Long on-screen text repeats active voiceover; keep only anchor words.",
			});
	}

	const unique = new Map<string, AttentionFinding>();
	for (const finding of findings)
		unique.set(`${finding.code}:${finding.startSec}:${finding.endSec}`, finding);
	return [...unique.values()].sort(
		(a, b) => a.startSec - b.startSec || a.code.localeCompare(b.code),
	);
}
