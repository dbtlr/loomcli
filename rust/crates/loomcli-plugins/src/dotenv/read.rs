//! The layered files: which ones a mode names, how each reads, and how their values combine.

use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::Path;

use loomcli_core::{EnvironmentAdditions, EnvironmentContext, Error};

use super::expand::expand_value;
use super::messages;
use super::parse::{DotenvAssignment, parse_dotenv};

/// The environment variable that names the mode. The reference reads `NODE_ENV`, and an operator
/// moving between the two ports expects the same variable.
const MODE_VARIABLE: &str = "NODE_ENV";

/// The mode the test runner sets, under which `.env.local` is not read.
const TEST_MODE: &str = "test";

/// The files the plugin reads for a mode, from the most to the least specific, which is the order
/// Bun and Next.js load them in. A file the list names twice is kept at its more specific place.
pub(super) fn dotenv_files(mode: Option<&str>) -> Vec<String> {
    let mode = mode.filter(|mode| !mode.is_empty());
    let mut files = Vec::new();
    if let Some(mode) = mode {
        files.push(format!(".env.{mode}.local"));
    }
    if mode != Some(TEST_MODE) {
        files.push(".env.local".to_owned());
    }
    if let Some(mode) = mode {
        files.push(format!(".env.{mode}"));
    }
    files.push(".env".to_owned());
    let mut kept: Vec<String> = Vec::with_capacity(files.len());
    for file in files {
        if !kept.contains(&file) {
            kept.push(file);
        }
    }
    kept
}

/// What a read of one file gave: its text, nothing for a missing file or a directory, or the
/// warning for a file that could not be read.
enum FileText {
    Text(String),
    Absent,
    Unreadable,
}

fn file_text(path: &Path) -> FileText {
    match std::fs::read(path) {
        Ok(bytes) => FileText::Text(String::from_utf8_lossy(&bytes).into_owned()),
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::NotFound | ErrorKind::NotADirectory | ErrorKind::IsADirectory
            ) || path.is_dir() =>
        {
            FileText::Absent
        }
        Err(_) => FileText::Unreadable,
    }
}

/// One file's assignments with their references read, in order. A reference reads the hook's
/// environment first, then the names more specific files gave, then the file's own earlier lines.
fn expand_file(
    assignments: &[DotenvAssignment],
    outer: &dyn Fn(&str) -> Option<String>,
) -> BTreeMap<String, String> {
    let mut own: BTreeMap<String, String> = BTreeMap::new();
    for assignment in assignments {
        let value = expand_value(&assignment.value, assignment.quote, &|name| {
            outer(name).or_else(|| own.get(name).cloned())
        });
        own.insert(assignment.name.clone(), value);
    }
    own
}

/// One layer's values and the warnings its file earns, in order.
fn read_layer(
    path: &Path,
    file: &str,
    imports: &dyn Fn(&str) -> bool,
    outer: &dyn Fn(&str) -> Option<String>,
) -> (BTreeMap<String, String>, Vec<String>) {
    let text = match file_text(path) {
        FileText::Text(text) => text,
        FileText::Absent => return (BTreeMap::new(), Vec::new()),
        FileText::Unreadable => {
            return (BTreeMap::new(), vec![messages::file_unreadable(file)]);
        }
    };
    let parsed = parse_dotenv(&text, imports);
    let warnings = parsed
        .malformed
        .iter()
        .map(|malformed| messages::line_malformed(&malformed.name, malformed.line, file))
        .collect();
    (expand_file(&parsed.assignments, outer), warnings)
}

/// Reads the layered files from the most specific, as Bun loads them, so a name keeps the first
/// value read and a later file only fills names still unset. That order decides what a reference
/// reads.
pub(super) async fn read_dotenv(
    context: EnvironmentContext,
    imports: &(dyn Fn(&str) -> bool + Send + Sync),
) -> Result<EnvironmentAdditions, Error> {
    let mut known: BTreeMap<String, String> = BTreeMap::new();
    let mode = context.env.get(MODE_VARIABLE).cloned();
    for file in dotenv_files(mode.as_deref()) {
        let (layer, warnings) = {
            let outer = |name: &str| context.env.get(name).or_else(|| known.get(name)).cloned();
            read_layer(&context.cwd.join(&file), &file, imports, &outer)
        };
        for warning in warnings {
            context.warn(&warning).await?;
        }
        for (name, value) in layer {
            known.entry(name).or_insert(value);
        }
    }
    known.retain(|name, _| imports(name));
    Ok(known)
}
