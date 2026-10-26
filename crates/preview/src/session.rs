//! The preview session: one storyboard, the clock, the scheduler and the
//! preview state, composed. It decides which frame to draw and when; the host
//! parses the storyboard, owns the GPU and draws the frame `tick` returns.
//!
//! The state is derived, not stepped: the device and the storyboard decide
//! `loading`, `device-lost` and `failed`; past those, the clock decides
//! `playing`, and `ready` turns `paused` once the host plays or pauses.

use crate::clock::Clock;
use crate::scheduler::Scheduler;
use crate::stats::{FrameTimes, frame_times};

#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Loading,
    Ready,
    Playing,
    Paused,
    DeviceLost,
    Failed(String),
}

impl Status {
    pub fn name(&self) -> &'static str {
        match self {
            Status::Loading => "loading",
            Status::Ready => "ready",
            Status::Playing => "playing",
            Status::Paused => "paused",
            Status::DeviceLost => "device-lost",
            Status::Failed(_) => "failed",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Device {
    Pending,
    Ready,
    Lost,
    Failed(String),
}

/// What the session reports to the host.
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub status: Status,
    /// Seconds.
    pub position: f64,
    pub frame: i64,
    pub dropped: u64,
    pub times: Option<FrameTimes>,
    /// The session's playhead minus the reference playhead, in frames.
    pub drift: Option<f64>,
}

pub struct Session<S> {
    storyboard: Option<S>,
    fps: f64,
    frames: i64,
    clock: Clock,
    scheduler: Scheduler,
    device: Device,
    /// The host has played or paused: `ready` reads `paused` from then on.
    started: bool,
    samples: Vec<f64>,
    drift: Option<f64>,
}

impl<S> Default for Session<S> {
    fn default() -> Self {
        Self {
            storyboard: None,
            fps: 30.0,
            frames: 1,
            clock: Clock::default(),
            scheduler: Scheduler::default(),
            device: Device::Pending,
            started: false,
            samples: Vec::new(),
            drift: None,
        }
    }
}

impl<S> Session<S> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the storyboard; the frame on screen draws again from it. A
    /// refused storyboard leaves the previous one in place.
    pub fn set_storyboard(&mut self, storyboard: S, fps: f64, duration_frames: i64) -> Result<(), String> {
        if !(fps.is_finite() && fps > 0.0) {
            return Err(format!("storyboard: fps must be a positive number, got {fps}"));
        }
        if duration_frames < 1 {
            return Err(format!("storyboard: duration must be at least one frame, got {duration_frames}"));
        }
        self.storyboard = Some(storyboard);
        self.fps = fps;
        self.frames = duration_frames;
        self.clock.set_duration(duration_frames as f64 / fps);
        self.scheduler.invalidate();
        Ok(())
    }

    pub fn storyboard(&self) -> Option<&S> {
        self.storyboard.as_ref()
    }

    pub fn fps(&self) -> f64 {
        self.fps
    }

    pub fn duration_frames(&self) -> i64 {
        self.frames
    }

    pub fn device_ready(&mut self) {
        self.device = Device::Ready;
        self.scheduler.invalidate();
    }

    /// The device is gone: nothing draws until [`Session::device_ready`],
    /// and the frame on screen draws again then.
    pub fn device_lost(&mut self) {
        self.device = Device::Lost;
        self.scheduler.done();
        self.scheduler.invalidate();
    }

    /// The session cannot draw: no device, or a draw failed.
    pub fn fail(&mut self, message: impl Into<String>) {
        self.device = Device::Failed(message.into());
        self.scheduler.done();
    }

    pub fn seek(&mut self, position: f64, now: f64) {
        self.clock.seek(position, now);
        self.scheduler.restart();
    }

    pub fn play(&mut self, position: f64, at: f64, rate: f64) {
        self.clock.play(position, at, rate);
        self.scheduler.restart();
        self.started = true;
    }

    pub fn pause(&mut self, position: f64) {
        self.clock.pause(position);
        self.started = true;
    }

    /// The frame on screen must be drawn again (an image arrived, the size changed).
    pub fn invalidate(&mut self) {
        self.scheduler.invalidate();
    }

