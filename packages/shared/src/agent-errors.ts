export type AgentErrorKind =
	| "timeout"
	| "cancelled"
	| "interrupted"
	| "configuration"
	| "validation"
	| "unknown";

export interface AgentErrorInfo {
	kind: AgentErrorKind;
	code: string;
	title: string;
	message: string;
	retryable: boolean;
	technicalDetail?: string;
}

function cleanDetail(message: string): string {
	return message.replace(/^error:\s*/i, "").trim();
}

export function classifyAgentError(
	message: string,
	opts?: { technicalDetail?: string },
): AgentErrorInfo {
	const detail = cleanDetail(message);
	const lower = detail.toLowerCase();
	if (lower.includes("exit 143") || lower.includes("timed out") || lower.includes("timeout")) {
		return {
			kind: "timeout",
			code: "timeout",
			title: "Planning timed out",
			message:
				"Blueprint generator took too long and was stopped. Project is saved; retry planning or shorten scope.",
			retryable: true,
			technicalDetail: opts?.technicalDetail ?? detail,
		};
	}
	if (
		lower.includes("run stopped by user") ||
		lower.includes("cancelled") ||
		lower.includes("canceled")
	) {
		return {
			kind: "cancelled",
			code: "cancelled",
			title: "Run stopped",
			message: "Generation was stopped. Project is saved.",
			retryable: true,
			technicalDetail: opts?.technicalDetail ?? detail,
		};
	}
	if (lower.includes("interrupted") || lower.includes("restart")) {
		return {
			kind: "interrupted",
			code: "interrupted",
			title: "Run interrupted",
			message: "Server restarted before this run finished. Resume from saved progress.",
			retryable: true,
			technicalDetail: opts?.technicalDetail ?? detail,
		};
	}
	if (
		lower.includes("not configured") ||
		lower.includes("missing") ||
		lower.includes("unavailable")
	) {
		return {
			kind: "configuration",
			code: "configuration",
			title: "Setup needed",
			message: "A required generator or worker is unavailable. Fix setup, then retry.",
			retryable: true,
			technicalDetail: opts?.technicalDetail ?? detail,
		};
	}
	if (
		lower.includes("invalid args") ||
		lower.includes("required") ||
		lower.includes("validation")
	) {
		return {
			kind: "validation",
			code: "validation",
			title: "Request needs revision",
			message: "Generator rejected part of the request. Revise the brief or settings, then retry.",
			retryable: true,
			technicalDetail: opts?.technicalDetail ?? detail,
		};
	}
	return {
		kind: "unknown",
		code: "unknown",
		title: "Generation failed",
		message: "Generation stopped before finishing. Project is saved; retry or adjust the request.",
		retryable: true,
		technicalDetail: opts?.technicalDetail ?? detail,
	};
}
