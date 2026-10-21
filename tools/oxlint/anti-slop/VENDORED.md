# Vendored: anti-slop

Source: https://github.com/dmmulroy/anti-slop
Commit: 6d538555cb151d4121ed51a27db81890eacf8ae9
Vendored: 2026-08-20

anti-slop ships as source to copy rather than as a versioned dependency, because
the rules are opinions a team is expected to tune. This is a local copy: drift
from upstream is expected, not a defect.

The upstream rule tests are not vendored — they test the plugin, not this
repository. Which rules are enabled, and at what severity, is decided in the root
`oxlint.config.ts`.

To re-sync, diff this tree against the upstream commit above and re-measure with
`bunx vp lint` before changing any severity.

## Local drift

`rules/no-known-value-widening.ts` — upstream's single `no-known-value-widening`
rule is registered here as twenty ids, `no-widening-<target>-<position>`, one per
destination kind and syntactic position. The DETECTION is untouched: the same
`reportFlow` runs, and each id filters the pair it owns, so the total finding
count is identical before and after the split (309 errors either way, measured).
A re-sync therefore diffs against intact upstream logic; only the reporting
differs.

The split exists because one id can carry only one severity, and the pairs do not
behave alike — `open dictionary` measured ~11% genuine on a binding against ~43%
on a return, and 17 of its 20 assertion findings are in tests while 39 of its 43
binding findings are in source. See `make-lint-all-a-gate` for the samples.
