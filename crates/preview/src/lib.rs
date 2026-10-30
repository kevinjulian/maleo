//! maleo-preview: the engine's preview session (OpenSpec p2-preview-runtime,
//! platform-grandplan D14). One playback clock, one frame scheduler and one set
//! of preview states for every platform. Host-free: no GPU, no renderer, no
//! IO. A host composes it with the renderer and its drawing surface
//! (`crates/renderer-wasm` on the web) and supplies the time, the storyboard
//! and decoded media. An activated audio output supplies consumed-sample and
//! platform-timestamp observations; sessions without it retain host time.

pub mod adapters;
pub mod audio_clock;
pub mod clock;
pub mod media;
pub mod scheduler;
pub mod session;
pub mod stats;

pub use adapters::{AudioOutput, Decoder, VideoFrame};
pub use session::{Report, Session, Status};
pub use stats::FrameTimes;
