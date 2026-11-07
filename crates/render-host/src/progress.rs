//! The host's stdout protocol (OpenSpec p2-export E4): one JSON object per line.
//!
//! ```text
//! {"phase":"loading"}
//! {"phase":"rendering","frame":12,"frames":90}
//! {"refused":"frame 45 cannot be exported: textOverlays[0] `lower-third` preset","coverage":[...]}
//! {"failed":"render: ...","stage":"render"}
//! {"done":true,"frames":90}
//! ```
//!
//! Exit codes: 0 done, 1 failed, 2 refused (coverage), 143 cancelled (SIGTERM).

use std::io::Write;

use serde::Serialize;

pub const EXIT_OK: i32 = 0;
pub const EXIT_FAILED: i32 = 1;
pub const EXIT_REFUSED: i32 = 2;
pub const EXIT_CANCELLED: i32 = 143;

#[derive(Serialize)]
#[serde(untagged)]
pub enum Event<'a> {
    Phase { phase: &'a str },
    Frame { phase: &'a str, frame: i64, frames: i64 },
    Refused { refused: String, coverage: serde_json::Value },
    Failed { failed: String, stage: &'a str },
    Cancelled { cancelled: bool },
    Done { done: bool, frames: i64 },
}

/// Writes one event line to stdout and flushes it, so the worker sees progress at once.
pub fn emit(event: &Event<'_>) {
    let mut out = std::io::stdout().lock();
    // A closed stdout means the worker is gone; the run still ends by its exit code.
    if let Ok(line) = serde_json::to_string(event) {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_serialize_as_one_flat_object() {
        assert_eq!(serde_json::to_string(&Event::Frame { phase: "rendering", frame: 3, frames: 9 }).unwrap(), r#"{"phase":"rendering","frame":3,"frames":9}"#);
        assert_eq!(serde_json::to_string(&Event::Done { done: true, frames: 9 }).unwrap(), r#"{"done":true,"frames":9}"#);
        assert_eq!(serde_json::to_string(&Event::Failed { failed: "x".into(), stage: "render" }).unwrap(), r#"{"failed":"x","stage":"render"}"#);
    }
}
