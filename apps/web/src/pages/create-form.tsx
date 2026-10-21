import { Topbar, TopbarLeading } from "@design-system/patterns/topbar.tsx";
/* `/create` — pick a content type, name the project, create it.
 *
 * This used to be the same component as the editor. Rendering three type cards
 * and a title field constructed a timeline document store, a command stack, a
 * caption system, a chat session, an agent-apply loop and a debounced autosave,
 * because the component body ran before it knew which screen it was on.
 *
 * The page composes and holds nothing but the type choice. The setup form owns
 * the fields it collects and the preset it applies; the create request owns
 * being in flight and failing. Nothing here survives into the editor in memory
 * — the axes are written with the project row and the editor loads them.
 */
import { useState } from "react";
import type { JSX } from "react";
import "@components/editor/create-content.css";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { TYPES } from "@models/content/content-types.ts";
import { Launcher } from "@components/editor/launcher.tsx";
import { ProjectSetup } from "@components/editor/project-setup.tsx";
import { WorkspaceSwitcher } from "@components/workspace/workspace-switcher.tsx";
import { useReferenceLibrary } from "@hooks/editor/use-reference-library.ts";
import { useCreateProject } from "@hooks/editor/use-create-project.ts";
import type { ContentType } from "@maleo/shared";
import type { CrumbSeg } from "@components/editor/create-content.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

export interface CreateFormPageProps {
	onProjectCreated: (projectId: string) => void;
	onOpenNav?: () => void;
	crumbs?: CrumbSeg[];
}

export function CreateFormPage({
	onProjectCreated,
	onOpenNav,
	crumbs,
}: CreateFormPageProps): JSX.Element {
	const [type, setType] = useState<ContentType | null>(null);
	/* The one request this page makes, and the state that belongs to it rather
	 * than to the form: a page composes, it does not fetch. */
	const { creating, error, create } = useCreateProject();
	/* The reference library. The form needs it because `createProject` sends the
	 * pool's entity ids as the project's roster, and a preset's lock has to
	 * resolve through that roster to render anything. */
	const { refs, pool } = useReferenceLibrary();

	const typeLabel = type ? (TYPES.find((t) => t.key === type)?.label ?? null) : null;
	const chain: CrumbSeg[] = [
		...(crumbs ?? []),
		{ label: "New project", onClick: type ? () => setType(null) : undefined },
	];
	if (type && typeLabel) chain.push({ label: typeLabel });

	return (
		<div className="cv-shell">
			<div className="cv-root" style={{ flex: 1, minWidth: 0 }}>
				<Topbar variant="editor">
					<TopbarLeading>
						{onOpenNav && (
							<IconButton
								className="cv-hamburger"
								onClick={onOpenNav}
								title="Toggle menu"
								aria-label="toggle menu"
							>
								{Ic.menu(ICON.lg)}
							</IconButton>
						)}
						<WorkspaceSwitcher collapsed />
						<nav className="cv-crumbs">
							{chain.map((seg, i) => {
								const last = i === chain.length - 1;
								return (
									<span key={i} style={{ display: "contents" }}>
										{i > 0 && <span className="cv-crumb-sep">{Ic.chevR(ICON.xs)}</span>}
										{last ? (
											<span className="cur cv-crumb-slug" title={seg.label}>
												{seg.label}
											</span>
										) : seg.onClick ? (
											<button className="cv-crumb-btn" onClick={seg.onClick}>
												{seg.label}
											</button>
										) : (
											<span className="cv-crumb-static">{seg.label}</span>
										)}
									</span>
								);
							})}
						</nav>
					</TopbarLeading>
				</Topbar>

				<div className="cv-page">
					{type ? (
						<ProjectSetup
							type={type}
							pool={pool}
							refs={refs}
							busy={creating}
							error={error}
							onBack={() => setType(null)}
							// The route becomes authoritative here: creating a project
							// navigates to it, so a reload reopens what was being worked on.
							onCreate={(request) => create(request, onProjectCreated)}
						/>
					) : (
						<Launcher onPick={setType} />
					)}
				</div>
			</div>
		</div>
	);
}
