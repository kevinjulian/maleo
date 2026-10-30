use maleo_media::{
    audio::{GainMode, Mix},
    pcm::{self, Budget, Decoded, Format, PCM_BYTES, Window},
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    mix: Mix,
}
#[derive(Deserialize)]
struct GainFixture {
    mix: Mix,
    samples: Vec<GainSample>,
}
#[derive(Deserialize)]
struct GainSample {
    frame: i64,
    gain: f64,
}
fn mix() -> Mix {
    let mut mix = serde_json::from_str::<Vec<Fixture>>(include_str!("fixtures/audio-gain.json")).unwrap().remove(0).mix;
    mix.fps = 30.0;
    mix.frames = 300;
    mix.sources.truncate(1);
    let source = &mut mix.sources[0];
    source.start_frame = 0;
    source.frames = 300;
    source.media_start_sec = 0.0;
    source.playback_rate = 1.0;
    source.volume = 1.0;
    source.volume_keys.clear();
    source.gain_mode = GainMode::Native;
    source.loop_source = false;
    mix
}
const MONO: Format = Format { sample_rate: 48000, channels: 1 };

#[test]
fn planned_windows_cover_resampling_rates_loops_and_silent_gaps() {
    for input_rate in [44100, 48000] {
        for speed in [0.25, 1.0, 4.0] {
            for looping in [false, true] {
                let mut mix = mix();
                mix.sources[0].playback_rate = speed;
                mix.sources[0].media_start_sec = 0.1;
                mix.sources[0].loop_source = looping;
                let info = pcm::Metadata {
                    path: mix.sources[0].path.clone(),
                    sample_rate: input_rate,
                    channels: 1,
                    first_timestamp: 0.0,
                    frames: u64::from(input_rate),
                };
                let requests = pcm::requests(&mix, MONO, 32000, 48000, std::slice::from_ref(&info)).unwrap();
                let samples: Vec<Vec<f32>> = requests
                    .iter()
                    .map(|request| {
                        assert!(request.end > request.start && request.end - request.start <= 2.0);
                        let start = (request.start * f64::from(input_rate)).round() as u64;
                        let end = (request.end * f64::from(input_rate)).round() as u64;
                        (start..end).map(|sample| sample as f32 / input_rate as f32).collect()
                    })
                    .collect();
                let windows: Vec<_> = requests
                    .iter()
                    .zip(&samples)
                    .map(|(request, data)| Window { start: (request.start * f64::from(input_rate)).round() as u64, data })
                    .collect();
                let decoded = [Decoded {
                    path: &info.path,
                    format: Format { sample_rate: input_rate, channels: 1 },
                    first_timestamp: 0.0,
                    frames: info.frames,
                    windows: &windows,
                }];
                let mut output = vec![0.0; 48000];
                pcm::mix_into(&mix, MONO, 32000, &decoded, &mut output).unwrap();
                mix.sources[0].volume = 0.0;
                assert!(pcm::requests(&mix, MONO, 32000, 48000, &[]).unwrap().is_empty());
            }
        }
    }
}

#[test]
fn window_planning_rejects_missing_stale_or_malformed_metadata_without_silence() {
    let mix = mix();
    assert!(pcm::requests(&mix, MONO, 0, 128, &[]).unwrap_err().contains("missing metadata"));
    let info = pcm::Metadata { path: mix.sources[0].path.clone(), sample_rate: 48000, channels: 1, first_timestamp: 0.0, frames: 480000 };
    assert!(pcm::requests(&mix, MONO, 0, 128, &[info.clone(), info.clone()]).is_err());
    assert!(pcm::requests(&mix, MONO, 0, 128, &[pcm::Metadata { frames: 0, ..info }]).is_err());
    assert!(pcm::requests(&mix, MONO, u64::MAX, 128, &[]).is_err());
}

#[test]
fn float_pcm_applies_all_production_gain_fixtures_within_tolerance() {
    let fixtures: Vec<GainFixture> = serde_json::from_str(include_str!("fixtures/audio-gain.json")).unwrap();
    let data = [0.5f32; 4];
    for fixture in fixtures {
        let source = &fixture.mix.sources[0];
        for sample in fixture.samples {
            if sample.frame < 0 {
                continue;
            }
            let source_time = fixture.mix.source_time(source, sample.frame);
            let start = ((source_time * 48000.0).floor().max(0.0) as u64).saturating_sub(1);
            let windows = [Window { start, data: &data }];
            let sources = [Decoded { path: &source.path, format: MONO, first_timestamp: 0.0, frames: (start + 4).max(480000), windows: &windows }];
            let position = (sample.frame as f64 / fixture.mix.fps * 48000.0).round() as u64;
            let mut output = [0.0f32];
            pcm::mix_into(&fixture.mix, MONO, position, &sources, &mut output).unwrap();
            assert!((f64::from(output[0]) - sample.gain * 0.5).abs() <= 1e-5, "frame {} gain {} output {}", sample.frame, sample.gain, output[0]);
        }
    }
}

#[test]
fn reservations_include_copies_and_never_overcommit() {
    let mut budget = Budget::default();
    let a = budget.reserve(PCM_BYTES - 4).unwrap();
    let b = budget.reserve(4).unwrap();
    assert!(budget.reserve(1).is_err());
    assert!(budget.resize(b, 8).is_err());
    assert_eq!(budget.used(), PCM_BYTES);
    budget.resize(a, 4).unwrap();
    assert_eq!(budget.used(), 8);
    budget.release(b);
    budget.release(b);
    assert!(budget.resize(b, 1).is_err());
    budget.release(a);
    assert_eq!(budget.used(), 0);
    assert!(budget.reserve(0).is_err());
    assert!(MONO.block_bytes(96001).is_err());
    assert!(Format { channels: 3, ..MONO }.block_bytes(1).is_err());
}

