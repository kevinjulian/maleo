import React from "react";
import { describe, expect, test } from "vite-plus/test";
import {
	sceneBoundaryHold,
	sceneEntranceStyle,
	sceneExitStyle,
} from "../src/compositions/StoryboardReel";
import { SlidePresentation, resolveTransition } from "../src/lib/transitions";

describe("scene transitions", () => {
	test("slide moves outgoing scene out and incoming scene in", () => {
		const slide = (direction: "entering" | "exiting") =>
			SlidePresentation({
				children: <div />,
				presentationDirection: direction,
				presentationProgress: 0.25,
				passedProps: {},
				presentationDurationInFrames: 30,
				onElementImage: () => {},
				onUnmount: () => {},
				bothEnteringAndExiting: false,
			});
		const transformOf = (node: unknown) =>
			React.isValidElement<{ style: React.CSSProperties }>(node)
				? node.props.style.transform
				: undefined;

		expect(transformOf(slide("exiting"))).toBe("translateX(-25%)");
		expect(transformOf(slide("entering"))).toBe("translateX(75%)");
	});

	test("slide transition resolves to the paired slide presentation", () => {
		expect(resolveTransition("slide").presentation.component).toBe(SlidePresentation);
	});

	test("absolute-layout slide does not fade the incoming scene", () => {
		expect(sceneExitStyle("slide", 3, 0, 12)?.transform).toBe("translateX(-25%)");
		expect(sceneEntranceStyle("slide", 3, 12)).toEqual({ transform: "translateX(75%)" });
	});

	test("absolute-layout slide holds previous scene through gap before exiting", () => {
		expect(sceneExitStyle("slide", 123, 144, 24)).toBeUndefined();
		expect(sceneExitStyle("slide", 150, 144, 24)?.transform).toBe("translateX(-25%)");
	});

	test("absolute-layout slide clocks both scenes from the same boundary frame", () => {
		const boundary = sceneBoundaryHold({
			startSec: 0.033,
			endSec: 4.033,
			nextStartSec: 4.5,
			transitionFrames: 24,
			fps: 30,
		});
		const enteringLocalFrame = 6;
		expect(
			sceneExitStyle(
				"slide",
				boundary.exitFromFrame + enteringLocalFrame,
				boundary.exitFromFrame,
				24,
			)?.transform,
		).toBe("translateX(-25%)");
		expect(sceneEntranceStyle("slide", enteringLocalFrame, 24)?.transform).toBe("translateX(75%)");
	});
});
