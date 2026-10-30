//! The parity gate (D6): every golden corpus case drawn by the Rust renderer
//! and compared with its Remotion reference by SSIM, over the whole frame and
//! over each region the case lists. A frame passes only when both scores meet
//! the manifest thresholds, geometry sits within 2 px of the reference's,
//! and its coverage report is empty. Approved photographic cases can name a
//! high-contrast companion for geometry while retaining every SSIM check.
//!
//! On failure the Rust frame and a difference image go to `target/golden/`
//! (CI uploads that directory). References come from
//! `packages/video/scripts/render-golden.ts`; see `crates/renderer/AGENTS.md`.

mod compare;
mod sha256;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use compare::Image;
use maleo_media::visual_pool::FrameIdentity;
use maleo_renderer::coverage::{self, SUPPORTED};
use maleo_renderer::frame::Renderer;
use maleo_renderer::storyboard::Storyboard;
use maleo_renderer::timeline::FPS;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    remotion: String,
    image: String,
    emoji_font: EmojiFont,
    thresholds: Thresholds,
    /// Cases allowed below the default thresholds, each with its reason.
    lowered: BTreeMap<String, Lowered>,
    /// Every declared supported option names its exercising case and frames.
    supported_options: BTreeMap<String, OptionEvidence>,
}

#[derive(Deserialize)]
struct OptionEvidence {
    case: String,
    frames: Vec<i64>,
}

#[derive(Deserialize)]
struct EmojiFont {
    file: String,
    sha256: String,
}

#[derive(Deserialize, Clone, Copy)]
struct Thresholds {
    frame: f64,
    region: f64,
}

#[derive(Deserialize)]
struct Lowered {
    frame: Option<f64>,
    region: Option<f64>,
    reason: String,
}

#[derive(Deserialize)]
struct CaseSpec {
    width: u32,
    height: u32,
    frames: Vec<i64>,
    #[serde(default)]
    regions: Vec<Region>,
    #[serde(default)]
    options: Vec<String>,
    #[serde(default)]
    geometry: Option<Geometry>,
    #[serde(default, rename = "videoFrames")]
    video_frames: Vec<VideoFrames>,
}

#[derive(Deserialize)]
struct VideoFrames {
    url: String,
    revision: String,
    frames: Vec<VideoSample>,
}

#[derive(Deserialize)]
struct VideoSample {
    start: f64,
    end: f64,
    file: String,
}

#[derive(Deserialize)]
struct Geometry {
    case: String,
    reason: String,
}

#[derive(Deserialize)]
struct Region {
    name: String,
    rect: [usize; 4],
}

struct Case {
    name: String,
    dir: PathBuf,
    spec: CaseSpec,
    storyboard: Storyboard,
}

/// How far a region's box or ink may sit from the reference's, in pixels
/// (spike C's structural check).
const MAX_EDGE_DELTA: usize = 2;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("corpus")
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> T {
    serde_json::from_str(&fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn manifest() -> Manifest {
    read_json(&corpus().join("manifest.json"))
}

fn cases() -> Vec<Case> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(corpus()).expect("corpus").map(|e| e.expect("entry").path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    dirs.into_iter()
        .map(|dir| {
            let name = dir.file_name().expect("name").to_string_lossy().into_owned();
            let storyboard = Storyboard::parse(&fs::read_to_string(dir.join("storyboard.json")).expect("storyboard.json"))
                .unwrap_or_else(|e| panic!("{name}: storyboard does not decode: {e}"));
            Case { spec: read_json(&dir.join("case.json")), name, dir, storyboard }
        })
        .collect()
}

/// `media/<file>` for every file in the case's media directory.
fn media_files(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(dir.join("media")) else { return Vec::new() };
    let mut files: Vec<(String, PathBuf)> =
        entries.map(|e| e.expect("entry").path()).map(|p| (format!("media/{}", p.file_name().expect("name").to_string_lossy()), p)).collect();
    files.sort();
    files
}

fn read_image(path: &Path) -> Image {
    let decoded = image::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())).to_rgba8();
    Image { width: decoded.width() as usize, height: decoded.height() as usize, rgba: decoded.into_raw() }
}

