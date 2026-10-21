import type { JSX, ReactNode, MouseEvent } from "react";
import type { AgentTemplateDefinition } from "@maleo/shared";
import { SelectionRow, SelectionRowLabel } from "@design-system/components/selection-row.tsx";
import { viewToPath, type TemplateSelection } from "@models/core/routing.ts";

/** Definition navigation keeps a real href for browser link actions. */
export function TemplateDefinitionLink({
	item,
	selection,
	selected,
	onSelect,
	label,
	row,
	children,
}: {
	item: AgentTemplateDefinition;
	selection: TemplateSelection;
	selected?: boolean;
	label?: string;
	row?: "inline" | "stacked";
	children?: ReactNode;
	onSelect: (item: AgentTemplateDefinition) => void;
}): JSX.Element {
	const href = viewToPath({ kind: "god", section: "pipelines", template: selection });
	const click = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		onSelect(item);
	};
	return row ? (
		<SelectionRow
			className="template-definition-link"
			layout={row}
			selected={selected}
			data-template-row={item.id}
			aria-label={label ?? item.label}
			href={href}
			onClick={click}
		>
			<SelectionRowLabel>{label ?? item.label}</SelectionRowLabel>
			{children}
		</SelectionRow>
	) : (
		<a
			className="template-definition-link"
			data-template-row={item.id}
			aria-current={selected ? "true" : undefined}
			href={href}
			onClick={click}
		>
			{label ?? item.label}
			{children}
		</a>
	);
}
