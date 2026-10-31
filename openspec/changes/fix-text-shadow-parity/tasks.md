# Tasks

## 1. Evidence

- [ ] 1.1 Rebuild the `composition-generated` case with the script in `evidence.md`, add `motion-comp.generated` to `corpus/manifest.json`, render references from the pinned image, and verify `compositions_match_production` reproduces the 4 px drift.

## 2. Fix

- [ ] 2.1 Find the cause of the fainter shadow tail near the glyphs, and verify it with a row profile against the reference.
- [ ] 2.2 Find the cause of the half-pixel glyph offset, and verify it with a row profile against the reference.
- [ ] 2.3 Fix both in `crates/renderer`, and verify `cargo test -p maleo-renderer --test golden` passes for every case.
