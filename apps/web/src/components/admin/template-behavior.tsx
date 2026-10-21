import type { JSX } from "react";
import type { AgentTemplateCatalog, AgentTemplateDefinition } from "@maleo/shared";
import type { TemplateSelection } from "@models/core/routing.ts";
import {
	templateCallerOutcomes,
	templateExecutionRows,
	templateFact,
	templatePredicate,
} from "@models/admin/template-structure.ts";
import { Table, TableScroll } from "@design-system/components/table.tsx";
import { TemplateDefinitionLink } from "./template-definition-link.tsx";

export function TemplateBehavior({
	item,
	catalog,
	selectionFor,
	onSelect,
}: {
	item: AgentTemplateDefinition;
	catalog: AgentTemplateCatalog;
	selectionFor: (item: AgentTemplateDefinition) => TemplateSelection;
	onSelect: (item: AgentTemplateDefinition) => void;
}): JSX.Element {
	const rows = item.execution ? templateExecutionRows(item.execution) : [];
	return (
		<>
			{rows.length > 0 && (
				<>
					<h4>Planning structure</h4>
					<p>
						Possible paths in source order. Branch values are unresolved; terminal calls stop their
						sequence or return from their helper scope.
					</p>
					<TableScroll className="template-table-scroll" label="Planning structure table">
						<Table aria-label="Planning structure">
							<thead>
								<tr>
									<th scope="col">Order</th>
									<th scope="col">Work</th>
									<th scope="col">Continuation</th>
									<th scope="col">Fidelity</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => {
									const target = catalog.definitions.find(
										(entry) => entry.id === row.node.operationId,
									);
									const condition =
										row.node.conditionId && templatePredicate(catalog, row.node.conditionId);
									return (
										<tr key={row.position}>
											<td>{row.position}</td>
											<td>
												{target ? (
													<TemplateDefinitionLink
														item={target}
														selection={selectionFor(target)}
														onSelect={onSelect}
													/>
												) : row.node.kind === "scope" ? (
													"Helper scope"
												) : condition ? (
													condition.id.split(":").at(-1)?.replaceAll("-", " ")
												) : (
													row.node.kind
												)}
												{row.conditions.length > 0 && (
													<small>
														{row.conditions
															.map((entry) => `${entry.id.split(":").at(-1)} = ${entry.outcome}`)
															.join("; ")}
													</small>
												)}
											</td>
											<td>{row.continuation}</td>
											<td>{templateFact(item, "execution").kind}</td>
										</tr>
									);
								})}
							</tbody>
						</Table>
					</TableScroll>
				</>
			)}
			{item.predicates && item.predicates.length > 0 && (
				<>
					<h4>Executable conditions</h4>
					<TableScroll className="template-table-scroll" label="Executable conditions table">
						<Table aria-label="Executable conditions">
							<thead>
								<tr>
									<th scope="col">Condition</th>
									<th scope="col">Caller requirement</th>
									<th scope="col">Resolution</th>
									<th scope="col">Fidelity</th>
								</tr>
							</thead>
							<tbody>
								{item.predicates.map((predicate) => {
									const outcomes = templateCallerOutcomes(catalog, item, predicate.id);
									return (
										<tr key={predicate.id}>
											<td>
												{predicate.id.split(":").at(-1)?.replaceAll("-", " ")}
												<details>
													<summary>Predicate source</summary>
													<pre>{predicate.expression}</pre>
												</details>
											</td>
											<td>
												{outcomes.length
													? outcomes.map((outcome) => String(outcome)).join(" or ")
													: "Chooses true / false continuation"}
											</td>
											<td>Unresolved input</td>
											<td>{predicate.provenance.kind}</td>
										</tr>
									);
								})}
							</tbody>
						</Table>
					</TableScroll>
				</>
			)}
			{item.boundaries && item.boundaries.length > 0 && (
				<details>
					<summary>Implementation boundaries · {item.boundaries.length}</summary>
					<p>These contracts do not certify helper, platform or provider internals.</p>
					<TableScroll className="template-table-scroll" label="Implementation boundaries table">
						<Table aria-label="Implementation boundaries">
							<thead>
								<tr>
									<th scope="col">Helper</th>
									<th scope="col">Source</th>
									<th scope="col">Fidelity</th>
									<th scope="col">Scope</th>
								</tr>
							</thead>
							<tbody>
								{item.boundaries.map((boundary, index) => (
									<tr key={index}>
										<td>{boundary.symbol}</td>
										<td>{boundary.source}</td>
										<td>Opaque</td>
										<td>{boundary.reason}</td>
									</tr>
								))}
							</tbody>
						</Table>
					</TableScroll>
				</details>
			)}
		</>
	);
}
