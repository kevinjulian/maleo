// @vitest-environment happy-dom
/* The clarification card's contract with the server: it submits one complete
 * batch or it submits nothing, it never invents an answer, and a keyboard user
 * can complete it without a pointer. */
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ClarificationCard } = await import("./chat-clarification-card.tsx");
import type { ReactElement } from "react";
import type { StoryClarificationBatch, StoryClarificationSubmission } from "@maleo/shared";

const batch: StoryClarificationBatch = {
	id: "batch-1",
	stage: "pre_research",
	purpose: "story_brief",
	intro: "A few decisions before I plan this story.",
	questions: [
		{
			id: "audience",
			header: "Audience",
			question: "Who is this for?",
			options: [
				{
					id: "leaders",
					label: "Team leaders",
					value: "team leaders",
					description: "Frames tradeoffs.",
					recommended: true,
				},
				{
					id: "newcomers",
					label: "Newcomers",
					value: "newcomers",
					description: "Defines terms first.",
				},
			],
		},
		{
			id: "context",
			header: "Example context",
			question: "Which example should it build on?",
			options: [
				{
					id: "harbour",
					label: "A harbour",
					value: "a working harbour",
					description: "Grounds it in one place.",
					recommended: true,
				},
				{
					id: "lab",
					label: "A lab model",
					value: "a lab tide model",
					description: "Keeps it abstract.",
				},
			],
		},
	],
};

let unmount: (() => void) | undefined;

function mount(element: ReactElement): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(element));
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	return host;
}

function card(
	overrides: {
		locked?: boolean;
		busy?: boolean;
		onSubmit?: (submission: StoryClarificationSubmission) => void;
	} = {},
) {
	const sent: StoryClarificationSubmission[] = [];
	const host = mount(
		createElement(ClarificationCard, {
			batch,
			locked: overrides.locked ?? false,
			busy: overrides.busy ?? false,
			onSubmit:
				overrides.onSubmit ??
				((submission: StoryClarificationSubmission) => {
					sent.push(submission);
				}),
		}),
	);
	return { host, sent };
}

const radios = (host: HTMLElement): HTMLInputElement[] => [
	...host.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];
const button = (host: HTMLElement, label: string): HTMLButtonElement =>
	[...host.querySelectorAll("button")].find((node) => node.textContent?.includes(label))!;
const click = (node: HTMLElement): void => {
	act(() => {
		node.click();
	});
};

/* React tracks an input's value itself, so assigning `.value` directly is
 * invisible to it. Going through the prototype setter is how a typed value
 * reaches the component — the same thing a real keystroke does. */
