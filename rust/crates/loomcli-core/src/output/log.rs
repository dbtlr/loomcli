//! Log events: what author code publishes and `on_log` hooks observe.
//!
//! Core hands each event to every installed `on_log` hook and writes no log record itself. A run
//! with no hook creates no event. Core logs one event for each failure it reports once the graph
//! has built, at `fatal` with the defect for a declaration fault or a defect and at `error`
//! otherwise.

use std::collections::HashSet;
use std::hash::{BuildHasher, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError, Weak};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::application::declaration::ApplicationDeclaration;
use crate::diagnostics::defect::defect_detail;
use crate::failures::messages::{failure_reason, is_author_fault};
use crate::failures::{Error, Failure, FailureFacts, FailureForm};
use crate::host::{Env, Host, OutputStream};
use crate::invocation::Outcome;
use crate::support::BoxFuture;

use super::emit::Output;
use super::log_line::LogLineLevel;
use super::redaction::Redaction;

/// A log event's level. `Fatal` is core's alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// Trace.
    Trace,
    /// Debug.
    Debug,
    /// Info.
    Info,
    /// Warn.
    Warn,
    /// Error.
    Error,
    /// Fatal: a defect core logs.
    Fatal,
}

/// The structured fields of a log call, copied as JSON by the builder.
#[derive(Clone, Debug, Default, PartialEq)]
#[must_use]
pub struct LogFields(pub(crate) Map<String, Value>, HashSet<String>);

impl LogFields {
    /// No fields.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a field, copied now as the JSON data serde writes for `value`, so a later change to
    /// the caller's value changes nothing. A value that does not serialize, and a number that is
    /// not finite, records as `null`. A second field with one name replaces the first in its place.
    pub fn field(mut self, name: &str, value: impl Serialize) -> Self {
        let copied = serde_json::to_value(value).unwrap_or(serde_json::Value::Null);
        self.1.remove(name);
        self.0.insert(name.to_owned(), copied);
        self
    }

    /// Copies a Rust error's name, message, captured stack, and cause as structured fields.
    pub fn error_field(mut self, name: &str, error: &Error) -> Self {
        self.1.insert(name.to_owned());
        self.0.insert(name.to_owned(), error_value(error));
        self
    }

    fn redacted(mut self, redaction: &Redaction) -> Map<String, Value> {
        redaction.apply(&mut self.0, &self.1);
        self.0
    }
}

fn error_value(error: &Error) -> Value {
    if let Some(failure) = error.failure() {
        return error_object(
            failure.class().name(),
            failure_reason(failure),
            None,
            failure.cause().map(error_value),
        );
    }
    let foreign = error.foreign();
    error_object(
        error.foreign_type_name().unwrap_or("Error"),
        foreign.map(ToString::to_string).unwrap_or_default(),
        error.backtrace().map(ToString::to_string),
        foreign
            .and_then(std::error::Error::source)
            .map(foreign_cause),
    )
}

fn foreign_cause(error: &dyn std::error::Error) -> Value {
    error_object(
        "Error",
        error.to_string(),
        None,
        error.source().map(foreign_cause),
    )
}

fn error_object(name: &str, message: String, stack: Option<String>, cause: Option<Value>) -> Value {
    let mut facts = Map::from_iter([
        ("name".to_owned(), Value::String(name.to_owned())),
        ("message".to_owned(), Value::String(message)),
    ]);
    if let Some(stack) = stack {
        facts.insert("stack".to_owned(), Value::String(stack));
    }
    if let Some(cause) = cause {
        facts.insert("cause".to_owned(), cause);
    }
    Value::Object(facts)
}

impl From<()> for LogFields {
    fn from(_: ()) -> Self {
        LogFields::default()
    }
}

/// The defect a fatal event carries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct LogDefect {
    /// The defect's class or type name.
    pub name: String,
    /// Its message.
    pub message: String,
    /// Its backtrace, when captured.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

/// The application an event belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct LogApplication {
    /// Its name.
    pub name: String,
    /// Its version.
    pub version: String,
}

/// One log event.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[non_exhaustive]
pub struct LogEvent {
    /// ISO 8601 UTC with milliseconds, read at the call.
    pub time: String,
    /// The level.
    pub level: LogLevel,
    /// The message.
    pub message: String,
    /// The copied fields.
    pub fields: serde_json::Map<String, serde_json::Value>,
    /// The application.
    pub application: LogApplication,
    /// 32 lowercase hex characters, one per run.
    pub run: String,
    /// The routed path.
    pub path: Vec<String>,
    /// The identity of the plugin that published it, or `null` for the application's code.
    pub plugin: Option<String>,
    /// Core's failure events alone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<FailureForm>,
    /// Fatal events alone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub defect: Option<LogDefect>,
}

