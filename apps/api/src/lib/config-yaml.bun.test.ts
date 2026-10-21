/* Workspace configuration is a database row. `readWorkspaceConfig` parses it with
 * `WorkspaceSchema` rather than handing back `unknown`. These tests pin the two ways that parse is allowed to
 * fail, because both were decided deliberately and neither is what a strict
 * `.parse()` does by default.
 *
 * `config.yaml` is hand-edited by operators. The regression this guards against
 * is not "an invalid file is accepted" — it is one bad key taking out readers
 * that had nothing to do with it. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeMaleoDb } from "@maleo/db/connection";
import { getWorkspaceConfigText, putWorkspaceConfigText } from "@maleo/db/workspace-config";
import {
	readWorkspaceConfig,
	WorkspaceConfigError,
	writeWorkspaceConfigText,
} from "./config-yaml.ts";
import { resolveWorkspacesDir } from "./workspace/paths.ts";

const workspace = "acme";

/* Stored as it would be by a document written before validation-on-write, so
 * the READ tolerance below is what is tested. */
function writeConfig(body: string): Promise<void> {
	return putWorkspaceConfigText(workspace, body);
}

beforeEach(() => closeMaleoDb());
afterEach(() => closeMaleoDb());

describe("reading stored configuration through the schema", () => {
	test("a config with no name still reads its blocks", async () => {
		// `name` is the schema's only required key, and files that omit it are real
		// — the metering suite writes one holding `image_policy` alone. Failing the
		// document over it made a `daily_limit: 0` quota stop being enforced.
		await writeConfig("image_policy:\n  daily_limit: 0\n");

		const cfg = await readWorkspaceConfig(workspace);

		expect(cfg.name).toBe(workspace);
		expect(cfg.image_policy).toEqual({ daily_limit: 0 });
	});

	test("a name in the file wins over the directory it sits in", async () => {
		await writeConfig("name: written-name\n");

		expect((await readWorkspaceConfig(workspace)).name).toBe("written-name");
	});

	test("a malformed block reads as absent and the others still read", async () => {
		// `channels` must be a mapping. Given a string it fails its own parse, and
		// `.catch(undefined)` keeps that failure inside the block: the reader that
		// wanted `channels` sees "not configured", which is what it saw before this
		// parse existed, and `capabilities` beside it is untouched.
		await writeConfig("channels: not-a-mapping\ncapabilities:\n  image_gen:\n    enabled: true\n");

		const cfg = await readWorkspaceConfig(workspace);

		expect(cfg.channels).toBeUndefined();
		expect(cfg.capabilities?.image_gen?.enabled).toBe(true);
	});

	test("an undeclared key survives the parse instead of being stripped", async () => {
		// `WorkspaceSchema` is `.passthrough()`. `collections_*` is keyed by a
		// runtime-built string and cannot be declared at all, so a closed schema
		// here would delete operator data with no error.
		await writeConfig("collections_characters:\n  - id: ada\nniche: woodworking\n");

		const cfg = await readWorkspaceConfig(workspace);

		expect(cfg.collections_characters).toEqual([{ id: "ada" }]);
		expect(cfg.niche).toBe("woodworking");
	});

	test("channels keeps an entry that carries only automation", async () => {
		// kunti's `tiktok` entry is exactly this shape. A schema requiring
		// `activations` would have rejected a real config file.
		await writeConfig("channels:\n  tiktok:\n    automation:\n      auto_post: true\n");

		expect((await readWorkspaceConfig(workspace)).channels?.tiktok).toEqual({
			automation: { auto_post: true },
		});
	});
});

describe("configuration is validated when written", () => {
	test("an invalid document is refused naming the field, and the stored one is unchanged", async () => {
		await writeWorkspaceConfigText(workspace, "name: acme\nimage_generation:\n  enabled: false\n");
		const refused = await writeWorkspaceConfigText(
			workspace,
			"name: acme\nimage_generation:\n  enabled: sometimes\n",
		).catch((e: unknown) => e);
		expect(refused).toBeInstanceOf(WorkspaceConfigError);
		expect(String(refused)).toContain("image_generation.enabled");
		expect(await getWorkspaceConfigText(workspace)).toBe(
			"name: acme\nimage_generation:\n  enabled: false\n",
		);
	});

	test("a dashboard block that a read would tolerate is still refused on write", async () => {
		// Reading treats a malformed `channels` as absent; writing it is refused.
		await expect(writeWorkspaceConfigText(workspace, "channels: not-a-mapping\n")).rejects.toThrow(
			/channels/,
		);
	});

	test("text that is not YAML is refused", async () => {
		await expect(writeWorkspaceConfigText(workspace, "name: [unclosed\n")).rejects.toThrow(
			/not valid YAML/,
		);
	});

	test("what was written reads back valid", async () => {
		await writeWorkspaceConfigText(workspace, "# kept\nname: acme\nwriter_style: plain\n");
		expect((await readWorkspaceConfig(workspace)).writer_style).toBe("plain");
		expect(await getWorkspaceConfigText(workspace)).toContain("# kept");
	});
});

describe("no credential is ever written to a configuration row", () => {
	for (const [label, text, field] of [
		["a top-level token", "name: acme\ntelegram_bot_token: 123:abc\n", "telegram_bot_token"],
		[
			"a nested api key",
			"name: acme\nchannels:\n  x:\n    api_key: sk-live\n",
			"channels.x.api_key",
		],
		[
			"a password inside a list",
			"name: acme\naccounts:\n  - password: hunter2\n",
			"accounts.0.password",
		],
	] as const) {
		test(`${label} is refused naming "${field}"`, async () => {
			const refused = await writeWorkspaceConfigText(workspace, text).catch((e: unknown) => e);
			expect(refused).toBeInstanceOf(WorkspaceConfigError);
			expect(String(refused)).toContain(`"${field}"`);
			expect(await getWorkspaceConfigText(workspace)).toBeNull();
		});
	}
});

describe("a configuration file left on disk is ignored", () => {
	test("the stored row wins, and the file is never read", async () => {
		const dir = join(resolveWorkspacesDir(), workspace);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.yaml"), "name: acme\nwriter_style: from-the-file\n");
		await writeWorkspaceConfigText(workspace, "name: acme\nwriter_style: from-the-row\n");

		expect((await readWorkspaceConfig(workspace)).writer_style).toBe("from-the-row");
	});

	test("a file with no row is not a configuration", async () => {
		const dir = join(resolveWorkspacesDir(), "orphan");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.yaml"), "name: orphan\n");

		await expect(readWorkspaceConfig("orphan")).rejects.toThrow(/no stored configuration/);
	});
});
