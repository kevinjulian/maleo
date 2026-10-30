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
    Buffering,
    Stalled(String),
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
            Status::Buffering => "buffering",
            Status::Stalled(_) => "stalled",
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
    pub generation: u64,
    pub media_generation: u32,
    pub media_ready: bool,
    pub blockers: Vec<crate::media::Blocker>,
    pub audio_owned: bool,
}

pub struct Session<S> {
    storyboard: Option<S>,
    fps: f64,
    frames: i64,
    clock: Clock,
    scheduler: Scheduler,
    device: Device,
    device_recovering: bool,
    /// The host has played or paused: `ready` reads `paused` from then on.
    started: bool,
    samples: Vec<f64>,
    drift: Option<f64>,
    generation: u64,
    media_revision: Option<String>,
    media_generation: u32,
    media_sequence: Option<u64>,
    media_ready: bool,
    blockers: Vec<crate::media::Blocker>,
    media_playback: crate::media::Playback,
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
            device_recovering: false,
            started: false,
            samples: Vec::new(),
            drift: None,
            generation: 0,
            media_revision: None,
            media_generation: 0,
            media_sequence: None,
            media_ready: true,
            blockers: Vec::new(),
            media_playback: crate::media::Playback::Ready,
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

    /// Context is mandatory for browser inputs; host-free media-free sessions need no readiness adapter.
    pub fn set_storyboard_context(&mut self, storyboard: S, fps: f64, frames: i64, generation: u64, revision: String, now: f64) -> Result<(), String> {
        if generation <= self.generation || generation > (1u64 << 53) - 1 || revision.is_empty() || !now.is_finite() {
            return Err("Invalid or obsolete preview input context".into());
        }
        self.set_storyboard(storyboard, fps, frames)?;
        self.generation = generation;
        if self.media_revision.as_ref() != Some(&revision) {
            if self.clock.playing() {
                self.pause(self.clock.position(now));
            } else {
                self.clock.pause(self.clock.position(now));
                self.media_playback = crate::media::Playback::Ready;
            }
            self.media_revision = Some(revision);
            self.media_sequence = None;
            self.media_generation = 0;
            self.media_ready = false;
            self.blockers.clear();
        }
        Ok(())
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn media_readiness(&mut self, generation: u64, readiness: crate::media::Readiness, now: f64) -> Result<bool, String> {
        if generation != self.generation
            || self.media_revision.as_ref() != Some(&readiness.revision)
            || self.media_sequence.is_some_and(|sequence| readiness.sequence <= sequence)
            || readiness.generation < self.media_generation
        {
            return Ok(false);
        }
        readiness.validate()?;
        if !now.is_finite() {
            return Err("Invalid media readiness observation time".into());
        }
        if !readiness.ready {
            if self.clock.playing() {
                self.pause(self.clock.position(now));
            } else {
                self.clock.pause(self.clock.position(now));
                self.media_playback = crate::media::Playback::Ready;
            }
        }
        self.media_generation = readiness.generation;
        self.media_sequence = Some(readiness.sequence);
        self.media_ready = readiness.ready;
        self.blockers = readiness.blockers;
        Ok(true)
    }
    pub fn media_playback(&mut self, generation: u64, playback: crate::media::Playback, now: f64) -> Result<bool, String> {
        if generation != self.generation {
            return Ok(false);
        }
        if !self.clock.playing() && playback != crate::media::Playback::Ready {
            return Ok(false);
        }
        if !now.is_finite() || matches!(&playback,crate::media::Playback::Stalled(message) if message.is_empty()) {
            return Err("Invalid media playback state".into());
        }
        if playback == crate::media::Playback::Ready {
            self.clock.resume(now);
        } else {
            self.clock.hold(now);
            if matches!(playback, crate::media::Playback::Stalled(_)) {
                self.clock.pause(self.clock.position(now));
            }
        }
        self.media_playback = playback;
        Ok(true)
    }
    fn can_play(&self) -> Result<(), String> {
        if !self.drawable() || self.device_recovering {
            return Err("Preview device or storyboard is not ready".into());
        }
        if !self.media_ready {
            return Err(self.blockers.first().map_or("Preview media is still loading".into(), |blocker| blocker.message.clone()));
        }
        Ok(())
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

    /// Device recovery resumes only the Play intent that survived loss and user input.
    pub fn device_recovered(&mut self, now: f64) {
        self.scheduler.done();
        self.device_ready();
        self.device_recovering = true;
        self.clock.hold(now);
    }

    /// The device is gone: nothing draws until [`Session::device_ready`],
    /// and the frame on screen draws again then.
    pub fn device_lost(&mut self, now: f64) {
        self.device_recovering = false;
        self.clock.hold(now);
        self.device = Device::Lost;
        self.scheduler.done();
        self.scheduler.invalidate();
    }

    /// The session cannot draw: no device, or a draw failed.
    pub fn fail(&mut self, message: impl Into<String>, now: f64) {
        self.device_recovering = false;
        self.pause(self.clock.position(now));
        self.device = Device::Failed(message.into());
        self.scheduler.done();
    }

    pub fn seek(&mut self, position: f64, now: f64) {
        self.clock.seek(position, now);
        self.scheduler.restart();
    }

    pub fn play(&mut self, position: f64, at: f64, rate: f64) -> Result<(), String> {
        self.can_play()?;
        if !position.is_finite() || !at.is_finite() || !rate.is_finite() || rate <= 0.0 {
            return Err("Invalid preview playback timing".into());
        }
        self.clock.play(position, at, rate);
        self.scheduler.restart();
        self.started = true;
        self.media_playback = crate::media::Playback::Ready;
        Ok(())
    }

    pub fn pause(&mut self, position: f64) {
        self.clock.pause(position);
        self.started = true;
        self.media_playback = crate::media::Playback::Ready;
    }

    /// Attach an activated output without advancing through host time during priming or silence.
    pub fn audio_start(&mut self, anchor: crate::audio_clock::Anchor) -> Result<(), String> {
        self.clock.attach_audio(anchor)?;
        self.scheduler.invalidate();
        Ok(())
    }
    /// Validates the output anchor before changing playback or clock ownership.
    pub fn play_audio(&mut self, anchor: crate::audio_clock::Anchor, at: f64) -> Result<(), String> {
        self.can_play()?;
        if !at.is_finite() {
            return Err("Invalid audio playback host time".into());
        }
        let mut clock = self.clock.clone();
        clock.play(anchor.position, at, anchor.rate);
        clock.attach_audio(anchor)?;
        self.clock = clock;
        self.scheduler.restart();
        self.started = true;
        self.media_playback = crate::media::Playback::Ready;
        Ok(())
    }
    pub fn audio_position(&mut self, observation: crate::audio_clock::Observation) -> Result<bool, String> {
        self.clock.observe_audio(observation)
    }
    pub fn audio_stop(&mut self, now: f64) {
        self.clock.detach_audio(now);
        self.scheduler.invalidate();
    }
    pub fn audio_owned(&self) -> bool {
        self.clock.audio_owned()
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
    pub fn drawn(&mut self, millis: f64, now: f64) {
        self.scheduler.done();
        self.samples.push(millis);
        if self.device_recovering {
            self.device_recovering = false;
            if self.media_ready && self.media_playback == crate::media::Playback::Ready {
                self.clock.resume(now);
            }
        }
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
            Device::Ready if self.device_recovering => Status::DeviceLost,
            Device::Ready => match &self.media_playback {
                _ if !self.media_ready => Status::Loading,
                crate::media::Playback::Stalled(message) => Status::Stalled(message.clone()),
                crate::media::Playback::Buffering if self.clock.playing() => Status::Buffering,
                _ if self.clock.playing() => Status::Playing,
                _ if self.started => Status::Paused,
                _ => Status::Ready,
            },
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
            generation: self.generation,
            media_generation: self.media_generation,
            media_ready: self.media_ready,
            blockers: self.blockers.clone(),
            audio_owned: self.clock.audio_owned(),
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

    #[test]
    fn readiness_blocks_play_but_keeps_paused_edits_and_never_queues_autoplay() {
        use crate::media::Readiness;
        let mut session = session();
        session.set_storyboard_context("a", 30.0, 300, 1, "bytes-r1".into(), 0.0).unwrap();
        assert_eq!(session.status(), Status::Loading);
        assert!(session.play(0.0, 0.0, 1.0).is_err());
        session.seek(4.0, 0.0);
        assert_eq!(session.report(999.0).position, 4.0);
        let ready = Readiness { revision: "bytes-r1".into(), generation: 1, sequence: 1, ready: true, blockers: vec![] };
        session.media_readiness(1, ready.clone(), 0.0).unwrap();
        assert_eq!(session.report(999.0).position, 4.0);
        assert_eq!(session.status(), Status::Ready);
        session.play(4.0, 100.0, 1.0).unwrap();
        session.set_storyboard_context("b", 30.0, 300, 2, "bytes-r2".into(), 101.0).unwrap();
        assert_eq!(session.report(999.0).position, 5.0);
        assert_eq!(session.status(), Status::Loading);
        assert!(!session.media_readiness(1, ready, 102.0).unwrap());
        session.media_readiness(2, Readiness { revision: "bytes-r2".into(), generation: 2, sequence: 2, ready: true, blockers: vec![] }, 102.0).unwrap();
        assert_eq!(session.status(), Status::Paused);
        assert_eq!(session.report(9999.0).position, 5.0);
    }
    #[test]
    fn malformed_readiness_and_context_leave_storyboard_position_and_generation_unchanged() {
        use crate::media::{Blocker, Readiness};
        let mut session = session();
        session.set_storyboard_context("a", 30.0, 300, 1, "r1".into(), 0.0).unwrap();
        session.seek(3.0, 0.0);
        let before = session.report(100.0);
        assert!(session.set_storyboard_context("bad", f64::NAN, 300, 2, "r2".into(), 0.0).is_err());
        assert_eq!(session.report(100.0), before);
        assert_eq!(session.storyboard(), Some(&"a"));
        let bad = Readiness {
            revision: "r1".into(),
            generation: 1,
            sequence: 1,
            ready: true,
            blockers: vec![Blocker { clip_id: "clip".into(), message: "Source failed".into() }],
        };
        assert!(session.media_readiness(1, bad, 0.0).is_err());
        assert_eq!(session.report(100.0), before);
        let ready = Readiness { revision: "r1".into(), generation: 1, sequence: 2, ready: true, blockers: vec![] };
        session.media_readiness(1, ready.clone(), 0.0).unwrap();
        assert!(!session.media_readiness(1, Readiness { ready: false, ..ready }, 0.0).unwrap());
        assert!(session.report(100.0).media_ready);
    }
    #[test]
    fn buffering_and_stalled_hold_position_and_late_recovery_cannot_restart_pause() {
        use crate::media::Playback;
        let mut session = session();
        session.play(2.0, 100.0, 1.0).unwrap();
        session.media_playback(0, Playback::Buffering, 100.5).unwrap();
        assert_eq!(session.status(), Status::Buffering);
        assert_eq!(session.report(500.0).position, 2.5);
        session.media_playback(0, Playback::Ready, 101.0).unwrap();
        assert_eq!(session.report(102.0).position, 3.5);
        session.media_playback(0, Playback::Ready, 102.0).unwrap();
        assert_eq!(session.report(103.0).position, 4.5);
        session.media_playback(0, Playback::Stalled("Decoder failed".into()), 103.0).unwrap();
        assert_eq!(session.status(), Status::Stalled("Decoder failed".into()));
        assert_eq!(session.report(500.0).position, 4.5);
        session.pause(4.5);
        assert!(!session.media_playback(0, Playback::Stalled("Late failure".into()), 104.0).unwrap());
        session.media_playback(0, Playback::Ready, 105.0).unwrap();
        assert_eq!(session.status(), Status::Paused);
        assert_eq!(session.report(500.0).position, 4.5);
    }

    #[test]
    fn an_active_audio_output_drives_session_frames_without_redundant_redraws() {
        use crate::audio_clock::{Anchor, Observation, OutputTimestamp};
        let mut session = session();
        session.play(2.0, 100.0, 1.0).unwrap();
        session.audio_start(Anchor { generation: 1, position: 2.0, sample_rate: 48000, rate: 1.0 }).unwrap();
        assert!(session.audio_owned());
        assert_eq!(draw(&mut session, 99999.0), Some(60));
        let observation = Observation {
            generation: 1,
            frames: 48000,
            render_frame: 96000,
            context_time: 2.0,
            performance_time: 2000.0,
            output: Some(OutputTimestamp { context_time: 1.98, performance_time: 2000.0 }),
            latency: None,
        };
        session.audio_position(observation).unwrap();
        assert_eq!(draw(&mut session, 99999.0), Some(89));
        session.audio_position(observation).unwrap();
        assert_eq!(draw(&mut session, 99999.0), None);
        session.audio_stop(99999.0);
        assert!(!session.audio_owned());
        assert!((session.report(99999.5).position - 3.48).abs() < 1e-10);
    }

    #[test]
    fn audio_play_is_atomic_and_an_invalid_output_keeps_the_accepted_session() {
        use crate::audio_clock::Anchor;
        let mut session = session();
        session.pause(3.0);
        let before = session.report(100.0);
        let anchor = Anchor { generation: 1, position: 3.0, sample_rate: 48000, rate: 2.0 };
        assert!(session.play_audio(Anchor { sample_rate: 0, ..anchor }, 100.0).is_err());
        assert_eq!(session.report(100.0), before);
        assert!(session.play_audio(anchor, f64::NAN).is_err());
        assert_eq!(session.report(100.0), before);
        session.play_audio(anchor, 100.0).unwrap();
        assert_eq!(session.report(9999.0).position, 3.0);
        assert!(session.audio_owned());
    }

    /// Ticks and finishes the draw, returning the frame drawn.
    fn draw(session: &mut Session<&str>, now: f64) -> Option<i64> {
        let frame = session.tick(now);
        if frame.is_some() {
            session.drawn(5.0, now);
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
        session.fail("no WebGPU adapter", 0.0);
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
        session.play(2.0, 100.0, 1.0).unwrap();
        assert_eq!(session.status(), Status::Playing);
        assert_eq!(draw(&mut session, 100.0), Some(60));
        assert_eq!(draw(&mut session, 101.5), Some(105));
        assert_eq!(session.report(101.5).position, 3.5);
    }

    #[test]
    fn playback_pauses_on_the_last_frame_at_the_end() {
        let mut session = session();
        session.play(9.5, 100.0, 1.0).unwrap();
        assert_eq!(draw(&mut session, 102.0), Some(299));
        assert_eq!(session.status(), Status::Paused);
        assert!(!session.wants_tick(200.0));
        assert_eq!(session.report(200.0).frame, 299);
    }

    #[test]
    fn a_slow_draw_during_playback_counts_dropped_frames() {
        let mut session = session();
        session.play(0.0, 100.0, 1.0).unwrap();
        assert_eq!(session.tick(100.0), Some(0));
        // The draw takes three frame intervals.
        assert_eq!(session.tick(100.0 + 1.0 / 30.0), None);
        assert_eq!(session.tick(100.0 + 2.0 / 30.0), None);
        session.drawn(100.0, 100.0 + 3.0 / 30.0);
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
        session.drawn(5.0, 0.0);
        assert_eq!(session.tick(0.0), Some(30));
    }

    #[test]
    fn the_device_is_lost_and_recovers_on_the_same_frame() {
        let mut session = session();
        session.pause(3.0);
        assert_eq!(draw(&mut session, 0.0), Some(90));
        session.device_lost(0.0);
        assert_eq!(session.status(), Status::DeviceLost);
        assert_eq!(session.tick(1.0), None);
        session.device_ready();
        assert_eq!(session.status(), Status::Paused);
        assert!(session.wants_tick(2.0));
        assert_eq!(draw(&mut session, 2.0), Some(90));
    }

    #[test]
    fn device_loss_holds_active_position_and_pause_cancels_recovery_intent() {
        let mut session = session();
        session.play(1.0, 100.0, 1.0).unwrap();
        session.device_lost(101.0);
        assert_eq!(session.report(999.0).position, 2.0);
        session.device_recovered(105.0);
        assert_eq!(session.status(), Status::DeviceLost);
        assert_eq!(session.report(106.0).position, 2.0);
        assert!(session.play(2.0, 106.0, 1.0).is_err());
        assert_eq!(draw(&mut session, 105.0), Some(60));
        assert_eq!(session.status(), Status::Playing);
        assert_eq!(session.report(106.0).position, 3.0);
        session.device_lost(106.0);
        session.seek(6.0, 107.0);
        assert_eq!(session.report(999.0).position, 6.0);
        session.pause(6.0);
        session.device_recovered(110.0);
        assert_eq!(session.status(), Status::DeviceLost);
        draw(&mut session, 110.0);
        assert_eq!(session.status(), Status::Paused);
        assert_eq!(session.report(999.0).position, 6.0);
        session.play(6.0, 110.0, 1.0).unwrap();
        session.fail("Device recovery exhausted", 111.0);
        assert_eq!(session.report(999.0).position, 7.0);
        assert!(!session.wants_tick(999.0));
    }

    #[test]
    fn a_device_that_cannot_be_recreated_fails() {
        let mut session = session();
        session.device_lost(0.0);
        session.fail("no WebGPU device", 0.0);
        assert_eq!(session.status(), Status::Failed("no WebGPU device".into()));
        assert_eq!(session.tick(0.0), None);
    }

    #[test]
    fn drift_is_the_session_playhead_minus_the_reference_in_frames() {
        let mut session = session();
        session.play(1.0, 100.0, 1.0).unwrap();
        session.reference(1.9, 101.0);
        assert!((session.report(101.0).drift.unwrap() - 3.0).abs() < 1e-9);
    }

    #[test]
    fn frame_times_cover_every_drawn_frame() {
        let mut session = session();
        session.tick(0.0);
        session.drawn(20.0, 0.0);
        session.seek(1.0, 0.0);
        session.tick(0.0);
        session.drawn(30.0, 0.0);
        let times = session.report(0.0).times.unwrap();
        assert_eq!((times.last, times.p50, times.count), (30.0, 20.0, 2));
    }
}