/// Where a log hook writes: the outermost run's environment, home, platform, and stderr.
#[derive(Clone)]
#[non_exhaustive]
pub struct LogDestination {
    /// The outermost run's environment.
    pub env: Env,
    /// The outermost run's home folder.
    pub home: PathBuf,
    /// The outermost run's platform.
    pub platform: String,
    /// The outermost run's stderr; `None` when the outermost run was invoked by name.
    pub stderr: Option<Arc<dyn OutputStream>>,
    /// The hook's log. Its events reach the other hooks under this hook's plugin identity.
    pub log: Log,
    pub(crate) scope: Arc<()>,
}

impl LogDestination {
    /// The identity and lifetime shared by this outermost run's log destinations.
    ///
    /// Compare these handles with `Weak::ptr_eq`. A hook can release run-local state once the
    /// handle can no longer be upgraded.
    #[must_use]
    pub fn run_scope(&self) -> Weak<()> {
        Arc::downgrade(&self.scope)
    }
}

/// Publishes log events and shows them at the outermost run's verbosity.
#[derive(Clone)]
pub struct Log {
    run: Option<LogRun>,
    plugin: Option<Arc<str>>,
    bound: Option<Arc<Map<String, Value>>>,
}

#[derive(Clone)]
enum LogRun {
    Context(Arc<RunLog>),
    Destination(Weak<RunLog>, usize),
}

impl Log {
    pub(crate) fn inert() -> Self {
        Self {
            run: None,
            plugin: None,
            bound: None,
        }
    }

    /// Returns a log carrying these fields alongside each call's own fields.
    #[must_use]
    pub fn with(&self, fields: impl Into<LogFields>) -> Self {
        let Some((run, _)) = self.run() else {
            return self.clone();
        };
        let fields = fields.into().redacted(&run.redaction);
        Self {
            bound: Some(Arc::new(self.merge(fields))),
            ..self.clone()
        }
    }

    fn run(&self) -> Option<(Arc<RunLog>, Option<usize>)> {
        match self.run.as_ref()? {
            LogRun::Context(run) => Some((Arc::clone(run), None)),
            LogRun::Destination(run, index) => Some((run.upgrade()?, Some(*index))),
        }
    }

    fn merge(&self, fields: Map<String, Value>) -> Map<String, Value> {
        let Some(bound) = &self.bound else {
            return fields;
        };
        let mut merged = Map::clone(bound);
        merged.extend(fields);
        merged
    }

    fn publish(&self, level: LogLevel, message: &str, fields: impl Into<LogFields>) {
        let Some((log, exclude)) = self.run() else {
            return;
        };
        let visible = LogLineLevel::from_log(level).filter(|level| log.showing(*level));
        if visible.is_none() && !log.listened(exclude) {
            return;
        }
        log.deliver(
            EventParts {
                level,
                message: message.to_owned(),
                fields: self.merge(fields.into().redacted(&log.redaction)),
                plugin: self.plugin.as_deref().map(str::to_owned),
                failure: None,
                defect: None,
            },
            visible,
            exclude,
        );
    }

    /// Publishes a trace event.
    pub fn trace(&self, message: &str, fields: impl Into<LogFields>) {
        self.publish(LogLevel::Trace, message, fields);
    }

    /// Publishes a debug event.
    pub fn debug(&self, message: &str, fields: impl Into<LogFields>) {
        self.publish(LogLevel::Debug, message, fields);
    }

    /// Publishes an info event.
    pub fn info(&self, message: &str, fields: impl Into<LogFields>) {
        self.publish(LogLevel::Info, message, fields);
    }

    /// Publishes a warn event.
    pub fn warn(&self, message: &str, fields: impl Into<LogFields>) {
        self.publish(LogLevel::Warn, message, fields);
    }

    /// Publishes an error event.
    pub fn error(&self, message: &str, fields: impl Into<LogFields>) {
        self.publish(LogLevel::Error, message, fields);
    }
}

/// An installed `on_log` hook.
pub(crate) type LogHook = Arc<dyn Fn(&LogEvent, &LogDestination) -> Outcome + Send + Sync>;

/// A hook paired with the plugin that installed it. Tests can install unnamed hooks.
pub(crate) type InstalledLogHook = (Option<Arc<str>>, LogHook);

