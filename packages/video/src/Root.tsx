import { Composition } from "remotion";
import { RENDER_FPS } from "@maleo/shared";
import { productSchema, storyboardSchema, aspectMap } from "./schema";
import { ProductReel } from "./compositions/ProductReel";
import { ProductSquare } from "./compositions/ProductSquare";
import { ProductWide } from "./compositions/ProductWide";
import { StoryboardReel } from "./compositions/StoryboardReel";
import { sampleProduct } from "./lib/sample";
import { sampleStoryboard } from "./lib/sample-storyboard";
import { storyboardSeconds } from "./lib/duration";

/* The sample is written as schema input; the Studio wants the parsed props. */
const sampleStoryboardProps = storyboardSchema.parse(sampleStoryboard);

const FPS = RENDER_FPS;
const DURATION_SECONDS = 18;

export const Root: React.FC = () => {
	return (
		<>
			<Composition
				id="ProductReel"
				component={ProductReel}
				durationInFrames={FPS * DURATION_SECONDS}
				fps={FPS}
				width={aspectMap.vertical.width}
				height={aspectMap.vertical.height}
				schema={productSchema}
				defaultProps={sampleProduct}
			/>
			<Composition
				id="ProductSquare"
				component={ProductSquare}
				durationInFrames={FPS * DURATION_SECONDS}
				fps={FPS}
				width={aspectMap.square.width}
				height={aspectMap.square.height}
				schema={productSchema}
				defaultProps={sampleProduct}
			/>
			<Composition
				id="ProductWide"
				component={ProductWide}
				durationInFrames={FPS * DURATION_SECONDS}
				fps={FPS}
				width={aspectMap.horizontal.width}
				height={aspectMap.horizontal.height}
				schema={productSchema}
				defaultProps={sampleProduct}
			/>
			{/* `as never` on defaultProps below: this package pins zod 3 while remotion
          pulls zod 4, so `storyboardSchema`'s infer type and remotion's schema-prop
          type are nominally distinct. Dev-only studio defaults — render path
          (dashboard) builds props from the same zod 3 and is unaffected. */}
			<Composition
				id="StoryboardReel"
				component={StoryboardReel}
				durationInFrames={FPS * 30}
				fps={FPS}
				width={aspectMap.vertical.width}
				height={aspectMap.vertical.height}
				schema={storyboardSchema}
				defaultProps={sampleStoryboardProps}
				calculateMetadata={({ props }) => {
					return { durationInFrames: Math.max(1, Math.ceil(storyboardSeconds(props) * FPS)) };
				}}
			/>
			<Composition
				id="StoryboardSquare"
				component={StoryboardReel}
				durationInFrames={FPS * 30}
				fps={FPS}
				width={aspectMap.square.width}
				height={aspectMap.square.height}
				schema={storyboardSchema}
				defaultProps={sampleStoryboardProps}
				calculateMetadata={({ props }) => {
					return { durationInFrames: Math.max(1, Math.ceil(storyboardSeconds(props) * FPS)) };
				}}
			/>
			<Composition
				id="StoryboardWide"
				component={StoryboardReel}
				durationInFrames={FPS * 30}
				fps={FPS}
				width={aspectMap.horizontal.width}
				height={aspectMap.horizontal.height}
				schema={storyboardSchema}
				defaultProps={sampleStoryboardProps}
				calculateMetadata={({ props }) => {
					return { durationInFrames: Math.max(1, Math.ceil(storyboardSeconds(props) * FPS)) };
				}}
			/>
		</>
	);
};
