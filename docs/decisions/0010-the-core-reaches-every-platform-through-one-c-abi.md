# ADR 0010: The core reaches every platform through one hand-written C ABI, not generated bindings

- Status: Accepted
- Date: 2026-10-22
- Deciders: Kevin Julian
- Related: OpenSpec `platform-grandplan` (D4, D5), `platform-p0-foundations`;
  evidence in [spike B](../../spikes/kmp-core/README.md)

## Context

`maleo-editor-core` must run in the browser, in a native desktop app, and in
a Kotlin Multiplatform app on Android and iOS. The web already reaches it
through `crates/editor-wasm`: a raw calling convention, with UTF-8 JSON
passed as `(ptr, len)`, results left in an output buffer, and documents
behind handles. No `wasm-bindgen` is involved.

The grand plan assumed generated bindings for mobile: UniFFI, or its community
Kotlin Multiplatform generator, because official UniFFI emits Kotlin for the
JVM only and not for Kotlin/Native on iOS. That road was argued because
generated bindings give typed APIs and remove hand-written glue.

Spike B exported the same calling convention as a native C ABI and called it
from one shared Kotlin module: `cinterop` over one header on iOS, and a JNI
shim of 66 lines on Android. On an iOS simulator and an Android emulator, all
59 golden editor fixtures, plus a non-BMP Unicode case, returned results
byte-identical to the host run. One edit round trip took p50 0.207 ms on iOS
and 0.037 ms on Android, against a 1 ms limit. Over 10,000 calls the Rust heap
did not grow. The generator was never needed.

## Decision

- Every platform reaches the core through the one calling convention that
  `crates/editor-wasm` defines: WASM imports on the web, a C ABI everywhere
  else.
- Kotlin Multiplatform wraps the C ABI in one `expect`/`actual` engine:
  `cinterop` on iOS, a thin JNI shim on Android. Desktop Rust links the crate
  directly.
- Do not adopt UniFFI, its Kotlin Multiplatform generator, or `wasm-bindgen`
  for the core boundary.

## Consequences

- The boundary is a handful of functions and a JSON contract that the
  fixtures already pin. A new platform needs a loader, not a generator whose
  version must match the crate.
- Types do not cross the boundary. Each host decodes JSON into its own types,
  and the TypeScript types (`engine-types.generated.ts`) are the model for
  the Kotlin ones. A JSON contract change needs every host updated in step.
- The editor-wasm exports are compiled for `wasm32` only today. P5 moves them
  into a shared module that every target builds, instead of the copy the
  spike made.
- Every call copies its input and output strings. That costs about 0.2 ms per
  edit on iOS with a debug Kotlin build. Revisit this decision if a hot path
  (playback state, gesture samples) needs more calls than the budget allows.
  Batching calls is the first answer, and a typed binary boundary the second.
