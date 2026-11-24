//! The failure of one step of writing a record, which the plugin hands to the author's `on_error`.

use std::fmt;
use std::path::PathBuf;

/// The step of writing a record that failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum LoggingErrorKind {
    /// The default directory could not be resolved because a variable it needs is unset.
    UnresolvedDirectory,
    /// Creating the log directory failed.
    CreateDirectory,
    /// Appending to the log file failed.
    Append,
    /// Rotating the log file failed.
    Rotate,
}

impl LoggingErrorKind {
    /// The kind as the reference spells it: `unresolved-directory`, `create-directory`,
    /// `append`, or `rotate`.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            LoggingErrorKind::UnresolvedDirectory => "unresolved-directory",
            LoggingErrorKind::CreateDirectory => "create-directory",
            LoggingErrorKind::Append => "append",
            LoggingErrorKind::Rotate => "rotate",
        }
    }
}

/// One failure to resolve, create, append to, or rotate the log file, which the plugin hands to the
/// author's `on_error`. `variable` and `cause` are `None` unless the step has one to report.
#[derive(Debug)]
#[non_exhaustive]
pub struct LoggingError {
    /// The step that failed.
    pub kind: LoggingErrorKind,
    /// The file or directory the step failed on, or `None` when no directory could be resolved.
    pub path: Option<PathBuf>,
    /// The unset variable, for an unresolved directory.
    pub variable: Option<String>,
    /// The operating system's error for creating, appending, and rotating.
    pub cause: Option<std::io::Error>,
}

impl LoggingError {
    pub(super) fn unresolved(variable: &str) -> Self {
        LoggingError {
            kind: LoggingErrorKind::UnresolvedDirectory,
            path: None,
            variable: Some(variable.to_owned()),
            cause: None,
        }
    }

    pub(super) fn failed(kind: LoggingErrorKind, path: PathBuf, cause: std::io::Error) -> Self {
        LoggingError {
            kind,
            path: Some(path),
            variable: None,
            cause: Some(cause),
        }
    }
}

impl fmt::Display for LoggingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let path = self
            .path
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_default();
        match self.kind {
            LoggingErrorKind::UnresolvedDirectory => write!(
                formatter,
                "Cannot resolve the log directory because {} is not set.",
                self.variable.as_deref().unwrap_or("a variable")
            ),
            LoggingErrorKind::CreateDirectory => {
                write!(formatter, "Cannot create the log directory \"{path}\".")
            }
            LoggingErrorKind::Append => {
                write!(formatter, "Cannot append to the log file \"{path}\".")
            }
            LoggingErrorKind::Rotate => {
                write!(formatter, "Cannot rotate the log file \"{path}\".")
            }
        }
    }
}

impl std::error::Error for LoggingError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.cause
            .as_ref()
            .map(|cause| cause as &(dyn std::error::Error + 'static))
    }
}
