import type { LoadedProjectDetail } from "./parse-loaded-project.ts";

export function baseDetail(
	over: Partial<LoadedProjectDetail["project"]>,
	storyboard: Record<string, unknown> | null,
): LoadedProjectDetail {
	return {
		project: {
			id: "p1",
			title: "T",
			type: "video",
			target_audience: null,
			target_duration_sec: null,
			target_format: null,
			target_platform: null,
			brief_json: null,
			...over,
		},
		storyboards: storyboard ? [{ storyboard_json: storyboard }] : [],
	};
}
