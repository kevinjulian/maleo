# God Mode

God Mode is deployment administration for an active `instance_owner`. Open **Manage → God Mode** or go to `/god/general`. Its separate navigation has Management (Users, Workspaces, Projects) and Instance (General, Authentication, Providers, Security & Storage, Usage, Audit log). On a phone, open its menu from the header. **Back to app** returns to ordinary workspace content.

Instance ownership does not grant project or workspace content access. The ordinary workspace switcher and content routes still require a membership. To access a workspace, grant the account a role explicitly from God Mode; that grant is audited. Workspace owners continue to manage their own workspace under **Manage → Workspace**.

## Accounts and succession

Users shows active or suspended status, instance role, and workspace memberships. Promote another active account before demoting, suspending, or deleting the last active instance owner. Promotion, demotion, suspension, and deletion each require typing the account email; revoking sessions and removing a membership ask for a second press. Suspending an account revokes its sessions and blocks sign-in; restoring it retains its memberships. While the account is the only owner of a workspace, its detail names that workspace and offers **Transfer ownership** in place of Delete; make another member an owner there first. Account deletion removes sessions and memberships, not project content.

Authentication offers **Open** or **Invitation only** self-registration. The first account can always claim an empty deployment. Invitation redemption works under either policy. If `MALEO_ALLOW_SIGNUP` is explicitly set, it overrides the stored policy (`1` opens registration; any other value closes self-registration), and God Mode shows the effective source with the stored control disabled.

## Workspaces and settings

Workspaces lists every workspace for instance owners. Creating one requires an owner email; that account becomes its first owner, and the instance owner does not become a member. Its detail shows members, pending invitations, project count, and activity time. A membership change applies the same last-owner rule as the workspace page. Invitations return a token only when created; copy the link then. Deletion shows affected accounts, accounts losing their only workspace, project count, and active runs. Confirm the impact and type the exact workspace name. The API also requires the IDs of the accounts losing access; if they differ from the current impact, the request is refused and needs a fresh preview. The panel re-reads the impact after every change. The final workspace cannot be deleted from either surface, including by two concurrent deletions. The existing deletion service cancels active runs, removes rows, then removes local files.

Projects shows title, workspace, type, status, and timestamps. Its God Mode detail never returns storyboard, brief, media, or output content. Providers, Security & Storage, and Usage reuse the previous Settings controls. Editor and Image Lab show current provider status; deployment-wide provider selection happens in God Mode. Saved `/settings/*` links open the matching `/god/*` level, including capability and provider details, for instance owners.

## Pipelines & Tools

**Instance → Pipelines & Tools** opens the workflow directory at `/god/pipelines`. Workflows is the primary destination; Definitions is the secondary complete inventory with Tools, Prompts, Operations and Profiles categories. Choose a workflow to see purpose, callable trigger/entry point, inputs, outputs, source ownership/runtime-authority boundaries and published stages. Missing facts remain explicitly not exposed. Human-readable production labels do not change canonical identifiers.

Stages form a vertical ordered list at phone and desktop widths. Expand a stage inline to browse direct associations and reachable operations, tools, prompts, conditions and repeat behavior. Associations are not execution order; only actual next relationships have continuation arrows. Optional tools appear separately. Workflow instructions remain workflow-wide unless a stage relationship exists. Shared references always open the same canonical definition.

Contextual search highlights actual matching dependencies and their stages while retaining every executable stage in order. Query matches temporarily reveal relevant stages; clearing restores explicit expansion choices. Definitions search filters current rows directly, with opt-in prompt-text search. All applicable metadata filters stay visible; each inventory category keeps independent session state. Workflow context never hides inventory definitions.

The existing single right Sheet contains complete contracts, exact copyable prompt text/composition, variables, source locations, canonical IDs, current revisions and named direct consumers with navigable workflow/stage contexts. Used by separates direct use, transitive reachability and optional availability. Source locations stay in Technical. No graph framework, prompt store, runtime trace viewer or AI execution action is added.

Canonical links include `/god/pipelines/workflows/workflow%3Aplan_story` and `/god/pipelines/definitions/prompts?inspect=prompt%3Aclarification%3AstoryClarificationPrompt`. Workflow routes use `stage`, repeated `open`, `inspect`, repeated validated `via` context frames, `q` and relevant filters. Inventory URLs use `context` for retained workflow identity. Reload and browser Back/Forward restore visible state; typing/filter/disclosure updates replace history rather than adding keystroke entries. Inspector Back restores one previous frame; closing returns focus to the current origin or surviving stage/context. Unknown IDs remain unavailable; malformed paths/trails cannot crash navigation. No old explorer-route compatibility parser is retained.

