//! The host's MP4 path through FFmpeg (OpenSpec p2-export task 3.2).
//!
//! Fixtures come from FFmpeg's own sources: a 12 fps video whose AAC track holds
//! one 0.5 impulse per second, and a WAV with the same impulses. The tests use
//! the production encoder `libopenh264` when this FFmpeg build has it, else
//! `libx264` (a local GPL build); the render-worker image always has
//! `libopenh264` (task 3.3).

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use maleo_render_host::ffmpeg;

const FPS: f64 = 30.0;

fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("ffmpeg-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn run_ffmpeg(args: &[&str]) {
    let status = Command::new(ffmpeg::ffmpeg()).args(["-v", "error", "-y"]).args(args).status().expect("ffmpeg");
    assert!(status.success(), "ffmpeg {args:?}");
}

/// `av.mp4` (2 s, 12 fps, AAC impulses at 0 and 1 s) and `impulses.wav` (2 s, impulses at 0 and 1 s).
fn fixtures(dir: &Path) -> (PathBuf, PathBuf) {
    let wav = dir.join("impulses.wav");
    run_ffmpeg(&["-f", "lavfi", "-i", "aevalsrc='if(lt(mod(n\\,48000)\\,1)\\,0.5\\,0)':s=48000:d=2", "-c:a", "pcm_s16le", wav.to_str().unwrap()]);
    let av = dir.join("av.mp4");
    run_ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=160x96:rate=12:duration=2",
        "-i",
        wav.to_str().unwrap(),
        "-c:v",
        "mpeg4",
        "-q:v",
        "3",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        av.to_str().unwrap(),
    ]);
    (av, wav)
}

fn encoder() -> &'static str {
    if ffmpeg::require_encoder("libopenh264").is_ok() { "libopenh264" } else { "libx264" }
}

fn host(job: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_maleo-render"));
    command.args(["render", "--job"]).arg(job).env("MALEO_RENDER_H264_ENCODER", encoder());
    command
}

fn write_job(dir: &Path, storyboard: serde_json::Value, media: serde_json::Value, frames: i64, size: (u32, u32)) -> (PathBuf, PathBuf) {
    let out = dir.join("out.mp4");
    let job = dir.join("job.json");
    fs::write(
        &job,
        serde_json::json!({"storyboard": storyboard, "media": media, "width": size.0, "height": size.1, "fps": FPS, "frames": frames, "out": out}).to_string(),
    )
    .unwrap();
    (job, out)
}

fn leftovers(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".partial") || n.contains(".audio.f32"))
        .collect()
}

fn video_frames(path: &Path) -> (u64, f64) {
    let out = Command::new(ffmpeg::ffprobe())
        .args(["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,duration", "-of", "json"])
        .arg(path)
        .output()
        .unwrap();
    let probed: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let stream = &probed["streams"][0];
    (stream["nb_read_frames"].as_str().unwrap().parse().unwrap(), stream["duration"].as_str().unwrap().parse().unwrap())
}

/// Times where |sample| first exceeds a quarter of the peak, at least 0.3 s apart.
fn onsets(path: &Path) -> Vec<f64> {
    let out = Command::new(ffmpeg::ffmpeg())
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"])
        .output()
        .unwrap();
    let samples: Vec<f32> = out.stdout.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
    let peak = samples.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let mut found: Vec<f64> = Vec::new();
    for (index, value) in samples.iter().enumerate() {
        let time = index as f64 / 48_000.0;
        if value.abs() > peak * 0.25 && found.last().is_none_or(|last| time - last > 0.3) {
            found.push(time);
        }
    }
    found
}