fn load_images(renderer: &mut Renderer, case: &Case) {
    for (url, path) in media_files(&case.dir) {
        if case.spec.video_frames.iter().any(|source| source.url == url) {
            continue;
        }
        let image = read_image(&path);
        renderer.put_image(&url, image.width as u32, image.height as u32, image.rgba).expect("media");
    }
}

/// Decode once during fixture authoring; native CI consumes the exact presentation samples.
fn supply_video_frames(renderer: &mut Renderer, case: &Case, frame: i64) {
    for request in maleo_renderer::media_requests::video_requests(&case.storyboard, frame, FPS) {
        let time = request.time.expect("supported source time");
        let source = case.spec.video_frames.iter().find(|source| source.url == request.url).expect("video sample inventory");
        let index = source
            .frames
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| (a.start - time).abs().total_cmp(&(b.start - time).abs()).then_with(|| b.start.total_cmp(&a.start)))
            .map(|(index, _)| index)
            .expect("source samples");
        let sample = &source.frames[index];
        let start = if index == 0 { 0.0 } else { (source.frames[index - 1].start + sample.start) / 2.0 };
        let end = source.frames.get(index + 1).map_or(sample.end, |next| (sample.start + next.start) / 2.0);
        assert!(start <= time && time < end, "source selection window");
        let image = read_image(&case.dir.join(&sample.file));
        let identity = FrameIdentity {
            source_id: source.url.clone(),
            revision: source.revision.clone(),
            start,
            end,
            presentation: Some([sample.start, sample.end]),
            width: image.width as u32,
            height: image.height as u32,
        };
        renderer.put_video(&request, identity, image.rgba).expect("video frame");
    }
}

fn write_png(path: &Path, image: &Image) {
    image::save_buffer(path, &image.rgba, image.width as u32, image.height as u32, image::ExtendedColorType::Rgba8)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
}

fn reference(case: &Case, frame: i64) -> PathBuf {
    case.dir.join("reference").join(format!("{frame}.png"))
}

fn option_problems(manifest: &Manifest, cases: &[Case]) -> Vec<String> {
    let mut problems = Vec::new();
    if manifest.supported_options.is_empty() {
        problems.push("manifest.json has no supported option inventory".into());
    }
    for (option, evidence) in &manifest.supported_options {
        let Some(case) = cases.iter().find(|case| case.name == evidence.case) else {
            problems.push(format!("supported option `{option}` has no corpus case `{}`", evidence.case));
            continue;
        };
        if !case.spec.options.contains(option) {
            problems.push(format!("supported option `{option}` is not exercised by `{}`", case.name));
        }
        if evidence.frames.is_empty() || evidence.frames.iter().any(|frame| !case.spec.frames.contains(frame)) {
            problems.push(format!("supported option `{option}` needs exercising frames in `{}`", case.name));
        }
    }
    for case in cases {
        if let Some(geometry) = &case.spec.geometry {
            let companion = cases.iter().find(|c| c.name == geometry.case);
            if geometry.reason.trim().is_empty() {
                problems.push(format!("{}: geometry companion needs a reason", case.name));
            }
            match companion {
                None => problems.push(format!("{}: missing geometry case `{}`", case.name, geometry.case)),
                Some(c) => {
                    if c.spec.geometry.is_some() || c.spec.regions.is_empty() {
                        problems.push(format!("{}: geometry case must measure its own regions", case.name));
                    }
                    if (c.spec.width, c.spec.height) != (case.spec.width, case.spec.height)
                        || case.spec.frames.iter().any(|frame| !c.spec.frames.contains(frame))
                    {
                        problems.push(format!("{}: geometry case must match dimensions and cover every frame", case.name));
                    }
                }
            }
        }
        for option in &case.spec.options {
            if !manifest.supported_options.contains_key(option) {
                problems.push(format!("{}: option `{option}` is absent from the supported inventory", case.name));
            }
        }
    }
    problems
}

