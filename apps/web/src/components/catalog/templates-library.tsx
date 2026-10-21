/* Library > Video Templates — reusable video structure and timing, browsable.
 *
 * This page used to render the editor's own Templates panel verbatim. That
 * panel is built for a rail inside a project, so the page inherited a panel
 * header with a close button that closed nothing, a `selectedId` and an Active
 * marker for a project that was not open, an `onSelect` and an `onClose` wired
 * to `() => undefined`, and a preview hard-coded to 288x512 because that is what
 * fits a rail. Every one of those is a control an operator can reach and none of
 * them did anything.
 *
 * So the page renders its own rows — the same catalogue row the rest of the
 * library uses — and opens the shared editor modal behind Create and Edit. The
 * rows are this surface's; what edits a template stays one implementation, or
 * the two surfaces come to disagree about what a template has.
 */
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { DEFAULT_TIMELINE_TEMPLATE, isFixtureRow } from "@maleo/shared";
import type { TimelineTemplate, TimelineTemplateInput } from "@maleo/shared";
import {
	createTimelineTemplate,
	listTimelineTemplates,
	updateTimelineTemplate,
} from "@api/templates.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import {
	TimelineTemplateEditorModal,
	templateInput,
	type EditorState,
} from "@components/timeline/timeline-template-panel.tsx";
import { LibraryHeader } from "./library-chrome.tsx";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	collectionPhase,
} from "@design-system/patterns/collection.tsx";
import { LibraryToolbar } from "./library-toolbar.tsx";
import { Chip } from "@design-system/components/chip.tsx";

/* The editor modal renders a preview at whatever size it is given. A page is not
 * a 288px rail, so the library asks for something a person can actually read. */
const PREVIEW_WIDTH = 360;
const PREVIEW_HEIGHT = 640;

const blankTemplate = (): TimelineTemplateInput => ({
	...DEFAULT_TIMELINE_TEMPLATE,
	name: "",
	sceneEntrySfx: "",
	staticSceneMovement: false,
	overrideSceneTransition: false,
	sceneTransition: "fade",
});

function summarise(template: TimelineTemplate): string {
	return (
		template.description ||
		`${template.introTextPreset || "No title"} · data ${template.useData ? "on" : "off"}`
	);
}

export function TemplatesLibrary(): JSX.Element {
	const [templates, setTemplates] = useState<TimelineTemplate[]>([]);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [editor, setEditor] = useState<EditorState | null>(null);

	const [loading, setLoading] = useState(true);
	const reload = (): void => {
		setLoading(true);
		listTimelineTemplates()
			.then((list) => {
				setTemplates(list);
				setError(null);
			})
			.catch(() => setError("The server did not return the templates."))
			.finally(() => setLoading(false));
	};
	const phase = collectionPhase({ count: templates.length, loading, failed: error !== null });
	useEffect(reload, []);

	const create = async (input: TimelineTemplateInput): Promise<TimelineTemplate> => {
		setBusy(true);
		try {
			const created = await createTimelineTemplate(input);
			reload();
			return created;
		} finally {
			setBusy(false);
		}
	};

	/* Shipped templates were editable in place until they became fixtures. Editing one
	 * now creates the operator's own copy, which is what the API's 409 tells any client
	 * that tries the write directly. */
	const update = async (id: string, input: TimelineTemplateInput): Promise<TimelineTemplate> => {
		setBusy(true);
		try {
			const target = templates.find((template) => template.id === id);
			const saved =
				target && isFixtureRow(target)
					? await createTimelineTemplate({ ...input, name: `${input.name} (copy)` })
					: await updateTimelineTemplate(id, input);
			reload();
			return saved;
		} finally {
			setBusy(false);
		}
	};

	const matched = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return templates;
		return templates.filter((template) =>
			`${template.name} ${summarise(template)}`.toLowerCase().includes(q),
		);
	}, [templates, query]);

	return (
		<div className="pg">
			<LibraryHeader
				type="templates"
				count={templates.length}
				action={
					<Button
						variant="primary"
						size="sm"
						onClick={() => setEditor({ mode: "create", initial: blankTemplate() })}
					>
						{Ic.plus(ICON.md)} New template
					</Button>
				}
			/>
			<LibraryToolbar query={query} onQuery={setQuery} placeholder="Search video templates" />

			{phase === "ready" && error && (
				<ErrorState
					inline
					title="Could not refresh templates."
					message={error}
					onRetry={reload}
					retrying={loading}
				/>
			)}
			{phase === "loading" ? (
				<LoadingState label="Loading video templates…" />
			) : phase === "failed" ? (
				<ErrorState
					title="Could not load video templates"
					message={error}
					onRetry={reload}
					retrying={loading}
				/>
			) : matched.length === 0 ? (
				<EmptyState
					label={
						templates.length === 0
							? "No video templates yet. Create one to reuse a structure and timing across projects."
							: `No video templates match “${query.trim()}”.`
					}
				/>
			) : (
				<div className="collection-rows">
					{matched.map((template) => {
						const builtin = isFixtureRow(template);
						const open = (): void =>
							setEditor({ mode: "edit", template, initial: templateInput(template) });
						return (
							<div key={template.id} className="collection-card collection-card-row">
								<div style={{ flex: 1, minWidth: 0 }}>
									<div style={{ fontSize: 13.5, fontWeight: 600 }}>
										{template.name}
										{builtin && <Chip style={{ marginLeft: 8 }}>built-in</Chip>}
									</div>
									<div
										style={{
											fontSize: 12,
											color: "var(--muted)",
											marginTop: 2,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{summarise(template)}
									</div>
								</div>
								{/* A shipped template is read-only, so it offers the copy the edit
								    would produce rather than an Edit the server answers with a 409. */}
								<IconButton
									size="sm"
									title={builtin ? "Copy to a template you can edit" : `Edit ${template.name}`}
									onClick={open}
								>
									{builtin ? Ic.copy(ICON.sm) : Ic.pen(ICON.sm)}
								</IconButton>
							</div>
						);
					})}
				</div>
			)}

			{editor && (
				<TimelineTemplateEditorModal
					state={editor}
					refs={[]}
					projectEmotions={[]}
					busy={busy}
					error={error}
					width={PREVIEW_WIDTH}
					height={PREVIEW_HEIGHT}
					onClose={() => setEditor(null)}
					onCreate={create}
					onUpdate={update}
				/>
			)}
		</div>
	);
}
