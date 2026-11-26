//! The middleware chain of one run and its dispatch boundary.
//!
//! This is the reference's `chain.ts`. Activation is read after the input-source stage: a plugin's
//! middleware joins the chain when its activation is `Always`, or when a tier above the declared
//! default supplied any option it lists. The activated middleware run in installation order, each
//! receiving the rest of the chain as a [`Next`]. The dispatch boundary is the point the chain
//! reaches when its last middleware continues: there core raises a held fault, or else resolves the
//! view a middleware selected, builds the providers the routed Command opted in to, and dispatches
//! the action. A middleware that returns without continuing has taken over, so the held fault is
//! never raised and nothing later runs.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context as TaskContext, Poll};

use crate::__private::{ActionCall, RawValue, RunState};
use crate::application::declaration::ApplicationDeclaration;
use crate::commands::declaration::{DeclaredResult, ErasedAction};
use crate::diagnostics::{DiagnosticParts, rules};
use crate::failures::{Error, InternalError, ResultError, ResultFault};
use crate::inputs::{InputIdentity, InputKind, InputValues, NoInputs};
use crate::inspection::{CommandGraph, CommandNode};
use crate::output::emit::{Channel, ResultBinding, is_echo};
use crate::output::{Out, RegionCloser};
use crate::plugins::middleware::{
    ChainCall, ChainOutcome, Next, OwnOptions, Request, Spellings, ViewSelection, locked,
};
use crate::plugins::plugin::{MiddlewareHandler, plugin_sentence};
use crate::plugins::provided::{BuildOutcome, OpenerScope, PersistentValues, RunValues};
use crate::plugins::provider::ProvidedValues;
use crate::plugins::{Activation, AnyProvider};
use crate::signals::RunSignal;
use crate::support::BoxFuture;

use super::parse::OptionValues;
use super::prepare::{Boundary, ChainFacts, Prepared, Ready};
use super::{Context, InvokedBy};

/// One activated plugin in the chain: its handler, and what its middleware reads of its own.
struct Entry {
    identity: Arc<str>,
    handler: MiddlewareHandler,
    spellings: Spellings,
    own: OwnOptions,
}

/// The rest of a chain one `next` continued, running on its own task.
type Downstream = tokio::task::JoinHandle<Result<ChainOutcome, Error>>;

/// What one entry's `next` has done, which decides whether a call is still live and how the entry
/// reports to its caller.
pub(crate) struct Turn {
    identity: Arc<str>,
    returned: AtomicBool,
    called: AtomicBool,
    outcome: Mutex<Option<ChainOutcome>>,
    /// The rest of the chain when the `Next` future that continued it ended before it received
    /// what the rest settled with, so no caller observed it.
    unreceived: Mutex<Option<Downstream>>,
    settled: AtomicBool,
    settling: tokio::sync::Notify,
}

impl Turn {
    fn new(identity: Arc<str>) -> Self {
        Self {
            identity,
            returned: AtomicBool::new(false),
            called: AtomicBool::new(false),
            outcome: Mutex::new(None),
            unreceived: Mutex::new(None),
            settled: AtomicBool::new(false),
            settling: tokio::sync::Notify::new(),
        }
    }

    /// The `Next` future that continued this turn has ended, with or without what the rest of the
    /// chain settled with.
    fn settle(&self) {
        self.settled.store(true, Ordering::SeqCst);
        self.settling.notify_one();
    }

    /// Waits until the `Next` future that continued this turn has ended, so a `next` a spawned task
    /// runs holds the chain open as an awaited one does.
    async fn wait(&self) {
        if self.called.load(Ordering::SeqCst) && !self.settled.load(Ordering::SeqCst) {
            self.settling.notified().await;
        }
    }

    /// What the rest of the chain settled with when no caller received it, once it has settled.
    /// Dropping a `Next` future never cancels the rest of the chain, so its action, its regions,
    /// and its providers' closes all finish before the entry reports.
    async fn unreceived(&self) -> Option<Result<ChainOutcome, Error>> {
        let downstream = locked(&self.unreceived).take()?;
        Some(joined(downstream.await))
    }
}

/// Holds the rest of the chain while a `Next` future awaits it. When that future ends before it
/// received the result, such as under a timeout, the rest keeps running and its turn keeps it.
struct Receiving {
    turn: Arc<Turn>,
    downstream: Option<Downstream>,
}

