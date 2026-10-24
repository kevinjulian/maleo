//! The media adapters a platform supplies to the session. This change defines
//! them and implements neither: the media change (video frames, the decoder
//! pool, the frame cache and audio output) implements them per platform. A
//! session without them plays static layers and captions on the host clock.

/// One decoded video frame, straight-alpha RGBA, `width * height * 4` bytes.
pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Decodes video frames for the storyboard's video clips. Implemented by the
/// media change on each platform (WebCodecs on the web).
pub trait Decoder {
    /// The frame of `url` shown at `time` seconds into the source, or `None`
    /// while it is not decoded yet (the frame draws its placeholder).
    fn frame(&mut self, url: &str, time: f64) -> Option<VideoFrame>;
}

/// Plays the storyboard's audio. Implemented by the media change, which then
/// makes the output position the session's master clock (design D2).
pub trait AudioOutput {
    fn play(&mut self, position: f64, rate: f64);
    fn pause(&mut self);
    /// The position the listener hears now, in seconds, latency included.
    fn position(&self) -> f64;
}
