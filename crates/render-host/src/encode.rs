//! H.264 + AAC MP4 through one FFmpeg process (OpenSpec p2-export E4, E5).
//!
//! Video arrives on stdin as raw RGB: each straight-alpha frame is
//! premultiplied over black first, the backdrop an opaque player shows. Audio
//! is the mixed f32le file. The MP4 gets `+faststart`; FFmpeg's muxer writes
//! the AAC encoder's priming as the sound track's edit list.

use std::io::{BufWriter, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};

use crate::audio::{CHANNELS, SAMPLE_RATE};
use crate::ffmpeg;

pub const AUDIO_BITRATE: u32 = 192_000;

/// 8 Mbit/s at 1080p, scaled by pixel count, at least 0.5 Mbit/s (E5; the browser export's rule).
pub fn video_bitrate(width: u32, height: u32) -> u32 {
    ((8_000_000.0 * f64::from(width) * f64::from(height) / (1920.0 * 1080.0)).round() as u32).max(500_000)
}

/// Straight-alpha RGBA over black, as tightly packed RGB.
pub fn flatten(rgba: &[u8], rgb: &mut Vec<u8>) {
    rgb.clear();
    for pixel in rgba.as_chunks::<4>().0 {
        let alpha = u32::from(pixel[3]);
        for &channel in &pixel[..3] {
            rgb.push(((u32::from(channel) * alpha + 127) / 255) as u8);
        }
    }
}

pub struct Encoder {
    child: Option<Child>,
    stdin: Option<BufWriter<ChildStdin>>,
    rgb: Vec<u8>,
}

pub struct EncodeSettings<'a> {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub frames: i64,
    pub encoder: &'a str,
    pub audio: &'a Path,
    pub out: &'a Path,
}

impl Encoder {
    pub fn start(settings: &EncodeSettings<'_>) -> Result<Self, String> {
        let EncodeSettings { width, height, fps, frames, encoder, audio, out } = *settings;
        let gop = (fps * 2.0).round().max(1.0) as u32;
        let mut command = Command::new(ffmpeg::ffmpeg());
        command
            .args(["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s"])
            .arg(format!("{width}x{height}"))
            .arg("-framerate")
            .arg(format!("{fps}"))
            .args(["-i", "pipe:0", "-f", "f32le", "-ar"])
            .arg(SAMPLE_RATE.to_string())
            .arg("-ac")
            .arg(CHANNELS.to_string())
            .arg("-i")
            .arg(audio)
            .args(["-map", "0:v:0", "-map", "1:a:0", "-c:v", encoder, "-b:v"])
            .arg(video_bitrate(width, height).to_string())
            .arg("-g")
            .arg(gop.to_string())
            .args(["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a"])
            .arg(AUDIO_BITRATE.to_string())
            .arg("-t")
            .arg(format!("{:.6}", frames as f64 / fps))
            .args(["-movflags", "+faststart", "-f", "mp4"])
            .arg(out);
        let mut child = command.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| format!("{}: {e}", ffmpeg::ffmpeg()))?;
        let stdin = child.stdin.take().map(|pipe| BufWriter::with_capacity(1 << 20, pipe));
        Ok(Self { child: Some(child), stdin, rgb: Vec::with_capacity((width * height * 3) as usize) })
    }

    pub fn frame(&mut self, rgba: &[u8]) -> Result<(), String> {
        flatten(rgba, &mut self.rgb);
        let stdin = self.stdin.as_mut().ok_or("encoder input is closed")?;
        stdin.write_all(&self.rgb).map_err(|e| format!("encoder stopped reading: {e}"))
    }

    /// Closes the input and waits for the file.
    pub fn finish(mut self) -> Result<(), String> {
        if let Some(mut stdin) = self.stdin.take() {
            stdin.flush().map_err(|e| format!("encoder input: {e}"))?;
        }
        let child = self.child.take().ok_or("encoder already finished")?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if output.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&output.stderr).trim().to_owned()) }
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        self.stdin.take();
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flatten_premultiplies_over_black() {
        let mut rgb = Vec::new();
        flatten(&[255, 128, 0, 255, 255, 255, 255, 0, 200, 100, 50, 128], &mut rgb);
        assert_eq!(rgb, [255, 128, 0, 0, 0, 0, 100, 50, 25]);
    }

    #[test]
    fn bitrate_scales_by_pixel_count() {
        assert_eq!(video_bitrate(1080, 1920), 8_000_000);
        assert_eq!(video_bitrate(3840, 2160), 32_000_000);
        assert_eq!(video_bitrate(160, 90), 500_000);
    }
}
