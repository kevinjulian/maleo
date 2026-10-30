use std::cell::RefCell;

use maleo_preview::Session;
use maleo_renderer::coverage::Entry;
use maleo_renderer::frame::Renderer;
use maleo_renderer::gpu::{FORMAT, Gpu};
use maleo_renderer::storyboard::Storyboard;
use serde::Deserialize;
use serde_json::json;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// `performance.now()`, in the page and in a worker alike.
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

struct Host {
    session: Session<Storyboard>,
    renderer: Renderer,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    /// The size the host asked for, and the size the surface is configured at.
    size: (u32, u32),
    configured: (u32, u32),
    coverage: Vec<Entry>,
    /// Called when the state changes outside a host call (device loss).
    on_change: js_sys::Function,
    recovery: u64,
}

thread_local! {
    static HOST: RefCell<Option<Host>> = const { RefCell::new(None) };
}

fn error(message: impl std::fmt::Display) -> JsError {
    JsError::new(&message.to_string())
}

fn with_host<T>(run: impl FnOnce(&mut Host) -> Result<T, JsError>) -> Result<T, JsError> {
    HOST.with_borrow_mut(|host| run(host.as_mut().ok_or_else(|| error("renderer: call init first"))?))
}

async fn request_gpu(instance: &wgpu::Instance, surface: Option<&wgpu::Surface<'static>>) -> Result<Gpu, String> {
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: surface, ..Default::default() })
        .await
        .map_err(|e| format!("no WebGPU adapter: {e}"))?;
    let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(|e| format!("no WebGPU device: {e}"))?;
    Gpu::from_device(device, queue)
}

fn track_device(device: &wgpu::Device, recovery: u64) {
    // Only installed devices can change session state; discarded late devices have no callback.
    device.set_device_lost_callback(move |_, _| device_lost(recovery));
}

fn host_now() -> Result<f64, JsError> {
    let performance = js_sys::Reflect::get(&js_sys::global(), &"performance".into()).map_err(|_| error("Missing browser performance clock"))?;
    let origin = js_sys::Reflect::get(&performance, &"timeOrigin".into())
        .map_err(|_| error("Missing browser time origin"))?
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or_else(|| error("Invalid browser time origin"))?;
    Ok((origin + performance_now()) / 1000.0)
}

fn device_lost(recovery: u64) {
    let Ok(Some(on_change)) = with_host(|host| {
        if host.recovery != recovery {
            return Ok(None);
        }
        host.recovery += 1;
        host.session.device_lost(host_now()?);
        Ok(Some(host.on_change.clone()))
    }) else {
        return;
    };
    // Outside the borrow: the host's handler calls back into the module.
    notify(&on_change);
}

/// The worker owns the timeout/retry policy. A newer attempt or failure fences late devices.
#[wasm_bindgen]
pub async fn recover_device() -> Result<bool, JsError> {
    let (instance, recovery) = with_host(|host| {
        host.recovery += 1;
        Ok((host.instance.clone(), host.recovery))
    })?;
    let gpu = request_gpu(&instance, None).await.map_err(error)?;
    let accepted = with_host(|host| {
        if host.recovery != recovery {
            return Ok(false);
        }
        track_device(&gpu.device, recovery);
        // Frames on the lost device are gone; the page's media pool forgets every frame on recovery.
        host.renderer.replace_gpu(gpu);
        host.configured = (0, 0);
        host.session.device_recovered(host_now()?);
        Ok(true)
    })?;
    if !accepted {
        return Ok(false);
    }
    tick(host_now()?).await
}

#[wasm_bindgen]
pub fn fail_device(message: &str, now: f64) -> Result<(), JsError> {
    with_host(|host| {
        host.recovery += 1;
        host.session.fail(message, now);
        Ok(())
    })
}

fn notify(on_change: &js_sys::Function) {
    let _ = on_change.call0(&JsValue::NULL);
}

