use maleo_media::readiness::{Clip, Completion, Dependencies, Kind, Readiness, Source, State};

fn dependencies() -> Dependencies {
    Dependencies {
        sources: vec![Source {
            id: "source".into(),
            revision: "r1".into(),
            url: "/source.mp4".into(),
            kinds: vec![Kind::Video],
            clip_ids: vec!["video".into(), "muted".into()],
        }],
        clips: vec![
            Clip { id: "video".into(), source_ids: vec!["source".into()], blockers: vec![] },
            Clip { id: "muted".into(), source_ids: vec!["source".into()], blockers: vec![] },
            Clip { id: "text".into(), source_ids: vec![], blockers: vec![] },
        ],
    }
}

fn ready() -> Completion {
    Completion::Ready { eof: true, readable: true, bytes: 100, expected: Some(100), validated: true, decoded: true }
}

#[test]
fn shared_sources_aggregate_for_every_clip_and_media_free_clips_are_ready() {
    let mut media = Readiness::default();
    let snapshot = media.update(dependencies()).unwrap();
    assert!(!snapshot.ready);
    assert_eq!(snapshot.clips[2].state, State::Ready);
    let request = media.requests().remove(0);
    assert!(media.complete(&request, Completion::Progress { loaded: 40, total: Some(100) }));
    assert_eq!(media.snapshot().clips[0].loaded, 40);
    assert_eq!(media.snapshot().clips[1].total, Some(100));
    assert!(media.complete(&request, Completion::Validating));
    assert!(!media.snapshot().ready);
    assert!(media.complete(&request, ready()));
    assert!(media.snapshot().ready);
    assert!(!media.complete(&request, Completion::Failed { message: "late failure".into() }));
}

#[test]
fn metadata_partial_bytes_and_missing_decode_cannot_establish_readiness() {
    for proof in [
        Completion::Ready { eof: false, readable: true, bytes: 100, expected: Some(100), validated: true, decoded: true },
        Completion::Ready { eof: true, readable: true, bytes: 50, expected: Some(100), validated: true, decoded: true },
        Completion::Ready { eof: true, readable: false, bytes: 100, expected: None, validated: true, decoded: true },
        Completion::Ready { eof: true, readable: true, bytes: 100, expected: None, validated: true, decoded: false },
    ] {
        let mut media = Readiness::default();
        media.update(dependencies()).unwrap();
        assert!(media.complete(&media.requests().remove(0), proof));
        assert!(!media.snapshot().ready);
        assert!(matches!(media.snapshot().clips[0].state, State::Failed { .. }));
    }
}

#[test]
fn replacement_and_removal_reject_late_completions_even_after_readding_same_source() {
    let mut media = Readiness::default();
    media.update(dependencies()).unwrap();
    let request = media.requests().remove(0);
    let mut replacement = dependencies();
    replacement.sources[0].revision = "r2".into();
    media.update(replacement).unwrap();
    assert!(!media.complete(&request, ready()));
    let second = media.requests().remove(0);
    media.update(Dependencies::default()).unwrap();
    assert!(media.snapshot().ready);
    assert!(!media.complete(&second, ready()));
    media.update(dependencies()).unwrap();
    assert!(!media.complete(&request, ready()));
    assert!(!media.snapshot().ready);
}

#[test]
fn layout_mute_and_visibility_edits_reuse_unchanged_dependency_projection() {
    let mut media = Readiness::default();
    media.update(dependencies()).unwrap();
    let request = media.requests().remove(0);
    assert!(media.complete(&request, ready()));
    let before = media.snapshot();
    let after = media.update(dependencies()).unwrap();
    assert_eq!(before.generation, after.generation);
    assert!(after.ready);
    assert!(media.requests().is_empty());
}

#[test]
fn adding_sources_preserves_ready_siblings_and_retry_rejects_obsolete_attempts() {
    let mut media = Readiness::default();
    media.update(dependencies()).unwrap();
    assert!(media.complete(&media.requests().remove(0), ready()));
    let mut added = dependencies();
    added.sources.push(Source { id: "next".into(), revision: "r1".into(), url: "/next.wav".into(), kinds: vec![Kind::Audio], clip_ids: vec!["text".into()] });
    added.clips[2].source_ids.push("next".into());
    media.update(added).unwrap();
    assert_eq!(media.requests().len(), 1);
    let request = media.requests().remove(0);
    media.complete(&request, Completion::Failed { message: "Quota exhausted".into() });
    assert!(!media.snapshot().ready);
    media.retry("next").unwrap();
    assert!(!media.complete(&request, ready()));
    assert_eq!(media.snapshot().sources["source"], State::Ready);
    assert!(media.complete(&media.requests().remove(0), ready()));
    assert!(media.snapshot().ready);
}

#[test]
fn stale_derivatives_block_even_when_all_bytes_are_ready() {
    let mut media = Readiness::default();
    let mut input = dependencies();
    input.clips[0].blockers.push("Stale processed audio".into());
    media.update(input).unwrap();
    media.complete(&media.requests().remove(0), ready());
    assert!(!media.snapshot().ready);
    assert_eq!(media.snapshot().clips[0].blockers, vec!["Stale processed audio"]);
    assert_eq!(media.snapshot().clips[1].state, State::Ready);
}

#[test]
fn malformed_projection_preserves_previous_state_and_unknown_lengths_stay_indeterminate() {
    let mut media = Readiness::default();
    media.update(dependencies()).unwrap();
    let request = media.requests().remove(0);
    media.complete(&request, Completion::Progress { loaded: 40, total: None });
    assert_eq!(media.snapshot().clips[0].total, None);
    let mut broken = dependencies();
    broken.sources.clear();
    assert!(media.update(broken).is_err());
    assert_eq!(media.snapshot().clips[0].loaded, 40);
    assert!(media.complete(&request, Completion::Ready { eof: true, readable: true, bytes: 100, expected: None, validated: true, decoded: true }));
    assert!(media.snapshot().ready);
}

#[test]
fn losing_ready_bytes_blocks_play_and_old_reports_cannot_undo_retry() {
    let mut media = Readiness::default();
    media.update(dependencies()).unwrap();
    let token = media.requests().remove(0);
    assert!(media.complete(&token, ready()));
    assert!(media.invalidate(&token, "Local file lost".into()));
    assert!(!media.snapshot().ready);
    assert!(!media.complete(&token, ready()));
    media.retry("source").unwrap();
    let retry = media.requests().remove(0);
    assert!(!media.invalidate(&token, "Obsolete failure".into()));
    assert!(media.complete(&retry, ready()));
    assert!(media.snapshot().ready);
}

#[test]
fn late_progress_never_moves_validation_back_to_loading() {
    let mut media = Readiness::default();
    media.update(dependencies()).unwrap();
    let request = media.requests().remove(0);
    assert!(media.complete(&request, Completion::Validating));
    assert!(!media.complete(&request, Completion::Progress { loaded: 100, total: Some(100) }));
    assert_eq!(media.snapshot().clips[0].state, State::Validating);
}
