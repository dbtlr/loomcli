//! One run, step by step in the lifecycle order of the core API design (section 9): host capture,
//! graph build, routing, parsing, the dispatch boundary, the action, the failure path, and the exit
//! code.
//!
//! `run()` and `invoke()` share one run body, the reference's `#execute`. A door decides what
//! differs between them: where the run reads its inputs and host, where it writes, which signals
//! cancel it, whether it builds its own graph or reuses an action's run's, and whether it touches
//! the process. Each step is its own function.

use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock, Weak};

use tokio_util::sync::CancellationToken;

use crate::__private::RunState;
use crate::application::RunOptions;
use crate::application::declaration::ApplicationDeclaration;
use crate::diagnostics::defect::SourceAccess;
use crate::diagnostics::developer::{
    AuthorFault, DeveloperScene, developer_plain_text, developer_text,
};
use crate::diagnostics::{DiagnosticParts, rules};
use crate::failures::form::{FormScene, failure_form};
use crate::failures::messages::{
    core_text, foreign_failure, generic_defect_text, is_author_fault, quoted, reason_of, to_failure,
};
use crate::failures::translators::translated;
use crate::failures::{
    Error, ExitCode, Failure, FailureExitCode, FailureFacts, FailureForm, FailureViewContext,
    InputError, InternalError, WorkingDirectoryError,
};
use crate::host::capture::{HostCapture, OwnStreams, RunStreams, capture_host, capture_parts};
use crate::host::{
    Host, HostTerminal, InputStream, OutputStream, ProcessFields, ProcessHandle, QueryRun,
    ask_terminal, process_handle, resolve_time_zone,
};
use crate::inputs::declared::{DeclaredValues, prepare_declared_values};
use crate::inputs::pass::ReceivedInputs;
use crate::inspection::CommandGraph;
use crate::inspection::build::KeptGraphs;
use crate::marks::{self, Background};
use crate::output::emit::{Channel, Output, ProgressObserver, Stream, is_echo};
use crate::output::registry::ViewRegistry;
use crate::output::{Log, LogDestination, Out, ProgressEvent, RegionCloser, RunLog};
use crate::plugins::AnyProvider;
use crate::plugins::hooks::ReceivedReader;
use crate::plugins::plugin::EnvironmentHook;
use crate::plugins::provided::PersistentValues;
use crate::plugins::{EnvironmentContext, FailureHookContext};
use crate::signals::lane::{Lane, LaneRun, Place, lane_of};
use crate::signals::{CancellationSource, RunSignal};
use crate::style::{
    BackgroundSources, BackgroundStep, Palette, RenderingPolicy, Theme, background_after_query,
    background_before_query, capabilities, effective_columns,
};
use crate::support::BoxFuture;

use super::chain::{ChainRun, run_chain};
use super::lower::{NamedCall, lower_invocation};
use super::parse::parse_invocation;
use super::prepare::{Run, prepare_dispatch};
use super::{InvocationOutcome, InvocationValues, InvokeFailure, InvokeOptions, InvokedBy};
use crate::plugins::middleware::{FailureSelection, ViewSelection, locked};

/// One run's signal and its place in its signal source's lane, taken at the run's entry, before
/// its first await, so a signal from then on reaches it. Dropping it leaves the lane, so a run
/// whose future is dropped holds no listener.
struct Entered {
    signal: RunSignal,
    place: Place,
    /// The run's output once it exists, which the lane flushes at a shutdown's end.
    output: Arc<Mutex<Weak<Output>>>,
}

impl Entered {
    /// Enters `lane` with `signal`: a shutdown cancels the run with its signal as the source, and
    /// a run entering during one starts cancelled.
    fn enter(lane: &Lane, signal: RunSignal, listens: bool, timeout: u32) -> Self {
        let output: Arc<Mutex<Weak<Output>>> = Arc::new(Mutex::new(Weak::new()));
        let cancelled = signal.clone();
        let flushed = Arc::clone(&output);
        let place = lane.enter(LaneRun {
            cancel: Box::new(move |ending| {
                cancelled.abort(CancellationSource::Signal(ending), None);
            }),
            flush: Box::new(move || {
                if let Some(output) = locked(&flushed).upgrade() {
                    output.flush_at_end();
                }
            }),
            listens,
            timeout,
        });
        Self {
            signal,
            place,
            output,
        }
    }

    /// The run's output: the lane flushes it at a shutdown's end, its live regions hold their
    /// suspend and resume handlers on the run's place, and the run's abort closes its regions at
    /// once, so a region's cancelled line is drawn as the shutdown begins.
    fn attach(&self, output: &Arc<Output>) {
        *locked(&self.output) = Arc::downgrade(output);
        output.use_place(self.place.clone());
        let closing = Arc::downgrade(output);
        self.signal.on_abort(move || {
            if let Some(output) = closing.upgrade() {
                output.close_regions(RegionCloser::Cancellation, None);
            }
        });
    }
}

impl Drop for Entered {
    fn drop(&mut self) {
        self.place.leave();
    }
}

/// How one run ended, which `run()` reads the code of and `invoke()` builds its outcome from.
pub(crate) enum RunEnd {
    Cancelled(ExitCode),
    Completed,
    Failed {
        exit_code: FailureExitCode,
        failure: Error,
        form: FailureForm,
        path: Vec<String>,
    },
}

impl RunEnd {
    fn code(&self) -> ExitCode {
        match self {
            RunEnd::Cancelled(code) => *code,
            RunEnd::Completed => ExitCode::SUCCESS,
            RunEnd::Failed { exit_code, .. } => ExitCode::from(*exit_code),
        }
    }
}

/// The values of an invocation by name, read where the call entered.
struct NamedValues {
    path: Vec<String>,
    values: InvocationValues,
    exclude: Vec<String>,
    time_zone: Option<String>,
}

/// What differs between `run()` and `invoke()`.
struct Door {
    invoked_by: InvokedBy,
    capture: HostCapture,
    /// The policy output follows: the declared one, with `run()`'s override merged, or its plain
    /// form for an invocation by name.
    policy: RenderingPolicy,
    progress: Option<ProgressObserver>,
    substitutes: Arc<[AnyProvider]>,
    /// The values an invocation by name lowers in place of argv.
    named: Option<NamedValues>,
    /// The view an invocation by name starts from.
    start_view: Option<String>,
    graph_source: GraphSource,
    /// Where an invocation by name's log events go: its action's run's destination, or one with
    /// no stderr.
    destination: Option<LogDestination>,
}

/// An outer call uses the Application's kept graph. An action's call uses its run's preparation.
enum GraphSource {
    Application(Arc<KeptGraphs>),
    Caller(Arc<CallScope>),
}

