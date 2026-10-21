import { useEffect, useState, type ReactNode } from "react";
import { cancelRender, continueRender, delayRender, staticFile, useVideoConfig } from "remotion";
import { getImageDimensions, getVideoMetadata } from "@remotion/media-utils";
import { sourceCropGeometry, type SourceCrop } from "@maleo/shared";

type Layout = {
	crop?: SourceCrop | null;
	flipX?: boolean;
	flipY?: boolean;
	fit?: "contain" | "cover" | "stretch";
	widthPct?: number;
	heightPct?: number | null;
};

/** Local source crop/flip precedes the outer clip's rotation and opacity. */
export function VisualMediaFrame({
	src,
	kind,
	layout,
	children,
}: {
	src: string;
	kind: "image" | "video";
	layout?: Layout;
	children: ReactNode;
}) {
	if (!layout?.crop && !layout?.flipX && !layout?.flipY) return <>{children}</>;
	if (!layout?.crop)
		return (
			<div
				style={{
					position: "absolute",
					inset: 0,
					scale: `${layout?.flipX ? -1 : 1} ${layout?.flipY ? -1 : 1}`,
				}}
			>
				{children}
			</div>
		);
	return (
		<CroppedMedia
			key={`${src}:${kind}`}
			src={src}
			kind={kind}
			layout={{ ...layout, crop: layout.crop }}
		>
			{children}
		</CroppedMedia>
	);
}

function CroppedMedia({
	src,
	kind,
	layout,
	children,
}: {
	src: string;
	kind: "image" | "video";
	layout: Layout & { crop: SourceCrop };
	children: ReactNode;
}) {
	const { width, height } = useVideoConfig();
	const [handle] = useState(() => delayRender(`Read crop source dimensions: ${src}`));
	const [source, setSource] = useState<{ src: string; width: number; height: number }>();
	useEffect(() => {
		let active = true;
		const url = /^(https?:|data:|blob:|file:)/.test(src) ? src : staticFile(src);
		const dimensions = kind === "video" ? getVideoMetadata(url) : getImageDimensions(url);
		void dimensions
			.then((size) => {
				if (active) setSource({ src, width: size.width, height: size.height });
				continueRender(handle);
			})
			.catch((error: unknown) => {
				if (active) cancelRender(error);
				else continueRender(handle);
			});
		return () => {
			active = false;
			continueRender(handle);
		};
	}, [src, kind, handle]);
	if (!source || source.src !== src) return null;
	const box = sourceCropGeometry(
		source,
		{
			width: (width * (layout.widthPct ?? 100)) / 100,
			height: (height * (layout.heightPct ?? 100)) / 100,
		},
		layout.crop,
		layout.fit ?? "cover",
	);
	return (
		<div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
			<div
				style={{
					position: "absolute",
					left: box.left,
					top: box.top,
					width: box.width,
					height: box.height,
					overflow: "hidden",
					scale: `${layout.flipX ? -1 : 1} ${layout.flipY ? -1 : 1}`,
				}}
			>
				<div
					style={{
						position: "absolute",
						left: box.sourceLeft,
						top: box.sourceTop,
						width: box.sourceWidth,
						height: box.sourceHeight,
					}}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
