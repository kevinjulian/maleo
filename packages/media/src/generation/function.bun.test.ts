import { afterEach, describe, expect, test } from "bun:test";
import { generationConcurrencyPerKind } from "./function.ts";

const prior = process.env.MALEO_GENERATION_CONCURRENCY_PER_KIND;

afterEach(() => {
	if (prior === undefined) delete process.env.MALEO_GENERATION_CONCURRENCY_PER_KIND;
	else process.env.MALEO_GENERATION_CONCURRENCY_PER_KIND = prior;
});

describe("generationConcurrencyPerKind", () => {
	test("defaults to one run per media kind", () => {
		delete process.env.MALEO_GENERATION_CONCURRENCY_PER_KIND;
		expect(generationConcurrencyPerKind()).toBe(1);
	});

	test("accepts positive integer env override", () => {
		process.env.MALEO_GENERATION_CONCURRENCY_PER_KIND = "4";
		expect(generationConcurrencyPerKind()).toBe(4);
	});

	test("clamps invalid or zero values to one", () => {
		process.env.MALEO_GENERATION_CONCURRENCY_PER_KIND = "0";
		expect(generationConcurrencyPerKind()).toBe(1);
		process.env.MALEO_GENERATION_CONCURRENCY_PER_KIND = "nope";
		expect(generationConcurrencyPerKind()).toBe(1);
	});
});
