//! One run from argv to the action: the action context and invocation by name.

use std::sync::Arc;

use tokio_util::sync::CancellationToken;

pub(crate) mod chain;
pub(crate) mod lower;
mod messages;
pub(crate) mod parse;
pub(crate) mod prepare;
pub(crate) mod run;
#[cfg(test)]
mod tests;

use crate::failures::{Error, Failure, FailureExitCode, FailureForm};
use crate::host::Host;
use crate::inputs::{Content, FromInputValue, Inputs, NoInputs, SuppliedInputs};
use crate::inspection::{CommandGraph, CommandNode};
use crate::output::{Log, NoResult, Out, ProgressEvent};
use crate::plugins::{Lifetime, Provider};
use crate::signals::{Registration, RunSignal, ShutdownEvent};
use crate::style::ContextualStyle;

/// What an action, a middleware, a hook that runs async, or an opener returns.
pub type Outcome = Result<(), Error>;

/// What a hook that may fail and has nothing to return gives back: `()`, or a `Result<(), E>` whose
/// `Err` converts into an [`Error`].
pub trait IntoOutcome {
    /// The outcome.
    fn into_outcome(self) -> Outcome;
}

impl IntoOutcome for () {
    fn into_outcome(self) -> Outcome {
        Ok(())
    }
}

impl<E: Into<Error>> IntoOutcome for Result<(), E> {
    fn into_outcome(self) -> Outcome {
        self.map_err(Into::into)
    }
}

/// How a run received its inputs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InvokedBy {
    /// From argv, typed by an operator.
    Argv,
    /// By name, through `invoke`.
    Name,
}

/// What an action receives. `I` is its inputs struct, `R` the result its Command declares.
#[non_exhaustive]
pub struct Context<I = NoInputs, R = NoResult> {
    /// The routed Command's arguments and local options, typed.
    pub inputs: I,
    /// The words after `--`.
    pub passthrough: Vec<String>,
    /// What the invocation supplied, before validation, by declared name.
    pub supplied: SuppliedInputs,
    /// Whether the run may ask the operator.
    pub interactive: bool,
    /// The built graph.
    pub graph: Arc<CommandGraph>,
    /// The routed node.
    pub command: Arc<CommandNode>,
    /// The output handle, typed by the declared result.
    pub out: Out<R>,
    /// The host: one `Arc` per run, shared with the run's source, providers, and middleware.
    pub host: Arc<Host>,
    /// The run signal.
    pub signal: RunSignal,
    /// The style.
    pub style: ContextualStyle,
    /// The log.
    pub log: Log,
    /// The standalone stdin a dynamic `stdin()` declared, when piped. A derived `#[stdin]` field
    /// is the typed form of the same declaration and reads it instead, so when an inputs struct
    /// claims stdin this is `None`: one stdin, read one way.
    pub stdin: Option<Content>,
    pub(crate) run: Arc<crate::__private::RunState>,
    /// The values of the providers the routed Command opted in to.
    pub(crate) provided: Arc<crate::plugins::provider::ProvidedValues>,
    pub(crate) values: Arc<RunInputs>,
}

/// The validated values a context reads by name: the routed Command's own, and the global options'.
#[derive(Clone)]
pub(crate) struct RunInputs {
    pub(crate) locals: crate::inputs::InputValues,
    pub(crate) globals: crate::inputs::InputValues,
    /// How the run received its inputs, which names an option in a missing-input failure.
    pub(crate) invoked_by: InvokedBy,
}

impl Context {
    /// The context with the routed Command's typed inputs and declared result.
    pub(crate) fn retyped<I, R>(self, inputs: I) -> Context<I, R> {
        Context {
            inputs,
            passthrough: self.passthrough,
            supplied: self.supplied,
            interactive: self.interactive,
            graph: self.graph,
            command: self.command,
            out: Out {
                run: self.out.run,
                channel: self.out.channel,
                _result: std::marker::PhantomData,
            },
            host: self.host,
            signal: self.signal,
            style: self.style,
            log: self.log,
            stdin: self.stdin,
            run: self.run,
            provided: self.provided,
            values: self.values,
        }
    }
}

impl<I, R> Context<I, R> {
    /// Cancels the run with the reason `action`, as an interrupt would: the run resolves 130. A
    /// call on a run already cancelled changes nothing. The action then returns, or returns the
    /// cancellation it awaited, which is silent. Under an invocation by name it cancels only the
    /// call, which resolves cancelled with 130 while its run goes on.
    pub fn cancel(&self) {
        self.signal
            .abort(crate::signals::CancellationSource::Action, None);
    }

    /// Registers a synchronous shutdown handler scoped to this run: it runs once at a shutdown's
    /// end, or at the process's own end, newest first, and goes with the run when the run ends
    /// while no shutdown is under way. One registered after the run ended is never called. A
    /// handler that panics is an `error` log event, `A shutdown handler failed.`, naming no plugin.
    pub fn on_shutdown(
        &self,
        handler: impl FnOnce(ShutdownEvent) + Send + 'static,
    ) -> Registration {
        self.run.on_shutdown(None, handler)
    }

