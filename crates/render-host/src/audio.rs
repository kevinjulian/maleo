//! The export's audio track: the production Rust mix (OpenSpec p2-export E4).
//!
//! `audio_requests::project` places every source as preview and the browser
//! export do. FFmpeg decodes each source once to 48 kHz stereo f32; each output
//! block takes only the windows `pcm::requests` names, so the mixer keeps its
//! 16 MiB working-set budget. The mix is written as raw f32le for the encoder.

use std::collections::BTreeMap;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use maleo_media::audio::Mix;
use maleo_media::pcm::{self, Decoded, Format, Metadata, Window};
use maleo_renderer::audio_requests;
use maleo_renderer::storyboard::Storyboard;

use crate::ffmpeg;

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: u32 = 2;
const FORMAT: Format = Format { sample_rate: SAMPLE_RATE, channels: CHANNELS };
/// Output frames per mixer call: one second.
const BLOCK: u32 = SAMPLE_RATE;

/// A decoded source and the sample ranges one block reads from it.
type Spans<'a> = (&'a Source, Vec<(usize, usize)>);

struct Source {
    first_timestamp: f64,
    pcm: Vec<f32>,
}

fn decode(path: &Path) -> Result<Vec<f32>, String> {
    let out = Command::new(ffmpeg::ffmpeg())
        .args(["-v", "error", "-nostdin", "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-f", "f32le", "-ac", "2", "-ar", "48000", "pipe:1"])
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("{}: {e}", ffmpeg::ffmpeg()))?;
    if !out.status.success() {
        return Err(format!("{}: {}", path.display(), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out.stdout.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect())
}

/// The total number of output sample frames for `frames` video frames.
pub fn total_samples(fps: f64, frames: i64) -> u64 {
    (frames as f64 / fps * f64::from(SAMPLE_RATE)).round() as u64
}

/// Writes the whole mix to `out` as interleaved stereo f32le at 48 kHz.
pub fn mix_to_file(
    storyboard: &Storyboard,
    fps: f64,
    frames: i64,
    media: &BTreeMap<String, PathBuf>,
    out: &Path,
    cancelled: &dyn Fn() -> bool,
) -> Result<(), String> {
    let projected = audio_requests::project(storyboard, fps, frames)?;
    let mut decoded: BTreeMap<String, Option<Source>> = BTreeMap::new();
    for source in &projected.sources {
        if decoded.contains_key(&source.url) {
            continue;
        }
        let path = media.get(&source.url).ok_or_else(|| format!("{}: no local file", source.path))?;
        let entry = match ffmpeg::audio_start(path)? {
            // A video without sound adds nothing, as in the browser mixer.
            None if source.embedded => None,
            None => return Err(format!("{}: {} has no audio stream", source.path, path.display())),
            Some(first_timestamp) => Some(Source { first_timestamp, pcm: decode(path)? }),
        };
        decoded.insert(source.url.clone(), entry);
    }
    let mix = Mix { sources: projected.sources.into_iter().filter(|s| decoded.get(&s.url).is_some_and(Option::is_some)).collect(), ..projected };
    let held = |url: &str| decoded.get(url).and_then(Option::as_ref);
    let metadata: Vec<Metadata> = mix
        .sources
        .iter()
        .filter_map(|s| {
            let source = held(&s.url)?;
            Some(Metadata {
                path: s.path.clone(),
                sample_rate: SAMPLE_RATE,
                channels: CHANNELS,
                first_timestamp: source.first_timestamp,
                frames: source.pcm.len() as u64 / 2,
            })
        })
        .collect();
    let file = std::fs::File::create(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let mut writer = BufWriter::new(file);
    let total = total_samples(fps, frames);
    let mut output = vec![0.0f32; (BLOCK * CHANNELS) as usize];
    let mut start = 0u64;
    while start < total {
        if cancelled() {
            return Err("cancelled".into());
        }
        let count = BLOCK.min((total - start) as u32);
        let block = &mut output[..(count * CHANNELS) as usize];
        if mix.sources.is_empty() {
            block.fill(0.0);
        } else {
            let requests = pcm::requests(&mix, FORMAT, start, count, &metadata)?;
            // Sample ranges per source path, merged: the mixer refuses overlapping windows.
            let mut ranges: BTreeMap<&str, Spans<'_>> = BTreeMap::new();
            for request in &requests {
                let source = held(&request.url).ok_or_else(|| format!("{}: not decoded", request.path))?;
                let available = source.pcm.len() / 2;
                let from = (((request.start - source.first_timestamp) * f64::from(SAMPLE_RATE)).floor().max(0.0) as usize).min(available);
                let to = (((request.end - source.first_timestamp) * f64::from(SAMPLE_RATE)).ceil() as usize + 1).clamp(from, available);
                ranges.entry(request.path.as_str()).or_insert((source, Vec::new())).1.push((from, to));
            }
            let mut windows: BTreeMap<&str, Vec<Window<'_>>> = BTreeMap::new();
            for (path, (source, mut spans)) in ranges {
                spans.sort_unstable();
                let mut merged: Vec<(usize, usize)> = Vec::new();
                for (from, to) in spans {
                    match merged.last_mut() {
                        Some(last) if from <= last.1 => last.1 = last.1.max(to),
                        _ => merged.push((from, to)),
                    }
                }
                windows.insert(
                    path,
                    merged.into_iter().filter(|(f, t)| t > f).map(|(f, t)| Window { start: f as u64, data: &source.pcm[f * 2..t * 2] }).collect(),
                );
            }
            let sources: Vec<Decoded<'_>> = metadata
                .iter()
                .filter_map(|info| {
                    Some(Decoded {
                        path: &info.path,
                        format: FORMAT,
                        first_timestamp: info.first_timestamp,
                        frames: info.frames,
                        windows: windows.get(info.path.as_str())?,
                    })
                })
                .collect();
            pcm::mix_into(&mix, FORMAT, start, &sources, block)?;
        }
        for sample in block.iter() {
            writer.write_all(&sample.to_le_bytes()).map_err(|e| e.to_string())?;
        }
        start += u64::from(count);
    }
    writer.flush().map_err(|e| e.to_string())
}
