import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	checkAppIds,
	checkManifestCoverage,
	checkReplicaDrift,
	checkTargetDrift,
	checkRenderDeployment,
	checkContextSize,
	checkImageBinaries,
	findShelledBinaries,
	isIgnored,
	parseComposeAppIds,
	parseDockerignore,
} from "./check-deploy";

describe("checkRenderDeployment", () => {
	const targets = ["docker-compose.yml", "docker-compose.coolify.yml"].map((name) =>
		readFileSync(new URL(`../deploy/${name}`, import.meta.url), "utf8"),
	);

	test("both production targets provide export execution", () => {
		for (const compose of targets) expect(checkRenderDeployment(compose).ok).toBe(true);
	});

	for (const [name, mutate] of [
		[
			"missing worker",
			(s: string) => s.replace(/^  render-worker:\n[\s\S]*?(?=^  media-worker:)/m, ""),
		],
		["missing API URL", (s: string) => s.replace(/      MALEO_VIDEO_URL:.*\n/g, "")],
		[
			"wrong API URL",
			(s: string) => s.replace("http://render-worker:8091", "http://localhost:8091"),
		],
		["missing token", (s: string) => s.replace(/      MALEO_VIDEO_TOKEN:.*\n/g, "")],
		["mismatched token", (s: string) => s.replace("${MALEO_VIDEO_TOKEN:?}", "${OTHER_TOKEN:?}")],
		["missing media credential", (s: string) => s.replace(/      MALEO_SERVICE_TOKEN:.*\n/g, "")],
		["missing API address", (s: string) => s.replace(/      MALEO_API_URL:.*\n/g, "")],
		["missing storage", (s: string) => s.replace(/      MALEO_MEDIA_S3_BUCKET:.*\n/g, "")],
		["missing persistence", (s: string) => s.replace(/      - maleo-render-data:.*\n/g, "")],
		[
			"published port",
			(s: string) =>
				s.replace(/^  render-worker:\n/m, '  render-worker:\n    ports:\n      - "8091:8091"\n'),
		],
		[
			"public route",
			(s: string) =>
				s.replace(
					/(^  render-worker:\n[\s\S]*?    environment:\n)/m,
					"$1      SERVICE_FQDN_RENDER_8091: public\n",
				),
		],
		[
			"API startup cycle",
			(s: string) =>
				s.replace(
					/(^  render-worker:\n[\s\S]*?    depends_on:\n)/m,
					"$1      api:\n        condition: service_healthy\n",
				),
		],
	] as const) {
		test(`rejects ${name} even when both targets share the defect`, () => {
			for (const compose of targets) expect(checkRenderDeployment(mutate(compose)).ok).toBe(false);
		});
	}
});

describe("parseDockerignore", () => {
	test("drops comments and blank lines, keeps order", () => {
		expect(parseDockerignore("# why\n\ndata/\n  **/public/  \n!.env.example\n")).toEqual([
			"data/",
			"**/public/",
			"!.env.example",
		]);
	});
});

describe("isIgnored", () => {
	const patterns = parseDockerignore("data/\n**/public/\n*.png\n.env\n.env.*\n!.env.example\n");

	test("a directory pattern excludes the directory and its contents", () => {
		expect(isIgnored("data", patterns)).toBe(true);
		expect(isIgnored("data/maleo.db", patterns)).toBe(true);
	});

	test("a **/ pattern reaches nested directories", () => {
		expect(isIgnored("apps/api/public/media/x.mp4", patterns)).toBe(true);
	});

	test("a root glob does not cross a path separator", () => {
		expect(isIgnored("screenshot.png", patterns)).toBe(true);
		expect(isIgnored("apps/web/static/icon-192.png", patterns)).toBe(false);
	});

	test("a later negation re-includes", () => {
		expect(isIgnored(".env", patterns)).toBe(true);
		expect(isIgnored(".env.example", patterns)).toBe(false);
	});

	test("source files are kept", () => {
		expect(isIgnored("apps/api/src/index.ts", patterns)).toBe(false);
	});
});

describe("checkContextSize", () => {
	const measurement = {
		bytes: 20 * 1024 * 1024,
		files: 3000,
		largest: [{ path: "packages", bytes: 18 * 1024 * 1024 }],
	};

	test("passes under budget", () => {
		const result = checkContextSize(measurement, 50 * 1024 * 1024);
		expect(result.ok).toBe(true);
	});

	test("fails over budget and names the largest entry", () => {
		// A runtime directory stopping being excluded is exactly this shape.
		const bloated = {
			bytes: 52 * 1024 * 1024 * 1024,
			files: 900_000,
			largest: [{ path: "packages", bytes: 51 * 1024 * 1024 * 1024 }],
		};
		const result = checkContextSize(bloated, 50 * 1024 * 1024);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("packages");
		expect(result.message).toContain("GB");
	});
});

describe("findShelledBinaries", () => {
	test("finds a binary named in a spawn argument list", () => {
		const source = 'Bun.spawn(["ffprobe", "-v", "error", path])';
		expect(findShelledBinaries([source], ["ffmpeg", "ffprobe"])).toEqual(["ffprobe"]);
	});

	test("finds one named in a which call", () => {
		expect(findShelledBinaries(['Bun.which("ffmpeg")'], ["ffmpeg", "ffprobe"])).toEqual(["ffmpeg"]);
	});
});

describe("checkImageBinaries", () => {
	test("passes when the Dockerfile installs what the runtime shells", () => {
		const dockerfile = "FROM oven/bun:1.3\nRUN apt-get install -y ffmpeg && ffprobe -version\n";
		expect(checkImageBinaries(dockerfile, ["ffmpeg", "ffprobe"]).ok).toBe(true);
	});

	test("fails when a shelled binary is absent from the image", () => {
		const result = checkImageBinaries('FROM oven/bun:1.3\nCMD ["bun", "x.ts"]\n', ["ffmpeg"]);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("ffmpeg");
	});
});

