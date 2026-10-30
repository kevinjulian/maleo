//! Playback position from consumed audio when attached, otherwise from host time.
use crate::audio_clock::{Anchor, AudioClock, Observation};

/// Position is clamped to `[0, duration]`. Host-time rate scaling applies only
/// without an audio owner. An attached audio output advances through observations.
#[derive(Clone, Debug, PartialEq)]
pub struct Clock {
    anchor: f64,
    at: f64,
    rate: f64,
    playing: bool,
    duration: f64,
    audio: Option<AudioClock>,
    audio_generation: Option<u64>,
    held: bool,
}

impl Default for Clock {
    fn default() -> Self {
        Self { anchor: 0.0, at: 0.0, rate: 1.0, playing: false, duration: 0.0, audio: None, audio_generation: None, held: false }
    }
}

impl Clock {
    pub fn playing(&self) -> bool {
        self.playing
    }

    /// Sets the end of the timeline in seconds; the position stays inside it.
    pub fn set_duration(&mut self, duration: f64) {
        self.duration = duration.max(0.0);
        self.anchor = self.anchor.clamp(0.0, self.duration);
    }

    fn unclamped(&self, now: f64) -> f64 {
        if self.playing && !self.held {
            self.audio.as_ref().map_or_else(|| self.anchor + (now - self.at) * self.rate, AudioClock::position)
        } else {
            self.anchor
        }
    }

    pub fn position(&self, now: f64) -> f64 {
        self.unclamped(now).clamp(0.0, self.duration)
    }

    /// True when playing and the position has reached the end.
    pub fn ended(&self, now: f64) -> bool {
        self.playing && self.unclamped(now) >= self.duration
    }

    pub fn play(&mut self, position: f64, at: f64, rate: f64) {
        self.anchor = position.clamp(0.0, self.duration);
        self.at = at;
        self.rate = rate;
        self.playing = true;
        self.held = false;
        if let Some(audio) = &mut self.audio {
            audio.invalidate(self.anchor, rate);
        }
    }

    pub fn pause(&mut self, position: f64) {
        *self = Self { anchor: position.clamp(0.0, self.duration), playing: false, held: false, ..self.clone() };
    }

