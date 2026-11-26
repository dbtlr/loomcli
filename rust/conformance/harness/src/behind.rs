//! Rust cases with known differences from the shared expectations.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::Deserialize;
use serde_json::json;

use crate::accepted::Accepted;
use crate::compare::Part;
use crate::runner::CaseResult;

/// The exact differing parts of each case on the behind list.
pub type Behind = BTreeMap<String, Vec<Part>>;

#[derive(Deserialize)]
struct Entry {
    id: String,
    parts: Vec<String>,
}

#[derive(Deserialize)]
struct File {
    behind: Vec<Entry>,
}

/// Reads `behind.json` and validates its entries.
pub fn load(path: &Path) -> Result<Behind, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let name = path.display();
    let file: File = serde_json::from_str(&text).map_err(|e| format!("{name}: {e}"))?;
    let mut behind = Behind::new();
    for entry in file.behind {
        let parts = entry
            .parts
            .iter()
            .map(|part| {
                Part::parse(part).ok_or_else(|| {
                    format!("{}: {}: unknown part {part:?}", path.display(), entry.id)
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if parts.is_empty() {
            return Err(format!("{name}: {}: parts is empty", entry.id));
        }
        if behind.insert(entry.id.clone(), parts).is_some() {
            return Err(format!("{name}: {}: duplicate case id", entry.id));
        }
    }
    Ok(behind)
}

/// Writes the exact differing parts from a full run, excluding accepted cases.
pub fn write_candidate(
    path: &Path,
    results: &[CaseResult],
    accepted: &[Accepted],
) -> Result<(), String> {
    if let Some(result) = results.iter().find(|result| !result.notes.is_empty()) {
        return Err(format!(
            "cannot write a behind list: {} could not be compared",
            result.id
        ));
    }
    let mut differences: Vec<_> = results
        .iter()
        .filter(|result| {
            !result.parts.is_empty() && !accepted.iter().any(|entry| entry.id == result.id)
        })
        .collect();
    differences.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    let entries: Vec<_> = differences
        .into_iter()
        .map(|result| {
            let parts: Vec<_> = result.parts.iter().map(|part| part.name()).collect();
            json!({ "id": result.id, "parts": parts })
        })
        .collect();
    let text =
        serde_json::to_string_pretty(&json!({ "behind": entries })).map_err(|e| e.to_string())?;
    fs::write(path, format!("{text}\n"))
        .map_err(|e| format!("cannot write {}: {e}", path.display()))
}
