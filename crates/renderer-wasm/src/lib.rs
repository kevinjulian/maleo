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
//! - `video_requests(now)`: JSON placement paths, local source URLs and source times.
//! - `put_video(request_json, identity_json, rgba)`, `remove_video(path)`: typed
//!   placement intervals accepted by the host's native pool, and explicit eviction.
//! - `cache_media_frame(id, identity_json, rgba)`, `cache_video_frame(id,
//!   identity_json, frame)`, `bind_video(request_json, id)`, `bind_image(url, id)`,
//!   `remove_media_frame(id)`: one cached image per native cache ID, shared by all
//!   placements: CPU RGBA, or a `VideoFrame` copied into a device texture. IDs
//!   cross wasm-bindgen as BigInt.
//! - `report_remotion(position, at)`: the Remotion playhead, for drift.
//! - `state(now)`: status, position, dropped frames, frame times, drift and
//!   the last frame's coverage report, as JSON.
//! - `lose_device()`: debug; destroys the device to exercise recovery.
//! - `recover_device()`, `fail_device(message, now)`: worker-owned bounded recovery.
//!   Only installed devices report loss; obsolete attempts cannot replace the GPU.
//! - `set_storyboard_context`, `media_dispatch`: generation-fenced whole-document
//!   readiness, playback state and output-clock observations.
//! - `next_video_requests(now)`: bounded next-frame prefetch, or the first video
//!   within two seconds during image/gap spans, without changing the clock or bindings.
//! - `MediaPool`: portable visual decoder leases and cache reservations as JSON.
//!   Construction needs no GPU; decoded CPU bytes remain owned by the host.
//! - `PcmBudget`, `mix_audio`: portable PCM reservations and device-rate float
//!   mixing without GPU initialization. Hosts reserve input/output copies before
//!   crossing this boundary. This does not create or activate an audio device.
//! - `project_audio`, `audio_requests`: production mix projection and exact bounded
//!   local source windows for a device-rate block, without GPU initialization.
//! - `project_coverage(json, fps, frames)`: the coverage problems of every frame,
//!   each once at its first time, for export eligibility (p2-export E1). No GPU.

#[cfg(target_arch = "wasm32")]
mod browser;

#[cfg(target_arch = "wasm32")]
pub use browser::*;

#[cfg(target_arch = "wasm32")]
mod media_pool;
#[cfg(target_arch = "wasm32")]
pub use media_pool::MediaPool;

#[cfg(target_arch = "wasm32")]
mod audio;
#[cfg(target_arch = "wasm32")]
pub use audio::{PcmBudget, audio_requests, mix_audio, project_audio};

#[cfg(target_arch = "wasm32")]
mod coverage;
#[cfg(target_arch = "wasm32")]
pub use coverage::project_coverage;