#[derive(Clone)]
struct Receiver {
    hook: LogHook,
    destination: LogDestination,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What one event is before the facts every event of the run shares are added.
struct EventParts {
    level: LogLevel,
    message: String,
    fields: serde_json::Map<String, serde_json::Value>,
    plugin: Option<String>,
    failure: Option<FailureForm>,
    defect: Option<LogDefect>,
}

/// The first `Err` a hook returned in the run: held until the run reports it once.
enum Thrown {
    None,
    Held(Error),
    Reported,
}

/// One run's log events: the delivery of every event to the installed hooks in installation order,
/// core's failure events, and the first `Err` a hook returned. A hook that fails is still called
/// for every later event, and its failure ends neither the delivery of that event to a later hook
/// nor the call that created it.
pub(crate) struct RunLog {
    application: LogApplication,
    /// A nested run keeps its route and id but uses the outermost run's hooks and screen.
    outer: Option<Arc<RunLog>>,
    receivers: Mutex<Arc<[Receiver]>>,
    output: Arc<Output>,
    run: OnceLock<String>,
    thrown: Mutex<Thrown>,
    redaction: Redaction,
}

impl RunLog {
    /// Builds the outermost log and its destinations. A named invocation only captures lines.
    pub(crate) fn new(
        application: &ApplicationDeclaration,
        host: &Host,
        output: &Arc<Output>,
        argv: bool,
    ) -> Arc<Self> {
        Self::root(
            application_facts(application),
            application.log_hooks.clone(),
            application.log_redaction.clone(),
            host,
            output,
            argv,
        )
    }

    /// A unit context has test hooks and no destination stderr.
    pub(crate) fn unattached(
        application: &str,
        hooks: Vec<LogHook>,
        host: &Host,
        output: &Arc<Output>,
    ) -> Arc<Self> {
        Self::root(
            LogApplication {
                name: application.to_owned(),
                version: "0.0.0".to_owned(),
            },
            hooks.into_iter().map(|hook| (None, hook)).collect(),
            Redaction::default(),
            host,
            output,
            false,
        )
    }

    fn root(
        application: LogApplication,
        hooks: Vec<InstalledLogHook>,
        redaction: Redaction,
        host: &Host,
        output: &Arc<Output>,
        argv: bool,
    ) -> Arc<Self> {
        Arc::new_cyclic(|run| {
            let stderr = argv.then(|| {
                Arc::new(CarriedStderr {
                    output: Arc::clone(output),
                }) as Arc<dyn OutputStream>
            });
            let scope = Arc::new(());
            let receivers = hooks
                .into_iter()
                .enumerate()
                .map(|(index, (plugin, hook))| Receiver {
                    hook,
                    destination: LogDestination {
                        env: host.env.clone(),
                        home: host.home.clone(),
                        platform: host.platform.clone(),
                        stderr: stderr.clone(),
                        log: Log {
                            run: Some(LogRun::Destination(run.clone(), index)),
                            plugin,
                            bound: None,
                        },
                        scope: Arc::clone(&scope),
                    },
                })
                .collect();
            Self {
                application,
                outer: None,
                receivers: Mutex::new(receivers),
                output: Arc::clone(output),
                run: OnceLock::new(),
                thrown: Mutex::new(Thrown::None),
                redaction,
            }
        })
    }

    pub(crate) fn nested(
        application: &ApplicationDeclaration,
        output: &Arc<Output>,
        parent: &Arc<RunLog>,
    ) -> Arc<Self> {
        Arc::new(Self {
            application: application_facts(application),
            outer: Some(Arc::clone(parent.outer.as_ref().unwrap_or(parent))),
            receivers: Mutex::new(Arc::from([])),
            output: Arc::clone(output),
            run: OnceLock::new(),
            thrown: Mutex::new(Thrown::None),
            redaction: application.log_redaction.clone(),
        })
    }

    pub(crate) fn bind(self: &Arc<Self>, plugin: Option<Arc<str>>) -> Log {
        Log {
            run: Some(LogRun::Context(Arc::clone(self))),
            plugin,
            bound: None,
        }
    }

    /// Hands every later event's hooks the environment preparation has merged.
    pub(crate) fn set_env(&self, env: Env) {
        let mut receivers = locked(&self.outermost().receivers);
        for receiver in Arc::make_mut(&mut receivers) {
            receiver.destination.env.clone_from(&env);
        }
    }

    fn outermost(&self) -> &Self {
        self.outer.as_deref().unwrap_or(self)
    }

    fn showing(&self, level: LogLineLevel) -> bool {
        self.outermost().output.shows_log(level)
    }

    fn listened(&self, exclude: Option<usize>) -> bool {
        locked(&self.outermost().receivers).len() > usize::from(exclude.is_some())
    }

