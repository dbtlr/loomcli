//! Log events: what author code publishes and `on_log` hooks observe.
//!
//! Core hands each event to every installed `on_log` hook and writes no log record itself. A run
//! with no hook creates no event. Core logs one event for each failure it reports once the graph
//! has built, at `fatal` with the defect for a declaration fault or a defect and at `error`
//! otherwise.

use std::hash::{BuildHasher, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use serde::Serialize;

use crate::diagnostics::defect::defect_detail;
use crate::failures::sentences::is_author_fault;
use crate::failures::{Error, Failure, FailureForm};
use crate::host::{Env, Host, OutputStream};
use crate::invocation::Outcome;
use crate::support::BoxFuture;

use super::emit::Output;

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

/// The structured fields of one event, copied as JSON when the event is published.
#[derive(Clone, Debug, Default, PartialEq)]
#[must_use]
pub struct LogFields(pub(crate) serde_json::Map<String, serde_json::Value>);

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
        self.0.insert(name.to_owned(), copied);
        self
    }
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
    /// The outermost run's stderr; `None` under an invocation by name.
    pub stderr: Option<Arc<dyn OutputStream>>,
}

/// Publishes log events to the installed `on_log` hooks. Core writes no log record itself: with no
/// installed hook, a call creates no event.
///
/// Each context's `log` is bound to it: a middleware's, a source's, and a failure hook's name the
/// plugin core is calling, and an action's names none. A call creates one event and hands it to
/// every hook, in installation order, before it returns; a hook's `Err` never reaches the caller.
#[derive(Clone)]
pub struct Log {
    pub(crate) run: Arc<crate::__private::RunState>,
    pub(crate) plugin: Option<Arc<str>>,
}

impl Log {
    fn publish(&self, level: LogLevel, message: &str, fields: impl Into<LogFields>) {
        let log = &self.run.log;
        if !log.listened() {
            return;
        }
        log.deliver(EventParts {
            level,
            message: message.to_owned(),
            fields: fields.into().0,
            plugin: self.plugin.as_deref().map(str::to_owned),
            failure: None,
            defect: None,
        });
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
    hooks: Vec<LogHook>,
    destination: Mutex<Arc<LogDestination>>,
    output: Arc<Output>,
    run: OnceLock<String>,
    thrown: Mutex<Thrown>,
}

impl RunLog {
    /// The log of one argv run: its events name the application, read the path routing published
    /// on `output`, and reach the hooks with the run's environment, home, platform, and a stderr
    /// that follows the run's stderr order.
    pub(crate) fn new(
        application: &crate::application::declaration::ApplicationDeclaration,
        host: &Host,
        output: &Arc<Output>,
    ) -> Self {
        Self {
            application: LogApplication {
                name: application.name.clone(),
                version: application
                    .version
                    .clone()
                    .unwrap_or_else(|| "0.0.0".to_owned()),
            },
            hooks: application.log_hooks.clone(),
            destination: Mutex::new(Arc::new(LogDestination {
                env: host.env.clone(),
                home: host.home.clone(),
                platform: host.platform.clone(),
                stderr: Some(Arc::new(CarriedStderr {
                    output: Arc::clone(output),
                })),
            })),
            output: Arc::clone(output),
            run: OnceLock::new(),
            thrown: Mutex::new(Thrown::None),
        }
    }

    /// The log of a context built outside a run: its events name `application` and reach `hooks`,
    /// the ones the test attached, with no stderr; with no hook, a call creates no event.
    pub(crate) fn unattached(
        application: &str,
        hooks: Vec<LogHook>,
        host: &Host,
        output: &Arc<Output>,
    ) -> Self {
        Self {
            application: LogApplication {
                name: application.to_owned(),
                version: "0.0.0".to_owned(),
            },
            hooks,
            destination: Mutex::new(Arc::new(LogDestination {
                env: host.env.clone(),
                home: host.home.clone(),
                platform: host.platform.clone(),
                stderr: None,
            })),
            output: Arc::clone(output),
            run: OnceLock::new(),
            thrown: Mutex::new(Thrown::None),
        }
    }

    /// The log of an invocation by name: its events name the application and read the path routing
    /// published on `output`, and reach the hooks at `destination`, its action's run's or one with
    /// no stderr, because a call writes to no process stream.
    pub(crate) fn with_destination(
        application: &crate::application::declaration::ApplicationDeclaration,
        output: &Arc<Output>,
        destination: LogDestination,
    ) -> Self {
        Self {
            application: LogApplication {
                name: application.name.clone(),
                version: application
                    .version
                    .clone()
                    .unwrap_or_else(|| "0.0.0".to_owned()),
            },
            hooks: application.log_hooks.clone(),
            destination: Mutex::new(Arc::new(destination)),
            output: Arc::clone(output),
            run: OnceLock::new(),
            thrown: Mutex::new(Thrown::None),
        }
    }

    /// Where the hooks write now, which an action's call hands its own hooks.
    pub(crate) fn destination(&self) -> LogDestination {
        LogDestination::clone(&locked(&self.destination))
    }

    /// Hands every later event's hooks `env`: the environment with every environment hook's
    /// additions merged, which the run's reports read too.
    pub(crate) fn set_env(&self, env: Env) {
        let mut destination = locked(&self.destination);
        let mut updated = LogDestination::clone(&destination);
        updated.env = env;
        *destination = Arc::new(updated);
    }

    /// Whether any hook observes the run's events.
    fn listened(&self) -> bool {
        !self.hooks.is_empty()
    }

    /// Logs one failure the run reports: `fatal` with the defect the run caught for a declaration
    /// fault or a defect, `error` for every other failure.
    pub(crate) fn failure(&self, failure: &dyn Failure, form: FailureForm) {
        if !self.listened() {
            return;
        }
        let author = is_author_fault(failure);
        self.deliver(EventParts {
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
        });
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

    /// Hands one event to every hook, in installation order, before returning.
    fn deliver(&self, parts: EventParts) {
        let event = LogEvent {
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
        };
        let destination = Arc::clone(&locked(&self.destination));
        for hook in &self.hooks {
            if let Err(error) = hook(&event, &destination) {
                let mut thrown = locked(&self.thrown);
                if matches!(*thrown, Thrown::None) {
                    *thrown = Thrown::Held(error);
                }
            }
        }
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
