# ADR 0011: The renderer reaches WebGPU through wasm-bindgen; its calls keep the ADR 0010 convention

- Status: Accepted
- Date: 2026-10-24
- Deciders: Kevin Julian
- Related: [ADR 0009](./0009-the-rust-engine-owns-rendering.md),
  [ADR 0010](./0010-the-core-reaches-every-platform-through-one-c-abi.md),
  OpenSpec `p2-render-foundation` (D7)

## Context

ADR 0010 bans `wasm-bindgen` at the core boundary: the editor module is
reached through a raw calling convention with JSON in and out, and no
generated bindings. The renderer (`maleo-renderer`, ADR 0009) draws with vello
on wgpu, and in a browser wgpu reaches the GPU only through WebGPU. wgpu's
WebGPU backend is written against `web-sys` and `wasm-bindgen`; there is no
other way to call `navigator.gpu` from Rust.

The other road was argued: draw with `vello_cpu` in WASM, which keeps ADR 0010
intact because it needs no browser API. It is a second rasterizer beside the
vello GPU path that the desktop app needs, so every visual difference between
the two would have to be chased twice. The GPU path was chosen.

## Decision

- `crates/renderer-wasm` uses `wasm-bindgen` and `web-sys` to reach WebGPU and
  the canvas.
- Its exported functions keep the ADR 0010 convention: JSON strings and byte
  buffers in and out, plus the canvas element it draws into. It exports no
  Rust types or classes; the renderer state lives behind the module.
- `crates/editor-wasm` is unchanged and still uses no `wasm-bindgen`. The two
  modules load separately, and the renderer module loads only where it draws.

## Consequences

- The renderer module carries the `wasm-bindgen` glue, and its CLI must match
  the crate version exactly. The build pins both.
- A host reads the renderer through the same JSON contract on every platform:
  a native host calls the crate directly, the browser calls the exported
  functions. Nothing typed crosses the boundary.
- The exception covers rendering only. A new core module that needs no
  browser API follows ADR 0010 without `wasm-bindgen`. Revisit this record if
  wgpu gains a WebGPU path without `web-sys`, or if a second module asks for
  the same exception.
