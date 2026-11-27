//! Settings and delivery for the logging plugin.

use std::cell::OnceCell;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};

use loomcli_core::{
    AnyPlugin, DeclarationError, DirectoryFacts, Error, Failure, InternalError, IntoList,
    IntoOutcome, LogDestination, LogEvent, LogFields, LogLevel, Outcome, Plugin, UsageError,
};

use crate::PACKAGE_NAME;

use super::error::LoggingError;
use super::extension::{DeclaredLogFile, LOGGING_FILES, LogVariable, LoggingFilesFacts};
use super::file::{FileSink, stat, write_record};
use super::messages;
use super::otel::OpenTelemetryDestination;
use super::record::{is_written, record_of};
use super::resolution::{RejectedLogVariables, ResolvedLogFile, resolve_logging_files};

/// The destination of the single-destination shorthand.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LogTarget {
    /// A size-rotated JSON Lines file.
    #[default]
    File,
    /// JSON Lines records on the run's stderr.
    Stderr,
}

/// The kinds of failure that get a pointer to their log record.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub enum FailureHint {
    /// Every failure outside the usage error class.
    #[default]
    Runtime,
    /// Every failure that appended to a log file.
    Always,
    /// Internal and declaration errors.
    Defects,
    /// Suppress log file hints.
    Disabled,
}

impl FailureHint {
    fn shows(self, failure: &dyn Failure) -> bool {
        match self {
            Self::Runtime => !failure.is::<UsageError>(),
            Self::Always => true,
            Self::Defects => failure.is::<InternalError>() || failure.is::<DeclarationError>(),
            Self::Disabled => false,
        }
    }
}

type ErrorHook = Box<dyn Fn(&LoggingError) -> Outcome + Send + Sync>;

/// A size-rotated file destination for an ordered destination list.
#[must_use]
pub struct FileDestination {
    declared: DeclaredLogFile,
    max_bytes: u64,
    keep: usize,
    on_error: Option<ErrorHook>,
}

impl Default for FileDestination {
    fn default() -> Self {
        Self {
            declared: DeclaredLogFile::new(LogLevel::Info),
            max_bytes: 10_000_000,
            keep: 5,
            on_error: None,
        }
    }
}

impl FileDestination {
    /// Logs Info and above to the default file, rotating past 10,000,000 bytes with five copies.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the minimum level. Fatal events always reach the destination.
    pub fn level(mut self, level: LogLevel) -> Self {
        self.declared.level = level;
        self
    }

    /// Sets the file name or path. A relative name resolves within the default log directory.
    pub fn file(mut self, file: impl Into<String>) -> Self {
        self.declared = self.declared.file(file);
        self
    }

    /// Sets the size in bytes past which the file rotates.
    pub fn max_bytes(mut self, max_bytes: u64) -> Self {
        self.max_bytes = max_bytes;
        self
    }

    /// Sets how many rotated copies are kept. At zero, rotation deletes the old file.
    pub fn keep(mut self, keep: usize) -> Self {
        self.keep = keep;
        self
    }

    /// Handles failures to resolve, create, append to, or rotate this file. An `Err` takes the
    /// ordinary log-hook failure path. Without a callback, delivery continues after a file failure.
    pub fn on_error<T: IntoOutcome>(
        mut self,
        hook: impl Fn(&LoggingError) -> T + Send + Sync + 'static,
    ) -> Self {
        self.on_error = Some(Box::new(move |error| hook(error).into_outcome()));
        self
    }

    fn write<'a>(
        &self,
        record: impl FnOnce() -> &'a str,
        file: ResolvedLogFile,
        announce: impl FnOnce() -> bool,
        destination: &LogDestination,
    ) -> Result<Option<PathBuf>, Error> {
        let report = |error| self.on_error.as_ref().map_or(Ok(()), |hook| hook(&error));
        let path = match file.path {
            Ok(path) => path,
            Err(error) => {
                report(error)?;
                return Ok(None);
            }
        };
        let sink = FileSink {
            path: &path,
            max_bytes: self.max_bytes,
            keep: self.keep,
            report: &report,
            rename: &|from, to| std::fs::rename(from, to),
            stat: &stat,
        };
        let written = write_record(&sink, record())?;
        let fields = || LogFields::new().field("path", path.to_string_lossy());
        if written.rotated {
            destination.log.trace(messages::ROTATED, fields());
        }
        if written.appended && announce() {
            destination.log.debug(messages::LOGGING_TO, fields());
        }
        Ok(written.appended.then_some(path))
    }
}

