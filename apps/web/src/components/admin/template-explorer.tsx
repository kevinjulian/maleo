import { useEffect, useRef, useState, type JSX } from "react";
import type { AgentTemplateDefinition } from "@maleo/shared";
import { viewToPath, type TemplateSelection, type NavigationMode } from "@models/core/routing.ts";
import { selectedTemplate } from "@models/admin/template-explorer.ts";
import { searchTemplates } from "@models/admin/template-dashboard.ts";
import {
	inspectSelection,
	normalizeDiscovery,
	workflowFor,
	workflowStages,
	templateParent,
} from "@models/admin/template-discovery.ts";
import { useAgentTemplates } from "@hooks/admin/use-agent-templates.ts";
import { Button } from "@design-system/components/button.tsx";
import { Sheet } from "@design-system/components/sheet.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Toolbar } from "@design-system/patterns/toolbar.tsx";
import { EmptyState, ErrorState, LoadingState } from "@design-system/patterns/collection.tsx";
import { TemplateDefinitionLink } from "./template-definition-link.tsx";
import { TemplateInspector } from "./template-inspector.tsx";
import "./template-explorer.css";

/** Plain count of what a step uses; zero kinds are omitted rather than printed. */
function stageUsage(tools: number, instructions: number): string {
	return [
		tools && `${tools} ${tools === 1 ? "tool" : "tools"}`,
		instructions && `${instructions} ${instructions === 1 ? "instruction" : "instructions"}`,
	]
		.filter(Boolean)
		.join(" · ");
}