#[test]
fn device_rate_resampling_crosses_windows_without_discontinuity() {
    let mix = mix();
    for input_rate in [44100, 48000] {
        // Linear ramp has an exact continuous reference independent of interpolation implementation.
        let data: Vec<f32> = (0..input_rate).map(|n| n as f32 / input_rate as f32).collect();
        let split = input_rate as usize / 3;
        let windows = [Window { start: 0, data: &data[..split] }, Window { start: split as u64, data: &data[split..] }];
        let sources = [Decoded {
            path: &mix.sources[0].path,
            format: Format { sample_rate: input_rate, channels: 1 },
            first_timestamp: 0.0,
            frames: data.len() as u64,
            windows: &windows,
        }];
        for output_rate in [44100, 48000] {
            let format = Format { sample_rate: output_rate, channels: 2 };
            let mut out = vec![0.0; output_rate as usize];
            pcm::mix_into(&mix, format, 0, &sources, &mut out).unwrap();
            for (n, frame) in out.as_chunks::<2>().0.iter().enumerate() {
                let reference = n as f64 / output_rate as f64;
                assert!((f64::from(frame[0]) - reference).abs() <= 1e-5);
                assert_eq!(frame[0], frame[1]);
            }
            let mut chunked = vec![0.0; out.len()];
            let chunk = 254;
            for (index, part) in chunked.chunks_mut(chunk).enumerate() {
                pcm::mix_into(&mix, format, (index * chunk / 2) as u64, &sources, part).unwrap();
            }
            assert_eq!(out, chunked);
        }
    }
}

#[test]
fn overlapping_sources_keep_float_headroom_and_speaker_conversion() {
    let mut mix = mix();
    let mut second = mix.sources[0].clone();
    second.path.push_str("/second");
    mix.sources.push(second);
    let data = [2.0, -0.5, -2.0, 0.5];
    let windows = [Window { start: 0, data: &data }];
    let sources: Vec<_> = mix
        .sources
        .iter()
        .map(|source| Decoded { path: &source.path, format: Format { channels: 2, ..MONO }, first_timestamp: 0.0, frames: 2, windows: &windows })
        .collect();
    let mut stereo = [0.0; 4];
    pcm::mix_into(&mix, Format { channels: 2, ..MONO }, 0, &sources, &mut stereo).unwrap();
    assert_eq!(stereo, [4.0, -1.0, -4.0, 1.0]);
    let mut mono = [0.0; 2];
    pcm::mix_into(&mix, MONO, 0, &sources, &mut mono).unwrap();
    assert_eq!(mono, [1.5, -1.5]);
}

#[test]
fn silence_is_distinct_from_missing_pcm_and_loop_wrap() {
    let mut mix = mix();
    let path = mix.sources[0].path.clone();
    let data = [0.25, 0.75];
    let windows = [Window { start: 0, data: &data }];
    let sources = [Decoded { path: &path, format: MONO, first_timestamp: 0.0, frames: 2, windows: &windows }];
    let mut out = [0.0; 4];
    pcm::mix_into(&mix, MONO, 0, &sources, &mut out).unwrap();
    assert_eq!(out, [0.25, 0.75, 0.0, 0.0]);
    mix.sources[0].loop_source = true;
    assert!(pcm::mix_into(&mix, MONO, 0, &sources, &mut out).unwrap_err().contains("loop duration"));
    assert!(pcm::mix_into(&mix, MONO, 0, &[], &mut out).unwrap_err().contains("buffering"));
    mix.sources[0].volume = 0.0;
    pcm::mix_into(&mix, MONO, 0, &[], &mut out).unwrap();
    assert_eq!(out, [0.0; 4]);
    mix.sources[0].volume = 1.0;
    mix.sources[0].start_frame = 30;
    pcm::mix_into(&mix, MONO, 0, &[], &mut out).unwrap();
    assert_eq!(out, [0.0; 4]);
}

#[test]
fn music_loops_restart_at_trimmed_inpoint_on_composition_frame_boundary() {
    let mut mix = mix();
    mix.sources[0].loop_source = true;
    mix.sources[0].media_start_sec = 1.0 / 30.0;
    let data: Vec<f32> = (0..4800).map(|n| n as f32 / 4800.0).collect();
    let windows = [Window { start: 0, data: &data }];
    let sources = [Decoded { path: &mix.sources[0].path, format: MONO, first_timestamp: 0.0, frames: 4800, windows: &windows }];
    let mut out = [0.0; 2];
    pcm::mix_into(&mix, MONO, 3199, &sources, &mut out).unwrap();
    assert!((out[0] - 4799.0 / 4800.0).abs() <= 1e-5);
    assert!((out[1] - 1600.0 / 4800.0).abs() <= 1e-5);
}

#[test]
fn malformed_or_incomplete_windows_fail_before_output_is_accepted() {
    let mix = mix();
    for data in [&[f32::NAN][..], &[1.0][..]] {
        let windows = [Window { start: 0, data }];
        let sources = [Decoded { path: &mix.sources[0].path, format: MONO, first_timestamp: 0.0, frames: 2, windows: &windows }];
        assert!(pcm::mix_into(&mix, MONO, 0, &sources, &mut [0.0; 2]).is_err());
    }
    assert!(pcm::mix_into(&mix, MONO, u64::MAX, &[], &mut [0.0; 2]).is_err());
}