    /// Logs one failure the run reports: `fatal` with the defect the run caught for a declaration
    /// fault or a defect, `error` for every other failure.
    pub(crate) fn failure(&self, failure: &dyn Failure, form: FailureForm) {
        if !self.listened(None) {
            return;
        }
        let author = is_author_fault(failure);
        self.deliver(
            EventParts {
                level: if author {
                    LogLevel::Fatal
                } else {
                    LogLevel::Error
                },
                message: form.message.clone(),
                fields: serde_json::Map::new(),
                plugin: None,
                failure: Some(form),
                defect: author.then(|| defect_detail(failure)),
            },
            None,
            None,
        );
    }

    /// The first `Err` a hook returned, once: the run reports it after every other report, and a
    /// later `Err`, such as one on the event that report logs, is not reported.
    pub(crate) fn take_thrown(&self) -> Option<Error> {
        let mut thrown = locked(&self.thrown);
        match std::mem::replace(&mut *thrown, Thrown::Reported) {
            Thrown::Held(error) => Some(error),
            Thrown::None => {
                *thrown = Thrown::None;
                None
            }
            Thrown::Reported => None,
        }
    }

    /// Shows an eligible line and hands its event to the hooks in installation order.
    fn deliver(&self, parts: EventParts, visible: Option<LogLineLevel>, exclude: Option<usize>) {
        let event = Arc::new(LogEvent {
            time: now(),
            level: parts.level,
            message: parts.message,
            fields: parts.fields,
            application: self.application.clone(),
            run: self.run.get_or_init(new_run_id).clone(),
            path: self.output.route(),
            plugin: parts.plugin,
            failure: parts.failure,
            defect: parts.defect,
        });
        let outer = self.outermost();
        if let Some(level) = visible {
            outer.output.show_log(Arc::clone(&event), level);
        }
        let receivers = Arc::clone(&locked(&outer.receivers));
        for (index, receiver) in receivers.iter().enumerate() {
            if Some(index) != exclude
                && let Err(error) = (receiver.hook)(&event, &receiver.destination)
            {
                let mut thrown = locked(&self.thrown);
                if matches!(*thrown, Thrown::None) {
                    *thrown = Thrown::Held(error);
                }
            }
        }
    }
}

fn application_facts(application: &ApplicationDeclaration) -> LogApplication {
    LogApplication {
        name: application.name.clone(),
        version: application
            .version
            .clone()
            .unwrap_or_else(|| "0.0.0".to_owned()),
    }
}

/// The current time as ISO 8601 UTC with milliseconds.
fn now() -> String {
    jiff::Timestamp::now()
        .strftime("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// Numbers run ids, so two runs in one process never hash the same input.
static RUNS: AtomicU64 = AtomicU64::new(0);

/// 128 unpredictable bits as 32 lowercase hexadecimal characters, the format of an OpenTelemetry
/// trace id: two halves, each a hash under a randomly keyed hasher of a count and the time.
fn new_run_id() -> String {
    let count = RUNS.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let half = |salt: u64| {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u64(count);
        hasher.write_u128(nanos);
        hasher.write_u64(salt);
        hasher.finish()
    };
    format!("{:016x}{:016x}", half(0), half(1))
}

/// The stderr a log hook writes to: each write joins the run's stderr order at the call and is
/// acknowledged at once, so a synchronous hook writes without awaiting, and on a terminal its line
/// lands above the open regions.
struct CarriedStderr {
    output: Arc<Output>,
}

impl OutputStream for CarriedStderr {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, std::io::Result<()>> {
        self.output
            .carry(String::from_utf8_lossy(bytes).into_owned());
        Box::pin(std::future::ready(Ok(())))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn redacting_the_message_hides_only_a_typed_errors_stack() {
        let error = Error::from(std::io::Error::other("private"))
            .with_backtrace(std::backtrace::Backtrace::force_capture());
        let plain = serde_json::json!({"name":"Error", "message":"private", "stack":"plain stack"});
        let fields = LogFields::new()
            .error_field("error", &error)
            .field("plain", plain);
        let plain_fields = fields.clone().redacted(&Redaction::default());
        assert_eq!(plain_fields["error"]["message"], "private");
        assert!(plain_fields["error"]["stack"].as_str().is_some());
        let redacted =
            fields.redacted(&Redaction::new(&["error.message", "plain.message"]).unwrap());
        assert_eq!(redacted["error"]["message"], "[Redacted]");
        assert_eq!(redacted["error"]["stack"], "[Redacted]");
        assert_eq!(redacted["plain"]["message"], "[Redacted]");
        assert_eq!(redacted["plain"]["stack"], "plain stack");
    }
}
