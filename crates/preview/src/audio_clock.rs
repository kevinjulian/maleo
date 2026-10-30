//! Latency-aware output position. Hosts report consumed PCM and platform timestamps, never wall-clock progress.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Anchor {
    pub generation: u64,
    pub position: f64,
    pub sample_rate: u32,
    pub rate: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OutputTimestamp {
    pub context_time: f64,
    /// Milliseconds on the same monotonic performance clock as the observation.
    pub performance_time: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Observation {
    pub generation: u64,
    pub frames: u64,
    pub render_frame: u64,
    pub context_time: f64,
    pub performance_time: f64,
    pub output: Option<OutputTimestamp>,
    /// A calibrated platform estimate, including graph and device output latency.
    pub latency: Option<f64>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct AudioClock {
    anchor: Anchor,
    valid: bool,
    frames: u64,
    audible: f64,
    context_time: f64,
    performance_time: f64,
}
impl AudioClock {
    pub fn new(anchor: Anchor) -> Result<Self, String> {
        if anchor.generation > (1u64 << 53) - 1
            || !anchor.position.is_finite()
            || anchor.position < 0.0
            || !(8000..=192000).contains(&anchor.sample_rate)
            || !anchor.rate.is_finite()
            || !(0.25..=4.0).contains(&anchor.rate)
        {
            return Err("Invalid audio clock anchor".into());
        }
        Ok(Self { anchor, valid: true, frames: 0, audible: 0.0, context_time: 0.0, performance_time: 0.0 })
    }
    pub fn position(&self) -> f64 {
        self.anchor.position + self.audible / f64::from(self.anchor.sample_rate) * self.anchor.rate
    }
    /// Keep ownership while a seek/new Play waits for a fresh output generation.
    pub fn invalidate(&mut self, position: f64, rate: f64) {
        self.anchor.position = position;
        self.anchor.rate = rate;
        self.audible = 0.0;
        self.valid = false;
    }
    pub fn observe(&mut self, observation: Observation) -> Result<bool, String> {
        if !self.valid || observation.generation != self.anchor.generation {
            return Ok(false);
        }
        if observation.frames > (1u64 << 53) - 1
            || observation.render_frame > (1u64 << 53) - 1
            || observation.render_frame < observation.frames
            || !observation.context_time.is_finite()
            || observation.context_time < 0.0
            || !observation.performance_time.is_finite()
            || observation.performance_time < 0.0
            || observation.latency.is_some_and(|latency| !latency.is_finite() || latency < 0.0)
        {
            return Err("Invalid audio output observation".into());
        }
        if observation.frames < self.frames || observation.context_time < self.context_time || observation.performance_time < self.performance_time {
            return Ok(false);
        }
        let audible_time = if let Some(output) = observation.output {
            if !output.context_time.is_finite() || output.context_time < 0.0 || !output.performance_time.is_finite() || output.performance_time < 0.0 {
                return Err("Invalid platform audio output timestamp".into());
            }
            (output.context_time + ((observation.performance_time - output.performance_time) / 1000.0).max(0.0)).min(observation.context_time)
        } else if let Some(latency) = observation.latency {
            if !latency.is_finite() || latency < 0.0 {
                return Err("Invalid calibrated audio output latency".into());
            }
            (observation.context_time - latency).max(0.0)
        } else {
            return Err("Audio output clock needs a platform timestamp or calibrated latency".into());
        };
        let frames = observation.frames as f64;
        let audible = (frames - (observation.render_frame as f64 - audible_time * f64::from(self.anchor.sample_rate)).max(0.0)).clamp(0.0, frames);
        self.frames = observation.frames;
        self.audible = self.audible.max(audible);
        self.context_time = observation.context_time;
        self.performance_time = observation.performance_time;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn anchor(rate: f64) -> Anchor {
        Anchor { generation: 1, position: 2.0, sample_rate: 48000, rate }
    }
    fn observation() -> Observation {
        Observation {
            generation: 1,
            frames: 48000,
            render_frame: 96000,
            context_time: 2.0,
            performance_time: 2000.0,
            output: Some(OutputTimestamp { context_time: 1.98, performance_time: 2000.0 }),
            latency: None,
        }
    }
    #[test]
    fn output_latency_and_global_rate_apply_once() {
        for rate in [0.5, 1.0, 2.0] {
            let mut clock = AudioClock::new(anchor(rate)).unwrap();
            clock.observe(observation()).unwrap();
            assert!((clock.position() - (2.0 + 0.98 * rate)).abs() < 1e-10);
        }
    }
    #[test]
    fn silent_gaps_follow_consumption_and_no_report_never_means_host_progress() {
        let mut clock = AudioClock::new(anchor(1.0)).unwrap();
        assert_eq!(clock.position(), 2.0);
        clock.observe(observation()).unwrap();
        let old = clock.position();
        assert_eq!(clock.position(), old);
        let mut silent = observation();
        silent.frames += 48000;
        silent.render_frame += 48000;
        silent.context_time += 1.0;
        silent.performance_time += 1000.0;
        silent.output = Some(OutputTimestamp { context_time: 2.98, performance_time: 3000.0 });
        clock.observe(silent).unwrap();
        assert!((clock.position() - 3.98).abs() < 1e-10);
    }
    #[test]
    fn calibrated_fallback_and_output_estimation_are_bounded() {
        let mut clock = AudioClock::new(anchor(1.0)).unwrap();
        let mut value = observation();
        value.output = None;
        value.latency = Some(0.02);
        clock.observe(value).unwrap();
        assert!((clock.position() - 2.98).abs() < 1e-10);
        value.output = Some(OutputTimestamp { context_time: 99.0, performance_time: 2000.0 });
        clock.observe(value).unwrap();
        assert_eq!(clock.position(), 3.0);
        value.output = Some(OutputTimestamp { context_time: 1.0, performance_time: 2000.0 });
        clock.observe(value).unwrap();
        assert_eq!(clock.position(), 3.0);
    }
    #[test]
    fn obsolete_and_malformed_reports_do_not_change_accepted_position() {
        let mut clock = AudioClock::new(anchor(1.0)).unwrap();
        clock.observe(observation()).unwrap();
        let original = clock.clone();
        let mut stale = observation();
        stale.generation = 0;
        assert!(!clock.observe(stale).unwrap());
        assert_eq!(clock, original);
        stale = observation();
        stale.frames = 0;
        assert!(!clock.observe(stale).unwrap());
        assert_eq!(clock, original);
        for index in 0..4 {
            let mut bad = observation();
            match index {
                0 => bad.frames = u64::MAX,
                1 => bad.context_time = f64::NAN,
                2 => bad.output = None,
                _ => bad.output.as_mut().unwrap().context_time = -1.0,
            };
            assert!(clock.observe(bad).is_err());
            assert_eq!(clock, original);
        }
        clock.invalidate(5.0, 2.0);
        assert!(!clock.observe(observation()).unwrap());
        assert_eq!(clock.position(), 5.0);
    }
}
