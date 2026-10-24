//! The frame scheduler (design D4): one draw in flight, the latest due frame
//! wins. A draw is in flight from submit until the host reports the GPU work
//! done; ticks during it draw nothing, so seeks that arrive meanwhile never
//! queue: the next tick draws whatever frame is due then.

#[derive(Debug, Default)]
pub struct Scheduler {
    in_flight: bool,
    on_screen: Option<i64>,
    /// The frame on screen no longer shows the current input (a new
    /// storyboard, an image, a size, a new device).
    stale: bool,
    /// The last frame drawn in this run of playback, to count drops against.
    played: Option<i64>,
    dropped: u64,
}

impl Scheduler {
    /// The frame to draw now, if any. `due` is the frame at the position.
    pub fn next(&mut self, due: i64, playing: bool) -> Option<i64> {
        if self.in_flight || (!self.stale && self.on_screen == Some(due)) {
            return None;
        }
        if playing {
            if let Some(last) = self.played.filter(|&last| due > last + 1) {
                self.dropped += (due - last - 1) as u64;
            }
            self.played = Some(due);
        } else {
            self.played = None;
        }
        self.in_flight = true;
        self.stale = false;
        self.on_screen = Some(due);
        Some(due)
    }

    /// The draw in flight finished (or was abandoned).
    pub fn done(&mut self) {
        self.in_flight = false;
    }

    /// The frame on screen must be drawn again.
    pub fn invalidate(&mut self) {
        self.stale = true;
    }

    /// Playback jumped (a seek or a new play): no frames were passed over.
    pub fn restart(&mut self) {
        self.played = None;
    }

    pub fn in_flight(&self) -> bool {
        self.in_flight
    }

    /// True when a tick at `due` would draw or is waiting for a draw.
    pub fn pending(&self, due: i64) -> bool {
        self.in_flight || self.stale || self.on_screen != Some(due)
    }

    pub fn dropped(&self) -> u64 {
        self.dropped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slow_frame_drops_the_frames_it_passes_over() {
        let mut scheduler = Scheduler::default();
        assert_eq!(scheduler.next(10, true), Some(10));
        // The draw takes three frame intervals: ticks at 11 and 12 draw nothing.
        assert_eq!(scheduler.next(11, true), None);
        assert_eq!(scheduler.next(12, true), None);
        scheduler.done();
        assert_eq!(scheduler.next(13, true), Some(13));
        assert_eq!(scheduler.dropped(), 2);
    }

    #[test]
    fn seeks_during_a_draw_draw_only_the_last() {
        let mut scheduler = Scheduler::default();
        assert_eq!(scheduler.next(0, false), Some(0));
        for frame in [10, 20, 30] {
            assert_eq!(scheduler.next(frame, false), None);
        }
        scheduler.done();
        assert_eq!(scheduler.next(30, false), Some(30));
        scheduler.done();
        assert_eq!(scheduler.dropped(), 0);
    }

    #[test]
    fn a_paused_tick_with_its_frame_on_screen_draws_nothing() {
        let mut scheduler = Scheduler::default();
        assert_eq!(scheduler.next(42, false), Some(42));
        scheduler.done();
        assert_eq!(scheduler.next(42, false), None);
        assert!(!scheduler.pending(42));
    }

    #[test]
    fn an_invalidated_frame_draws_again() {
        let mut scheduler = Scheduler::default();
        scheduler.next(42, false);
        scheduler.done();
        scheduler.invalidate();
        assert!(scheduler.pending(42));
        assert_eq!(scheduler.next(42, false), Some(42));
    }

    #[test]
    fn a_restart_counts_no_drops_across_the_jump() {
        let mut scheduler = Scheduler::default();
        scheduler.next(10, true);
        scheduler.done();
        scheduler.restart();
        assert_eq!(scheduler.next(200, true), Some(200));
        assert_eq!(scheduler.dropped(), 0);
    }
}
