//! The playback clock (design D2). The host supplies the time on every call,
//! so a test passes any time it wants and the media change can make the audio
//! output's position the time source without changing the clock.

/// A position in seconds, anchored to a host time while playing:
/// `position = anchor + (now - at) * rate`, clamped to `[0, duration]`.
#[derive(Clone, Debug, PartialEq)]
pub struct Clock {
    anchor: f64,
    at: f64,
    rate: f64,
    playing: bool,
    duration: f64,
}

impl Default for Clock {
    fn default() -> Self {
        Self { anchor: 0.0, at: 0.0, rate: 1.0, playing: false, duration: 0.0 }
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
        if self.playing { self.anchor + (now - self.at) * self.rate } else { self.anchor }
    }

    pub fn position(&self, now: f64) -> f64 {
        self.unclamped(now).clamp(0.0, self.duration)
    }

    /// True when playing and the position has reached the end.
    pub fn ended(&self, now: f64) -> bool {
        self.playing && self.unclamped(now) >= self.duration
    }

    pub fn play(&mut self, position: f64, at: f64, rate: f64) {
        *self = Self { anchor: position.clamp(0.0, self.duration), at, rate, playing: true, duration: self.duration };
    }

    pub fn pause(&mut self, position: f64) {
        *self = Self { anchor: position.clamp(0.0, self.duration), playing: false, ..self.clone() };
    }

    /// Moves the position; playback, if any, continues from it.
    pub fn seek(&mut self, position: f64, now: f64) {
        *self = Self { anchor: position.clamp(0.0, self.duration), at: now, ..self.clone() };
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
