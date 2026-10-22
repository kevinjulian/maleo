// Renders one caption fixture through the product's own Captions component and
// font load, so the stills are the reference the Rust renderer must match.
import { AbsoluteFill, Composition, registerRoot } from "remotion";
import { Captions, type RenderCaptionCue } from "../../../packages/video/src/components/Captions";
import { ensureFonts } from "../../../packages/video/src/fonts";

ensureFonts();

export interface FixtureProps extends Record<string, unknown> {
	background: string;
	fgColor: string;
	accentColor: string;
	fixture: {
		id: string;
		text: string;
		words: Array<{ text: string; startSec: number; endSec: number }>;
		style: Record<string, unknown>;
	};
}

function Fixture({ background, fgColor, accentColor, fixture }: FixtureProps) {
	const cue = {
		id: fixture.id,
		startSec: 0,
		durationSec: 10,
		caption: { text: fixture.text, words: fixture.words, style: fixture.style },
	} as unknown as RenderCaptionCue;
	return (
		<AbsoluteFill style={{ background }}>
			<Captions cues={[cue]} accentColor={accentColor} fgColor={fgColor} config={null} />
		</AbsoluteFill>
	);
}

const empty: FixtureProps = {
	background: "#000000",
	fgColor: "#ffffff",
	accentColor: "#ffd400",
	fixture: { id: "empty", text: "", words: [], style: {} },
};

registerRoot(() => (
	<Composition
		id="CaptionFixture"
		component={Fixture}
		width={1080}
		height={1920}
		fps={30}
		durationInFrames={300}
		defaultProps={empty}
	/>
));
