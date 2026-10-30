use maleo_media::audio::{Range, Source};
use maleo_renderer::{audio_requests, storyboard::Storyboard};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    storyboard: serde_json::Value,
    fps: f64,
    frames: i64,
    expected: Vec<Source>,
    voiceover_ranges: Vec<Range>,
    error: bool,
}

#[test]
fn audio_projection_matches_authoritative_document_and_render_mapping() {
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("fixtures/audio-projection.json")).unwrap();
    assert_eq!(fixtures.len(), 8);
    for fixture in fixtures {
        let storyboard = Storyboard::parse(&fixture.storyboard.to_string()).unwrap();
        let mix = audio_requests::project(&storyboard, fixture.fps, fixture.frames);
        if fixture.error {
            assert!(mix.unwrap_err().contains("audio source is unavailable"), "{}", fixture.name);
            continue;
        }
        let mut mix = mix.unwrap();
        mix.sources.sort_by(|a, b| a.url.cmp(&b.url).then(a.start_frame.cmp(&b.start_frame)));
        let mut expected = fixture.expected;
        expected.sort_by(|a, b| a.url.cmp(&b.url).then(a.start_frame.cmp(&b.start_frame)));
        for source in &mut mix.sources {
            source.path = "reference".into();
        }
        assert_eq!(serde_json::to_value(&mix.sources).unwrap(), serde_json::to_value(expected).unwrap(), "{}", fixture.name);
        if fixture.name == "all" {
            let music = mix.sources.iter().find(|source| source.url == "music-3.wav").unwrap();
            assert!((mix.gain(music, 90) - 0.7).abs() < 1e-12, "music continues through the narration gap");
            assert_eq!(mix.source_time(music, 90), 3.0, "the gap retains its timeline duration");
            for source in mix.sources.iter().filter(|source| source.kind == maleo_media::audio::Kind::Voiceover) {
                assert_eq!(mix.gain(source, 90), 0.0);
            }
        }
        assert_eq!(serde_json::to_value(mix.voiceover_ranges).unwrap(), serde_json::to_value(fixture.voiceover_ranges).unwrap(), "{}", fixture.name);
    }
}

#[test]
fn selected_endpoint_mutes_held_base_audio_while_overlay_audio_keeps_direct_video_timing() {
    let base = r#"{"scenes":[],"visualTimeline":[{"url":"a","kind":"video","startSec":0,"durationSec":0.5,"sourceDurationSec":0.5,"volume":0.5},{"url":"b","kind":"video","startSec":0.5,"durationSec":1,"transition":"fade","transitionDurSec":0.4,"volume":0.7}]}"#;
    let mix = audio_requests::project(&Storyboard::parse(base).unwrap(), 30.0, 60).unwrap();
    let first = mix.sources.iter().find(|source| source.url == "a").unwrap();
    assert_eq!(first.frames, 15);
    assert_eq!(mix.gain(first, 14), 0.5);
    assert_eq!(mix.gain(first, 15), 0.0);
    let overlay = base.replace("visualTimeline", "videoOverlays");
    let mix = audio_requests::project(&Storyboard::parse(&overlay).unwrap(), 30.0, 60).unwrap();
    let first = mix.sources.iter().find(|source| source.url == "a").unwrap();
    assert_eq!(first.frames, 27);
    assert_eq!(mix.gain(first, 15), 0.5);
}

#[test]
fn embedded_audio_inherits_volume_keys_and_legacy_sources_keep_production_branches() {
    let storyboard = Storyboard::parse(r#"{"scenes":[{"image":"","durationSec":2,"sfxUrl":"scene.wav","audioClips":[{"kind":"sfx","url":"legacy.wav","startSec":0.5,"durationSec":0.25}],"layout":{"animation":{"tracks":{"volume":[{"t":0,"v":0},{"t":1,"v":0.8}]}}},"visualClips":[{"url":"native.mp4","kind":"video","volume":0}]}],"voiceover":{"audioUrl":"voice.wav","startSec":0.5,"endSec":1.5},"musicUrl":"bed.wav"}"#).unwrap();
    let mix = audio_requests::project(&storyboard, 30.0, 60).unwrap();
    let native = mix.sources.iter().find(|source| source.embedded).unwrap();
    assert_eq!(mix.gain(native, 30), 0.8);
    assert_eq!(mix.sources.iter().filter(|source| source.url == "legacy.wav").count(), 2, "local and global legacy branches both remain audible in production");
    let music = mix.sources.iter().find(|source| source.url == "bed.wav").unwrap();
    assert!((mix.gain(music, 30) - 0.18).abs() < 1e-12);
}

#[test]
fn malformed_audio_options_fail_instead_of_silently_changing_the_mix() {
    for input in [
        r#"{"scenes":[],"muteBase":"true"}"#,
        r#"{"scenes":[],"audioOverlays":[{"kind":"music","url":"m","durationSec":1,"loopSource":"false"}]}"#,
        r#"{"scenes":[],"audioOverlays":[{"kind":"music","url":"m","durationSec":1,"animation":2}]}"#,
        r#"{"scenes":[],"audioOverlays":[{"kind":"music","url":"m","durationSec":1,"volume":-1}]}"#,
        r#"{"scenes":[],"audioOverlays":[{"kind":"music","url":"m","durationSec":1,"volume":0,"animation":{"tracks":{"volume":[{"t":0,"v":-1}]}}}]}"#,
        r#"{"scenes":[],"videoOverlays":[{"kind":"video","url":"v","durationSec":1,"volume":-1}]}"#,
        r#"{"scenes":[],"videoOverlays":[{"kind":"video","url":"v","durationSec":1,"volume":1,"layout":{"reverse":"false"}}]}"#,
    ] {
        let storyboard = Storyboard::parse(input).unwrap();
        assert!(audio_requests::project(&storyboard, 30.0, 60).is_err());
    }
}
