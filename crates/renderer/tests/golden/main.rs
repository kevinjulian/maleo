//! The parity gate (D6): every golden corpus case drawn by the Rust renderer
//! and compared with its Remotion reference by SSIM, over the whole frame and
//! over each region the case lists. A frame passes only when both scores meet
//! the manifest thresholds, each region's box or ink sits within 2 px of the
//! reference's, and its coverage report is empty.
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

fn write_png(path: &Path, image: &Image) {
    image::save_buffer(path, &image.rgba, image.width as u32, image.height as u32, image::ExtendedColorType::Rgba8)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
}

fn reference(case: &Case, frame: i64) -> PathBuf {
    case.dir.join("reference").join(format!("{frame}.png"))
}

/// The corpus is complete: references for every frame, a case for every
/// supported kind, the emoji font pinned, and a reason for every lowering.
#[test]
fn the_corpus_is_complete() {
    let manifest = manifest();
    let cases = cases();
    let mut problems = Vec::new();
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

/// Every case frame draws at parity with its Remotion reference.
#[test]
fn every_case_is_at_parity_with_remotion() {
    let manifest = manifest();
    let out = repo().join("target/golden");
    let mut renderer = pollster::block_on(Renderer::new()).expect("renderer");
    let mut failures = Vec::new();
    let mut scores = Vec::new();
    for case in cases() {
        for (url, path) in media_files(&case.dir) {
            let image = read_image(&path);
            renderer.put_image(&url, image.width as u32, image.height as u32, image.rgba).expect("media");
        }
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
                    match compare::edge_delta(compare::ink_box(&expected, region.rect), compare::ink_box(&actual, region.rect)) {
                        Some(delta) if delta <= MAX_EDGE_DELTA => {}
                        Some(delta) => failed.push(format!("region `{}` box edge {delta} px from the reference (at most {MAX_EDGE_DELTA})", region.name)),
                        None => failed.push(format!("region `{}` is empty in one frame only", region.name)),
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
