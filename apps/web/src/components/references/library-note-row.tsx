import type { JSX } from "react";
import type { Note } from "@maleo/shared";

/* A note in the library. Extracted so its two scopes stay legible: `default`
 * applies it to every scene, `inScene` attaches it to the one in context. */
export function NoteRow({
	note,
	inScene,
	onOpen,
	onToggleScene,
	onToggleDefault,
}: {
	note: Note;
	inScene: boolean;
	onOpen: () => void;
	onToggleScene?: () => void;
	onToggleDefault: () => void;
}): JSX.Element {
	return (
		<div className="cv-catrow note cv-libnote-row">
			<button type="button" className="cv-libnote-btn" onClick={onOpen}>
				<div className="cv-catrow-lbl">
					{note.label}
					{note.default && <span className="cv-lib-usedinline">applied by default</span>}
				</div>
				<div className="cv-catrow-sub">{note.body}</div>
			</button>
			<div className="cv-libnote-actions">
				{/* A note applied by default is already on every scene, so a per-scene
				    toggle for it would be a no-op control. */}
				{onToggleScene && !note.default && (
					<button
						className={`cv-textbtn ${inScene ? "on" : ""}`}
						onClick={onToggleScene}
						title={inScene ? "Remove from this scene" : "Add to this scene"}
					>
						{inScene ? "In scene" : "Add to scene"}
					</button>
				)}
				<button
					className="cv-textbtn"
					onClick={onToggleDefault}
					title={note.default ? "Stop applying to every scene" : "Apply to every scene"}
				>
					{note.default ? "Default" : "Make default"}
				</button>
			</div>
		</div>
	);
}