impl Future for Receiving {
    type Output = Result<ChainOutcome, Error>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<Self::Output> {
        // Fused: once received, the result is the caller's and is never received again.
        let Some(downstream) = self.downstream.as_mut() else {
            return Poll::Pending;
        };
        let settled = std::task::ready!(Pin::new(downstream).poll(cx));
        self.downstream = None;
        Poll::Ready(joined(settled))
    }
}

impl Drop for Receiving {
    fn drop(&mut self) {
        if let Some(downstream) = self.downstream.take() {
            *locked(&self.turn.unreceived) = Some(downstream);
        }
        self.turn.settle();
    }
}

/// What a task that ran the rest of the chain settled with. Core never aborts that task, so its
/// only other end is a panic, which continues in the caller.
fn joined(
    joined: Result<Result<ChainOutcome, Error>, tokio::task::JoinError>,
) -> Result<ChainOutcome, Error> {
    joined.unwrap_or_else(|error| std::panic::resume_unwind(error.into_panic()))
}

/// The action the boundary dispatches, with everything its context reads.
pub(crate) struct Dispatch {
    pub(crate) action: Option<ErasedAction>,
    pub(crate) path: Vec<String>,
    pub(crate) node: Arc<CommandNode>,
    pub(crate) ready: Ready,
    pub(crate) passthrough: Vec<String>,
    pub(crate) uses: Vec<AnyProvider>,
    pub(crate) typed_stdin: bool,
    pub(crate) result: Option<DeclaredResult>,
}

/// What the boundary does once the chain reaches it.
enum Reaching {
    Held(Error),
    Dispatch(Box<Dispatch>),
}

/// The state one chain shares: its entries, what every context reads, and what the boundary does.
pub(crate) struct Chain {
    entries: Vec<Entry>,
    options: Option<InputValues>,
    globals: InputValues,
    request: Option<Request>,
    graph: Arc<CommandGraph>,
    command: Arc<CommandNode>,
    state: Arc<RunState>,
    signal: RunSignal,
    selection: Arc<Mutex<ViewSelection>>,
    boundary: Mutex<Option<Reaching>>,
    invoked: AtomicBool,
    /// A failure core reports after the chain settles: an opener's error after the run was
    /// cancelled, which no caller observes.
    handed: Mutex<Option<Error>>,
    invoked_by: InvokedBy,
    substitutes: Arc<[AnyProvider]>,
}

/// What a run hands its chain beside the prepared dispatch.
pub(crate) struct ChainRun<'a> {
    pub(crate) application: &'a ApplicationDeclaration,
    pub(crate) graph: &'a Arc<CommandGraph>,
    pub(crate) state: Arc<RunState>,
    pub(crate) signal: RunSignal,
    pub(crate) selection: Arc<Mutex<ViewSelection>>,
    pub(crate) substitutes: Arc<[AnyProvider]>,
    pub(crate) invoked_by: InvokedBy,
    /// The routed node, the graph's own.
    pub(crate) command: Arc<CommandNode>,
    /// The routed path.
    pub(crate) path: Vec<String>,
}

/// Runs the chain of one invocation: each activated middleware in installation order, then the
/// dispatch boundary. Resolves with the failure the outermost middleware, or the boundary when no
/// middleware wraps it, settled with, else with a failure core holds for after the chain.
pub(crate) async fn run_chain(run: ChainRun<'_>, prepared: Prepared) -> Result<(), Error> {
    let Prepared {
        boundary, chain, ..
    } = prepared;
    let entries = activated(run.application, &chain, &run.path);
    let options = chain.options.clone();
    let globals = options
        .clone()
        .unwrap_or_else(|| absent_globals(run.application));
    let reaching = match boundary {
        Boundary::Held(fault) => Reaching::Held(fault),
        Boundary::Ready(dispatch) => Reaching::Dispatch(dispatch),
    };
    let shared = Arc::new(Chain {
        entries,
        options,
        globals,
        request: chain.request,
        graph: Arc::clone(run.graph),
        command: run.command,
        state: run.state,
        signal: run.signal,
        selection: run.selection,
        boundary: Mutex::new(Some(reaching)),
        invoked: AtomicBool::new(false),
        handed: Mutex::new(None),
        invoked_by: run.invoked_by,
        substitutes: run.substitutes,
    });
    let settled = if shared.entries.is_empty() {
        if shared.cancelled() {
            Ok(ChainOutcome::Cancelled)
        } else {
            shared.terminal().await
        }
    } else {
        shared.step(0).await
    };
    let handed = locked(&shared.handed).take();
    match (settled, handed) {
        (Err(error), _) => Err(error),
        (Ok(_), Some(error)) => Err(error),
        (Ok(_), None) => Ok(()),
    }
}

