/* A session's browser and system in words, from its user-agent string.
 * Deliberately coarse: enough to tell "my laptop" from "my phone" on the
 * sessions list, which is all the list is for. Unrecognised agents come back
 * as the raw string, truncated. */
const BROWSERS: ReadonlyArray<[RegExp, string]> = [
	[/Edg\//, "Edge"],
	[/OPR\//, "Opera"],
	[/Firefox\//, "Firefox"],
	[/Chrome\//, "Chrome"],
	[/Safari\//, "Safari"],
];
const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
	[/iPhone|iPad/, "iOS"],
	[/Android/, "Android"],
	[/Mac OS X|Macintosh/, "macOS"],
	[/Windows/, "Windows"],
	[/Linux/, "Linux"],
];
const RAW_MAX = 60;

export function describeAgent(agent: string | null): string {
	if (!agent) return "Unknown device";
	const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
	const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
	if (browser && system) return `${browser} on ${system}`;
	if (browser || system) return (browser ?? system)!;
	return agent.length > RAW_MAX ? `${agent.slice(0, RAW_MAX)}…` : agent;
}