    /// Records a reference playhead (Remotion's in compare mode) to report drift against.
    pub fn reference(&mut self, position: f64, at: f64) {
        self.drift = Some((self.clock.position(at) - position) * self.fps);
    }

    fn frame_at(&self, position: f64) -> i64 {
        // The epsilon keeps `frame / fps` from landing one frame early.
        ((position * self.fps + 1e-6).floor() as i64).clamp(0, self.frames - 1)
    }

    fn drawable(&self) -> bool {
        self.device == Device::Ready && self.storyboard.is_some()
    }

    /// The frame to draw now, if any; the host draws it, then calls [`Session::drawn`].
    pub fn tick(&mut self, now: f64) -> Option<i64> {
        if self.clock.ended(now) {
            self.clock.pause((self.frames - 1) as f64 / self.fps);
        }
        if !self.drawable() {
            return None;
        }
        let due = self.frame_at(self.clock.position(now));
        self.scheduler.next(due, self.clock.playing())
    }

    /// The draw `tick` asked for finished on the GPU after `millis`.
    pub fn drawn(&mut self, millis: f64) {
        self.scheduler.done();
        self.samples.push(millis);
    }

    /// True while the host should keep ticking: playing, or a draw pending.
    pub fn wants_tick(&self, now: f64) -> bool {
        self.drawable() && (self.clock.playing() || self.scheduler.pending(self.frame_at(self.clock.position(now))))
    }

    pub fn status(&self) -> Status {
        match &self.device {
            Device::Failed(message) => Status::Failed(message.clone()),
            Device::Pending => Status::Loading,
            _ if self.storyboard.is_none() => Status::Loading,
            Device::Lost => Status::DeviceLost,
            Device::Ready if self.clock.playing() => Status::Playing,
            Device::Ready if self.started => Status::Paused,
            Device::Ready => Status::Ready,
        }
    }