/// Every global option of the Application, absent: what by-name reads give while a global fault
/// is held.
fn absent_globals(application: &ApplicationDeclaration) -> InputValues {
    application
        .globals
        .iter()
        .fold(InputValues::new(), |table, option| {
            table.with_raw_option(&option.name, RawValue::Absent)
        })
}

/// Whether one plugin's declared activation matched: `Always`, or an option it lists that a tier
/// above the declared default supplied, whatever value it holds.
fn activates(activation: &Activation, globals: &OptionValues) -> bool {
    match activation {
        Activation::Always => true,
        Activation::Options(names) => names.iter().any(|name| globals.is_supplied(name)),
    }
}

/// The chain's entries: each installed plugin whose activation matched, in installation order,
/// with the spellings of its own options and its own validated values.
fn activated(
    application: &ApplicationDeclaration,
    chain: &ChainFacts,
    path: &[String],
) -> Vec<Entry> {
    let attached = application
        .root
        .at(path)
        .map(|declaration| declaration.attached_by.clone())
        .unwrap_or_default();
    application
        .plugins
        .iter()
        .filter_map(|plugin| {
            let middleware = plugin.middleware.as_ref()?;
            if !activates(&middleware.activation, &chain.globals) {
                return None;
            }
            let names: Vec<&str> = plugin
                .options
                .iter()
                .map(|option| option.name.as_str())
                .collect();
            let spellings = names
                .iter()
                .filter_map(|name| {
                    chain
                        .globals
                        .spellings
                        .iter()
                        .find(|(known, _)| known == name)
                        .map(|(name, spelling)| (name.clone(), spelling.clone()))
                })
                .collect();
            let hooked = attached
                .iter()
                .filter(|input| input.identity == plugin.identity && !input.argument)
                .map(|input| input.name.as_str());
            let mut validated = Vec::new();
            let values = names
                .iter()
                .map(|name| (true, *name))
                .chain(hooked.map(|name| (false, name)))
                .fold(InputValues::new(), |table, (global, name)| {
                    let value = chain.own.value(global, name);
                    if value.is_some() {
                        validated.push(name.to_owned());
                    }
                    table.with_raw_option(name, value.unwrap_or(RawValue::Absent))
                });
            Some(Entry {
                identity: Arc::from(plugin.identity.as_str()),
                handler: Arc::clone(&middleware.handler),
                spellings: Spellings(spellings),
                own: OwnOptions { values, validated },
            })
        })
        .collect()
}

/// The validated values a run's passes settled, which a plugin's own record reads, and the options
/// whose occurrence faulted, which it reads as absent.
#[derive(Default)]
pub(crate) struct OwnValues {
    pub(crate) values: Vec<(InputIdentity, RawValue)>,
    pub(crate) faulted: Vec<String>,
}

impl OwnValues {
    /// The value of one option of the plugin's own that a pass validated, `RawValue::Absent` when
    /// it validated as omitted with no default; `None` when no pass validated it or one of its
    /// occurrences faulted.
    fn value(&self, global: bool, name: &str) -> Option<RawValue> {
        if self.faulted.iter().any(|known| known == name) {
            return None;
        }
        let identity = InputIdentity::new(global, InputKind::Option, name);
        self.values
            .iter()
            .find(|(known, _)| *known == identity)
            .map(|(_, value)| value.clone())
    }
}

impl Chain {
    fn cancelled(&self) -> bool {
        self.signal.is_cancelled()
    }

    /// The outcome one entry reports to its caller: a takeover on a cancelled run reports as
    /// cancelled, the order the exit codes follow.
    fn reported(&self, outcome: ChainOutcome) -> ChainOutcome {
        if outcome == ChainOutcome::TakenOver && self.cancelled() {
            ChainOutcome::Cancelled
        } else {
            outcome
        }
    }