    /// Moves the position; playback, if any, continues from it.
    pub fn seek(&mut self, position: f64, now: f64) {
        *self = Self { anchor: position.clamp(0.0, self.duration), at: now, ..self.clone() };
        if let Some(audio) = &mut self.audio {
            audio.invalidate(self.anchor, self.rate);
        }
    }
    pub fn audio_owned(&self) -> bool {
        self.audio.is_some()
    }
    pub fn attach_audio(&mut self, anchor: Anchor) -> Result<(), String> {
        let audio = AudioClock::new(anchor)?;
        if self.audio_generation.is_some_and(|generation| anchor.generation <= generation) {
            return Err("Audio clock needs a fresh output generation".into());
        }
        self.anchor = anchor.position.clamp(0.0, self.duration);
        self.rate = anchor.rate;
        self.audio = Some(audio);
        self.audio_generation = Some(anchor.generation);
        Ok(())
    }
    pub fn observe_audio(&mut self, observation: Observation) -> Result<bool, String> {
        self.audio.as_mut().map_or(Ok(false), |audio| audio.observe(observation))
    }
    pub fn detach_audio(&mut self, now: f64) {
        let position = self.position(now);
        self.audio = None;
        self.anchor = position;
        self.at = now;
    }
    pub fn hold(&mut self, now: f64) {
        self.anchor = self.position(now);
        if let Some(audio) = &mut self.audio {
            audio.invalidate(self.anchor, self.rate);
        }
        self.held = true;
    }
    pub fn resume(&mut self, now: f64) {
        if self.held {
            self.at = now;
            self.held = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clock() -> Clock {
        let mut clock = Clock::default();
        clock.set_duration(10.0);
        clock
    }

    fn audio(clock: &mut Clock, generation: u64, position: f64, rate: f64) {
        clock.attach_audio(Anchor { generation, position, rate, sample_rate: 48000 }).unwrap();
    }
    fn consumed(clock: &mut Clock, generation: u64, frames: u64) {
        clock
            .observe_audio(Observation {
                generation,
                frames,
                render_frame: frames,
                context_time: frames as f64 / 48000.0,
                performance_time: 10000.0 + frames as f64 / 48.0,
                output: None,
                latency: Some(0.0),
            })
            .unwrap();
    }
    #[test]
    fn output_position_overrides_host_time_including_silence_and_stall() {
        let mut clock = clock();
        clock.play(2.0, 100.0, 1.0);
        audio(&mut clock, 1, 2.0, 1.0);
        assert_eq!(clock.position(1000.0), 2.0);
        consumed(&mut clock, 1, 48000);
        assert_eq!(clock.position(2000.0), 3.0);
        consumed(&mut clock, 1, 96000);
        assert_eq!(clock.position(3000.0), 4.0);
        assert!(!clock.ended(99999.0));
        clock.detach_audio(3000.0);
        assert!(!clock.audio_owned());
        assert_eq!(clock.position(3001.0), 5.0);
    }
    #[test]
    fn rate_changes_and_seeks_wait_for_fresh_audio_instead_of_host_time() {
        let mut clock = clock();
        clock.play(2.0, 100.0, 0.5);
        audio(&mut clock, 1, 2.0, 0.5);
        consumed(&mut clock, 1, 48000);
        assert_eq!(clock.position(999.0), 2.5);
        clock.play(2.5, 999.0, 2.0);
        consumed(&mut clock, 1, 96000);
        assert_eq!(clock.position(9999.0), 2.5);
        audio(&mut clock, 2, 2.5, 2.0);
        consumed(&mut clock, 2, 48000);
        assert_eq!(clock.position(9999.0), 4.5);
        clock.seek(7.0, 10000.0);
        consumed(&mut clock, 2, 96000);
        assert_eq!(clock.position(99999.0), 7.0);
        audio(&mut clock, 3, 7.0, 2.0);
        consumed(&mut clock, 3, 48000);
        assert_eq!(clock.position(99999.0), 9.0);
        consumed(&mut clock, 3, 96000);
        assert_eq!(clock.position(99999.0), 10.0);
        assert!(clock.ended(0.0));
    }
    #[test]
    fn buffering_discards_old_output_observations_until_a_fresh_anchor() {
        let mut clock = clock();
        clock.play(1.0, 0.0, 1.0);
        audio(&mut clock, 1, 1.0, 1.0);
        consumed(&mut clock, 1, 48000);
        clock.hold(100.0);
        consumed(&mut clock, 1, 96000);
        clock.resume(200.0);
        assert_eq!(clock.position(999.0), 2.0);
        audio(&mut clock, 2, 2.0, 1.0);
        consumed(&mut clock, 2, 48000);
        assert_eq!(clock.position(9999.0), 3.0);
    }
    #[test]
    fn pause_holds_output_and_reused_generation_cannot_restore_old_sound() {
        let mut clock = clock();
        clock.play(1.0, 0.0, 1.0);
        audio(&mut clock, 1, 1.0, 1.0);
        consumed(&mut clock, 1, 48000);
        clock.pause(2.0);
        consumed(&mut clock, 1, 96000);
        assert_eq!(clock.position(2000.0), 2.0);
        clock.detach_audio(2000.0);
        let before = clock.clone();
        assert!(clock.attach_audio(Anchor { generation: 1, position: 0.0, rate: 1.0, sample_rate: 48000 }).is_err());
        assert_eq!(clock, before);
    }

    #[test]
    fn playback_advances_with_the_host_time() {
        let mut clock = clock();
        clock.play(2.0, 100.0, 1.0);
        assert_eq!(clock.position(101.5), 3.5);
    }

    #[test]
    fn rate_scales_the_position() {
        let mut clock = clock();
        clock.play(0.0, 100.0, 2.0);
        assert_eq!(clock.position(101.0), 2.0);
    }

    #[test]
    fn seek_while_playing_continues_from_the_new_position() {
        let mut clock = clock();
        clock.play(1.0, 100.0, 1.0);
        clock.seek(8.0, 102.0);
        assert!(clock.playing());
        assert_eq!(clock.position(102.5), 8.5);
    }

    #[test]
    fn the_position_stays_inside_the_timeline() {
        let mut clock = clock();
        clock.seek(-3.0, 0.0);
        assert_eq!(clock.position(0.0), 0.0);
        clock.play(9.0, 100.0, 1.0);
        assert_eq!(clock.position(105.0), 10.0);
        assert!(clock.ended(105.0));
        assert!(!clock.ended(100.5));
    }

    #[test]
    fn pause_holds_the_position() {
        let mut clock = clock();
        clock.play(1.0, 100.0, 1.0);
        clock.pause(2.5);
        assert!(!clock.playing());
        assert_eq!(clock.position(500.0), 2.5);
    }
}
