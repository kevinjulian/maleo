import type { JSX } from "react";
import { textOf } from "@maleo/shared";
import type {
	AgentTemplateCatalog,
	AgentTemplateDefinition,
	AgentTemplateRelationship,
} from "@maleo/shared";
import { consumerContexts } from "@models/admin/template-discovery.ts";
import { templateUsage } from "@models/admin/template-dashboard.ts";
import { TEMPLATE_KIND_INFO, TEMPLATE_RELATION_LABELS } from "@models/admin/template-explorer.ts";
import type { TemplateSelection } from "@models/core/routing.ts";
import { TemplateDefinitionLink } from "./template-definition-link.tsx";
import { Table, TableScroll } from "@design-system/components/table.tsx";
import { Button } from "@design-system/components/button.tsx";
import { templateFact } from "@models/admin/template-structure.ts";
import { TemplateBehavior } from "./template-behavior.tsx";
import { TemplateRecipe } from "./template-recipe.tsx";

function isRecord(value: unknown): value is NonNullable<AgentTemplateDefinition["input"]> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function TemplateDetail({
	item,
	catalog,
	selectionFor,
	onSelect,
	onImpact,
}: {
	item: AgentTemplateDefinition;
	catalog: AgentTemplateCatalog;
	selectionFor: (
		item: AgentTemplateDefinition,
		context?: { workflow: string; stage?: string },
	) => TemplateSelection;
	onSelect: (item: AgentTemplateDefinition, context?: { workflow: string; stage?: string }) => void;
	onImpact: () => void;
}): JSX.Element {
	const usage = templateUsage(catalog, item.id);
	const outgoing = catalog.relationships.filter((relation) => relation.from === item.id);
	const associations = catalog.relationships.filter(
		(relation) => relation.to === item.id && relation.kind === "profile",
	);
	const order = catalog.relationships
		.filter(
			(relation) =>
				(relation.from === item.id || relation.to === item.id) && relation.kind === "next",
		)
		.sort((left, right) => Number(left.from === item.id) - Number(right.from === item.id));
	const dependencies = outgoing.filter(
		(relation) => relation.kind !== "available" && relation.kind !== "next",
	);
	const optional = [
		...usage.optional,
		...outgoing.filter((relation) => relation.kind === "available"),
	];
	const properties =
		item.input && isRecord(item.input.properties) ? item.input.properties : undefined;
	const required = item.input && Array.isArray(item.input.required) ? item.input.required : [];
	const relationsTable = (values: AgentTemplateRelationship[], label: string) => (
		<TableScroll className="template-table-scroll" label={`${label} table`}>
			<Table aria-label={label}>
				<thead>
					<tr>
						<th scope="col">Definition</th>
						<th scope="col">Relationship</th>
						{label === "Direct consumers" && <th scope="col">Workflow / stage context</th>}
						<th scope="col">When</th>
						<th scope="col">Fidelity</th>
						<th scope="col">Notes</th>
					</tr>
				</thead>
				<tbody>
					{values.map((relation, index) => {
						const target = catalog.definitions.find(
							(value) => value.id === (relation.from === item.id ? relation.to : relation.from),
						)!;
						return (
							<tr key={index}>
								<td>
									<TemplateDefinitionLink
										item={target}
										selection={selectionFor(target)}
										onSelect={onSelect}
									/>
								</td>
								<td>{TEMPLATE_RELATION_LABELS[relation.kind]}</td>
								{label === "Direct consumers" && (
									<td>
										{consumerContexts(catalog, target.id).length ? (
											<ul>
												{consumerContexts(catalog, target.id).map((context) => {
													const selectedContext = {
														workflow: context.workflow.id,
														stage: context.stage?.id,
													};
													return (
														<li key={`${context.workflow.id}:${context.stage?.id ?? "workflow"}`}>
															<TemplateDefinitionLink
																item={target}
																label={`${context.workflow.label}${context.stage ? ` / ${context.stage.label}` : ""}`}
																selection={selectionFor(target, selectedContext)}
																onSelect={() => onSelect(target, selectedContext)}
															/>
														</li>
													);
												})}
											</ul>
										) : (
											"No workflow association exposed"
										)}
									</td>
								)}
								<td>
									{relation.conditions?.length
										? relation.conditions
												.map(
													(condition) => `${condition.id.split(":").at(-1)} = ${condition.outcome}`,
												)
												.join("; ")
										: "See execution structure"}
								</td>
								<td>{relation.provenance?.kind ?? "declared"}</td>
								<td>{relation.label || "—"}</td>
							</tr>
						);
					})}
				</tbody>
			</Table>
		</TableScroll>
	);
	return (
		<article className="template-detail">
			<section aria-label="Overview">
				<h3>Overview</h3>
				<p className="template-section-hint">Purpose and scope</p>
				<div className="template-detail-badges">
					<span>{TEMPLATE_KIND_INFO[item.kind].label}</span>
					<span>{item.contentTypes.join(" / ") || "No content type declared"}</span>
				</div>
				<p>{item.description}</p>
				{item.entryPoint && (
					<p>
						Entry point: <code>{item.entryPoint}</code>
					</p>
				)}
				{item.exposure && <p>{item.exposure}</p>}
			</section>
			{(item.execution ||
				item.predicates?.length ||
				item.boundaries?.length ||
				item.conditions.length > 0 ||
				item.repeat ||
				item.effect ||
				item.promptMode ||
				order.length > 0) && (
				<section aria-label="Behavior">
					<h3>Behavior</h3>
					<p className="template-section-hint">Execution order, gates and side effects</p>
					<TemplateBehavior
						item={item}
						catalog={catalog}
						selectionFor={selectionFor}
						onSelect={onSelect}
					/>
					{order.length > 0 && (
						<>
							<h4>Execution order</h4>
							<TableScroll className="template-table-scroll" label="Execution order table">
								<Table aria-label="Execution order">
									<thead>
										<tr>
											<th scope="col">Position</th>
											<th scope="col">Stage</th>
											<th scope="col">Continuation</th>
										</tr>
									</thead>
									<tbody>
										{order.map((relation, index) => {
											const target = catalog.definitions.find(
												(value) =>
													value.id === (relation.from === item.id ? relation.to : relation.from),
											)!;
											return (
												<tr key={index}>
													<td>{relation.from === item.id ? "Next" : "Previous"}</td>
													<td>
														<TemplateDefinitionLink
															item={target}
															selection={selectionFor(target)}
															onSelect={onSelect}
														/>
													</td>
													<td>{relation.label || "On success"}</td>
												</tr>
											);
										})}
									</tbody>
								</Table>
							</TableScroll>
						</>
					)}
					{item.effect && <p>Effect: {item.effect}</p>}
					{item.conditions.length > 0 && (
						<>
							<h4>Conditions and gates</h4>
							<TableScroll className="template-table-scroll" label="Conditions and gates table">
								<Table aria-label="Conditions and gates">
									<thead>
										<tr>
											<th scope="col">Gate</th>
											<th scope="col">Condition</th>
											<th scope="col">Fidelity</th>
										</tr>
									</thead>
									<tbody>
										{item.conditions.map((value, index) => (
											<tr key={value}>
												<td>{index + 1}</td>
												<td>{value}</td>
												<td>{templateFact(item, `conditions.${index}`).kind}</td>
											</tr>
										))}
									</tbody>
								</Table>
							</TableScroll>
						</>
					)}
					{item.repeat && <p>Repeats: {item.repeat}</p>}
					{item.promptMode && (
						<p>
							{item.promptMode === "none"
								? "No model prompt. Deterministic or runtime control tool."
								: item.promptMode === "passthrough"
									? "Passthrough: receives user or authored text; no fixed model instructions."
									: "Composed prompt: inspect linked production definitions."}
						</p>
					)}
				</section>
			)}
			{(item.input || item.output.length > 0) && (
				<section aria-label="Contract">
					<h3>Contract</h3>
					<p className="template-section-hint">Accepted inputs and returned outputs</p>
					{properties && (
						<details open={item.kind === "tool" || item.kind === "operation"}>
							<summary>Inputs · {Object.keys(properties).length}</summary>
							<TableScroll className="template-table-scroll" label="Input contract table">
								<Table aria-label="Input contract">
									<thead>
										<tr>
											<th scope="col">Input</th>
											<th scope="col">Type</th>
											<th scope="col">Required</th>
											<th scope="col">Rules</th>
										</tr>
									</thead>
									<tbody>
										{Object.entries(properties).map(([name, value]) => (
											<tr key={name}>
												<td>
													<code>{name}</code>
												</td>
												<td>
													{isRecord(value) && typeof value.type === "string"
														? value.type
														: "Composite schema"}
												</td>
												<td>{required.includes(name) ? "Required" : "Optional"}</td>
												<td>
													{!isRecord(value) ? (
														"See raw schema."
													) : (
														<>
															{value.description !== undefined && (
																<p>{textOf(value.description)}</p>
															)}
															{value.enum !== undefined && (
																<p>Allowed: {JSON.stringify(value.enum)}</p>
															)}
															{value.default !== undefined && (
																<p>Default: {JSON.stringify(value.default)}</p>
															)}
															{[
																"minimum",
																"maximum",
																"minLength",
																"maxLength",
																"minItems",
																"maxItems",
															].map(
																(bound) =>
																	value[bound] !== undefined && (
																		<p key={bound}>
																			{bound}: {textOf(value[bound])}
																		</p>
																	),
															)}
															{Object.keys(value).every((key) => key === "type") && "—"}
														</>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</Table>
							</TableScroll>
						</details>
					)}
					{item.output.length > 0 && (
						<>
							<h4>Outputs</h4>
							<TableScroll className="template-table-scroll" label="Output contract table">
								<Table aria-label="Output contract">
									<thead>
										<tr>
											<th scope="col">Output</th>
											<th scope="col">Contract</th>
										</tr>
									</thead>
									<tbody>
										{item.output.map((value, index) => (
											<tr key={value}>
												<td>Output {index + 1}</td>
												<td>{value}</td>
											</tr>
										))}
									</tbody>
								</Table>
							</TableScroll>
						</>
					)}
					{item.input && (
						<details>
							<summary>Raw input schema</summary>
							<pre>{JSON.stringify(item.input, null, 2)}</pre>
						</details>
					)}
				</section>
			)}
			{(item.recipe ||
				item.instructions ||
				item.variables?.length ||
				item.composition.length > 0) && (
				<section aria-label="Instructions">
					<h3>Instructions</h3>
					<p className="template-section-hint">
						Fixed text, production assembly and input bindings
					</p>
					<TemplateRecipe
						item={item}
						catalog={catalog}
						selectionFor={selectionFor}
						onSelect={onSelect}
					/>
					{item.composition.length > 0 && (
						<>
							<h4>Composition order</h4>
							<ol>
								{item.composition.map((value) => (
									<li key={value}>{value}</li>
								))}
							</ol>
						</>
					)}
					{item.variables && item.variables.length > 0 && (
						<details>
							<summary>Variables and transforms · {item.variables.length}</summary>
							<TableScroll className="template-table-scroll" label="Variables and transforms table">
								<Table aria-label="Variables and transforms">
									<thead>
										<tr>
											<th scope="col">Variable</th>
											<th scope="col">Type</th>
											<th scope="col">Required</th>
											<th scope="col">Source / transform</th>
											<th scope="col">Default</th>
											<th scope="col">When</th>
											<th scope="col">Fidelity</th>
										</tr>
									</thead>
									<tbody>
										{item.variables.map((variable, index) => (
											<tr key={index}>
												<td>
													<code>{variable.name}</code>
												</td>
												<td>{variable.type}</td>
												<td>{variable.required ? "Required" : "Optional"}</td>
												<td>{variable.source}</td>
												<td>
													{variable.default !== undefined ? JSON.stringify(variable.default) : "—"}
												</td>
												<td>{variable.condition || "—"}</td>
												<td>{templateFact(item, `variables.${index}`).kind}</td>
											</tr>
										))}
									</tbody>
								</Table>
							</TableScroll>
						</details>
					)}
				</section>
			)}
			<section aria-label="Dependencies">
				<h3>Dependencies</h3>
				<p className="template-section-hint">Definitions this item uses</p>
				{dependencies.length ? (
					relationsTable(dependencies, "Dependencies")
				) : (
					<p>No declared dependencies.</p>
				)}
			</section>
			<section aria-label="Used by">
				<h3>Used by</h3>
				<p className="template-section-hint">Consumers and potential change impact</p>
				{associations.length > 0 && (
					<>
						<h4>Associated workflows</h4>
						{relationsTable(associations, "Associated workflows")}
					</>
				)}
				<h4>Direct consumers · {usage.direct.length}</h4>
				{usage.direct.length ? (
					relationsTable(usage.direct, "Direct consumers")
				) : (
					<p>No declared consumers.</p>
				)}
				<p>
					{usage.pipelines.length} potentially affected pipelines. Includes conditional
					dependencies; execution is not guaranteed.
				</p>
				<Button size="sm" onClick={onImpact}>
					Show affected pipelines
				</Button>
				{optional.length > 0 && (
					<details>
						<summary>Optional agent availability · {optional.length}</summary>
						<p>Agent may choose these capabilities. Excluded from dependency impact.</p>
						{relationsTable(optional, "Optional availability")}
					</details>
				)}
			</section>
			<section aria-label="Technical">
				<details>
					<summary>Technical</summary>
					<p className="template-section-hint">Identity, source and deployed revision</p>
					<TableScroll className="template-table-scroll" label="Technical table">
						<Table aria-label="Technical">
							<thead>
								<tr>
									<th scope="col">Property</th>
									<th scope="col">Value</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>Definition</td>
									<td>
										<code>{item.id}</code>
									</td>
								</tr>
								<tr>
									<td>Source</td>
									<td>
										<code>{item.source}</code>
									</td>
								</tr>
								<tr>
									<td>Current revision</td>
									<td>
										<code>{item.revision}</code>
									</td>
								</tr>
								{item.aliases.length > 0 && (
									<tr>
										<td>Aliases and compatibility</td>
										<td>{item.aliases.join(" / ")}</td>
									</tr>
								)}
							</tbody>
						</Table>
					</TableScroll>
				</details>
			</section>
		</article>
	);
}
