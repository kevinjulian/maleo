//! The stateless inspector rules as one JSON call (`p1-envelope-inspector` I2):
//! `{"op": "<name>", …}` in, the op's result as JSON text out. The WASM export
//! `inspector_apply` and later native bindings forward to `apply_json`.

use maleo_editor_core::EditScope;
use maleo_editor_core::json::to_js_string;
use serde_json::{Map, Value, json};

use crate::animation_edit::{self as anim, Target};
use crate::{controls, inspector, keys, layout};

fn number(input: &Value, key: &str) -> Result<f64, String> {
    input.get(key).and_then(Value::as_f64).ok_or_else(|| format!("{key} is a number"))
}

/// A number a host may have written as `null` (JSON has no NaN): present and
/// null reads as NaN, so the edit refuses it as the TS did; absent is `None`.
fn maybe(input: &Value, key: &str) -> Option<f64> {
    input.get(key).map(|value| value.as_f64().unwrap_or(f64::NAN))
}

/// A required number, NaN when written as `null`.
fn lenient(input: &Value, key: &str) -> f64 {
    maybe(input, key).unwrap_or(f64::NAN)
}

fn point(value: &Value) -> Value {
    let read = |key: &str| value.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN);
    json!({ "xPct": read("xPct"), "yPct": read("yPct") })
}

fn present(input: &Value, key: &str) -> Option<Value> {
    input.get(key).filter(|value| !value.is_null()).cloned()
}

fn options(input: &Value) -> inspector::GroupOptions {
    let flag = |key: &str| input.get("options").and_then(|o| o.get(key)).and_then(Value::as_bool).unwrap_or(false);
    inspector::GroupOptions { video_has_audio: flag("videoHasAudio"), scene_has_video: flag("sceneHasVideo") }
}

fn subject(input: &Value) -> Value {
    let id = |family: &str| present(input, family).map(|value| value.get("id").and_then(Value::as_f64));
    let text = present(input, "text");
    let resolved = inspector::subject(&inspector::SubjectInput {
        video_overlay: id("videoOverlay"),
        audio: id("audio"),
        text_preset: text.as_ref().map(|text| text.get("preset").and_then(Value::as_str)),
        effect: present(input, "effectId").is_some(),
        transition: present(input, "transitionId").is_some(),
        scene: id("scene"),
    });
    match resolved {
        None => Value::Null,
        Some((kind, clip_id)) => {
            let mut out = Map::new();
            out.insert("kind".into(), Value::from(kind));
            if let Some(clip_id) = clip_id {
                out.insert("clipId".into(), Value::from(clip_id));
            }
            Value::Object(out)
        }
    }
}

/// An edit's answer: its command, or the refusal a controller shows.
fn edit(result: Result<Value, anim::Refused>) -> Value {
    match result {
        Ok(command) => json!({ "command": command }),
        Err(error) => json!({ "error": error }),
    }
}

fn strings(input: &Value, key: &str) -> Vec<String> {
    input.get(key).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect()
}

fn numbers(input: &Value, key: &str) -> Vec<f64> {
    input.get(key).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_f64).collect()
}

