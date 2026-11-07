//! `maleo-render`: the server render host (OpenSpec p2-export E4).
//!
//! ```text
//! maleo-render render   --job job.json [--format mp4|rgba]
//! maleo-render coverage --job job.json
//! maleo-render media    --job job.json
//! maleo-render plan     --job job.json
//! maleo-render compare-frames --reference dir --candidate dir --difference dir --below 0.97
//! ```
//!
//! `plan` and `compare-frames` serve the worker's production comparison
//! (`compare.rs`); each prints one JSON value.
//!
//! `render` refuses a storyboard with any coverage problem before it draws a
//! frame (exit 2). Then it mixes the audio, draws every frame with video from
//! FFmpeg, and encodes H.264 + AAC MP4 (`--format rgba` writes the raw
//! straight-alpha frames instead). Progress and results go to stdout as JSON
//! lines (`progress.rs`); diagnostics go to stderr. The output appears at `out`
//! only when the run succeeds; SIGTERM stops it within one frame and removes
//! every partial file (exit 143).

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use maleo_render_host::cancel::Cancel;
use maleo_render_host::encode::{EncodeSettings, Encoder};
use maleo_render_host::frames::{self, Output, RenderError};
use maleo_render_host::job::Job;
use maleo_render_host::progress::{self, Event};
use maleo_render_host::video::FfmpegVideo;
use maleo_render_host::{audio, ffmpeg};
use maleo_renderer::coverage;
use maleo_renderer::frame::Renderer;
use maleo_renderer::storyboard::Storyboard;

struct Args {
    command: String,
    flags: std::collections::HashMap<String, String>,
}

impl Args {
    fn path(&self, flag: &str) -> Result<PathBuf, String> {
        self.flags.get(flag).map(PathBuf::from).ok_or_else(|| format!("{flag} is required"))
    }
}

fn args() -> Result<Args, String> {
    let mut argv = std::env::args().skip(1);
    let command = argv.next().ok_or("usage: maleo-render <render|coverage|media|plan|compare-frames> --job <job.json> [--format mp4|rgba]")?;
    let mut flags = std::collections::HashMap::new();
    while let Some(flag) = argv.next() {
        let value = argv.next().ok_or_else(|| format!("{flag} needs a value"))?;
        if !["--job", "--format", "--reference", "--candidate", "--difference", "--below"].contains(&flag.as_str()) {
            return Err(format!("unknown flag {flag}"));
        }
        flags.insert(flag, value);
    }
    Ok(Args { command, flags })
}

fn compare_frames(args: &Args) -> ExitCode {
    let paths = (args.path("--reference"), args.path("--candidate"), args.path("--difference"));
    let (Ok(reference), Ok(candidate), Ok(differences)) = paths else {
        return fail("arguments", "compare-frames needs --reference, --candidate and --difference".into());
    };
    let Some(below) = args.flags.get("--below").and_then(|v| v.parse::<f64>().ok()) else {
        return fail("arguments", "compare-frames needs a numeric --below".into());
    };
    match maleo_render_host::compare::compare_dirs(&reference, &candidate, &differences, below) {
        Ok(scores) => {
            println!("{}", serde_json::to_string(&scores).unwrap_or_else(|_| "[]".into()));
            exit(progress::EXIT_OK)
        }
        Err(message) => fail("compare", message),
    }
}

fn exit(code: i32) -> ExitCode {
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}

fn fail(stage: &'static str, message: String) -> ExitCode {
    eprintln!("maleo-render: {stage}: {message}");
    progress::emit(&Event::Failed { failed: format!("{stage}: {message}"), stage });
    exit(progress::EXIT_FAILED)
}

