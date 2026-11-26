//! The middleware chain: what a middleware sees, and how it continues or ends a run.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::commands::declaration::DeclaredResult;
use crate::diagnostics::{DiagnosticParts, rules};
use crate::failures::messages::{quoted, routed_subject};
use crate::failures::{Error, InternalError};
use crate::host::Host;
use crate::inputs::{Content, FromInputValue, InputValues};
use crate::inspection::{CommandGraph, CommandNode};
use crate::output::{Log, Out};
use crate::signals::{Registration, RunSignal, ShutdownEvent};

use super::plugin::plugin_sentence;

/// How the rest of the chain settled, as `Next::run` reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChainOutcome {
    /// The action ran.
    Dispatched,
    /// A later middleware returned without continuing.
    TakenOver,
    /// The run was cancelled before the action ran.
    Cancelled,
}

/// The rest of the chain: every later middleware, then the dispatch boundary.
///
/// [`Next::run`] consumes it, so a middleware continues at most once. Dropping it without running it
/// takes the invocation over. Running it after the middleware's own future settled is a defect under
/// `@loomcli/core/next-misuse`.
#[must_use = "run the rest of the chain with `next.run().await`, or drop it to take the invocation over"]
pub struct Next {
    pub(crate) rest: Rest,
}

/// What a `Next` continues: the run's chain after one middleware, or, in a context a test built,
/// the outcome the test stated or the sentence that asks for one.
pub(crate) enum Rest {
    Chain {
        chain: Arc<crate::invocation::chain::Chain>,
        index: usize,
        turn: Arc<crate::invocation::chain::Turn>,
    },
    Stated(Result<ChainOutcome, String>),
}

impl Next {
    /// Continues the invocation. At the dispatch boundary core raises a held fault, or reads the
    /// view selection, builds the opted-in providers, and dispatches the action. Resolves with how
    /// the rest settled, or with the failure it raised.
    ///
    /// The call is live while the middleware's own future runs: a `Next` first polled after that
    /// future settled, such as one a spawned task kept, continues nothing and returns the
    /// `next-misuse` defect.
    ///
    /// The rest of the chain runs on its own task. Dropping this future before it resolves, as a
    /// timeout does, never cancels the action: it runs to its end and its provided values close,
    /// and because no caller received what the rest settled with, the middleware's entry reports
    /// it, a failure included, once the middleware returns.
    pub async fn run(self) -> Result<ChainOutcome, Error> {
        match self.rest {
            Rest::Chain { chain, index, turn } => {
                crate::invocation::chain::continue_chain(chain, index, turn).await
            }
            Rest::Stated(Ok(outcome)) => Ok(outcome),
            Rest::Stated(Err(sentence)) => Err(Error::from_foreign(sentence.into())),
        }
    }

    /// The rest of a chain a test built: it resolves with `outcome`, or fails with the sentence.
    pub(crate) fn stated(outcome: Result<ChainOutcome, String>) -> Self {
        Self {
            rest: Rest::Stated(outcome),
        }
    }
}

/// The routed Command's invocation after parsing and validation: its arguments, local options,
/// passthrough words, and stdin. `None` while core holds a fault and on a group.
#[derive(Clone)]
#[non_exhaustive]
pub struct Request {
    /// The argument and local option values, read by name.
    pub values: InputValues,
    /// The passthrough words.
    pub passthrough: Vec<String>,
    /// The standalone stdin.
    pub stdin: Option<Content>,
}

/// The spellings that supplied the plugin's own options: `--help`, `-h`, `--no-total`.
#[derive(Clone, Debug, Default)]
pub struct Spellings(pub(crate) BTreeMap<String, String>);

impl Spellings {
    /// The spelling that supplied the option `name`, when the invocation supplied it as a token.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.0.get(name).map(String::as_str)
    }

    /// Each option the invocation supplied as a token, with its spelling, in name order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.0
            .iter()
            .map(|(name, spelling)| (name.as_str(), spelling.as_str()))
    }
}

/// The validated values of the plugin's own options, its hook-declared local options included,
/// present whether or not core holds a fault for another input.
#[derive(Clone, Default)]
pub struct OwnOptions {
    pub(crate) values: InputValues,
    /// The options a pass of the run validated, as omitted or with a value.
    pub(crate) validated: Vec<String>,
}

impl OwnOptions {
    /// The option `name`, read as `T`, as every by-name read reads: an option that did not
    /// validate in this run reads as absent, so `T = Option<V>` gives `None`; a name the plugin
    /// does not declare, or a `T` its declaration does not match, is the `input-read` fault.
    pub fn option<T: FromInputValue>(&self, name: &str) -> Result<T, Error> {
        self.values.option(name)
    }

