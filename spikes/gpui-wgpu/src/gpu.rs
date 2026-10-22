//! The wgpu side of the spike: a stand-in decoded frame is uploaded, one
//! composite pass draws it with an animated overlay, and the result is read
//! back to CPU memory (integration path 1).

use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const WIDTH: u32 = 1920;
pub const HEIGHT: u32 = 1080;
const BYTES_PER_ROW: u32 = WIDTH * 4; // 7680, already a multiple of 256
const FRAME_BYTES: u64 = (BYTES_PER_ROW * HEIGHT) as u64;
/// Distinct source frames cycled through, so every upload carries new pixels.
const SOURCE_FRAMES: usize = 4;

const SHADER: &str = r#"
struct Uniforms { t: f32, _p0: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
    let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var out: VsOut;
    out.pos = vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(xy.x, 1.0 - xy.y);
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    var color = textureSample(src, samp, in.uv);
    // Animated overlay: a moving translucent lower-third bar and a disc.
    let bar_x = fract(u.t * 0.25);
    if (in.uv.y > 0.78 && in.uv.y < 0.9 && in.uv.x < bar_x) {
        color = mix(color, vec4<f32>(0.1, 0.1, 0.12, 1.0), 0.75);
    }
    let c = vec2<f32>(0.5 + 0.3 * cos(u.t), 0.4 + 0.2 * sin(u.t * 1.3));
    let d = distance(in.uv * vec2<f32>(1.7778, 1.0), c * vec2<f32>(1.7778, 1.0));
    if (d < 0.08) {
        color = mix(color, vec4<f32>(1.0, 0.8, 0.1, 1.0), 0.85);
    }
    return color;
}
"#;

pub struct Compositor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    source: wgpu::Texture,
    target: wgpu::Texture,
    target_view: wgpu::TextureView,
    readback: wgpu::Buffer,
    uniforms: wgpu::Buffer,
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    frames: Vec<Vec<u8>>,
    pub adapter_info: String,
}

/// Where the time of one produced frame went.
#[derive(Clone, Copy, Default)]
pub struct FrameCost {
    pub upload: Duration,
    pub composite_and_readback: Duration,
}

impl Compositor {
    pub fn new() -> Self {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(
            instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() }),
        )
        .expect("a wgpu adapter");
        let info = adapter.get_info();
        let adapter_info = format!("{} ({:?})", info.name, info.backend);
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).expect("a wgpu device");

        let extent = wgpu::Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 };
        let source = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("source"),
            size: extent,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        // BGRA, premultiplied (opaque here): the byte order gpui's sprite atlas expects.
        let target = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("target"),
            size: extent,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let target_view = target.create_view(&Default::default());
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: FRAME_BYTES,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniforms"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("composite"), source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("composite"),
            layout: None,
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::TextureFormat::Bgra8Unorm.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        let source_view = source.create_view(&Default::default());
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("composite"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&source_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) },
                wgpu::BindGroupEntry { binding: 2, resource: uniforms.as_entire_binding() },
            ],
        });

        Self {
            device,
            queue,
            source,
            target,
            target_view,
            readback,
            uniforms,
            pipeline,
            bind_group,
            frames: (0..SOURCE_FRAMES).map(source_frame).collect(),
            adapter_info,
        }
    }

    /// Produce frame `index`: upload, composite, read back into `out` (BGRA).
    pub fn produce(&self, index: u64, t: f32, out: &mut Vec<u8>) -> FrameCost {
        let start = Instant::now();
        let frame = &self.frames[index as usize % SOURCE_FRAMES];
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &self.source, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            frame,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(BYTES_PER_ROW), rows_per_image: Some(HEIGHT) },
            wgpu::Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 },
        );
        let mut uniform = [0u8; 16];
        uniform[..4].copy_from_slice(&t.to_le_bytes());
        self.queue.write_buffer(&self.uniforms, 0, &uniform);
        let uploaded = Instant::now();

        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("composite"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.target_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &self.target, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo {
                buffer: &self.readback,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(BYTES_PER_ROW), rows_per_image: Some(HEIGHT) },
            },
            wgpu::Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 },
        );
        self.queue.submit([encoder.finish()]);

        let slice = self.readback.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None }).expect("device poll");
        rx.recv().expect("map callback").expect("readback map");
        out.clear();
        out.extend_from_slice(&slice.get_mapped_range().expect("mapped range"));
        self.readback.unmap();

        FrameCost { upload: uploaded - start, composite_and_readback: uploaded.elapsed() }
    }
}

/// A stand-in for a decoded video frame: a gradient that differs per index.
fn source_frame(index: usize) -> Vec<u8> {
    let mut data = Vec::with_capacity(FRAME_BYTES as usize);
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            data.push((x * 255 / WIDTH) as u8);
            data.push((y * 255 / HEIGHT) as u8);
            data.push((index * 60 % 256) as u8);
            data.push(255);
        }
    }
    data
}
