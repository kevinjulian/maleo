//! The host's frame path against the golden corpus (OpenSpec p2-export task 3.1).
//!
//! Each case renders every frame from 0 to its last compared frame through
//! `render_frames`, in order and double-buffered, as an export does. The
//! compared frames must meet the corpus thresholds (full frame and every listed
//! region) unchanged. Video cases supply the corpus's decoded samples, as the
//! golden gate does. The binary refuses an uncovered storyboard with exit 2
//! before it creates any output.

#[path = "../../renderer/tests/golden/compare.rs"]
#[allow(dead_code)]
mod compare;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use compare::Image;
use maleo_media::visual_pool::FrameIdentity;
use maleo_render_host::frames::{self, Output, RenderError, VideoSupply};
use maleo_renderer::frame::Renderer;
use maleo_renderer::storyboard::Storyboard;
use maleo_renderer::timeline::FPS;
use serde::Deserialize;

/// One or more cases per retained feature family, plus video and the combined project.
const CASES: &[&str] = &[
    "background-radial-ellipse",
    "caption-combined-a",
    "caption-highlight",
    "camera-preset-ken-burns",
    "transition-series-fade",
    "transition-absolute-wipe",
    "effect-flash",
    "effect-zoom_punch",
    "mask-feather-rotated-inverted",
    "blend-screen",
    "reveal-texture-ink",
    "decoration-label-entrance",
    "video-scene-transition",
    "video-overlay-mask-color",
    "composition-primitives",
    "shape-primitives-wide",
    "combined-project",
];

#[derive(Deserialize)]
struct Manifest {
    thresholds: Thresholds,
    #[serde(default)]
    lowered: BTreeMap<String, Lowered>,
}

#[derive(Deserialize, Clone, Copy)]
struct Thresholds {
    frame: f64,
    region: f64,
}

#[derive(Deserialize)]
struct Lowered {
    frame: Option<f64>,
    region: Option<f64>,
}

#[derive(Deserialize)]
struct CaseSpec {
    width: u32,
    height: u32,
    frames: Vec<i64>,
    #[serde(default)]
    regions: Vec<Region>,
    #[serde(default, rename = "videoFrames")]
    video_frames: Vec<VideoFrames>,
}

#[derive(Deserialize)]
struct Region {
    name: String,
    rect: [usize; 4],
}

#[derive(Deserialize)]
struct VideoFrames {
    url: String,
    revision: String,
    frames: Vec<VideoSample>,
}

#[derive(Deserialize)]
struct VideoSample {
    start: f64,
    end: f64,
    file: String,
}

fn corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../renderer/corpus")
}

fn read_image(path: &Path) -> Image {
    let decoded = image::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())).to_rgba8();
    Image { width: decoded.width() as usize, height: decoded.height() as usize, rgba: decoded.into_raw() }
}

/// The corpus's decoded presentation samples, selected as the golden gate selects them.
struct CorpusVideo<'a> {
    dir: &'a Path,
    sources: &'a [VideoFrames],
}

impl VideoSupply for CorpusVideo<'_> {
    fn supply(&mut self, renderer: &mut Renderer, storyboard: &Storyboard, frame: i64, fps: f64) -> Result<(), String> {
        for request in maleo_renderer::media_requests::video_requests(storyboard, frame, fps) {
            let time = request.time.ok_or("unsupported source time")?;
            let source = self.sources.iter().find(|source| source.url == request.url).ok_or("no video samples")?;
            let index = source
                .frames
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| (a.start - time).abs().total_cmp(&(b.start - time).abs()).then_with(|| b.start.total_cmp(&a.start)))
                .map(|(index, _)| index)
                .ok_or("no samples")?;
            let sample = &source.frames[index];
            let start = if index == 0 { 0.0 } else { (source.frames[index - 1].start + sample.start) / 2.0 };
            let end = source.frames.get(index + 1).map_or(sample.end, |next| (sample.start + next.start) / 2.0);
            let image = read_image(&self.dir.join(&sample.file));
            let identity = FrameIdentity {
                source_id: source.url.clone(),
                revision: source.revision.clone(),
                start,
                end,
                presentation: Some([sample.start, sample.end]),
                width: image.width as u32,
                height: image.height as u32,
            };
            renderer.put_video(&request, identity, image.rgba)?;
        }
        Ok(())
    }
}