    /// Whether a pass of this run validated the option `name`, so the record holds it: an option
    /// the invocation omitted validates too, and reads its default or `None`. An option whose
    /// validator rejected it, whose occurrence faulted, or that no pass reached is not held.
    #[must_use]
    pub fn validated(&self, name: &str) -> bool {
        self.validated.iter().any(|known| known == name)
    }
}

/// What a middleware receives. `O` is its plugin's options struct.
#[non_exhaustive]
pub struct MiddlewareContext<O> {
    /// Every global option's validated value; `None` when a global option has a structural fault or
    /// a validation problem, or a source failed.
    pub options: Option<O>,
    /// The plugin's own options that validated, under any held fault.
    pub own_options: OwnOptions,
    /// The spellings that supplied the plugin's own options.
    pub spellings: Spellings,
    /// The built graph.
    pub graph: Arc<CommandGraph>,
    /// The routed node.
    pub command: Arc<CommandNode>,
    /// The routed invocation; `None` under a held fault and on a group.
    pub request: Option<Request>,
    /// The host: one `Arc` per run, shared with the run's source, providers, and action.
    pub host: Arc<Host>,
    /// The output handle.
    pub out: Out,
    /// The run signal.
    pub signal: RunSignal,
    /// The log, tagged with this plugin.
    pub log: Log,
    pub(crate) run: Arc<crate::__private::RunState>,
    /// Every global option by name: the validated values, or every one absent when `options` is
    /// `None`.
    pub(crate) globals: InputValues,
    /// The run's one view selection.
    pub(crate) selection: Arc<Mutex<ViewSelection>>,
    /// The plugin whose middleware this is.
    pub(crate) identity: Arc<str>,
}

/// What the chain hands one middleware, before its options are read as the plugin's type.
pub(crate) struct ChainCall {
    pub(crate) options: Option<InputValues>,
    pub(crate) globals: InputValues,
    pub(crate) own_options: OwnOptions,
    pub(crate) spellings: Spellings,
    pub(crate) graph: Arc<CommandGraph>,
    pub(crate) command: Arc<CommandNode>,
    pub(crate) request: Option<Request>,
    pub(crate) host: Arc<Host>,
    pub(crate) out: Out,
    pub(crate) signal: RunSignal,
    pub(crate) log: Log,
    pub(crate) run: Arc<crate::__private::RunState>,
    pub(crate) selection: Arc<Mutex<ViewSelection>>,
    pub(crate) identity: Arc<str>,
}

impl<O: crate::inputs::Inputs> MiddlewareContext<O> {
    /// The context of one call, with the global options read as the plugin's options struct.
    pub(crate) fn of(call: ChainCall) -> Self {
        Self {
            // Every global option validated, the plugin's among them, so its struct reads whole.
            options: call
                .options
                .as_ref()
                .and_then(|values| O::extract(values).ok()),
            own_options: call.own_options,
            spellings: call.spellings,
            graph: call.graph,
            command: call.command,
            request: call.request,
            host: call.host,
            out: call.out,
            signal: call.signal,
            log: call.log,
            run: call.run,
            globals: call.globals,
            selection: call.selection,
            identity: call.identity,
        }
    }
}

impl<O> MiddlewareContext<O> {
    /// The view the result renders through: the declaration's default until a middleware selects
    /// one, and `None` on a Command that declares no result.
    pub fn view(&self) -> Option<String> {
        locked(&self.selection).read()
    }

    /// Selects the view the result renders through. The last selection before the dispatch boundary
    /// wins; a name the result does not hold is a defect there.
    pub fn select_view(&self, name: &str) {
        locked(&self.selection).assign(&self.identity, name);
    }

    /// Any global option's value by name, read as `T`. While `options` is `None`, which it is when
    /// a global option did not validate, every global option reads as absent: read a Boolean as
    /// `Option<bool>` and a count as `Option<u32>`, because a read of an absent value as `bool`,
    /// an integer, or another type that always holds a value is the `input-read` fault.
    pub fn option<T: FromInputValue>(&self, name: &str) -> Result<T, Error> {
        self.globals.option(name)
    }

    /// Registers a synchronous shutdown handler for this run.
    pub fn on_shutdown(
        &self,
        handler: impl FnOnce(ShutdownEvent) + Send + 'static,
    ) -> Registration {
        self.run
            .on_shutdown(Some(Arc::clone(&self.identity)), handler)
    }

    /// Registers a synchronous suspend handler for this run, as the action context's does; its
    /// panic is an `error` log event naming the plugin.
    pub fn on_suspend(&self, handler: impl Fn() + Send + Sync + 'static) -> Registration {
        self.run
            .on_suspend(Some(Arc::clone(&self.identity)), handler)
    }