export default function TemplateExplorer({
	selection,
	onNavigate,
}: {
	selection?: TemplateSelection;
	onNavigate: (selection?: TemplateSelection, mode?: NavigationMode) => void;
}): JSX.Element {
	const { catalog, error, denied, reload } = useAgentTemplates();
	const value = selection ?? { section: "workflows" as const };
	const state = catalog ? normalizeDiscovery(catalog, value) : value;
	const workflow = catalog ? workflowFor(catalog, state) : undefined;
	const selected = catalog ? selectedTemplate(catalog, state) : undefined;
	const invalidStage = !!state.stage && !workflow?.steps.includes(state.stage);
	const item = invalidStage ? undefined : selected;
	const inventory = state.section !== "workflows";
	const title = state.section === "tools" ? "Tools" : "Instructions";
	const level =
		state.inspect || state.stage ? "inspector" : workflow || state.workflow ? "stages" : "list";
	const root = useRef<HTMLDivElement>(null);
	const detail = useRef<HTMLDivElement>(null);
	const stageRegion = useRef<HTMLDivElement>(null);
	const listRegion = useRef<HTMLDivElement>(null);
	const restore = useRef<string | undefined>(undefined);
	const [narrow, setNarrow] = useState(false);
	useEffect(() => {
		const element = root.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setNarrow(entry!.contentRect.width < 960));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (catalog && JSON.stringify(value) !== JSON.stringify(state)) onNavigate(state, "replace");
	}, [catalog, selection]);
	useEffect(() => {
		const target =
			restore.current &&
			[...(root.current?.querySelectorAll<HTMLElement>("[data-template-row]") ?? [])].find(
				(entry) => entry.dataset.templateRow === restore.current && entry.checkVisibility(),
			);
		if (target) target.focus();
		else if (narrow)
			(level === "inspector"
				? detail
				: level === "stages" && !inventory
					? stageRegion
					: listRegion
			).current?.focus();
		restore.current = undefined;
		detail.current?.scrollTo({ top: 0 });
	}, [state.workflow, state.stage, state.inspect, state.section]);
	const navigate = (next: TemplateSelection, mode?: NavigationMode) => onNavigate(next, mode);
	const selectionFor = (
		target: AgentTemplateDefinition,
		context?: { workflow: string; stage?: string },
	): TemplateSelection => {
		/* On Workflows, a workflow or step names a place in the main view, so it is
		 * navigated to. Tools and Instructions keep their own list in view, so every
		 * reference, workflows and steps included, opens in the drawer. */
		if (inventory)
			return inspectSelection(
				state,
				context?.stage
					? (catalog?.definitions.find((entry) => entry.id === context.stage) ?? target)
					: target,
			);
		if (target.kind === "workflow") return { section: "workflows", workflow: target.id };
		if (context)
			return {
				section: "workflows",
				workflow: context.workflow,
				...(context.stage ? { stage: context.stage } : {}),
			};
		return inspectSelection(state, target);
	};
	const open = (target: AgentTemplateDefinition, context?: { workflow: string; stage?: string }) =>
		navigate(selectionFor(target, context));
	const paneSelection = (target: AgentTemplateDefinition): TemplateSelection => ({
		section: state.section,
		...(state.workflow ? { workflow: state.workflow } : {}),
		...(state.query ? { query: state.query } : {}),
		inspect: target.id,
	});
	const peeked = state.peek
		? catalog?.definitions.find((entry) => entry.id === state.peek)
		: undefined;
	const closeDrawer = () =>
		navigate({ ...state, peek: undefined, trail: undefined, omitted: undefined }, "close");
	const navLink = (label: string, next: TemplateSelection, current = false) => (
		<a
			href={viewToPath({ kind: "god", section: "pipelines", template: next })}
			aria-current={current ? "page" : undefined}
			onClick={(event) => {
				if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
					return;
				event.preventDefault();
				navigate(next);
			}}
		>
			{label}
		</a>
	);
	const back = () => {
		const next = templateParent(state);
		if (!state.peek)
			restore.current =
				inventory && state.inspect ? state.inspect : (state.stage ?? state.workflow);
		navigate(next, "back");
	};
	const entries =
		catalog?.definitions.filter(
			(entry) => entry.kind === (state.section === "tools" ? "tool" : "prompt"),
		) ?? [];
	const results =
		catalog && state.query?.trim()
			? searchTemplates(catalog, entries, state.query, state.section === "instructions").map(
					(result) => result.item,
				)
			: entries;
	const groups = [
		...new Set(
			results.flatMap((entry) =>
				state.section === "tools"
					? entry.capabilities?.length
						? entry.capabilities
						: ["Other capabilities"]
					: [entry.purpose || "Other instructions"],
			),
		),
	].sort();
	const stages = catalog && workflow ? workflowStages(catalog, workflow) : [];
	return (
		<div ref={root} className="template-explorer">
			<div className="god-section-heading">
				<div>
					<p className="god-eyebrow">Instance</p>
					<h1>AI Explorer</h1>
					<p className="template-lead">
						What the AI does for each request, step by step, and the instructions it follows.
					</p>
				</div>
				<Button size="sm" variant="secondary" onClick={reload}>
					Refresh definitions
				</Button>
			</div>
			<nav className="template-navigation" aria-label="Explorer destinations">
				{navLink("Workflows", { section: "workflows", workflow: state.workflow }, !inventory)}
				{navLink(
					"Tools",
					{ section: "tools", workflow: state.workflow },
					state.section === "tools",
				)}
				{navLink(
					"Instructions",
					{ section: "instructions", workflow: state.workflow },
					state.section === "instructions",
				)}
			</nav>
			<div className="template-skip-links">
				{!inventory && <a href="#explorer-stages">Skip to stages</a>}
				<a href="#explorer-inspector">Skip to inspector</a>
			</div>
			{error ? (
				<ErrorState
					title={
						denied
							? "Instance owner access required. Definitions cleared."
							: "Could not load definitions"
					}
					message={error}
					onRetry={reload}
				/>
			) : !catalog ? (
				<LoadingState label="Loading definitions…" />
			) : !catalog.definitions.length ? (
				<EmptyState label="No definitions deployed." />
			) : (
				<>
					<p className="template-announcement" role="status">
						{item ? `Showing ${item.label}` : "Choose a workflow or definition"}
					</p>
					<div
						className="template-columns"
						data-level={inventory ? (state.inspect ? "inspector" : "list") : level}
						data-inventory={inventory}
					>
						<div
							ref={listRegion}
							tabIndex={-1}
							className="template-list"
							role="region"
							aria-label={inventory ? `${title} inventory` : "Workflows"}
						>
							<h2 className="template-col-title">{inventory ? title : "Workflows"}</h2>
							{inventory ? (
								<>
									<Toolbar label={`Search ${title.toLowerCase()}`}>
										<SearchField
											label={`Search ${title.toLowerCase()}`}
											value={state.query ?? ""}
											onValueChange={(query) =>
												navigate({ ...state, query: query.slice(0, 256) || undefined }, "replace")
											}
										/>
									</Toolbar>
									{!results.length && (
										<EmptyState label="No definitions match. Clear search to browse all definitions." />
									)}
									{groups.map((group) => (
										<section className="template-inventory-group" aria-label={group} key={group}>
											<h3 className="template-col-title">{group}</h3>
											<ul className="template-rows">
												{results
													.filter((entry) =>
														state.section === "tools"
															? (entry.capabilities?.length
																	? entry.capabilities
																	: ["Other capabilities"]
																).includes(group)
															: (entry.purpose || "Other instructions") === group,
													)
													.map((entry) => (
														<li key={entry.id} data-selected={state.inspect === entry.id}>
															<TemplateDefinitionLink
																row="stacked"
																item={entry}
																selection={paneSelection(entry)}
																selected={state.inspect === entry.id}
																onSelect={() => navigate(paneSelection(entry))}
															>
																{entry.summary && <p>{entry.summary}</p>}
															</TemplateDefinitionLink>
														</li>
													))}
											</ul>
										</section>
									))}
								</>
							) : (
								<nav aria-label="Choose workflow">
									<ul className="template-rows">
										{catalog.definitions
											.filter((entry) => entry.kind === "workflow")
											.map((entry) => (
												<li key={entry.id} data-selected={state.workflow === entry.id}>
													<TemplateDefinitionLink
														row="inline"
														item={entry}
														selection={{ section: "workflows", workflow: entry.id }}
														selected={state.workflow === entry.id}
														onSelect={() => navigate({ section: "workflows", workflow: entry.id })}
													/>
												</li>
											))}
									</ul>
								</nav>
							)}
						</div>
						{!inventory && (
							<div
								id="explorer-stages"
								ref={stageRegion}
								tabIndex={-1}
								className="template-stages"
								role="region"
								aria-label="Execution stages"
							>
								<div className="template-phone-back">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											restore.current = state.workflow;
											navigate({ section: "workflows" }, "back");
										}}
									>
										Back to workflows
									</Button>
								</div>
								<h2 className="template-col-title">Steps</h2>
								{workflow ? (
									<>
										<p className="template-col-lead">{workflow.summary || workflow.description}</p>
										<ol
											className="template-rows template-stage-pipeline"
											aria-label="Execution stages"
										>
											{stages.map((stage) => (
												<li key={stage.item.id} data-selected={state.stage === stage.item.id}>
													<TemplateDefinitionLink
														row="inline"
														item={stage.item}
														label={`${stage.index + 1}. ${stage.item.label}`}
														selection={{
															section: "workflows",
															workflow: workflow.id,
															stage: stage.item.id,
														}}
														selected={state.stage === stage.item.id}
														onSelect={() =>
															navigate({
																section: "workflows",
																workflow: workflow.id,
																stage: stage.item.id,
															})
														}
													>
														<small>{stageUsage(stage.toolCount, stage.instructionCount)}</small>
														{stage.item.summary && <p>{stage.item.summary}</p>}
													</TemplateDefinitionLink>
												</li>
											))}
										</ol>
									</>
								) : state.workflow ? (
									<p role="alert">Workflow unavailable: {state.workflow}.</p>
								) : (
									<EmptyState label="Choose a workflow to see its steps." />
								)}
							</div>
						)}
						<div
							id="explorer-inspector"
							ref={detail}
							tabIndex={-1}
							className="template-inspector"
							role="region"
							aria-label="Contextual inspector"
						>
							<div className="template-pane-head">
								{item ? (
									<h2>{item.label}</h2>
								) : (
									(state.inspect || state.stage) && <h2>Definition unavailable</h2>
								)}
								{(state.inspect || state.stage) && (
									<Button size="sm" variant="ghost" onClick={back}>
										Back
									</Button>
								)}
							</div>
							{item ? (
								<TemplateInspector
									key={item.id}
									item={item}
									catalog={catalog}
									implementation={!!state.implementation}
									selectionFor={selectionFor}
									onSelect={open}
									onImplementation={(implementation) =>
										navigate({ ...state, implementation: implementation || undefined }, "replace")
									}
								/>
							) : state.inspect || state.stage ? (
								<p role="alert">
									This definition is unavailable in current deployment:{" "}
									{invalidStage ? state.stage : (state.inspect ?? state.stage)}.
								</p>
							) : (
								<EmptyState
									label={
										inventory
											? `Choose ${state.section === "tools" ? "a tool" : "an instruction"} to see what it does.`
											: "Choose a step to see what it does."
									}
								/>
							)}
						</div>
					</div>
					<Sheet
						edge="right"
						size="min(92vw, 560px)"
						open={!!state.peek}
						dismissOnBack={false}
						label={peeked ? `${peeked.label} details` : "Definition details"}
						onClose={closeDrawer}
						className="template-drawer"
					>
						{state.peek && (
							<div className="template-drawer-body" role="region" aria-label="Definition drawer">
								<div className="template-pane-head">
									<h2>{peeked?.label ?? "Definition unavailable"}</h2>
									<div className="template-drawer-actions">
										{!!state.trail?.length && (
											<Button size="sm" variant="ghost" onClick={back}>
												Back
											</Button>
										)}
										<Button size="sm" variant="ghost" onClick={closeDrawer}>
											Close
										</Button>
									</div>
								</div>
								{state.omitted && <p className="template-muted">Earlier history omitted.</p>}
								{peeked ? (
									<TemplateInspector
										key={peeked.id}
										item={peeked}
										catalog={catalog}
										drawer
										selectionFor={selectionFor}
										onSelect={open}
									/>
								) : (
									<p role="alert">
										This definition is unavailable in current deployment: {state.peek}.
									</p>
								)}
							</div>
						)}
					</Sheet>
				</>
			)}
		</div>
	);
}
