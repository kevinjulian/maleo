//! Frame-time statistics: the last frame time, and the median and 95th
//! percentile over the session by nearest rank.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameTimes {
    pub last: f64,
    pub p50: f64,
    pub p95: f64,
    pub count: usize,
}

pub fn frame_times(samples: &[f64]) -> Option<FrameTimes> {
    let last = *samples.last()?;
    let mut sorted = samples.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = |p: f64| sorted[((p * sorted.len() as f64).ceil() as usize).max(1) - 1];
    Some(FrameTimes { last, p50: rank(0.5), p95: rank(0.95), count: samples.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_samples_have_no_times() {
        assert_eq!(frame_times(&[]), None);
    }

    #[test]
    fn percentiles_use_the_nearest_rank() {
        let samples: Vec<f64> = (1..=20).rev().map(f64::from).collect();
        assert_eq!(frame_times(&samples), Some(FrameTimes { last: 1.0, p50: 10.0, p95: 19.0, count: 20 }));
        assert_eq!(frame_times(&[7.0]), Some(FrameTimes { last: 7.0, p50: 7.0, p95: 7.0, count: 1 }));
    }
}
