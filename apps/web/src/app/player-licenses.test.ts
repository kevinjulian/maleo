import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

test("distributed player notices cover pinned player, required dependencies, and full licenses", () => {
	const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
	const notices = read("../../static/player-licenses.txt");
	const web = JSON.parse(read("../../package.json"));
	expect(web.dependencies["@videojs/react"]).toBe("10.0.1");
	for (const name of ["react", "core", "media", "native-hls-video", "spf", "store", "utils"])
		expect(notices).toContain(`@videojs/${name} 10.0.1: Apache-2.0`);
	for (const name of ["react-compiler-runtime", "react-dom", "scheduler"])
		expect(notices).toContain(name);
	expect(notices).toContain("signal-polyfill 0.2.2: Apache-2.0");
	expect(notices).toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
	expect(notices).toContain("Permission is hereby granted, free of charge");
	expect(read("./index.html")).toContain('rel="license"');
});
