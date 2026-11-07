//! maleo-render-host: the headless server render host (OpenSpec p2-export E4).
//! It draws a prepared render storyboard with `maleo-renderer`, decodes media
//! and encodes the MP4 through FFmpeg processes; `src/main.rs` is the
//! `maleo-render` binary.

pub mod audio;
pub mod cancel;
pub mod compare;
pub mod encode;
pub mod ffmpeg;
pub mod frames;
pub mod inputs;
pub mod job;
pub mod progress;
pub mod video;