#[test]
fn host_frames_meet_the_corpus_thresholds() {
    let manifest: Manifest = serde_json::from_str(&fs::read_to_string(corpus().join("manifest.json")).unwrap()).unwrap();
    let mut renderer = pollster::block_on(Renderer::new()).expect("renderer");
    let mut failures = Vec::new();
    for &name in CASES {
        let dir = corpus().join(name);
        let spec: CaseSpec = serde_json::from_str(&fs::read_to_string(dir.join("case.json")).unwrap()).unwrap();
        let storyboard = Storyboard::parse(&fs::read_to_string(dir.join("storyboard.json")).unwrap()).unwrap();
        let videos: Vec<&str> = spec.video_frames.iter().map(|v| v.url.as_str()).collect();
        let media: BTreeMap<String, PathBuf> = fs::read_dir(dir.join("media"))
            .map(|entries| {
                entries
                    .map(|e| e.unwrap().path())
                    .map(|p| (format!("media/{}", p.file_name().unwrap().to_string_lossy()), p))
                    .filter(|(url, _)| !videos.contains(&url.as_str()))
                    .collect()
            })
            .unwrap_or_default();
        frames::load_images(&mut renderer, &media).expect("images");
        let lowered = manifest.lowered.get(name);
        let frame_min = lowered.and_then(|l| l.frame).unwrap_or(manifest.thresholds.frame);
        let region_min = lowered.and_then(|l| l.region).unwrap_or(manifest.thresholds.region);
        let last = *spec.frames.iter().max().unwrap();
        // Timing as the golden gate draws it: the storyboard's own composition length.
        let duration = maleo_renderer::timeline::composition_frames(&storyboard, FPS);
        let output = Output { width: spec.width, height: spec.height, fps: FPS, frames: last + 1, duration };
        let mut seen = 0;
        let mut video = CorpusVideo { dir: &dir, sources: &spec.video_frames };
        let result = frames::render_frames(&mut renderer, &storyboard, &output, &mut video, &|| false, &mut |frame, rgba| {
            assert_eq!(frame, seen, "frames arrive in order");
            seen += 1;
            if !spec.frames.contains(&frame) {
                return Ok(());
            }
            let actual = Image { width: spec.width as usize, height: spec.height as usize, rgba: rgba.to_vec() };
            let expected = read_image(&dir.join("reference").join(format!("{frame}.png")));
            let whole = compare::ssim(&expected, &actual);
            if whole < frame_min {
                failures.push(format!("{name} frame {frame}: frame SSIM {whole:.4} < {frame_min}"));
            }
            for region in &spec.regions {
                let score = compare::ssim(&expected.crop(region.rect), &actual.crop(region.rect));
                if score < region_min {
                    failures.push(format!("{name} frame {frame}: region {} SSIM {score:.4} < {region_min}", region.name));
                }
            }
            Ok(())
        });
        assert_eq!(result, Ok(()), "{name}");
        assert_eq!(seen, last + 1, "{name}: every frame reached the sink");
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn an_uncovered_frame_stops_the_run_before_the_sink() {
    let storyboard = Storyboard::parse(
        r#"{"scenes":[{"image":"a.png","durationSec":2,"transition":"cut"}],"textOverlays":[{"content":"t","preset":"lower-third","startSec":1,"durationSec":0.2}]}"#,
    )
    .unwrap();
    let mut renderer = pollster::block_on(Renderer::new()).unwrap();
    let mut delivered = Vec::new();
    let output = Output { width: 64, height: 64, fps: FPS, frames: 60, duration: 60 };
    let result = frames::render_frames(&mut renderer, &storyboard, &output, &mut frames::NoVideo, &|| false, &mut |frame, _| {
        delivered.push(frame);
        Ok(())
    });
    // a.png is not supplied, so frame 0 already reports missing media.
    match result {
        Err(RenderError::Coverage { frame, entries }) => {
            assert_eq!(frame, 0);
            assert!(entries.iter().any(|e| e.reason == "missing media"), "{entries:?}");
        }
        other => panic!("{other:?}"),
    }
    assert!(delivered.is_empty(), "no frame of a refused run reaches the sink");
}

#[test]
fn cancellation_stops_before_the_next_frame() {
    let storyboard = Storyboard::parse(r##"{"scenes":[],"bgColor":"#102030"}"##).unwrap();
    let mut renderer = pollster::block_on(Renderer::new()).unwrap();
    let delivered = std::cell::Cell::new(0);
    let output = Output { width: 32, height: 32, fps: FPS, frames: 30, duration: 30 };
    let result = frames::render_frames(&mut renderer, &storyboard, &output, &mut frames::NoVideo, &|| delivered.get() >= 3, &mut |_, _| {
        delivered.set(delivered.get() + 1);
        Ok(())
    });
    assert_eq!(result, Err(RenderError::Cancelled));
    assert!(delivered.get() <= 4, "stopped within one frame of the request: {}", delivered.get());
}

fn job_file(dir: &Path, storyboard: serde_json::Value, out: &Path, frames: i64) -> PathBuf {
    let path = dir.join("job.json");
    fs::write(&path, serde_json::json!({"storyboard": storyboard, "width": 32, "height": 32, "fps": 30, "frames": frames, "out": out}).to_string()).unwrap();
    path
}

fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn the_binary_refuses_an_uncovered_storyboard_with_exit_2_and_no_output() {
    let dir = scratch("refuse");
    let out = dir.join("out.rgba");
    let job =
        job_file(&dir, serde_json::json!({"scenes":[],"textOverlays":[{"content":"t","preset":"lower-third","startSec":0.5,"durationSec":0.2}]}), &out, 30);
    let run = Command::new(env!("CARGO_BIN_EXE_maleo-render")).args(["render", "--job"]).arg(&job).output().unwrap();
    assert_eq!(run.status.code(), Some(2), "{}", String::from_utf8_lossy(&run.stderr));
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert!(stdout.contains(r#""refused":"frame 15 cannot be exported: textOverlays[0] `lower-third` preset""#), "{stdout}");
    assert!(!out.exists() && !dir.join("out.rgba.partial").exists());
}

#[test]
fn the_binary_writes_every_frame_and_reports_progress() {
    let dir = scratch("render");
    let out = dir.join("out.rgba");
    let job = job_file(&dir, serde_json::json!({"scenes":[],"bgColor":"#102030"}), &out, 12);
    let run = Command::new(env!("CARGO_BIN_EXE_maleo-render")).args(["render", "--format", "rgba", "--job"]).arg(&job).output().unwrap();
    assert_eq!(run.status.code(), Some(0), "{}", String::from_utf8_lossy(&run.stderr));
    assert_eq!(fs::metadata(&out).unwrap().len(), 12 * 32 * 32 * 4);
    let lines: Vec<serde_json::Value> = String::from_utf8_lossy(&run.stdout).lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines.first().unwrap()["phase"], "loading");
    assert_eq!(lines.iter().filter(|l| l["phase"] == "rendering").count(), 12);
    assert_eq!(lines.last().unwrap(), &serde_json::json!({"done": true, "frames": 12}));
}

#[test]
fn the_binary_reports_a_bad_job_as_a_failure() {
    let dir = scratch("bad");
    let path = dir.join("job.json");
    fs::write(&path, r#"{"storyboard":{},"width":33,"height":32,"fps":30,"frames":1,"out":"o"}"#).unwrap();
    let run = Command::new(env!("CARGO_BIN_EXE_maleo-render")).args(["render", "--job"]).arg(&path).output().unwrap();
    assert_eq!(run.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&run.stdout).contains(r#""stage":"job""#));
}