impl GraphSource {
    fn caller(&self) -> Option<&CallScope> {
        match self {
            Self::Application(_) => None,
            Self::Caller(scope) => Some(scope),
        }
    }
}

/// What an action's call reuses of its run: the graph and declared values the run built and
/// validated, the run's host, lane, signal, log destination, and persistent values.
pub(crate) struct CallScope {
    application: Arc<ApplicationDeclaration>,
    graph: Arc<CommandGraph>,
    declared: Arc<DeclaredValues>,
    host: Arc<Host>,
    lane: Arc<Lane>,
    listens: bool,
    timeout: u32,
    signal: RunSignal,
    destination: LogDestination,
    /// The persistent values every run nested in the outermost one shares, once its dispatch
    /// boundary opened them.
    pub(crate) persistent: Mutex<Option<Arc<PersistentValues>>>,
    substitutes: Arc<[AnyProvider]>,
}

/// Runs one argv invocation of `application` and resolves its exit code, which it also hands to
/// the process handle. The run takes its place in its handle's lane at the call, before its first
/// await, so a signal raised right after the call reaches it.
pub(crate) fn run(
    application: &Arc<ApplicationDeclaration>,
    graphs: &Arc<KeptGraphs>,
    options: RunOptions,
) -> impl Future<Output = ExitCode> + Send + 'static {
    let handle: Arc<dyn ProcessHandle> = options
        .process
        .clone()
        .unwrap_or_else(|| process_handle(ProcessFields::new()));
    // The caller's signal cancels the run's: a child token, so the first cause still fixes the
    // reason, and a cancellation by the caller reads as `Caller`.
    let token = options
        .signal
        .as_ref()
        .map_or_else(CancellationToken::new, CancellationToken::child_token);
    let entered = Entered::enter(
        &lane_of(&handle.signals()),
        RunSignal::new(token),
        true,
        application.shutdown_timeout,
    );
    let application = Arc::clone(application);
    let graphs = Arc::clone(graphs);
    async move {
        let policy = options
            .rendering
            .as_ref()
            .map_or(application.rendering, |over| {
                application.rendering.merged(over)
            });
        let door = Door {
            invoked_by: InvokedBy::Argv,
            capture: capture_host(&application.name, Arc::clone(&handle)),
            policy,
            progress: options.progress.clone(),
            substitutes: Arc::from(options.substitutes),
            named: None,
            start_view: None,
            graph_source: GraphSource::Application(graphs),
            destination: None,
        };
        let code = execute(&application, door, &entered).await.code();
        // The status is written before the run leaves its lane, whose last leave may end a
        // shutdown under way and re-raise its signal.
        handle.set_exit_code(code);
        drop(entered);
        code
    }
}

/// The code `main` returns when it could not build its runtime: the generic defect message on the
/// real stderr, and 1.
pub(crate) fn unstarted(application: &ApplicationDeclaration, _error: &std::io::Error) -> ExitCode {
    let stderr = process_handle(ProcessFields::new()).stderr();
    let text = generic_defect_text(&application.name);
    let _ = crate::support::poll_once(stderr.write(text.as_bytes()));
    ExitCode::from(FailureExitCode::new(1))
}

/// The `entry-point` fault of `main` called on a thread that already drives a tokio runtime.
pub(crate) fn entry_inside_runtime(application: &str) -> crate::failures::DeclarationError {
    crate::failures::DeclarationError::new(
        rules::ENTRY_POINT,
        DiagnosticParts::new(format!(
            "Application {} called main inside a tokio runtime.",
            crate::failures::messages::quoted(application)
        ))
        .finding(crate::diagnostics::Finding::new("main", vec![]).path(vec![]))
        .correction("Await main_async() from an async main, such as one under #[tokio::main], or call main() from a main that starts no runtime."),
    )
}

/// Runs the Command at `path` of the graph for this build, with named values in place of argv,
/// on a host of capture sinks around the handle's facts. It makes no process effect: it keeps no
/// lane listening and writes no exit code.
pub(crate) async fn invoke<M: Send + 'static>(
    application: &Arc<ApplicationDeclaration>,
    graphs: &Arc<KeptGraphs>,
    path: &[&str],
    values: InvocationValues,
    options: InvokeOptions<M>,
    process: Option<Arc<dyn ProcessHandle>>,
) -> InvocationOutcome<M> {
    let handle = process.unwrap_or_else(|| process_handle(ProcessFields::new()));
    let token = options
        .signal
        .as_ref()
        .map_or_else(CancellationToken::new, CancellationToken::child_token);
    let entered = Entered::enter(
        &lane_of(&handle.signals()),
        RunSignal::new(token),
        false,
        application.shutdown_timeout,
    );
    let sinks = Sinks::new();
    let capture = capture_parts(
        &application.name,
        handle,
        Vec::new(),
        sinks.streams(),
        OwnStreams::default(),
    );
    let capture = HostCapture {
        host: invocation_host(capture.host),
        unreadable_cwd: capture.unreadable_cwd,
    };
    let call = Call {
        application: Arc::clone(application),
        path: path.iter().map(|word| (*word).to_owned()).collect(),
        values,
        options,
        sinks,
        capture,
        graph_source: GraphSource::Application(Arc::clone(graphs)),
    };
    call.run(entered).await
}

/// Runs the Command at `path` of the graph the action's run built, by name, with the run's host
/// facts, signal, lane, and persistent values. Its signal derives from its run's and its own.
pub(crate) async fn invoke_nested<M: Send + 'static>(
    scope: &Arc<CallScope>,
    path: &[&str],
    values: InvocationValues,
    options: InvokeOptions<M>,
) -> InvocationOutcome<M> {
    let signal = RunSignal::nested(&scope.signal, options.signal.clone());
    let entered = Entered::enter(&scope.lane, signal, scope.listens, scope.timeout);
    let sinks = Sinks::new();
    let mut host = Host::clone(&scope.host);
    host.argv = Vec::new();
    host.streams = sinks.streams();
    host.own = OwnStreams::default();
    let capture = HostCapture {
        host: invocation_host(host),
        unreadable_cwd: None,
    };
    let call = Call {
        application: Arc::clone(&scope.application),
        path: path.iter().map(|word| (*word).to_owned()).collect(),
        values,
        options,
        sinks,
        capture,
        graph_source: GraphSource::Caller(Arc::clone(scope)),
    };
    call.run(entered).await
}

/// One invocation by name, read where it entered.
struct Call<M> {
    application: Arc<ApplicationDeclaration>,
    path: Vec<String>,
    values: InvocationValues,
    options: InvokeOptions<M>,
    sinks: Sinks,
    capture: HostCapture,
    graph_source: GraphSource,
}