#[test]
fn geometry_companions_cannot_disable_boundary_checks() {
    let manifest = manifest();
    let mut cases = cases();
    let photo = cases.iter().find(|c| c.spec.geometry.is_some()).expect("photographic case");
    let name = photo.name.clone();
    let companion = photo.spec.geometry.as_ref().unwrap().case.clone();
    assert!(option_problems(&manifest, &cases).is_empty());
    let geometry = cases.iter_mut().find(|c| c.name == companion).unwrap();
    geometry.spec.regions.clear();
    assert!(option_problems(&manifest, &cases).iter().any(|p| p.contains("measure its own regions")));
    let geometry = cases.iter_mut().find(|c| c.name == companion).unwrap();
    geometry.spec.frames.clear();
    assert!(option_problems(&manifest, &cases).iter().any(|p| p.contains("cover every frame")));
    cases.iter_mut().find(|c| c.name == name).unwrap().spec.geometry.as_mut().unwrap().reason.clear();
    assert!(option_problems(&manifest, &cases).iter().any(|p| p.contains("needs a reason")));
    cases.retain(|c| c.name != companion);
    assert!(option_problems(&manifest, &cases).iter().any(|p| p.contains("missing geometry case")));
}

#[test]
fn removing_an_options_case_fails_the_corpus_check() {
    let manifest = manifest();
    let mut cases = cases();
    assert!(option_problems(&manifest, &cases).is_empty());
    let (option, evidence) = manifest.supported_options.first_key_value().expect("supported option");
    cases.retain(|case| case.name != evidence.case);
    assert!(option_problems(&manifest, &cases).iter().any(|problem| problem.contains(option) && problem.contains("no corpus case")));
}

#[test]
fn removing_an_options_annotation_or_frame_fails_the_corpus_check() {
    let manifest = manifest();
    let mut cases = cases();
    let (option, evidence) = manifest.supported_options.first_key_value().expect("supported option");
    let case = cases.iter_mut().find(|case| case.name == evidence.case).expect("case");
    case.spec.options.retain(|name| name != option);
    assert!(option_problems(&manifest, &cases).iter().any(|problem| problem.contains(option) && problem.contains("not exercised")));
    let case = cases.iter_mut().find(|case| case.name == evidence.case).expect("case");
    case.spec.options.push(option.clone());
    case.spec.frames.clear();
    assert!(option_problems(&manifest, &cases).iter().any(|problem| problem.contains(option) && problem.contains("exercising frames")));
}

