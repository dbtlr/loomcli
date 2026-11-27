//! Applies the operator's overrides to the logging file fact.

use std::io::ErrorKind;
use std::path::{Path, PathBuf, is_separator};

use loomcli_core::{DirectoryFacts, LogLevel};

use super::directory::resolve_log_file;
use super::error::LoggingError;
use super::extension::{LogVariable, LoggingFilesFacts};

/// A file destination after applying the host and the operator's variables.
#[derive(Debug)]
#[non_exhaustive]
pub struct ResolvedLogFile {
    /// The threshold applied to this file.
    pub level: LogLevel,
    /// The absolute path, or the error that names the missing variable.
    pub path: Result<PathBuf, LoggingError>,
}

/// An operator variable whose value could not take effect.
#[derive(Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct RejectedLogVariable {
    /// The name of the variable.
    pub variable: String,
    /// The value as supplied by the host.
    pub value: String,
}

/// The overrides that could not take effect.
#[derive(Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct RejectedLogVariables {
    /// The rejected level override, when supplied and unusable.
    pub level: Option<RejectedLogVariable>,
    /// The rejected path override, when supplied and unusable.
    pub file: Option<RejectedLogVariable>,
}

/// The logging files for a host and any rejected operator overrides.
#[derive(Debug)]
#[non_exhaustive]
pub struct ResolvedLogFiles {
    /// Each file destination in declaration order.
    pub files: Vec<ResolvedLogFile>,
    /// Variables that left the declared settings in effect.
    pub rejected: RejectedLogVariables,
}

/// Resolves the file fact for an application and host, without creating files or directories.
///
/// The level variable can override every file's level. The file variable can redirect the first
/// file. A rejected value leaves the corresponding declared setting in effect.
#[must_use]
pub fn resolve_logging_files(
    facts: &LoggingFilesFacts,
    application: &str,
    host: &DirectoryFacts,
) -> ResolvedLogFiles {
    if facts.files.is_empty() {
        return ResolvedLogFiles {
            files: Vec::new(),
            rejected: RejectedLogVariables::default(),
        };
    }
    let (level, rejected_level) = read_override(
        &facts.level_env,
        "LOG_LEVEL",
        application,
        host,
        written_level,
    );
    let (mut first_path, rejected_file) =
        read_override(&facts.file_env, "LOG_FILE", application, host, |value| {
            operator_path(value, application, host)
        });
    let files = facts.files.iter().map(|declared| ResolvedLogFile {
        level: level.unwrap_or(declared.level),
        path: first_path.take().map_or_else(
            || resolve_log_file(declared.file.as_deref(), application, host),
            Ok,
        ),
    });
    ResolvedLogFiles {
        files: files.collect(),
        rejected: RejectedLogVariables {
            level: rejected_level,
            file: rejected_file,
        },
    }
}

fn read_override<T>(
    binding: &LogVariable,
    suffix: &str,
    application: &str,
    host: &DirectoryFacts,
    parse: impl FnOnce(&str) -> Option<T>,
) -> (Option<T>, Option<RejectedLogVariable>) {
    let derived;
    let variable = match binding {
        LogVariable::Application => {
            let prefix: String = application
                .chars()
                .flat_map(char::to_uppercase)
                .map(|ch| {
                    if ch.is_ascii_uppercase() || ch.is_ascii_digit() {
                        ch
                    } else {
                        '_'
                    }
                })
                .collect();
            derived = format!("{prefix}_{suffix}");
            derived.as_str()
        }
        LogVariable::Named(name) => name,
        LogVariable::Disabled => return (None, None),
    };
    let Some(value) = host
        .env()
        .get(variable)
        .filter(|value| !trim_env(value).is_empty())
    else {
        return (None, None);
    };
    match parse(value) {
        Some(result) => (Some(result), None),
        None => (
            None,
            Some(RejectedLogVariable {
                variable: variable.to_owned(),
                value: value.clone(),
            }),
        ),
    }
}

fn trim_env(value: &str) -> &str {
    // Keep the reference's JavaScript trim set, including BOM and excluding NEL.
    value.trim_matches(|ch: char| ch == '\u{feff}' || (ch.is_whitespace() && ch != '\u{85}'))
}

fn written_level(value: &str) -> Option<LogLevel> {
    match trim_env(value).to_ascii_lowercase().as_str() {
        "trace" => Some(LogLevel::Trace),
        "debug" => Some(LogLevel::Debug),
        "info" => Some(LogLevel::Info),
        "warn" => Some(LogLevel::Warn),
        "error" => Some(LogLevel::Error),
        _ => None,
    }
}

fn operator_path(value: &str, application: &str, host: &DirectoryFacts) -> Option<PathBuf> {
    if value.ends_with(is_separator) || value.contains('\0') {
        return None;
    }
    let path = resolve_log_file(Some(value), application, host).ok()?;
    appendable(&path).then_some(path)
}

fn appendable(path: &Path) -> bool {
    for (index, ancestor) in path.ancestors().enumerate() {
        match std::fs::metadata(ancestor) {
            Ok(metadata) => {
                return metadata.is_dir() == (index > 0) && writable(ancestor, &metadata);
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(_) => return false,
        }
    }
    false
}

#[cfg(unix)]
fn writable(path: &Path, _: &std::fs::Metadata) -> bool {
    rustix::fs::access(path, rustix::fs::Access::WRITE_OK).is_ok()
}

#[cfg(not(unix))]
fn writable(_: &Path, metadata: &std::fs::Metadata) -> bool {
    !metadata.permissions().readonly()
}