impl<M: Send + 'static> Call<M> {
    /// The run on capture sinks, and the outcome, whose failure the caller's mapper maps once the
    /// run has ended. A progress observer that panicked makes the call panic with its payload once
    /// the run has settled.
    async fn run(self, entered: Entered) -> InvocationOutcome<M> {
        let Call {
            application,
            path,
            values,
            options,
            sinks,
            capture,
            graph_source,
        } = self;
        let observer = GuardedObserver::new(options.on_progress.clone());
        let bound = graph_source.caller();
        let destination = bound.map_or_else(
            || LogDestination {
                env: capture.host.env.clone(),
                home: capture.host.home.clone(),
                platform: capture.host.platform.clone(),
                stderr: None,
            },
            |scope| scope.destination.clone(),
        );
        let door = Door {
            invoked_by: InvokedBy::Name,
            capture,
            policy: application.rendering.plain(),
            progress: observer.observer(),
            substitutes: bound.map_or_else(
                || Arc::from(Vec::new()),
                |scope| Arc::clone(&scope.substitutes),
            ),
            named: Some(NamedValues {
                path,
                values,
                exclude: options.exclude.clone(),
                time_zone: options.time_zone,
            }),
            start_view: options.view.clone(),
            graph_source,
            destination: Some(destination),
        };
        let end = execute(&application, door, &entered).await;
        drop(entered);
        observer.settle();
        let output = sinks.stdout.text();
        let messages = sinks.stderr.text();
        match end {
            RunEnd::Cancelled(exit_code) => InvocationOutcome::Cancelled { exit_code },
            RunEnd::Completed => InvocationOutcome::Completed { output, messages },
            RunEnd::Failed {
                exit_code,
                failure,
                form,
                path,
            } => {
                let context = InvokeFailure {
                    application: application.name.clone(),
                    path,
                    exit_code,
                    form: form.clone(),
                };
                InvocationOutcome::Failed {
                    failure: (options.failure)(failure, &context),
                    form,
                    exit_code,
                    output,
                    messages,
                }
            }
        }
    }
}

/// A caller's progress observer, guarded so a panic never reaches the run: the observer is called
/// no more, and the call panics with the payload once its run settles.
struct GuardedObserver {
    observer: Option<ProgressObserver>,
    broken: Arc<Mutex<Option<Box<dyn std::any::Any + Send>>>>,
}

impl GuardedObserver {
    fn new(observer: Option<ProgressObserver>) -> Self {
        Self {
            observer,
            broken: Arc::new(Mutex::new(None)),
        }
    }

    /// The observer the run's output calls, or none, which collects nothing.
    fn observer(&self) -> Option<ProgressObserver> {
        let observer = self.observer.clone()?;
        let broken = Arc::clone(&self.broken);
        Some(Arc::new(move |event: &ProgressEvent| {
            if locked(&broken).is_some() {
                return;
            }
            let called = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| observer(event)));
            if let Err(payload) = called {
                *locked(&broken) = Some(payload);
            }
        }))
    }

    /// Panics with what the observer panicked with, once the run has settled.
    fn settle(self) {
        if let Some(payload) = locked(&self.broken).take() {
            std::panic::resume_unwind(payload);
        }
    }
}

/// A stream that keeps every byte written to it, decoded as UTF-8 when the run has ended.
#[derive(Default)]
struct CaptureSink {
    bytes: Mutex<Vec<u8>>,
}

impl OutputStream for CaptureSink {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, std::io::Result<()>> {
        locked(&self.bytes).extend_from_slice(bytes);
        Box::pin(std::future::ready(Ok(())))
    }
}

impl CaptureSink {
    fn text(&self) -> String {
        String::from_utf8_lossy(&locked(&self.bytes)).into_owned()
    }
}

/// An empty stdin: an invocation by name reads no piped input, and its stdin is no terminal's, so
/// a raw-mode reader raises nothing and cancels the call itself.
struct EmptyInput;

impl InputStream for EmptyInput {
    fn read<'a>(&'a self, _buffer: &'a mut [u8]) -> BoxFuture<'a, std::io::Result<usize>> {
        Box::pin(std::future::ready(Ok(0)))
    }
}

/// Every terminal fact of an invocation by name: not a TTY, with no width or height.
struct NoTerminal;

impl crate::host::ProcessTerminal for NoTerminal {
    fn stdin(&self) -> crate::host::InputTerminal {
        crate::host::InputTerminal::new(false)
    }
    fn stdout(&self) -> crate::host::OutputTerminal {
        crate::host::OutputTerminal::new(false, None, None)
    }
    fn stderr(&self) -> crate::host::OutputTerminal {
        crate::host::OutputTerminal::new(false, None, None)
    }
}

/// The capture sinks of one invocation by name.
struct Sinks {
    stdout: Arc<CaptureSink>,
    stderr: Arc<CaptureSink>,
}

impl Sinks {
    fn new() -> Self {
        Self {
            stdout: Arc::new(CaptureSink::default()),
            stderr: Arc::new(CaptureSink::default()),
        }
    }

    fn streams(&self) -> RunStreams {
        RunStreams {
            stdin: Arc::new(EmptyInput),
            stdout: Arc::clone(&self.stdout) as Arc<dyn OutputStream>,
            stderr: Arc::clone(&self.stderr) as Arc<dyn OutputStream>,
        }
    }
}

/// The host an invocation by name runs on: its facts, capture sinks, an empty stdin, no argv, and
/// no terminal, with a background that never settles.
fn invocation_host(mut host: Host) -> Host {
    host.argv = Vec::new();
    host.terminal = HostTerminal::captured(Arc::new(NoTerminal));
    host
}

/// What one run's body hands its failure path: the output, the log, and where the run reached.
struct Body<'a> {
    application: &'a Arc<ApplicationDeclaration>,
    host: &'a Arc<Host>,
    output: &'a Arc<Output>,
    log: &'a Arc<RunLog>,
    signal: &'a RunSignal,
    place: &'a Place,
    invoked_by: InvokedBy,
}

