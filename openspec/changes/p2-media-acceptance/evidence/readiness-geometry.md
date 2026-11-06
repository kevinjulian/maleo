# Readiness geometry (task 3.1)

## Check

`apps/web/visual/preview-clip-loading.spec.ts` (the delayed-media spec, 1440 px and 320 px) now
records the boxes of three elements and asserts that they are equal before and after readiness:

- the ruler (`[data-vui-slot="ruler"]`);
- the first lane (`.tl2-lanes [data-vui-row^='lane-']`);
- one clip (`video:904`).

"Before" is measured while a placed source has failed and Play is disabled ("Preview
unavailable"), immediately before Retry. "After" is measured when all five clips are ready. Each
run writes the boxes to `readiness-geometry-<width>.json`.

At 320 px, the spec taps a clip to open its actions before Retry. That tap scrolls the centred
phone timeline horizontally, and all three boxes move 108 px to the left together (y and height do
not change). This is the scroll, not readiness, so "before" is measured after the tap. A first
version that measured before the tap showed this movement:

```text
ruler  x 160 -> 52   (y 487, height 24 unchanged)
lane   x 160 -> 52   (y 571, height 36 unchanged)
clip   x 304 -> 196  (y 573, height 31 unchanged)
```

## Boxes (CSS px)

| Width   | Element    | x   | y     | width | height | Before = after |
| ------- | ---------- | --- | ----- | ----- | ------ | -------------- |
| 1440 px | ruler      | 129 | 525.5 | 1302  | 30     | yes            |
| 1440 px | first lane | 129 | 631.5 | 1302  | 48     | yes            |
| 1440 px | clip 904   | 273 | 633.5 | 36    | 43     | yes            |
| 320 px  | ruler      | 52  | 487   | 320   | 24     | yes            |
| 320 px  | first lane | 52  | 571   | 320   | 36     | yes            |
| 320 px  | clip 904   | 196 | 573   | 44    | 31     | yes            |

The readiness status inside the toolbar row (commit `1490e5f`) does not move the lanes. No change
to the toolbar row height, `docs/design-system/patterns/timeline-clip.md` or the transport
contract is necessary.

## Runs

```bash
npx playwright test visual/preview-clip-loading.spec.ts --project=visual
npx playwright test visual/preview-clip-loading.spec.ts --project=visual --repeat-each=3
```

Results: 2 passed, then 6 passed (warmup not counted), 0 failed.

## Drag spec without the settle wait (task 3.2)

The wait for the readiness notice to clear ("Loading preview media", "Preparing preview",
"Preview unavailable") is removed from the `timeline-chrome` spec "a clip dragged across lanes of
different heights lands on the lane under the pointer". The spec now measures the lanes and drags
at once.

```bash
npx playwright test visual/timeline-chrome.spec.ts --project=visual -g "dragged across lanes" --repeat-each=10
```

Result: 10 passed (11 with warmup), 0 failed.
