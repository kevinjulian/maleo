import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { collectionPhase, EmptyState, ErrorState, LoadingState, Pager } from "./collection.tsx";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);

describe("collectionPhase", () => {
	it("never calls a failed or pending load empty", () => {
		expect(collectionPhase({ count: 0, loading: false, failed: true })).toBe("failed");
		expect(collectionPhase({ count: 0, loading: true, failed: false })).toBe("loading");
		expect(collectionPhase({ count: 0, loading: true, failed: true })).toBe("loading");
		expect(collectionPhase({ count: 0, loading: false, failed: false })).toBe("empty");
	});

	it("keeps rows on screen through a refresh and through a failed one", () => {
		expect(collectionPhase({ count: 3, loading: true, failed: false })).toBe("ready");
		expect(collectionPhase({ count: 3, loading: false, failed: true })).toBe("ready");
	});
});

describe("the three states are distinct to assistive tech", () => {
	it("empty is plain content", () => {
		const out = html(<EmptyState label="No voices." />);
		expect(out).not.toContain("role=");
		expect(out).not.toContain("aria-busy");
	});

	it("loading is a busy status", () => {
		const out = html(<LoadingState label="Loading voices…" />);
		expect(out).toContain('role="status"');
		expect(out).toContain('aria-busy="true"');
	});

	it("failure is an alert, with retry only when one is offered", () => {
		const bare = html(<ErrorState title="Could not load voices" />);
		expect(bare).toContain('role="alert"');
		expect(bare).not.toContain("<button");
		const retry = html(
			<ErrorState title="Could not load voices" message="Network error" onRetry={() => {}} />,
		);
		expect(retry).toContain("Try again");
		expect(retry).toContain("Network error");
	});

	it("an inline failure is still an alert, beside rows that stay", () => {
		const out = html(<ErrorState inline title="Could not delete." onRetry={() => {}} retrying />);
		expect(out).toContain('data-variant="inline"');
		expect(out).toContain('role="alert"');
		expect(out).toContain('aria-busy="true"');
	});
});

describe("Pager", () => {
	const props = { label: "Export pages", onPrevious: () => {}, onNext: () => {} };

	it("is hidden while everything fits on one page", () => {
		const out = html(
			<Pager
				{...props}
				range={{ start: 1, end: 6, total: 6 }}
				hasPrevious={false}
				hasNext={false}
			/>,
		);
		expect(out).toBe("");
	});

	it("names its region and states the range and position", () => {
		const out = html(
			<Pager
				{...props}
				range={{ start: 61, end: 66, total: 66 }}
				page={{ current: 2, count: 2 }}
				hasPrevious
				hasNext={false}
			/>,
		);
		expect(out).toContain('<nav aria-label="Export pages"');
		expect(out).toContain("61–66 of 66");
		expect(out).toContain("Page 2 of 2");
		expect(out.match(/ disabled=""/g)).toHaveLength(1);
	});

	it("disables both directions while a page loads", () => {
		const out = html(
			<Pager {...props} range={{ start: 1, end: 60, total: 66 }} hasPrevious hasNext busy />,
		);
		expect(out.match(/ disabled=""/g)).toHaveLength(2);
	});
});