/// The one run body `run()` and `invoke()` share: host capture's outcome, the color choice and the
/// background, the run's output and log, the work from graph build to the unwind, and the failure
/// path.
async fn execute(
    application: &Arc<ApplicationDeclaration>,
    door: Door,
    entered: &Entered,
) -> RunEnd {
    let Door {
        invoked_by,
        capture,
        policy: declared,
        progress,
        substitutes,
        named,
        start_view,
        graph_source,
        destination,
    } = door;
    let signal = &entered.signal;
    let mut host = capture.host;
    let capture_failure = capture
        .unreadable_cwd
        .map(|error| Error::from(WorkingDirectoryError::new(error)))
        .or_else(|| {
            let name = named.as_ref()?.time_zone.as_deref()?;
            match resolve_time_zone(name) {
                Some(zone) => {
                    host.time_zone = Arc::new(OnceLock::from(zone));
                    None
                }
                None => Some(InputError::new(super::messages::INVALID_TIME_ZONE, vec![]).into()),
            }
        });
    let argv = invoked_by == InvokedBy::Argv;
    let plain = argv && capture_failure.is_none() && marks::plain::chosen(application, &host.argv);
    // The installed theme, which the settled background resolves to a palette.
    let theme = application
        .plugins
        .iter()
        .find_map(|plugin| plugin.theme.as_ref());
    let policy = match &capture_failure {
        // A failed capture reads no choice: color is off in an Application that marks one.
        Some(_) if argv => RenderingPolicy::uncaptured(marks::declares_color(application)),
        // An invocation by name renders plain from its entry.
        _ if !argv => declared,
        _ => {
            // Step 2: color settles from argv, before anything prints.
            let policy = declared.chosen(marks::color_choice(application, &host.argv));
            // Step 3: the background settles once, before graph build.
            let adapts = theme.is_some_and(Theme::adapts);
            host.terminal.background =
                settle_background(application, &host, &policy, signal, &entered.place, adapts)
                    .await;
            policy
        }
    };
    let palette = theme.map_or_else(Palette::new, |theme| {
        theme.palette(host.terminal.background)
    });
    let host = Arc::new(host);
    // A build fault reports through the application's own overrides alone; every contributor's
    // join once the graph has built. A host capture failure uses core's default text because the
    // application's overrides have yet to register.
    let overrides: &[_] = if capture_failure.is_some() {
        &[]
    } else {
        &application.overrides
    };
    let output = Arc::new(Output::new(
        Arc::clone(&host),
        signal.clone(),
        policy,
        palette,
        ViewRegistry::new(overrides),
        progress,
        plain,
    ));
    entered.attach(&output);
    let log = Arc::new(match destination {
        Some(destination) => RunLog::with_destination(application, &output, destination),
        None => RunLog::new(application, &host, &output),
    });
    let mut reached = Reached::default();
    let outcome = match capture_failure {
        Some(error) => Err(error),
        None => {
            let body = Body {
                application,
                host: &host,
                output: &output,
                log: &log,
                signal,
                place: &entered.place,
                invoked_by,
            };
            let work = run_body(
                &body,
                named.as_ref(),
                start_view,
                graph_source,
                substitutes,
                &mut reached,
            );
            closing_on_cancellation(&output, signal, work).await
        }
    };
    let report_host = reached.host.clone().unwrap_or(host);
    let scene = Scene {
        application,
        state: Arc::new(RunState {
            host: report_host,
            output: Arc::clone(&output),
            log: Arc::clone(&log),
            place: entered.place.clone(),
            calls: None,
        }),
        invoked_by,
    };
    settle(&scene, signal, &reached, outcome).await
}

/// How far a run got: the graph once its build finished, so the failures it reports run hooks and
/// log events, whether its declared values were validated too, after which a cancelled run
/// resolves its signal's code, the host with the environment's additions, and the run's selection.
/// A failure raised before graph build ends the run with its own code.
#[derive(Default)]
struct Reached {
    graph: Option<Arc<CommandGraph>>,
    declared: bool,
    host: Option<Arc<Host>>,
    /// The routed Command's view selection, once routing reached a Command.
    selection: Option<Arc<Mutex<ViewSelection>>>,
    /// Raw input associated with the validation failure held at the dispatch boundary.
    received: Option<Arc<ReceivedInputs>>,
}

impl Reached {
    /// The run's selection when it failed: the view the routed Command's result would render
    /// through, and the media type that view declares. Both are absent before routing reaches a
    /// Command whose result holds the view.
    fn selection(&self) -> FailureSelection {
        self.selection
            .as_ref()
            .map(|selection| locked(selection).at_failure())
            .unwrap_or_default()
    }
}

/// What the failure path reads beside the outcome: the declaration and the run's state, whose
/// host is the one the report reads, with the environment's additions once they were prepared, and
/// how the run received its inputs.
struct Scene<'a> {
    application: &'a ApplicationDeclaration,
    state: Arc<RunState>,
    invoked_by: InvokedBy,
}

impl Scene<'_> {
    fn output(&self) -> &Arc<Output> {
        &self.state.output
    }

    fn host(&self) -> &Host {
        &self.state.host
    }

    fn name(&self) -> &str {
        &self.application.name
    }

    fn development(&self) -> bool {
        self.host().release.is_development()
    }

    /// Whether a failure the run reports passes through the failure-encoding stage: `run()` alone.
    fn encodes(&self) -> bool {
        self.invoked_by == InvokedBy::Argv
    }
}

/// Runs `work`, closing every open region with `Cancellation` at once when the run's signal is
/// cancelled while it runs, so a timer awaiting a region's signal stops then.
async fn closing_on_cancellation<T>(
    output: &Arc<Output>,
    signal: &RunSignal,
    work: impl Future<Output = T>,
) -> T {
    let mut cancelled = std::pin::pin!(signal.cancelled());
    let mut work = std::pin::pin!(work);
    let mut closed = false;
    std::future::poll_fn(|context| {
        if !closed && cancelled.as_mut().poll(context).is_ready() {
            closed = true;
            signal.fire();
            output.close_regions(RegionCloser::Cancellation, None);
        }
        work.as_mut().poll(context)
    })
    .await
}

/// The run's background, from the first source that answers: the operator's choice, the author's
/// policy, the handle's stated background, and, when the Application reads it, the terminal's own
/// answer to the background query and then `COLORFGBG`. The query restores the raw mode it found
/// through a shutdown handler on the run's place while its read is open.
async fn settle_background(
    application: &ApplicationDeclaration,
    host: &Host,
    policy: &RenderingPolicy,
    signal: &RunSignal,
    place: &Place,
    adapts: bool,
) -> Option<Background> {
    let terminal = &host.terminal;
    let (stdin, stdout, stderr) = (
        terminal.stdin().is_tty,
        terminal.stdout().is_tty,
        terminal.stderr().is_tty,
    );
    let mut sources = BackgroundSources::new(&host.env);
    sources.choice = marks::background_choice(application, &host.argv);
    sources.policy = policy.background_setting();
    sources.stated = terminal.stated_background();
    // An adaptive entry of the installed theme turns detection on too.
    sources.detects = marks::declares_background(application) || adapts;
    sources.terminals = stdin && stdout && stderr;
    sources.colored = capabilities(&host.env, stdout, policy).color
        || capabilities(&host.env, stderr, policy).color;
    match background_before_query(&sources) {
        BackgroundStep::Settled(settled) => settled,
        BackgroundStep::Query => {
            let token = signal.token();
            let cancel = || signal.abort(CancellationSource::Action, None);
            let on_shutdown = |restore: Box<dyn FnOnce() + Send>| -> Box<dyn FnOnce() + Send> {
                let registration = place.on_shutdown(Box::new(move |_| restore()), None);
                Box::new(move || registration.remove())
            };
            let answer = ask_terminal(
                host,
                QueryRun {
                    cancel: &cancel,
                    on_shutdown: &on_shutdown,
                    signal: &token,
                },
            )
            .await;
            background_after_query(answer, &host.env)
        }
    }
}

