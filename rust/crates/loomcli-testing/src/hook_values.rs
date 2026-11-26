//! Deterministic values for testing log hooks and progress observers.

use std::path::PathBuf;
use std::sync::Arc;

use loomcli_core::__private::unit;
use loomcli_core::{
    Env, FailureForm, LogDestination, LogEvent, LogFields, LogLevel, OutputStream, ProgressEvent,
    ProgressState,
};

use crate::mock::{DEFAULT_HOME, DEFAULT_PLATFORM};

/// The log event members a test can set.
#[derive(Clone, Debug)]
#[must_use]
pub struct LogEventValues(LogEvent);

impl Default for LogEventValues {
    fn default() -> Self {
        Self(unit::log_event())
    }
}

impl LogEventValues {
    /// Uses level `Info`, application `app` at version `0.0.0`, a run id of 32 zeroes, and
    /// timestamp `2026-01-01T00:00:00.000Z`. The message, fields, and path are empty. The plugin,
    /// failure, and defect are absent.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the timestamp.
    pub fn time(mut self, time: impl Into<String>) -> Self {
        self.0.time = time.into();
        self
    }

    /// Sets the log level.
    pub fn level(mut self, level: LogLevel) -> Self {
        self.0.level = level;
        self
    }

    /// Sets the message.
    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.0.message = message.into();
        self
    }

    /// Replaces the event's fields.
    pub fn fields(mut self, fields: LogFields) -> Self {
        unit::set_log_fields(&mut self.0, fields);
        self
    }

    /// Sets the application name and version.
    pub fn application(mut self, name: impl Into<String>, version: impl Into<String>) -> Self {
        self.0.application.name = name.into();
        self.0.application.version = version.into();
        self
    }

    /// Sets the run id.
    pub fn run(mut self, run: impl Into<String>) -> Self {
        self.0.run = run.into();
        self
    }

    /// Sets the routed Command path.
    pub fn path(mut self, path: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.0.path = path.into_iter().map(Into::into).collect();
        self
    }

    /// Sets the originating plugin's identity.
    pub fn plugin(mut self, plugin: impl Into<String>) -> Self {
        self.0.plugin = Some(plugin.into());
        self
    }

    /// Sets the event's failure form, such as one read from an invocation outcome.
    pub fn failure(mut self, form: FailureForm) -> Self {
        self.0.failure = Some(form);
        self
    }

    /// Sets the defect's type, message, and optional backtrace.
    pub fn defect(
        mut self,
        name: impl Into<String>,
        message: impl Into<String>,
        stack: Option<String>,
    ) -> Self {
        unit::set_log_defect(&mut self.0, name.into(), message.into(), stack);
        self
    }
}

/// Builds the owned event a test passes to an `on_log` hook.
#[must_use]
pub fn log_event(values: LogEventValues) -> LogEvent {
    values.0
}

/// The log destination members a test can set.
#[derive(Clone)]
#[must_use]
pub struct LogDestinationValues(LogDestination);

impl Default for LogDestinationValues {
    fn default() -> Self {
        Self(unit::log_destination(
            DEFAULT_HOME.into(),
            DEFAULT_PLATFORM.to_owned(),
        ))
    }
}

impl LogDestinationValues {
    /// Uses an empty environment, home `/loom-test/home`, platform `linux`, and no stderr,
    /// and a log that discards events.
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the environment.
    pub fn env(mut self, env: Env) -> Self {
        self.0.env = env;
        self
    }

    /// Sets the home directory.
    pub fn home(mut self, home: impl Into<PathBuf>) -> Self {
        self.0.home = home.into();
        self
    }

    /// Sets the platform.
    pub fn platform(mut self, platform: impl Into<String>) -> Self {
        self.0.platform = platform.into();
        self
    }

    /// Supplies the log the hook writes to.
    pub fn log(mut self, log: loomcli_core::Log) -> Self {
        self.0.log = log;
        self
    }

    /// Supplies the stream the hook writes to.
    pub fn stderr(mut self, stderr: Arc<dyn OutputStream>) -> Self {
        self.0.stderr = Some(stderr);
        self
    }
}

/// Builds the destination a test passes to an `on_log` hook, sharing any stated stream.
#[must_use]
pub fn log_destination(values: LogDestinationValues) -> LogDestination {
    values.0
}

/// The log-line members a test can set.
#[derive(Clone, Debug)]
#[must_use]
pub struct LogLineValues(loomcli_core::LogLine);

impl Default for LogLineValues {
    fn default() -> Self {
        Self(unit::log_line())
    }
}

impl LogLineValues {
    /// Uses an info level, empty text and fields, and the default log event.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the visible level.
    pub fn level(mut self, level: loomcli_core::LogLineLevel) -> Self {
        self.0.level = level;
        self
    }

    /// Sets the escaped, marked message text.
    pub fn text(mut self, text: impl Into<String>) -> Self {
        self.0.text = text.into();
        self
    }

    /// Appends one escaped trailing field.
    pub fn field(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        unit::add_log_line_field(&mut self.0, name.into(), value.into());
        self
    }

    /// Sets the log event the view reads.
    pub fn event(mut self, event: LogEvent) -> Self {
        self.0.event = Arc::new(event);
        self
    }
}

/// Builds the value a test passes to a log-line view.
#[must_use]
pub fn log_line(values: LogLineValues) -> loomcli_core::LogLine {
    values.0
}

/// The progress event members a test can set.
#[derive(Clone, Debug)]
#[must_use]
pub struct ProgressEventValues(ProgressEvent);

impl Default for ProgressEventValues {
    fn default() -> Self {
        Self(unit::progress_event())
    }
}

impl ProgressEventValues {
    /// Uses id `1`, an empty label, state `Updated`, and absent completed and total counts.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the region id.
    pub fn id(mut self, id: u64) -> Self {
        self.0.id = id;
        self
    }

    /// Sets the label.
    pub fn label(mut self, label: impl Into<String>) -> Self {
        self.0.label = label.into();
        self
    }

    /// Sets the progress state.
    pub fn state(mut self, state: ProgressState) -> Self {
        self.0.state = state;
        self
    }

    /// Sets the completed count.
    pub fn completed(mut self, completed: f64) -> Self {
        self.0.completed = Some(completed);
        self
    }

    /// Sets the total count.
    pub fn total(mut self, total: f64) -> Self {
        self.0.total = Some(total);
        self
    }
}

/// Builds the event a test passes to a progress observer.
#[must_use]
pub fn progress_event(values: ProgressEventValues) -> ProgressEvent {
    values.0
}