function type(input: HTMLInputElement, text: string): void {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
	act(() => {
		input.focus();
		setter?.call(input, text);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
	document.body.replaceChildren();
	window.localStorage.clear();
});

describe("rendering", () => {
	test("each question is a labelled single-choice group with descriptions", () => {
		const { host } = card();
		const groups = host.querySelectorAll("fieldset");
		expect(groups).toHaveLength(2);
		expect(groups[0]!.querySelector("legend")?.textContent).toContain("Who is this for?");
		expect(groups[0]!.querySelector("legend")?.textContent).toContain("Audience");
		expect(host.textContent).toContain("Frames tradeoffs.");
		// One radio group per question: the name scopes the choice.
		const names = new Set(radios(host).map((radio) => radio.name));
		expect(names.size).toBe(2);
	});

	test("exactly one option per question is marked recommended", () => {
		const { host } = card();
		expect(host.querySelectorAll(".fc-clarify-rec")).toHaveLength(2);
	});

	test("every option and the Other input carry an accessible name", () => {
		const { host } = card();
		for (const radio of radios(host)) {
			const label = host.querySelector(`label[for="${radio.id}"]`);
			expect(label).not.toBeNull();
		}
		expect(
			host.querySelector<HTMLInputElement>('input[type="text"]')?.getAttribute("aria-label"),
		).toContain("Audience");
	});

	test("focus enters the batch when it appears", () => {
		const { host } = card();
		expect(document.activeElement).toBe(radios(host)[0]!);
	});

	test("focus is NOT stolen from someone mid-sentence", () => {
		// A run parks while the composer holds a half-written thought.
		const composer = document.createElement("textarea");
		document.body.append(composer);
		composer.focus();

		const { host } = card();
		expect(document.activeElement).toBe(composer);
		expect(radios(host)[0]!).not.toBe(document.activeElement);
		composer.remove();
	});

	/* A label wrapping its OWN control is standard. A label wrapping a SECOND
	 * control is the fragile shape — it only behaves because activation does not
	 * forward through an interactive descendant. */
	test("no label wraps a control other than the one it names", () => {
		const { host } = card();
		for (const label of host.querySelectorAll("label")) {
			const nested = [...label.querySelectorAll<HTMLElement>("input, button, select, textarea")];
			const strays = nested.filter((control) => control.id !== label.htmlFor);
			expect(strays.map((control) => control.getAttribute("aria-label") ?? control.id)).toEqual([]);
		}
		// The Other radio still has a label, and the text field its own name.
		expect(host.querySelector('label[for$="-other"]')?.textContent).toBe("Something else");
		expect(host.querySelectorAll('input[type="text"][aria-label]')).toHaveLength(2);
	});
});

describe("submitting", () => {
	test("a complete option answer submits one structured payload", () => {
		const { host, sent } = card();
		click(radios(host).find((radio) => radio.value === "newcomers")!);
		click(radios(host).find((radio) => radio.value === "lab")!);
		click(button(host, "Use these answers"));
		expect(sent).toEqual([
			{
				batchId: "batch-1",
				answers: [
					{ questionId: "audience", optionId: "newcomers" },
					{ questionId: "context", optionId: "lab" },
				],
			},
		]);
	});

	test("an Other answer submits its text", () => {
		const { host, sent } = card();
		click(radios(host).find((radio) => radio.value === "leaders")!);
		type(
			host.querySelectorAll<HTMLInputElement>('input[type="text"]')[1]!,
			"a tidal power station",
		);
		click(button(host, "Use these answers"));
		expect(sent[0]?.answers).toEqual([
			{ questionId: "audience", optionId: "leaders" },
			{ questionId: "context", otherText: "a tidal power station" },
		]);
	});

	test("best judgment submits delegation without inventing answers", () => {
		const { host, sent } = card();
		click(button(host, "Use your best judgment"));
		expect(sent).toEqual([{ batchId: "batch-1", bestJudgment: true }]);
	});

	test("an unanswered question blocks submission, shows feedback and moves focus to it", () => {
		const { host, sent } = card();
		click(radios(host).find((radio) => radio.value === "newcomers")!);
		click(button(host, "Use these answers"));
		expect(sent).toHaveLength(0);
		const alert = host.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain("Choose an option");
		// Focus lands on the first group that still needs an answer.
		expect(document.activeElement).toBe(radios(host).find((radio) => radio.value === "harbour")!);
		expect(host.querySelectorAll(".fc-clarify-invalid")).toHaveLength(1);
	});

	test("Other selected with blank text is not an answer", () => {
		const { host, sent } = card();
		click(radios(host).find((radio) => radio.value === "leaders")!);
		click(radios(host).filter((radio) => radio.value === "__other__")[1]!);
		click(button(host, "Use these answers"));
		expect(sent).toHaveLength(0);
		expect(host.querySelector('[role="alert"]')).not.toBeNull();
	});

	test("a keyboard user can answer and submit without a pointer", () => {
		const { host, sent } = card();
		// Selecting a radio by keyboard is a change on the focused input; every
		// control is natively focusable, so Tab order needs no interception.
		const focusables = [...host.querySelectorAll<HTMLElement>("input, button")];
		expect(focusables.every((node) => node.tabIndex >= 0)).toBe(true);
		for (const value of ["leaders", "harbour"]) {
			const radio = radios(host).find((node) => node.value === value)!;
			// Pressing Space on a focused radio is a click — no pointer involved.
			act(() => {
				radio.focus();
				radio.click();
			});
			expect(document.activeElement).toBe(radio);
		}
		const submit = button(host, "Use these answers");
		act(() => {
			submit.focus();
			submit.click();
		});
		expect(sent[0]?.answers).toHaveLength(2);
	});
});

describe("pending selections and locking", () => {
	test("a selection survives a reload of the same batch", () => {
		const first = card();
		click(radios(first.host).find((radio) => radio.value === "newcomers")!);
		unmount?.();
		unmount = undefined;
		document.body.replaceChildren();

		const second = card();
		expect(radios(second.host).find((radio) => radio.value === "newcomers")!.checked).toBe(true);
	});

	test("an accepted or superseded card keeps its answers and closes its controls", () => {
		const first = card();
		click(radios(first.host).find((radio) => radio.value === "newcomers")!);
		unmount?.();
		unmount = undefined;
		document.body.replaceChildren();

		const { host } = card({ locked: true });
		expect(radios(host).find((radio) => radio.value === "newcomers")!.checked).toBe(true);
		expect(radios(host).every((radio) => radio.disabled)).toBe(true);
		expect(button(host, "Use these answers")).toBeUndefined();
		expect(host.textContent).toContain("Answered.");
	});

	test("stored drafts are bounded, so abandoned batches cannot pile up forever", () => {
		// A card superseded rather than submitted clears nothing, so the store has to
		// bound itself. Six batches are drafted; the oldest is the one that falls out.
		for (let index = 0; index < 6; index++) {
			const host = mount(
				createElement(ClarificationCard, {
					batch: { ...batch, id: `batch-${index}` },
					locked: false,
					busy: false,
					onSubmit: () => {},
				}),
			);
			click(radios(host).find((radio) => radio.value === "newcomers")!);
			unmount?.();
			unmount = undefined;
			document.body.replaceChildren();
		}
		const stored = JSON.parse(
			window.localStorage.getItem("maleo.clarification.drafts") ?? "{}",
		) as Record<string, unknown>;
		expect(Object.keys(stored)).toEqual(["batch-1", "batch-2", "batch-3", "batch-4", "batch-5"]);
	});

	test("a busy card cannot be submitted twice", () => {
		const { host } = card({ busy: true });
		expect(button(host, "Use these answers").disabled).toBe(true);
		expect(button(host, "Use your best judgment").disabled).toBe(true);
	});
});

/* A post-research batch is the same card with the same contract. What it adds is
 * evidence: options that rest on retrieved sources show which, because a user
 * cannot judge "which case study" without seeing the studies. */
describe("a post-research batch shows the sources behind an option", () => {
	const sourced: StoryClarificationBatch = {
		id: "post-1",
		stage: "post_research",
		purpose: "story_brief",
		intro: "The sources disagree on one thing.",
		questions: [
			{
				id: "case",
				header: "Case study",
				question: "Which fund should the video follow?",
				options: [
					{
						id: "ohio",
						label: "Ohio",
						value: "Follow the Ohio fund",
						description: "A high-return fund.",
						recommended: true,
						sources: [{ title: "Ohio pension study", url: "https://example.test/ohio" }],
					},
					{
						id: "vt",
						label: "Vermont",
						value: "Follow the Vermont fund",
						description: "A low-return counterexample.",
					},
				],
			},
		],
	};

	function sourcedCard() {
		const sent: StoryClarificationSubmission[] = [];
		const host = mount(
			createElement(ClarificationCard, {
				batch: sourced,
				locked: false,
				busy: false,
				onSubmit: (submission: StoryClarificationSubmission) => {
					sent.push(submission);
				},
			}),
		);
		return { host, sent };
	}

	test("a sourced option links to the page the run actually read", () => {
		const { host } = sourcedCard();

		const links = [...host.querySelectorAll<HTMLAnchorElement>("a.fc-clarify-opt-source")];
		expect(links).toHaveLength(1);
		expect(links[0]?.textContent).toBe("Ohio pension study");
		expect(links[0]?.getAttribute("href")).toBe("https://example.test/ohio");
		// Opened away from the editor, without handing the target window an opener.
		expect(links[0]?.getAttribute("target")).toBe("_blank");
		expect(links[0]?.getAttribute("rel")).toContain("noopener");
	});

	test("an option with no sources renders none", () => {
		const { host } = sourcedCard();

		const bodies = [...host.querySelectorAll(".fc-clarify-opt-body")];
		expect(bodies[1]?.querySelector("a.fc-clarify-opt-source")).toBeNull();
	});

	test("it still submits the ordinary answer contract", () => {
		const { host, sent } = sourcedCard();

		click(radios(host)[1]!); // Vermont
		click(button(host, "Use these answers"));

		expect(sent).toHaveLength(1);
		expect(sent[0]).toEqual({
			batchId: "post-1",
			answers: [{ questionId: "case", optionId: "vt" }],
		});
	});
});
