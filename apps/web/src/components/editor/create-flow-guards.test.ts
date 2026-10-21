/* Structural guards for the create flow, asserted by reading source text.
 *
 * These are NOT unit tests and they deliberately break the one-subject-per-file
 * rule: each one pins a decision that spans several modules — which rail owns a
 * panel, which surface may start a run, what the launcher form is allowed to
 * ask for. They were extracted from `create-content.test.ts`, which had grown to
 * cover five modules across three layers.
 *
 * They read source because the facts they pin are not reachable from an export:
 * the rail lists are inline JSX inside `timeline-editor.tsx` and the launcher
 * copy is inline markup. Converting them into behavioural assertions means
 * exporting those lists first, which is a refactor of the components rather
 * than of the tests.
 *
 * Two consequences worth knowing before touching this file:
 *   - Every path here is a literal. A rename or a move breaks all of them at
 *     once, and a wrong path makes `readFileSync` throw rather than silently
 *     pass — which is the one good property this style has.
 *   - A guard asserting the ABSENCE of a symbol dies quietly when the symbol is
 *     deleted everywhere. One had: `generateContentDraft` no longer existed
 *     anywhere in the repo, so the guard could not fail and could not catch a
 *     reintroduction under any other name. It was removed rather than kept.
 */
import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* Paths are written against the role tree, because a guard that reads source
 * has to name a location and these span several. `@role/...` resolves from
 * src/; a bare name is a sibling in this directory. */
const SRC = resolve(import.meta.dirname, "../..");
const read = (rel: string): string =>
	readFileSync(
		rel.startsWith("@") ? resolve(SRC, rel.slice(1)) : resolve(import.meta.dirname, rel),
		"utf8",
	);

