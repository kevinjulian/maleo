//! Keying rules an inspector edit makes its command from (`p1-envelope-inspector`
//! I1): which key an edit at a time updates, and the track after it. The key
//! target and the refusal message come from `maleo_editor_core::keys`, which
//! the executor uses too, so a refused edit reads the same everywhere.

use maleo_editor_core::keyframes::num;
use serde_json::{Value, json};

use crate::canvas::order;

/// How close an edit must be to an existing key to update it rather than add one.
pub const KEY_SNAP_SEC: f64 = 0.1;

/// The index of the key nearest `time` within `snap`, the earlier on a tie.
pub fn near_key_index(keys: &[Value], time: f64, snap: f64) -> Option<usize> {
    let distance = |key: &Value| (num(key.get("t")) - time).abs();
    keys.iter().enumerate().fold(None, |best: Option<usize>, (index, key)| {
        let closer = best.is_none_or(|b| distance(key) < distance(&keys[b]));
        if distance(key) <= snap + 1e-9 && closer { Some(index) } else { best }
    })
}

/// `keys` with `value` written at `time`: a key within `snap` keeps its time and
/// takes the value (and `easing`, when given); otherwise a new key is inserted
/// in time order with `easing`, or linear.
pub fn upsert_key(keys: &[Value], time: f64, value: Value, easing: Option<&str>, snap: f64) -> Vec<Value> {
    if let Some(near) = near_key_index(keys, time, snap) {
        return keys
            .iter()
            .enumerate()
            .map(|(index, key)| {
                let mut key = key.clone();
                if let (true, Some(fields)) = (index == near, key.as_object_mut()) {
                    fields.insert("v".to_owned(), value.clone());
                    if let Some(easing) = easing {
                        fields.insert("easing".to_owned(), Value::from(easing));
                    }
                }
                key
            })
            .collect();
    }
    let mut next = keys.to_vec();
    next.push(json!({ "t": time, "v": value, "easing": easing.unwrap_or("linear") }));
    let times: Vec<f64> = next.iter().map(|key| num(key.get("t"))).collect();
    order(&times).into_iter().map(|index| next[index].clone()).collect()
}