    pub fn report(&self, now: f64) -> Report {
        let position = self.clock.position(now);
        Report {
            status: self.status(),
            position,
            frame: self.frame_at(position),
            dropped: self.scheduler.dropped(),
            times: frame_times(&self.samples),
            drift: self.drift,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A ready session over a 10 s storyboard at 30 fps, named by `&str`.
    fn session() -> Session<&'static str> {
        let mut session = Session::new();
        session.device_ready();
        session.set_storyboard("a", 30.0, 300).unwrap();
        session
    }

    /// Ticks and finishes the draw, returning the frame drawn.
    fn draw(session: &mut Session<&str>, now: f64) -> Option<i64> {
        let frame = session.tick(now);
        if frame.is_some() {
            session.drawn(5.0);
        }
        frame
    }

    #[test]
    fn a_session_starts_loading_until_the_device_and_a_storyboard_are_ready() {
        let mut session = Session::new();
        assert_eq!(session.status(), Status::Loading);
        session.device_ready();
        assert_eq!(session.status(), Status::Loading);
        assert_eq!(session.tick(0.0), None);
        session.set_storyboard("a", 30.0, 300).unwrap();
        assert_eq!(session.status(), Status::Ready);
        assert_eq!(session.tick(0.0), Some(0));
    }

    #[test]
    fn startup_fails_with_a_message() {
        let mut session: Session<&str> = Session::new();
        session.fail("no WebGPU adapter");
        assert_eq!(session.status(), Status::Failed("no WebGPU adapter".into()));
        assert_eq!(session.report(0.0).status.name(), "failed");
    }

    #[test]
    fn an_edit_redraws_the_frame_from_the_new_storyboard() {
        let mut session = session();
        session.pause(4.0);
        assert_eq!(draw(&mut session, 0.0), Some(120));
        assert_eq!(draw(&mut session, 1.0), None);
        session.set_storyboard("b", 30.0, 300).unwrap();
        assert_eq!(draw(&mut session, 2.0), Some(120));
        assert_eq!(session.storyboard(), Some(&"b"));
        assert_eq!(session.fps(), 30.0);
        assert_eq!(session.duration_frames(), 300);
    }

    #[test]
    fn a_refused_storyboard_keeps_the_previous_one() {
        let mut session = session();
        assert!(session.set_storyboard("b", 0.0, 300).unwrap_err().contains("fps"));
        assert!(session.set_storyboard("b", 30.0, 0).unwrap_err().contains("duration"));
        assert_eq!(session.storyboard(), Some(&"a"));
    }

    #[test]
    fn drawing_timing_follows_only_accepted_storyboards() {
        let mut session = session();
        session.set_storyboard("b", 24.0, 241).unwrap();
        assert_eq!((session.fps(), session.duration_frames()), (24.0, 241));
        assert!(session.set_storyboard("c", 0.0, 600).is_err());
        assert_eq!((session.fps(), session.duration_frames()), (24.0, 241));
    }

    #[test]
    fn a_session_with_no_media_adapters_plays_on_the_host_clock() {
        let mut session = session();
        session.play(2.0, 100.0, 1.0);
        assert_eq!(session.status(), Status::Playing);
        assert_eq!(draw(&mut session, 100.0), Some(60));
        assert_eq!(draw(&mut session, 101.5), Some(105));
        assert_eq!(session.report(101.5).position, 3.5);
    }

    #[test]
    fn playback_pauses_on_the_last_frame_at_the_end() {
        let mut session = session();
        session.play(9.5, 100.0, 1.0);
        assert_eq!(draw(&mut session, 102.0), Some(299));
        assert_eq!(session.status(), Status::Paused);
        assert!(!session.wants_tick(200.0));
        assert_eq!(session.report(200.0).frame, 299);
    }

    #[test]
    fn a_slow_draw_during_playback_counts_dropped_frames() {
        let mut session = session();
        session.play(0.0, 100.0, 1.0);
        assert_eq!(session.tick(100.0), Some(0));
        // The draw takes three frame intervals.
        assert_eq!(session.tick(100.0 + 1.0 / 30.0), None);
        assert_eq!(session.tick(100.0 + 2.0 / 30.0), None);
        session.drawn(100.0);
        assert_eq!(session.tick(100.0 + 3.0 / 30.0), Some(3));
        assert_eq!(session.report(100.1).dropped, 2);
    }

    #[test]
    fn seeks_during_a_draw_draw_only_the_last() {
        let mut session = session();
        assert_eq!(session.tick(0.0), Some(0));
        for frame in [10.0, 20.0, 30.0] {
            session.seek(frame / 30.0, 0.0);
            assert_eq!(session.tick(0.0), None);
        }
        session.drawn(5.0);
        assert_eq!(session.tick(0.0), Some(30));
    }

    #[test]
    fn the_device_is_lost_and_recovers_on_the_same_frame() {
        let mut session = session();
        session.pause(3.0);
        assert_eq!(draw(&mut session, 0.0), Some(90));
        session.device_lost();
        assert_eq!(session.status(), Status::DeviceLost);
        assert_eq!(session.tick(1.0), None);
        session.device_ready();
        assert_eq!(session.status(), Status::Paused);
        assert!(session.wants_tick(2.0));
        assert_eq!(draw(&mut session, 2.0), Some(90));
    }

    #[test]
    fn a_device_that_cannot_be_recreated_fails() {
        let mut session = session();
        session.device_lost();
        session.fail("no WebGPU device");
        assert_eq!(session.status(), Status::Failed("no WebGPU device".into()));
        assert_eq!(session.tick(0.0), None);
    }

    #[test]
    fn drift_is_the_session_playhead_minus_the_reference_in_frames() {
        let mut session = session();
        session.play(1.0, 100.0, 1.0);
        session.reference(1.9, 101.0);
        assert!((session.report(101.0).drift.unwrap() - 3.0).abs() < 1e-9);
    }

    #[test]
    fn frame_times_cover_every_drawn_frame() {
        let mut session = session();
        session.tick(0.0);
        session.drawn(20.0);
        session.seek(1.0, 0.0);
        session.tick(0.0);
        session.drawn(30.0);
        let times = session.report(0.0).times.unwrap();
        assert_eq!((times.last, times.p50, times.count), (30.0, 20.0, 2));
    }
}
