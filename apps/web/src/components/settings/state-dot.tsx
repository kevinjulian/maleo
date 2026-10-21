/* Readiness as one mark.
 *
 * Three states, not two, because they are three different operator actions:
 * nothing to do, set it up, fix it. The API's richer statuses collapse to these
 * here; the detail lives on the provider's own page, which is what lets a list
 * row stay one line.
 */
import type { JSX } from "react";

export type DotState = "ready" | "not_configured" | "unconfigured" | "down";

const LABELS = {
	ready: "Ready",
	not_configured: "Not set up",
	unconfigured: "Not configured",
	down: "Unreachable",
} satisfies Record<DotState, string>;

export function StateDot({ state, title }: { state: DotState; title?: string }): JSX.Element {
	/* Written out rather than composed into `settings-dot-${tone}`: a class built
	 * at runtime is invisible to the layer check and to anyone grepping for where
	 * a rule is used, which is exactly how a live rule gets reported as dead. */
	const tone =
		state === "ready"
			? "settings-dot-ok"
			: state === "down"
				? "settings-dot-err"
				: "settings-dot-idle";
	return (
		<span
			className={`settings-dot ${tone}`}
			role="img"
			aria-label={title ?? LABELS[state]}
			title={title ?? LABELS[state]}
		/>
	);
}