/// Graph build, verbosity, environment preparation, routing, parsing or lowering, and the dispatch
/// boundary of one run. `reached` records when graph build, and then its declared values, finished.
/// An action's call reuses its run's graph and prepared environment. The declared values are
/// reusable when their validation zone matches the call's.
async fn run_body(
    body: &Body<'_>,
    named: Option<&NamedValues>,
    start_view: Option<String>,
    graph_source: GraphSource,
    substitutes: Arc<[AnyProvider]>,
    reached: &mut Reached,
) -> Result<(), Error> {
    let Body {
        application,
        host,
        output,
        log,
        signal,
        place,
        invoked_by,
    } = *body;
    // Step 5: obtain the graph of the run's build or reuse its caller's graph.
    let graph = match &graph_source {
        GraphSource::Application(graphs) => graphs.get(application, &host.release)?,
        GraphSource::Caller(scope) => Arc::clone(&scope.graph),
    };
    let bound = graph_source.caller();
    output.use_views(ViewRegistry::with_plugins(
        &application.overrides,
        &application.plugins,
    ));
    let link = Arc::clone(&graph.link);
    // Every later step reads the declaration the attach hooks left.
    let application = &link.application;
    let call = named.map(|named| NamedCall {
        path: &named.path,
        args: &named.values.args,
        options: &named.values.options,
        exclude: &named.exclude,
        passthrough: &named.values.passthrough,
    });
    // Step 6: verbosity settles from argv, or from the values a call lowers, against the built
    // graph, before anything writes a lane.
    output.set_verbosity(match &call {
        None => marks::verbosity(application, &link.grammar, &host.argv),
        Some(call) => marks::named_verbosity(application, &link.grammar, call),
    });
    reached.graph = Some(Arc::clone(&graph));
    // Step 7: each environment hook adds variables before any input validates; an action's call
    // reads its run's prepared environment. Only an argv run copies its additions out to the
    // handle: an invocation by name makes no process effect.
    let host = &match bound {
        Some(_) => Arc::clone(host),
        None => {
            let publish = call.is_none();
            prepare_environment(application, host, output, log, signal, place, publish).await?
        }
    };
    reached.host = Some(Arc::clone(host));
    // Step 8: an explicit zone needs a comparison before the call can reuse declared values.
    let inherits_zone = named.is_none_or(|named| named.time_zone.is_none());
    let declared = match bound {
        Some(scope)
            if inherits_zone
                || resolve_time_zone(scope.host.time_zone()).as_deref()
                    == Some(host.time_zone()) =>
        {
            Arc::clone(&scope.declared)
        }
        _ => Arc::new(prepare_declared_values(application, host)?),
    };
    reached.declared = true;
    if signal.is_cancelled() {
        return Ok(());
    }
    // Steps 9 and 10: routing raises an unknown Command at once; parsing holds every other fault.
    // An invocation by name lowers its values into what parsing produces.
    let parsed = match &call {
        None => parse_invocation(&link.grammar, &host.argv).map_err(|failure| {
            output.set_route(failure.path);
            failure.error
        })?,
        Some(call) => lower_invocation(&link.grammar, call)?,
    };
    output.set_route(parsed.path.clone());
    let selection = Arc::new(Mutex::new(ViewSelection::starting(
        application
            .root
            .at(&parsed.path)
            .and_then(crate::commands::declaration::CommandDeclaration::result),
        start_view,
    )));
    reached.selection = Some(Arc::clone(&selection));
    let calls = Arc::new(CallScope {
        application: Arc::clone(application),
        graph: Arc::clone(&graph),
        declared: Arc::clone(&declared),
        host: Arc::clone(host),
        lane: Arc::clone(place.lane()),
        listens: place.listens(),
        timeout: application.shutdown_timeout,
        signal: signal.clone(),
        destination: log.destination(),
        persistent: Mutex::new(bound.and_then(|scope| locked(&scope.persistent).clone())),
        substitutes: Arc::clone(&substitutes),
    });
    let state = Arc::new(RunState {
        host: Arc::clone(host),
        output: Arc::clone(output),
        log: Arc::clone(log),
        place: place.clone(),
        calls: Some(calls),
    });
    let command = Arc::clone(&parsed.command.node);
    let path = parsed.path.clone();
    // Steps 11 to 13: the input sources fill the parsed values, interaction settles, and
    // validation runs, every fault held for the dispatch boundary.
    let cancelled = || signal.is_cancelled();
    let mut prepared = prepare_dispatch(
        &Run {
            application,
            graph: &graph,
            host,
            state: &state,
            declared: &declared,
            invoked_by,
            cancelled: &cancelled,
        },
        parsed,
    )
    .await;
    reached.received = prepared.received.take().map(Arc::new);
    // Steps 14 to 18: activation, the chain in installation order, the dispatch boundary, and the
    // unwind.
    run_chain(
        ChainRun {
            application,
            graph: &graph,
            state,
            signal: signal.clone(),
            selection,
            substitutes,
            invoked_by,
            command,
            path,
        },
        prepared,
    )
    .await?;
    // The chain has unwound, so every region a middleware or a source left open closes.
    output.close_regions(RegionCloser::Completion, None);
    output.flush().await;
    Ok(())
}