impl Host {
    fn configure(&mut self) {
        if self.configured == self.size {
            return;
        }
        let (width, height) = self.size;
        self.surface.configure(
            &self.renderer.gpu().device,
            &wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::RENDER_ATTACHMENT,
                format: FORMAT,
                color_space: wgpu::SurfaceColorSpace::Srgb,
                width,
                height,
                present_mode: wgpu::PresentMode::Fifo,
                desired_maximum_frame_latency: 1,
                alpha_mode: wgpu::CompositeAlphaMode::Opaque,
                view_formats: vec![],
            },
        );
        self.configured = self.size;
    }

    /// Draws `frame` into the canvas and submits it.
    fn draw(&mut self, frame: i64) -> Result<(), String> {
        self.configure();
        let (width, height) = self.size;
        let Self { session, renderer, surface, .. } = self;
        let storyboard = session.storyboard().ok_or("no storyboard")?;
        let target = renderer.gpu().target(width, height);
        self.coverage =
            renderer.draw(storyboard, frame, &target.create_view(&Default::default()), width, height, (session.fps(), session.duration_frames()))?;
        let output = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) | wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            other => return Err(format!("canvas texture unavailable: {other:?}")),
        };
        let gpu = renderer.gpu();
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_texture(target.as_image_copy(), output.texture.as_image_copy(), target.size());
        gpu.queue.submit([encoder.finish()]);
        gpu.queue.present(output);
        Ok(())
    }
}

/// Creates the session over `canvas` (an `OffscreenCanvas`, in a worker on
/// the web). `on_change` is called when the state changes outside a call,
/// so the host can report it and tick again. Rejects without an adapter.
#[wasm_bindgen]
pub async fn init(canvas: web_sys::OffscreenCanvas, on_change: js_sys::Function) -> Result<(), JsError> {
    let size = (canvas.width(), canvas.height());
    let instance =
        wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
    let surface = instance.create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas)).map_err(error)?;
    let gpu = request_gpu(&instance, Some(&surface)).await.map_err(error)?;
    track_device(&gpu.device, 0);
    let mut session = Session::new();
    session.device_ready();
    HOST.set(Some(Host {
        session,
        renderer: Renderer::with_gpu(gpu),
        instance,
        surface,
        size,
        configured: (0, 0),
        coverage: Vec::new(),
        on_change,
        recovery: 0,
    }));
    Ok(())
}

