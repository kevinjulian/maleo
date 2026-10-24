//! The renderer and the preview session in the browser (ADR 0011, OpenSpec
//! p2-preview-runtime). wgpu reaches WebGPU only through `wasm-bindgen`, so
//! this module uses it; its exports still follow ADR 0010: JSON strings and
//! byte buffers in and out, plus the canvas it draws into. One session lives
//! behind the module, in the web's preview worker
//! (`apps/web/src/preview-worker/worker.ts`). Times are seconds on the
//! host's clock (`performance.timeOrigin + performance.now()`).
//!
//! - `init(offscreen_canvas, on_change)`: request a WebGPU device and create
//!   the session over the canvas; `on_change` is called when the state changes
//!   outside a call (device loss and recovery).
//! - `set_storyboard(json, fps, duration_frames)`: set the storyboard, only
//!   when it changes. One that does not parse is refused.
//! - `seek(position, now)`, `play(position, at, rate)`, `pause(position)`:
//!   the playback clock.
//! - `tick(now)`: draw the frame due now, if any; resolves `true` when the GPU
//!   has finished a drawn frame.
//! - `wants_tick(now)`: whether the host should keep ticking.
//! - `resize(width, height)`, `put_image(url, width, height, rgba)`: the
//!   canvas size and a decoded straight-alpha image; both redraw the frame.
//! - `report_remotion(position, at)`: the Remotion playhead, for drift.
//! - `state(now)`: status, position, dropped frames, frame times, drift and
//!   the last frame's coverage report, as JSON.
//! - `lose_device()`: debug; destroys the device to exercise recovery.

#[cfg(target_arch = "wasm32")]
mod browser;

#[cfg(target_arch = "wasm32")]
pub use browser::*;
