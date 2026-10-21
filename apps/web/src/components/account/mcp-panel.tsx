/* Account → MCP: connect Codex CLI, Claude Code or another MCP client to your
 * projects.
 *
 * The page is built around one moment: creating a key. The key is shown once,
 * and the moment it exists every client snippet below carries it, so connecting
 * a client is one copy into one terminal. Afterwards the snippets fall back to a
 * placeholder — the value is never stored in the page or fetched again.
 *
 * A key acts as you: it reaches the projects of every workspace you belong to,
 * and an MCP client changes a project through the agent or one of its edit
 * tools, in the project chat and under the same approvals. */
import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";
import { Button } from "@design-system/components/button.tsx";
import { Callout } from "@design-system/components/note.tsx";
import { Select } from "@design-system/components/select.tsx";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@design-system/components/tabs.tsx";
import { createApiKey, deleteApiKey, listApiKeys, type ApiKeyRow } from "@api/auth.ts";
import { apiUrl } from "@models/core/asset-url.ts";
import { mcpClientGuides } from "@models/settings/mcp-clients.ts";
import { AccountGroup, FormOutcome, LabelledInput } from "./account-group.tsx";

const HINT = "tw:m-0 tw:text-xs tw:text-muted-foreground";
const CODE =
	"tw:m-0 tw:overflow-x-auto tw:whitespace-pre tw:rounded-md tw:border tw:border-border tw:bg-secondary tw:p-3 tw:font-mono tw:text-xs";

/** Expiry choices, in days; `0` never expires. */
const EXPIRY_DAYS = [30, 90, 365, 0] as const;
const DEFAULT_EXPIRY = 90;

/** The endpoint as a client outside the browser must address it: absolute, on the origin this page came from. */
function mcpEndpoint(): string {
	return new URL(apiUrl("/api/mcp"), window.location.origin).href;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }): JSX.Element {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	};
	return (
		<Button size="sm" onClick={() => void copy()}>
			{copied ? "Copied" : label}
		</Button>
	);
}

function Copyable({ text, label }: { text: string; label: string }): JSX.Element {
	return (
		<div className="tw:flex tw:items-start tw:gap-2">
			<pre className={`${CODE} tw:flex-1`} aria-label={label}>
				{text}
			</pre>
			<CopyButton text={text} />
		</div>
	);
}

function CreateKey({ onCreated }: { onCreated: (key: string) => void }): JSX.Element {
	const [name, setName] = useState("");
	const [days, setDays] = useState<number>(DEFAULT_EXPIRY);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim() || saving) return;
		setSaving(true);
		setError(null);
		try {
			const created = await createApiKey(name, days || null);
			setName("");
			onCreated(created.key);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not create the key.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<form className="tw:flex tw:flex-wrap tw:items-end tw:gap-3" onSubmit={(e) => void submit(e)}>
			<div className="tw:min-w-[14rem] tw:flex-1">
				<LabelledInput
					label="Key name"
					placeholder="e.g. Codex on my laptop"
					value={name}
					onChange={(e) => setName(e.target.value)}
					hint="To recognise this key later."
				/>
			</div>
			<label className="tw:flex tw:flex-col tw:gap-1 tw:text-xs">
				Expires
				<Select
					value={String(days)}
					onValueChange={(e) => setDays(Number(e))}
					aria-label="Expires"
					options={[
						...(EXPIRY_DAYS.map((d) => ({ value: d, label: d ? `in ${d} days` : "never" })) ?? []),
					]}
				/>
			</label>
			<Button type="submit" variant="primary" size="sm" disabled={!name.trim() || saving}>
				{saving ? "Creating…" : "Create key"}
			</Button>
			<div className="tw:w-full">
				<FormOutcome error={error} done={null} />
			</div>
		</form>
	);
}

