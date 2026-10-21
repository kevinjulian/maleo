/* Anti-slop lint rules — reject TypeScript that type-checks but carries no
 * evidence: assertions with no stated invariant, `unknown` crossing a function
 * boundary, dictionaries typed `Record<string, unknown>`.
 *
 * The plugin is vendored in `tools/oxlint/anti-slop/` (see VENDORED.md); it
 * ships as source to copy and tune, not as a pinned dependency.
 *
 * ── How a rule earns its severity ────────────────────────────────────────────
 *
 * From a SAMPLE of its violations, not from its count. A count says how loud a
 * rule is; a sample says whether it is right. Every rule below has exactly one
 * disposition, with the sample that produced it:
 *
 *   GATE     its violations are genuine — set to `error`
 *   SCOPE    genuine, but not everywhere — `error`, narrowed by the construct
 *            that makes the flagged type correct (see `overrides` below)
 *   RETIRE   it does not fit this codebase — off, with the reason kept here
 *
 * A scope names a CAUSE, never a file list. `overrides` uses paths because a
 * path is all oxlint can match on, but each entry's comment states the construct
 * and the sample, so the claim can be checked and reversed. An entry nobody can
 * re-read is the ignore list this vocabulary exists to avoid.
 *
 * `vp check` (run by `bun run check` and `bun run ci`) gates every rule below
 * at `error` across the whole repository: each is at zero, so a finding
 * anywhere fails it. How each rule got there — fixed, scoped by cause, or with
 * the dead code that carried it deleted — is recorded in the
 * `migrate-to-vite-plus` change's `evidence/lint-resolution.md`.
 */
import type { OxlintConfig } from "vite-plus/lint";