/// A JSON Lines destination on stderr.
#[must_use]
pub struct ConsoleDestination {
    level: LogLevel,
}

impl Default for ConsoleDestination {
    fn default() -> Self {
        Self {
            level: LogLevel::Info,
        }
    }
}

impl ConsoleDestination {
    /// Logs Info and above to the run's stderr when it has one.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the minimum level. Fatal events always reach the destination.
    pub fn level(mut self, level: LogLevel) -> Self {
        self.level = level;
        self
    }
}

enum Destination {
    File(FileDestination),
    Console(ConsoleDestination),
    OpenTelemetry(OpenTelemetryDestination),
}

/// One independently filtered destination in an ordered logging list.
pub struct LoggingDestination(Destination);

impl From<FileDestination> for LoggingDestination {
    fn from(file: FileDestination) -> Self {
        Self(Destination::File(file))
    }
}

impl From<ConsoleDestination> for LoggingDestination {
    fn from(console: ConsoleDestination) -> Self {
        Self(Destination::Console(console))
    }
}

impl From<OpenTelemetryDestination> for LoggingDestination {
    fn from(otel: OpenTelemetryDestination) -> Self {
        Self(Destination::OpenTelemetry(otel))
    }
}

/// The shorthand settings for one file or console destination.
#[derive(Default)]
pub struct SingleDestination {
    target: LogTarget,
    file: FileDestination,
}

/// The settings for an explicit list of destinations.
pub struct MultipleDestinations(Vec<LoggingDestination>);

/// Settings for the logging plugin.
#[must_use]
pub struct Logging<D = SingleDestination> {
    destinations: D,
    level_env: LogVariable,
    file_env: LogVariable,
    failure_hint: FailureHint,
}

/// Logs Info and above to the default file, rotating past 10,000,000 bytes with five copies.
pub fn logging() -> Logging {
    Logging {
        destinations: SingleDestination::default(),
        level_env: LogVariable::default(),
        file_env: LogVariable::default(),
        failure_hint: FailureHint::default(),
    }
}

impl Logging {
    /// Replaces the shorthand settings with destinations in declaration order.
    ///
    /// The returned builder has no shorthand setters. Each destination sets its own level,
    /// path, rotation, and error callback as applicable.
    ///
    /// ```compile_fail
    /// use loomcli_core::LogLevel;
    /// use loomcli_plugins::logging::{FileDestination, logging};
    /// let files = logging().destinations([FileDestination::new()]);
    /// let _ = files.level(LogLevel::Debug);
    /// ```
    ///
    /// ```compile_fail
    /// use loomcli_plugins::logging::{FileDestination, logging};
    /// let files = logging().destinations([FileDestination::new()]);
    /// let _ = files.file("other.jsonl");
    /// ```
    ///
    /// ```compile_fail
    /// use loomcli_plugins::logging::{LogTarget, LoggingDestination, logging};
    /// let _ = logging().destinations(Vec::<LoggingDestination>::new()).target(LogTarget::Stderr);
    /// ```
    ///
    /// ```compile_fail
    /// use loomcli_plugins::logging::{LoggingDestination, logging};
    /// let _ = logging().destinations(Vec::<LoggingDestination>::new()).max_bytes(100);
    /// ```
    ///
    /// ```compile_fail
    /// use loomcli_plugins::logging::{LoggingDestination, logging};
    /// let _ = logging().destinations(Vec::<LoggingDestination>::new()).keep(1);
    /// ```
    ///
    /// ```compile_fail
    /// use loomcli_plugins::logging::{LoggingDestination, logging};
    /// let _ = logging().destinations(Vec::<LoggingDestination>::new()).on_error(|_| ());
    /// ```
    pub fn destinations(
        self,
        list: impl IntoList<LoggingDestination>,
    ) -> Logging<MultipleDestinations> {
        Logging {
            destinations: MultipleDestinations(list.into_list()),
            level_env: self.level_env,
            file_env: self.file_env,
            failure_hint: self.failure_hint,
        }
    }

    /// Sets the destination's minimum level. Fatal events always reach the destination.
    pub fn level(mut self, level: LogLevel) -> Self {
        self.destinations.file = self.destinations.file.level(level);
        self
    }

    /// Sets the destination. A console target uses only the shorthand's level.
    pub fn target(mut self, target: LogTarget) -> Self {
        self.destinations.target = target;
        self
    }

    /// Sets the file name or path. A relative name resolves within the default log directory.
    pub fn file(mut self, file: impl Into<String>) -> Self {
        self.destinations.file = self.destinations.file.file(file);
        self
    }

