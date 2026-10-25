//! Canvas editing over the boundary (`p2-preview-editing` D2): a canvas handle
//! bound to a document handle, one call per input event, and the two
//! stateless calls the inspector uses (`canvas_layout`, `canvas_edit`).
//!
//! The wire shapes are decoded by hand from `serde_json::Value`, like
//! commands and selections, to keep derived code out of the module.

use maleo_app_core::canvas::Target;
use maleo_app_core::canvas::edit::{LayoutPatch, edit_command, resize_value, resolve};
use maleo_app_core::canvas::session::{Context, Session};
use maleo_editor_core::json::to_js_string;
use serde_json::{Value, json};

use crate::{Documents, invalid};

fn parse(json: &str) -> Result<Value, String> {
    serde_json::from_str(json).map_err(|error| invalid(error.to_string()))
}

fn out(value: &Value) -> Result<String, String> {
    to_js_string(value).map_err(invalid)
}

fn unknown(handle: u32) -> String {
    json!({ "kind": "UnknownHandle", "message": format!("no open canvas with handle {handle}") }).to_string()
}

/// Open canvases: each holds its document handle and its session.
#[derive(Default)]
pub struct Canvases {
    next: u32,
    // ponytail: linear lookup; a page holds one or two canvases.
    open: Vec<(u32, u32, Session)>,
}

impl Canvases {
    fn get(&mut self, canvas: u32) -> Result<(&mut u32, &mut Session), String> {
        self.open.iter_mut().find(|(handle, _, _)| *handle == canvas).map(|(_, doc, session)| (doc, session)).ok_or_else(|| unknown(canvas))
    }

    /// A canvas over an open document.
    pub fn open(&mut self, documents: &Documents, doc: u32) -> Result<u32, String> {
        documents.scope(doc)?;
        self.next += 1;
        self.open.push((self.next, doc, Session::default()));
        Ok(self.next)
    }

    pub fn close(&mut self, canvas: u32) -> Result<(), String> {
        let index = self.open.iter().position(|(handle, _, _)| *handle == canvas).ok_or_else(|| unknown(canvas))?;
        self.open.swap_remove(index);
        Ok(())
    }

    pub fn open_count(&self) -> usize {
        self.open.len()
    }

    /// `canvas_view`: where the canvas sits on the screen.
    pub fn view(&mut self, canvas: u32, json: &str) -> Result<(), String> {
        let value = parse(json)?;
        self.get(canvas)?.1.set_view(&value).map_err(invalid)
    }

    /// The document an event names (`"doc"`, after the host reopened it), else the bound one.
    fn rebind(&mut self, canvas: u32, value: &Value) -> Result<(u32, &mut Session), String> {
        let (doc, session) = self.get(canvas)?;
        if let Some(next) = value.get("doc").and_then(Value::as_u64).and_then(|d| u32::try_from(d).ok()) {
            *doc = next;
        }
        Ok((*doc, session))
    }

    /// `canvas_input`: one event in, `{"overlay", "select", "preview", "commit", "handled"}` out.
    pub fn input(&mut self, documents: &Documents, canvas: u32, json: &str) -> Result<String, String> {
        let value = parse(json)?;
        let (doc, session) = self.rebind(canvas, &value)?;
        let result = session.input(documents.scope(doc)?, &value).map_err(invalid)?;
        out(&result)
    }

    /// `canvas_overlay`: what to draw at a time for a selection, with no event.
    pub fn overlay(&mut self, documents: &Documents, canvas: u32, json: &str) -> Result<String, String> {
        let value = parse(json)?;
        let (doc, session) = self.rebind(canvas, &value)?;
        let context = Context::from_value(&value).map_err(invalid)?;
        out(&session.overlay(documents.scope(doc)?, &context).map_err(invalid)?)
    }
}

