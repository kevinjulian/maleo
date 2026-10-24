//! The GPU half of the renderer: a wgpu device, the vello renderer on it, an
//! offscreen target and the readback to RGBA.
//!
//! Every host shares this path. A native host (tests, later the render worker)
//! reads frames back; the browser host draws into its canvas texture with
//! [`Gpu::draw`] and reads back only when it needs bytes.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

use vello::peniko::{Color, ImageData};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene};

/// The frame format: straight-alpha RGBA, 8 bits per channel, sRGB values.
pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    vello: Renderer,
}

impl Gpu {
    /// Requests an adapter and device. `WGPU_BACKEND` picks the backend
    /// (CI sets `vulkan` to run on lavapipe).
    pub async fn new() -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions::default()).await.map_err(|e| format!("no GPU adapter: {e}"))?;
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(|e| format!("no GPU device: {e}"))?;
        Self::from_device(device, queue)
    }

    /// Wraps a device the host already holds (the browser canvas host).
    pub fn from_device(device: wgpu::Device, queue: wgpu::Queue) -> Result<Self, String> {
        let options = RendererOptions { antialiasing_support: AaSupport::area_only(), ..Default::default() };
        let vello = Renderer::new(&device, options).map_err(|e| format!("vello renderer: {e}"))?;
        Ok(Self { device, queue, vello })
    }

    /// A texture vello can draw into and the host can copy or sample.
    pub fn target(&self, width: u32, height: u32) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("maleo-frame"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    }

    /// Draws `scene` over `base` into `view`.
    pub fn draw(&mut self, scene: &Scene, view: &wgpu::TextureView, width: u32, height: u32, base: Color) -> Result<(), String> {
        let params = RenderParams { base_color: base, width, height, antialiasing_method: AaConfig::Area };
        self.vello.render_to_texture(&self.device, &self.queue, scene, view, &params).map_err(|e| format!("vello render: {e}"))
    }

    /// Lets scenes draw a texture as an image (straight-alpha `FORMAT`) until
    /// [`Gpu::release`].
    pub fn register(&mut self, texture: wgpu::Texture) -> ImageData {
        self.vello.register_texture(texture)
    }

    pub fn release(&mut self, image: ImageData) {
        self.vello.unregister_texture(image);
    }

    /// Draws `scene` offscreen and reads the frame back as RGBA.
    pub async fn render(&mut self, scene: &Scene, width: u32, height: u32, base: Color) -> Result<Vec<u8>, String> {
        let target = self.target(width, height);
        self.draw(scene, &target.create_view(&Default::default()), width, height, base)?;
        self.read(&target).await
    }

    /// Reads a [`FORMAT`] texture back as tightly packed RGBA rows.
    pub async fn read(&self, texture: &wgpu::Texture) -> Result<Vec<u8>, String> {
        let (width, height) = (texture.width(), texture.height());
        let row = (width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("maleo-readback"),
            size: u64::from(row * height),
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) },
            },
            texture.size(),
        );
        self.queue.submit([encoder.finish()]);

        let slice = buffer.slice(..);
        let mapped = Mapped::default();
        let signal = mapped.clone();
        slice.map_async(wgpu::MapMode::Read, move |result| signal.finish(result.map_err(|e| format!("readback: {e}"))));
        // Native backends complete the map here; WebGPU completes it on the event loop.
        #[cfg(not(target_arch = "wasm32"))]
        self.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None }).map_err(|e| format!("poll: {e}"))?;
        mapped.await?;

        let data = slice.get_mapped_range().map_err(|e| format!("readback: {e}"))?;
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            let start = (y * row) as usize;
            pixels.extend_from_slice(&data[start..start + (width * 4) as usize]);
        }
        Ok(pixels)
    }
}

/// Resolves when `map_async` calls back, on native and in the browser alike.
#[derive(Clone, Default)]
struct Mapped(Arc<Mutex<MapState>>);

/// The map result once it arrives, and the task waiting for it.
type MapState = (Option<Result<(), String>>, Option<Waker>);

impl Mapped {
    fn finish(&self, result: Result<(), String>) {
        let mut state = self.0.lock().expect("readback state");
        state.0 = Some(result);
        if let Some(waker) = state.1.take() {
            waker.wake();
        }
    }
}

impl Future for Mapped {
    type Output = Result<(), String>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut state = self.0.lock().expect("readback state");
        match state.0.take() {
            Some(result) => Poll::Ready(result),
            None => {
                state.1 = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use vello::kurbo::{Affine, Rect};
    use vello::peniko::Fill;

    use super::*;

    #[test]
    fn a_rectangle_drawn_offscreen_reads_back_at_its_pixels() {
        let mut gpu = pollster::block_on(Gpu::new()).expect("gpu");
        let mut scene = Scene::new();
        scene.fill(Fill::NonZero, Affine::IDENTITY, Color::from_rgb8(255, 0, 0), None, &Rect::new(16.0, 8.0, 48.0, 24.0));
        let rgba = pollster::block_on(gpu.render(&scene, 64, 32, Color::from_rgb8(0, 0, 255))).expect("frame");
        let px = |x: usize, y: usize| &rgba[(y * 64 + x) * 4..(y * 64 + x) * 4 + 4];
        assert_eq!(rgba.len(), 64 * 32 * 4);
        assert_eq!(px(20, 10), [255, 0, 0, 255], "inside the rectangle");
        assert_eq!(px(47, 23), [255, 0, 0, 255], "last pixel inside");
        assert_eq!(px(48, 23), [0, 0, 255, 255], "first pixel right of it");
        assert_eq!(px(2, 2), [0, 0, 255, 255], "background");
    }
}
