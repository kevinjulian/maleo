import { AbsoluteFill, Composition, registerRoot } from "remotion";
import { GRAIN_STYLE } from "../src/scenes/StoryboardScene";

const Grain = () => (
	<AbsoluteFill
		style={{
			backgroundImage: GRAIN_STYLE.backgroundImage,
			backgroundSize: GRAIN_STYLE.backgroundSize,
		}}
	/>
);

registerRoot(() => (
	<Composition
		id="Grain"
		component={Grain}
		width={200}
		height={200}
		fps={30}
		durationInFrames={1}
	/>
));
