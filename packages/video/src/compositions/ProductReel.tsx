import { AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { HookScene } from "../scenes/HookScene";
import { FeatureScene } from "../scenes/FeatureScene";
import { CTAScene } from "../scenes/CTAScene";
import { SplitScreenScene } from "../scenes/SplitScreenScene";
import { BeforeAfterScene } from "../scenes/BeforeAfterScene";
import { TestimonialScene } from "../scenes/TestimonialScene";
import { Captions } from "../components/Captions";
import { duckEnvelope } from "../lib/music";
import type { Product } from "../schema";

const MusicTrack: React.FC<{ url: string; product: Product }> = ({ url, product }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const vo = product.voiceover;
	const ranges = vo ? [{ startSec: vo.startSec, endSec: vo.endSec ?? vo.startSec + 6 }] : [];
	const volume = duckEnvelope(frame, fps, ranges);
	return <Audio src={url} volume={volume} />;
};

export const ProductReel: React.FC<Product> = (product) => {
	const { durationInFrames, fps } = useVideoConfig();

	const renderClassic = () => {
		const hookFrames = Math.floor(fps * 4);
		const featureFrames = Math.floor(fps * 8);
		const ctaFrames = durationInFrames - hookFrames - featureFrames;
		return (
			<TransitionSeries>
				<TransitionSeries.Sequence durationInFrames={hookFrames}>
					<HookScene product={product} durationInFrames={hookFrames} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Transition
					presentation={fade()}
					timing={linearTiming({ durationInFrames: 12 })}
				/>
				<TransitionSeries.Sequence durationInFrames={featureFrames}>
					<FeatureScene product={product} durationInFrames={featureFrames} imageIndex={1} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Transition
					presentation={fade()}
					timing={linearTiming({ durationInFrames: 12 })}
				/>
				<TransitionSeries.Sequence durationInFrames={ctaFrames}>
					<CTAScene product={product} durationInFrames={ctaFrames} />
				</TransitionSeries.Sequence>
			</TransitionSeries>
		);
	};

	const renderSplit = () => {
		const sceneA = Math.floor(durationInFrames * 0.6);
		const sceneB = durationInFrames - sceneA;
		return (
			<TransitionSeries>
				<TransitionSeries.Sequence durationInFrames={sceneA}>
					<SplitScreenScene product={product} durationInFrames={sceneA} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Transition
					presentation={fade()}
					timing={linearTiming({ durationInFrames: 12 })}
				/>
				<TransitionSeries.Sequence durationInFrames={sceneB}>
					<CTAScene product={product} durationInFrames={sceneB} />
				</TransitionSeries.Sequence>
			</TransitionSeries>
		);
	};

	const renderBeforeAfter = () => {
		const ba = Math.floor(durationInFrames * 0.65);
		const cta = durationInFrames - ba;
		return (
			<TransitionSeries>
				<TransitionSeries.Sequence durationInFrames={ba}>
					<BeforeAfterScene product={product} durationInFrames={ba} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Transition
					presentation={fade()}
					timing={linearTiming({ durationInFrames: 12 })}
				/>
				<TransitionSeries.Sequence durationInFrames={cta}>
					<CTAScene product={product} durationInFrames={cta} />
				</TransitionSeries.Sequence>
			</TransitionSeries>
		);
	};

	const renderTestimonial = () => {
		const t = Math.floor(durationInFrames * 0.55);
		const f = Math.floor(durationInFrames * 0.2);
		const cta = durationInFrames - t - f;
		return (
			<TransitionSeries>
				<TransitionSeries.Sequence durationInFrames={t}>
					<TestimonialScene product={product} durationInFrames={t} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Transition
					presentation={fade()}
					timing={linearTiming({ durationInFrames: 12 })}
				/>
				<TransitionSeries.Sequence durationInFrames={f}>
					<FeatureScene product={product} durationInFrames={f} imageIndex={1} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Transition
					presentation={fade()}
					timing={linearTiming({ durationInFrames: 12 })}
				/>
				<TransitionSeries.Sequence durationInFrames={cta}>
					<CTAScene product={product} durationInFrames={cta} />
				</TransitionSeries.Sequence>
			</TransitionSeries>
		);
	};

	const body = (() => {
		switch (product.templateId) {
			case "split-screen":
				return renderSplit();
			case "before-after":
				return renderBeforeAfter();
			case "testimonial":
				return renderTestimonial();
			case "classic":
			default:
				return renderClassic();
		}
	})();

	return (
		<AbsoluteFill>
			{body}
			{product.captionCues?.length ? (
				<Captions
					cues={product.captionCues}
					accentColor={product.accentColor}
					fgColor={product.fgColor}
				/>
			) : null}
			{product.voiceover?.audioUrl ? (
				<Sequence from={Math.floor(product.voiceover.startSec * fps)}>
					<Audio src={product.voiceover.audioUrl} volume={1} />
				</Sequence>
			) : null}
			{product.musicUrl ? (
				<Sequence from={0}>
					<MusicTrack url={product.musicUrl} product={product} />
				</Sequence>
			) : null}
		</AbsoluteFill>
	);
};