fn sibling(out: &Path, suffix: &str) -> PathBuf {
    let mut name = out.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Files a run creates beside `out`; every one is removed unless the run succeeds.
struct Scratch(Vec<PathBuf>);

impl Drop for Scratch {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn main() -> ExitCode {
    let args = match args() {
        Ok(args) => args,
        Err(message) => return fail("arguments", message),
    };
    if args.command == "compare-frames" {
        return compare_frames(&args);
    }
    let job = match args.path("--job").and_then(|path| Job::read(&path)) {
        Ok(job) => job,
        Err(message) => return fail("job", message),
    };
    let storyboard = match Storyboard::parse(&job.storyboard.to_string()) {
        Ok(storyboard) => storyboard,
        Err(error) => return fail("storyboard", error.0),
    };
    if args.command == "media" {
        return match maleo_render_host::inputs::media_urls(&storyboard, job.fps, job.frames) {
            Ok(urls) => {
                println!("{}", serde_json::to_string(&urls).unwrap_or_else(|_| "[]".into()));
                exit(progress::EXIT_OK)
            }
            Err(message) => fail("storyboard", message),
        };
    }
    if args.command == "plan" {
        return match maleo_render_host::compare::plan(&storyboard, job.fps, job.frames) {
            Ok(plan) => {
                println!("{}", serde_json::to_string(&plan).unwrap_or_else(|_| "{}".into()));
                exit(progress::EXIT_OK)
            }
            Err(message) => fail("storyboard", message),
        };
    }
    let problems = coverage::project(&storyboard, job.fps, job.frames);
    if args.command == "coverage" {
        println!("{}", serde_json::to_string(&problems).unwrap_or_else(|_| "[]".into()));
        return exit(progress::EXIT_OK);
    }
    if args.command != "render" {
        return fail("arguments", format!("unknown command {}", args.command));
    }
    if let Some(first) = problems.first() {
        let refused = format!("frame {} cannot be exported: {} {}", first.frame, first.path, first.reason);
        eprintln!("maleo-render: {refused}");
        progress::emit(&Event::Refused { refused, coverage: serde_json::to_value(&problems).unwrap_or_default() });
        return exit(progress::EXIT_REFUSED);
    }
    let mp4 = match args.flags.get("--format").map_or("mp4", String::as_str) {
        "mp4" => true,
        "rgba" => false,
        other => return fail("arguments", format!("unsupported format {other}")),
    };
    let encoder = ffmpeg::h264_encoder();
    if mp4 && let Err(message) = ffmpeg::require_encoder(&encoder) {
        return fail("encoder", message);
    }
    let cancel = match Cancel::on_signals() {
        Ok(cancel) => cancel,
        Err(message) => return fail("signals", message),
    };
    progress::emit(&Event::Phase { phase: "loading" });
    let mut renderer = match pollster::block_on(Renderer::new()) {
        Ok(renderer) => renderer,
        Err(message) => return fail("gpu", message),
    };
    if let Err(error) = frames::load_images(&mut renderer, &storyboard, job.fps, job.frames, &job.media) {
        return fail("media", error.to_string());
    }
    let partial = sibling(&job.out, ".partial");
    let mut scratch = Scratch(vec![partial.clone()]);
    let result = if mp4 {
        render_mp4(&mut renderer, &storyboard, &job, &encoder, &partial, &cancel, &mut scratch)
    } else {
        render_raw(&mut renderer, &storyboard, &job, &partial, &cancel)
    };
    match result {
        Ok(()) => match std::fs::rename(&partial, &job.out) {
            Ok(()) => {
                progress::emit(&Event::Done { done: true, frames: job.frames });
                exit(progress::EXIT_OK)
            }
            Err(e) => fail("output", format!("{}: {e}", job.out.display())),
        },
        Err(error) => {
            drop(scratch);
            match error {
                RenderError::Cancelled => {
                    progress::emit(&Event::Cancelled { cancelled: true });
                    exit(progress::EXIT_CANCELLED)
                }
                RenderError::Coverage { .. } => {
                    progress::emit(&Event::Refused { refused: error.to_string(), coverage: serde_json::Value::Null });
                    exit(progress::EXIT_REFUSED)
                }
                RenderError::Failed { stage, message } => fail(stage, message),
            }
        }
    }
}

fn render_mp4(
    renderer: &mut Renderer,
    storyboard: &Storyboard,
    job: &Job,
    encoder: &str,
    partial: &Path,
    cancel: &Cancel,
    scratch: &mut Scratch,
) -> Result<(), RenderError> {
    progress::emit(&Event::Phase { phase: "mixing" });
    let mix = sibling(&job.out, ".audio.f32");
    scratch.0.push(mix.clone());
    audio::mix_to_file(storyboard, job.fps, job.frames, &job.media, &mix, &|| cancel.requested())
        .map_err(|message| if cancel.requested() { RenderError::Cancelled } else { RenderError::Failed { stage: "audio", message } })?;
    let settings = EncodeSettings { width: job.width, height: job.height, fps: job.fps, frames: job.frames, encoder, audio: &mix, out: partial };
    let mut encoding = Encoder::start(&settings).map_err(|message| RenderError::Failed { stage: "encode", message })?;
    let output = Output { width: job.width, height: job.height, fps: job.fps, frames: job.frames, duration: job.frames };
    let frames = job.frames;
    let mut video = FfmpegVideo::new(&job.media);
    frames::render_frames(renderer, storyboard, &output, &mut video, &|| cancel.requested(), &mut |frame, rgba| {
        encoding.frame(rgba).map_err(|message| RenderError::Failed { stage: "encode", message })?;
        progress::emit(&Event::Frame { phase: "rendering", frame: frame + 1, frames });
        Ok(())
    })?;
    progress::emit(&Event::Phase { phase: "finishing" });
    encoding.finish().map_err(|message| RenderError::Failed { stage: "encode", message })?;
    // The finished file is the only scratch file that survives.
    scratch.0.retain(|path| path != partial);
    Ok(())
}

fn render_raw(renderer: &mut Renderer, storyboard: &Storyboard, job: &Job, path: &Path, cancel: &Cancel) -> Result<(), RenderError> {
    let file = File::create(path).map_err(|e| RenderError::Failed { stage: "output", message: format!("{}: {e}", path.display()) })?;
    let mut writer = BufWriter::new(file);
    let output = Output { width: job.width, height: job.height, fps: job.fps, frames: job.frames, duration: job.frames };
    let frames = job.frames;
    let mut video = FfmpegVideo::new(&job.media);
    frames::render_frames(renderer, storyboard, &output, &mut video, &|| cancel.requested(), &mut |frame, rgba| {
        writer.write_all(rgba).map_err(|e| RenderError::Failed { stage: "output", message: e.to_string() })?;
        progress::emit(&Event::Frame { phase: "rendering", frame: frame + 1, frames });
        Ok(())
    })?;
    writer.flush().map_err(|e| RenderError::Failed { stage: "output", message: e.to_string() })
}
