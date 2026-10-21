# Select

Owner: `apps/web/src/design-system/components/select.tsx`. Feature consumers supply `options` containing value/label and optional icon, description, disabled and group. `value` or `defaultValue` and `onValueChange` carry strings directly. Unknown committed values display as unavailable; disabled/removed options never commit. Empty lists show an empty message.

Select retains xs/sm/md field sizing, auto/full width, id/label associations, invalid/disabled/required state and name/form/reset behavior. Desktop uses Base UI non-modal selection, collision-aware positioning and the existing floating host. Phone uses the VUI-owned bottom Sheet. Default boundary is 640px; editor consumers use 860px. Keyboard supports Enter, arrows, Home/End and typeahead; Space in active editor follows transport. Escape/outside/Close/Back dismiss only the eligible picker and return trigger focus. Resize preserves value and one overlay.

Stories: `apps/web/stories/components/select.stories.tsx`. Acceptance requires real desktop/320px coarse-pointer behavior, nested sheets, forms and both themes. See accepted verification (private historical record).

Implementation: `@design-system/components/select.tsx`; presentation `select.css`; stories `stories/components/select.stories.tsx`. Base UI supplies inline anchor/available-height measurements; CSS provides geometry fallbacks. Controlled callers retain unavailable values visibly; `onSelect` narrows domain unions before existing writers run. Empty options show recovery copy. Do not pass native change events or option children.

Dynamic options retain the committed value when rows register or disappear. Synthetic Base UI reconciliation does not write feature state; closed-trigger typeahead retains its keyboard origin. Phone rows remain registered inside the inert closed Sheet so hardware-keyboard typeahead works in both presentations.

Proof: `visual/responsive-options.spec.ts` covers production toolbar, Space, topmost phone Back, focus and responsive housing; `visual/options-stories.ts` drives built stories, long/grouped/disabled/typeahead/form reset states at desktop/320px in both themes. Inspector, gallery, Settings and studio flows remain covered by their production visual suites.
