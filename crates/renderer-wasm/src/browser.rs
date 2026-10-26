use std::cell::RefCell;

use maleo_preview::Session;
use maleo_renderer::coverage::Entry;
use maleo_renderer::frame::Renderer;
use maleo_renderer::gpu::{FORMAT, Gpu};
use maleo_renderer::storyboard::Storyboard;
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
    // The callback outlives this call; recovery runs on the event loop.
    device.set_device_lost_callback(|_, _| wasm_bindgen_futures::spawn_local(recover()));
    Gpu::from_device(device, queue)
}

/// Device loss (design D6): report it, request a new device, and move the
/// renderer to it. The supplied images are CPU-side and stay. One failed
/// attempt fails the session.
async fn recover() {
    let Ok((instance, on_change)) = with_host(|host| {
        host.session.device_lost();
        Ok((host.instance.clone(), host.on_change.clone()))
    }) else {
        return;
    };
    // Outside the borrow: the host's handler calls back into the module.
    notify(&on_change);
    let gpu = request_gpu(&instance, None).await;
    let _ = with_host(|host| {
        match gpu {
            Ok(gpu) => {
                host.renderer.replace_gpu(gpu);
                host.configured = (0, 0);
                host.session.device_ready();
            }
            Err(message) => host.session.fail(message),
        }
        Ok(())
    });
    notify(&on_change);
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
    let mut session = Session::new();
    session.device_ready();
    HOST.set(Some(Host { session, renderer: Renderer::with_gpu(gpu), instance, surface, size, configured: (0, 0), coverage: Vec::new(), on_change }));
    Ok(())
}

/// Sets the storyboard. One that does not parse is refused and the previous
/// one stays.
#[wasm_bindgen]
pub fn set_storyboard(json: &str, fps: f64, duration_frames: f64) -> Result<(), JsError> {
    let storyboard = Storyboard::parse(json).map_err(error)?;
    with_host(|host| host.session.set_storyboard(storyboard, fps, duration_frames as i64).map_err(error))
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
    with_host(|host| {
        host.session.play(position, at, rate);
        Ok(())
    })
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
            host.session.fail(message.clone());
            return Err(error(message));
        }
        Ok(Some((host.renderer.gpu().queue.clone(), started)))
    })?;
    let Some((queue, started)) = submitted else {
        return Ok(false);
    };
    let done = js_sys::Promise::new(&mut |resolve, _reject| {
        queue.on_submitted_work_done(move || {
            let _ = resolve.call0(&JsValue::NULL);
        });
    });
    wasm_bindgen_futures::JsFuture::from(done).await.map_err(|e| error(format!("{e:?}")))?;
    with_host(|host| {
        host.session.drawn(performance_now() - started);
        Ok(())
    })?;
    Ok(true)
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
            maleo_preview::Status::Failed(message) => Some(message.as_str()),
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
