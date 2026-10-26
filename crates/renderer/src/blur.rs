//! The CSS `text-shadow` blur on the GPU (D3): vello has no blur for arbitrary
//! shapes, so the shadow's silhouette is drawn offscreen, blurred here with a
//! separable Gaussian (sigma = blur radius / 2, as CSS specifies), and handed
//! back to vello as an image tinted with the shadow color.
//!
//! Pass one blurs the silhouette's alpha horizontally into an `r32float`
//! texture; pass two blurs that vertically and writes the shadow color with
//! the blurred alpha. Pixels outside the texture count as transparent.

const COMMON: &str = r"
struct Params {
    color: vec4<f32>,
    sigma: f32,
    reach: i32,
    mask: i32,
    _pad: i32,
}

@group(0) @binding(0) var<uniform> params: Params;

fn cube(value: f32) -> f32 { let x = max(value, 0.0); return x*x*x; }
fn triangle(value: f32) -> f32 { let x = max(value, 0.0); return x*(x+1.0)*0.5; }
fn box_cdf(value: f32, widths: vec3<f32>) -> f32 {
    let n = value + (widths.x+widths.y+widths.z)*0.5;
    return (cube(n)-cube(n-widths.x)-cube(n-widths.y)-cube(n-widths.z)
        +cube(n-widths.x-widths.y)+cube(n-widths.x-widths.z)+cube(n-widths.y-widths.z)
        -cube(n-widths.x-widths.y-widths.z))/6.0;
}
fn weight(offset: i32) -> f32 {
    if (params.mask != 0) {
        let d = params.color.x;
        let scale = params.color.y;
        let even = (i32(d) % 2) == 0;
        if (scale == 1.0) {
            let n = f32(offset) + select(3.0*(d-1.0)/2.0, 3.0*d/2.0-1.0, even);
            let last = d + select(0.0, 1.0, even);
            return max(0.0, triangle(n+1.0)-2.0*triangle(n-d+1.0)-triangle(n-last+1.0)
                +triangle(n-2.0*d+1.0)+2.0*triangle(n-d-last+1.0)-triangle(n-2.0*d-last+1.0));
        }
        let widths = vec3<f32>(d,d,d+select(0.0,1.0,even))/scale;
        return max(0.0, box_cdf(f32(offset)+0.5,widths)-box_cdf(f32(offset)-0.5,widths));
    }
    let d = f32(offset);
    return exp(-(d * d) / (2.0 * params.sigma * params.sigma));
}
";

const BLUR_X: &str = r"
@group(0) @binding(1) var silhouette: texture_2d<f32>;
@group(0) @binding(2) var horizontal: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<i32>(textureDimensions(silhouette));
    let p = vec2<i32>(id.xy);
    if (p.x >= size.x || p.y >= size.y) { return; }
    var sum = 0.0;
    var total = 0.0;
    for (var k = -params.reach; k <= params.reach; k++) {
        let w = weight(k);
        total += w;
        let x = p.x + k;
        if (x >= 0 && x < size.x) {
            sum += w * textureLoad(silhouette, vec2<i32>(x, p.y), 0).a;
        }
    }
    textureStore(horizontal, p, vec4<f32>(sum / total, 0.0, 0.0, 0.0));
}
";

const BLUR_Y: &str = r"
@group(0) @binding(1) var blurred: texture_2d<f32>;
@group(0) @binding(2) var shadow: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<i32>(textureDimensions(blurred));
    let p = vec2<i32>(id.xy);
    if (p.x >= size.x || p.y >= size.y) { return; }
    var sum = 0.0;
    var total = 0.0;
    for (var k = -params.reach; k <= params.reach; k++) {
        let w = weight(k);
        total += w;
        let y = p.y + k;
        if (y >= 0 && y < size.y) {
            sum += w * textureLoad(blurred, vec2<i32>(p.x, y), 0).r;
        }
    }
    textureStore(shadow, p, vec4<f32>(params.color.rgb, params.color.a * sum / total));
}
";

