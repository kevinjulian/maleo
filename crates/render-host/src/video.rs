//! Video frames from FFmpeg for the frame loop (OpenSpec p2-export E4).
//!
//! Each placement gets its own decoder: FFmpeg writes every frame of the
//! source as raw RGBA, in presentation order, and the decoder reads forward to
//! the frame the renderer asks for. The frame is the one whose presentation
//! time is nearest the requested source time, with ties going to the later
//! frame (`crates/renderer/AGENTS.md`). A request earlier than the current
//! frame starts a new process that seeks to it.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};

use maleo_media::visual_pool::FrameIdentity;
use maleo_renderer::frame::Renderer;
use maleo_renderer::media_requests::video_requests;
use maleo_renderer::storyboard::Storyboard;

use crate::ffmpeg::{self, VideoInfo};
use crate::frames::VideoSupply;

/// The sample nearest `time`, ties to the later one.
pub fn nearest(pts: &[f64], time: f64) -> usize {
    let mut best = 0;
    for (index, &at) in pts.iter().enumerate() {
        let (d, b) = ((at - time).abs(), (pts[best] - time).abs());
        if d < b || (d == b && at > pts[best]) {
            best = index;
        }
    }
    best
}

/// The selection window and presentation interval of sample `index`.
pub fn identity(url: &str, revision: &str, info: &VideoInfo, index: usize) -> FrameIdentity {
    let pts = &info.pts;
    let at = pts[index];
    let start = if index == 0 { 0.0 } else { (pts[index - 1] + at) / 2.0 };
    let step = if index + 1 < pts.len() {
        pts[index + 1] - at
    } else if index > 0 {
        at - pts[index - 1]
    } else {
        1.0 / 30.0
    };
    let end = pts.get(index + 1).map_or(at + step, |next| (at + next) / 2.0);
    FrameIdentity {
        source_id: url.to_owned(),
        revision: revision.to_owned(),
        start: start.min(at),
        end,
        presentation: Some([at, at + step]),
        width: info.width,
        height: info.height,
    }
}

struct Decoder {
    child: Child,
    stdout: ChildStdout,
    /// The sample index the next read returns.
    next: usize,
    frame: Vec<u8>,
    /// The index `frame` holds, once read.
    held: Option<usize>,
}

impl Decoder {
    fn start(path: &std::path::Path, info: &VideoInfo, from: usize) -> Result<Self, String> {
        let mut command = Command::new(ffmpeg::ffmpeg());
        command.args(["-v", "error", "-nostdin"]);
        if from > 0 {
            // Input seek, accurate: output starts at the first frame at or after this time.
            command.arg("-ss").arg(format!("{:.6}", (info.pts[from] - 0.0005).max(0.0)));
        }
        command.arg("-i").arg(path).args(["-map", "0:v:0", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
        let mut child = command.stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("{}: {e}", ffmpeg::ffmpeg()))?;
        let stdout = child.stdout.take().ok_or("decoder has no output")?;
        Ok(Self { child, stdout, next: from, frame: vec![0; (info.width * info.height * 4) as usize], held: None })
    }

    /// Whether reading forward can return `index`.
    fn reaches(&self, index: usize) -> bool {
        self.held == Some(index) || index >= self.next
    }

    fn read_to(&mut self, index: usize) -> Result<(), String> {
        while self.held != Some(index) {
            self.stdout.read_exact(&mut self.frame).map_err(|e| format!("decoder ended before frame {index}: {e}"))?;
            self.held = Some(self.next);
            self.next += 1;
        }
        Ok(())
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Supplies requested video frames from local files through FFmpeg.
pub struct FfmpegVideo {
    files: BTreeMap<String, PathBuf>,
    infos: BTreeMap<String, VideoInfo>,
    decoders: BTreeMap<String, Decoder>,
}

impl FfmpegVideo {
    pub fn new(media: &BTreeMap<String, PathBuf>) -> Self {
        Self { files: media.clone(), infos: BTreeMap::new(), decoders: BTreeMap::new() }
    }

    fn info(&mut self, url: &str) -> Result<&VideoInfo, String> {
        if !self.infos.contains_key(url) {
            let path = self.files.get(url).ok_or_else(|| format!("{url}: no local file"))?;
            let info = ffmpeg::video_info(path).map_err(|e| format!("{url}: {e}"))?;
            self.infos.insert(url.to_owned(), info);
        }
        self.infos.get(url).ok_or_else(|| format!("{url}: no video info"))
    }
}

impl VideoSupply for FfmpegVideo {
    fn supply(&mut self, renderer: &mut Renderer, storyboard: &Storyboard, frame: i64, fps: f64) -> Result<(), String> {
        for request in video_requests(storyboard, frame, fps) {
            let Some(time) = request.time.filter(|_| request.blocker.is_none()) else { continue };
            let index = nearest(&self.info(&request.url)?.pts, time);
            let path = self.files.get(&request.url).cloned().ok_or_else(|| format!("{}: no local file", request.url))?;
            let info = self.infos.get(&request.url).ok_or("no video info")?;
            if !self.decoders.get(&request.path).is_some_and(|d| d.reaches(index)) {
                self.decoders.insert(request.path.clone(), Decoder::start(&path, info, index)?);
            }
            let decoder = self.decoders.get_mut(&request.path).ok_or("no decoder")?;
            decoder.read_to(index).map_err(|e| format!("{}: {e}", request.url))?;
            let identity = identity(&request.url, "local", info, index);
            renderer.put_video(&request, identity, decoder.frame.clone())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_prefers_the_later_frame_on_a_tie() {
        let pts = [0.0, 1.0 / 12.0, 2.0 / 12.0];
        assert_eq!(nearest(&pts, 0.0), 0);
        assert_eq!(nearest(&pts, 1.0 / 24.0), 1);
        assert_eq!(nearest(&pts, 0.07), 1);
        assert_eq!(nearest(&pts, 9.0), 2);
        assert_eq!(nearest(&pts, -1.0), 0);
    }

    #[test]
    fn identity_windows_meet_at_midpoints() {
        let info = VideoInfo { width: 4, height: 2, pts: vec![0.0, 0.1, 0.3] };
        let first = identity("u", "r", &info, 0);
        let middle = identity("u", "r", &info, 1);
        assert_eq!((first.start, first.end), (0.0, 0.05));
        assert!((middle.start - 0.05).abs() < 1e-12 && (middle.end - 0.2).abs() < 1e-12);
        assert_eq!(middle.presentation.map(|p| p[0]), Some(0.1));
    }
}
