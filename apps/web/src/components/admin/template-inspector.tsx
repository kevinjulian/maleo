import { useState, type JSX, type ReactNode } from "react";
import type { AgentTemplateCatalog, AgentTemplateDefinition } from "@maleo/shared";
import type { TemplateSelection } from "@models/core/routing.ts";
import {
	consumerContexts,
	workflowCoverage,
	workflowFacts,
} from "@models/admin/template-discovery.ts";
import { dependencyReferences, templateUsage } from "@models/admin/template-dashboard.ts";
import { TEMPLATE_EFFECT_LABELS } from "@models/admin/template-explorer.ts";
import { Button } from "@design-system/components/button.tsx";
import { Table, TableScroll } from "@design-system/components/table.tsx";
import { TemplateDetail } from "./template-detail.tsx";
import { TemplateDefinitionLink } from "./template-definition-link.tsx";

export function TemplateInspector({
	item,
	catalog,
	drawer,
	implementation,
	selectionFor,
	onSelect,
	onImplementation,
}: {
	item: AgentTemplateDefinition;
	catalog: AgentTemplateCatalog;
	/** In the drawer there is no steps column beside the detail, so a workflow lists its own steps. */
	drawer?: boolean;
	/** Routed disclosure state for the main pane; the drawer leaves it uncontrolled. */
	implementation?: boolean;
	selectionFor: (
		item: AgentTemplateDefinition,
		context?: { workflow: string; stage?: string },
	) => TemplateSelection;
	onSelect: (item: AgentTemplateDefinition, context?: { workflow: string; stage?: string }) => void;
	onImplementation?: (open: boolean) => void;
}): JSX.Element {
	const [copyState, setCopyState] = useState("");
	const [impact, setImpact] = useState(false);
	const references = dependencyReferences(catalog, item.id);
	const direct = catalog.relationships.filter((edge) => edge.from === item.id);
	const link = (entry: AgentTemplateDefinition) => (
		<TemplateDefinitionLink item={entry} selection={selectionFor(entry)} onSelect={onSelect} />
	);
	const chips = (entries: AgentTemplateDefinition[]) => (
		<ul className="template-chips">
			{entries.map((entry) => (
				<li key={entry.id}>{link(entry)}</li>
			))}
		</ul>
	);
	/** One labelled row; callers skip empty facts so the pane shows only what is true. */
	const fact = (label: string, body: ReactNode, name = label) => (
		<section className="template-fact" aria-label={name}>
			<h3>{label}</h3>
			<div>{body}</div>
		</section>
	);
	const related = (kind: AgentTemplateDefinition["kind"]) =>
		references.filter((entry) => entry.item.kind === kind).map((entry) => entry.item);
	const targets = (kind: string) =>
		direct
			.filter((edge) => edge.kind === kind)
			.map((edge) => catalog.definitions.find((entry) => entry.id === edge.to))
			.filter((entry): entry is AgentTemplateDefinition => !!entry);
	const text = item.instructions?.join("\n\n") ?? "";
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopyState("Copied");
		} catch {
			setCopyState("Copy failed. Select the text to copy it.");
		}
	};
	const contexts =
		item.kind === "tool" || item.kind === "prompt" ? consumerContexts(catalog, item.id) : [];
	const consumers = templateUsage(catalog, item.id)
		.direct.map((edge) => catalog.definitions.find((entry) => entry.id === edge.from))
		.filter((entry): entry is AgentTemplateDefinition => !!entry);
	/* Availability is the chat assistant's toolbox around a workflow, never one of its steps. */
	const callers = catalog.relationships
		.filter((edge) => edge.to === item.id && edge.kind === "available")
		.map((edge) => catalog.definitions.find((entry) => entry.id === edge.from))
		.filter((entry): entry is AgentTemplateDefinition => !!entry);
	const owner =
		item.kind === "operation"
			? catalog.definitions.find(
					(entry) => entry.kind === "workflow" && entry.steps.includes(item.id),
				)
			: undefined;
	const ordered =
		item.kind === "workflow"
			? item.steps
					.map((id) => catalog.definitions.find((entry) => entry.id === id))
					.filter((entry): entry is AgentTemplateDefinition => !!entry)
			: [];
	const steps = item.kind === "operation" ? related("operation") : [];
	const tools = item.kind === "operation" ? related("tool") : [];
	const prompts = item.kind === "operation" || item.kind === "tool" ? related("prompt") : [];
	return (
		<div className="template-inspector-content">
			<p className="template-description">
				{item.summary || item.description || "No description yet."}
			</p>
			{item.kind === "tool" &&
				item.effect &&
				fact("Effect", TEMPLATE_EFFECT_LABELS[item.effect] ?? item.effect)}
			{item.kind === "tool" && item.exposure && fact("Access", <p>{item.exposure}</p>)}
			{item.kind === "operation" && (
				<>
					{owner &&
						fact(
							"Part of",
							drawer ? (
								<ul className="template-chips">
									<li>{link(owner)}</li>
									<li className="template-muted">
										step {owner.steps.indexOf(item.id) + 1} of {owner.steps.length}
									</li>
								</ul>
							) : (
								<p>
									{owner.label}, step {owner.steps.indexOf(item.id) + 1} of {owner.steps.length}
								</p>
							),
						)}
					{item.conditions.length > 0
						? fact(
								"Runs when",
								item.conditions.map((condition) => <p key={condition}>{condition}</p>),
							)
						: item.predicates?.length
							? fact(
									"Runs when",
									<p>Only in some cases. The exact rules are under Technical details.</p>,
								)
							: null}
					{item.repeat && fact("Repeats", <p>{item.repeat}</p>)}
					{steps.length > 0 && fact("Steps inside", chips(steps))}
					{tools.length > 0 && fact("Uses tools", chips(tools), "Tools")}
					{prompts.length > 0 && fact("Uses instructions", chips(prompts), "Instructions")}
					{!steps.length && !tools.length && !prompts.length && (
						<p className="template-muted">Uses no tools or instructions.</p>
					)}
				</>
			)}
			{item.kind === "tool" && prompts.length > 0 && fact("Instructions", chips(prompts))}
			{item.kind === "workflow" && (
				<>
					<p className="template-muted">
						A workflow is one complete job. Its steps run in order, and each step uses its own tools
						and instructions. {drawer ? "Open a step to see them." : "Choose a step to see them."}
					</p>
					{drawer &&
						ordered.length > 0 &&
						fact(
							"Steps, in order",
							<ol className="template-chips">
								{ordered.map((entry, index) => (
									<li key={entry.id}>
										<TemplateDefinitionLink
											item={entry}
											label={`${index + 1}. ${entry.label}`}
											selection={selectionFor(entry)}
											onSelect={onSelect}
										/>
									</li>
								))}
							</ol>,
							"Workflow steps",
						)}
					{(targets("uses_prompt").length > 0 || targets("available").length > 0) && (
						<section className="template-around" aria-label="Chat assistant">
							<h3>Chat assistant</h3>
							<p className="template-muted">
								The chat assistant decides when to start this workflow. These belong to the
								assistant, not to any step.
							</p>
							{targets("uses_prompt").length > 0 &&
								fact("Follows", chips(targets("uses_prompt")), "Workflow instructions")}
							{targets("available").length > 0 &&
								fact("Can also call", chips(targets("available")), "Optional capabilities")}
						</section>
					)}
				</>
			)}
			{item.kind === "profile" && (
				<p>Configuration contract; not an independently callable workflow.</p>
			)}
			{item.kind === "prompt" && (
				<section aria-label="Instruction text">
					<div className="template-prompt-heading">
						<h3>Instruction text</h3>
						{item.instructions && (
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									void copy();
								}}
							>
								Copy instructions
							</Button>
						)}
					</div>
					{item.instructions ? (
						<pre data-template-prompt>
							{text || "No fixed text. It is assembled when the AI runs."}
						</pre>
					) : (
						<p className="template-muted">
							No fixed text. It is assembled when the AI runs; see Technical details.
						</p>
					)}
					<p role="status">{copyState}</p>
				</section>
			)}
			{(item.kind === "tool" || item.kind === "prompt") &&
				fact(
					"Used in",
					contexts.length ? (
						<ul className="template-chips">
							{contexts.map((context) => (
								<li key={`${context.workflow.id}:${context.stage?.id ?? "workflow"}`}>
									<TemplateDefinitionLink
										item={context.stage ?? context.workflow}
										label={`${context.workflow.label}${context.stage ? ` / ${context.stage.label}` : ""}`}
										selection={selectionFor(context.stage ?? context.workflow, {
											workflow: context.workflow.id,
											stage: context.stage?.id,
										})}
										onSelect={() =>
											onSelect(context.stage ?? context.workflow, {
												workflow: context.workflow.id,
												stage: context.stage?.id,
											})
										}
									/>
								</li>
							))}
						</ul>
					) : consumers.length ? (
						chips(consumers)
					) : (
						<p className="template-muted">Not a step in any workflow.</p>
					),
					"Consumers",
				)}
			{item.kind === "tool" &&
				callers.length > 0 &&
				fact("Assistant can call it in", chips(callers), "Assistant availability")}
			<details
				className="template-implementation"
				open={onImplementation ? !!implementation : undefined}
				onToggle={(event) => {
					if (onImplementation && event.currentTarget.open !== !!implementation)
						onImplementation(event.currentTarget.open);
				}}
			>
				<summary>Technical details</summary>
				<p>Verification evidence not published for current revision.</p>
				{item.kind === "workflow" && (
					<>
						<dl>
							{workflowFacts(item)
								.filter((fact) => fact.name !== "Purpose")
								.map((fact) => (
									<div key={fact.name}>
										<dt>{fact.name}</dt>
										<dd>
											{fact.value} · {fact.fidelity}
										</dd>
									</div>
								))}
						</dl>
						<section aria-label="Configuration">
							<h3>Configuration</h3>
							<ul>
								{direct
									.filter((edge) => edge.kind === "profile")
									.map((edge) => (
										<li key={edge.to}>
											{link(catalog.definitions.find((entry) => entry.id === edge.to)!)}
										</li>
									))}
							</ul>
						</section>
						<details>
							<summary>Workflow coverage and boundaries</summary>
							<TableScroll className="template-table-scroll" label="Workflow coverage table">
								<Table aria-label="Workflow coverage">
									<thead>
										<tr>
											<th scope="col">Definition</th>
											<th scope="col">Fact group</th>
											<th scope="col">Fidelity</th>
										</tr>
									</thead>
									<tbody>
										{workflowCoverage(catalog, item).map((fact) => (
											<tr key={`${fact.item.id}:${fact.group}`}>
												<td>{link(fact.item)}</td>
												<td>{fact.group}</td>
												<td>{fact.fidelity}</td>
											</tr>
										))}
									</tbody>
								</Table>
							</TableScroll>
						</details>
					</>
				)}
				<TemplateDetail
					item={item}
					catalog={catalog}
					selectionFor={selectionFor}
					onSelect={onSelect}
					onImpact={() => setImpact(true)}
				/>
				{impact && (
					<section aria-label="Potential dependency impact">
						<h3>Potential dependency impact</h3>
						<p>Static reachability includes conditional work; optional availability is excluded.</p>
						<ul>
							{templateUsage(catalog, item.id).pipelines.map((entry) => (
								<li key={entry.id}>{link(entry)}</li>
							))}
						</ul>
					</section>
				)}
			</details>
		</div>
	);
}