/// The animation ops (`anim.*`), which read the document.
fn animation_op(op: &str, scope: &EditScope, input: &Value) -> Result<Value, String> {
    let target = || Target::from_value(input.get("target").unwrap_or(&Value::Null));
    let text = |key: &str| input.get(key).and_then(Value::as_str);
    let index = |key: &str| number(input, key).map(|n| if n >= 0.0 { n as usize } else { usize::MAX });
    let row = |t: &Target| {
        let properties = strings(input, "properties");
        let properties: Vec<&str> = properties.iter().map(String::as_str).collect();
        Ok::<_, String>(anim::row(scope, t, &properties, number(input, "absolute")?, number(input, "fps")?))
    };
    Ok(match op {
        "anim.target.forId" => anim::target_for_id(scope, text("id").ok_or("id is a string")?).map_or(Value::Null, |t| t.to_value()),
        "anim.target.selected" => {
            anim::selected_target(scope, input.get("selection").ok_or("selection is an object")?, input.get("choice").filter(|c| !c.is_null()))
                .map_or(Value::Null, |t| t.to_value())
        }
        "anim.clipId" => json!(anim::clip_id_for_target(scope, &target()?)),
        "anim.info" => anim::info(scope, &target()?).map_or(Value::Null, |info| info.to_value()),
        "anim.key.edit" => edit(anim::edit_key(
            scope,
            &target()?,
            text("property").ok_or("property is a string")?,
            lenient(input, "time"),
            input.get("value").and_then(Value::as_f64),
            text("easing"),
        )),
        "anim.key.remove" => edit(anim::remove_key(scope, &target()?, text("property").ok_or("property is a string")?, index("index")?)),
        "anim.key.move" => edit(anim::move_key(scope, &target()?, text("property").ok_or("property is a string")?, index("index")?, lenient(input, "time"))),
        "anim.moments.move" => edit(anim::move_moments(scope, &target()?, &numbers(input, "times"), maybe(input, "delta"))),
        "anim.moment.move" => edit(anim::move_moment(scope, &target()?, lenient(input, "from"), maybe(input, "to"))),
        "anim.moments.easing" => {
            edit(anim::set_moments_easing(scope, &target()?, &numbers(input, "times"), text("easing").ok_or("easing is a string")?, text("property")))
        }
        "anim.paste" => edit(anim::paste_keys(scope, &target()?, input.get("clipboard").ok_or("clipboard is an object")?)),
        "anim.edge" => edit(anim::apply_edge(
            scope,
            &target()?,
            text("edge").ok_or("edge is a string")?,
            text("preset").ok_or("preset is a string")?,
            lenient(input, "seconds"),
        )),
        "anim.row" => row(&target()?)?.map_or(Value::Null, |row| row.to_value()),
        "anim.row.toggle" => {
            let t = target()?;
            row(&t)?.map_or(Value::Null, |row| edit(row.toggle(scope, &t)))
        }
        "anim.row.set" => {
            let t = target()?;
            let values = input.get("values").and_then(Value::as_object).cloned().unwrap_or_default();
            row(&t)?.map_or(Value::Null, |row| edit(row.set(scope, &t, &values)))
        }
        other => return Err(format!("unknown inspector op {other:?}")),
    })
}