    /// Registers a synchronous resume handler for this run, as the action context's does; its
    /// panic is an `error` log event naming the plugin.
    pub fn on_resume(&self, handler: impl Fn() + Send + Sync + 'static) -> Registration {
        self.run
            .on_resume(Some(Arc::clone(&self.identity)), handler)
    }
}

pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The run's selection when it failed, which a failure view, an `on_failure` hook, and a failure
/// encoder read: the view the result would render through, and the media type that view declares.
/// Both are absent where no view would render.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct FailureSelection {
    pub(crate) view: Option<String>,
    pub(crate) media_type: Option<String>,
}

/// One assignment of the view a result renders through: the name, who made it as a fault's
/// sentence opens, and the fix that fault states.
struct Assignment {
    name: String,
    subject: String,
    correction: &'static str,
}

/// The view one run selects, one value whichever middleware wrote it. The assignment is kept as it
/// arrived, because only the routed Command's result decides whether it renders, and the check
/// belongs at the dispatch boundary, where its fault ranks behind a held fault.
pub(crate) struct ViewSelection {
    assigned: Option<Assignment>,
    reached: bool,
    result: Option<DeclaredResult>,
}

impl ViewSelection {
    /// The selection of a run routed to a Command with this result.
    pub(crate) fn new(result: Option<DeclaredResult>) -> Self {
        Self {
            assigned: None,
            reached: false,
            result,
        }
    }

    /// The selection of an invocation by name, which starts from the view its caller selected: an
    /// assignment made before any middleware's, so a later one wins.
    pub(crate) fn starting(result: Option<DeclaredResult>, start: Option<String>) -> Self {
        Self {
            assigned: start.map(|name| Assignment {
                name,
                subject: "invoke()".to_owned(),
                correction: rules::INVOKE_VIEW_CORRECTION,
            }),
            reached: false,
            result,
        }
    }

    /// What `view()` reads: the assigned name, or the declaration's default until one is
    /// assigned, and `None` on a Command that declares no result, whatever was assigned there.
    fn read(&self) -> Option<String> {
        let result = self.result.as_ref()?;
        Some(
            self.assigned
                .as_ref()
                .map_or_else(|| result.default.clone(), |assigned| assigned.name.clone()),
        )
    }

    /// The selection a failure reads: the last assignment, else the default, the rule the boundary
    /// applies, read the same before and after dispatch. A name the boundary would reject selects
    /// nothing.
    pub(crate) fn at_failure(&self) -> FailureSelection {
        let Some(result) = &self.result else {
            return FailureSelection::default();
        };
        let name = self
            .assigned
            .as_ref()
            .map_or(&result.default, |assigned| &assigned.name);
        match result.views.iter().find(|entry| &entry.key == name) {
            Some(entry) => FailureSelection {
                view: Some(entry.key.clone()),
                media_type: entry.media_type.clone(),
            },
            None => FailureSelection::default(),
        }
    }

    /// The last assignment before the boundary wins; one made after it changes nothing.
    fn assign(&mut self, identity: &str, name: &str) {
        if !self.reached {
            self.assigned = Some(Assignment {
                name: name.to_owned(),
                subject: plugin_sentence(identity),
                correction: rules::VIEW_SELECTION_CORRECTION,
            });
        }
    }

    /// The chain reached the dispatch boundary, so this run's view is fixed whatever follows.
    pub(crate) fn reach(&mut self) {
        self.reached = true;
    }

    /// The name the boundary dispatches through: `None` when nothing selected one and the
    /// declaration's default stands. A selected name is checked here.
    pub(crate) fn resolve(&self, path: &[String]) -> Result<Option<String>, Error> {
        let Some(assigned) = &self.assigned else {
            return Ok(None);
        };
        let Some(result) = &self.result else {
            return Err(selection_fault(
                format!(
                    "{} selected view {} on {}, which declares no result.",
                    assigned.subject,
                    quoted(&assigned.name),
                    routed_subject(path)
                ),
                assigned.correction,
            ));
        };
        if !result.views.iter().any(|entry| entry.key == assigned.name) {
            return Err(selection_fault(
                format!(
                    "{} selected view {}, which {} does not name.",
                    assigned.subject,
                    quoted(&assigned.name),
                    routed_subject(path)
                ),
                assigned.correction,
            ));
        }
        Ok(Some(assigned.name.clone()))
    }
}

/// The defect a view selection the routed Command cannot render reports.
fn selection_fault(sentence: String, correction: &'static str) -> Error {
    InternalError::without_cause(
        rules::VIEW_SELECTION,
        DiagnosticParts::new(sentence).correction(correction),
    )
    .into()
}
