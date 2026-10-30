//! Native runner for the exact readiness JSON calls used by WASM boundary tests.
use std::io::{self, Read};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let actions: Vec<serde_json::Value> = serde_json::from_str(&input)?;
    let mut sessions = maleo_editor_wasm::media::MediaSessions::default();
    let handle = sessions.open();
    let outputs: Vec<_> = actions.iter().map(|action| sessions.dispatch(handle, &action.to_string())).collect();
    sessions.close(handle)?;
    println!("{}", serde_json::to_string(&outputs)?);
    Ok(())
}