describe("parseComposeAppIds", () => {
	const compose = [
		"services:",
		"  api:",
		"    environment:",
		"      INNGEST_SIGNING_KEY: k",
		"      INNGEST_APP_ID: maleo",
		"  media-worker:",
		"    environment:",
		"      INNGEST_SIGNING_KEY: k",
		"      INNGEST_APP_ID: maleo-media",
		"  inngest:",
		"    image: inngest/inngest:v1.36.0",
		"    environment:",
		"      INNGEST_SIGNING_KEY: k",
		"  web:",
		"    environment:",
		"      MALEO_API_URL: http://api:8090",
	].join("\n");

	test("reads the function hosts, not the server and not the UI", () => {
		expect(parseComposeAppIds(compose)).toEqual([
			{ service: "api", appId: "maleo" },
			{ service: "media-worker", appId: "maleo-media" },
		]);
	});
});

describe("checkAppIds", () => {
	test("passes on distinct ids", () => {
		const result = checkAppIds([
			{ service: "api", appId: "maleo" },
			{ service: "media-worker", appId: "maleo-media" },
		]);
		expect(result.ok).toBe(true);
	});

	test("fails on a collision, naming both services", () => {
		const result = checkAppIds([
			{ service: "api", appId: "maleo" },
			{ service: "media-worker", appId: "maleo" },
		]);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("api and media-worker");
	});

	test("fails when a host leaves the id unset — the client default is the collision", () => {
		const result = checkAppIds([
			{ service: "api", appId: "maleo" },
			{ service: "media-worker", appId: undefined },
		]);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("media-worker");
	});
});

describe("checkManifestCoverage", () => {
	const manifests = ["apps/api/package.json", "packages/db/package.json"];

	test("passes when every image copies every manifest", () => {
		const text =
			"COPY apps/api/package.json apps/api/\nCOPY packages/db/package.json packages/db/\n";
		expect(checkManifestCoverage(manifests, [{ path: "a/Dockerfile", text }]).ok).toBe(true);
	});

	test("fails naming the image and the manifest it forgot", () => {
		// A package added to the workspace and not to the copy list: the install
		// succeeds and the container fails on frozen-lockfile instead.
		const text = "COPY apps/api/package.json apps/api/\n";
		const result = checkManifestCoverage(manifests, [{ path: "a/Dockerfile", text }]);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("a/Dockerfile");
		expect(result.message).toContain("packages/db/package.json");
	});
});

describe("replicas", () => {
	test("a replica may share its service's app id; another service may not", () => {
		expect(
			checkAppIds([
				{ service: "api", appId: "maleo" },
				{ service: "api-2", appId: "maleo" },
			]).ok,
		).toBe(true);
		expect(
			checkAppIds([
				{ service: "api", appId: "maleo" },
				{ service: "media-worker", appId: "maleo" },
			]).ok,
		).toBe(false);
	});

	const api = [
		"  api:",
		'    command: ["bun", "api.ts"]',
		"    environment:",
		"      SERVICE_FQDN_API_8090: ${SERVICE_FQDN_API_8090:-}",
		"      MALEO_API_PORT: 8090",
		"    depends_on:",
		"      maleo-postgres:",
		"        condition: service_healthy",
	];
	const replica = [
		"  api-2:",
		'    command: ["bun", "api.ts"]',
		"    environment:",
		"      MALEO_API_PORT: 8090",
		"    # comments may differ",
		"    depends_on:",
		"      api:",
		"        condition: service_healthy",
		"      maleo-postgres:",
		"        condition: service_healthy",
	];
	const compose = (rep: string[]) =>
		["services:", ...api, ...rep, "volumes:", "  data:"].join("\n");

	test("a replica that differs only by domain and start order passes", () => {
		const result = checkReplicaDrift(compose(replica));
		expect(result.ok).toBe(true);
	});

	test("a setting present on one and not the other fails, naming it", () => {
		const drifted = replica.map((l) => l.replace("MALEO_API_PORT: 8090", "MALEO_API_PORT: 9090"));
		const result = checkReplicaDrift(compose(drifted));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("MALEO_API_PORT");
	});
});

describe("checkTargetDrift", () => {
	const coolify = [
		"services:",
		"  web:",
		"    environment:",
		"      # routed by Coolify",
		"      SERVICE_FQDN_WEB_3030: ${SERVICE_FQDN_WEB_3030:-}",
		"      MALEO_WEB_PORT: 3030",
		"    expose:",
		'      - "3030"',
		"  inngest:",
		"    image: inngest/inngest:v1.36.0",
		"",
	].join("\n");
	const selfHost = [
		"services:",
		"  web:",
		"    environment:",
		"      MALEO_WEB_PORT: 3030",
		"    expose:",
		'      - "3030"',
		"    ports:",
		'      - "${MALEO_BIND_ADDRESS:-127.0.0.1}:3030:3030"',
		"  inngest:",
		"    image: inngest/inngest:v1.36.0",
		"",
	].join("\n");

	test("routing declarations, published ports, and comments may differ", () => {
		expect(checkTargetDrift(coolify, selfHost).ok).toBe(true);
	});

	test("a changed setting fails, naming the service and the line", () => {
		const result = checkTargetDrift(coolify, selfHost.replace("v1.36.0", "v1.37.0"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("inngest");
			expect(result.message).toContain("v1.37.0");
		}
	});

	test("a service present in only one file fails", () => {
		const result = checkTargetDrift(coolify, selfHost.replace(/  inngest:[\s\S]*/, ""));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("inngest");
	});
});