#[test]
fn a_real_media_export_has_every_frame_and_audio_on_time() {
    let dir = scratch("export");
    let (av, wav) = fixtures(&dir);
    let storyboard = serde_json::json!({
        "scenes": [],
        "videoOverlays": [{"url": "media/av.mp4", "kind": "video", "startSec": 0.5, "durationSec": 2, "volume": 1}],
        "audioOverlays": [{"url": "media/impulses.wav", "kind": "sfx", "startSec": 2.2, "durationSec": 0.5, "volume": 1}],
    });
    let media = serde_json::json!({"media/av.mp4": av, "media/impulses.wav": wav});
    let (job, out) = write_job(&dir, storyboard, media, 90, (320, 192));
    let run = host(&job).output().unwrap();
    assert_eq!(run.status.code(), Some(0), "{}\n{}", String::from_utf8_lossy(&run.stdout), String::from_utf8_lossy(&run.stderr));
    assert!(leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));
    let (frames, duration) = video_frames(&out);
    assert_eq!(frames, 90);
    assert!((duration - 3.0).abs() < 1e-3, "video duration {duration}");
    // Clip audio: impulses at 0.5 and 1.5 s. Sound effect: 2.2 s.
    let found = onsets(&out);
    eprintln!("onsets {found:?}, frames {frames}, duration {duration}, encoder {}", encoder());
    assert_eq!(found.len(), 3, "{found:?}");
    for (at, want) in found.iter().zip([0.5, 1.5, 2.2]) {
        assert!((at - want).abs() <= 1.0 / FPS, "onset {at} for {want}: {found:?}");
    }
    let lines: Vec<serde_json::Value> = String::from_utf8_lossy(&run.stdout).lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let phases: Vec<&str> = lines.iter().filter_map(|l| l["phase"].as_str()).collect();
    assert_eq!(phases.first(), Some(&"loading"));
    assert!(phases.contains(&"mixing") && phases.contains(&"finishing"), "{phases:?}");
    assert_eq!(phases.iter().filter(|p| **p == "rendering").count(), 90);
}

#[test]
fn sigterm_stops_within_five_seconds_and_leaves_nothing() {
    let dir = scratch("sigterm");
    let (job, out) = write_job(&dir, serde_json::json!({"scenes": [], "bgColor": "#203040"}), serde_json::json!({}), 3000, (1080, 1920));
    let mut child = host(&job).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    // Wait until frames are being encoded.
    for line in lines.by_ref() {
        if line.unwrap().contains(r#""phase":"rendering""#) {
            break;
        }
    }
    let asked = Instant::now();
    let status = Command::new("kill").args(["-TERM", &child.id().to_string()]).status().unwrap();
    assert!(status.success());
    let drain = std::thread::spawn(move || lines.map_while(Result::ok).collect::<Vec<_>>());
    let code = child.wait().unwrap().code();
    let stopped = asked.elapsed();
    let rest = drain.join().unwrap();
    eprintln!("stopped after {stopped:?}");
    assert_eq!(code, Some(143), "{rest:?}");
    assert!(stopped < Duration::from_secs(5), "stopped after {stopped:?}");
    assert!(rest.iter().any(|l| l.contains(r#""cancelled":true"#)), "{rest:?}");
    assert!(!out.exists() && leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));
}

#[test]
fn a_decoder_failure_exits_1_and_names_the_stage() {
    let dir = scratch("decode");
    let broken = dir.join("broken.mp4");
    fs::write(&broken, b"not a movie").unwrap();
    let storyboard =
        serde_json::json!({"scenes": [], "videoOverlays": [{"url": "media/broken.mp4", "kind": "video", "startSec": 0, "durationSec": 1, "volume": 0}]});
    let (job, out) = write_job(&dir, storyboard, serde_json::json!({"media/broken.mp4": broken}), 30, (320, 192));
    let run = host(&job).output().unwrap();
    assert_eq!(run.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert!(stdout.contains(r#""stage":"media""#) && stdout.contains("media/broken.mp4"), "{stdout}");
    assert!(!out.exists() && leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));
}

#[test]
fn a_missing_encoder_fails_before_rendering() {
    let dir = scratch("encoder");
    let (job, _) = write_job(&dir, serde_json::json!({"scenes": []}), serde_json::json!({}), 30, (320, 192));
    let run = host(&job).env("MALEO_RENDER_H264_ENCODER", "no-such-encoder").output().unwrap();
    assert_eq!(run.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert!(stdout.contains(r#""stage":"encoder""#) && !stdout.contains("rendering"), "{stdout}");
}
