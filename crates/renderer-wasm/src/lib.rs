//! The renderer in the browser (ADR 0011). wgpu reaches WebGPU only through
//! `wasm-bindgen`, so this module uses it; its exports still follow ADR 0010:
//! JSON strings and byte buffers in and out, plus the canvas it draws into.
//! The renderer lives behind the module, one per page.
//!
//! - `init(canvas)`: request a WebGPU device and configure the canvas.
//! - `put_image(url, width, height, rgba)`: supply a decoded image.
//! - `render_to_canvas(storyboard_json, frame, width, height)`: draw a frame
//!   into the canvas and return the coverage report as JSON.
//! - `render(storyboard_json, frame, width, height)`: draw offscreen and
//!   return straight-alpha RGBA bytes.
//! - `coverage(storyboard_json, frame)`: the report alone.
//! - `work_done()`: resolves when the GPU has finished the submitted frames.

#[cfg(target_arch = "wasm32")]
mod browser;

#[cfg(target_arch = "wasm32")]
pub use browser::*;
