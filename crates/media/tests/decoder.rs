use maleo_media::decoder::{Decoders, Kind};
#[test]
fn all_owners_share_two_slots_per_codec_kind_with_fair_queueing() {
    let mut pool = Decoders::default();
    let first = pool.open();
    let second = pool.open();
    for request in 1..=3 {
        pool.request(first, request, Kind::Video, 1).unwrap();
    }
    for request in 1..=3 {
        pool.request(second, request, Kind::Audio, 1).unwrap();
    }
    let grants = pool.grants();
    assert_eq!(grants.len(), 4);
    assert_eq!(grants.iter().filter(|grant| grant.owner == first).count(), 2);
    assert_eq!(grants.iter().filter(|grant| grant.owner == second).count(), 2);
    assert!(pool.grants().is_empty());
    pool.release(first, grants[0].lease);
    let next = pool.grants();
    assert_eq!(next.len(), 1);
    assert_eq!((next[0].owner, next[0].request), (first, 3));
    pool.release(second, grants[2].lease);
    let next = pool.grants();
    assert_eq!(next.len(), 1);
    assert_eq!((next[0].owner, next[0].request), (second, 3));
}
#[test]
fn worker_termination_releases_its_leases_and_cancels_its_queue_without_affecting_siblings() {
    let mut pool = Decoders::default();
    let first = pool.open();
    let second = pool.open();
    for request in 1..=3 {
        pool.request(first, request, Kind::Video, 1).unwrap();
    }
    pool.request(second, 1, Kind::Video, 1).unwrap();
    pool.close(first);
    let grants = pool.grants();
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].owner, second);
    assert!(pool.request(first, 4, Kind::Video, 1).is_err());
    pool.close(second);
    assert!(pool.grants().is_empty());
}
#[test]
fn request_identity_is_owner_scoped_and_duplicate_or_unknown_owners_are_refused() {
    let mut pool = Decoders::default();
    let first = pool.open();
    let second = pool.open();
    assert!(pool.request(0, 1, Kind::Video, 1).is_err());
    assert!(pool.request(first, 0, Kind::Video, 1).is_err());
    pool.request(first, 1, Kind::Video, 1).unwrap();
    assert!(pool.request(first, 1, Kind::Video, 1).is_err());
    pool.request(second, 1, Kind::Video, 1).unwrap();
    assert_eq!(pool.grants().len(), 2);
    pool.request(first, 2, Kind::Video, 1).unwrap();
    assert!(pool.request(first, 2, Kind::Video, 1).is_err());
    pool.release(first, u32::MAX);
    assert!(pool.grants().is_empty());
}

#[test]
fn transparent_video_can_reserve_both_slots_without_starving_behind_single_slot_requests() {
    let mut pool = Decoders::default();
    let owner = pool.open();
    pool.request(owner, 1, Kind::Video, 1).unwrap();
    let active = pool.grants().remove(0);
    pool.request(owner, 2, Kind::Video, 2).unwrap();
    pool.request(owner, 3, Kind::Video, 1).unwrap();
    assert!(pool.grants().is_empty());
    assert!(pool.should_yield(owner, active.lease));
    pool.release(owner, active.lease);
    let alpha = pool.grants();
    assert_eq!(alpha.len(), 1);
    assert_eq!(alpha[0].request, 2);
    pool.release(owner, alpha[0].lease);
    assert_eq!(pool.grants()[0].request, 3);
    assert!(pool.request(owner, 4, Kind::Video, 3).is_err());
    assert!(pool.request(owner, 5, Kind::Audio, 2).is_err());
}
