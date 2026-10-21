# What problem does this solve?

<!--
One problem per pull request. Link the issue or discussion if there is one:
`refs #123`. If this changes product direction, the API, the schema,
persistence, the editor UI, or architecture, link the OpenSpec change instead.
-->

# What changed

<!-- The approach, and anything a reviewer would otherwise have to infer. -->

# Verification

<!--
Paste the actual output, not a claim. At minimum:

    bun run typecheck
    bun run test

For behavior changes, say which surface you exercised and what you saw.
-->

# Checklist

- [ ] I can explain what every change does, how it behaves at the edges, and
      what the tests prove.
- [ ] `bun run typecheck` and `bun run test` pass.
- [ ] New behavior has a test.
- [ ] `CHANGELOG.md` has an entry under `Unreleased`, or this change is
      release-note-exempt (docs-only, CI-only, test-only, or an internal
      refactor with no user-facing effect).
- [ ] No secrets, database snapshots, or generated media are committed.
- [ ] If this comes from a fork: I did not bump the root version and did not add
      a released `## [x.y.z]` changelog heading.