    /// The rest of the chain from entry `index`: that entry's turn, or the boundary past the last.
    /// Core starts nothing new after cancellation.
    fn step(self: &Arc<Self>, index: usize) -> BoxFuture<'static, Result<ChainOutcome, Error>> {
        let chain = Arc::clone(self);
        Box::pin(async move {
            if chain.cancelled() {
                return Ok(ChainOutcome::Cancelled);
            }
            if index < chain.entries.len() {
                chain.run_entry(index).await
            } else {
                chain.terminal().await
            }
        })
    }

    /// The context one entry's middleware receives.
    fn call(&self, entry: &Entry) -> ChainCall {
        ChainCall {
            options: self.options.clone(),
            globals: self.globals.clone(),
            own_options: entry.own.clone(),
            spellings: entry.spellings.clone(),
            graph: Arc::clone(&self.graph),
            command: Arc::clone(&self.command),
            request: self.request.clone(),
            invoked_by: self.invoked_by,
            host: Arc::clone(&self.state.host),
            out: Out {
                run: Arc::clone(&self.state),
                channel: Arc::new(Channel::plain()),
                _result: std::marker::PhantomData,
            },
            signal: self.signal.clone(),
            log: self.state.log.bind(Some(Arc::clone(&entry.identity))),
            run: Arc::clone(&self.state),
            selection: Arc::clone(&self.selection),
            identity: Arc::clone(&entry.identity),
        }
    }

    /// One entry's turn. The middleware's own outcome is final: its `Err`, before its `next` settled
    /// or while unwinding after it, is the entry's failure, and a middleware that handled the
    /// failure of its `next` and returned reports what the chain reached. A `next` whose result no
    /// caller received has no handler, so what the rest of the chain settled with is the entry's.
    async fn run_entry(self: Arc<Self>, index: usize) -> Result<ChainOutcome, Error> {
        let entry = &self.entries[index];
        let turn = Arc::new(Turn::new(Arc::clone(&entry.identity)));
        let next = Next {
            rest: crate::plugins::middleware::Rest::Chain {
                chain: Arc::clone(&self),
                index,
                turn: Arc::clone(&turn),
            },
        };
        let settled = (entry.handler)(self.call(entry), next).await;
        turn.returned.store(true, Ordering::SeqCst);
        // A continued chain a spawned task still awaits holds this entry open until it settles,
        // and one no caller awaits any more is awaited here.
        turn.wait().await;
        let unreceived = turn.unreceived().await;
        settled?;
        if !turn.called.load(Ordering::SeqCst) {
            return Ok(self.reported(ChainOutcome::TakenOver));
        }
        if let Some(reached) = unreceived {
            return reached.map(|outcome| self.reported(outcome));
        }
        let reached = *locked(&turn.outcome);
        let outcome = reached.unwrap_or_else(|| {
            if self.invoked.load(Ordering::SeqCst) {
                ChainOutcome::Dispatched
            } else {
                ChainOutcome::TakenOver
            }
        });
        Ok(self.reported(outcome))
    }

    /// The dispatch boundary. The held fault is raised here, so it ranks ahead of a bad view
    /// selection; otherwise the selected view is resolved and the action dispatched.
    async fn terminal(&self) -> Result<ChainOutcome, Error> {
        let reaching = {
            locked(&self.selection).reach();
            locked(&self.boundary).take()
        };
        match reaching {
            Some(Reaching::Held(fault)) => Err(fault),
            Some(Reaching::Dispatch(dispatch)) => {
                let (view, transform) = {
                    let selection = locked(&self.selection);
                    (
                        selection.resolve(&dispatch.path)?,
                        selection.transform.clone(),
                    )
                };
                self.invoked.store(true, Ordering::SeqCst);
                self.dispatch(*dispatch, view, transform).await
            }
            // Each `Next` is consumed by its run and only the last entry's reaches the boundary,
            // so the boundary is reached once.
            None => Ok(ChainOutcome::Dispatched),
        }
    }

    /// Builds the routed Command's opt-ins, then dispatches its action. A build that fails on a
    /// live run closes what it built and fails; a cancelled one closes what it built and never
    /// dispatches. Once the action settles, its open regions close, then its provided values; a
    /// close that fails on a run that had otherwise succeeded is the run's failure.
    async fn dispatch(
        &self,
        dispatch: Dispatch,
        view: Option<String>,
        transform: Option<(Arc<str>, crate::ResultTransform)>,
    ) -> Result<ChainOutcome, Error> {
        let Dispatch {
            action,
            path,
            node,
            ready,
            passthrough,
            uses,
            typed_stdin,
            result,
        } = dispatch;
        let run = &self.state;
        let scope = OpenerScope {
            options: ready.values.globals.clone(),
            host: Arc::clone(&run.host),
            graph: Arc::clone(&self.graph),
            signal: self.signal.clone(),
            invoked_by: self.invoked_by,
            run: Arc::clone(run),
        };
        // Every call nested in the outermost run shares its persistent values, which the outermost
        // run's boundary opens with its opener scope and closes.
        let inherited = run
            .calls
            .as_ref()
            .and_then(|calls| locked(&calls.persistent).clone());
        let (persistent, outermost) = match inherited {
            Some(persistent) => (persistent, false),
            None => {
                let persistent = Arc::new(PersistentValues::new(scope.clone()));
                if let Some(calls) = &run.calls {
                    *locked(&calls.persistent) = Some(Arc::clone(&persistent));
                }
                (persistent, true)
            }
        };
        let values = RunValues::new(scope, persistent, outermost, Arc::clone(&self.substitutes));
        let built = match values.build(&uses).await {
            Ok(BuildOutcome::Built(built)) => built,
            Ok(BuildOutcome::Cancelled(rejected)) => {
                let _ = values.close(false).await;
                // An opener's error that echoes the cancellation is silent; any other is reported
                // once the chain settles, under the signal's code.
                if let Some(error) = rejected.filter(|error| !is_echo(error)) {
                    *locked(&self.handed) = Some(error);
                }
                return Ok(ChainOutcome::Cancelled);
            }
            Err(error) => {
                let _ = values.close(false).await;
                return Err(error);
            }
        };
        let Some(action) = action else {
            // A preparation holds a group's missing subcommand, so a Command here has an action.
            let _ = values.close(false).await;
            return Ok(ChainOutcome::Dispatched);
        };
        let binding = result.map(|declared| ResultBinding {
            declared,
            path: path.clone(),
            selected: view,
            transform,
        });
        let channel = Arc::new(Channel::action(binding));
        let context = Context {
            inputs: NoInputs,
            passthrough,
            supplied: ready.supplied,
            interactive: ready.interactive,
            graph: Arc::clone(&self.graph),
            command: node,
            out: Out {
                run: Arc::clone(run),
                channel: Arc::clone(&channel),
                _result: std::marker::PhantomData,
            },
            host: Arc::clone(&run.host),
            signal: self.signal.clone(),
            style: crate::style::style(),
            log: run.log.bind(None),
            // A derived `#[stdin]` field reads the standalone stdin instead.
            stdin: if typed_stdin { None } else { ready.stdin },
            run: Arc::clone(run),
            provided: Arc::new(ProvidedValues::of(&uses, &built, "The action".to_owned())),
            values: Arc::new(ready.values.clone()),
        };
        let settled = action(ActionCall {
            context,
            values: ready.values.locals,
        })
        .await;
        // The regions the action left open close as it settles, before its provided values.
        let closer = if settled.is_ok() {
            RegionCloser::Completion
        } else {
            RegionCloser::Failure
        };
        run.output.close_channel(&channel, closer).await;
        // A declared result is a promise the Command makes, so an action that returned without
        // emitting it broke it, unless the run was cancelled.
        let settled = settled.and_then(|()| {
            if channel.result.is_some() && !channel.emitted() && !self.cancelled() {
                Err(ResultError::new(ResultFault::Missing, path).into())
            } else {
                Ok(())
            }
        });
        if let Err(error) = settled {
            let _ = values.close(false).await;
            return Err(error);
        }
        if let Some(error) = values.close(!self.cancelled()).await {
            return Err(error);
        }
        Ok(ChainOutcome::Dispatched)
    }
}