// CSS filter blur uses sigma = radius; work in premultiplied RGBA between passes.
const BLUR_CONTENT: &str = r"
@group(0) @binding(1) var input: texture_2d<f32>;
@group(0) @binding(2) var output: texture_storage_2d<OUTPUT_FORMAT, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<i32>(textureDimensions(input));
    let p = vec2<i32>(id.xy);
    if (p.x >= size.x || p.y >= size.y) { return; }
    var sum = vec4<f32>(0.0);
    var total = 0.0;
    for (var k = -params.reach; k <= params.reach; k++) {
        let w = weight(k);
        total += w;
        let q = p + select(vec2<i32>(0, k), vec2<i32>(k, 0), HORIZONTAL);
        if (all(q >= vec2<i32>(0)) && all(q < size)) {
            var pixel = textureLoad(input, q, 0);
            if (HORIZONTAL) { pixel = vec4<f32>(pixel.rgb * pixel.a, pixel.a); }
            sum += w * pixel;
        }
    }
    var pixel = sum / total;
    if (!HORIZONTAL) {
        pixel = vec4<f32>(select(vec3<f32>(0.0), pixel.rgb / max(pixel.a, 0.000001), pixel.a > 0.0), pixel.a);
    }
    textureStore(output, p, pixel);
}
";

pub struct Blur {
    layout_x: wgpu::BindGroupLayout,
    layout_y: wgpu::BindGroupLayout,
    blur_x: wgpu::ComputePipeline,
    blur_y: wgpu::ComputePipeline,
    content_layout_x: wgpu::BindGroupLayout,
    content_layout_y: wgpu::BindGroupLayout,
    content_x: wgpu::ComputePipeline,
    content_y: wgpu::ComputePipeline,
}

fn entry(binding: u32, ty: wgpu::BindingType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::COMPUTE, ty, count: None }
}

pub(crate) fn layout(device: &wgpu::Device, input: wgpu::TextureSampleType, output: wgpu::TextureFormat) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("maleo-blur"),
        entries: &[
            entry(0, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }),
            entry(1, wgpu::BindingType::Texture { sample_type: input, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }),
            entry(
                2,
                wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: output,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
            ),
        ],
    })
}

enum Kind {
    Shadow,
    Content,
    BoxMask,
}

