//! Spike C: draw maleo's caption styles in Rust and compare them with Remotion.
//!
//! cargo run --release [reference-linux]  render every fixture, compare against
//!                                       reference/ (default) or reference-linux/
//! cargo run --release -- ssim A B   SSIM of two PNGs

mod compare;
mod fixture;
mod render;

use std::fs::{self, File};
use std::io::BufWriter;
use std::path::Path;

use compare::Image;
use fixture::{CaptionFrame, Doc, color};

const FONTS: [&str; 2] = ["fonts/inter-normal-latin.ttf", "fonts/inter-italic-latin.ttf"];
/// Margin around the caption when cropping for the caption-region SSIM.
const CROP_MARGIN: usize = 24;

fn read_png(path: &Path) -> Image {
    let mut decoder = png::Decoder::new(std::io::BufReader::new(File::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().expect("png header");
    let mut buf = vec![0; reader.output_buffer_size().expect("size")];
    let info = reader.next_frame(&mut buf).expect("png frame");
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => buf[..info.buffer_size()].chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        other => panic!("{}: unsupported {other:?}", path.display()),
    };
    Image { width: info.width as usize, height: info.height as usize, rgba }
}

fn write_png(path: &Path, image: &Image) {
    let mut encoder = png::Encoder::new(BufWriter::new(File::create(path).expect("create png")), image.width as u32, image.height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.write_header().expect("png header").write_image_data(&image.rgba).expect("png data");
}

fn union(a: Option<[usize; 4]>, b: Option<[usize; 4]>) -> Option<[usize; 4]> {
    match (a, b) {
        (Some(a), Some(b)) => Some([a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])]),
        (a, b) => a.or(b),
    }
}

/// Largest edge difference between two boxes, in pixels; `None` if only one exists.
fn edge_delta(a: Option<[usize; 4]>, b: Option<[usize; 4]>) -> Option<usize> {
    match (a, b) {
        (Some(a), Some(b)) => Some((0..4).map(|i| a[i].abs_diff(b[i])).max().unwrap_or(0)),
        (None, None) => Some(0),
        _ => None,
    }
}

fn show(delta: Option<usize>) -> String {
    delta.map_or("missing".into(), |d| d.to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("ssim") {
        println!("{:.6}", compare::ssim(&read_png(Path::new(&args[2])), &read_png(Path::new(&args[3]))));
        return;
    }

    let doc: Doc = serde_json::from_str(&fs::read_to_string("fixtures/fixtures.json").expect("fixtures")).expect("fixtures parse");
    let fonts: Vec<Vec<u8>> = FONTS.iter().map(|p| fs::read(p).unwrap_or_else(|e| panic!("{p}: {e} (run ./fetch-fonts.sh)"))).collect();
    let mut renderer = render::CaptionRenderer::new(&fonts);
    let background = color(Some(&doc.background), 100.0).expect("background");
    // `reference` (macOS Chrome) or `reference-linux` (the production image).
    let reference_dir = args.get(1).cloned().unwrap_or_else(|| "reference".into());
    let results = format!("results/{reference_dir}");
    for dir in ["out/rust".to_owned(), format!("{results}/side-by-side")] {
        fs::create_dir_all(dir).expect("dir");
    }

    let mut report = String::from("fixture\tframe\tssim_frame\tssim_caption\tlines\tline_extent_delta_px\tcaption_box_delta_px\thighlight_delta_px\n");
    for fixture in &doc.fixtures {
        for &frame in &doc.frames {
            let name = format!("{}-{frame}", fixture.id);
            let cue = CaptionFrame::new(&doc, fixture, frame);
            let (pixels, geometry) = renderer.render(&cue, doc.width, doc.height, background);
            let rust = Image { width: doc.width as usize, height: doc.height as usize, rgba: pixels };
            write_png(Path::new(&format!("out/rust/{name}.png")), &rust);
            let reference = read_png(Path::new(&format!("{reference_dir}/{name}.png")));

            let (ref_box, rust_box) = (compare::caption_bbox(&reference, background), compare::caption_bbox(&rust, background));
            let [x0, y0, x1, y1] = union(ref_box, rust_box).expect("a caption");
            let crop =
                [x0.saturating_sub(CROP_MARGIN), y0.saturating_sub(CROP_MARGIN), (x1 + CROP_MARGIN).min(rust.width), (y1 + CROP_MARGIN).min(rust.height)];
            let ssim_frame = compare::ssim(&reference, &rust);
            let ssim_caption = compare::ssim(&reference.crop(crop), &rust.crop(crop));

            // Line breaks: each line's x-height zone (clear of the neighbours'
            // ascenders and descenders) must hold the same ink extent. The zone
            // one pitch below the last line must be empty in both.
            let pitch = cue.font_size * 1.15;
            let last = *geometry.baselines.last().expect("a line");
            let line_delta = geometry
                .baselines
                .iter()
                .copied()
                .chain([last + pitch])
                .map(|baseline| {
                    let (b0, b1) = ((baseline - 0.5 * cue.font_size) as usize, (baseline - 0.05 * cue.font_size) as usize);
                    let (a, b) = (compare::band_extent(&reference, background, b0, b1), compare::band_extent(&rust, background, b0, b1));
                    edge_delta(a.map(|[l, r]| [l, 0, r, 0]), b.map(|[l, r]| [l, 0, r, 0]))
                })
                .try_fold(0, |acc, d| d.map(|d| acc.max(d)));
            // Safe-area position: the box when it has a fill, else the ink.
            let box_delta = match cue.background {
                Some(fill) => edge_delta(compare::color_bbox(&reference, fill), compare::color_bbox(&rust, fill)),
                None => edge_delta(ref_box, rust_box),
            };
            // Highlight: the active word's color lands on the same word.
            let highlight_delta = cue
                .words
                .iter()
                .find(|w| w.color != cue.fill)
                .map(|w| edge_delta(compare::color_bbox(&reference, w.color), compare::color_bbox(&rust, w.color)));

            write_png(Path::new(&format!("{results}/side-by-side/{name}.png")), &compare::stack(&reference, &rust, crop));
            let row = format!(
                "{}\t{frame}\t{ssim_frame:.4}\t{ssim_caption:.4}\t{}\t{}\t{}\t{}\n",
                fixture.id,
                geometry.baselines.len(),
                show(line_delta),
                show(box_delta),
                highlight_delta.map_or("n/a".into(), show)
            );
            print!("{row}");
            report.push_str(&row);
        }
    }
    fs::write(format!("{results}/report.tsv"), report).expect("report");
}