/// Environment preparation: each installed plugin's `on_environment` hook, in installation order,
/// with the cancellation checked before each hook and after its answer. Each answer merges as it
/// is: a variable the environment already defines, an empty one included, wins, and the first hook
/// that fills a missing one wins; on an argv run (`publish`), each accepted variable passes to the
/// handle's `publish_env` before the next hook runs, and later failures roll nothing back. Output and the log read the merged
/// environment from each merge on. A hook's failure class keeps its class; any other error is a
/// foreign throw from the hook's code, which no translator is offered.
async fn prepare_environment(
    application: &ApplicationDeclaration,
    host: &Arc<Host>,
    output: &Arc<Output>,
    log: &Arc<RunLog>,
    signal: &RunSignal,
    place: &Place,
    publish: bool,
) -> Result<Arc<Host>, Error> {
    let hooks: Vec<(&str, &EnvironmentHook)> = application
        .plugins
        .iter()
        .filter_map(|plugin| {
            plugin
                .on_environment
                .as_ref()
                .map(|hook| (plugin.identity.as_str(), hook))
        })
        .collect();
    if hooks.is_empty() {
        return Ok(Arc::clone(host));
    }
    let state = Arc::new(RunState {
        host: Arc::clone(host),
        output: Arc::clone(output),
        log: Arc::clone(log),
        place: place.clone(),
        calls: None,
    });
    let mut env = host.env.clone();
    let mut outcome = Ok(());
    for (identity, hook) in hooks {
        if signal.is_cancelled() {
            break;
        }
        let context = EnvironmentContext {
            cwd: host.cwd.clone(),
            env: env.clone(),
            log: Log {
                run: Arc::clone(&state),
                plugin: Some(Arc::from(identity)),
            },
            out: Out {
                run: Arc::clone(&state),
                channel: Arc::new(Channel::plain()),
                _result: std::marker::PhantomData,
            },
        };
        // A hook's error reports whether or not the run was cancelled during it; only a cancelled
        // run's additions are discarded.
        match hook(context).await {
            Err(error) => {
                // The cancellation echo stays itself, so a cancelled run reports nothing for it.
                outcome = Err(if error.failure().is_some() || is_echo(&error) {
                    error
                } else {
                    foreign_failure(error).into()
                });
                break;
            }
            Ok(_) if signal.is_cancelled() => break,
            Ok(additions) => {
                for (name, value) in additions {
                    if let std::collections::btree_map::Entry::Vacant(slot) = env.entry(name) {
                        if publish {
                            host.handle.publish_env(slot.key(), &value);
                        }
                        slot.insert(value);
                    }
                }
                output.set_env(env.clone());
                log.set_env(env.clone());
            }
        }
    }
    let mut prepared = Host::clone(host);
    prepared.env = env;
    let prepared = Arc::new(prepared);
    outcome.map(|()| prepared)
}

/// What one run's build decides about its reports: whether it is a development build, whose
/// author faults show their Developer Diagnostic, each after the run's first report opening with one
/// blank line; whether the generic defect message, written at most once per run, was written; and
/// whether any failure report was.
struct Reports {
    development: bool,
    generic: bool,
    reported: bool,
}

impl Reports {
    /// The generic defect message the first time the run writes it, and nothing after.
    fn generic_once(&mut self, application: &str) -> String {
        if self.generic {
            return String::new();
        }
        self.generic = true;
        generic_defect_text(application)
    }
}

/// The failure path and the exit code. A foreign error leaving the run's work is offered to the
/// translators, the application's first and then each plugin's, unless it is the cancellation echo.
/// Every open region closes with `Failure` before a failure's report, so each last frame is written
/// above it. A failure's report follows the incomplete-result lines the run holds, unless a
/// destination already failed, which leaves the report to the plain fallback path, or the failure
/// is the cancellation echo of a cancelled run, which reports nothing. The first `Err` an `on_log`
/// hook returned is reported once, after every other report, and forces 1. A broken view, encoder,
/// hook, or destination forces 1, and a cancelled run resolves its signal's code over every other.
/// A run cancelled before graph build, with its declared values, finished resolves its failure's
/// own code and reports it. The failure that set the run's code, with its form, is what an
/// invocation by name hands its caller.
async fn settle(
    scene: &Scene<'_>,
    signal: &RunSignal,
    reached: &Reached,
    outcome: Result<(), Error>,
) -> RunEnd {
    let output = scene.output();
    let cancelled = || signal.exit_code().filter(|_| reached.declared);
    let mut code = ExitCode::SUCCESS;
    let mut reports = Reports {
        development: scene.development(),
        generic: false,
        reported: false,
    };
    // The failure that set the run's code, with the form its report built.
    let mut decisive: Option<(Box<dyn Failure>, Option<FailureForm>)> = None;
    // Whether a translator answered the destination's own write error, which the action let
    // propagate: that failure then reports in place of the failed destination's plain report,
    // with its own code. A translator that answers any other error leaves the destination fault.
    let mut answered = false;
    if let Err(error) = outcome {
        let echo = is_echo(&error);
        let silenced = cancelled().is_some() && echo;
        let error = if echo || error.failure().is_some() {
            error
        } else {
            let written = error.is_destination_write();
            let translated = translated(error, scene.application.translations());
            answered = written && translated.failure().is_some();
            translated
        };
        let failure = to_failure(error);
        code = ExitCode::from(failure.exit_code());
        let mut form = None;
        if (answered || output.failed().is_none()) && !silenced {
            let (broken, reported) = report(scene, reached, &*failure, &mut reports).await;
            form = Some(reported);
            if broken {
                code = forced();
            }
        }
        decisive = Some((failure, form));
    }
    // A run no report reached, such as a cancelled one, writes its held lines now, and a line
    // whose view broke is then the run's own failure.
    if let Some(fault) = output.write_incomplete().await
        && decisive.is_none()
    {
        let failure = to_failure(fault);
        code = ExitCode::from(failure.exit_code());
        let mut form = None;
        if output.failed().is_none() {
            let (broken, reported) = report(scene, reached, &*failure, &mut reports).await;
            form = Some(reported);
            if broken {
                code = forced();
            }
        }
        decisive = Some((failure, form));
    }
    if let Some(thrown) = scene.state.log.take_thrown() {
        let failure: Box<dyn Failure> = Box::new(foreign_failure(thrown));
        let (_, reported) = report(scene, reached, &*failure, &mut reports).await;
        // After a primary outcome that succeeded, the hook's failure decides the run.
        if code == ExitCode::SUCCESS {
            decisive = Some((failure, Some(reported)));
        }
        code = forced();
    }
    if !answered && let Some(cause) = output.failed() {
        code = forced();
        let defect = InternalError::new(
            rules::BROKEN_DESTINATION,
            DiagnosticParts::new("Could not write invocation output.").correction(
                "Give run() host streams that accept every write until the run resolves.",
            ),
            cause,
        );
        let text = plain_defect_report(scene, &defect, &mut reports);
        output.report_plainly(&text).await;
        let defect_form = form(scene, &defect, &[]);
        if reached.graph.is_some() {
            scene.state.log.failure(&defect, defect_form.clone());
        }
        // A run whose destination alone failed reports that defect, which is its failure.
        if decisive.is_none() {
            decisive = Some((Box::new(defect), Some(defect_form)));
        }
    }
    // A region nothing closed yet, such as one a run whose stdout broke left open, closes here.
    let closer = if code == ExitCode::SUCCESS {
        RegionCloser::Completion
    } else {
        RegionCloser::Failure
    };
    output.close_regions(closer, None);
    output.flush().await;
    // The signal decides the code whatever happened before, so this reading comes last.
    if let Some(cancelled) = cancelled() {
        return RunEnd::Cancelled(cancelled);
    }
    let Some(exit_code) = FailureExitCode::of(code) else {
        return RunEnd::Completed;
    };
    let (failure, form) = decisive.unwrap_or_else(|| {
        // A forced code with no failure of its own cannot arise: every path that forces one
        // records the failure it reports.
        let defect = InternalError::without_cause(
            rules::BROKEN_DESTINATION,
            DiagnosticParts::new("Could not write invocation output."),
        );
        (Box::new(defect), None)
    });
    // A failure no report reached, such as one whose stderr had failed, ran no hook, so its form
    // holds no hint.
    let form = form.unwrap_or_else(|| self::form(scene, &*failure, &[]));
    RunEnd::Failed {
        exit_code,
        failure: Error::from_boxed_failure(failure),
        form,
        path: output.route(),
    }
}

