//! Session-local readiness handles. No renderer or platform dependency.
use maleo_editor_core::json::to_js_string;
use maleo_media::readiness::{Completion, Dependencies, Readiness, Request};
use serde_json::Value;

#[derive(Default)]
pub struct MediaSessions {
    next: u32,
    sessions: Vec<(u32, Readiness)>,
}

impl MediaSessions {
    pub fn open(&mut self) -> u32 {
        self.next += 1;
        self.sessions.push((self.next, Readiness::default()));
        self.next
    }

    pub fn close(&mut self, handle: u32) -> Result<(), String> {
        let index = self.sessions.iter().position(|(id, _)| *id == handle).ok_or_else(|| crate::invalid("Unknown media readiness handle"))?;
        self.sessions.swap_remove(index);
        Ok(())
    }

    pub fn dispatch(&mut self, handle: u32, json: &str) -> Result<String, String> {
        let (_, media) = self.sessions.iter_mut().find(|(id, _)| *id == handle).ok_or_else(|| crate::invalid("Unknown media readiness handle"))?;
        let mut input: Value = serde_json::from_str(json).map_err(|error| crate::invalid(error.to_string()))?;
        let action = input.get("type").and_then(Value::as_str).ok_or_else(|| crate::invalid("Media action requires type"))?;
        let fields: &[&str] = match action {
            "update" => &["type", "dependencies"],
            "complete" => &["type", "request", "completion"],
            "invalidate" => &["type", "request", "message"],
            "retry" => &["type", "sourceId"],
            "snapshot" => &["type"],
            _ => return Err(crate::invalid("Unknown media readiness action")),
        };
        if input.as_object().is_none_or(|object| object.keys().any(|key| !fields.contains(&key.as_str()))) {
            return Err(crate::invalid("Unknown media action field"));
        }
        let accepted = match action {
            "update" => {
                let dependencies: Dependencies = serde_json::from_value(input["dependencies"].take()).map_err(|error| crate::invalid(error.to_string()))?;
                media.update(dependencies).map_err(crate::invalid)?;
                true
            }
            "complete" => {
                let request: Request = serde_json::from_value(input["request"].take()).map_err(|error| crate::invalid(error.to_string()))?;
                let completion: Completion = serde_json::from_value(input["completion"].take()).map_err(|error| crate::invalid(error.to_string()))?;
                media.complete(&request, completion)
            }
            "invalidate" => {
                let request: Request = serde_json::from_value(input["request"].take()).map_err(|error| crate::invalid(error.to_string()))?;
                let message = input["message"].as_str().ok_or_else(|| crate::invalid("Invalidation requires message"))?;
                media.invalidate(&request, message.into())
            }
            "retry" => {
                let id = input["sourceId"].as_str().ok_or_else(|| crate::invalid("Retry requires sourceId"))?;
                media.retry(id).map_err(crate::invalid)?;
                true
            }
            _ => true,
        };
        Ok(format!(
            "{{\"accepted\":{accepted},\"snapshot\":{},\"requests\":{}}}",
            to_js_string(&media.snapshot()).map_err(crate::invalid)?,
            to_js_string(&media.requests()).map_err(crate::invalid)?
        ))
    }
}
