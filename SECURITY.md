# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub: go to the repository's **Security** tab and
choose **Report a vulnerability**. That opens a private advisory visible only to
you and the maintainers.

Include what you would put in any good bug report: what you did, what happened,
what you expected, and the shortest reproduction you have. If the issue depends
on a specific configuration or provider credential, say which — do not paste the
credential itself.

You should get an acknowledgement within a week. If a report is confirmed, the
fix and the advisory are published together.

## Supported versions

Maleo is pre-1.0 and ships from `main`. Only the latest release is supported.
There are no backports to earlier tags.

## Scope

In scope:

- The HTTP API in `apps/api`, including authentication and workspace
  scoping.
- The web client in `apps/web`.
- The media generation path: `packages/media`, the `media-provider-*` packages,
  and `apps/media-worker`.
- Handling of provider credentials and workspace-scoped runtime data.

Out of scope:

- Anything requiring an attacker to already have shell access to the host, since
  the runtime database and `.env` are readable there by design.
- Vulnerabilities in third-party providers themselves. Report those upstream; if
  Maleo's integration makes an upstream issue worse, that part is in scope.
- Findings from automated scanners with no demonstrated impact on this codebase.

## Handling secrets

Provider API keys live in the root `.env` and never in the repository. If you
believe a credential has been committed, report it privately rather than opening
a pull request that removes it — a removal commit advertises the exposure while
the key is still live in history.