/// Run one op. Ops that read the document get `scope`; the stateless ones
/// ignore it. The error is a message naming what the input lacked.
pub fn apply_json(scope: Option<&EditScope>, json: &str) -> Result<String, String> {
    let input: Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let op = input.get("op").and_then(Value::as_str).ok_or("op is a string")?;
    let output = match op {
        "fader.gain" => json!(controls::gain_from_fader(number(&input, "pct")?)),
        "fader.rangeDb" => json!(controls::FADER_RANGE_DB),
        "gain.fromDb" => json!(controls::gain_from_db(number(&input, "db")?)),
        "fader.position" => json!(controls::fader_from_gain(number(&input, "gain")?)),
        // JSON has no infinity: a silent gain is `null`.
        "gain.db" => Some(controls::db_from_gain(number(&input, "gain")?)).filter(|db| db.is_finite()).map_or(Value::Null, Value::from),
        "gain.label" => json!(controls::format_gain_db(number(&input, "gain")?)),
        "focal.at" => {
            let rect = input.get("rect").ok_or("rect is an object")?;
            let (x, y) = controls::focal_point_at(
                number(&input, "clientX")?,
                number(&input, "clientY")?,
                number(rect, "left")?,
                number(rect, "top")?,
                number(rect, "width")?,
                number(rect, "height")?,
            );
            json!({ "xPct": x, "yPct": y })
        }
        "focal.nudge" => {
            let from = present(&input, "point").map(|p| point(&p));
            let start = from.as_ref().map(|p| (p["xPct"].as_f64().unwrap_or(f64::NAN), p["yPct"].as_f64().unwrap_or(f64::NAN)));
            let key = input.get("key").and_then(Value::as_str).unwrap_or_default();
            controls::nudge_focal_point(start, key).map_or(Value::Null, |(x, y)| json!({ "xPct": x, "yPct": y }))
        }
        "groups" => json!(inspector::property_groups(input.get("kind").and_then(Value::as_str).unwrap_or_default(), options(&input))),
        "groups.active" => {
            let groups: Vec<&str> = input.get("groups").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
            json!(inspector::active_group(&groups, input.get("remembered").and_then(Value::as_str).unwrap_or_default()))
        }
        "groups.options" => {
            let kinds: Vec<&str> = input.get("sceneVisualKinds").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
            let found = inspector::group_options(input.get("videoOverlayKind").and_then(Value::as_str), &kinds);
            json!({ "videoHasAudio": found.video_has_audio, "sceneHasVideo": found.scene_has_video })
        }
        "subject" => subject(&input),
        "layout.normalize" => {
            let kind = input.get("kind").and_then(Value::as_str).ok_or("kind is a string")?;
            Value::Object(layout::normalize_layout(input.get("layout").and_then(Value::as_object), kind))
        }
        "text.defaultStyle" => layout::default_text_style(input.get("preset").and_then(Value::as_str)),
        "keys.near" => {
            let keys = input.get("keys").and_then(Value::as_array).ok_or("keys is an array")?;
            let snap = input.get("snap").and_then(Value::as_f64).unwrap_or(keys::KEY_SNAP_SEC);
            json!(keys::near_key_index(keys, number(&input, "time")?, snap).map_or(-1, |index| index as i64))
        }
        "keys.upsert" => {
            let keys = input.get("keys").and_then(Value::as_array).ok_or("keys is an array")?;
            let value = input.get("value").cloned().ok_or("value is present")?;
            let snap = input.get("snap").and_then(Value::as_f64).unwrap_or(keys::KEY_SNAP_SEC);
            json!(keys::upsert_key(keys, number(&input, "time")?, value, input.get("easing").and_then(Value::as_str), snap))
        }
        "anim.moments" => {
            let found = anim::moments(input.get("animation").filter(|a| !a.is_null()));
            Value::Array(found.into_iter().map(|(time, properties)| json!({ "time": time, "properties": properties })).collect())
        }
        "anim.moment.easings" => json!(anim::moment_easings(input.get("animation").filter(|a| !a.is_null()), number(&input, "time")?)),
        "anim.edge.ramp" | "anim.edge.tracks" => {
            let values = input.get("values").and_then(Value::as_object).cloned().unwrap_or_default();
            let audio = input.get("audio").and_then(Value::as_bool).unwrap_or(false);
            let animation = input.get("animation").filter(|a| !a.is_null());
            let edge = input.get("edge").and_then(Value::as_str).unwrap_or("in");
            let duration = lenient(&input, "duration");
            if op == "anim.edge.ramp" {
                anim::edge_ramp_value(animation, edge, duration, &values, audio).unwrap_or(Value::Null)
            } else {
                let preset = input.get("preset").and_then(Value::as_str).ok_or("preset is a string")?;
                match anim::edge_tracks_value(animation, edge, preset, lenient(&input, "seconds"), duration, &values, audio) {
                    Ok(tracks) => json!({ "tracks": tracks }),
                    Err(error) => json!({ "error": error }),
                }
            }
        }
        "anim.edge.state" => {
            let values = input.get("values").and_then(Value::as_object).cloned().unwrap_or_default();
            let audio = input.get("audio").and_then(Value::as_bool).unwrap_or(false);
            json!(anim::edge_state(
                input.get("animation").filter(|a| !a.is_null()),
                input.get("edge").and_then(Value::as_str).unwrap_or("in"),
                lenient(&input, "duration"),
                &values,
                audio
            ))
        }
        _ if op.starts_with("anim.") => animation_op(op, scope.ok_or("this op reads a document; name its handle")?, &input)?,
        "keys.target" | "keys.error" => {
            let scope = scope.ok_or("this op reads a document; name its handle")?;
            let id = input.get("id").and_then(Value::as_str).ok_or("id is a string")?;
            if op == "keys.error" {
                let property = input.get("property").and_then(Value::as_str).ok_or("property is a string")?;
                let keys = input.get("keys").and_then(Value::as_array).ok_or("keys is an array")?;
                maleo_editor_core::keys::key_error(scope, id, property, keys).map_err(|error| error.to_string())?.map_or(Value::Null, Value::from)
            } else {
                match maleo_editor_core::keys::key_target_view(scope, id).map_err(|error| error.to_string())? {
                    None => Value::Null,
                    Some(view) => {
                        // Absent, not null, as the TS target leaves them undefined.
                        let mut out = Map::new();
                        if let Some(kind) = view.kind {
                            out.insert("kind".into(), Value::from(kind));
                        }
                        if let Some(animation) = view.animation {
                            out.insert("animation".into(), animation);
                        }
                        out.insert("duration".into(), json!(view.duration));
                        out.insert("locked".into(), Value::Bool(view.locked));
                        Value::Object(out)
                    }
                }
            }
        }
        other => return Err(format!("unknown inspector op {other:?}")),
    };
    to_js_string(&output)
}
