//! maleo-renderer: draws one video frame from the render storyboard, the same
//! value the Remotion compositions receive (ADR 0009, OpenSpec p2-render-foundation).

pub mod audio_requests;
pub mod blur;
mod correction;
pub mod coverage;
pub mod fonts;
pub mod frame;
pub mod gpu;
pub mod media;
pub mod media_requests;
pub mod paint;
pub mod scene;
pub mod storyboard;
pub mod timeline;
