//! `rust/conformance/accepted.json`: differences recorded on purpose, each tied to a row of `docs/deviations.md`.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::Deserialize;

use crate::compare::Part;

/// One accepted difference.
#[derive(Debug, Clone, Deserialize)]
pub struct Accepted {
    /// The case id.
    pub id: String,
    /// The parts that may differ: `stdout`, `stderr`, `exit`, `files`.
    pub parts: Vec<String>,
    /// A snippet of the row in `docs/deviations.md` that records the difference; it must occur there.
    pub row: String,
    /// Why the difference is accepted.
    pub reason: String,
}

impl Accepted {
    /// The accepted parts as [`Part`] values.
    pub fn part_set(&self) -> Vec<Part> {
        self.parts.iter().filter_map(|p| Part::parse(p)).collect()
    }
}

#[derive(Deserialize)]
struct File {
    accepted: Vec<Accepted>,
}

#[derive(Deserialize)]
struct Listed {
    accepted: Vec<ListedEntry>,
}

#[derive(Deserialize)]
struct ListedEntry {
    id: String,
    parts: Vec<String>,
}

/// The parts an `accepted.json` lists for each case, read without checking its rows against a
/// register, as a base branch's copy is read. A part name the harness does not know is skipped.
pub fn listed(path: &Path) -> Result<BTreeMap<String, Vec<Part>>, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let file: Listed =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(file
        .accepted
        .into_iter()
        .map(|entry| {
            let parts = entry.parts.iter().filter_map(|p| Part::parse(p)).collect();
            (entry.id, parts)
        })
        .collect())
}

/// Parses the file text; `deviations` is the text of `docs/deviations.md` that every `row` must occur in.
pub fn parse(text: &str, deviations: &str) -> Result<Vec<Accepted>, String> {
    let file: File = serde_json::from_str(text).map_err(|e| format!("accepted.json: {e}"))?;
    for entry in &file.accepted {
        if entry.parts.is_empty() {
            return Err(format!("accepted.json: {}: parts is empty", entry.id));
        }
        if let Some(bad) = entry.parts.iter().find(|p| Part::parse(p).is_none()) {
            return Err(format!(
                "accepted.json: {}: unknown part {bad:?} (stdout, stderr, exit, files)",
                entry.id
            ));
        }
        if entry.reason.trim().is_empty() {
            return Err(format!("accepted.json: {}: reason is empty", entry.id));
        }
        if entry.row.trim().is_empty() || !deviations.contains(entry.row.as_str()) {
            return Err(format!(
                "accepted.json: {}: row {:?} does not occur in docs/deviations.md",
                entry.id, entry.row
            ));
        }
    }
    Ok(file.accepted)
}

/// Loads `accepted.json` from the conformance folder; a missing file is an empty list.
pub fn load(conformance_dir: &Path, deviations_path: &Path) -> Result<Vec<Accepted>, String> {
    let path = conformance_dir.join("accepted.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text =
        fs::read_to_string(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let deviations = fs::read_to_string(deviations_path).unwrap_or_default();
    parse(&text, &deviations)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn an_empty_list_parses() {
        assert!(parse(r#"{"accepted": []}"#, "").unwrap().is_empty());
    }

    #[test]
    fn an_entry_needs_a_known_part_a_reason_and_a_real_row() {
        let ok = r#"{"accepted":[{"id":"x","parts":["stdout"],"row":"Table width","reason":"r"}]}"#;
        assert_eq!(
            parse(ok, "| Table width differs |").unwrap()[0].part_set(),
            [Part::Stdout]
        );
        assert!(parse(ok, "nothing").unwrap_err().contains("does not occur"));
        let bad_part = ok.replace("stdout", "stdin");
        assert!(
            parse(&bad_part, "Table width")
                .unwrap_err()
                .contains("unknown part")
        );
        let no_reason = ok.replace("\"r\"", "\" \"");
        assert!(
            parse(&no_reason, "Table width")
                .unwrap_err()
                .contains("reason")
        );
    }
}
