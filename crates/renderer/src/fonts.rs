//! The bundled fonts, and the only fonts the renderer reads (D5).
//!
//! Inter v20 is the set `@remotion/google-fonts` loads for
//! `packages/video/src/fonts.ts`: one variable font per style and subset. The
//! browser picks the latin or latin-ext file per character by unicode range;
//! here latin-ext registers as its own family behind latin in the stack, which
//! picks the same file for every character. Noto Color Emoji is the file the
//! production image installs from Debian, so both renderers draw the same
//! emoji. Text no bundled font covers draws Inter's missing-glyph shape.

use std::sync::Arc;

use parley::FontContext;
use parley::fontique::{Blob, Collection, CollectionOptions, FontInfoOverride, SourceCache};

/// The family stack every text layout uses: the CSS stack of the compositions
/// (`Inter, system-ui, sans-serif`) resolved to the bundled files.
pub const FAMILY: &str = "Inter, Inter Ext, Noto Color Emoji";

const INTER: [(&[u8], Option<&str>); 4] = [
    (include_bytes!("../fonts/inter-normal-latin.ttf"), None),
    (include_bytes!("../fonts/inter-italic-latin.ttf"), None),
    (include_bytes!("../fonts/inter-normal-latin-ext.ttf"), Some("Inter Ext")),
    (include_bytes!("../fonts/inter-italic-latin-ext.ttf"), Some("Inter Ext")),
];
const EMOJI: &[u8] = include_bytes!("../fonts/NotoColorEmoji.ttf");

pub struct Fonts {
    pub context: FontContext,
    emoji: u64,
}

impl Fonts {
    pub fn new() -> Self {
        // No system fonts: parley is built without its `system` feature, and
        // the collection is told not to look either.
        let mut collection = Collection::new(CollectionOptions { shared: false, system_fonts: false });
        for (data, family_name) in INTER {
            let info = family_name.map(|name| FontInfoOverride { family_name: Some(name), ..Default::default() });
            collection.register_fonts(Blob::new(Arc::new(data)), info);
        }
        let emoji = Blob::new(Arc::new(EMOJI));
        let emoji_id = emoji.id();
        collection.register_fonts(emoji, None);
        Self { context: FontContext { collection, source_cache: SourceCache::default() }, emoji: emoji_id }
    }

    /// Color emoji are bitmaps: they have no outline to stroke or blur.
    pub fn is_emoji(&self, font: &parley::FontData) -> bool {
        font.data.id() == self.emoji
    }
}

impl Default for Fonts {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_bundled_families_exist() {
        let mut fonts = Fonts::new();
        let mut names: Vec<String> = fonts.context.collection.family_names().map(str::to_owned).collect();
        names.sort();
        assert_eq!(names, ["Inter", "Inter Ext", "Noto Color Emoji"]);
        for system in ["Arial", "Helvetica", "DejaVu Sans", "Liberation Sans", "Apple Color Emoji", "Segoe UI"] {
            assert_eq!(fonts.context.collection.family_id(system), None, "{system} must not load");
        }
    }

    #[test]
    fn an_emoji_draws_in_color_from_the_bundled_font() {
        use parley::{LayoutContext, PositionedLayoutItem, StyleProperty};
        use vello::peniko::{Color, Fill};

        let mut fonts = Fonts::new();
        let mut layouts = LayoutContext::<()>::new();
        let text = "A\u{1F600}";
        let mut builder = layouts.ranged_builder(&mut fonts.context, text, 1.0, false);
        builder.push_default(StyleProperty::FontFamily(parley::FontFamily::Source(FAMILY.into())));
        builder.push_default(StyleProperty::FontSize(64.0));
        let mut layout = builder.build(text);
        layout.break_all_lines(None);
        let mut scene = vello::Scene::new();
        let mut emoji_runs = 0;
        for line in layout.lines() {
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(run) = item else { continue };
                let font = run.run().font();
                emoji_runs += usize::from(fonts.is_emoji(font));
                let glyphs: Vec<vello::Glyph> = run.positioned_glyphs().map(|g| vello::Glyph { id: g.id, x: g.x, y: g.y }).collect();
                scene.draw_glyphs(font).font_size(run.run().font_size()).brush(Color::WHITE).draw(Fill::NonZero, glyphs.into_iter());
            }
        }
        assert_eq!(emoji_runs, 1, "the emoji falls back to Noto Color Emoji");
        let mut gpu = pollster::block_on(crate::gpu::Gpu::new()).expect("gpu");
        let rgba = pollster::block_on(gpu.render(&scene, 160, 80, Color::BLACK)).expect("frame");
        // The smiley is yellow: red and green high, blue low.
        let yellow = rgba.as_chunks::<4>().0.iter().filter(|p| p[0] > 200 && p[1] > 150 && p[2] < 100).count();
        assert!(yellow > 200, "yellow pixels: {yellow}");
    }
}