impl Blur {
    pub fn new(device: &wgpu::Device) -> Self {
        let pipeline = |name: &str, source: &str, layout: &wgpu::BindGroupLayout| {
            let module = device
                .create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(name), source: wgpu::ShaderSource::Wgsl(format!("{COMMON}{source}").into()) });
            let pipeline_layout =
                device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some(name), bind_group_layouts: &[Some(layout)], immediate_size: 0 });
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(name),
                layout: Some(&pipeline_layout),
                module: &module,
                entry_point: Some("main"),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let layout_x = layout(device, wgpu::TextureSampleType::Float { filterable: true }, wgpu::TextureFormat::R32Float);
        let layout_y = layout(device, wgpu::TextureSampleType::Float { filterable: false }, wgpu::TextureFormat::Rgba8Unorm);
        let content_layout_x = layout(device, wgpu::TextureSampleType::Float { filterable: true }, wgpu::TextureFormat::Rgba16Float);
        let content_layout_y = layout(device, wgpu::TextureSampleType::Float { filterable: true }, wgpu::TextureFormat::Rgba8Unorm);
        let source_x = format!("const HORIZONTAL: bool = true;{}", BLUR_CONTENT.replace("OUTPUT_FORMAT", "rgba16float"));
        let source_y = format!("const HORIZONTAL: bool = false;{}", BLUR_CONTENT.replace("OUTPUT_FORMAT", "rgba8unorm"));
        Self {
            blur_x: pipeline("maleo-blur-x", BLUR_X, &layout_x),
            blur_y: pipeline("maleo-blur-y", BLUR_Y, &layout_y),
            content_x: pipeline("maleo-content-blur-x", &source_x, &content_layout_x),
            content_y: pipeline("maleo-content-blur-y", &source_y, &content_layout_y),
            layout_x,
            layout_y,
            content_layout_x,
            content_layout_y,
        }
    }

    /// Blurs the alpha of `silhouette` (an `Rgba8Unorm` texture vello drew)
    /// with blur radius `radius` and returns a same-size texture of `color`
    /// (straight-alpha RGBA, 0..1) at the blurred alpha.
    pub fn shadow(&self, device: &wgpu::Device, queue: &wgpu::Queue, silhouette: &wgpu::Texture, radius: f32, color: [f32; 4]) -> wgpu::Texture {
        self.run(device, queue, silhouette, radius, color, Kind::Shadow)
    }

    pub fn content(&self, device: &wgpu::Device, queue: &wgpu::Queue, content: &wgpu::Texture, radius: f32) -> wgpu::Texture {
        self.run(device, queue, content, radius, [0.0; 4], Kind::Content)
    }

    /// SVG/Skia uses the specified three-box Gaussian approximation for broad masks.
    /// https://www.w3.org/TR/filter-effects-1/#feGaussianBlurElement
    /// Skia src/core/SkBlurEngine.cpp, GaussPass (revision c6e63919c318).
    pub fn mask(&self, device: &wgpu::Device, queue: &wgpu::Queue, input: &wgpu::Texture, sigma: f32, scale: f32) -> wgpu::Texture {
        let window = (sigma * 3.0 * (2.0 * std::f32::consts::PI).sqrt() / 4.0 + 0.5).floor().max(1.0);
        self.run(device, queue, input, sigma / scale, [window, scale, 0.0, 0.0], if sigma >= 2.0 { Kind::BoxMask } else { Kind::Content })
    }

    fn run(&self, device: &wgpu::Device, queue: &wgpu::Queue, silhouette: &wgpu::Texture, radius: f32, color: [f32; 4], kind: Kind) -> wgpu::Texture {
        let content = !matches!(kind, Kind::Shadow);
        let mask = matches!(kind, Kind::BoxMask);
        let size = silhouette.size();
        let texture = |format, usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some("maleo-shadow"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let middle = texture(
            if content { wgpu::TextureFormat::Rgba16Float } else { wgpu::TextureFormat::R32Float },
            wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let output = texture(
            wgpu::TextureFormat::Rgba8Unorm,
            wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
        );
        let sigma = (if content { radius } else { radius / 2.0 }).max(0.01);
        let mut params = [0u8; 32];
        for (i, value) in color.iter().chain([sigma].iter()).enumerate() {
            params[i * 4..i * 4 + 4].copy_from_slice(&value.to_le_bytes());
        }
        let reach = if mask { ((3.0 * color[0] + 1.0) / (2.0 * color[1]) + 1.0).ceil() as i32 } else { (sigma * 3.0).ceil() as i32 };
        params[20..24].copy_from_slice(&reach.to_le_bytes());
        params[24..28].copy_from_slice(&i32::from(mask).to_le_bytes());
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("maleo-blur-params"),
            size: params.len() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&uniform, 0, &params);
        let view = |t: &wgpu::Texture| t.create_view(&Default::default());
        let group = |layout: &wgpu::BindGroupLayout, input: &wgpu::TextureView, out: &wgpu::TextureView| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("maleo-blur"),
                layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(input) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(out) },
                ],
            })
        };
        let (middle_view, output_view) = (view(&middle), view(&output));
        let group_x = group(if content { &self.content_layout_x } else { &self.layout_x }, &view(silhouette), &middle_view);
        let group_y = group(if content { &self.content_layout_y } else { &self.layout_y }, &middle_view, &output_view);
        let mut encoder = device.create_command_encoder(&Default::default());
        let (groups_x, groups_y) = (size.width.div_ceil(8), size.height.div_ceil(8));
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(if content { &self.content_x } else { &self.blur_x });
            pass.set_bind_group(0, &group_x, &[]);
            pass.dispatch_workgroups(groups_x, groups_y, 1);
        }
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(if content { &self.content_y } else { &self.blur_y });
            pass.set_bind_group(0, &group_y, &[]);
            pass.dispatch_workgroups(groups_x, groups_y, 1);
        }
        queue.submit([encoder.finish()]);
        output
    }
}

#[cfg(test)]
mod tests {
    use vello::Scene;
    use vello::kurbo::{Affine, Rect};
    use vello::peniko::{Color, Fill};

    use crate::gpu::Gpu;

