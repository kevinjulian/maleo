//! CSS brightness → contrast → saturation on straight sRGB, preserving alpha.
//! Vello renders/readbacks straight RGBA8; no linear-light conversion belongs here.

use crate::storyboard::ClipColor;

const SOURCE: &str = r"
struct Params { values:vec4<f32>, box:vec4<f32> }
@group(0) @binding(0) var<uniform> data:Params;
@group(0) @binding(1) var input: texture_2d<f32>;
@group(0) @binding(2) var output: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let params=data.values;
    let p = vec2<i32>(id.xy);
    if (any(p >= vec2<i32>(textureDimensions(input)))) { return; }
    let pixel = textureLoad(input, p, 0);
    if (params.w == 4.0) {
        let size = vec2<f32>(textureDimensions(input));
        let q = vec2<f32>(p) + vec2(0.5) - size * 0.5;
        var result = vec4<f32>(0.0);
        // An edge-on plane has no area, even if a sample hits its center line.
        if (abs(params.x) >= 0.000001) {
            let denominator = params.x * params.z - params.y * q.x;
            if (abs(denominator) > 0.000001) {
                let x = q.x * params.z / denominator;
                let source = vec2(x, q.y * (1.0 + params.y * x / params.z)) + size * 0.5;
                if (all(source >= vec2(0.0)) && all(source < size)) {
                    let uv = source - vec2(0.5);
                    let low = vec2<i32>(floor(uv));
                    let high = vec2<i32>(size) - vec2(1);
                    let f = fract(uv);
                    let a = textureLoad(input, clamp(low, vec2(0), high), 0);
                    let b = textureLoad(input, clamp(low + vec2(1,0), vec2(0), high), 0);
                    let c = textureLoad(input, clamp(low + vec2(0,1), vec2(0), high), 0);
                    let d = textureLoad(input, clamp(low + vec2(1,1), vec2(0), high), 0);
                    let top = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), f.x);
                    let bottom = mix(vec4(c.rgb * c.a, c.a), vec4(d.rgb * d.a, d.a), f.x);
                    let sample = mix(top, bottom, f.y);
                    result = vec4(select(vec3(0.0), sample.rgb / max(sample.a, 0.000001), sample.a > 0.0), sample.a);
                }
            }
        }
        textureStore(output,p,result);
        return;
    }
    if (params.w == 1.0) {
        let rgb = select(vec3<f32>(0.0), pixel.rgb, pixel.a > 0.0);
        let alpha = clamp(2.777-dot(rgb,vec3<f32>(1.181,3.973,0.402)),0.0,1.0);
        textureStore(output,p,vec4<f32>(select(vec3<f32>(0.0),rgb,alpha > 0.0),alpha));
        return;
    }
    if (params.w == 2.0 || params.w == 3.0) {
        let xy=vec2<f32>(p)+vec2<f32>(0.5)+data.box.xy;
        var alpha=0.0;
        if (all(xy>=vec2<f32>(0.0)) && all(xy<data.box.zw)) {
            let period=select(22.0,34.0,params.w==2.0);
            let tile=xy-floor(xy/period)*period;
            let distance=select(length(tile),(tile.x+tile.y)/sqrt(2.0),params.w==2.0);
            let repeat=select(10.0,20.0,params.w==2.0);
            let at=distance-floor(distance/repeat)*repeat;
            let low=select(2.0,10.0,params.w==2.0);
            let high=select(3.0,12.0,params.w==2.0);
            alpha=select(1.0,select(0.68,0.82,params.w==2.0),at>=low && at<high);
        }
        let a=pixel.a*alpha;
        textureStore(output,p,vec4<f32>(select(vec3<f32>(0.0),pixel.rgb,a>0.0),a));return;
    }
    var rgb = clamp(pixel.rgb * params.x, vec3<f32>(0.0), vec3<f32>(1.0));
    rgb = clamp((rgb - vec3<f32>(0.5)) * params.y + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
    let luma = dot(rgb, vec3<f32>(0.213, 0.715, 0.072));
    rgb = clamp(vec3<f32>(luma) + params.z * (rgb - vec3<f32>(luma)), vec3<f32>(0.0), vec3<f32>(1.0));
    textureStore(output, p, vec4<f32>(select(vec3<f32>(0.0), rgb, pixel.a > 0.0), pixel.a));
}


";