/// The corpus is complete: references for every frame, a case for every
/// supported kind, the emoji font pinned, and a reason for every lowering.
#[test]
fn the_corpus_is_complete() {
    let manifest = manifest();
    let cases = cases();
    let mut problems = option_problems(&manifest, &cases);
    if manifest.remotion.is_empty() || manifest.image.is_empty() {
        problems.push("manifest.json does not name the Remotion version and the image that rendered the references".to_owned());
    }
    let font = fs::read(repo().join(&manifest.emoji_font.file)).expect("bundled emoji font");
    if sha256::hex(&font) != manifest.emoji_font.sha256 {
        problems.push(format!("{} does not match the emoji font pinned in manifest.json", manifest.emoji_font.file));
    }
    for (name, lowered) in &manifest.lowered {
        if lowered.reason.trim().is_empty() {
            problems.push(format!("{name}: a lowered threshold needs a reason"));
        }
        if !cases.iter().any(|c| &c.name == name) {
            problems.push(format!("{name}: lowered threshold for a case that does not exist"));
        }
    }
    let mut drawn: BTreeSet<&str> = BTreeSet::new();
    for case in &cases {
        for source in &case.spec.video_frames {
            assert_eq!(sha256::hex(&fs::read(case.dir.join(&source.url)).expect("source video")), source.revision, "{}: source revision", case.name);
            assert!(!source.frames.is_empty(), "{}: source samples", case.name);
            for (index, sample) in source.frames.iter().enumerate() {
                assert!(sample.start.is_finite() && sample.end.is_finite() && sample.start < sample.end, "invalid presentation interval");
                assert!(case.dir.join(&sample.file).is_file(), "missing decoded sample");
                if index > 0 {
                    assert_eq!(source.frames[index - 1].end, sample.start, "sample continuity");
                }
            }
        }
        let media: BTreeSet<String> = media_files(&case.dir).into_iter().map(|(url, _)| url).collect();
        for &frame in &case.spec.frames {
            if !reference(case, frame).is_file() {
                problems.push(format!("{}: no reference for frame {frame}", case.name));
            }
            for element in coverage::inspect(&case.storyboard, frame, FPS, &|url| media.contains(url)) {
                if element.problems.is_empty() {
                    drawn.insert(element.kind);
                }
            }
        }
    }
    for kind in SUPPORTED {
        if !drawn.contains(kind) {
            problems.push(format!("supported kind `{kind}` has no corpus case"));
        }
    }
    assert!(problems.is_empty(), "corpus check failed:\n  {}", problems.join("\n  "));
}

#[test]
fn animated_elements_draw_identically_out_of_order() {
    let mut renderer = pollster::block_on(Renderer::new()).expect("renderer");
    for case in cases().into_iter().filter(|case| {
        case.name.starts_with("image-keyed-")
            || case.name.starts_with("text-keyed-")
            || case.name == "text-legacy-normalized"
            || case.name.starts_with("camera-")
            || case.name.starts_with("color-")
            || case.name.starts_with("mask-")
            || case.name.starts_with("blend-")
            || case.name.starts_with("reveal-")
            || case.name.starts_with("transition-")
            || case.name.starts_with("effect-")
            || case.name.starts_with("decoration-")
            || case.name.starts_with("pacing-")
            || case.name.starts_with("motion-combined-")
            || case.name.starts_with("shape-")
            || case.name.starts_with("composition-")
            || case.name.starts_with("video-")
    }) {
        load_images(&mut renderer, &case);
        let mut direct = BTreeMap::new();
        for &frame in &case.spec.frames {
            supply_video_frames(&mut renderer, &case, frame);
            let drawn = pollster::block_on(renderer.render(&case.storyboard, frame, case.spec.width, case.spec.height)).expect("frame");
            assert!(drawn.coverage.is_empty(), "{} frame {frame}: {:?}", case.name, drawn.coverage);
            direct.insert(frame, drawn.rgba);
        }
        for &frame in case.spec.frames.iter().rev() {
            supply_video_frames(&mut renderer, &case, frame);
            let drawn = pollster::block_on(renderer.render(&case.storyboard, frame, case.spec.width, case.spec.height)).expect("out-of-order frame");
            if drawn.rgba != direct[&frame] {
                let out = repo().join("target/golden");
                fs::create_dir_all(&out).expect("diagnostics");
                let expected = Image { width: drawn.width as usize, height: drawn.height as usize, rgba: direct[&frame].clone() };
                let actual = Image { width: drawn.width as usize, height: drawn.height as usize, rgba: drawn.rgba };
                write_png(&out.join(format!("{}-{frame}-direct.png", case.name)), &expected);
                write_png(&out.join(format!("{}-{frame}-seek.png", case.name)), &actual);
                let changed = expected.rgba.iter().zip(&actual.rgba).filter(|(a, b)| a != b).count();
                let max = expected.rgba.iter().zip(&actual.rgba).map(|(a, b)| a.abs_diff(*b)).max().unwrap_or(0);
                panic!("{} frame {frame} differs after seeking: {changed} channels, max delta {max}; diagnostics in target/golden", case.name);
            }
        }
    }
}