/// Continues the chain past the entry whose `next` this is. A `next` first polled after its
/// middleware's own future settled continues nothing and fails with `next-misuse`.
///
/// The rest of the chain runs on its own task, as the reference's downstream promise runs whether
/// or not its caller still awaits it: a `Next` future dropped mid-flight leaves the action running
/// to its end and its provided values closing, and its entry reports what the rest settled with.
pub(crate) async fn continue_chain(
    chain: Arc<Chain>,
    index: usize,
    turn: Arc<Turn>,
) -> Result<ChainOutcome, Error> {
    if turn.returned.load(Ordering::SeqCst) {
        return Err(misuse(&turn.identity));
    }
    turn.called.store(true, Ordering::SeqCst);
    let rest = chain.step(index + 1);
    let recording = Arc::clone(&turn);
    Receiving {
        turn,
        downstream: Some(tokio::spawn(async move {
            let reached = rest.await;
            if let Ok(outcome) = &reached {
                *locked(&recording.outcome) = Some(*outcome);
            }
            reached
        })),
    }
    .await
}

/// The defect of a `next` run after its middleware returned.
fn misuse(identity: &str) -> Error {
    InternalError::without_cause(
        rules::NEXT_MISUSE,
        DiagnosticParts::new(format!(
            "{} called next() after its middleware returned.",
            plugin_sentence(identity)
        ))
        .correction("Call next() once, and await it before the middleware returns."),
    )
    .into()
}
