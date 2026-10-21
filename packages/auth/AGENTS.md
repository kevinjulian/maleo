# @maleo/auth — agent instructions

## Purpose

`@maleo/auth` owns operator identity: the better-auth configuration, sessions,
API keys, the registration policy, invitation context, and the request
perimeter (which paths are exempt from the session check, and why).

## Ownership

- `src/config.ts` owns the better-auth instance, auth table setup
  (`ensureAuthTables`), roles and password policy.
- `src/session.ts` resolves a request's `Caller`.
- `src/accounts.ts` reads account identity for other surfaces.
- `src/registration-policy.ts` and `src/invitation-context.ts` own who may
  create an account.
- `src/perimeter.ts` owns the deny-by-default session-exempt list.
  `perimeter.test.ts` asserts that list exactly.

## Local Contracts

- Library only: no routes, no Hono app, no middleware. The API wires these
  functions into requests in `packages/api/src/middleware/` and its dispatch.
  Hono glue that reads the API's request context (`instanceOwnerOnly`, the test
  caller seam) lives there, not here.
- The perimeter list is a security decision. Exposing a path is a deliberate edit
  to `src/perimeter.ts` with its reason beside it.
- Import by subpath: `@maleo/auth/config`, `@maleo/auth/session` and so on.

## Verification

```bash
bun run --cwd packages/auth test
```