#[test]
fn fractional_image_boxes_keep_reveal_grid_at_parity() {
    let case = cases().into_iter().find(|c| c.name == "reveal-direct-directions").expect("grid fixture");
    let mut renderer = pollster::block_on(Renderer::new()).unwrap();
    for (url, path) in media_files(&case.dir) {
        let image = read_image(&path);
        renderer.put_image(&url, image.width as u32, image.height as u32, image.rgba).unwrap();
    }
    for frame in [15, 48] {
        let drawn = pollster::block_on(renderer.render(&case.storyboard, frame, case.spec.width, case.spec.height)).unwrap();
        let actual = Image { width: drawn.width as usize, height: drawn.height as usize, rgba: drawn.rgba };
        let expected = read_image(&reference(&case, frame));
        let score = compare::ssim(&expected, &actual);
        assert!(score >= manifest().thresholds.frame, "fractional image box frame {frame}: {score}");
    }
}

#[test]
fn dark_phase_geometry_matches_reference() {
    let mut renderer = pollster::block_on(Renderer::new()).unwrap();
    let mut failures = Vec::new();
    for case in cases().into_iter().filter(|c| ["reveal-dark_pixels_first", "reveal-phase-geometry"].contains(&c.name.as_str())) {
        for (url, path) in media_files(&case.dir) {
            let image = read_image(&path);
            renderer.put_image(&url, image.width as u32, image.height as u32, image.rgba).unwrap();
        }
        for frame in [7, 24, 25, 59] {
            let drawn = pollster::block_on(renderer.render(&case.storyboard, frame, case.spec.width, case.spec.height)).unwrap();
            let actual = Image { width: drawn.width as usize, height: drawn.height as usize, rgba: drawn.rgba };
            let expected = read_image(&reference(&case, frame));
            if std::env::var_os("MALEO_DARK_DIAGNOSTICS").is_some() {
                let out = repo().join("target/golden");
                fs::create_dir_all(&out).unwrap();
                write_png(&out.join(format!("dark-{}-{frame}.png", case.name)), &actual);
            }
            for region in &case.spec.regions {
                let a = compare::ink_box(&actual, region.rect);
                let b = compare::ink_box(&expected, region.rect);
                if !compare::edge_delta(a, b).is_some_and(|d| d <= MAX_EDGE_DELTA) {
                    failures.push(format!("{} frame {frame}: actual {a:?}, expected {b:?}", case.name));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn reveal_textures_match_local_source_pixels() {
    let mut renderer = pollster::block_on(Renderer::new()).unwrap();
    let mut failures = Vec::new();
    for case in cases().into_iter().filter(|c| c.name.starts_with("reveal-texture-")) {
        for (url, path) in media_files(&case.dir) {
            let image = read_image(&path);
            renderer.put_image(&url, image.width as u32, image.height as u32, image.rgba).unwrap();
        }
        let drawn = pollster::block_on(renderer.render(&case.storyboard, 48, case.spec.width, case.spec.height)).unwrap();
        let actual = Image { width: drawn.width as usize, height: drawn.height as usize, rgba: drawn.rgba };
        let expected = read_image(&reference(&case, 48));
        let score = compare::ssim(&expected, &actual);
        if score < manifest().thresholds.frame {
            let out = repo().join("target/golden");
            fs::create_dir_all(&out).unwrap();
            write_png(&out.join(format!("texture-{}.png", case.name)), &actual);
            failures.push(format!("{}: {score}", case.name));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// High-contrast source separates clip geometry from photographic alpha gradients.
#[test]
fn reveal_phase_geometry_keeps_reference_boundaries() {
    assert_cases_at_parity(|case| case.name == "reveal-phase-geometry");
}

/// Every case frame draws at parity with its Remotion reference.
#[test]
fn every_case_is_at_parity_with_remotion() {
    assert_cases_at_parity(|_| true);
}

#[test]
fn video_frames_match_production() {
    assert!(cases().iter().any(|case| case.name.starts_with("video-")), "video corpus is required");
    assert_cases_at_parity(|case| case.name.starts_with("video-"));
}

#[test]
fn sequential_video_frames_equal_direct_draws() {
    let cases: Vec<_> = cases().into_iter().filter(|case| case.name.starts_with("video-")).collect();
    assert!(!cases.is_empty(), "video corpus is required");
    for case in cases {
        let mut direct = BTreeMap::new();
        for &frame in &case.spec.frames {
            let mut renderer = pollster::block_on(Renderer::new()).expect("direct renderer");
            supply_video_frames(&mut renderer, &case, frame);
            let drawn = pollster::block_on(renderer.render(&case.storyboard, frame, case.spec.width, case.spec.height)).expect("direct video frame");
            assert!(drawn.coverage.is_empty(), "{} {frame}: {:?}", case.name, drawn.coverage);
            direct.insert(frame, drawn.rgba);
        }
        let mut renderer = pollster::block_on(Renderer::new()).expect("sequential renderer");
        for frame in 0..=*case.spec.frames.last().expect("frames") {
            supply_video_frames(&mut renderer, &case, frame);
            let drawn = pollster::block_on(renderer.render(&case.storyboard, frame, case.spec.width, case.spec.height)).expect("sequential video frame");
            assert!(drawn.coverage.is_empty(), "{} {frame}: {:?}", case.name, drawn.coverage);
            if let Some(expected) = direct.get(&frame) {
                assert_eq!(&drawn.rgba, expected, "{} frame {frame}", case.name);
            }
        }
    }
}

#[test]
fn sequential_transitions_match_their_reference_presentations() {
    assert_cases_at_parity(|case| case.name.starts_with("transition-series-"));
}

#[test]
fn pixel_transition_rasterizes_grid_before_scaling() {
    assert_cases_at_parity(|case| case.name == "transition-series-pixel");
}

#[test]
fn pixel_transition_geometry_has_stable_reference_edges() {
    assert_cases_at_parity(|case| case.name == "transition-pixel-geometry");
}

#[test]
fn absolute_transitions_match_source_placement() {
    assert_cases_at_parity(|case| case.name.starts_with("transition-absolute-"));
}

#[test]
fn visual_transitions_match_their_placement_branches() {
    assert_cases_at_parity(|case| case.name.starts_with("transition-placement-"));
}

#[test]
fn effects_match_source_envelopes_and_stacking() {
    assert_cases_at_parity(|case| case.name.starts_with("effect-"));
}

#[test]
fn decorations_match_source_layers() {
    assert_cases_at_parity(|case| case.name.starts_with("decoration-"));
}

#[test]
fn pacing_matches_source_chapters_and_composition_duration() {
    assert_cases_at_parity(|case| case.name.starts_with("pacing-"));
}

#[test]
fn grain_geometry_keeps_the_original_edge_limit() {
    assert_cases_at_parity(|case| case.name == "decoration-grain-geometry");
}

#[test]
fn grain_pixels_follow_source_tile_and_repeat_without_time_noise() {
    let case = cases().into_iter().find(|c| c.name == "decoration-grain-repeat").unwrap();
    let mut renderer = pollster::block_on(Renderer::new()).unwrap();
    let a = pollster::block_on(renderer.render(&case.storyboard, 0, case.spec.width, case.spec.height)).unwrap();
    let b = pollster::block_on(renderer.render(&case.storyboard, 29, case.spec.width, case.spec.height)).unwrap();
    assert_eq!(a.rgba, b.rgba, "grain has no time seed");
    let reference = read_image(&reference(&case, 0));
    let max = a.rgba.iter().zip(&reference.rgba).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
    assert!(max <= 2, "grain tile differs by {max} bytes; missing or shifted noise must fail");
    let width = case.spec.width as usize;
    for y in 0..200 {
        for x in 0..200 {
            let pixel = |x, y| &a.rgba[(y * width + x) * 4..(y * width + x) * 4 + 4];
            for repeated in [pixel(x + 200, y), pixel(x, y + 200)] {
                assert!(pixel(x, y).iter().zip(repeated).all(|(a, b)| a.abs_diff(*b) <= 1), "tile period changed beyond interpolation rounding");
            }
        }
    }
}

#[test]
fn combined_motion_treatments_match_source() {
    assert_cases_at_parity(|case| case.name.starts_with("motion-combined-"));
}

#[test]
fn feathered_transparency_preserves_reference_edges() {
    assert_cases_at_parity(|case| case.name == "mask-feather-transparent");
}

#[test]
fn combined_overlap_geometry_keeps_original_thresholds() {
    assert_cases_at_parity(|case| case.name == "motion-combined-overlap-geometry");
}

#[test]
fn combined_boundary_keeps_pacing_visible_with_and_without_render_history() {
    let case = cases().into_iter().find(|c| c.name == "motion-combined-absolute").unwrap();
    let mut renderer = pollster::block_on(Renderer::new()).unwrap();
    for (url, path) in media_files(&case.dir) {
        let image = read_image(&path);
        renderer.put_image(&url, image.width as u32, image.height as u32, image.rgba).unwrap();
    }
    let direct = pollster::block_on(renderer.render(&case.storyboard, 33, 1080, 1920)).unwrap();
    for variant in ["sharp", "sharp-neutral", "crop-neutral"] {
        let mut value: serde_json::Value = read_json(&case.dir.join("storyboard.json"));
        for scene in value["scenes"].as_array_mut().unwrap() {
            scene["layout"]["mask"]["featherPct"] = 0.into();
            if variant != "sharp" {
                scene["layout"].as_object_mut().unwrap().remove("color");
            }
            if variant == "crop-neutral" {
                scene["layout"].as_object_mut().unwrap().remove("mask");
            }
        }
        let storyboard = Storyboard::parse(&value.to_string()).unwrap();
        let drawn = pollster::block_on(renderer.render(&storyboard, 33, 1080, 1920)).unwrap();
        assert_eq!(&drawn.rgba[(2 * 1080 + 5) * 4..(2 * 1080 + 5) * 4 + 4], &[255, 212, 0, 255], "{variant} clears pacing");
    }
    assert_eq!(&direct.rgba[(2 * 1080 + 5) * 4..(2 * 1080 + 5) * 4 + 4], &[255, 212, 0, 255]);
    let mut overlap: serde_json::Value = read_json(&case.dir.join("storyboard.json"));
    overlap.as_object_mut().unwrap().remove("effects");
    let mut third = overlap["scenes"][0].clone();
    third["chapter"] = "Third".into();
    overlap["scenes"].as_array_mut().unwrap().push(third);
    for (index, scene) in overlap["scenes"].as_array_mut().unwrap().iter_mut().enumerate() {
        scene.as_object_mut().unwrap().remove("startSec");
        scene["durationSec"] = if index == 1 { 1.0.into() } else { 1.5.into() };
        scene["transition"] = "zoom".into();
        scene["transitionDurSec"] = 0.8.into();
        scene["layout"] = serde_json::json!({"widthPct":100,"heightPct":100,"opacity":0.5,"blendMode":"multiply"});
    }
    let overlap = Storyboard::parse(&overlap.to_string()).unwrap();
    let drawn = pollster::block_on(renderer.render(&overlap, 36, 1080, 1920)).unwrap();
    assert_eq!(&drawn.rgba[(2 * 1080 + 5) * 4..(2 * 1080 + 5) * 4 + 4], &[255, 212, 0, 255], "simultaneous opacity wrappers clear pacing");
    for frame in [0, 3, 8, 15, 32, 33] {
        let drawn = pollster::block_on(renderer.render(&case.storyboard, frame, 1080, 1920)).unwrap();
        if frame == 33 {
            assert_eq!(direct.rgba, drawn.rgba);
        }
    }
}

#[test]
fn compositions_match_production() {
    assert_cases_at_parity(|case| case.name.starts_with("composition-"));
}

#[test]
fn shape_primitives_match_production() {
    assert_cases_at_parity(|case| case.name.starts_with("shape-"));
}

fn assert_cases_at_parity(select: impl Fn(&Case) -> bool) {
    let manifest = manifest();
    let cases = cases();
    assert!(option_problems(&manifest, &cases).is_empty(), "invalid corpus evidence");
    let out = repo().join("target/golden");
    let mut renderer = pollster::block_on(Renderer::new()).expect("renderer");
    let mut failures = Vec::new();
    let mut scores = Vec::new();
    for case in cases.into_iter().filter(select) {
        load_images(&mut renderer, &case);
        let lowered = manifest.lowered.get(&case.name);
        let frame_min = lowered.and_then(|l| l.frame).unwrap_or(manifest.thresholds.frame);
        let region_min = lowered.and_then(|l| l.region).unwrap_or(manifest.thresholds.region);
        for &frame in &case.spec.frames {
            let id = format!("{} frame {frame}", case.name);
            let path = reference(&case, frame);
            if !path.is_file() {
                failures.push(format!("{id}: no reference ({})", path.display()));
                continue;
            }
            let expected = read_image(&path);
            supply_video_frames(&mut renderer, &case, frame);
            let drawn = pollster::block_on(renderer.render(&case.storyboard, frame, case.spec.width, case.spec.height)).expect("frame");
            let actual = Image { width: drawn.width as usize, height: drawn.height as usize, rgba: drawn.rgba };
            let mut failed = Vec::new();
            if !drawn.coverage.is_empty() {
                failed.push(format!("coverage is not empty: {}", serde_json::to_string(&drawn.coverage).expect("json")));
            }
            if (expected.width, expected.height) != (actual.width, actual.height) {
                failed.push(format!("reference is {}x{}, case is {}x{}", expected.width, expected.height, actual.width, actual.height));
            } else {
                let whole = compare::ssim(&expected, &actual);
                scores.push(format!("{id}: frame {whole:.4}"));
                if whole < frame_min {
                    failed.push(format!("frame SSIM {whole:.4} < {frame_min}"));
                }
                for region in &case.spec.regions {
                    let score = compare::ssim(&expected.crop(region.rect), &actual.crop(region.rect));
                    scores.push(format!("{id}: region {} {score:.4}", region.name));
                    if score < region_min {
                        failed.push(format!("region `{}` SSIM {score:.4} < {region_min}", region.name));
                    }
                    // Position, which SSIM forgives: the box (or the ink) sits where Remotion puts it.
                    if case.spec.geometry.is_none() {
                        match compare::edge_delta(compare::ink_box(&expected, region.rect), compare::ink_box(&actual, region.rect)) {
                            Some(delta) if delta <= MAX_EDGE_DELTA => {}
                            Some(delta) => failed.push(format!("region `{}` box edge {delta} px from the reference (at most {MAX_EDGE_DELTA})", region.name)),
                            None => failed.push(format!("region `{}` is empty in one frame only", region.name)),
                        }
                    }
                }
            }
            if !failed.is_empty() {
                fs::create_dir_all(&out).expect("target/golden");
                let stem = format!("{}-{frame}", case.name);
                write_png(&out.join(format!("{stem}.png")), &actual);
                if (expected.width, expected.height) == (actual.width, actual.height) {
                    write_png(&out.join(format!("{stem}-diff.png")), &compare::difference(&expected, &actual));
                }
                failures.push(format!("{id}: {}", failed.join("; ")));
            }
        }
    }
    if std::env::var_os("MALEO_GOLDEN_SCORES").is_some() {
        println!("{}", scores.join("\n"));
    }
    assert!(
        failures.is_empty(),
        "{} frame(s) drift from Remotion (Rust frames and differences in target/golden/):\n  {}",
        failures.len(),
        failures.join("\n  ")
    );
}
