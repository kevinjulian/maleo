import { Children, isValidElement, type ReactNode } from "react";
import { Select, type SelectProps } from "@design-system/components/select.tsx";
/* The AI provider control renders entirely from provider metadata.
 *
 * The property under test is that no model, thinking level, or provider name is
 * written into UI code. It is checked two ways, because either alone is weak:
 * by rendering metadata the component has never seen and asserting it appears,
 * and by scanning the source for the literals that would betray a hardcoded
 * list. The runners genuinely disagree about what they offer, so a hardcoded
 * union is wrong for every provider individually. */
import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	TextProviderSelect,
	choiceForProvider,
	type TextProviderOption,
	type TextProviderStatus,
} from "./text-provider-select.tsx";

function option(over: Partial<TextProviderOption> = {}): TextProviderOption {
	return {
		id: "codex",
		label: "Codex CLI",
		models: ["gpt-5.5"],
		thinking_levels: ["off", "low", "medium", "high"],
		health: "ready",
		health_reason: null,
		metered_per_token: false,
		context_tokens: 400_000,
		supported: true,
		...over,
	};
}

function status(over: Partial<TextProviderStatus> = {}): TextProviderStatus {
	return {
		selected: { providerId: "codex", model: "gpt-5.5", thinking: "medium" },
		effective_provider: "codex",
		selection_error: null,
		source: "settings",
		providers: [option()],
		...over,
	};
}

const render = (s: TextProviderStatus): string =>
	renderToStaticMarkup(<TextProviderSelect status={s} busy={false} onChange={() => {}} />);

function optionsFor(s: TextProviderStatus): string {
	const labels: string[] = [];
	function visit(node: ReactNode): void {
		Children.forEach(node, (child) => {
			if (!isValidElement<{ children?: ReactNode }>(child)) return;
			if (child.type === Select) {
				const props = child.props as SelectProps;
				labels.push(...props.options.map((option) => String(option.label)));
			} else visit(child.props.children);
		});
	}
	visit(TextProviderSelect({ status: s, busy: false, onChange: () => {} }));
	return labels.join(" ");
}

describe("options come from metadata, not from UI code", () => {
	it("a provider gaining a model shows it with no UI edit", () => {
		const html = optionsFor(
			status({
				providers: [option({ models: ["gpt-5.5", "gpt-6-brand-new"] })],
			}),
		);
		expect(html).toContain("gpt-6-brand-new");
	});

	it("a brand new provider renders without being named in this file", () => {
		const html = optionsFor(
			status({
				selected: { providerId: "nebula", model: "neb-1", thinking: "extreme" },
				effective_provider: "nebula",
				providers: [
					option({
						id: "nebula",
						label: "Nebula Runner",
						models: ["neb-1", "neb-2"],
						thinking_levels: ["extreme"],
					}),
				],
			}),
		);
		expect(html).toContain("Nebula Runner");
		expect(html).toContain("neb-2");
		expect(html).toContain("extreme");
	});

	it("shows only the levels the selected provider declares", () => {
		const html = render(
			status({
				selected: { providerId: "claude", model: "m", thinking: "max" },
				effective_provider: "claude",
				providers: [
					option({
						id: "claude",
						label: "Claude CLI",
						models: ["m"],
						// claude offers `max` and not `off`; codex the reverse.
						thinking_levels: ["low", "medium", "high", "max"],
					}),
				],
			}),
		);
		expect(html).toContain("max");
		expect(html).not.toContain(">off<");
	});

	it("no model name, level name, or provider id is a literal in the source", () => {
		const src = readFileSync(join(import.meta.dirname, "text-provider-select.tsx"), "utf8");
		// Provider ids and model names that must never be written here.
		for (const literal of ["gpt-5.5", "gpt-5-mini", "claude-opus", "codex", "kokoro"]) {
			expect(src).not.toContain(`"${literal}"`);
		}
		// Thinking levels likewise: the scale is normalized but which levels a
		// provider honors is per provider.
		for (const level of ["medium", "xhigh"]) {
			expect(src).not.toContain(`"${level}"`);
		}
	});
});