export default {
	ignorePatterns: [
		"tools/oxlint/anti-slop/**",
		"**/node_modules/**",
		"**/dist/**",
		"**/dist-staging/**",
		"**/out/**",
		"**/.output/**",
		// Archived OpenSpec evidence: one-off measurement scripts kept as the record
		// of a closed change, run once against the tree as it was then.
		"openspec/changes/archive/**",
	],
	jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
	/* Upstream families selected under `migrate-to-vite-plus` from samples recorded
	 * in that change's `evidence/lint-baseline.md`. `correctness` is `error`
	 * because a warning gates nothing; every correctness rule that had findings
	 * was sampled and is either kept at `error` or turned off below. */
	plugins: ["typescript", "unicorn", "oxc", "react", "jsx-a11y"],
	categories: { correctness: "error" },
	rules: {
		/* ── GATE: upstream rules whose samples were genuine ───────────────────── */
		// 10. `packages/video/src/compositions/reel-text.tsx` calls `useCurrentFrame`
		// after an early return. A Storybook `render` and a helper named `use*`
		// that is not a hook were repaired; tests are scoped below.
		"react/rules-of-hooks": "error",
		// 15. Sampled switches miss real members: "unconfigured", "captions", null.
		"typescript/switch-exhaustiveness-check": "error",
		// 58. Fire-and-forget shutdown and worker loops; `void` states the intent.
		"typescript/no-floating-promises": "error",
		// 24. `process.on("exit", async ...)` cleanup never awaits; an async
		// `watch` callback drops rejections. JSX handler attributes are excluded:
		// React ignores the returned promise by contract, and those samples were
		// the noise.
		"typescript/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
		// 101. Sampled source arguments are `any` leaks (zod `_def`, untyped reads).
		"typescript/no-unsafe-argument": "error",
		// 15. Numeric `.sort()` without a comparator sorts lexically.
		"typescript/require-array-sort-compare": "error",
		// 19 + 18 + 1. Clickable `div` rows with no keyboard path or role, and a
		// `role="slider"` with no `aria-valuenow`.
		"jsx-a11y/click-events-have-key-events": "error",
		"jsx-a11y/no-static-element-interactions": "error",
		"jsx-a11y/role-has-required-aria-props": "error",

		/* ── RETIRE: upstream rules whose samples described correct code ─────────── */
		// 12, 0 of 3 genuine: the spread snapshots a collection that the loop body
		// mutates (`endGesture` deletes from the map; listeners unsubscribe).
		"unicorn/no-useless-spread": "off",
		// 27, 0 of 2: destructured props and arrow-function options, never `this`.
		"typescript/unbound-method": "off",
		// 32, 0 of 3: numbers and arrays interpolated on purpose in messages.
		"typescript/restrict-template-expressions": "off",
		// 25, 0 of 3: setters from custom stores the rule cannot prove stable, and
		// deliberate serialized-key dependencies.
		"react/exhaustive-deps": "off",
		// React Compiler rules, which oxlint 1.87 runs under `correctness` (the 1.78
		// install task 2.3 measured with did not). 132 findings; 16 sampled
		// (seeded), 0 defects: the latest-ref pattern (`ref.current = x` in render),
		// test harnesses capturing a hook's result, DOM writes inside effects,
		// elapsed-time `Date.now()`, prop-to-state sync in an effect. They check
		// that code is safe for the React Compiler, which this repository does not
		// use. `migrate-to-vite-plus` evidence/lint-resolution.md.
		"react/set-state-in-effect": "off",
		"react/refs": "off",
		"react/immutability": "off",
		"react/globals": "off",
		"react/purity": "off",
		"react/preserve-manual-memoization": "off",
		// 11, 0 of 4: `createElement(X, { children })` in tests is the documented form.
		"react/no-children-prop": "off",
		// 7, 0 of 4: icon buttons name themselves with `title`; the checkbox
		// renders through Base UI's `render` prop.
		"jsx-a11y/control-has-associated-label": "off",
		// 6, 0 of 4 beyond what `click-events-have-key-events` already gates:
		// dialog scrims close on click, drag surfaces take pointer input.
		"jsx-a11y/no-noninteractive-element-interactions": "off",
		// 1, 0 of 1: `role="list"` restores list semantics Safari drops under
		// `list-style: none`.
		"jsx-a11y/no-redundant-roles": "off",
		// 79, 0 of 2: `role="group"`/`role="status"` on a `div` is valid ARIA.
		"jsx-a11y/prefer-tag-over-role": "off",
		// 42, 0 of 2: `<label>text<Input/></label>` associates implicitly; the rule
		// cannot see that the design-system `Input` renders an `input`.
		"jsx-a11y/label-has-associated-control": "off",
		// 10, 0 of 2: focus moves into a just-opened dialog field on purpose.
		"jsx-a11y/no-autofocus": "off",
		// 0 of 1 each: design-system wrappers pass content through `...rest`
		// (anchor, heading); a focusable scroll region needs `tabIndex={0}`; a
		// media preview has no caption track to offer.
		"jsx-a11y/anchor-has-content": "off",
		"jsx-a11y/heading-has-content": "off",
		"jsx-a11y/no-noninteractive-tabindex": "off",
		"jsx-a11y/media-has-caption": "off",

		/* ── GATE: zero violations, and cost nothing to keep that way ──────────── */
		"anti-slop/no-module-mocking": "error",
		"anti-slop/no-object-parameters": "error",
		"anti-slop/no-reflect-apply": "error",
		"anti-slop/no-reflect-get": "error",
		"anti-slop/no-unknown-type-aliases": "error",
		"anti-slop/no-widen-then-assert": "error",

		/* ── GATE: genuine, at zero ────────────────────────────────────────────── */

		// AT ZERO. Reached under `close-the-dictionary-and-chain-rules`: 18 findings,
		// 7 fixed and 11 scoped by cause below.
		//
		// `x as unknown as Y` — the double assertion that turns off the checker.
		// Sample: `btn as unknown as HTMLButtonElement` (a plain `as` would do),
		// `window as unknown as {...}` (declaration merging would do). Real smell.
		// 110 repo-wide at adoption, 44 in the three gated rules' first measurement;
		// 37 after `parse-boundaries-into-domain-types`, 22 before this change and
		// 18 after it.
		//
		// CORRECTION. This comment used to say the rule "can reach zero: every one
		// left is a chain that a decode at the boundary above it would remove."
		// All 36 were then read under `fix-what-the-gated-rules-actually-catch` and
		// that is not true of about half. The ones it described are real and were
		// fixed — a `React.PointerEvent` parameter on a handler that reads only
		// `clientX`, an `HTMLButtonElement` passed to something taking
		// `HTMLElement`, and a script whose `prepared` array omitted one field of
		// the interface it was already being cast to. What is left does not have a
		// decode above it:
		//
		//   a persisted blob read back as its domain type   5  workflow_run snapshots
		//   two storyboard types that should be one         4  see below
		//   a type we do not own                            5  Remotion, Inngest, happy-dom
		//   open on purpose                                 5  Proxy trap, structural diff
		//   scattered singles                               3
		//
		// Four of those — Remotion's presentations and happy-dom's `Document` — are
		// scoped below by that cause. The other 18 stay gated.
		//
		// The snapshot group belongs with the change that can verify a schema
		// against stored rows; `parse-boundaries-into-domain-types` recorded
		// `workflow_run` as holding 4-111 rows, too few to check one against.
		// The storyboard group is one defect wearing four faces: `StoryboardForRender`
		// in `@maleo/shared` and `Storyboard` in `@maleo/video` are near-identical
		// and NOT assignable — constraining `absolutizeStoryboard`'s generic makes
		// the compiler say so, on `focalPoint` being nullable in one and not the
		// other. Reconciling them is its own change.
		//
		// FLOOR ~14 of the 18 that remain: the snapshot, storyboard and
		// open-on-purpose groups. The other 4 are single sites with a real fix.
		"anti-slop/no-chained-type-assertions": "error",

		/* ── The widening rule, split by construct ─────────────────────────────
		 * An explicit broad annotation where `satisfies` would keep the literal
		 * types. Sample: `const POLICIES: Record<RetryCategory, Policy> = {...}`,
		 * which discards which keys exist. 271 repo-wide at adoption, 201 at the
		 * last sample, 97 at the start of `make-lint-all-a-gate` and **15 now**.
		 *
		 * One id per destination kind and syntactic position. The detection is
		 * unchanged from the single `no-known-value-widening` it replaces — the
		 * split moved no findings, 309 errors before and after — but one id could
		 * carry only one severity, and the pairs do not behave alike: the sample
		 * that produced the old shared floor of ~96 scored its sub-kinds between
		 * 0% and 100% genuine, so the floor was an average over constructs rather
		 * than a property of any of them.
		 *
		 *   97 at baseline  →  50 RETIRED   two pairs measured 0% genuine
		 *                      32 SCOPED    by cause, below
		 *                      15 remain    12 backlog + 3 recorded floor
		 *
		 * 0 fixed in code: this change edited none. Measured under
		 * `make-lint-all-a-gate` (see its `sample.md`, `extract.ts` and
		 * `buckets.ts`; every number below re-runs). Every `make-lint-all-a-gate`
		 * citation below is to
		 * private historical record.
		 *
		 * Every pair is now at zero: the 15 above were resolved under
		 * `migrate-to-vite-plus`. Pairs with no findings
		 * are still registered: a plugin rule that is not configured is a construct
		 * nothing checks, and the pair at zero is the one most likely to be
		 * introduced unnoticed. */

		// RETIRE. 43 findings, and 0 of them genuine — the clearest retire here.
		//
		// A lookup table annotated `Record<K, V>`. `satisfies` keeps literal keys,
		// so a table indexed by a runtime string stops compiling: the wide
		// annotation is the ACCURATE one, not a lazy one. Measured by resolving
		// every flagged binding's index expressions across the repository:
		//
		//   indexed by a runtime expression  36  `MANIFEST[channelId]`, `Ic[copy.icon]`
		//   never indexed                     7  read individually, below
		//
		// The 7: three are iterated rather than indexed (`Object.entries(
		// STATIC_ASSETS)`, `SHEET_PREFIXES`, `RENAMED_KEYS`) so no key evidence is
		// consumed anywhere; two are local accumulators MUTATED after declaration
		// (`payload.reference_image_urls = refs`) where the wide annotation is what
		// makes the mutation compile; two are dead (`MOOD_MAP`, `TRANSITION_MAP`,
		// zero references) and `no-unused-vars` already reports both, so their fix
		// is deletion by that rule rather than `satisfies` by this one.
		//
		// NOT narrowed by detection instead of severity, and the reason is a limit
		// rather than a preference: "a table indexed dynamically" is a fact about a
		// binding's CALL SITES, which an oxlint JS plugin cannot see — it visits one
		// file's AST with no cross-file resolution. A within-file approximation
		// would clear 4 of the 36 and misreport the rest.
		//
		// Prior estimate was ~11% genuine from 55 findings. This read makes it 0%.
		"anti-slop/no-widening-open-dictionary-binding": "off",

		// GATE. 24 at baseline, **12 now** — 12 scoped by cause, 0 fixed in code,
		// and FLOOR 0: every one of the 12 has a contract to name.
		//
		// Half are a reader accumulating a map whose keys are runtime strings — an
		// env block, a secrets file, a per-path source map — and return `out` after
		// building it. Those are scoped by that cause in `overrides` below.
		//
		// The other half return an object literal with statically known fields
		// while declaring `Record<string, unknown>`, which is the case the rule is
		// for: the contract exists and is not named. They stay gated and are the
		// follow-up's work. `writeStoryboardDocument` is the exception already
		// recorded above — a serialized payload has no value contract.
		"anti-slop/no-widening-open-dictionary-return": "error",

		// SCOPE, to tests. 20 at baseline, **3 now** — 17 scoped, 0 fixed in code,
		// and FLOOR 3: all three that remain are the recorded floor below.
		//
		// Every one of the 17 is a deliberately partial fixture cast to the type the
		// function under test takes: `{ aspectRatio: "9:16", voice: "" } as unknown
		// as GlobalSettingsLike`. The cast IS the assertion the test makes — the
		// same reasoning that already exempts tests from the two assertion rules.
		//
		// The 3 outside tests each fall under a cause already named here: a
		// dynamic-key write in `workspace-image-style.ts` (runtime-key config), a
		// structural walk in `timeline-doc.ts` (`{ ...payload } as Record<…>`), and
		// the `image-gen.ts:409` site the assertion rule also reports.
		"anti-slop/no-widening-open-dictionary-assertion": "error",

		// RETIRE. 7 findings, 0 genuine.
		//
		// A return deliberately left open because the shape belongs to the caller or
		// to a stored snapshot: `capBlob` returning a truncation marker for a blob
		// it did not write, `absolutizeStoryboardImages` crossing the two-storyboard
		// seam already recorded above, an accumulator in `agent-trace`, and three
		// `return null` in one test helper declared `: unknown`.
		//
		// The prior sample scored this sub-kind ~0% genuine on the strength of Zod
		// preprocessors. Those are gone — `z.preprocess` produces no findings for
		// this pair today — so the rate survives its original reason.
		//
		// The `overrides` entry that scoped `video-blueprint.ts` and
		// `timeline-template.ts` for those preprocessors is DELETED, so there is no
		// zod-preprocess cause left to extend to the assertion rule. Its three
		// findings in those two files were read anyway and none is a preprocessor:
		// a key into a table this code owns (guarded by `in` on the line above), an
		// `Object.fromEntries` building a Zod shape, and a stored-blob reconciler.
		// All three stay gated. See `make-lint-all-a-gate/sample.md` §4.9.
		"anti-slop/no-widening-unknown-return": "off",

		// GATE, and AT ZERO. This was the sub-kind worth having: 81 findings at the
		// last sample, ~81 of them genuine, all since fixed by naming the contracts
		// they were widening away.
		"anti-slop/no-widening-anonymous-object-return": "error",

		// SCOPE, to tests. 3 findings, all three test scaffolding: two `const
		// captured: { hadResearch?: boolean } = {}` accumulators assigned by a spy,
		// and one `(c as unknown as { raw: RawMcp })` fixture read.
		"anti-slop/no-widening-anonymous-object-binding": "error",
		"anti-slop/no-widening-anonymous-object-assertion": "error",

		/* No findings today. Gated so that the first one is caught. */
		"anti-slop/no-widening-anonymous-object-property": "error",
		"anti-slop/no-widening-generic-container-assertion": "error",
		"anti-slop/no-widening-generic-container-binding": "error",
		"anti-slop/no-widening-generic-container-property": "error",
		"anti-slop/no-widening-generic-container-return": "error",
		"anti-slop/no-widening-object-assertion": "error",
		"anti-slop/no-widening-object-binding": "error",
		"anti-slop/no-widening-object-property": "error",
		"anti-slop/no-widening-object-return": "error",
		"anti-slop/no-widening-open-dictionary-property": "error",
		"anti-slop/no-widening-unknown-assertion": "error",
		"anti-slop/no-widening-unknown-binding": "error",
		"anti-slop/no-widening-unknown-property": "error",

		// AT ZERO. Reached
		// under `close-the-dictionary-and-chain-rules`: 62 findings, 48 fixed and 14
		// scoped by cause below. The largest fix was naming what a text template's
		// parameters hold — JSON, not `unknown` — which took 29 of them at once.
		//
		// `Record<string, unknown>` as a value contract. Sample: LLM tool args
		// (genuinely dynamic until parsed) alongside plain laziness. Mixed, leaning
		// genuine, and the boundary is where it matters most. 480 repo-wide at
		// adoption, 380 after `parse-boundaries-into-domain-types`.
		//
		// CANNOT reach zero, and the reason is worth keeping. A SERIALIZED payload
		// has no value contract — that is what makes it a payload — so the type a
		// writer returns for the bytes it emits is honestly a dictionary. Both an
		// alias and an index-signature interface were tried for
		// `writeStoryboardDocument`'s return and the rule flags each, correctly.
		// The rule's real target is a dictionary used as a DOMAIN type; the emitted
		// form is the one place the answer is "yes, and that is what it is".
		//
		// SCOPED, not retired. All 380 were read under
		// `scope-gated-rules-away-from-open-types` (see its `sample.md`); 316 are on
		// a type that is open on purpose — a stored or transmitted payload, an
		// unparsed external response, a config whose keys are runtime strings, an
		// argument the model supplied before a schema sees it. Each has an entry in
		// `overrides` naming its cause. The 64 that remain are gated everywhere, and
		// 53 of them are genuinely fixable: the text-preset `params` bag (37, a
		// union keyed by `TextPreset` closes it), the image provider's `raw`
		// response (9), and the post-parse agent flows (7, deliberately left in
		// scope — see the re-enabling override). FLOOR ~11: caller-supplied billing
		// metadata (8) and three one-off dynamic key sets.
		"anti-slop/no-unsafe-dictionary-type": "error",

		// A type assertion with no stated invariant. Sample: `setScenes as
		// React.Dispatch<SetStateAction<(Scene | Slide)[]>>` — a real widening that
		// deserves a sentence. The most valuable rule here and the largest at 1528
		// at adoption, which is why it was cleared site by site rather than in bulk:
		// a `SAFETY:` line written to silence a linter is the text it exists to catch.
		//
		// SAMPLED IN FULL under `sample-the-safety-comment-rule` — all 585
		// classified, the 115 the classifier could not decide read by hand, and the
		// classifier kept beside the sample so the numbers re-run rather than being
		// believed. 1528 at adoption, 585 now.
		//
		// The rule is RIGHT, and the obvious remedy is wrong. "585 assertions
		// missing a sentence, so write 585 sentences" is the cheap reading; about
		// THIRTY of them want a sentence. The rest have a real fix:
		//
		//   a payload this system did not write   ~240  parse at the boundary
		//   a check performed on the same line     ~45  `oneOf` already exists
		//   a key into an object this code owns    ~43  `keysOf` already exists
		//   a DOM node the caller selected         ~30  a `SAFETY:` sentence
		//   a stored snapshot / framework type     ~45  scope, by cause
		//   a SQL binding value                    ~20  scope
		//   remainder, mixed                      ~160  read per site
		//
		// The largest cause is not a missing comment at all — it is the requirement
		// this capability already carries: a payload this system did not write is
		// parsed on arrival. `parse-external-responses` did that for the sources it
		// reached; these are the ones it did not, and the INBOUND half — 46 route
		// handlers asserting a request body — was never attempted.
		//
		// So this count is a genuine backlog rather than noise, which is the first
		// time that has been true of a rule here. It stays at `error`.
		//
		// **212 at the start of `make-lint-all-a-gate`, 149 now. 63 scoped by
		// cause, 0 fixed in code** — that change deliberately edited no product
		// code, so every finding it removed was removed by an entry below that
		// states why, and every finding it did not remove is still there to fix.
		//
		// FLOOR 16, and it does NOT reach zero. The "until it reaches zero" target
		// written here originally was wrong, and correcting it matters more than the
		// count: a target that includes measured noise asks for the code to be made
		// worse, which is `The repo-wide report is treated as a target` in this
		// capability's own spec.
		//
		// All 149 that remain are now classified by construct, tail AND the
		// findings left gated inside a named cause's files, by
		// private historical record — which re-runs and
		// fails loudly if a line stops matching, so these numbers are checked
		// rather than remembered:
		//
		//   a check the code already performs   17  `oneOf` already exists
		//   a structural walk, no value contract 16  THE FLOOR
		//   an unparsed boundary read           15  parse at the boundary
		//   library / DOM type surface          11  a `SAFETY:` sentence
		//   a literal asserted, not annotated   11  `satisfies`
		//   a projection between two near types 11  reconcile the pair
		//   a callback / setState variance cast 10  type the callback's parameter
		//   a payload this code wrote           10  scope, once the rest is fixed
		//   a field the type does not declare    9  declare it
		//   env / UI string into a closed union  8  validate at the read
		//   a key into an object this code owns  8  `keysOf` already exists
		//   `chrome.*` returning `any`           7  a twelfth entry, after a sample
		//   redundant, deletes outright          5  —
		//   the other 12, 1-3 apiece            12  read per site
		//
		// Three figures the previous commentary carried were STALE and are corrected
		// above: ~45 same-line guards, ~240 unparsed payloads and ~43 dynamic keys
		// were counted before 63 findings were scoped, and re-measuring over what
		// remains gives 17, 15 and 8. The pattern is worth keeping: a construct scan
		// taken before a scoping pass overstates the work left by roughly the size
		// of the pass.
		//
		// Resolved under `migrate-to-vite-plus`: the remaining assertions were
		// removed (parsed at the boundary, narrowed, or typed through generics) or
		// given a SAFETY comment naming the writer or the checked invariant, so the
		// rule is at zero repo-wide.
		//
		// Note on placement, learned the hard way: the comment must sit immediately
		// before the assertion or its containing STATEMENT. A block comment heading
		// a group of assertions inside one object literal credits only the first.
		// Where a claim is genuinely shared by many fields, the fix is one named
		// reader carrying the invariant once, not one comment per field — see
		// `carriedObject`/`carriedArray`/`carriedId` in `storyboard-document.ts`.
		"anti-slop/require-safety-comment-for-type-assertion": "error",

		/* ── RETIRE: fires mostly on code that is already correct ───────────────
		 * Off, not warned. A warning nobody should act on is decoration, and each of
		 * these would have sat at `warn` implying work that would make the code
		 * worse. Re-enable any of them if the shape below stops being true. */

		// Substring match on "shape", no domain awareness. Of 39: Zod's own `.shape`
		// property (cannot be renamed), `shapeRect`/`shapeCircle` which draw a
		// literal rectangle and circle, and a narrative `shape` field describing a
		// story beat. The two genuinely misnamed symbols it did find —
		// `WorkspaceShape`, `isFlatSelectionShape` — have been renamed.
		"anti-slop/no-shape-in-symbol-names": "off",

		// Sample: Zod `preprocess` normalizers, where `unknown` in and `unknown` out
		// IS the contract and `z.preprocess(fn, schema)` parses one call later; and
		// structure-preserving transforms (`capValue`, `pruneEmpty`) that return
		// whatever shape they were handed. Six genuine cases were fixed; the rest
		// would be lies about what the functions do.
		"anti-slop/no-unknown-returns": "off",

		// `...(cond ? { k: v } : {})` is the idiomatic way to omit an optional
		// property, and reads better than the several statements this rule wants —
		// especially under `exactOptionalPropertyTypes`. A style disagreement, not a
		// defect. 119 repo-wide.
		"anti-slop/no-conditional-empty-object-spread": "off",

		// Sample: `deepEqual(a: unknown, b: unknown)` and `pickVideoMode(v: unknown,
		// fb)`. Generic utilities and boundary parsers take `unknown` because they
		// accept anything — that is the correct signature, not a missing one.
		// 139 repo-wide.
		"anti-slop/no-unknown-parameters": "off",

		// Sample: `typeof window === "undefined"` (SSR guard), `typeof a !==
		// "object"` inside a structural comparator, and the first line of boundary
		// parsers. The rule wants a schema, but an SSR guard has no schema and a
		// structural utility has no domain type. 477 repo-wide, the noisiest.
		"anti-slop/no-runtime-typeof": "off",
	},

	/* ── SCOPE: the two assertion rules do not run in tests ──────────────────
	 * Decided per rule, not globally, because `no-module-mocking` is ABOUT tests
	 * and a blanket exclusion would silence it exactly where it applies.
	 *
	 * A test that casts to build a deliberately invalid fixture is documenting the
	 * invariant by existing: `"probably-fine" as ProviderHealth` IS the assertion
	 * the test makes. A `SAFETY:` comment there restates the test name. Sixteen of
	 * the twenty errors on this branch's changed lines were exactly that.
	 *
	 * The rules stay on for every non-test file, which is where an unsound
	 * assertion actually reaches a user. */
	overrides: [
		{
			/* `then` is the branch body key of the workflow-definition and
			 * prompt-template node schemas (`{ type: "branch", if, then }`). These
			 * objects are data, never awaited. 73 findings, all in these schemas and
			 * their tests; 0 of 4 sampled were thenables. */
			files: [
				"apps/api/src/lib/prompts/templates/**",
				"apps/api/src/modules/agents/core/engine/**",
				"packages/shared/src/prompt-template*.ts",
				"packages/shared/src/workflow-definition*.ts",
			],
			rules: { "unicorn/no-thenable": "off" },
		},
		{
			/* `bun-types` declares `expect(...).rejects` matchers as returning void,
			 * so every `await expect(p).rejects.toThrow()` reads as awaiting a
			 * non-thenable. 229 of 235 findings; 0 of 5 sampled were wrong. The rule
			 * stays on for non-test code. Revisit when the suite leaves `bun:test`. */
			files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"],
			rules: { "typescript/await-thenable": "off" },
		},
		{
			/* Fetch doubles in tests stringify the `RequestInfo` and `BodyInit` the
			 * code under test built. Every caller passes a string there; a `Request`
			 * or `FormData` would print `[object ...]` and fail the test's own
			 * assertion on it, so the failure is loud where it happens. 32 hits in
			 * tests, all read, none genuine; production `String(unknown)` was repaired with
			 * `textOf`. */
			files: ["**/*.test.ts", "**/*.test.tsx"],
			rules: { "typescript/no-base-to-string": "off" },
		},
		{
			/* Tests pass `any` by construction: `bun-types` declares the asymmetric
			 * matchers (`expect.objectContaining`, `arrayContaining`,
			 * `stringMatching`) as `any`, and fixtures read JSON (`JSON.parse`,
			 * `response.json()`) to hand a round-tripped value to the code under
			 * test, which is what the round trip is testing. Playwright's
			 * `postDataJSON()` and `json()` are `any` the same way in the visual
			 * suites and the browser proof scripts. 44 hits in tests and 27 in those
			 * harnesses, all read, none genuine. Production sites were repaired. */
			files: [
				"**/*.test.ts",
				"**/*.test.tsx",
				"**/__tests__/**",
				"apps/web/visual/**",
				"**/scripts/prove-*.ts",
				"apps/web/scripts/inspect-template-catalog.ts",
				"apps/web/scripts/smoke-prod.ts",
			],
			rules: { "typescript/no-unsafe-argument": "off" },
		},
		{
			/* Tests call `use*` functions directly to exercise them. A hook called
			 * outside render either holds no React state — the timeline `use*Ops`
			 * family are plain factories under the family name — or throws on its
			 * first run, so the test run itself is the check. 4 hits, 0 genuine. */
			files: ["**/*.test.ts", "**/*.test.tsx"],
			rules: { "react/rules-of-hooks": "off" },
		},
		{
			/* A migration reads historical payloads whose shape is precisely the thing
			 * being migrated — that is why the migration exists. There is no concrete
			 * value contract to point at, so the rule has nothing to ask for here.
			 * 11 hits, all in `scripts/migrate-*`. */
			files: ["scripts/migrate-*.ts"],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* The same historical-payload cause, tested against the ASSERTION rule,
			 * and the only group of the eleven where it covered every finding.
			 *
			 * All 7 read: five are `JSON.parse(row.<col>_json) as Record<string,
			 * unknown>` on a historical row, one is `as unknown` — a deliberate
			 * de-`any` that claims nothing — and one reads a legacy `config.yaml` at
			 * the `LegacyImagePolicy` shape the migration exists to retire, with every
			 * access optional-chained and defaulted. Not one claims a CURRENT domain
			 * type, which is what separates these from the four
			 * `packages/stock/scripts/*` reads left gated in the entry above.
			 *
			 * A separate entry, and the path list was why: `packages/core/scripts/`
			 * carried one of the 7 and the glob above is anchored at the repository
			 * root, so folding it in would have widened the DICTIONARY scope to a
			 * directory nothing measured. That half went with `packages/core` in
			 * `simplify-package-ownership` — no package-local `scripts` directory
			 * carries a migrate script now — so only the root glob is left. The
			 * entry stays separate
			 * rather than folding in, because the widening argument above is about
			 * the DICTIONARY scope's anchor and is unchanged by losing a path.
			 * Measured in `make-lint-all-a-gate/sample.md` §4.7. */
			files: ["scripts/migrate-*.ts"],
			rules: { "anti-slop/require-safety-comment-for-type-assertion": "off" },
		},
		{
			/* A reader that accumulates a map whose keys are runtime strings.
			 *
			 * An env block, a secrets file, a per-path source map: each builds `out`
			 * key by key from names that exist only at run time, then returns it. The
			 * declared `Record<string, unknown>` is what the value IS — there is no
			 * closed key set to name, and `satisfies` has nothing to check against.
			 * Same cause the runtime-key-config scope below records for the
			 * dictionary rule, reached independently by the widening rule's return
			 * sub-kind. 12 of that sub-kind's 24 findings; the other 12 return a
			 * statically known literal shape and stay gated. */
			files: [
				"apps/api/src/lib/workspace-secrets.ts",
				"apps/api/src/lib/dashboard-env.ts",
				"apps/api/src/lib/global-secrets.ts",
				"packages/db/src/db/content-projects.ts",
				"apps/web/src/models/presets/element-sources.ts",
				"apps/web/src/models/settings/status-views.ts",
			],
			rules: { "anti-slop/no-widening-open-dictionary-return": "off" },
		},
		{
			/* Playwright specs are tests too. `apps/web/visual` and `apps/web/perf` hold
			 * nothing else — `playwright.config.ts` points its projects at exactly those
			 * two directories — and every assertion in them is the shape this override
			 * already exempts: `page.evaluate((sel) => document.querySelector(sel as
			 * string))`, where the spec passed `sel` on the line above; `(e as
			 * HTMLElement)` inside a `locator.evaluate`, where the spec's own selector
			 * decides the element; a `window as … & { __marks: … }` reading
			 * instrumentation the spec installed itself. 25 hits, sampled in full. */
			files: [
				"**/*.test.ts",
				"**/*.test.tsx",
				"**/tests/**",
				"**/*.spec.ts",
				"apps/web/visual/**",
				"apps/web/perf/**",
			],
			rules: {
				"anti-slop/require-safety-comment-for-type-assertion": "off",
				"anti-slop/no-chained-type-assertions": "off",
				/* `no-unsafe-dictionary-type` joins them, for a sharper reason than the
				 * assertion one above. A test that types a response `Record<string,
				 * unknown>` is asserting on the WIRE FORM: `expect(body.reference)
				 * .not.toHaveProperty("selection_id")` only means something while the
				 * type does not already say the column is absent, and naming the domain
				 * type there makes the assertion check the type instead of the output.
				 * All 118 hits read; not one used a dictionary as a domain type. */
				"anti-slop/no-unsafe-dictionary-type": "off",
				/* The widening pairs whose findings here are fixture scaffolding, and
				 * only those. 17 of the 20 `open dictionary / assertion` findings are
				 * deliberately partial fixtures cast to the type under test — `{
				 * aspectRatio: "9:16", voice: "" } as unknown as GlobalSettingsLike` —
				 * which is the assertion the test is making. All 3 `anonymous object`
				 * findings are a spy's accumulator or a fixture read. The RETURN pairs
				 * stay on in tests: the last sample found 6 real findings there against
				 * 29 noise, and those 6 are helpers annotating a return that inference
				 * already gives exactly. */
				"anti-slop/no-widening-open-dictionary-assertion": "off",
				"anti-slop/no-widening-anonymous-object-assertion": "off",
				"anti-slop/no-widening-anonymous-object-binding": "off",
			},
		},

		{
			/* The stored-payload cause, tested against the ASSERTION rule and
			 * extended only where it holds.
			 *
			 * All 59 of that rule's findings in the persisted-JSON group were read.
			 * 38 are the cause: `JSON.parse(row.template_json) as …` and the reads
			 * that walk what it returned and an HTTP body that mirrors the same
			 * column. Those files are here.
			 *
			 * 21 are NOT, and they stay gated because each has a different answer:
			 * 10 restate a discriminant the surrounding code tests ON THE SAME LINE,
			 * which wants the union declared rather than a scope; 2 are SQL bindings;
			 * 1 asserts a query result the driver could carry with `db.query<Row>`;
			 * 2 are the structural walk in `timeline-doc`; 4 are the two-storyboard
			 * seam recorded below; 1 builds a Zod shape; 1 is `image-gen.ts:409`.
			 *
			 * The list is 13 named files rather than the directory globs the
			 * dictionary rule uses, because four files hold BOTH kinds and a scope
			 * cannot cover half a file — `audio-align.ts` is 1 stored-payload read
			 * against 3 same-line guards. Extending the globs would have scoped those
			 * 21 away with them. Measured in `make-lint-all-a-gate/sample.md` §4.1. */
			files: [
				"packages/db/src/db/content-presets.ts",
				"packages/db/src/db/timeline-templates.ts",
				"packages/db/src/db/motion-presets.ts",
				"packages/db/src/db/workflow-run-db.ts",
				"packages/db/src/db/clip-templates.ts",
				"packages/db/src/db/assets.ts",
				"packages/shared/src/render-storyboard.ts",
				"packages/shared/src/timeline-markers.ts",
				"apps/web/src/api/workspace-catalogue.ts",
				"apps/web/src/api/chat.ts",
				"apps/web/src/models/timeline/gutter-visibility.ts",
				"apps/api/src/routes/activity-stream.ts",
			],
			rules: { "anti-slop/require-safety-comment-for-type-assertion": "off" },
		},

		/* ── The four scopes below share one cause: a type that is open on purpose.
		 * Either the shape arrived from outside and has not been parsed yet, or the
		 * key set is not knowable statically, or the value has been flattened for
		 * the wire. In all three the wide type is the accurate one, and every remedy
		 * this rule suggests — inference, `satisfies`, a named contract — assumes a
		 * closed shape. Counts are from the full read in
		 * `openspec/changes/scope-gated-rules-away-from-open-types/sample.md`. */
		{
			/* A row persisted as JSON, and the HTTP shape that mirrors it.
			 * `storyboard_json`, `editor_state_json`, `brief_json`, `content_json`,
			 * `meta_json`, `payload_json`, `budget_json` are columns, not domain
			 * types: the row layer stores the document opaque so that a v1 row and a
			 * v2 row read the same way, and typing the column would make the older
			 * rows a lie. The serializers and route DTOs on either side inherit that,
			 * `writeStoryboardDocument` included — already recorded above as a case
			 * this rule cannot reach. 150 hits. */
			files: [
				"packages/db/src/db/**",
				"apps/api/src/routes/**",
				"apps/web/src/api/**",
				"apps/web/src/models/storyboard/**",
				"packages/shared/src/storyboard-document.ts",
				"packages/shared/src/render-storyboard.ts",
				"packages/shared/src/timeline-template.ts",
				"packages/shared/src/timeline-doc.ts",
				"packages/shared/src/timeline-markers.ts",
				"packages/shared/src/project-selection.ts",
				"packages/shared/src/prompt-builder.ts",
				"apps/web/src/models/timeline/gutter-visibility.ts",
			],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* A response from outside, before anything parses it. A provider's HTTP
			 * body, a scraped page's JSON-LD, an MCP tool result, a stock feed's row
			 * with its trailing `[key: string]: unknown` for whatever else the feed
			 * carried. The alternative is a schema at each boundary, which is
			 * `parse-external-responses` — done for the sources it covered, and these
			 * are the ones it did not. 23 hits. */
			files: [
				"packages/media/src/api/**",
				"packages/stock/**",
				"apps/api/src/lib/scene-extractor.ts",
				"apps/api/src/lib/web-research.ts",
				"apps/api/src/lib/browseros-mcp.ts",
			],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* The same unparsed-boundary cause, tested against the ASSERTION rule.
			 *
			 * All 13 of that rule's findings in the files above were read. 8 are the
			 * cause, and they share one shape: the assertion claims only `unknown`,
			 * `Partial<…>` or `Record<string, unknown>` — never a domain type — and
			 * every field is checked on the lines that follow. `raw as
			 * Partial<MusicManifest>` then four `isNonEmpty` throws; `parsed as {
			 * description?: unknown; emotion?: unknown }` then two `typeof` tests; an
			 * MCP content block asserted `{ type?: string; text?: string }` and
			 * immediately tested for both. The assertion is the entry point of a
			 * hand-written parser, and it adds no claim the code does not verify.
			 *
			 * 5 are NOT, and they are the inverse: `JSON.parse(await readFile(…)) as
			 * SidecarTrack` in the four `packages/stock/scripts/*` compile steps
			 * claims a CLOSED element shape on trust and checks nothing — which is
			 * the fix `parseMusicManifest` already demonstrates one directory over.
			 * `cache.ts:31` is the fifth, and a different thing again: `hit.value as
			 * T` reads a heterogeneous `Map<string, Entry<unknown>>` back at the
			 * caller's type, with nothing external in reach of the assertion.
			 *
			 * So this is 5 named files, not `packages/stock/**`: that glob is what
			 * the dictionary rule uses and it would have scoped all five away.
			 * `packages/media/src/api/**` and `detail-parser.ts` carry no findings
			 * for this rule at all. Measured in `make-lint-all-a-gate/sample.md`
			 * §4.3. */
			files: [
				"packages/stock/src/music-manifest.ts",
				"packages/stock/src/music-enrich.ts",
				"apps/api/src/lib/scene-extractor.ts",
				"apps/api/src/lib/web-research.ts",
				"apps/api/src/lib/browseros-mcp.ts",
			],
			rules: { "anti-slop/require-safety-comment-for-type-assertion": "off" },
		},
		{
			/* Configuration whose key set is a runtime string. A workspace's
			 * `config.yaml`, its secrets, its per-channel activation block: the keys
			 * are workspace ids, channel names and env var names, so there is no
			 * closed set to name. Same finding the widening rule's env-reader
			 * sub-kind reached independently. 17 hits.
			 *
			 * NOT extended to the assertion rule. 6 of its 11 findings here are the
			 * cause — channel names off an activation block, the `image_style` record
			 * of `unknown`, the `${channel}.${kind}` mix keys — and each checks every
			 * field it reads. The other 5 are three different things: two `["post",
			 * "reply"] as Kind[]` literals, a `b.rules as Rule[]` claiming a closed
			 * shape on `isArray` alone, a dynamic-key WRITE onto `StyleProfile`, and
			 * a `parseYaml(…) as Record<…>` that `WorkspaceSchema.parse` makes
			 * redundant one line later. All five files mix the two, so there is no
			 * subset to scope. Measured in `make-lint-all-a-gate/sample.md` §4.5. */
			files: [
				"apps/api/src/lib/workspace/**",
				"apps/api/src/lib/collection-files.ts",
				"apps/api/src/lib/channel-activations.ts",
				"apps/api/src/lib/capabilities/modules.ts",
				"apps/api/src/lib/workspace-image-style.ts",
				"packages/shared/src/channel-activations.ts",
				"packages/shared/src/image-policy.ts",
				"packages/shared/src/video-policy.ts",
				"packages/shared/src/content-behavior.ts",
			],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* Arguments the model supplied, on their way to the schema that checks
			 * them. Dispatch, idempotency keys, the durable `tool_run` record, the
			 * approval draft, the trace leaf and the wire event all handle a tool call
			 * before `def.input.safeParse` has run — and a `Proxy`-free `obj()` helper
			 * narrows one. Typing them would be claiming a shape nothing has verified
			 * yet, which is the failure this rule exists to catch, inverted. 43 hits.
			 *
			 * Seven of those were once re-enabled by a later override, because they
			 * sat AFTER `def.input.safeParse` and could take `z.infer` instead. They
			 * now do, so the override is gone rather than switched off.
			 *
			 * `apps/api/src/lib/generation/**` is deliberately NOT here: its
			 * `raw` is a provider response the ledger stores, and it is fixable.
			 *
			 * NOT extended to the assertion rule, and the measurement is the reason.
			 * All 18 of that rule's findings in these files were read: exactly ONE is
			 * this cause — `approval.ts:107`, a parked tool call's `args` read before
			 * `safeParse` ever sees them. The other 17 are six different things, each
			 * with its own answer: 4 project the wire's layout onto the editor's
			 * near-identical one, 3 read a persisted snapshot, 2 assert a value the
			 * tool's own `z.object` already produced, 2 are `ToolDef<any>` erasing
			 * the schema's output type, 2 are generic coercion helpers, 1 is a
			 * literal array and 1 is `zodToJsonSchema`'s return. The one finding that
			 * transfers shares `approval.ts` with two that do not, and a scope cannot
			 * cover half a file. Measured in `make-lint-all-a-gate/sample.md` §4.2. */
			files: [
				"apps/api/src/modules/agents/core/**",
				"apps/api/src/lib/agent-trace.ts",
				"packages/shared/src/agent-wire.ts",
			],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* A third-party generic that declares itself open. Remotion types
			 * `TransitionPresentation<T>` and `renderMedia`'s `inputProps` as
			 * dictionaries; the parameter is theirs, not ours, and narrowing it stops
			 * the call compiling. 6 dictionary hits, plus 2 chained: reaching
			 * `TransitionPresentation<Record<string, unknown>>` from `flip()` and
			 * `clockWipe()`, whose own prop types Remotion bakes in at construction
			 * and the renderer never supplies. Both already state that invariant. */
			files: ["packages/video/src/lib/transitions.tsx", "apps/render-worker/src/worker.ts"],
			rules: {
				"anti-slop/no-unsafe-dictionary-type": "off",
				"anti-slop/no-chained-type-assertions": "off",
			},
		},
		{
			/* A proxy forwarding an upstream body verbatim.
			 *
			 * The image routes are a pass-through: `c.json(err.raw, err.status)` sends
			 * the provider's error body unchanged, and the poll route spreads that body
			 * under its own rewritten urls. The fields this code READS are already
			 * named — `ImageJobStatus` normalizes status, urls, `fromCache` and
			 * `error` — so `raw` is not a missing parse. It is the body itself, and a
			 * body being relayed has no value contract by definition; narrowing it
			 * would drop the provider fields clients read straight off the response.
			 * `payload` at the submit is the same thing outbound. 8 hits, one file. */
			files: ["apps/api/src/lib/generation/image-generator.ts"],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* Caller-supplied billing metadata.
			 *
			 * The credit ledger stores whatever the operation that spent the credits
			 * wants recorded against it — a job id, a provider, a prompt hash. The key
			 * set belongs to the caller, and the value is written straight to a JSON
			 * column and never read back by this code. Narrowing it would mean this
			 * module deciding what every future biller may record. 8 hits across
			 * `credit-service.ts` and the meter it feeds. */
			files: ["apps/api/src/lib/credit-service.ts", "apps/api/src/lib/metering/meter.ts"],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* Two storyboard types that are deliberately two.
			 *
			 * `StoryboardForRender` in `@maleo/shared` and `Storyboard` in
			 * `@maleo/video` describe the same document and are NOT assignable, and
			 * they cannot be merged: `packages/video/src/exports.ts` states that the
			 * render package cannot import shared, which is also why the duck tables
			 * are a checked copy rather than one table. Narrowing either assertion
			 * here does not compile — the differences are enumerated in
			 * `close-the-dictionary-and-chain-rules` task 4.1, and two of the four
			 * were closed there. 4 hits; the change that closes the other two
			 * (`layout: unknown` at six sites, and `transitionDurSec`) removes this
			 * entry with them. */
			files: [
				"apps/web/src/models/storyboard/storyboard-mapper.ts",
				"apps/web/src/hooks/timeline/use-preview-composition.ts",
				"packages/shared/src/render-storyboard.ts",
			],
			rules: { "anti-slop/no-chained-type-assertions": "off" },
		},
		{
			/* The same two-storyboard seam, tested against the ASSERTION rule, and
			 * extended over ONE of that entry's three files.
			 *
			 * `absolutizeStoryboard<T>` opens its argument at `StoryboardForRender`
			 * and closes back at `T` — 4 findings, 2 sites, both halves of the same
			 * seam, and constraining the generic is what does not compile.
			 *
			 * `use-preview-composition.ts` is NOT here. 2 of its 3 findings are the
			 * seam (`previewStoryboard as unknown as Storyboard`, handed to
			 * `<Player>`), but the third reads `(config as { format?: string })
			 * .format` — a field the config type does not declare, which is a
			 * genuine finding with a real fix. `render-storyboard.ts` carries none:
			 * §4.1 already scoped it. Measured in
			 * `make-lint-all-a-gate/sample.md` §4.11. */
			files: ["apps/web/src/models/storyboard/storyboard-mapper.ts"],
			rules: { "anti-slop/require-safety-comment-for-type-assertion": "off" },
		},
		{
			/* A `Proxy` trap and a durable snapshot, both keyed by a runtime string.
			 *
			 * `LaneEnvProvider` hands lanes a stable object whose `get` forwards any
			 * key to the latest env — the trap's parameter IS a string, so there is no
			 * narrower type to read it at. `jobFromRow` reconstructs an `AgentJob`
			 * from a snapshot this system wrote: naming it would mean a schema for
			 * fifty-odd fields of nested arrays, verified against the four rows
			 * `workflow_run` holds. 4 hits.
			 *
			 * EXTENDED to the assertion rule, over all 6 of its findings here. The
			 * trap accounts for 3: `new Proxy({} as LaneEnv, …)` needs a target at
			 * the type it impersonates, and `(latest.current as unknown as
			 * Record<string, unknown>)[key]` is the forward itself, reported twice
			 * because the chain nests. The snapshot accounts for 3: `snap as unknown
			 * as AgentJob` in `jobFromRow`, and `prior.output as { note?; thumbs?;
			 * replay? }` reading a durable `tool_run` row's stored result back at the
			 * shape this system wrote — all-optional, and every field tested before
			 * Measured in `make-lint-all-a-gate/sample.md` §4.10. */
			files: [
				"apps/web/src/components/timeline/timeline-lane.tsx",
				"apps/api/src/modules/agents/core/run-repository.ts",
			],
			rules: {
				"anti-slop/no-unsafe-dictionary-type": "off",
				"anti-slop/no-chained-type-assertions": "off",
				"anti-slop/require-safety-comment-for-type-assertion": "off",
			},
		},
		{
			/* A type the dependency owns. `bun:sqlite` takes `SQLQueryBindings` for a
			 * patch's values where the row type says `unknown`, and narrowing it means
			 * editing a dependency's declarations. 1 hit.
			 *
			 * The Inngest half of this scope is gone, fixed rather than scoped. The
			 * agent-run function moved into `apps/api/src/modules/agents/core/inngest-function.ts`
			 * in `simplify-package-ownership`, and its `step as unknown as StepLike`
			 * — the chain this scope existed for — became a single narrowing in
			 * `asStepLike`, which states the invariant instead of asserting twice. */
			files: ["apps/render-worker/src/db.ts"],
			rules: { "anti-slop/no-chained-type-assertions": "off" },
		},
		{
			/* A structural diff between two arbitrary clips has no value contract —
			 * it walks keys it was not told about, which is the whole operation.
			 * Narrowing it would mean naming every clip field the differ may meet,
			 * which is the opposite of what a structural differ is for. 8 hits.
			 *
			 * NOT extended to the assertion rule. Of its 13 findings here, 7 are the
			 * walk — `deepEqual`'s two operands and the changed-key scan over a
			 * `Clip`, plus the `Partial<Clip>` the scan exits through. The other 6
			 * are not about structure at all: 4 assert back out of `arrayCommands`'s
			 * `remove: (id: never)` bag, 1 re-narrows a key `byId` widened to `string
			 * | number`, and 1 is redundant against `Map.get`'s own return. Both
			 * kinds are in this one file, so there is no half of it to scope.
			 * Measured in `make-lint-all-a-gate/sample.md` §4.4. */
			files: ["apps/web/src/models/timeline/timeline-command-diff.ts"],
			rules: {
				"anti-slop/no-unsafe-dictionary-type": "off",
				"anti-slop/no-chained-type-assertions": "off",
			},
		},
		{
			/* A payload this app wrote one drag ago, before its `kind` is checked.
			 *
			 * `readTemplateDrop` decodes a private MIME type nothing outside the page
			 * can set, and the first thing it does is test `kind` and `preset`.
			 * Naming the type before that test would be claiming the discriminant
			 * rather than reading it. 1 hit.
			 *
			 * EXTENDED to the assertion rule, over all 4 of its findings here. The
			 * provenance argument is the same one for every branch: `readDataCalloutDrop`
			 * and `readTemplateDrop` read two private MIME types this page serialized
			 * itself one drag ago, and both validate what they route on —
			 * `oneOf(parsed.type, dataCalloutTypes)` in the first, `kind` plus
			 * `typeof preset === "string"` in the second. The `text` branch already
			 * carries that sentence as a `SAFETY:` line; the `data` and `composition`
			 * branches beside it make the identical claim about the identical
			 * payload, so the entry states it once rather than the file stating it
			 * three times.
			 *
			 * `apps/web/src/models/presets/element-push.ts` — the other half of this
			 * group for the dictionary rule — carries no assertion findings at all.
			 * Measured in `make-lint-all-a-gate/sample.md` §4.8. */
			files: ["apps/web/src/models/timeline/timeline-drops.ts"],
			rules: {
				"anti-slop/no-unsafe-dictionary-type": "off",
				"anti-slop/require-safety-comment-for-type-assertion": "off",
			},
		},
		{
			/* A preset bundle is a SNAPSHOT of settings as they were.
			 *
			 * `contentPresetBundleSchema` stores `settings`, `pacingDevices` and
			 * `infographicStyle` as open records on purpose: a preset saved before a
			 * field existed, or after one was removed, still has to load. Typing the
			 * snapshot to today's `GlobalSettings` would reject yesterday's preset —
			 * which is the one thing a preset library must not do. 2 hits. */
			files: ["apps/web/src/models/presets/element-push.ts"],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* An outbound request body, and the row column a reader mirrors.
			 *
			 * The media worker assembles a `style` blob for the provider it is about
			 * to call — the same wire form the image generator's `payload` is, going
			 * the same direction. `logicalRefId` reads `meta_json` off a
			 * `content_assets` row, which the db tree is already scoped for; this is
			 * the web-side mirror of that column and nothing more. 2 hits. */
			files: ["packages/media/src/worker.ts", "apps/web/src/models/core/cc-helpers.ts"],
			rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
		},
		{
			/* Wrapping a Mastra `Tool` by spread. The class keeps every field, its
			 * `execute` and its tool marker symbol as own properties and has no
			 * prototype methods, so the spread copy is the tool. 1 hit, 0 genuine
			 * (`migrate-to-vite-plus` lint evidence). */
			files: ["apps/api/src/modules/agents/core/runtime/tools/mcp-tools.ts"],
			rules: { "typescript/no-misused-spread": "off" },
		},
		{
			/* A click handler whose keyboard path lives elsewhere by design. The
			 * command palette routes every key through one window listener (arrows
			 * move the highlight, Enter runs it), so its rows are the pointer path
			 * to the same action. A storyboard beat selects on focus, which every
			 * field inside it raises; its click covers the browsers that do not focus
			 * a clicked button. 3 hits, 0 genuine. */
			files: [
				"apps/web/src/app/command-palette.tsx",
				"apps/web/src/components/storyboard/storyboard-view.tsx",
			],
			rules: {
				"jsx-a11y/click-events-have-key-events": "off",
				"jsx-a11y/no-static-element-interactions": "off",
			},
		},
	],
} satisfies OxlintConfig;
