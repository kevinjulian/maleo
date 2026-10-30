use maleo_media::visual_pool::*;

fn request(consumer: &str, sequence: u64, time: f64, width: u32, height: u32) -> DecodeRequest {
    DecodeRequest {
        consumer: consumer.into(),
        generation: 1,
        sequence,
        source_id: "shared-video".into(),
        revision: "r1".into(),
        time,
        width,
        height,
        kind: VisualKind::Video,
    }
}
fn acquired(pool: &mut VisualPool) -> (Lease, Vec<u64>) {
    match pool.acquire() {
        DecodePlan::Start { lease, evicted } => (lease, evicted),
        other => panic!("expected decode lease, got {other:?}"),
    }
}
fn identity(lease: &Lease) -> FrameIdentity {
    FrameIdentity {
        source_id: lease.request.source_id.clone(),
        revision: lease.request.revision.clone(),
        start: lease.request.time,
        end: lease.request.time + 0.5,
        presentation: None,
        width: lease.request.width,
        height: lease.request.height,
    }
}
fn cached(pool: &mut VisualPool, lease: Lease) -> CachedFrame {
    pool.complete(lease.id, identity(&lease)).unwrap().unwrap()
}
#[test]
fn image_decode_jobs_are_bounded_without_using_video_slots() {
    let mut pool = VisualPool::default();
    for name in ["image-a", "image-b", "image-c"] {
        pool.enqueue(DecodeRequest { kind: VisualKind::Image, ..request(name, 1, 0.0, 1, 1) }).unwrap();
    }
    let (a, _) = acquired(&mut pool);
    let (b, _) = acquired(&mut pool);
    assert_eq!(pool.stats().video_decoders, 0);
    assert!(matches!(pool.acquire(), DecodePlan::Wait));
    pool.enqueue(request("video", 1, 0.0, 1, 1)).unwrap();
    let (video, _) = acquired(&mut pool);
    assert_eq!(video.request.consumer, "video");
    pool.release(a.id);
    let (c, _) = acquired(&mut pool);
    assert_eq!(c.request.consumer, "image-c");
    for lease in [b, c, video] {
        pool.release(lease.id);
    }
    assert_eq!(pool.stats().reserved_bytes, 0);
}
#[test]
fn overlapping_instances_share_source_identity_but_keep_independent_times_and_two_decoder_limit() {
    let mut pool = VisualPool::default();
    for (name, time) in [("left", 1.0), ("right", 4.0), ("third", 8.0)] {
        pool.enqueue(request(name, 1, time, 1920, 1080)).unwrap();
    }
    let (left, _) = acquired(&mut pool);
    let (right, _) = acquired(&mut pool);
    assert_eq!(pool.stats().video_decoders, 2);
    assert!(matches!(pool.acquire(), DecodePlan::Wait));
    let left = cached(&mut pool, left);
    let (third, _) = acquired(&mut pool);
    assert_eq!(pool.stats().video_decoders, 2);
    assert!(pool.lookup(&request("read", 1, 1.1, 1920, 1080)).is_some());
    assert!(pool.lookup(&request("read", 1, 4.1, 1920, 1080)).is_none());
    let right = cached(&mut pool, right);
    assert_ne!(left.id, right.id);
    assert!(pool.lookup(&request("read", 1, 4.1, 1920, 1080)).is_some());
    pool.release(third.id);
    assert_eq!(pool.stats().video_decoders, 0);
}
#[test]
fn queue_is_fair_with_one_active_and_one_replaceable_latest_request_per_consumer() {
    let mut pool = VisualPool::default();
    pool.enqueue(request("a", 1, 0.0, 16, 16)).unwrap();
    let (a, _) = acquired(&mut pool);
    pool.enqueue(request("b", 1, 1.0, 16, 16)).unwrap();
    for sequence in 2..=100 {
        pool.enqueue(request("a", sequence, sequence as f64, 16, 16)).unwrap();
    }
    pool.enqueue(request("c", 1, 2.0, 16, 16)).unwrap();
    assert_eq!(pool.stats().queued, 3);
    let (b, _) = acquired(&mut pool);
    assert_eq!(b.request.consumer, "b");
    assert!(pool.complete(a.id, identity(&a)).unwrap().is_none());
    let (latest, _) = acquired(&mut pool);
    assert_eq!(latest.request.sequence, 100);
    assert_eq!(latest.request.consumer, "a");
    pool.release(b.id);
    let (c, _) = acquired(&mut pool);
    assert_eq!(c.request.consumer, "c");
    pool.release(latest.id);
    pool.release(c.id);
    assert_eq!(pool.stats().reserved_bytes, 0);
    assert!(!pool.enqueue(request("a", 99, 99.0, 16, 16)).unwrap());
}
#[test]
fn cache_and_inflight_reservations_share_one_budget_and_current_next_frames_survive_eviction() {
    let mut pool = VisualPool::default();
    let mut frames = Vec::new();
    for time in 0..4 {
        pool.enqueue(request("a", time + 1, time as f64, 4096, 4096)).unwrap();
        let (lease, evicted) = acquired(&mut pool);
        assert!(evicted.is_empty());
        frames.push(cached(&mut pool, lease));
    }
    assert_eq!(pool.stats().cached_bytes, VISUAL_BYTES);
    pool.retain(&[frames[0].id, frames[1].id]).unwrap();
    pool.enqueue(request("a", 5, 4.0, 4096, 4096)).unwrap();
    let (lease, evicted) = acquired(&mut pool);
    assert_eq!(evicted, vec![frames[2].id]);
    let stats = pool.stats();
    assert_eq!(stats.cached_bytes + stats.reserved_bytes, VISUAL_BYTES);
    assert!(pool.lookup(&request("read", 1, 0.1, 4096, 4096)).is_some());
    assert!(pool.lookup(&request("read", 1, 2.1, 4096, 4096)).is_none());
    pool.release(lease.id);
    assert_eq!(pool.stats().reserved_bytes, 0);
}
#[test]
fn resolution_changes_reserve_before_copy_and_fail_without_exceeding_budget() {
    let mut pool = VisualPool::default();
    pool.enqueue(request("a", 1, 0.0, 4096, 4096)).unwrap();
    let (a, _) = acquired(&mut pool);
    let a = cached(&mut pool, a);
    pool.retain(&[a.id]).unwrap();
    pool.enqueue(request("b", 1, 2.0, 4096, 4096)).unwrap();
    let (b, _) = acquired(&mut pool);
    assert!(pool.resize(b.id, 8192, 8192, None).is_err());
    assert_eq!(pool.stats().reserved_bytes, 64 * 1024 * 1024);
    pool.resize(b.id, 8192, 4096, None).unwrap();
    assert_eq!(pool.stats().reserved_bytes, 128 * 1024 * 1024);
    // A host that copies a differently shaped frame without updating its reservation is rejected.
    let mut wrong = identity(&b);
    wrong.width = 4096;
    wrong.height = 8192;
    assert!(pool.complete(b.id, wrong).is_err());
    assert_eq!(pool.stats().reserved_bytes, 0);
    assert!(rgba_bytes(u32::MAX, u32::MAX).is_err());
    assert!(pool.enqueue(request("oversize", 1, 0.0, 16384, 16384)).is_err());
}
#[test]
fn unsatisfied_minimum_working_set_has_named_failure_and_image_reservations_count_too() {
    let mut pool = VisualPool::default();
    pool.enqueue(request("a", 1, 0.0, 8192, 8192)).unwrap();
    let (a, _) = acquired(&mut pool);
    let a = cached(&mut pool, a);
    pool.retain(&[a.id]).unwrap();
    let mut image = request("image", 1, 0.0, 1, 1);
    image.kind = VisualKind::Image;
    pool.enqueue(image).unwrap();
    assert!(matches!(pool.acquire(),DecodePlan::Failed{message,..} if message.contains("256 MiB")));
    pool.retain(&[]).unwrap();
    let mut image = request("image", 2, 0.0, 8192, 8192);
    image.kind = VisualKind::Image;
    pool.enqueue(image).unwrap();
    let (image, evicted) = acquired(&mut pool);
    assert_eq!(evicted, vec![a.id]);
    assert_eq!(pool.stats().video_decoders, 0);
    assert_eq!(pool.stats().reserved_bytes, VISUAL_BYTES);
    pool.release(image.id);
}
#[test]
fn cancel_clear_and_decoder_errors_keep_lease_capacity_until_the_host_closes_it() {
    let mut pool = VisualPool::default();
    pool.enqueue(request("a", 1, 0.0, 100, 100)).unwrap();
    let (a, _) = acquired(&mut pool);
    assert_eq!(pool.cancel("a"), vec![a.id]);
    assert_eq!(pool.stats().video_decoders, 1);
    assert!(pool.complete(a.id, identity(&a)).unwrap().is_none());
    assert_eq!(pool.stats().reserved_bytes, 0);
    pool.enqueue(request("b", 1, 1.0, 100, 100)).unwrap();
    let (b, _) = acquired(&mut pool);
    pool.clear();
    assert_eq!(pool.stats().video_decoders, 1);
    pool.release(b.id);
    assert_eq!(pool.stats().video_decoders, 0);
    assert!(pool.retain(&[u64::MAX]).is_err());
}

#[test]
fn temporary_copy_buffers_are_reserved_before_allocation_and_released_at_completion() {
    let mut pool = VisualPool::default();
    pool.enqueue(request("a", 1, 0.0, 100, 100)).unwrap();
    let (lease, _) = acquired(&mut pool);
    pool.resize(lease.id, 100, 100, Some(80000)).unwrap();
    assert_eq!(pool.stats().reserved_bytes, 80000);
    let frame = cached(&mut pool, lease);
    assert_eq!(frame.bytes, 40000);
    assert_eq!(pool.stats().cached_bytes, 40000);
    assert_eq!(pool.stats().reserved_bytes, 0);
}
