//! Platform media interfaces. Hosts decode and output PCM, while `audio_clock`
//! maps consumed samples and platform timestamps into portable playback position.
//! Sessions without attached audio use the host clock.

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

/// Plays storyboard audio. Native hosts can implement this interface; browser
/// hosts publish revisioned `audio_clock::Observation` through the session boundary.
pub trait AudioOutput {
    fn play(&mut self, position: f64, rate: f64);
    fn pause(&mut self);
    /// The position the listener hears now, in seconds, latency included.
    fn position(&self) -> f64;
}