    /// Registers a synchronous handler scoped to this run that runs when Ctrl-Z suspends the
    /// process, newest first, before it stops. It goes when the run ends.
    pub fn on_suspend(&self, handler: impl Fn() + Send + Sync + 'static) -> Registration {
        self.run.on_suspend(None, handler)
    }

    /// Registers a synchronous handler scoped to this run that runs when the process resumes after
    /// a suspend, in registration order. It goes when the run ends.
    pub fn on_resume(&self, handler: impl Fn() + Send + Sync + 'static) -> Registration {
        self.run.on_resume(None, handler)
    }

    /// Runs another Command of this run's graph by name, with this run's host facts and
    /// preparation: no lifecycle hook or environment hook runs again, and each declared default is
    /// the run's validated value. Its output is captured as plain text, and its signal derives from
    /// this run's and the options' own, so a cancellation of the run resolves the call cancelled
    /// with the run's code. Calls may overlap and nest.
    pub async fn invoke<M: Send + 'static>(
        &self,
        path: &[&str],
        values: InvocationValues,
        options: InvokeOptions<M>,
    ) -> InvocationOutcome<M> {
        match &self.run.calls {
            Some(scope) => run::invoke_nested(scope, path, values, options).await,
            // A context built outside a run, as a unit test builds one, has no graph to call into,
            // so the call reads as cancelled by its caller.
            None => InvocationOutcome::Cancelled {
                exit_code: crate::failures::ExitCode::INTERRUPT,
            },
        }
    }

    /// The value of a provider the Command opted in to. A provider it did not opt in to is the
    /// `input-read` fault.
    pub fn provided<V: Send + Sync + 'static, L: Lifetime>(
        &self,
        provider: &Provider<V, L>,
    ) -> Result<Arc<V>, Error> {
        self.provided.read(provider)
    }

    /// The global options, read as a typed struct by declared name.
    ///
    /// A field that names no global option, or a type its declaration does not produce, is the
    /// `input-read` fault.
    pub fn globals<G: Inputs>(&self) -> Result<G, Error> {
        G::extract(&self.values.globals)
    }

    /// Any option of the routed Command's table, local or global, read by name. A name the table
    /// does not hold, or a `T` its declaration does not produce, is the `input-read` fault.
    pub fn option<T: FromInputValue>(&self, name: &str) -> Result<T, Error> {
        if self.values.locals.has_option(name) {
            self.values.locals.option(name)
        } else {
            self.values.globals.option(name)
        }
    }

    /// An argument of the routed Command, read by name, under the rules [`Context::option`]
    /// states.
    pub fn argument<T: FromInputValue>(&self, name: &str) -> Result<T, Error> {
        self.values.locals.argument(name)
    }
}

/// The values of an invocation by name: arguments and options by declared name, and passthrough.
///
/// A value is JSON, the reference's value domain: `"text"`, `5`, `true`, or an array of strings and
/// numbers, so a JSON object an agent sent, such as an MCP tool call's `arguments`, passes through
/// unchanged. Core lowers each value to the tokens argv would give, by the reference's lowering
/// table: a finite number to the token JavaScript's `String(number)` writes, such as `5` or `0.5`;
/// `true` and `false` by the option's polarity; a whole number on a counted option to that many
/// occurrences; an array to one occurrence per element. A value no row covers, such as `null`, an
/// object, a nested array, or an array on a scalar input, is unlowerable: it supplies nothing, so
/// an input source may still fill the input, and it is an `invalid` problem of the run's
/// `InputError` with core's sentence for what the input takes. An absent key is an absent value.
#[derive(Clone, Debug, Default, PartialEq)]
#[must_use]
pub struct InvocationValues {
    pub(crate) args: serde_json::Map<String, serde_json::Value>,
    pub(crate) options: serde_json::Map<String, serde_json::Value>,
    pub(crate) passthrough: Vec<String>,
}

impl InvocationValues {
    /// No values.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets an argument. `value` is any JSON value: `"text"`, `5`, `true`, `vec!["a", "b"]`, or a
    /// `serde_json::Value` as an agent sent it. A later call for one name replaces the value and
    /// keeps its place in the caller's key order.
    pub fn arg(mut self, name: &str, value: impl Into<serde_json::Value>) -> Self {
        self.args.insert(name.to_owned(), value.into());
        self
    }

    /// Sets an option. `value` is any JSON value, lowered as the type documentation states.
    pub fn option(mut self, name: &str, value: impl Into<serde_json::Value>) -> Self {
        self.options.insert(name.to_owned(), value.into());
        self
    }

    /// Sets the passthrough words.
    pub fn passthrough(mut self, words: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.passthrough = words.into_iter().map(Into::into).collect();
        self
    }
}

