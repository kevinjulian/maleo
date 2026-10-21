/* The studios' bottom bar, on the main editor's clip-bar model — including its
 * two states, which this did not have.
 *
 *   nothing selected   [ identity ]                          [save]
 *   layer selected     [×] SUBJECT  [ sections … ]           [save]
 *
 * It used to list every destination at once whatever was selected, so a motion
 * with nine layers was a nine-glyph strip that had to be searched before it
 * could be used, and selecting a layer changed nothing about the bar. The two
 * states are what make its contents a function of what the operator is looking
 * at, which is the only thing that keeps a bar short as a document grows.
 *
 * One component for both studios rather than one each. The two have drifted
 * apart once already — same lane column under two sets of class names, same
 * inspector reached two different ways — and a bar copied into two files is the
 * same arrangement that produced it.
 *
 *   [lead]  SUBJECT  │←── categories scroll ──→│  [save]
 *   pinned   pinned                              pinned
 *
 * The ends are pinned because scrolling the whole strip can carry the exit or
 * the commit off screen. The clip bar has that defect today on its actions
 * control; the shared CSS in rail.css fixes both.
 */
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { VuiInspectorCategory } from "@components/editor-workspace/primitives.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

export interface StudioActionBarProps {
	/** The one caption on the bar: what is being edited, or `null` when nothing
	 *  is. `null` is the tool-row state — no caption, and no leading control. */
	subject: string | null;
	categories: VuiInspectorCategory[];
	/** Which category the sheet is showing, when it is open. */
	activeCategory: string;
	/** Open the inspector AT this category — one action, not two. */
	onOpenCategory: (id: string) => void;
	sheetOpen: boolean;
	/** Put the sheet down, keeping the studio open. */
	onBack: () => void;
	/** Leave the studio without saving. */
	onClose: () => void;
	/** Clear the selection, returning the bar to its tool-row state. The clip
	 *  bar's Close does exactly this, and it is why that bar needs no other way
	 *  back: deselecting IS how you get to the tools. */
	onDeselect?: () => void;
	/** The commit. Captioned on purpose — see below. */
	save: ReactNode;
}

export function StudioActionBar({
	subject,
	categories,
	activeCategory,
	onOpenCategory,
	sheetOpen,
	onBack,
	onClose,
	onDeselect,
	save,
}: StudioActionBarProps): JSX.Element {
	return (
		<>
			{/* One control, two jobs, because there are two things to leave and they
			    nest — the same reasoning as the clip bar's leading control. With a
			    sheet open the nearest layer is the sheet, so this goes back one level
			    and the studio stays open. With nothing open the nearest layer is the
			    studio itself. An always-close control would throw away the edit when
			    the operator only meant to put a sheet down; two separate controls
			    would leave a dead one on screen half the time. */}
			{/* The leading control means "leave the nearest layer", so it appears
			    exactly when there is one. With nothing selected and nothing open the
			    bar is a tool row and carries none: the studio's exit is the compact
			    header's back control, the same arrangement the content editor has,
			    where the tool rail carries no close either. A second exit here would
			    be two ways out of one surface, one of which discards the edit.

			    A sheet opened from the tool row IS a nearer layer, though, so the
			    control comes back as Back for as long as that sheet is up. Without
			    that the only way down was the sheet's own header. */}
			{!sheetOpen && subject === null ? null : (
				<IconButton
					className="tl2-studiobar-lead"
					type="button"

					/* Named for what it does, which is not the same on both studios yet.
					   With a selection to clear it deselects, and "Close" is the clip
					   bar's word for that. Without one it still leaves the studio, and
					   saying so is the difference between putting a panel down and
					   discarding an edit. */
					onClick={sheetOpen ? onBack : (onDeselect ?? onClose)}
					title={sheetOpen ? "Back" : onDeselect ? "Close" : "Close without saving"}
					aria-label={sheetOpen ? "Back" : onDeselect ? "Close" : "Close without saving"}
				>
					{sheetOpen ? Ic.chevronLeft(ICON.lg) : Ic.x(ICON.lg)}
				</IconButton>
			)}
			{subject === null ? null : (
				<span className="tl2-studiobar-subject" title={subject}>
					{subject}
				</span>
			)}
			{/* One control per category, opening the sheet at it. A single control
			    that opened a sheet whose own rail then chose the destination was two
			    actions where the main editor takes one, and put a column of
			    destinations inside a surface that already has a row of them. */}
			<span className="tl2-studiobar-cats">
				{categories.map((category) => (
					<IconButton
						on={sheetOpen && activeCategory === category.id}
						key={category.id}
						type="button"

						data-studio-category={category.id}
						onClick={() => onOpenCategory(category.id)}
						title={category.label}
						aria-label={category.label}
						aria-pressed={sheetOpen && activeCategory === category.id}
					>
						{category.icon}
					</IconButton>
				))}
			</span>
			{/* The stated exception to the bar's icons-only rule. The rule exists
			    because the bar's one label is the subject and captions under glyphs
			    compete with it for the same glance — but this is the commit, not a
			    destination, and an unlabelled commit on a form is a guess. */}
			<span className="tl2-studiobar-commit">{save}</span>
		</>
	);
}
