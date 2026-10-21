# Privacy

Maleo is local-first, not offline-only. Runtime state is stored locally, while
content leaves the machine when an operator enables a remote provider or loads a
remote asset. This document describes application behavior, not third-party
privacy guarantees.

## Data stored locally

- `data/maleo.db`: workspaces, projects, prompts, scripts, storyboards,
  references, provider selections, usage records, and encrypted provider values.
- `data/master.key` or `MALEO_MASTER_KEY`: key protecting stored credentials.
- `data/skills/`: local runtime skill definitions.
- Generated uploads, media, voice samples, render outputs, caches, logs, and
  temporary files under owning runtime data directories.
- Root `.env`: operator-supplied endpoints, credentials, and service tokens.

Deleting repository source does not delete these runtime files. Back up or erase
them according to deployment needs.

## Outbound data by capability

| Capability / provider                                                            | Data sent when enabled                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text — Codex CLI, Claude CLI                                                     | Prompts, system instructions, scripts, project context, selected references, and local CLI account metadata required by that CLI.                                              |
| Text — OpenAI-compatible API                                                     | Same generation content plus model/config values and API credential, sent to operator-configured endpoint.                                                                     |
| Images — Cloudflare Workers AI, Hugging Face Inference Providers, Codex Imagegen | Image prompts, dimensions/style controls, reference images or files, model/config values, and provider credential.                                                             |
| Speech — self-hosted Kokoro                                                      | Narration text, voice id, speed/output settings, and request metadata sent to configured Kokoro URL. It remains local only when that URL is local.                             |
| Research — SearXNG + Crawl4AI                                                    | Search terms go to SearXNG; selected URLs and extraction requests go to Crawl4AI. Configured search engines and destination websites also receive normal network request data. |
| Research — BrowserOS                                                             | Search terms, URLs, and page requests go through local BrowserOS MCP. Websites and any BrowserOS-configured upstream service receive normal request data.                      |
| Stock visuals — Pexels                                                           | Search terms and API credential go to Pexels. Loading thumbnails/assets contacts their delivery hosts.                                                                         |
| Sound effects — Freesound                                                        | Search terms, filters, and API credential go to Freesound. Loading previews/assets contacts their delivery hosts.                                                              |
| Captions — Local Whisper                                                         | Audio is processed locally. Installer/model download requests contact upstream hosts, but caption content is not sent by Maleo.                                                |
| Video — Remotion                                                                 | Project content and local/remote assets are read for local rendering. Remote asset URLs contact their hosts; a separately configured remote renderer follows its own terms.    |
| Sandbox/test providers                                                           | Synthetic inputs remain in local process unless a test explicitly configures network access.                                                                                   |

Provider credentials are sent only where needed to authenticate that provider.
Selected external media remains governed by provider and asset-specific terms;
see `THIRD_PARTY_NOTICES.md`.

## Hosting boundary

API has no user login and binds to loopback by default. Workspace selection is
not an authorization boundary. Never expose API or web proxy directly to
untrusted clients. Public or shared hosting requires application authentication
or an authenticating reverse proxy, TLS, access control for every routed service,
and operator-managed retention/backups.

## Operator controls

- Leave remote provider unconfigured to prevent Maleo from calling it.
- Prefer local/self-hosted endpoints when content must stay inside controlled
  infrastructure.
- Remove stored provider credentials in Settings and delete runtime data when no
  longer needed.
- Review provider privacy policies and asset terms before sending sensitive or
  personal content.
