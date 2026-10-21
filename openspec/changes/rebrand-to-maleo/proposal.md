# Proposal

## Why

The product is now Maleo. Existing app branding, package names, configuration, and installation assets still identify the old product.

## What Changes

- Replace product identity throughout active source, UI, documentation, build outputs, and deployment configuration with Maleo.
- Use the operator-supplied `malo-logo.png` as the logo source. Commit the source asset, display it in README and app identity surfaces, and derive browser and PWA icons from it.
- **BREAKING**: Rename all private TypeScript packages from `@aincer/*` to `@maleo/*`, including imports, dependency declarations, tests, and lockfile entries.
- **BREAKING**: Rename `AINCER_*` variables to `MALEO_*`. Do not add aliases, fallback reads, or dual-name support.
- **BREAKING**: Rename branded Rust crates, WASM outputs, browser storage keys, API-key prefixes, service registrations, database defaults, and deployment resources.
- Provide explicit cutover instructions that preserve project data, media, accounts, and encrypted provider credentials. Replace credentials that cannot be renamed safely.
- Convert persisted `config.AINCER_*` and `secret.AINCER_*` setting keys and the branded secret-envelope fingerprint through an explicit offline operation. Reject conflicts and pending key rotation before writing. Normal runtime uses only Maleo names.
- Preserve all eight existing SQL migrations byte-for-byte. Prove data preservation on synthetic pre-cutover state before changing runtime readers.
- Update current repository links and release metadata for the confirmed Maleo repository target. Prepare this in source without creating, renaming, pushing, or deploying a remote resource during implementation.
- Add automated checks against old identity returning to active product surfaces. Preserve historical Git records, released changelog entries, and archived OpenSpec artifacts.

## Capabilities

### New Capabilities

- `product-identity`: Maleo branding, technical identifiers, strict configuration naming, and explicit data-preserving cutover.

### Modified Capabilities

- `web-pwa-shell`: Require Maleo installation metadata, logo-derived browser and home-screen assets, and safe icon masking.

## Impact

All 12 TypeScript workspaces, Rust crates, root scripts and task configuration, Bun and Cargo lockfiles, auth, database startup, durable execution, web static serving, CI, root Dockerfile, deployment manifests, and live documentation are affected. Logo provenance belongs in `THIRD_PARTY_NOTICES.md` for the existing release gate.

This is a coordinated breaking release configuration change. Existing environments require explicit conversion before the new runtime starts. Domain migration and actual remote repository or deployment operations are separate actions. No feature work, version bump, offline mode, or automatic archive is included.
