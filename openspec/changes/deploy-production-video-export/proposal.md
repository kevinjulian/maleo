# Proposal

## Why

Production video export reports `video service not configured`. Both committed production Compose files omit the render worker and its API connection settings, although the editor submits exports through that service.

## What Changes

- Deploy existing render worker within the core Compose network, using local Remotion rendering.
- Configure API-to-worker authentication and worker-to-API managed media access.
- Provide browser dependencies at image build time and persistent render job/output storage.
- Extend deployment checks to catch missing export wiring, rather than only differences between Compose files.
- Document secret setup, rollout, verification, and rollback for both deployment targets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployable-service-layout`: Require production core stack to include an authenticated, persistent render worker with executable export verification.

## Impact

Affected files include both production Compose files, root Dockerfile, deployment environment example, deployment checks and tests, operator docs, deployment records, and CHANGELOG.md. Existing render-worker runtime is reused; minimal runtime changes are allowed only if container verification exposes a deployment blocker. No HTTP API, database schema, editor UX, Lambda provisioning, or local development orchestration redesign is planned. Live production has not been inspected; rollout must verify actual service configuration and export behavior.