/// Sets the storyboard. One that does not parse is refused and the previous
/// one stays.
#[wasm_bindgen]
pub fn set_storyboard(json: &str, fps: f64, duration_frames: f64) -> Result<(), JsError> {
    let storyboard = Storyboard::parse(json).map_err(error)?;
    with_host(|host| host.session.set_storyboard(storyboard, fps, duration_frames as i64).map_err(error))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InputContext {
    generation: u64,
    revision: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaBlocker {
    clip_id: String,
    message: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaReadiness {
    revision: String,
    source_generation: u32,
    sequence: u64,
    ready: bool,
    blockers: Vec<MediaBlocker>,
}
#[derive(Deserialize)]
#[serde(tag = "state", rename_all = "lowercase", deny_unknown_fields)]
enum MediaPlayback {
    Ready,
    Buffering,
    Stalled { message: String },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AudioAnchor {
    generation: u64,
    position: f64,
    sample_rate: u32,
    rate: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutputTime {
    context_time: f64,
    performance_time: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AudioObservation {
    generation: u64,
    frames: u64,
    render_frame: u64,
    context_time: f64,
    performance_time: f64,
    output: Option<OutputTime>,
    latency: Option<f64>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum MediaAction {
    Readiness { generation: u64, readiness: MediaReadiness },
    Playback { generation: u64, playback: MediaPlayback },
    AudioPlay { generation: u64, anchor: AudioAnchor, at: f64 },
    AudioPosition { generation: u64, observation: AudioObservation },
    AudioStop { generation: u64 },
}

/// Browser inputs carry the full-dependency revision separately from layout/storyboard JSON.
#[wasm_bindgen]
pub fn set_storyboard_context(json: &str, fps: f64, duration_frames: f64, context_json: &str, now: f64) -> Result<(), JsError> {
    let context: InputContext = serde_json::from_str(context_json).map_err(error)?;
    if !duration_frames.is_finite() || duration_frames.fract() != 0.0 || duration_frames < 1.0 || duration_frames > ((1u64 << 53) - 1) as f64 {
        return Err(error("Invalid preview duration frames"));
    }
    let storyboard = Storyboard::parse(json).map_err(error)?;
    with_host(|host| host.session.set_storyboard_context(storyboard, fps, duration_frames as i64, context.generation, context.revision, now).map_err(error))
}
#[wasm_bindgen]
pub fn media_dispatch(json: &str, now: f64) -> Result<bool, JsError> {
    let action: MediaAction = serde_json::from_str(json).map_err(error)?;
    with_host(|host| {
        let generation = match &action {
            MediaAction::Readiness { generation, .. }
            | MediaAction::Playback { generation, .. }
            | MediaAction::AudioPlay { generation, .. }
            | MediaAction::AudioPosition { generation, .. }
            | MediaAction::AudioStop { generation } => *generation,
        };
        if generation != host.session.generation() {
            return Ok(false);
        }
        match action {
            MediaAction::Readiness { readiness, .. } => host
                .session
                .media_readiness(
                    generation,
                    maleo_preview::media::Readiness {
                        revision: readiness.revision,
                        generation: readiness.source_generation,
                        sequence: readiness.sequence,
                        ready: readiness.ready,
                        blockers: readiness
                            .blockers
                            .into_iter()
                            .map(|blocker| maleo_preview::media::Blocker { clip_id: blocker.clip_id, message: blocker.message })
                            .collect(),
                    },
                    now,
                )
                .map_err(error),
            MediaAction::Playback { playback, .. } => host
                .session
                .media_playback(
                    generation,
                    match playback {
                        MediaPlayback::Ready => maleo_preview::media::Playback::Ready,
                        MediaPlayback::Buffering => maleo_preview::media::Playback::Buffering,
                        MediaPlayback::Stalled { message } => maleo_preview::media::Playback::Stalled(message),
                    },
                    now,
                )
                .map_err(error),
            MediaAction::AudioPlay { anchor, at, .. } => {
                host.session
                    .play_audio(
                        maleo_preview::audio_clock::Anchor {
                            generation: anchor.generation,
                            position: anchor.position,
                            sample_rate: anchor.sample_rate,
                            rate: anchor.rate,
                        },
                        at,
                    )
                    .map_err(error)?;
                Ok(true)
            }
            MediaAction::AudioPosition { observation: value, .. } => host
                .session
                .audio_position(maleo_preview::audio_clock::Observation {
                    generation: value.generation,
                    frames: value.frames,
                    render_frame: value.render_frame,
                    context_time: value.context_time,
                    performance_time: value.performance_time,
                    output: value
                        .output
                        .map(|time| maleo_preview::audio_clock::OutputTimestamp { context_time: time.context_time, performance_time: time.performance_time }),
                    latency: value.latency,
                })
                .map_err(error),
            MediaAction::AudioStop { .. } => {
                if !now.is_finite() {
                    return Err(error("Invalid audio stop time"));
                }
                host.session.audio_stop(now);
                Ok(true)
            }
        }
    })
}

#[wasm_bindgen]
pub fn seek(position: f64, now: f64) -> Result<(), JsError> {
    with_host(|host| {
        host.session.seek(position, now);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn play(position: f64, at: f64, rate: f64) -> Result<(), JsError> {
    with_host(|host| host.session.play(position, at, rate).map_err(error))
}

#[wasm_bindgen]
pub fn pause(position: f64) -> Result<(), JsError> {
    with_host(|host| {
        host.session.pause(position);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn resize(width: u32, height: u32) -> Result<(), JsError> {
    with_host(|host| {
        host.size = (width, height);
        host.session.invalidate();
        Ok(())
    })
}

/// Supplies the decoded image for `url` (straight-alpha RGBA); the frame on
/// screen draws again with it.
#[wasm_bindgen]
pub fn put_image(url: &str, width: u32, height: u32, rgba: Vec<u8>) -> Result<(), JsError> {
    with_host(|host| {
        host.renderer.put_image(url, width, height, rgba).map_err(error)?;
        host.session.invalidate();
        Ok(())
    })
}

/// Typed requests for every video placement visible at the session's current position.
#[wasm_bindgen]
pub fn video_requests(now: f64) -> Result<String, JsError> {
    with_host(|host| {
        let storyboard = host.session.storyboard().ok_or_else(|| error("no storyboard"))?;
        let frame = host.session.report(now).frame;
        serde_json::to_string(&maleo_renderer::media_requests::video_requests(storyboard, frame, host.session.fps())).map_err(error)
    })
}

/// Prefetch the next frame or upcoming video during image/gap spans, without advancing the clock.
#[wasm_bindgen]
pub fn next_video_requests(now: f64) -> Result<String, JsError> {
    with_host(|host| {
        let storyboard = host.session.storyboard().ok_or_else(|| error("no storyboard"))?;
        let frame = host.session.report(now).frame;
        serde_json::to_string(&maleo_renderer::media_requests::prefetch_video_requests(storyboard, frame, host.session.fps())).map_err(error)
    })
}

#[wasm_bindgen]
pub fn image_requests(now: f64) -> Result<String, JsError> {
    with_host(|host| {
        let storyboard = host.session.storyboard().ok_or_else(|| error("no storyboard"))?;
        serde_json::to_string(&maleo_renderer::media_requests::image_requests(storyboard, host.session.report(now).frame, host.session.fps())).map_err(error)
    })
}

/// The adapter accepts its native pool lease before supplying a decoded placement interval.
#[wasm_bindgen]
pub fn put_video(request: &str, identity: &str, rgba: Vec<u8>) -> Result<(), JsError> {
    let request = serde_json::from_str::<maleo_renderer::media_requests::VideoRequest>(request).map_err(error)?;
    let identity = serde_json::from_str::<maleo_media::visual_pool::FrameIdentity>(identity).map_err(error)?;
    with_host(|host| {
        host.renderer.put_video(&request, identity, rgba).map_err(error)?;
        host.session.invalidate();
        Ok(())
    })
}

#[wasm_bindgen]
pub fn remove_video(path: &str) -> Result<(), JsError> {
    with_host(|host| {
        host.renderer.remove_video(path);
        host.session.invalidate();
        Ok(())
    })
}

#[wasm_bindgen]
pub fn cache_media_frame(id: u64, identity: &str, rgba: Vec<u8>) -> Result<(), JsError> {
    let identity = serde_json::from_str::<maleo_media::visual_pool::FrameIdentity>(identity).map_err(error)?;
    with_host(|host| host.renderer.cache_media_frame(id, identity, rgba).map_err(error))
}

/// Copies a decoded `VideoFrame` into a texture on the renderer's device and
/// closes it. The GPU converts the frame; no RGBA bytes cross into WASM.
#[wasm_bindgen]
pub fn cache_video_frame(id: u64, identity: &str, frame: web_sys::VideoFrame) -> Result<(), JsError> {
    let result = cache_frame_texture(id, identity, &frame);
    frame.close();
    result
}

fn cache_frame_texture(id: u64, identity: &str, frame: &web_sys::VideoFrame) -> Result<(), JsError> {
    let identity = serde_json::from_str::<maleo_media::visual_pool::FrameIdentity>(identity).map_err(error)?;
    if frame.display_width() != identity.width || frame.display_height() != identity.height {
        return Err(error("Video frame size does not match its identity"));
    }
    with_host(|host| {
        let gpu = host.renderer.gpu();
        let size = wgpu::Extent3d { width: identity.width, height: identity.height, depth_or_array_layers: 1 };
        let texture = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("cached video frame"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            // copyExternalImageToTexture needs RENDER_ATTACHMENT; vello copies from it (COPY_SRC).
            usage: wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        // The copy snapshots the frame at call time, so the caller may close it at once.
        gpu.queue.copy_external_image_to_texture(
            &wgpu::CopyExternalImageSourceInfo {
                // `Clone::clone` copies the JS reference; `VideoFrame::clone` would duplicate the frame.
                source: wgpu::ExternalImageSource::VideoFrame(Clone::clone(frame)),
                origin: wgpu::Origin2d::ZERO,
                flip_y: false,
            },
            wgpu::CopyExternalImageDestInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
                color_space: wgpu::PredefinedColorSpace::Srgb,
                premultiplied_alpha: false,
            },
            size,
        );
        host.renderer.cache_media_texture(id, identity, texture).map_err(error)
    })
}

#[wasm_bindgen]
pub fn bind_video(request: &str, id: u64) -> Result<(), JsError> {
    let request = serde_json::from_str::<maleo_renderer::media_requests::VideoRequest>(request).map_err(error)?;
    with_host(|host| {
        host.renderer.bind_video(&request, id).map_err(error)?;
        host.session.invalidate();
        Ok(())
    })
}

#[wasm_bindgen]
pub fn bind_image(url: &str, id: u64) -> Result<(), JsError> {
    with_host(|host| {
        host.renderer.bind_image(url, id).map_err(error)?;
        host.session.invalidate();
        Ok(())
    })
}

#[wasm_bindgen]
pub fn remove_media_frame(id: u64) -> Result<(), JsError> {
    with_host(|host| {
        host.renderer.remove_media_frame(id);
        host.session.invalidate();
        Ok(())
    })
}

/// Records the reference playhead (Remotion's) for the drift report.
#[wasm_bindgen]
pub fn report_remotion(position: f64, at: f64) -> Result<(), JsError> {
    with_host(|host| {
        host.session.reference(position, at);
        Ok(())
    })
}

/// Draws the frame due at `now`, if any, and resolves when the GPU has
/// finished it: `true` when a frame was drawn. A tick while a draw is in
/// flight draws nothing.
#[wasm_bindgen]
pub async fn tick(now: f64) -> Result<bool, JsError> {
    let submitted = with_host(|host| {
        let Some(frame) = host.session.tick(now) else {
            return Ok(None);
        };
        let started = performance_now();
        if let Err(message) = host.draw(frame) {
            host.session.fail(message.clone(), now);
            return Err(error(message));
        }
        Ok(Some((host.renderer.gpu().queue.clone(), started, host.recovery)))
    })?;
    let Some((queue, started, recovery)) = submitted else {
        return Ok(false);
    };
    let done = js_sys::Promise::new(&mut |resolve, _reject| {
        queue.on_submitted_work_done(move || {
            let _ = resolve.call0(&JsValue::NULL);
        });
    });
    wasm_bindgen_futures::JsFuture::from(done).await.map_err(|e| error(format!("{e:?}")))?;
    with_host(|host| {
        if host.recovery != recovery {
            return Ok(false);
        }
        host.session.drawn(performance_now() - started, host_now()?);
        Ok(true)
    })
}

/// True while the host should keep ticking: playing, or a draw pending.
#[wasm_bindgen]
pub fn wants_tick(now: f64) -> Result<bool, JsError> {
    with_host(|host| Ok(host.session.wants_tick(now)))
}

/// The session's state as JSON: status (and message when failed), position
/// in seconds, frame, dropped frames, frame times in ms, drift in frames, and
/// the coverage report of the last drawn frame.
#[wasm_bindgen]
pub fn state(now: f64) -> Result<String, JsError> {
    with_host(|host| {
        let report = host.session.report(now);
        let message = match &report.status {
            maleo_preview::Status::Failed(message) | maleo_preview::Status::Stalled(message) => Some(message.as_str()),
            _ => None,
        };
        let times = report.times.map(|t| json!({ "last": t.last, "p50": t.p50, "p95": t.p95, "count": t.count }));
        Ok(json!({
            "status": report.status.name(),
            "message": message,
            "position": report.position,
            "frame": report.frame,
            "dropped": report.dropped,
            "times": times,
            "drift": report.drift,
            "coverage": host.coverage,
            "generation":report.generation,
            "mediaGeneration":report.media_generation,
            "mediaReady":report.media_ready,
            "blockers":report.blockers.iter().map(|blocker|json!({"clipId":blocker.clip_id,"message":blocker.message})).collect::<Vec<_>>(),
            "clockOwner":if report.audio_owned{"audio"}else{"host"},
        })
        .to_string())
    })
}

/// Debug: destroys the GPU device, so recovery can be exercised in a browser.
#[wasm_bindgen]
pub fn lose_device() -> Result<(), JsError> {
    with_host(|host| {
        host.renderer.gpu().device.destroy();
        Ok(())
    })
}
