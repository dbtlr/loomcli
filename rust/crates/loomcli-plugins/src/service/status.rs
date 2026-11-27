//! What `status` reports: the state the manager and the file system gave, the probe's rows, and
//! the text view that prints them.

use std::fs;
use std::path::PathBuf;

use loomcli_core::{
    CommandGraph, DirectoryFacts, Error, Host, ViewContext, nowrap, read_extension, width,
};
use serde::Serialize;

use super::backend::Reading;
use super::messages::{self, shown};
use crate::logging::extension::{LOGGING_FILES, resolve_logging_files};

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

/// A file destination `status` inspected before calling the service manager.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct ServiceFile {
    /// The file's absolute path.
    pub path: String,
    /// Whether the destination exists. Console output requires a regular file.
    pub exists: bool,
}

/// The generated unit's default console capture.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ServiceConsoleCapture {
    /// systemd sends console output to journald.
    Journald,
    /// launchd discards console output.
    None,
}

/// Log files resolved for the status host, or the manager's capture when it handles console output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[non_exhaustive]
pub enum ServiceLogs {
    /// The logging plugin's files in declaration order.
    Files {
        /// Each file's path and existence.
        files: Vec<ServiceFile>,
    },
    /// The manager's console capture when the logging plugin declares no files and output is unset.
    Manager {
        /// Where the manager sends console output.
        capture: ServiceConsoleCapture,
    },
}

/// The result `status` sends: the state, the probe's rows, and configured destinations.
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
    /// The configured stdout and stderr file, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<ServiceFile>,
    /// Where logs go, when the logging plugin provides its file fact.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<ServiceLogs>,
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
            output: None,
            logs: None,
        }
    }
}

/// Inspects the configured console output without creating it.
pub(super) fn output_of(path: PathBuf) -> ServiceFile {
    ServiceFile {
        exists: fs::metadata(&path).is_ok_and(|metadata| metadata.is_file()),
        path: path.to_string_lossy().into_owned(),
    }
}

/// Resolves the logging plugin's file fact against the status host without creating files.
pub(super) fn logs_of(
    graph: &CommandGraph,
    host: &Host,
    has_output: bool,
) -> Result<Option<ServiceLogs>, Error> {
    let Some(facts) = read_extension(&graph.root, &LOGGING_FILES)? else {
        return Ok(None);
    };
    if facts.files.is_empty() {
        return Ok((!has_output).then_some(ServiceLogs::Manager {
            capture: if host.platform == "linux" {
                ServiceConsoleCapture::Journald
            } else {
                ServiceConsoleCapture::None
            },
        }));
    }
    let directories = DirectoryFacts::new(host.env.clone(), &host.home, &host.platform);
    let resolved = resolve_logging_files(&facts, &graph.name, &directories);
    let mut files = Vec::with_capacity(resolved.files.len());
    for file in resolved.files {
        // A log file resolves whenever the home is absolute, and the service's own checks have
        // already refused a home that is not, so this error reaches no run.
        let path = file.path?;
        files.push(ServiceFile {
            exists: path.exists(),
            path: path.to_string_lossy().into_owned(),
        });
    }
    Ok(Some(ServiceLogs::Files { files }))
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

/// Renders the summary and aligned rows. File paths stay whole and the probe rows appear as given.
pub(super) fn status_text(status: &ServiceStatus, context: &ViewContext) -> String {
    let quoted = |text: &str| context.style.escape(&shown(text));
    let mut rows: Vec<(String, String)> = vec![("unit".to_owned(), nowrap(&quoted(&status.unit)))];
    if let Some(output) = &status.output {
        let row = messages::output_row(&output.path, output.exists);
        rows.push(("output".to_owned(), nowrap(&context.style.escape(&row))));
    }
    match &status.logs {
        Some(ServiceLogs::Files { files }) => {
            rows.extend(files.iter().map(|file| {
                let row = messages::log_file_row(&file.path, file.exists);
                ("log".to_owned(), nowrap(&context.style.escape(&row)))
            }));
        }
        Some(ServiceLogs::Manager { capture }) => {
            let row = messages::manager_log_row(*capture);
            rows.push(("log".to_owned(), context.style.escape(row)));
        }
        None => {}
    }
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
    let column = rows.iter().map(|(name, _)| width(name)).max().unwrap_or(0) + GUTTER;
    let mut text = format!(
        "{}: {}\n",
        quoted(&status.label),
        quoted(&summary_of(status))
    );
    for (name, value) in &rows {
        let padding = " ".repeat(column - width(name));
        text.push_str(&format!("{INDENT}{name}{padding}{value}\n"));
    }
    text
}
