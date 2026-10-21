/* The topics Security & Privacy is divided into.
 *
 * A list rather than one long scroll, for the same reason capabilities are:
 * these are four unrelated concerns — a key, an override report, a deployment
 * note, a raw table — and stacking them made the first one look like a preamble
 * to the rest.
 *
 * Each is addressable at `/settings/security/<id>`, so a support answer can link
 * straight to the override report rather than describing where to scroll.
 */
export const SECURITY_TOPICS = [
	{ id: "master-key", label: "Master key" },
	{ id: "overrides", label: "Environment overrides" },
	{ id: "worker", label: "Media worker" },
	{ id: "raw", label: "Raw environment keys" },
] as const;

export type SecurityTopicId = (typeof SECURITY_TOPICS)[number]["id"];

/* The topic a WIDE viewport opens on. A narrow one opens on the list instead —
 * see `useSettingsColumns` for why that difference exists at all. */
export const DEFAULT_SECURITY_TOPIC: SecurityTopicId = "master-key";

/* Returns null when the route names no topic. The caller decides whether to fill
 * one in, because that answer depends on how many columns are on screen. */
export function toSecurityTopic(value: string | undefined): SecurityTopicId | null {
	return SECURITY_TOPICS.find((topic) => topic.id === value)?.id ?? null;
}

export function securityTopicLabel(id: SecurityTopicId): string {
	return SECURITY_TOPICS.find((topic) => topic.id === id)?.label ?? id;
}