    /// Sets the size in bytes past which the file rotates.
    pub fn max_bytes(mut self, max_bytes: u64) -> Self {
        self.destinations.file = self.destinations.file.max_bytes(max_bytes);
        self
    }

    /// Sets how many rotated copies are kept. At zero, rotation deletes the old file.
    pub fn keep(mut self, keep: usize) -> Self {
        self.destinations.file = self.destinations.file.keep(keep);
        self
    }

    /// Handles this file's failures. An `Err` takes the ordinary log-hook failure path.
    pub fn on_error<T: IntoOutcome>(
        mut self,
        hook: impl Fn(&LoggingError) -> T + Send + Sync + 'static,
    ) -> Self {
        self.destinations.file = self.destinations.file.on_error(hook);
        self
    }

    /// Builds the logging plugin with the shorthand destination.
    pub fn plugin(self) -> Plugin {
        let destination = match self.destinations.target {
            LogTarget::File => Destination::File(self.destinations.file),
            LogTarget::Stderr => Destination::Console(ConsoleDestination {
                level: self.destinations.file.declared.level,
            }),
        };
        build_plugin(
            vec![LoggingDestination(destination)],
            self.level_env,
            self.file_env,
            self.failure_hint,
        )
    }
}

impl<D> Logging<D> {
    /// Sets the binding for the operator's file-level override.
    pub fn level_env(mut self, binding: LogVariable) -> Self {
        self.level_env = binding;
        self
    }

    /// Sets the binding for the operator's override of the first file's path.
    pub fn file_env(mut self, binding: LogVariable) -> Self {
        self.file_env = binding;
        self
    }

    /// Selects the failures that point the operator to their log records.
    pub fn failure_hint(mut self, mode: FailureHint) -> Self {
        self.failure_hint = mode;
        self
    }
}

impl Logging<MultipleDestinations> {
    /// Builds the logging plugin with the ordered destination list.
    pub fn plugin(self) -> Plugin {
        build_plugin(
            self.destinations.0,
            self.level_env,
            self.file_env,
            self.failure_hint,
        )
    }
}

impl From<Logging> for AnyPlugin {
    fn from(settings: Logging) -> Self {
        settings.plugin().into()
    }
}

impl From<Logging<MultipleDestinations>> for AnyPlugin {
    fn from(settings: Logging<MultipleDestinations>) -> Self {
        settings.plugin().into()
    }
}

// Each outermost run has independent warning and announcement state. Failure appends are
// keyed by their own run IDs, including those of concurrent named invocations in that scope.
struct RunRecords {
    scope: Weak<()>,
    warned: bool,
    announced: HashSet<usize>,
    failures: HashMap<String, Vec<PathBuf>>,
}

#[derive(Default)]
struct Records(Mutex<Vec<RunRecords>>);

struct ReleaseRecords {
    records: Weak<Records>,
    scope: Weak<()>,
}

impl Drop for ReleaseRecords {
    fn drop(&mut self) {
        if let Some(records) = self.records.upgrade() {
            records.lock().retain(|run| !run.scope.ptr_eq(&self.scope));
        }
    }
}

impl Records {
    fn lock(&self) -> MutexGuard<'_, Vec<RunRecords>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn for_run<T>(
        self: &Arc<Self>,
        destination: &LogDestination,
        update: impl FnOnce(&mut RunRecords) -> T,
    ) -> T {
        let scope = destination.run_scope();
        let mut runs = self.lock();
        if let Some(run) = runs.iter_mut().find(|run| run.scope.ptr_eq(&scope)) {
            return update(run);
        }
        let mut run = RunRecords {
            scope: scope.clone(),
            warned: false,
            announced: HashSet::new(),
            failures: HashMap::new(),
        };
        let answer = update(&mut run);
        runs.push(run);
        destination.hold_for_run(ReleaseRecords {
            records: Arc::downgrade(self),
            scope,
        });
        answer
    }

    fn take_failure(&self, run: &str) -> Vec<PathBuf> {
        self.lock()
            .iter_mut()
            .find_map(|outer| outer.failures.remove(run))
            .unwrap_or_default()
    }
}