/// What a failure mapper reads beside the failure.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct InvokeFailure {
    /// The application name.
    pub application: String,
    /// The routed path.
    pub path: Vec<String>,
    /// The resolved exit code.
    pub exit_code: FailureExitCode,
    /// The failure form.
    pub form: FailureForm,
}

/// The caller's failure mapper, over the failure the run decided on, which is always a failure
/// class's error.
type FailureMapper<M> = Arc<dyn Fn(Error, &InvokeFailure) -> M + Send + Sync>;
type ProgressObserver = Arc<dyn Fn(&ProgressEvent) + Send + Sync>;

/// How an invocation by name runs. `M` is what its failure mapper returns; by default the failure
/// itself, as an [`Error`].
#[must_use]
pub struct InvokeOptions<M = Error> {
    pub(crate) view: Option<String>,
    pub(crate) failure: FailureMapper<M>,
    pub(crate) signal: Option<CancellationToken>,
    pub(crate) on_progress: Option<ProgressObserver>,
    pub(crate) exclude: Vec<String>,
    pub(crate) time_zone: Option<String>,
}

impl InvokeOptions<Error> {
    /// Default options: the result's default view, the failure itself, no signal of its own, no
    /// progress observer, no option excluded, and an inherited time zone.
    pub fn new() -> Self {
        Self {
            view: None,
            failure: Arc::new(|failure, _| failure),
            signal: None,
            on_progress: None,
            exclude: Vec::new(),
            time_zone: None,
        }
    }
}

impl Default for InvokeOptions<Error> {
    fn default() -> Self {
        Self::new()
    }
}

impl<M> InvokeOptions<M> {
    /// Selects the view the result renders through: an assignment made before any middleware's,
    /// so a later one wins. A name the routed Command's result does not declare, or a view on a
    /// Command with no result, is the `view-selection` defect named for `invoke()`.
    pub fn view(mut self, name: impl Into<String>) -> Self {
        self.view = Some(name.into());
        self
    }

    /// Maps a failure to the value the outcome carries. The mapper receives the failure after the
    /// translators, never a foreign error, beside the application, the routed path, the exit code,
    /// and the failure form. A cancellation never reaches it. A mapper that panics makes the call
    /// panic.
    pub fn failure<N>(
        self,
        mapper: impl Fn(&dyn Failure, &InvokeFailure) -> N + Send + Sync + 'static,
    ) -> InvokeOptions<N> {
        InvokeOptions {
            view: self.view,
            failure: Arc::new(move |error: Error, context: &InvokeFailure| {
                match error.failure() {
                    Some(failure) => mapper(failure, context),
                    // The run hands over failures alone; a foreign error reads as its defect.
                    None => mapper(&crate::failures::messages::foreign_failure(error), context),
                }
            }),
            signal: self.signal,
            on_progress: self.on_progress,
            exclude: self.exclude,
            time_zone: self.time_zone,
        }
    }

    /// Cancels the call when `signal` is cancelled, with the reason `caller`; an action's call is
    /// cancelled with its run's signal too.
    pub fn signal(mut self, signal: CancellationToken) -> Self {
        self.signal = Some(signal);
        self
    }

    /// Observes the call's progress events, each inside the report or close that built it. An
    /// observer that panics is called no more, and the call panics with its payload once its run
    /// settles.
    pub fn on_progress(
        mut self,
        observer: impl Fn(&ProgressEvent) + Send + Sync + 'static,
    ) -> Self {
        self.on_progress = Some(Arc::new(observer));
        self
    }

    /// Leaves these options, by declared name, out of the call's run: no tier supplies one, a key
    /// of `options` that names one is the unknown option, and it takes its declared default. A
    /// name the routed Command's table does not hold is the unknown option.
    pub fn exclude(mut self, names: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.exclude.extend(names.into_iter().map(Into::into));
        self
    }

    /// Sets the IANA time zone for this call and its descendants. The invocation fails with
    /// [`crate::InputError`] if the name does not resolve.
    pub fn time_zone(mut self, name: impl Into<String>) -> Self {
        self.time_zone = Some(name.into());
        self
    }
}

/// How an invocation by name settled.
#[derive(Debug)]
#[non_exhaustive]
pub enum InvocationOutcome<M = Error> {
    /// The action completed.
    Completed {
        /// What it wrote to stdout, as plain text.
        output: String,
        /// What it wrote to stderr, as plain text.
        messages: String,
    },
    /// The run failed.
    Failed {
        /// The mapped failure.
        failure: M,
        /// Its failure form.
        form: FailureForm,
        /// The resolved exit code.
        exit_code: FailureExitCode,
        /// What it wrote to stdout.
        output: String,
        /// What it wrote to stderr.
        messages: String,
    },
    /// The run was cancelled.
    Cancelled {
        /// The signal's exit code.
        exit_code: crate::failures::ExitCode,
    },
}
