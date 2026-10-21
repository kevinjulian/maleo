// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from "vite-plus/test";

const { readTheme, setTheme, subscribeTheme, resolveDark, initTheme } = await import("./theme.ts");

function preferDark(dark: boolean): void {
	window.matchMedia = ((query: string) => ({
		matches: dark && query.includes("dark"),
		media: query,
		addEventListener() {},
		removeEventListener() {},
	})) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
	window.localStorage.clear();
	document.documentElement.classList.remove("dark");
	preferDark(false);
});

describe("theme store", () => {
	test("nothing stored means follow the system", () => {
		expect(readTheme()).toBe("system");
	});

	test("stored light and dark from the old toggle stay valid", () => {
		window.localStorage.setItem("theme", "dark");
		expect(readTheme()).toBe("dark");
		window.localStorage.setItem("theme", "light");
		expect(readTheme()).toBe("light");
	});

	test("an unknown stored value is treated as system", () => {
		window.localStorage.setItem("theme", "sepia");
		expect(readTheme()).toBe("system");
	});

	test("each explicit value sets the dark class and persists", () => {
		setTheme("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(window.localStorage.getItem("theme")).toBe("dark");
		setTheme("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(window.localStorage.getItem("theme")).toBe("light");
	});

	test("system follows prefers-color-scheme", () => {
		preferDark(true);
		setTheme("system");
		expect(resolveDark("system")).toBe(true);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		preferDark(false);
		expect(resolveDark("system")).toBe(false);
	});

	test("every subscriber hears a change, so two consumers agree", () => {
		const heard: string[] = [];
		const offA = subscribeTheme(() => heard.push(`a:${readTheme()}`));
		const offB = subscribeTheme(() => heard.push(`b:${readTheme()}`));
		setTheme("dark");
		offA();
		offB();
		expect(heard).toEqual(["a:dark", "b:dark"]);
	});

	test("initTheme applies the stored choice at boot", () => {
		window.localStorage.setItem("theme", "dark");
		initTheme();
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});
});