describe("create flow structure", () => {
	it("creates projects without queuing an initial agent run from setup", () => {
		// The create path moved to its own page and hook when /create stopped
		// sharing a component with the editor, which makes this guard stronger
		// than it was: the form cannot queue a run because the form cannot reach
		// the agent at all. Asserted against the whole page, not a slice of one
		// function.
		const form = read("@pages/create-form.tsx") + read("project-setup.tsx");
		const hook = read("@hooks/editor/use-create-project.ts");
		expect(hook.includes("createProject(")).toBe(true);
		expect(form.includes("setPendingInitial")).toBe(false);
		expect(form.includes("useChatSession")).toBe(false);
		expect(form.includes("useAgentApply")).toBe(false);
		expect(form.includes("useInitialRun")).toBe(false);
	});

	it("requires title and keeps setup description separate from generation", () => {
		const launcher = read("launcher.tsx");
		const createHook = read("@hooks/editor/use-create-project.ts");
		const api = read("@api/projects.ts");
		const documentWire = read("@models/storyboard/document-wire.ts");
		expect(launcher.includes("const titleReady = title.trim().length > 0")).toBe(true);
		expect(launcher.includes("disabled={!titleReady || busy}")).toBe(true);
		expect(launcher.includes('<span className="cv-field-tag required">Required</span>')).toBe(true);
		expect(launcher.includes('<span className="cv-field-tag">Optional</span>')).toBe(true);
		expect(launcher.includes("Brief / prompt")).toBe(false);
		expect(launcher.includes("Duration")).toBe(false);
		expect(launcher.includes("Description")).toBe(true);
		expect(createHook.includes("const initialChat: ChatLogMessage[] = []")).toBe(true);
		expect(api.includes("reference_notes: description")).toBe(true);
		expect(documentWire.includes("goal: config.description")).toBe(false);
	});

	it("keeps storyboard generation as an explicit video-editor action", () => {
		const create = read("create-content.tsx");
		const chat = read("editor-chat.tsx");
		expect(create.includes("const generateStoryboardFromBrief")).toBe(true);
		expect(create.includes("onGenerateStoryboard")).toBe(false);
		expect(create.includes("cv-btn cv-btn-ai sm")).toBe(false);
		expect(chat.includes("Generate storyboard")).toBe(true);
		expect(create.includes("Add media or generate a storyboard before exporting.")).toBe(true);
	});

	/* The lane rule used to be asserted by reading this component's source for a
	 * literal. It is a real test now, on the module that owns the merge — see
	 * apply-agent-job.test.ts, "audio keeps its semantic lane". */
	it("keeps approval in the question card, not in a plan card", () => {
		const outputs = read("chat-output-cards.tsx");
		const pinned = read("chat-pinned-decision.tsx");
		const cards = read("chat-run-cards.tsx");
		expect(outputs.includes("function approvalLabel")).toBe(true);
		expect(outputs.includes("Approve & generate")).toBe(true);
		expect(pinned.includes("approvalLabel(option.label, option.value)")).toBe(true);
		expect(cards.includes("Approve all: generate the approved story plan assets.")).toBe(false);
	});

	/* The wiring that makes a rejected plan revisable at all. The composer normally
	 * starts a FRESH run, which would discard the parked run's frame, skeleton and
	 * retrieved sources — so a `freeText` question offers an explicit Reply, and
	 * only while that `Replying to` mode is visible does composer text answer the
	 * parked gate. Without it, text never reaches the parked run. */
	it("routes free text to the parked run only through explicit reply mode", () => {
		const chat = read("editor-chat.tsx");
		const pinned = read("chat-pinned-decision.tsx");
		const composer = read("chat-composer-box.tsx");
		const outputs = read("chat-output-cards.tsx");
		const model = read("@models/chat/chat-log.ts");
		const agent = read("@hooks/editor/use-content-agent.ts");
		expect(model.includes("freeText?: boolean")).toBe(true);
		expect(agent.includes("freeText: ev.freeText")).toBe(true);
		expect(chat).toMatch(
			/const replying =\s*replyTo != null && pendingQuestion\?\.actionId === replyTo && Boolean\(pendingQuestion\?\.freeText\)/,
		);
		expect(chat.includes("if (replying) {")).toBe(true);
		expect(chat.includes("matchQuestionOption")).toBe(false);
		expect(composer.includes("Replying to")).toBe(true);
		// And the operator is told the structure survives the revision.
		expect(pinned.includes("the plan keeps its structure and sources")).toBe(true);
		expect(outputs.includes("Find more sources")).toBe(true);
	});

	/* A clarification batch is answered by its own card, never by the composer.
	 * `freeText` is still the ONLY thing that captures typing — a pending batch
	 * leaves the composer starting a new command, which is what keeps a half-typed
	 * thought from resolving a required action. */
	it("leaves the composer starting a new command while a batch is pending", () => {
		const chat = read("editor-chat.tsx");
		const model = read("@models/chat/chat-log.ts");
		const agent = read("@hooks/editor/use-content-agent.ts");
		expect(model.includes("batch?: StoryClarificationBatch")).toBe(true);
		expect(agent.includes("batch: ev.batch")).toBe(true);
		// The batch reaches the server as a structured submission, not as prose.
		expect(chat.includes("const answerBatch = (submission: StoryClarificationSubmission)")).toBe(
			true,
		);
		expect(chat.includes("onAnswerQuestion(jobId, value, actionId, submission)")).toBe(true);
		// Composer capture is keyed on explicit reply mode for a freeText question alone.
		expect(chat.includes("pending?.batch")).toBe(false);
		expect([...chat.matchAll(/pendingQuestion\?\.freeText/g)]).toHaveLength(1);
	});

	/* One rendering, two surfaces. The story plan card shows a planned section's
	 * sources at approval; the script shows a scene's while prose is edited. They
	 * showed the same thing two ways before the component moved, and a citation
	 * that reads differently depending on where you look at it is worse than one
	 * that reads the same in both. */
	it("renders citations through one shared component in both surfaces", () => {
		const cards = read("chat-story-plan.tsx");
		const table = read("@components/script/script-table.tsx");
		const shared = read("@components/research/source-links.tsx");
		expect(shared.includes("export function SourceLinks")).toBe(true);
		expect(cards.includes('from "@components/research/source-links.tsx"')).toBe(true);
		expect(table.includes('from "@components/research/source-links.tsx"')).toBe(true);
		// Neither surface may grow its own copy back.
		expect(cards.includes("function SourceLinks")).toBe(false);
		expect(table.includes("function SourceLinks")).toBe(false);
	});

	it("renders story plan generated reference status", () => {
		const cards = read("chat-story-plan.tsx");
		// Plan-level fields are typed by the shared payload, so the compiler checks
		// every `plan.*` read below exists on the plan the run wrote.
		expect(cards.includes("type StoryPlanArtifact = StoryPlanPayload")).toBe(true);
		expect(cards.includes("plan.plannedReferences")).toBe(true);
		expect(cards.includes("visibilityMode")).toBe(true);
		expect(cards.includes("ref.error")).toBe(true);
	});

	it("renders story plan kind and explainer review fields on the same artifact", () => {
		const cards = read("chat-story-plan.tsx");
		const model = read("@models/chat/chat-log.ts");
		expect(model.includes("povStage?: PovStage")).toBe(true);
		expect(model.includes("povShots?: PovShot[]")).toBe(true);
		expect(model.includes("teachingMove?: ExplainerTeachingMove")).toBe(true);
		expect(cards.includes('plan.planKind ?? "story"')).toBe(true);
		expect(cards.includes("Learning objective")).toBe(true);
		expect(cards.includes("Core question")).toBe(true);
		expect(cards.includes("Concept ladder")).toBe(true);
		expect(cards.includes("section.teachingMove")).toBe(true);
		expect(cards.includes("POV role")).toBe(true);
		expect(cards.includes("Body constraints")).toBe(true);
		expect(cards.includes("POV stage")).toBe(true);
		expect(cards.includes("Shot roles")).toBe(true);
	});

	it("renders the story arc, each section's job, and advisory structure warnings", () => {
		const cards = read("chat-story-plan.tsx");
		const model = read("@models/chat/chat-log.ts");
		expect(model.includes("chapterFunction?: string")).toBe(true);
		expect(model.includes("chapterObligation?: string")).toBe(true);
		expect(model.includes("needsDrafting?: boolean")).toBe(true);
		expect(cards.includes("plan.arc")).toBe(true);
		expect(cards.includes("section.chapterFunction")).toBe(true);
		expect(cards.includes("section.chapterObligation")).toBe(true);
		expect(cards.includes("section.needsDrafting")).toBe(true);
		expect(cards.includes("storyArcCoverageViolations")).toBe(true);
		// Advisory, never a gate: the warnings render as review material, and the
		// plan in chat is a record — approval is the pinned decision's, unaffected.
		expect(cards.includes("Structure warnings")).toBe(true);
		expect(cards.includes("approval is not blocked")).toBe(true);
		expect(cards.includes("Framing was defaulted")).toBe(true);
	});

	it("names the arc and each chapter's function in the SCRIPT view, not only the plan card", () => {
		const table = read("@components/script/script-table.tsx");
		const view = read("@components/script/script-view.tsx");
		const shell = read("editor-views.tsx");
		// The arc, named once beside the density chips.
		expect(view.includes("props.arcRoles?.arc")).toBe(true);
		expect(view.includes("sc-arc")).toBe(true);
		// The chapter's function on its eyebrow, and its obligation on its own line —
		// never merged into the operator-written brief.
		expect(table.includes("arcRole(group.chapter.id)")).toBe(true);
		expect(table.includes("sc-chapter-obligation")).toBe(true);
		expect(table.includes('placeholder="What is this chapter for?"')).toBe(true);
		// Joined in the shell from the chat log's plan artifact, not threaded from a run.
		expect(shell.includes("scriptArcRoles(chat.messages)")).toBe(true);
	});

	it("keeps chat commands slash-only and removes footer suggestion chips", () => {
		const chat = read("editor-chat.tsx");
		const composer = read("chat-composer-box.tsx");
		expect(composer.includes("/ for commands, @ for project items")).toBe(true);
		expect(chat.includes("fc-quick fc-engage")).toBe(false);
		expect(chat.includes("quick.map((q)")).toBe(false);
		expect(chat.includes("const artifact = onCritique()")).toBe(false);
		expect(chat.includes("setEngageMenu")).toBe(false);
		expect(chat.includes("void send(GROUND_CLAIMS_INSTRUCTION)")).toBe(false);
		expect(chat.includes("void send(SHOT_LIST_INSTRUCTION)")).toBe(false);
	});

	it("uses Enter as command selection while slash menu is open", () => {
		const composer = read("chat-composer-box.tsx");
		expect(composer.includes('event.key === "Tab" || event.key === "Enter"')).toBe(true);
	});

	it("keeps arrow-selected command visible in the scroll area", () => {
		const composer = read("chat-composer-box.tsx");
		expect(composer.includes("itemRefs")).toBe(true);
		expect(composer.includes('scrollIntoView({ block: "nearest" })')).toBe(true);
	});

	it("keeps create form to project shell and moves creative style into the editor style rail", () => {
		const launcher = read("launcher.tsx");
		expect(launcher.includes("Project title")).toBe(true);
		expect(launcher.includes("Description")).toBe(true);
		expect(launcher.includes("Target audience")).toBe(false);
		expect(launcher.includes("Style direction")).toBe(false);
		expect(launcher.includes("<ML>Platform</ML>")).toBe(false);
		expect(launcher.includes("<ML>Type</ML>")).toBe(false);
		const rail = read("@components/timeline/timeline-rail.tsx");
		expect(rail.includes('key: "style"')).toBe(true);
		// The rail owns its destinations; the panels behind them are the host's.
		const panels = read("@components/timeline/timeline-panel-host.tsx");
		expect(panels.includes("<StylePanel")).toBe(true);
		const preview = read("@hooks/timeline/use-preview-composition.ts");
		expect(preview.includes("backgroundFill: settings.backgroundFill || undefined")).toBe(true);
		const settings = read("editor-settings.tsx");
		expect(settings.includes("export function StylePanel")).toBe(true);
		// A style now arrives from a content preset, so the preset control IS the
		// style surface. The nine-item dropdown that used to sit beside it is gone:
		// two pickers for one decision is what this change removed. The control says
		// "default" rather than "preset" because that is the panel's product word.
		expect(settings.includes("Change default")).toBe(true);
		expect(settings.includes("listStylePresets")).toBe(false);
		expect(settings.includes("Style Direction")).toBe(false);
		expect(settings.includes("Background CSS color or gradient")).toBe(true);
	});

	it("keeps asset sources inside one Assets rail", () => {
		const rail = read("@components/timeline/timeline-rail.tsx");
		const panels = read("@components/timeline/timeline-panel-host.tsx");
		const model = read("@models/timeline/timeline-editor-model.ts");
		expect(rail.includes('label: "Assets"')).toBe(true);
		expect(panels.includes('setAssetTab("media")')).toBe(true);
		expect(panels.includes('setAssetTab("library")')).toBe(true);
		expect(panels.includes('setAssetTab("stock")')).toBe(true);
		expect(rail.includes('key: "references"')).toBe(false);
		expect(rail.includes('key: "stock"')).toBe(false);
		expect(model.includes('RailKey = "references"')).toBe(false);
		expect(model.includes('RailKey = "stock"')).toBe(false);
	});

	it("seeds the global aspect from the selected format on submit", () => {
		// The load-flow half of this is a real test now — see
		// parse-loaded-project.test.ts, "falls the global aspect ratio back".
		// On the create form now: it hands the seeded settings to the request
		// rather than writing them into editor state it no longer shares.
		const src = read("project-setup.tsx");
		expect(src.includes("aspectRatio: nextConfig.format")).toBe(true);
	});
});