    /// Spike C's CPU blur: the reference the GPU pass replaces.
    fn cpu_blur(alpha: &[f32], w: usize, h: usize, radius: f32) -> Vec<f32> {
        let sigma = (radius / 2.0).max(0.01);
        let reach = (sigma * 3.0).ceil() as i64;
        let kernel: Vec<f32> = (-reach..=reach).map(|i| (-((i * i) as f32) / (2.0 * sigma * sigma)).exp()).collect();
        let total: f32 = kernel.iter().sum();
        let pass = |src: &[f32], horizontal: bool| -> Vec<f32> {
            let mut out = vec![0.0; w * h];
            for y in 0..h {
                for x in 0..w {
                    let mut acc = 0.0;
                    for (k, weight) in kernel.iter().enumerate() {
                        let d = k as i64 - reach;
                        let (sx, sy) = if horizontal { (x as i64 + d, y as i64) } else { (x as i64, y as i64 + d) };
                        if sx >= 0 && sy >= 0 && (sx as usize) < w && (sy as usize) < h {
                            acc += src[sy as usize * w + sx as usize] * weight;
                        }
                    }
                    out[y * w + x] = acc / total;
                }
            }
            out
        };
        pass(&pass(alpha, true), false)
    }

    #[test]
    fn content_blur_preserves_color_and_premultiplied_alpha_edges() {
        let mut gpu = pollster::block_on(Gpu::new()).expect("gpu");
        let blur = super::Blur::new(&gpu.device);
        let (width, height) = (96, 64);
        let mut scene = Scene::new();
        scene.fill(Fill::NonZero, Affine::IDENTITY, Color::from_rgba8(255, 0, 0, 255), None, &Rect::new(20.0, 16.0, 48.0, 48.0));
        scene.fill(Fill::NonZero, Affine::IDENTITY, Color::from_rgba8(0, 0, 255, 128), None, &Rect::new(48.0, 16.0, 76.0, 48.0));
        let target = gpu.target(width, height);
        gpu.draw(&scene, &target.create_view(&Default::default()), width, height, Color::TRANSPARENT).unwrap();
        let source = pollster::block_on(gpu.read(&target)).unwrap();
        let output = blur.content(&gpu.device, &gpu.queue, &target, 4.0);
        let actual = pollster::block_on(gpu.read(&output)).unwrap();
        let channel = |channel: usize| {
            let values: Vec<f32> = source
                .as_chunks::<4>()
                .0
                .iter()
                .map(|p| {
                    let alpha = f32::from(p[3]) / 255.0;
                    if channel == 3 { alpha } else { f32::from(p[channel]) / 255.0 * alpha }
                })
                .collect();
            cpu_blur(&values, width as usize, height as usize, 8.0)
        };
        let expected = [channel(0), channel(1), channel(2), channel(3)];
        for (i, pixel) in actual.as_chunks::<4>().0.iter().enumerate() {
            assert!((f32::from(pixel[3]) - expected[3][i] * 255.0).abs() <= 1.0, "alpha at {i}");
            if expected[3][i] > 1.0 / 255.0 {
                for c in 0..3 {
                    assert!((f32::from(pixel[c]) - expected[c][i] / expected[3][i] * 255.0).abs() <= 2.0, "color {c} at {i}");
                }
            }
        }
    }

    #[test]
    fn the_gpu_blur_matches_the_spike_cpu_blur() {
        let mut gpu = pollster::block_on(Gpu::new()).expect("gpu");
        let blur = super::Blur::new(&gpu.device);
        let (w, h) = (96u32, 64u32);
        let mut scene = Scene::new();
        scene.fill(Fill::NonZero, Affine::IDENTITY, Color::WHITE, None, &Rect::new(30.0, 20.0, 66.0, 44.0));
        let silhouette = gpu.target(w, h);
        gpu.draw(&scene, &silhouette.create_view(&Default::default()), w, h, Color::TRANSPARENT).unwrap();
        let alpha: Vec<f32> = pollster::block_on(gpu.read(&silhouette)).unwrap().as_chunks::<4>().0.iter().map(|p| f32::from(p[3]) / 255.0).collect();
        let shadow = blur.shadow(&gpu.device, &gpu.queue, &silhouette, 12.0, [0.0, 0.0, 1.0, 0.5]);
        let pixels = pollster::block_on(gpu.read(&shadow)).unwrap();
        let expected = cpu_blur(&alpha, w as usize, h as usize, 12.0);
        for (i, (p, e)) in pixels.as_chunks::<4>().0.iter().zip(expected).enumerate() {
            assert_eq!(&p[..3], &[0, 0, 255], "tint at {i}");
            let want = (e * 0.5 * 255.0).round();
            assert!((f32::from(p[3]) - want).abs() <= 1.0, "alpha at {i}: {} vs {want}", p[3]);
        }
    }
}
