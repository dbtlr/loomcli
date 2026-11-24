//! Ports of the reference's revision tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use loomcli_mcp::{HANDSHAKE_REVISIONS, PROTOCOL_REVISION};

#[test]
fn exports_the_per_request_revision_and_the_initialize_era_revisions_latest_first() {
    assert_eq!(PROTOCOL_REVISION, "2026-07-28");
    assert_eq!(HANDSHAKE_REVISIONS, ["2025-11-25", "2025-06-18"]);
}

#[test]
fn spells_each_revision_in_one_place() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut spelling = Vec::new();
    for entry in std::fs::read_dir(source).unwrap() {
        let path = entry.unwrap().path();
        let text = std::fs::read_to_string(&path).unwrap();
        if ["2026-07-28", "2025-11-25", "2025-06-18"]
            .iter()
            .any(|revision| text.contains(revision))
        {
            spelling.push(path.file_name().unwrap().to_string_lossy().into_owned());
        }
    }
    assert_eq!(spelling, ["revision.rs"]);
}
