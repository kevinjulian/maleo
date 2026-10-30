use maleo_media::audio::Mix;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    mix: Mix,
    samples: Vec<Sample>,
}
#[derive(Deserialize)]
struct Sample {
    frame: i64,
    gain: f64,
    time: f64,
}

#[test]
fn production_gain_and_timing_match_shared_fixtures() {
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("fixtures/audio-gain.json")).unwrap();
    assert_eq!(fixtures.len(), 111);
    for fixture in fixtures {
        fixture.mix.validate().unwrap();
        let source = &fixture.mix.sources[0];
        for sample in fixture.samples {
            let actual = fixture.mix.gain(source, sample.frame);
            assert!((actual - sample.gain).abs() <= 1e-12, "{:?} {:?} frame {}: {actual} != {}", source.kind, source.gain_mode, sample.frame, sample.gain);
            assert!((fixture.mix.source_time(source, sample.frame) - sample.time).abs() <= 1e-12);
        }
    }
}

#[test]
fn malformed_audio_inputs_fail_before_sampling() {
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("fixtures/audio-gain.json")).unwrap();
    let original = fixtures.into_iter().find(|fixture| !fixture.mix.voiceover_ranges.is_empty()).unwrap().mix;
    for index in 0..6 {
        let mut mix = original.clone();
        match index {
            0 => mix.fps = f64::NAN,
            1 => mix.sources[0].frames = 0,
            2 => mix.sources[0].volume_keys[0].v = f64::INFINITY,
            3 => mix.sources[0].volume_keys[1].t = -1.0,
            4 => mix.voiceover_ranges[0].end_sec = 0.0,
            _ => mix.sources.push(mix.sources[0].clone()),
        }
        assert!(mix.validate().is_err());
    }
}
