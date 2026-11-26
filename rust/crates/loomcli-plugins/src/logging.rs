//! The logging plugin: writes each log event as one JSON record, appended to a size-rotated file in
//! the platform's state or log directory, or written to stderr.
//!
//! It is an `on_log` hook and nothing else: no option, middleware, view, or slot. One event is one
//! line, the event as JSON with its keys in the order `time`, `level`, `message`, `fields`,
//! `application`, `run`, `path`, `plugin`, `failure`, `defect`, an absent key omitted, followed by
//! one newline. Both destinations write the same bytes.

mod directory;
mod error;
mod file;
mod messages;
mod record;

use std::sync::Arc;

use loomcli_core::{AnyPlugin, IntoOutcome, LogDestination, LogEvent, LogLevel, Outcome, Plugin};

use crate::PACKAGE_NAME;

use self::directory::resolve_log_file;
use self::file::{FileSink, write_record};
use self::record::{is_written, record_of};

pub use self::error::{LoggingError, LoggingErrorKind};

/// The default size past which the file rotates.
const DEFAULT_MAX_BYTES: u64 = 10_000_000;

/// The default number of rotated copies kept.
const DEFAULT_KEEP: usize = 5;

/// Where the logging plugin writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogTarget {
    /// The application's log directory, as JSONL.
    File,
    /// Stderr, with the same bytes. Never stdout, which carries the run's output and, under MCP,
    /// the protocol.
    Stderr,
}

type ErrorHook = Arc<dyn Fn(&LoggingError) -> Outcome + Send + Sync>;

/// The logging plugin's settings builder.
///
/// The `file`, `max_bytes`, `keep`, and `on_error` settings apply to [`LogTarget::File`] and are
/// ignored by [`LogTarget::Stderr`].
#[must_use]
pub struct Logging {
    level: LogLevel,
    target: LogTarget,
    file: Option<String>,
    max_bytes: u64,
    keep: usize,
    on_error: Option<ErrorHook>,
}

/// The logging plugin: info and above to `<app>.jsonl` in the platform's log directory, rotating
/// past 10,000,000 bytes and keeping 5 copies.
pub fn logging() -> Logging {
    Logging {
        level: LogLevel::Info,
        target: LogTarget::File,
        file: None,
        max_bytes: DEFAULT_MAX_BYTES,
        keep: DEFAULT_KEEP,
        on_error: None,
    }
}

impl Logging {
    /// The lowest level written, `Info` by default. A `Fatal` event is never filtered by level, so
    /// `LogLevel::Fatal` writes the fatal events alone.
    pub fn level(self, level: LogLevel) -> Self {
        Self { level, ..self }
    }

    /// Where events are written, the file by default.
    pub fn target(self, target: LogTarget) -> Self {
        Self { target, ..self }
    }

    /// The log file: a name inside the default directory, an absolute path, or a path under `~/`,
    /// which resolves from the run's home and counts only when that is an absolute path. A relative
    /// `file` never resolves against the working directory.
    pub fn file(self, file: impl Into<String>) -> Self {
        Self {
            file: Some(file.into()),
            ..self
        }
    }

    /// The size in bytes past which the file rotates, 10,000,000 by default.
    pub fn max_bytes(self, max_bytes: u64) -> Self {
        Self { max_bytes, ..self }
    }

    /// How many rotated copies are kept, 5 by default. With 0, a rotation deletes the file.
    pub fn keep(self, keep: usize) -> Self {
        Self { keep, ..self }
    }

    /// Calls `hook` for each failure to resolve, create, append to, or rotate the file, once for
    /// each failure, every record included, and the next record tries the file again. With no hook
    /// a failure is ignored: the record is lost and the run continues, and the plugin writes
    /// nothing to stderr of its own. A hook that returns `Err` makes the `on_log` hook fail, which
    /// core reports as the hook's `foreign-throw` after the outcome.
    pub fn on_error<T: IntoOutcome>(
        self,
        hook: impl Fn(&LoggingError) -> T + Send + Sync + 'static,
    ) -> Self {
        Self {
            on_error: Some(Arc::new(move |error| hook(error).into_outcome())),
            ..self
        }
    }

    /// The plugin: an `on_log` hook and nothing else.
    pub fn plugin(self) -> Plugin {
        let identity = format!("{PACKAGE_NAME}/logging");
        let settings = Arc::new(self);
        Plugin::new(identity).on_log(move |event: &LogEvent, destination: &LogDestination| {
            settings.write(event, destination)
        })
    }

    /// Writes one event to the target the settings name.
    fn write(&self, event: &LogEvent, destination: &LogDestination) -> Outcome {
        if !is_written(event.level, self.level) {
            return Ok(());
        }
        match self.target {
            LogTarget::Stderr => {
                write_to_stderr(&record_of(event), destination);
                Ok(())
            }
            LogTarget::File => self.write_to_file(event, destination),
        }
    }

    fn write_to_file(&self, event: &LogEvent, destination: &LogDestination) -> Outcome {
        let report = |error: LoggingError| match &self.on_error {
            Some(hook) => hook(&error),
            None => Ok(()),
        };
        let path =
            match resolve_log_file(self.file.as_deref(), &event.application.name, destination) {
                Ok(path) => path,
                Err(error) => return report(error),
            };
        let sink = FileSink {
            path: &path,
            max_bytes: self.max_bytes,
            keep: self.keep,
            report: &report,
            rename: &|from, to| std::fs::rename(from, to),
        };
        write_record(&sink, &record_of(event))
    }
}

/// Writes the record to the run's stderr, and nothing when the run has none. The stream
/// acknowledges a hook's write at once, so one poll finishes it; a refused write is not the
/// plugin's to report.
fn write_to_stderr(record: &str, destination: &LogDestination) {
    let Some(stderr) = &destination.stderr else {
        return;
    };
    let mut write = stderr.write(record.as_bytes());
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    let _ = std::future::Future::poll(write.as_mut(), &mut context);
}

impl From<Logging> for AnyPlugin {
    fn from(settings: Logging) -> Self {
        settings.plugin().into()
    }
}
