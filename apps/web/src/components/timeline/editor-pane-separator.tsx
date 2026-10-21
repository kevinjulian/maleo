import type { useEditorPaneSizing, EditorPane } from "@hooks/timeline/use-editor-pane-sizing.ts";

export function EditorPaneSeparator({
	pane,
	label,
	sizing,
}: {
	pane: EditorPane;
	label: string;
	sizing: ReturnType<typeof useEditorPaneSizing>;
}) {
	const value = Math.round(sizing.sizes?.[pane] ?? 0);
	return (
		<div
			role="separator"
			aria-label={label}
			aria-orientation={pane === "timeline" ? "horizontal" : "vertical"}
			aria-valuemin={Math.round(sizing.bounds?.min[pane] ?? 0)}
			aria-valuemax={Math.round(sizing.bounds?.max[pane] ?? 0)}
			aria-valuenow={value}
			aria-valuetext={`${value} pixels`}
			tabIndex={0}
			className="tl2-pane-separator"
			data-pane={pane}
			onPointerDown={(event) => sizing.start(pane, event)}
			onKeyDown={(event) => sizing.keyboard(pane, event)}
		/>
	);
}