describe("selection stays internally consistent", () => {
	const providers = [
		option({ id: "a", models: ["a-1", "a-2"], thinking_levels: ["off", "low"] }),
		option({ id: "b", models: ["b-1"], thinking_levels: ["high", "max"] }),
	];

	it("changing provider resets model and level to the new provider's own", () => {
		// The bug this prevents: keeping "a-1" while switching to provider b, so
		// the stored selection names a model b has never heard of and fails at
		// the next generation rather than at the click.
		expect(choiceForProvider("b", providers)).toEqual({
			providerId: "b",
			model: "b-1",
			thinking: "high",
		});
	});

	it("never carries the previous provider's model across", () => {
		const next = choiceForProvider("b", providers);
		expect(providers.find((p) => p.id === "b")!.models).toContain(next.model!);
		expect(next.model).not.toBe("a-1");
		expect(next.thinking).not.toBe("off");
	});

	it("clearing the provider clears the whole choice", () => {
		expect(choiceForProvider("", providers)).toEqual({ providerId: "" });
	});

	it("an unknown provider id yields no model or level rather than a stale one", () => {
		expect(choiceForProvider("ghost", providers)).toEqual({
			providerId: "ghost",
			model: undefined,
			thinking: undefined,
		});
	});

	it("renders the model the server says is selected", () => {
		const html = render(
			status({ selected: { providerId: "codex", model: "gpt-5.5", thinking: "low" } }),
		);
		expect(html).toContain("gpt-5.5");
	});
});

describe("unavailable and unsupported providers explain themselves", () => {
	it("shows why a provider is unavailable, not just that it is", () => {
		const html = render(
			status({
				selected: null,
				effective_provider: "codex",
				providers: [
					option({
						health: "unconfigured",
						health_reason: "ANTHROPIC_API_KEY is not set",
					}),
				],
			}),
		);
		expect(html).toContain("ANTHROPIC_API_KEY is not set");
		expect(optionsFor(status({ providers: [option({ health: "unconfigured" })] }))).toContain(
			"unconfigured",
		);
	});

	it("an unhealthy provider cannot be picked", () => {
		const html = render(
			status({ providers: [option({ health: "down", health_reason: "endpoint unreachable" })] }),
		);
		expect(html).toContain("disabled");
	});

	it("warns that a metered provider bills per token", () => {
		const html = render(
			status({
				selected: { providerId: "api", model: "gpt-5.5", thinking: "low" },
				effective_provider: "api",
				providers: [option({ id: "api", label: "OpenAI-compatible API", metered_per_token: true })],
			}),
		);
		// Switching from a flat-rate CLI to an API key is otherwise a silent cost
		// change: nothing else in the UI moves.
		expect(html).toContain("bills per token");
	});

	it("does not warn about billing for a flat-rate provider", () => {
		expect(render(status())).not.toContain("bills per token");
	});

	it("marks a provider that has not passed the parity checks", () => {
		const html = render(
			status({
				selected: { providerId: "claude", model: "m", thinking: "low" },
				effective_provider: "claude",
				providers: [option({ id: "claude", label: "Claude CLI", supported: false })],
			}),
		);
		expect(html).toContain("unsupported");
		expect(html).toContain("has not passed the generation parity checks");
	});

	it("does not mark the supported default", () => {
		expect(render(status())).not.toContain("has not passed");
	});
});

/* Reachability: the control has to be mounted, not merely correct.
 *
 * This is the bug that shipped past every other test in this file. The
 * `detail("textProvider", …)` drill-in was added but the `ElementRow` that
 * opens it was not, so the panel rendered without an AI provider row at all
 * and the control was unreachable. Static render tests of the component pass
 * happily in that state — they render the component directly, which is exactly
 * what a user could not do. Found by opening the app.
 *
 * A source scan is a blunt instrument, but the invariant it encodes is real:
 * a `detail(key)` with no `ElementRow` opening that key is dead UI. */
describe("the control is reachable from the settings panel", () => {
	const panel = readFileSync(join(import.meta.dirname, "editor-settings.tsx"), "utf8");

	it("the AI provider row is mounted in the panel", () => {
		expect(panel).toContain('PropertyRow label="AI provider"');
	});

	it("provider ownership is inline without a detail", () => {
		expect(panel).toContain("Image and AI providers are managed by an instance owner");
		expect(panel).not.toContain('detail("textProvider"');
	});

	it("every settings detail has a row that opens it", () => {
		const detailKeys = [...panel.matchAll(/detail\("(\w+)"/g)].map((m) => m[1]!);
		const openKeys = new Set([...panel.matchAll(/actions\.open\("(\w+)"\)/g)].map((m) => m[1]!));
		const unreachable = detailKeys.filter((k) => !openKeys.has(k));
		expect(unreachable).toEqual([]);
	});
});
