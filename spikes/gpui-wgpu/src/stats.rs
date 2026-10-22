use std::time::Duration;

/// p50, p95 and max of a sample, in milliseconds.
pub fn summary(samples: &[Duration]) -> String {
    if samples.is_empty() {
        return "n=0".into();
    }
    let mut sorted: Vec<f64> = samples.iter().map(|d| d.as_secs_f64() * 1000.0).collect();
    sorted.sort_by(f64::total_cmp);
    let at = |q: f64| sorted[((sorted.len() - 1) as f64 * q).round() as usize];
    format!("n={} p50={:.2}ms p95={:.2}ms max={:.2}ms", sorted.len(), at(0.5), at(0.95), at(1.0))
}

/// Frames skipped between two produced frames, given the target period.
/// An interval up to 1.5 periods counts as on time.
pub fn dropped(interval: Duration, period: Duration) -> u64 {
    let periods = interval.as_secs_f64() / period.as_secs_f64();
    if periods <= 1.5 { 0 } else { periods.round() as u64 - 1 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_dropped_frames_from_interval() {
        let period = Duration::from_micros(33_333);
        assert_eq!(dropped(Duration::from_millis(34), period), 0);
        assert_eq!(dropped(Duration::from_millis(48), period), 0);
        assert_eq!(dropped(Duration::from_millis(67), period), 1);
        assert_eq!(dropped(Duration::from_millis(100), period), 2);
    }
}
