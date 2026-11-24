//! What `status` reports: the state the manager and the file system gave, the probe's rows, and
//! the text view that prints them.

use loomcli_core::{ViewContext, nowrap};
use serde::Serialize;

use super::backend::Reading;
use super::messages::shown;

/// The spaces between the longest row name and every row's value.
const GUTTER: usize = 2;

/// The rows' indent under the first line.
const INDENT: &str = "  ";

/// One row `status` adds under the unit, from the author's probe.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct ServiceDetail {
    /// The row's name, such as `health`.
    pub name: String,
    /// The row's text, written as the author gives it.
    pub value: String,
}

impl ServiceDetail {
    /// A row.
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }
}

/// What `status` read from the service manager and the file system.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct ServiceState {
    /// The settings' label.
    pub label: String,
    /// The unit file's path.
    pub unit: String,
    /// Whether a file is at the unit's path.
    pub installed: bool,
    /// Whether the manager reports a running process.
    pub running: bool,
    /// The manager's state word, `not installed`, `not loaded`, or `unknown`.
    pub state: String,
    /// The running process, when the manager reports one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u64>,
    /// Sentences about the user's session and an unreadable state.
    pub notes: Vec<String>,
}

/// The result `status` sends: the state, then the probe's rows.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct ServiceStatus {
    /// The settings' label.
    pub label: String,
    /// The unit file's path.
    pub unit: String,
    /// Whether a file is at the unit's path.
    pub installed: bool,
    /// Whether the manager reports a running process.
    pub running: bool,
    /// The manager's state word, `not installed`, `not loaded`, or `unknown`.
    pub state: String,
    /// The running process, when the manager reports one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u64>,
    /// Sentences about the user's session and an unreadable state.
    pub notes: Vec<String>,
    /// The probe's rows, or none.
    pub details: Vec<ServiceDetail>,
}

/// Where `status` read the state: the label, the unit's path, and whether a file is there.
pub(super) struct Subject<'a> {
    pub(super) label: &'a str,
    pub(super) unit: &'a std::path::Path,
    pub(super) installed: bool,
}

impl ServiceState {
    /// The state `status` reports for what the manager answered.
    pub(super) fn of(subject: &Subject<'_>, reading: Reading) -> Self {
        Self {
            label: subject.label.to_owned(),
            unit: subject.unit.to_string_lossy().into_owned(),
            installed: subject.installed,
            running: reading.running,
            state: reading.state,
            pid: reading.pid,
            notes: reading.notes,
        }
    }
}

impl ServiceStatus {
    /// The result `status` sends: the state, then the probe's rows.
    pub(super) fn of(state: &ServiceState, details: Vec<ServiceDetail>) -> Self {
        Self {
            label: state.label.clone(),
            unit: state.unit.clone(),
            installed: state.installed,
            running: state.running,
            state: state.state.clone(),
            pid: state.pid,
            notes: state.notes.clone(),
            details,
        }
    }
}

/// The summary after the label: running with its pid, running, or the state word.
fn summary_of(status: &ServiceStatus) -> String {
    if !status.running {
        return status.state.clone();
    }
    match status.pid {
        Some(pid) => format!("running (pid {pid})"),
        None => "running".to_owned(),
    }
}

/// A string's length in UTF-16 units, which is how the reference pads its row names.
fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The text view: `<label>: <summary>`, then the unit's path, each detail, and each note as
/// two-space-indented rows, the names padded to the longest name plus two spaces. Manager words and
/// paths are escaped, and the unit's path is kept whole for line breaking; the probe's names and
/// values are printed as the author gives them.
pub(super) fn status_text(status: &ServiceStatus, context: &ViewContext) -> String {
    let quoted = |text: &str| context.style.escape(&shown(text));
    let mut rows: Vec<(String, String)> = vec![("unit".to_owned(), nowrap(&quoted(&status.unit)))];
    rows.extend(
        status
            .details
            .iter()
            .map(|detail| (detail.name.clone(), detail.value.clone())),
    );
    rows.extend(
        status
            .notes
            .iter()
            .map(|note| ("note".to_owned(), quoted(note))),
    );
    let width = rows.iter().map(|(name, _)| units(name)).max().unwrap_or(0) + GUTTER;
    let mut text = format!(
        "{}: {}\n",
        quoted(&status.label),
        quoted(&summary_of(status))
    );
    for (name, value) in &rows {
        let padding = " ".repeat(width.saturating_sub(units(name)));
        text.push_str(&format!("{INDENT}{name}{padding}{value}\n"));
    }
    text
}