pub struct Correction {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::ComputePipeline,
}

impl Correction {
    pub fn new(device: &wgpu::Device) -> Self {
        let layout = crate::blur::layout(device, wgpu::TextureSampleType::Float { filterable: true }, wgpu::TextureFormat::Rgba8Unorm);
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("maleo-color"), source: wgpu::ShaderSource::Wgsl(SOURCE.into()) });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("maleo-color"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("maleo-color"),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        Self { layout, pipeline }
    }

    pub fn apply(&self, device: &wgpu::Device, queue: &wgpu::Queue, input: &wgpu::Texture, color: ClipColor) -> wgpu::Texture {
        self.run(device, queue, input, [color.brightness as f32, color.contrast as f32, color.saturation as f32, 0.0], [0.0; 4])
    }

    /// Inverse projection of a CSS rotateY plane with centered perspective.
    pub fn project(&self, device: &wgpu::Device, queue: &wgpu::Queue, input: &wgpu::Texture, degrees: f64) -> wgpu::Texture {
        let angle = degrees.to_radians();
        self.run(device, queue, input, [angle.cos() as f32, angle.sin() as f32, 1000.0, 4.0], [0.0; 4])
    }

    pub fn dark(&self, device: &wgpu::Device, queue: &wgpu::Queue, input: &wgpu::Texture) -> wgpu::Texture {
        self.run(device, queue, input, [0.0, 0.0, 0.0, 1.0], [0.0; 4])
    }

    pub fn texture(&self, device: &wgpu::Device, queue: &wgpu::Queue, input: &wgpu::Texture, mask_box: [f32; 4], paper: bool) -> wgpu::Texture {
        self.run(device, queue, input, [0.0, 0.0, 0.0, if paper { 2.0 } else { 3.0 }], mask_box)
    }

    fn run(&self, device: &wgpu::Device, queue: &wgpu::Queue, input: &wgpu::Texture, values: [f32; 4], mask_box: [f32; 4]) -> wgpu::Texture {
        let output = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("maleo-color"),
            size: input.size(),
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("maleo-color"),
            size: 32,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bytes: Vec<u8> = values.into_iter().chain(mask_box).flat_map(f32::to_le_bytes).collect();
        queue.write_buffer(&params, 0, &bytes);
        let input_view = input.create_view(&Default::default());
        let output_view = output.create_view(&Default::default());
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("maleo-color"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: params.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&input_view) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&output_view) },
            ],
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(input.width().div_ceil(8), input.height().div_ceil(8), 1);
        }
        queue.submit([encoder.finish()]);
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpu::Gpu;

    #[test]
    fn projection_keeps_identity_alpha_and_discards_edge_on_planes() {
        let gpu = pollster::block_on(Gpu::new()).unwrap();
        let correction = Correction::new(&gpu.device);
        let target = gpu.target(3, 3);
        let mut input = [40, 80, 120, 128].repeat(9);
        input[0..4].copy_from_slice(&[200, 100, 50, 0]);
        gpu.queue.write_texture(
            target.as_image_copy(),
            &input,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(12), rows_per_image: Some(3) },
            target.size(),
        );
        let identity = correction.project(&gpu.device, &gpu.queue, &target, 0.0);
        let actual = pollster::block_on(gpu.read(&identity)).unwrap();
        input[0..4].fill(0);
        assert_eq!(actual, input);
        let edge = correction.project(&gpu.device, &gpu.queue, &target, 90.0);
        assert!(pollster::block_on(gpu.read(&edge)).unwrap().iter().all(|b| *b == 0));
        let rotated = correction.project(&gpu.device, &gpu.queue, &target, 60.0);
        let actual = pollster::block_on(gpu.read(&rotated)).unwrap();
        assert_eq!(&actual[16..20], &[40, 80, 120, 128]);
        assert_eq!(&actual[0..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn texture_masks_repeat_in_local_pixels_and_preserve_source_color() {
        let gpu = pollster::block_on(Gpu::new()).unwrap();
        let correction = Correction::new(&gpu.device);
        let target = gpu.target(64, 64);
        let input = [120, 60, 30, 128].repeat(64 * 64);
        gpu.queue.write_texture(
            target.as_image_copy(),
            &input,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(256), rows_per_image: Some(64) },
            target.size(),
        );
        for (paper, points) in [(true, vec![(7, 7, 105), (8, 8, 128), (41, 7, 105)]), (false, vec![(2, 0, 87), (3, 0, 128), (24, 0, 87)])] {
            let output = correction.texture(&gpu.device, &gpu.queue, &target, [0.0, 0.0, 64.0, 64.0], paper);
            let pixels = pollster::block_on(gpu.read(&output)).unwrap();
            for (x, y, alpha) in points {
                let p = &pixels[(y * 64 + x) * 4..(y * 64 + x) * 4 + 4];
                assert_eq!(p, [120, 60, 30, alpha], "paper={paper} at {x},{y}");
            }
        }
        let clipped = correction.texture(&gpu.device, &gpu.queue, &target, [-2.0, -2.0, 60.0, 60.0], true);
        let pixels = pollster::block_on(gpu.read(&clipped)).unwrap();
        assert_eq!(&pixels[..4], &[0, 0, 0, 0], "mask clips to local border box");
    }

    #[test]
    fn dark_alpha_matrix_matches_production_transparent_pixels() {
        let gpu = pollster::block_on(Gpu::new()).unwrap();
        let correction = Correction::new(&gpu.device);
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/dark-pixels.json")).unwrap();
        let pixels = fixture["pixels"].as_array().unwrap();
        let reference = image::open(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(fixture["reference"].as_str().unwrap())).unwrap().to_rgba8();
        let input: Vec<u8> = pixels.iter().flat_map(|p| p["input"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u8)).collect();
        let target = gpu.target(pixels.len() as u32, 1);
        gpu.queue.write_texture(
            target.as_image_copy(),
            &input,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(pixels.len() as u32 * 4), rows_per_image: Some(1) },
            target.size(),
        );
        let output = correction.dark(&gpu.device, &gpu.queue, &target);
        let actual = pollster::block_on(gpu.read(&output)).unwrap();
        for (i, (pixel, expected)) in actual.as_chunks::<4>().0.iter().zip(pixels).enumerate() {
            for c in 0..4 {
                let want = expected["expected"][c].as_u64().unwrap() as u8;
                assert_eq!(
                    reference.get_pixel(expected["position"][0].as_u64().unwrap() as u32, expected["position"][1].as_u64().unwrap() as u32).0[c],
                    want,
                    "stale dark-pixel fixture"
                );
                assert!(pixel[c].abs_diff(want) <= 2, "dark pixel {i} channel {c}: {} vs {want}", pixel[c]);
            }
        }
    }

    #[test]
    fn tiny_pixels_match_production_filter_order_and_keep_alpha() {
        let gpu = pollster::block_on(Gpu::new()).unwrap();
        let correction = Correction::new(&gpu.device);
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/color-pixels.json")).unwrap();
        let reference = image::open(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(fixture["reference"].as_str().unwrap())).unwrap().to_rgba8();
        for case in fixture["cases"].as_array().unwrap() {
            let pixels = case["pixels"].as_array().unwrap();
            let input: Vec<u8> = pixels.iter().flat_map(|p| p["input"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u8)).collect();
            let target = gpu.target(pixels.len() as u32, 1);
            gpu.queue.write_texture(
                target.as_image_copy(),
                &input,
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(pixels.len() as u32 * 4), rows_per_image: Some(1) },
                target.size(),
            );
            let output = correction.apply(&gpu.device, &gpu.queue, &target, serde_json::from_value(case["color"].clone()).unwrap());
            let actual = pollster::block_on(gpu.read(&output)).unwrap();
            for (i, (pixel, expected)) in actual.as_chunks::<4>().0.iter().zip(pixels).enumerate() {
                assert_eq!(pixel[3], input[i * 4 + 3], "alpha changed");
                if pixel[3] == 0 {
                    assert_eq!(pixel, &[0, 0, 0, 0]);
                    continue;
                }
                for c in 0..4 {
                    let want = expected["expected"][c].as_u64().unwrap() as u8;
                    assert_eq!(
                        reference.get_pixel(expected["position"][0].as_u64().unwrap() as u32, expected["position"][1].as_u64().unwrap() as u32).0[c],
                        want,
                        "stale production pixel fixture"
                    );
                    assert!(pixel[c].abs_diff(want) <= 2, "{} pixel {i} channel {c}: {} vs {want}", case["color"], pixel[c]);
                }
            }
        }
    }
}
