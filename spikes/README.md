# Spikes

This directory holds throwaway proof code for the P0 phase of the platform
plan (OpenSpec `platform-p0-foundations`). Each spike answers one yes-or-no
question against pass criteria fixed before it started.

- Spike code is proof, not product. Do not import it, and do not build on it.
- No spike is a member of the root Cargo workspace. Each Cargo spike declares
  its own empty `[workspace]` table, so `cargo test` at the root does not
  reach it.
- CI does not build or test this directory.
- Each spike has a `README.md` with the question, the pass criteria, how to
  run it, and a `Result` section with the measurements and the verdict.
- The phase change that builds the real component deletes its spike.

| Spike        | Question                                                                  |
| ------------ | ------------------------------------------------------------------------- |
| `gpui-wgpu/` | Can a gpui window show a wgpu-rendered frame at playback rate?            |
| `kmp-core/`  | Can one shared Kotlin module call `maleo-editor-core` on Android and iOS? |
