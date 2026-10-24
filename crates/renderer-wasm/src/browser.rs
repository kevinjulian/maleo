use std::cell::RefCell;

use maleo_renderer::frame::Renderer;
use maleo_renderer::gpu::{FORMAT, Gpu};
use maleo_renderer::storyboard::Storyboard;
use wasm_bindgen::prelude::*;

struct State {
    renderer: Renderer,
    surface: wgpu::Surface<'static>,
    size: (u32, u32),
    /// The last storyboard, kept while the host sends the same JSON.
    storyboard: Option<(String, Storyboard)>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn error(message: impl std::fmt::Display) -> JsError {
    JsError::new(&message.to_string())
}

fn with_state<T>(run: impl FnOnce(&mut State) -> Result<T, JsError>) -> Result<T, JsError> {
    STATE.with_borrow_mut(|state| run(state.as_mut().ok_or_else(|| error("renderer: call init first"))?))
}

impl State {
    fn storyboard(&mut self, json: &str) -> Result<&Storyboard, JsError> {
        if self.storyboard.as_ref().is_none_or(|(last, _)| last != json) {
            self.storyboard = Some((json.to_owned(), Storyboard::parse(json).map_err(error)?));
        }
        Ok(&self.storyboard.as_ref().expect("just stored").1)
    }

    fn configure(&mut self, width: u32, height: u32) {
        if self.size == (width, height) {
            return;
        }
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
        self.size = (width, height);
    }
}

/// Requests a WebGPU device for `canvas`. Rejects when the browser has no adapter.
#[wasm_bindgen]
pub async fn init(canvas: web_sys::HtmlCanvasElement) -> Result<(), JsError> {
    let instance =
        wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
    let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas)).map_err(error)?;
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: Some(&surface), ..Default::default() })
        .await
        .map_err(|e| error(format!("no WebGPU adapter: {e}")))?;
    let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(error)?;
    let renderer = Renderer::with_gpu(Gpu::from_device(device, queue).map_err(error)?);
    STATE.set(Some(State { renderer, surface, size: (0, 0), storyboard: None }));
    Ok(())
}

#[wasm_bindgen]
pub fn put_image(url: &str, width: u32, height: u32, rgba: Vec<u8>) -> Result<(), JsError> {
    with_state(|state| state.renderer.put_image(url, width, height, rgba).map_err(error))
}

#[wasm_bindgen]
pub fn coverage(storyboard_json: &str, frame: f64) -> Result<String, JsError> {
    with_state(|state| {
        let storyboard = state.storyboard(storyboard_json)?.clone();
        serde_json::to_string(&state.renderer.coverage(&storyboard, frame as i64)).map_err(error)
    })
}

/// Draws `frame` into the canvas at `width` x `height` and returns the coverage report.
#[wasm_bindgen]
pub fn render_to_canvas(storyboard_json: &str, frame: f64, width: u32, height: u32) -> Result<String, JsError> {
    with_state(|state| {
        state.configure(width, height);
        let storyboard = state.storyboard(storyboard_json)?.clone();
        let target = state.renderer.gpu().target(width, height);
        let report = state.renderer.draw(&storyboard, frame as i64, &target.create_view(&Default::default()), width, height).map_err(error)?;
        let output = match state.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) | wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            other => return Err(error(format!("canvas texture unavailable: {other:?}"))),
        };
        let gpu = state.renderer.gpu();
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_texture(target.as_image_copy(), output.texture.as_image_copy(), target.size());
        gpu.queue.submit([encoder.finish()]);
        gpu.queue.present(output);
        serde_json::to_string(&report).map_err(error)
    })
}

/// Resolves when the GPU has finished the work submitted so far, so a host
/// can time a frame from submission to completion.
#[wasm_bindgen]
pub async fn work_done() -> Result<(), JsError> {
    let queue = with_state(|state| Ok(state.renderer.gpu().queue.clone()))?;
    let done = js_sys::Promise::new(&mut |resolve, _reject| {
        queue.on_submitted_work_done(move || {
            let _ = resolve.call0(&JsValue::NULL);
        });
    });
    wasm_bindgen_futures::JsFuture::from(done).await.map(|_| ()).map_err(|e| error(format!("{e:?}")))
}

/// Draws `frame` offscreen and returns its straight-alpha RGBA bytes.
#[wasm_bindgen]
pub async fn render(storyboard_json: String, frame: f64, width: u32, height: u32) -> Result<Vec<u8>, JsError> {
    // The state cannot stay borrowed across the readback await: take it out.
    let mut state = STATE.take().ok_or_else(|| error("renderer: call init first"))?;
    let result = match state.storyboard(&storyboard_json).cloned() {
        Ok(storyboard) => state.renderer.render(&storyboard, frame as i64, width, height).await.map(|f| f.rgba).map_err(error),
        Err(e) => Err(e),
    };
    STATE.set(Some(state));
    result
}
