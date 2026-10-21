import { describe, expect, test, afterEach } from "vite-plus/test";
import {
	countRender,
	isRenderCounting,
	readRenderCounts,
	resetRenderCounts,
	startRenderCounting,
} from "./render-probe.ts";

afterEach(() => {
	delete (globalThis as { __maleoRenderCounts?: unknown }).__maleoRenderCounts;
});

describe("render probe", () => {
	test("counts nothing until a harness turns it on", () => {
		countRender("editor");
		expect(isRenderCounting()).toBe(false);
		expect(readRenderCounts()).toEqual({});
	});

	test("tallies per label once counting starts", () => {
		startRenderCounting();
		countRender("editor");
		countRender("editor");
		countRender("tracks");
		expect(readRenderCounts()).toEqual({ editor: 2, tracks: 1 });
	});

	test("reset clears the tally but leaves counting on", () => {
		startRenderCounting();
		countRender("editor");
		resetRenderCounts();
		expect(isRenderCounting()).toBe(true);
		expect(readRenderCounts()).toEqual({});
		countRender("editor");
		expect(readRenderCounts()).toEqual({ editor: 1 });
	});

	test("the snapshot is a copy, so a later render does not change it", () => {
		startRenderCounting();
		countRender("editor");
		const snapshot = readRenderCounts();
		countRender("editor");
		expect(snapshot).toEqual({ editor: 1 });
	});
});