Coverage exposes derived, declared, opaque and unexposed facts by execution, relationship, instruction and contract scope, without completeness percentages. Current catalog publishes no revision-bound test attestations, so verification evidence is explicitly not published; derived does not mean Verified. This view explains possible behavior rather than recording a run.

`GET /api/admin/agent-templates` returns catalog schema 2: `schemaVersion`, content `revision`, `definitions`, and typed `relationships` with fact/edge provenance. No legacy catalog version is supported. Deploy API/web together and reload loaded clients. Active instance ownership is required even without workspace membership or an AI provider. Anonymous, suspended, and revoked sessions receive `401`; members receive `403`; invalid deployed definitions receive `500` without a partial catalog. Refresh/retry clears displayed definitions before reading again; an authorization refusal keeps them cleared.

Catalog reads do not execute AI, connect to MCP servers, write state, or incur generation charges. Responses contain fixed application instructions, interpolation expressions, defaults, composition order, schemas, and source owners. They exclude credentials, workspace MCP configuration, private briefs/materials, actual reference URLs, submitted prompts, and run history. Prompt text can be selected or copied. Revisions identify current definition content, not stored historical versions. Actual runtime inputs and provider selection still determine submitted requests; the running view is separate future work. AI features remain backend-owned; this feature introduces no user AI-provider key requirement.

Planning (`plan_story`, its shared `plan_story_core`, and `create_story_video`)
is projected from the workflow definitions the engine executes: nodes, branch
conditions as their expressions, suspensions, calls and ends. Registered
operations, rules and facts are opaque code, shown by id with their declared
input and output schemas, prompts, tools and capabilities; inspecting a definition
does not certify an operation's internals. Planning prompts are projected from
their templates: fixed text with every slot, constant, formatter, include and
condition named in place, the inputs, and the response contract a model request
names. Branch inputs and slot values remain unresolved; template text is never
labeled as a submitted request. Story asset generation retains declared
inspection metadata until it is ported to a definition.

## Admin API authorization and directories

Every `/api/admin/*` route requires an active instance owner; members receive `403`. Suspended accounts and revoked sessions cannot pass the API dispatch. Directories use `q`, `limit` (1–100, default 20), and `offset`; responses contain `{items,total}`. Detail reads contain `{item}`. All directory and detail payloads are metadata only. User metadata includes ID, email, display name, instance role, suspended status, creation time, and memberships. Workspace metadata includes key, display name, status, description, counts, member labels/roles, and pending invitation metadata. Project metadata includes ID, workspace, title, type, status, and timestamps.

`GET /api/admin/audit` returns bounded `{items,total}` pages. Each row has `id`, `actor_id`, `action`, `target_type`, `target_id`, `outcome`, `reason`, and `created_at`. Records contain no credential value or raw invitation token. A global settings write records the setting names it touched (for example `/api/settings/global:updates.OPENAI_API_KEY`), never their values. If the audit record itself cannot be written, the response keeps its real status and carries `x-maleo-audit: failed`. Account writes use `PATCH /users/:id/role`, `PATCH /users/:id/status`, `POST /users/:id/revoke-sessions`, and confirmed `DELETE /users/:id` under `/api/admin`. Workspace writes use `POST /api/admin/workspaces` (`name`, `owner_email`, optional `display_name`) and explicit `/api/admin/workspaces/:name` membership, invitation, update, and deletion routes. Deletion takes `confirm_name` and `confirm_losing_access` (an array of account IDs). User details list each membership with `sole_owner`. `GET /api/admin/workspaces/:name/delete-impact` previews deletion. `GET/PUT /api/admin/authentication` reads and writes registration policy.

Global provider selection, credential metadata/writes, and security routes under `/api/settings`, `/api/capabilities`, `/api/providers`, and `/api/security` require instance ownership. Non-sensitive provider/readiness projections remain available to signed-in editors. Named-workspace settings require membership to read and workspace ownership to write. Server checks apply even when a UI control is hidden.

Template inventories and drawer tables share canonical Table spacing with Settings credit ledgers. Native links preserve modified-click/new-tab behavior; copy/refresh/close remain actions. At 320px, stages stay vertical, coarse-pointer actions retain canonical targets and wide schema/tables scroll in labeled focusable regions without page overflow. Themes, reduced motion and keyboard focus remain supported.
