//! The FFmpeg processes the host runs (OpenSpec p2-export E4, E5).
//!
//! FFmpeg is a separate process, never a linked library: the image pins an
//! LGPL build, and the binary can change without a Rust rebuild. Paths come
//! from `MALEO_FFMPEG` and `MALEO_FFPROBE` (default: on `PATH`). The H.264
//! encoder comes from `MALEO_RENDER_H264_ENCODER` (default `libopenh264`, the
//! production encoder). A local GPL build may set `libx264` for development.

use std::process::{Command, Stdio};

use serde::Deserialize;

pub fn ffmpeg() -> String {
    std::env::var("MALEO_FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}

pub fn ffprobe() -> String {
    std::env::var("MALEO_FFPROBE").unwrap_or_else(|_| "ffprobe".into())
}

pub fn h264_encoder() -> String {
    std::env::var("MALEO_RENDER_H264_ENCODER").unwrap_or_else(|_| "libopenh264".into())
}

/// Fails unless this FFmpeg build offers `encoder`.
pub fn require_encoder(encoder: &str) -> Result<(), String> {
    let out = Command::new(ffmpeg()).args(["-hide_banner", "-encoders"]).stderr(Stdio::null()).output().map_err(|e| format!("{}: {e}", ffmpeg()))?;
    let listed = String::from_utf8_lossy(&out.stdout).lines().any(|line| line.split_whitespace().nth(1) == Some(encoder));
    if listed { Ok(()) } else { Err(format!("this FFmpeg build has no {encoder} encoder")) }
}

#[derive(Deserialize)]
struct Probe {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    #[serde(default)]
    packets: Vec<ProbePacket>,
}

#[derive(Deserialize)]
struct ProbeStream {
    width: Option<u32>,
    height: Option<u32>,
    start_time: Option<String>,
    #[serde(default)]
    side_data_list: Vec<SideData>,
    #[serde(default)]
    tags: std::collections::BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct SideData {
    rotation: Option<f64>,
}

#[derive(Deserialize)]
struct ProbePacket {
    pts_time: Option<String>,
}

fn probe(path: &std::path::Path, args: &[&str]) -> Result<Probe, String> {
    let out = Command::new(ffprobe()).args(["-v", "error", "-of", "json"]).args(args).arg(path).output().map_err(|e| format!("{}: {e}", ffprobe()))?;
    if !out.status.success() {
        return Err(format!("{}: {}", path.display(), String::from_utf8_lossy(&out.stderr).trim()));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("{}: probe output: {e}", path.display()))
}

/// A video stream as FFmpeg decodes it: display size (after rotation) and
/// every frame's presentation time, ascending.
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub pts: Vec<f64>,
}

pub fn video_info(path: &std::path::Path) -> Result<VideoInfo, String> {
    let probed = probe(
        path,
        &["-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate:packet=pts_time", "-show_packets"],
    )?;
    let stream = probed.streams.first().ok_or_else(|| format!("{}: no video stream", path.display()))?;
    let (width, height) = (stream.width.ok_or("video width is unknown")?, stream.height.ok_or("video height is unknown")?);
    let rotation =
        stream.side_data_list.iter().find_map(|side| side.rotation).or_else(|| stream.tags.get("rotate").and_then(|v| v.parse().ok())).unwrap_or(0.0);
    let quarter = (rotation / 90.0).round().rem_euclid(2.0) == 1.0;
    let mut pts: Vec<f64> = probed.packets.iter().filter_map(|packet| packet.pts_time.as_deref()?.parse().ok()).collect();
    pts.sort_by(f64::total_cmp);
    pts.dedup();
    if pts.is_empty() {
        return Err(format!("{}: video has no frames", path.display()));
    }
    Ok(if quarter { VideoInfo { width: height, height: width, pts } } else { VideoInfo { width, height, pts } })
}

/// The first audio sample's time, or `None` when the file has no audio stream.
pub fn audio_start(path: &std::path::Path) -> Result<Option<f64>, String> {
    let probed = probe(path, &["-select_streams", "a:0", "-show_entries", "stream=start_time"])?;
    Ok(probed.streams.first().map(|stream| stream.start_time.as_deref().and_then(|t| t.parse().ok()).unwrap_or(0.0)))
}