/// The code a broken view, encoder, hook, or destination forces.
fn forced() -> ExitCode {
    ExitCode::from(crate::failures::FailureExitCode::new(1))
}

/// One failure's form with these hints, which its log event and an encoder read.
fn form(scene: &Scene<'_>, failure: &dyn Failure, hints: &[String]) -> FailureForm {
    failure_form(
        failure,
        &FormScene {
            development: scene.development(),
            hints,
            plain: &|text: &str| scene.output().plain(text),
        },
    )
}

/// Reports one failure and answers whether a view, an encoder, or a hook broke, which forces the
/// run's code to 1. Every open region closes with `Failure` and the report waits until every lend
/// of the terminal has settled. The `on_failure` hooks run first, once graph build has finished, so
/// the diagnostic, the view, or the encoder receives their hints, and the failure logs its event
/// with them. A failure whose selection an installed plugin encodes passes through the encoding
/// stage in place of its view. What a broken hook, view, or encoder leaves the plain fallback path
/// is written last.
async fn report(
    scene: &Scene<'_>,
    reached: &Reached,
    failure: &dyn Failure,
    reports: &mut Reports,
) -> (bool, FailureForm) {
    let output = scene.output();
    output.close_regions(RegionCloser::Failure, None);
    output.wait_for_lends().await;
    let hinted = collect_hints(scene, reached, failure);
    let hints: &[String] = hinted.as_ref().map_or(&[], Vec::as_slice);
    let form = form(scene, failure, hints);
    if reached.graph.is_some() {
        scene.state.log.failure(failure, form.clone());
    }
    let (broken, plain) = match &hinted {
        Ok(hints) => report_own(scene, reached, failure, hints, &form, reports).await,
        Err(_) => report_unhinted(scene, failure, reports).await,
    };
    let plain = match hinted {
        Err(thrown) => format!(
            "{plain}{}",
            broken_contract(scene, &foreign_failure(thrown), reports)
        ),
        Ok(_) => plain,
    };
    if !plain.is_empty() {
        output.report_plainly(&plain).await;
    }
    reports.reported = true;
    (broken, form)
}

/// Every installed plugin's hints for one failure, in installation order, once graph build has
/// finished. Each hook receives the failure and its context alone, so hints accumulate and no hook
/// sees another's. A hook that fails ends the hooks: no later hook runs, and no hook's hints reach
/// the report.
fn collect_hints(
    scene: &Scene<'_>,
    reached: &Reached,
    failure: &dyn Failure,
) -> Result<Vec<String>, Error> {
    let Some(graph) = &reached.graph else {
        return Ok(Vec::new());
    };
    let path = scene.output().route();
    let words: Vec<&str> = path.iter().map(String::as_str).collect();
    let command = graph
        .command(&words)
        .map_or_else(|| Arc::clone(&graph.root), Arc::clone);
    let read_received: Option<ReceivedReader> = reached
        .received
        .as_ref()
        .filter(|received| {
            failure
                .downcast_ref::<InputError>()
                .is_some_and(|input| received.belongs_to(input))
        })
        .map(|received| {
            let received = Arc::clone(received);
            Arc::new(move |problem: &crate::InputProblem| received.get(problem)) as ReceivedReader
        });
    let mut hints = Vec::new();
    for plugin in &scene.application.plugins {
        let Some(hook) = &plugin.on_failure else {
            continue;
        };
        let context = FailureHookContext {
            application: scene.name().to_owned(),
            path: path.clone(),
            invoked_by: scene.invoked_by,
            view: reached.selection().view,
            media_type: reached.selection().media_type,
            style: crate::style::style(),
            graph: Arc::clone(graph),
            command: Arc::clone(&command),
            log: Log {
                run: Arc::clone(&scene.state),
                plugin: Some(Arc::from(plugin.identity.as_str())),
            },
            read_received: read_received.clone(),
        };
        hints.extend(hook(failure, &context)?.0);
    }
    Ok(hints)
}

/// One failure's report when an `on_failure` hook failed, on the plain fallback path a broken view
/// takes: the held incomplete-result lines, then core's own text for the failure without hints. No
/// view, override, or encoder runs.
async fn report_unhinted(
    scene: &Scene<'_>,
    failure: &dyn Failure,
    reports: &mut Reports,
) -> (bool, String) {
    let _ = scene.output().write_incomplete().await;
    let own = match AuthorFault::of(failure) {
        Some(fault) if reports.development => {
            let text = developer_plain(scene, fault);
            let text = if reports.reported {
                format!("\n{text}")
            } else {
                text
            };
            reports.reported = true;
            text
        }
        Some(_) => reports.generic_once(scene.name()),
        None => core_text(failure, scene.name(), &[]),
    };
    (true, own)
}

/// One failure's own report: the encoding stage when an installed plugin encodes the media type
/// the run selected, and the failure's view otherwise, after the held incomplete-result lines.
async fn report_own(
    scene: &Scene<'_>,
    reached: &Reached,
    failure: &dyn Failure,
    hints: &[String],
    form: &FailureForm,
    reports: &mut Reports,
) -> (bool, String) {
    let media_type = reached.selection().media_type.filter(|_| scene.encodes());
    let encoder = media_type.and_then(|media_type| {
        scene.application.plugins.iter().find_map(|plugin| {
            plugin
                .failure_encoders
                .iter()
                .find(|encoding| encoding.media_type == media_type)
                .map(|encoding| (plugin.identity.as_str(), encoding))
        })
    });
    if let Some((identity, encoding)) = encoder {
        return encode_report(scene, failure, hints, (identity, encoding), form, reports).await;
    }
    let _ = scene.output().write_incomplete().await;
    render_failure(scene, reached, failure, hints, reports).await
}

