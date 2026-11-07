//! The render job the worker hands the host (OpenSpec p2-export E4): the
//! prepared render storyboard, a map from every media URL it uses to a local
//! file, and the output shape. The host never makes a network request.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Largest output side, in pixels. Matches the browser export protocol.
pub const MAX_SIDE: u32 = 4096;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Job {
    /// The prepared render storyboard, the value Remotion receives.
    pub storyboard: serde_json::Value,
    /// Every media URL the storyboard uses, mapped to a local file.
    #[serde(default)]
    pub media: BTreeMap<String, PathBuf>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// Output frames; also the composition duration the timing uses.
    pub frames: i64,
    /// Where the output goes. The host writes `<out>.partial` and renames it on success.
    pub out: PathBuf,
}

impl Job {
    pub fn read(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("job {}: {e}", path.display()))?;
        let job: Job = serde_json::from_str(&text).map_err(|e| format!("job {}: {e}", path.display()))?;
        job.validate()?;
        Ok(job)
    }

    /// H.264 needs even sides; the rest bounds memory and timing.
    pub fn validate(&self) -> Result<(), String> {
        for (name, side) in [("width", self.width), ("height", self.height)] {
            if !(16..=MAX_SIDE).contains(&side) || side % 2 != 0 {
                return Err(format!("{name} {side} must be even and within 16..={MAX_SIDE}"));
            }
        }
        if !self.fps.is_finite() || self.fps <= 0.0 || self.fps > 120.0 {
            return Err(format!("fps {} must be within (0, 120]", self.fps));
        }
        if self.frames < 1 {
            return Err(format!("frames {} must be at least 1", self.frames));
        }
        for (url, path) in &self.media {
            if !path.is_file() {
                return Err(format!("media {url}: {} is not a file", path.display()));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(json: serde_json::Value) -> Result<Job, String> {
        let job: Job = serde_json::from_value(json).map_err(|e| e.to_string())?;
        job.validate().map(|()| job)
    }

    #[test]
    fn a_valid_job_parses() {
        let parsed = job(serde_json::json!({"storyboard": {"scenes": []}, "width": 1080, "height": 1920, "fps": 30, "frames": 90, "out": "/tmp/o.mp4"}));
        assert!(parsed.is_ok(), "{parsed:?}");
    }

    #[test]
    fn odd_or_huge_sides_and_bad_timing_are_refused() {
        let base = serde_json::json!({"storyboard": {}, "width": 1080, "height": 1920, "fps": 30, "frames": 90, "out": "/tmp/o.mp4"});
        for (key, value, expect) in [
            ("width", serde_json::json!(1081), "even"),
            ("height", serde_json::json!(8192), "within"),
            ("fps", serde_json::json!(0), "fps"),
            ("frames", serde_json::json!(0), "frames"),
        ] {
            let mut bad = base.clone();
            bad[key] = value;
            let error = job(bad).unwrap_err();
            assert!(error.contains(expect), "{key}: {error}");
        }
    }

    #[test]
    fn unknown_fields_and_missing_media_files_are_refused() {
        let unknown = job(serde_json::json!({"storyboard": {}, "width": 16, "height": 16, "fps": 30, "frames": 1, "out": "o", "extra": 1}));
        assert!(unknown.unwrap_err().contains("extra"));
        let missing =
            job(serde_json::json!({"storyboard": {}, "width": 16, "height": 16, "fps": 30, "frames": 1, "out": "o", "media": {"a.png": "/no/such/file"}}));
        assert!(missing.unwrap_err().contains("a.png"));
    }
}