function KeyList({ keys, onDeleted }: { keys: ApiKeyRow[]; onDeleted: () => void }): JSX.Element {
	const [confirming, setConfirming] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	if (!keys.length) return <p className={HINT}>No keys yet.</p>;

	const remove = async (id: string) => {
		setError(null);
		try {
			await deleteApiKey(id);
			setConfirming(null);
			onDeleted();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not delete the key.");
		}
	};

	return (
		<div className="tw:flex tw:flex-col tw:gap-2">
			<ul className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-2 tw:p-0">
				{keys.map((key) => (
					<li
						key={key.id}
						className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-border tw:pb-2"
					>
						<div className="tw:flex tw:flex-col tw:gap-0.5">
							<span className="tw:text-sm tw:font-medium">{key.name || "Unnamed key"}</span>
							<span className={HINT}>
								{key.start ? <code className="tw:font-mono">{key.start}…</code> : null} created{" "}
								{new Date(key.createdAt).toLocaleDateString()}
								{" · "}
								{key.expiresAt
									? `expires ${new Date(key.expiresAt).toLocaleDateString()}`
									: "does not expire"}
							</span>
						</div>
						{confirming === key.id ? (
							<span className="tw:flex tw:gap-2">
								<Button size="sm" onClick={() => setConfirming(null)}>
									Keep
								</Button>
								<Button size="sm" variant="danger" onClick={() => void remove(key.id)}>
									Delete — clients using it stop working
								</Button>
							</span>
						) : (
							<Button size="sm" onClick={() => setConfirming(key.id)}>
								Delete
							</Button>
						)}
					</li>
				))}
			</ul>
			<FormOutcome error={error} done={null} />
		</div>
	);
}

export function McpPanel(): JSX.Element {
	const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	// The value of a key just created. Held only while this page is open.
	const [fresh, setFresh] = useState<string | null>(null);
	const endpoint = mcpEndpoint();
	const guides = mcpClientGuides(endpoint, fresh);

	const load = useCallback(async () => {
		try {
			setKeys(await listApiKeys());
			setLoadError(null);
		} catch (err) {
			setLoadError(err instanceof Error ? err.message : "Could not load your keys.");
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	return (
		<>
			<AccountGroup
				title="1. Create a key"
				description="A key acts as you: it reaches the projects in every workspace you belong to."
			>
				<CreateKey
					onCreated={(key) => {
						setFresh(key);
						void load();
					}}
				/>
				{fresh && (
					<div className="tw:flex tw:flex-col tw:gap-2">
						<Callout tone="warn">
							Copy this key now — it is shown only once. The snippets below already include it.
						</Callout>
						<Copyable text={fresh} label="New key" />
					</div>
				)}
			</AccountGroup>

			<AccountGroup
				title="2. Connect your client"
				description={
					fresh
						? "Paste the snippet for your client. It carries your new key."
						: "Create a key first, or replace <API_KEY> with one you have."
				}
			>
				<TabsRoot defaultValue={guides[0]!.id}>
					<TabsList aria-label="MCP client" className="tw:flex-wrap">
						{guides.map((guide) => (
							<TabsTab key={guide.id} value={guide.id}>
								{guide.label}
							</TabsTab>
						))}
					</TabsList>
					{guides.map((guide) => (
						<TabsPanel
							key={guide.id}
							value={guide.id}
							className="tw:mt-3 tw:flex tw:flex-col tw:gap-2"
						>
							{guide.file && (
								<p className={HINT}>
									Add to <code className="tw:font-mono">{guide.file}</code>
								</p>
							)}
							{guide.note && <p className={HINT}>{guide.note}</p>}
							<Copyable text={guide.snippet} label={`${guide.label} setup`} />
						</TabsPanel>
					))}
				</TabsRoot>
				<p className={HINT}>
					Endpoint: <code className="tw:font-mono">{endpoint}</code>. Then ask your client to list
					your projects, run the agent on one, or make one precise edit — changes go through the
					project chat and its approvals.
				</p>
			</AccountGroup>

			<AccountGroup title="Your keys">
				{loadError ? (
					<FormOutcome error={loadError} done={null} />
				) : keys ? (
					<KeyList keys={keys} onDeleted={() => void load()} />
				) : (
					<p className={HINT}>Loading…</p>
				)}
			</AccountGroup>
		</>
	);
}