/// `canvas_layout`: `{"target"}` in; `{"clipId", "layout", "start", "duration", "kind", "visualId"}` or `null` out.
pub fn layout(documents: &Documents, doc: u32, json: &str) -> Result<String, String> {
    let value = parse(json)?;
    let target = Target::from_value(&value["target"]).map_err(invalid)?;
    let Some(resolved) = resolve(documents.scope(doc)?, &target) else { return Ok("null".to_owned()) };
    out(&json!({
        "clipId": resolved.clip_id,
        "layout": resolved.layout,
        "start": resolved.start,
        "duration": resolved.duration,
        "kind": resolved.kind,
        "visualId": resolved.visual.as_ref().and_then(|v| v.get("id")),
    }))
}

/// `canvas_edit`: `{"target", "patch", "unset"?, "time"?}` in; the command out.
pub fn edit(documents: &Documents, doc: u32, json: &str) -> Result<String, String> {
    let value = parse(json)?;
    let target = Target::from_value(&value["target"]).map_err(invalid)?;
    let patch = LayoutPatch::from_value(&value).map_err(invalid)?;
    out(&edit_command(documents.scope(doc)?, &target, &patch, value.get("time").and_then(Value::as_f64)))
}

/// `canvas_size_patch`: `{"layout", "axis", "value"}` in; the patch an
/// aspect-locked size field writes (`resizeLayoutValue`) out.
pub fn size_patch(json: &str) -> Result<String, String> {
    let value = parse(json)?;
    let layout = value["layout"].as_object().ok_or_else(|| invalid("`layout` is not an object"))?;
    let height = match value["axis"].as_str() {
        Some("widthPct") => false,
        Some("heightPct") => true,
        _ => return Err(invalid("`axis` is widthPct or heightPct")),
    };
    let size = value["value"].as_f64().ok_or_else(|| invalid("`value` is not a number"))?;
    out(&Value::Object(resize_value(layout, height, size)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCOPE: &str = r#"{"mediaAssets":[],"slides":[],"posts":[],"doc":{"schemaVersion":2,"markers":[],"clips":[
        {"id":"video:2","type":"image","startSec":0,"durationSec":4,"track":1,"video":{"id":2,"kind":"image","url":"a.png","start":0,"dur":4,"track":1,"layout":{"xPct":10,"yPct":20,"widthPct":40,"heightPct":30,"fit":"contain"}}},
        {"id":"video:3","type":"image","startSec":0,"durationSec":4,"track":2,"video":{"id":3,"kind":"image","url":"b.png","start":0,"dur":4,"track":2,"layout":{"xPct":60,"yPct":60,"widthPct":20,"heightPct":20,"fit":"contain"}}}]}}"#;
    const VIEW: &str = r#"{"area":{"x":0,"y":0,"width":800,"height":450},"aspect":1.7777777777777777}"#;

    fn event(kind: &str, x: f64, y: f64, extra: &str) -> String {
        format!(r#"{{"type":"{kind}","x":{x},"y":{y},"time":1,"targets":[{{"source":"video","id":2}}]{extra}}}"#)
    }

    fn setup() -> (Documents, Canvases, u32, u32) {
        let mut documents = Documents::default();
        let doc = documents.open(SCOPE).expect("opens");
        let mut canvases = Canvases::default();
        let canvas = canvases.open(&documents, doc).expect("a canvas");
        canvases.view(canvas, VIEW).expect("a view");
        (documents, canvases, doc, canvas)
    }

    fn json(text: &str) -> Value {
        serde_json::from_str(text).expect("JSON")
    }

    #[test]
    fn a_canvas_opens_on_a_document_handle() {
        let (documents, mut canvases, _, canvas) = setup();
        assert!(canvases.open(&documents, 99).expect_err("no document").contains("UnknownHandle"));
        let overlay = json(&canvases.overlay(&documents, canvas, r#"{"time":1,"targets":[{"source":"video","id":2}]}"#).expect("overlay"));
        assert_eq!(overlay["box"]["xPct"], 10);
        assert_eq!(overlay["box"]["handles"].as_array().map(Vec::len), Some(5));
    }

    #[test]
    fn a_drag_previews_then_commits() {
        let (documents, mut canvases, _, canvas) = setup();
        let down = json(&canvases.input(&documents, canvas, &event("down", 240.0, 157.5, "")).expect("down"));
        assert_eq!((down["preview"].clone(), down["commit"].clone()), (Value::Null, Value::Null));
        let moved = json(&canvases.input(&documents, canvas, &event("move", 320.0, 157.5, r#","alt":true"#)).expect("move"));
        assert_eq!(moved["preview"]["type"], "clip.replace");
        assert_eq!(moved["commit"], Value::Null);
        let up = json(&canvases.input(&documents, canvas, &event("up", 320.0, 157.5, "")).expect("up"));
        assert_eq!((up["preview"].clone(), up["commit"]["type"].clone()), (Value::Null, json(r#""clip.replace""#)));
        assert_eq!(up["commit"]["clip"]["video"]["layout"]["xPct"], 20);
    }

    #[test]
    fn a_cancel_makes_neither_preview_nor_commit() {
        let (documents, mut canvases, _, canvas) = setup();
        canvases.input(&documents, canvas, &event("down", 240.0, 157.5, "")).expect("down");
        canvases.input(&documents, canvas, &event("move", 320.0, 157.5, "")).expect("move");
        let cancelled = json(&canvases.input(&documents, canvas, &event("cancel", 320.0, 157.5, "")).expect("cancel"));
        assert_eq!((cancelled["preview"].clone(), cancelled["commit"].clone()), (Value::Null, Value::Null));
        let up = json(&canvases.input(&documents, canvas, &event("up", 320.0, 157.5, "")).expect("up"));
        assert_eq!(up["commit"], Value::Null);
    }

    #[test]
    fn a_shift_click_returns_a_toggle_action() {
        let (documents, mut canvases, _, canvas) = setup();
        let toggled = json(&canvases.input(&documents, canvas, &event("down", 560.0, 315.0, r#","shift":true"#)).expect("down"));
        assert_eq!(toggled["select"], json(r#"{"type":"toggleClip","source":"video","refId":3}"#));
    }

    #[test]
    fn a_closed_canvas_is_refused() {
        let (documents, mut canvases, _, canvas) = setup();
        canvases.close(canvas).expect("closes");
        assert_eq!(canvases.open_count(), 0);
        assert!(canvases.input(&documents, canvas, &event("down", 0.0, 0.0, "")).expect_err("closed").contains("UnknownHandle"));
        assert!(canvases.view(canvas, VIEW).is_err());
        assert!(canvases.close(canvas).is_err());
    }

    #[test]
    fn an_event_can_rebind_a_reopened_document() {
        let (mut documents, mut canvases, _, canvas) = setup();
        let reopened = documents.open(SCOPE).expect("opens");
        let result = canvases.input(&documents, canvas, &event("down", 240.0, 157.5, &format!(r#","doc":{reopened}"#)));
        assert!(result.is_ok());
    }

    #[test]
    fn the_inspector_reads_a_layout_and_builds_an_edit() {
        let (documents, _, doc, _) = setup();
        let layout = json(&super::layout(&documents, doc, r#"{"target":{"source":"video","id":2}}"#).expect("layout"));
        assert_eq!((layout["clipId"].clone(), layout["start"].clone()), (json(r#""video:2""#), json("0")));
        assert_eq!(super::layout(&documents, doc, r#"{"target":{"source":"text","id":9}}"#).expect("missing"), "null");
        let command = json(&edit(&documents, doc, r#"{"target":{"source":"video","id":2},"patch":{"flipX":true}}"#).expect("edit"));
        assert_eq!(command["clip"]["video"]["layout"]["flipX"], true);
        let refused = edit(&documents, doc, r#"{"target":{"source":"video","id":2},"patch":{"blendMode":"overlay"}}"#).expect("edit");
        assert_eq!(refused, r#"{"type":"noop"}"#);
        assert_eq!(
            size_patch(r#"{"layout":{"widthPct":40,"heightPct":30,"aspectLocked":true},"axis":"widthPct","value":80}"#).expect("patch"),
            r#"{"widthPct":80,"heightPct":60}"#
        );
    }
}
