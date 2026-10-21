# Editor surface performance budget

The timeline surface's budget: the kernel store and transactions from
`@maleo/vui/kernel`, and the geometry query in
`apps/web/src/controllers/surface/query.ts`. Measured by
`bun apps/web/src/controllers/surface/surface-budget.bench.ts` on a synthetic
timeline rather than on the running editor: the editor's numbers carry its own
chrome, document and React tree, so a budget measured there moves for reasons
that have nothing to do with the surface and ends up either muted or wrong.

This budget moved from the former VUI package README, with the benchmark from its
`multi-row` example, when the DOM layer moved into the web app
(`migrate-editor-to-shared-rust-core` task 3.1). The recorded values are from
that measurement; `surface-budget.test.ts` keeps this table and the benchmark's
enforced ceilings in agreement.

**Hardware and method**: Apple M1 Pro, 16 GB, macOS 26.5.2, Bun 1.3.1.
**2000 items** across three rows of unlike heights, viewport **1440 px** at
0.0006 device pixels per tick. Timings are the **median** of 200 runs — the
median, not the mean, so one scheduling hiccup does not become the number
everybody quotes.

Every entry is classified, and the classification decides what may be asserted:

| Entry                                                   | Class         | Value                       | Why this class                                                                                                                       |
| ------------------------------------------------------- | ------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Elements mounted per visible item                       | **invariant** | `1`                         | True on any machine or the virtualization is broken. Asserted exactly.                                                               |
| Items visible at 1440 px, of 2000                       | **invariant** | `161`                       | What is mounted follows what is on screen, not the size of the project. A scroll changes _which_ items, not _how many_.              |
| Slice notifications from an unrelated change            | **invariant** | `0`                         | A scroll must not notify a selection subscriber. Asserted exactly, no tolerance.                                                     |
| One viewport sample: dispatch + resolve the visible set | **bound**     | `0.057 ms` (ceiling `2 ms`) | Hardware-dependent, so a ceiling — set an order of magnitude above the median, to catch a regression in _kind_ rather than in noise. |
| One committed trim: `begin` → `update` → `commit`       | **bound**     | `0.038 ms` (ceiling `2 ms`) | Same reason.                                                                                                                         |
| Building the geometry index from scratch                | **reported**  | `0.060 ms`                  | Recorded, never asserted. A threshold on a number that moves with hardware and CI load becomes a muted test within a week.           |

The invariants and the bounds fail the benchmark run. The reported entry only
prints — deliberately, and that is the whole of the distinction.