fn build_plugin(
    destinations: Vec<LoggingDestination>,
    level_env: LogVariable,
    file_env: LogVariable,
    mode: FailureHint,
) -> Plugin {
    let facts = LoggingFilesFacts::new(destinations.iter().filter_map(|plan| match &plan.0 {
        Destination::File(file) => Some(file.declared.clone()),
        Destination::Console(_) | Destination::OpenTelemetry(_) => None,
    }))
    .level_env(level_env)
    .file_env(file_env);
    let records = Arc::new(Records::default());
    let attached = facts.clone();
    Plugin::new(format!("{PACKAGE_NAME}/logging"))
        .extensions([&LOGGING_FILES])
        .on_command_attach(move |command| {
            if command.name().is_none() {
                command.extend([LOGGING_FILES.value(attached.clone())])?;
            }
            Ok(())
        })
        .on_failure({
            let records = Arc::clone(&records);
            move |failure, context| {
                let paths = records.take_failure(&context.run);
                if !mode.shows(failure) {
                    return Vec::new();
                }
                paths
                    .into_iter()
                    .map(|path| messages::failure_log(&path.to_string_lossy(), &context.run))
                    .collect()
            }
        })
        .on_log(move |event, destination| {
            write_event(&destinations, &facts, &records, mode, event, destination)
        })
}

fn write_event(
    destinations: &[LoggingDestination],
    facts: &LoggingFilesFacts,
    records: &Arc<Records>,
    hint: FailureHint,
    event: &LogEvent,
    destination: &LogDestination,
) -> Outcome {
    let mut files = if facts.files.is_empty() {
        Vec::new().into_iter()
    } else {
        let host = DirectoryFacts::new(
            destination.env.clone(),
            &destination.home,
            &destination.platform,
        );
        let resolved = resolve_logging_files(facts, &event.application.name, &host);
        warn_rejected(records, destination, resolved.rejected);
        resolved.files.into_iter()
    };
    let bytes = OnceCell::new();
    let record = || bytes.get_or_init(|| record_of(event)).as_str();
    let track_failure =
        hint != FailureHint::Disabled && event.failure.is_some() && !facts.files.is_empty();
    if track_failure {
        // A preceding hook can stop hint collection. A later report starts with its own appends.
        records.for_run(destination, |run| {
            run.failures.remove(&event.run);
        });
    }
    let mut appended = Vec::new();
    let mut seen = HashSet::new();
    for (index, plan) in destinations.iter().enumerate() {
        match &plan.0 {
            Destination::File(writer) => {
                let Some(file) = files
                    .next()
                    .filter(|file| is_written(event.level, file.level))
                else {
                    continue;
                };
                let path = writer.write(
                    record,
                    file,
                    || records.for_run(destination, |run| run.announced.insert(index)),
                    destination,
                )?;
                if track_failure
                    && let Some(path) = path
                    && seen.insert(path.as_os_str().to_owned())
                {
                    appended.push(path);
                }
            }
            Destination::Console(console) => {
                if is_written(event.level, console.level)
                    && let Some(stderr) = &destination.stderr
                {
                    write_to_stderr(record(), stderr.as_ref());
                }
            }
            Destination::OpenTelemetry(otel) => otel.write(event)?,
        }
    }
    if !appended.is_empty() {
        records.for_run(destination, |run| {
            run.failures.insert(event.run.clone(), appended)
        });
    }
    Ok(())
}

fn warn_rejected(
    records: &Arc<Records>,
    destination: &LogDestination,
    rejected: RejectedLogVariables,
) {
    if (rejected.level.is_none() && rejected.file.is_none())
        || records.for_run(destination, |run| std::mem::replace(&mut run.warned, true))
    {
        return;
    }
    if let Some(rejected) = rejected.level {
        destination.warn(&messages::bad_level(&rejected.variable, &rejected.value));
    }
    if let Some(rejected) = rejected.file {
        destination.warn(&messages::bad_file(&rejected.variable, &rejected.value));
    }
}

fn write_to_stderr(record: &str, stderr: &dyn loomcli_core::OutputStream) {
    // Core's carried stream queues the whole record on its first poll.
    let mut write = stderr.write(record.as_bytes());
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    let _ = std::future::Future::poll(write.as_mut(), &mut context);
}

#[cfg(test)]
mod tests {
    use loomcli_testing::{LogDestinationValues, log_destination};

    use super::*;

    #[test]
    fn scope_expiry_releases_a_failure_whose_hint_was_never_collected() {
        let records = Arc::new(Records::default());
        let destination = log_destination(LogDestinationValues::new());
        let scope = destination.run_scope();
        records.for_run(&destination, |run| {
            run.failures
                .insert("id".into(), vec![PathBuf::from("/loom-test/log.jsonl")]);
        });
        assert_eq!(records.lock().len(), 1);
        drop(destination);
        assert!(scope.upgrade().is_none());
        assert!(records.lock().is_empty());
    }
}
