/* Template Studio's strip between the preview and the timeline.
 *
 * The same frame and the same transport as the content editor and Motion
 * Studio. It carries no add control, because a template's ranges are derived
 * from its settings rather than placed by hand — there is nothing to add to
 * this timeline, which is a fact about the surface and not an omission.
 *
 * Otherwise it is Motion Studio's toolbar with that one control removed, and
 * the disclosure holds the same single entry for the same reason: Stop is
 * `seek(0)`, which the content editor already carries as "Jump to start" behind
 * its own More, and this surface has nothing else to displace.
 */
import { useState, type JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { VuiSheet } from "@components/editor-workspace/sheet.tsx";
import { TimelineToolbarFrame } from "./timeline-toolbar-frame.tsx";
import { JumpIcon } from "./timeline-editor-icons.tsx";
import { TransportControls } from "@design-system/patterns/transport.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

export interface TemplateToolbarProps {
	compact: boolean;
	playing: boolean;
	playbackReady: boolean;
	"aria-describedby"?: string;
	currentSec: number;
	durationSec: number;
	onTogglePlay: () => void;
	onStop: () => void;
	onCloseInspector: () => void;
	inspectorOpen: boolean;
}

export function TemplateToolbar({
	compact,
	playing,
	playbackReady,
	"aria-describedby": describedBy,
	currentSec,
	durationSec,
	onTogglePlay,
	onStop,
	onCloseInspector,
	inspectorOpen,
}: TemplateToolbarProps): JSX.Element {
	const [moreOpen, setMoreOpen] = useState(false);
	/* Jump to start sits beside play at desktop width, as it does on the content
	 * editor. It is the same command the phone keeps behind More; removing it
	 * from the studios entirely — which the first cut of this did — took away a
	 * control the desktop had, in a change that was meant to add one. */
	const jumpStart = (
		<IconButton size="xs" type="button" title="Jump to start" onClick={onStop}>
			{JumpIcon(15, false)}
		</IconButton>
	);
	const transport = (before?: JSX.Element): JSX.Element => (
		<TransportControls
			playing={playing}
			disabled={!playbackReady && !playing}
			aria-describedby={describedBy}
			onTogglePlay={onTogglePlay}
			currentSec={currentSec}
			durationSec={durationSec}
			before={before}
		/>
	);

	if (!compact) return <TimelineToolbarFrame centre={transport(jumpStart)} />;

	/* One sheet on this edge at a time: the inspector's opens from the bottom bar
	 * and this one from the toolbar, so neither knows about the other unless
	 * told. */
	const showing = moreOpen && !inspectorOpen;
	return (
		<>
			<TimelineToolbarFrame
				centre={transport()}
				trailing={
					<IconButton
						type="button"
						size="xs"
						on={showing}
						onClick={() => {
							onCloseInspector();
							setMoreOpen(true);
						}}
						title="More tools"
						aria-label="More tools"
					>
						{Ic.more(ICON.md)}
					</IconButton>
				}
			/>
			{/* The package's sheet, not the app's: this studio is a VUI workspace
			    overlay, and an app sheet portalled to the body renders underneath it.
			    Same reasoning as Motion Studio's. */}
			<VuiSheet
				open={showing}
				title="Tools"
				onRequestClose={() => setMoreOpen(false)}
				className="tl2-studio-toolsheet"
			>
				<div className="tl2-clipactions">
					<button
						type="button"
						className="tl2-clipaction"
						onClick={() => {
							setMoreOpen(false);
							onStop();
						}}
					>
						{JumpIcon(16, false)}
						<span>Jump to start</span>
					</button>
				</div>
			</VuiSheet>
		</>
	);
}