/// The encoding stage, in place of the failure's view: the encoder's text is the only failure text
/// the report writes, as it is, and the held incomplete-result lines are dropped. A development
/// build writes an author fault's Developer Diagnostic with its hints first, and the encoded line
/// after one blank line. A broken encoder leaves the held lines written, core's own text for the
/// failure without hints, and the broken encoder's report to the plain fallback path.
async fn encode_report(
    scene: &Scene<'_>,
    failure: &dyn Failure,
    hints: &[String],
    (identity, encoding): (&str, &crate::failures::FailureEncoding),
    form: &FailureForm,
    reports: &mut Reports,
) -> (bool, String) {
    let output = scene.output();
    let diagnosed = AuthorFault::of(failure).filter(|_| reports.development);
    let answer = encoding.encode(form);
    if answer.is_ok() {
        output.drop_incomplete();
    } else {
        let _ = output.write_incomplete().await;
    }
    if let Some(fault) = diagnosed {
        write_diagnostic(scene, fault, hints, reports).await;
    }
    match answer {
        Ok(text) => {
            let text = if diagnosed.is_some() {
                format!("\n{text}")
            } else {
                text
            };
            output.encoded(&text).await;
            (false, String::new())
        }
        Err(error) => {
            let own = if diagnosed.is_some() {
                String::new()
            } else if is_author_fault(failure) {
                reports.generic_once(scene.name())
            } else {
                core_text(failure, scene.name(), &[])
            };
            let defect = InternalError::new(
                rules::BROKEN_FAILURE_ENCODER,
                DiagnosticParts::new(format!(
                    "Plugin {} failed to encode the failure as {}: {}",
                    quoted(identity),
                    quoted(&encoding.media_type),
                    reason_of(&error)
                ))
                .correction(
                    "Return the encoded failure as a string, and throw nothing from the encoder.",
                ),
                error,
            );
            (
                true,
                format!("{own}{}", broken_contract(scene, &defect, reports)),
            )
        }
    }
}

/// Renders one failure as the run's build decides. A development build writes an author fault's
/// Developer Diagnostic ahead of every override. Every other failure, and every failure in a
/// distributed build, resolves through the registry: the first contributor's override for its
/// class or a class it extends, else core's default text with the hints under it. Core's default
/// text for an author fault is the generic message, written at most once per run. A view that
/// breaks leaves core's default text without hints, and its own report, to the plain fallback path.
async fn render_failure(
    scene: &Scene<'_>,
    reached: &Reached,
    failure: &dyn Failure,
    hints: &[String],
    reports: &mut Reports,
) -> (bool, String) {
    let output = scene.output();
    if let Some(fault) = AuthorFault::of(failure).filter(|_| reports.development) {
        write_diagnostic(scene, fault, hints, reports).await;
        return (false, String::new());
    }
    let context = FailureViewContext {
        view_context: output.context(Stream::Stderr),
        application: scene.name().to_owned(),
        path: output.route(),
        hints: hints.to_vec(),
        invoked_by: scene.invoked_by,
        view: reached.selection().view,
        media_type: reached.selection().media_type,
    };
    // A view reads the failure as its own class, which the registry matched along its chain.
    let rendered = output
        .views()
        .failure_view(failure)
        .and_then(|view| view(failure, &context));
    match rendered {
        None => {
            let text = core_text(failure, scene.name(), hints);
            let repeated =
                is_author_fault(failure) && std::mem::replace(&mut reports.generic, true);
            if !repeated {
                output.report(&text).await;
            }
            (false, String::new())
        }
        Some(Ok(text)) => {
            output.report(&text).await;
            (false, String::new())
        }
        Some(Err(error)) => {
            let own = if is_author_fault(failure) {
                reports.generic_once(scene.name())
            } else {
                core_text(failure, scene.name(), &[])
            };
            let defect = InternalError::new(
                rules::BROKEN_FAILURE_VIEW,
                DiagnosticParts::new(format!(
                    "Rendering the failure failed: {}",
                    reason_of(&error)
                ))
                .correction(rules::VIEW_CORRECTION),
                error,
            );
            (
                true,
                format!("{own}{}", broken_contract(scene, &defect, reports)),
            )
        }
    }
}

/// What one broken contract reports on the plain fallback path: its Developer Diagnostic after one
/// blank line in a development build, and the generic defect message, at most once per run, in a
/// distributed one.
fn broken_contract(scene: &Scene<'_>, defect: &InternalError, reports: &mut Reports) -> String {
    if reports.development {
        format!("\n{}", developer_plain(scene, AuthorFault::Defect(defect)))
    } else {
        reports.generic_once(scene.name())
    }
}

/// What the plain fallback path writes for one defect: its Developer Diagnostic in a development
/// build, opening with one blank line after an earlier report, and the generic defect message, at
/// most once per run, in a distributed one.
fn plain_defect_report(scene: &Scene<'_>, defect: &InternalError, reports: &mut Reports) -> String {
    if !reports.development {
        return reports.generic_once(scene.name());
    }
    let text = developer_plain(scene, AuthorFault::Defect(defect));
    let text = if reports.reported {
        format!("\n{text}")
    } else {
        text
    };
    reports.reported = true;
    text
}

/// Writes an author fault as its Developer Diagnostic with the hints under it, ahead of every
/// override and every encoder; after an earlier report of the run it opens with one blank line.
async fn write_diagnostic(
    scene: &Scene<'_>,
    fault: AuthorFault<'_>,
    hints: &[String],
    reports: &Reports,
) {
    let text = developer(scene, |developer| {
        developer_text(fault, developer, hints, &crate::style::style())
    });
    let text = if reports.reported {
        format!("\n{text}")
    } else {
        text
    };
    scene.output().report(&text).await;
}

/// One author fault's Developer Diagnostic as plain text.
fn developer_plain(scene: &Scene<'_>, fault: AuthorFault<'_>) -> String {
    developer(scene, |developer| developer_plain_text(fault, developer))
}

/// What `write` makes of the developer scene of the run's report host: the application name,
/// stderr's effective columns, and the source the working directory holds.
fn developer<T>(scene: &Scene<'_>, write: impl FnOnce(&DeveloperScene<'_>) -> T) -> T {
    let host = scene.host();
    let terminal = host.terminal.stderr();
    let columns = effective_columns(&host.env, terminal.is_tty, terminal.columns.map(u64::from))
        .and_then(|columns| usize::try_from(columns).ok());
    let read = |path: &str| host.read_source(path);
    let developer = DeveloperScene {
        application: scene.name(),
        columns,
        source: if host.cwd_read {
            SourceAccess {
                roots: vec![host.cwd.clone()],
                read: Some(&read),
            }
        } else {
            SourceAccess::none()
        },
    };
    write(&developer)
}
