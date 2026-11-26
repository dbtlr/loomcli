//! The contexts `loomcli-testing` builds for a unit test: one author function's context, built with
//! no Application and no run. Each writes through core's own output onto the process handle the
//! test gives, logs to the hooks the test attaches, registers handlers that are never called, and
//! never cancels.

use std::sync::{Arc, Mutex};

use tokio_util::sync::CancellationToken;

use crate::__private::RunState;
use crate::commands::declaration::{DeclaredResult, ResultCallKind, ViewEntry};
use crate::host::{Host, ProcessHandle};
use crate::inputs::{Content, InputValues, Inputs, SuppliedInputs};
use crate::inspection::{CommandGraph, CommandNode};
use crate::invocation::{Context, InvokedBy, RunInputs};
use crate::marks::Background;
use crate::output::emit::{Channel, Output, ResultBinding};
use crate::output::registry::ViewRegistry;
use crate::output::{
    Log, NoResult, Out, ResultView, RowView, RowsResult, RunLog, ValueResult, View, ViewContext,
};
pub use crate::plugins::hooks::ReceivedReader;
use crate::plugins::middleware::{OwnOptions, Request, Spellings, ViewSelection};
use crate::plugins::provider::{ErasedValue, ProvidedValues, ProviderKey};
use crate::plugins::{
    ChainOutcome, FailureHookContext, Lifetime, MiddlewareContext, Next, Provider, ProviderContext,
};
use crate::signals::RunSignal;
use crate::style::{Palette, RenderingPolicy};

/// An `on_log` hook a built context's log reaches, the form `Plugin::on_log` installs.
pub type UnitLogHook =
    Arc<dyn Fn(&crate::LogEvent, &crate::LogDestination) -> crate::Outcome + Send + Sync>;

/// The log a built context publishes to: the application its events name, the routed path they
/// read, and the hooks that observe them, in order. With no hook, a call creates no event.
#[derive(Default)]
pub struct UnitLog {
    /// The application name each event's `application.name` holds; its version reads `0.0.0`.
    pub application: String,
    /// The routed path each event's `path` holds.
    pub path: Vec<String>,
    /// The hooks, called in order for each event. A hook's `Err` is dropped, as no run reports it.
    pub hooks: Vec<UnitLogHook>,
}

/// The run-shaped state a built context writes and logs through: a host captured from the test's
/// handle, core's output over it under the default policy and no theme, a log that reaches the
/// test's hooks, and a place in the handle's signal lane that no run entered, so a handler
/// registered on it is never called.
pub struct UnitRun {
    state: Arc<RunState>,
    signal: RunSignal,
}

impl UnitRun {
    /// The state over `handle`, logging to `log`. A working directory the handle cannot read leaves
    /// the host's `cwd` empty, as a run's capture does.
    pub fn new(handle: Arc<dyn ProcessHandle>, log: UnitLog) -> Self {
        let lane = crate::signals::lane::lane_of(&handle.signals());
        let capture = crate::host::capture::capture_host("", handle);
        let mut host = capture.host;
        host.terminal.background = host.terminal.stated_background();
        let host = Arc::new(host);
        let signal = RunSignal::new(CancellationToken::new());
        let output = Arc::new(Output::new(
            Arc::clone(&host),
            signal.clone(),
            RenderingPolicy::new(),
            Palette::new(),
            ViewRegistry::new(&[]),
            None,
        ));
        let place = crate::signals::lane::Place::unentered(lane);
        output.use_place(place.clone());
        output.set_route(log.path);
        let log = Arc::new(RunLog::unattached(
            &log.application,
            log.hooks,
            &host,
            &output,
        ));
        Self {
            state: Arc::new(RunState {
                host,
                output,
                log,
                place,
                calls: None,
            }),
            signal,
        }
    }

    /// The host the context reads.
    #[must_use]
    pub fn host(&self) -> Arc<Host> {
        Arc::clone(&self.state.host)
    }

    fn out<R>(&self, channel: Channel) -> Out<R> {
        Out {
            run: Arc::clone(&self.state),
            channel: Arc::new(channel),
            _result: std::marker::PhantomData,
        }
    }

    fn log(&self, plugin: Option<&str>) -> Log {
        Log {
            run: Arc::clone(&self.state),
            plugin: plugin.map(Arc::from),
        }
    }
}

/// The provided values a built context reads, keyed as a run keys them.
#[derive(Default)]
pub struct UnitProvided(Vec<(ProviderKey, ErasedValue)>);

impl UnitProvided {
    /// Supplies `value` as `provider`'s, in place of its opener.
    pub fn provide<V: Send + Sync + 'static, L: Lifetime>(
        &mut self,
        provider: &Provider<V, L>,
        value: V,
    ) {
        let key = provider.erased.key();
        self.0.retain(|(known, _)| *known != key);
        self.0.push((key, Arc::new(value)));
    }

    fn values(self, reader: &str) -> Arc<ProvidedValues> {
        Arc::new(ProvidedValues::stated(self.0, reader.to_owned()))
    }
}

/// How a built context's `out.results` writes the result it declares: a value as one line of its
/// JSON, and rows as one JSON line each, so a test reads what the action emitted.
pub trait UnitResult {
    #[doc(hidden)]
    fn binding(path: &[String]) -> UnitBinding;
}

/// The result binding of a built action context, opaque outside core.
pub struct UnitBinding(Option<ResultBinding>);

impl UnitResult for NoResult {
    fn binding(_path: &[String]) -> UnitBinding {
        UnitBinding(None)
    }
}

impl<V> UnitResult for ValueResult<V> {
    fn binding(path: &[String]) -> UnitBinding {
        let view = ResultView::Whole(View::new(|value: &serde_json::Value, _context| {
            format!("{value}\n")
        }));
        UnitBinding(Some(json_binding(ResultCallKind::Value, view, path)))
    }
}

impl<R> UnitResult for RowsResult<R> {
    fn binding(path: &[String]) -> UnitBinding {
        let view = ResultView::Row(RowView::new(|row: &serde_json::Value, _index, _context| {
            format!("{row}\n")
        }));
        UnitBinding(Some(json_binding(ResultCallKind::Rows, view, path)))
    }
}

fn json_binding(kind: ResultCallKind, view: ResultView, path: &[String]) -> ResultBinding {
    ResultBinding {
        declared: DeclaredResult {
            kind,
            views: vec![ViewEntry {
                key: "json".to_owned(),
                media_type: Some("application/json".to_owned()),
                view: Arc::new(view),
            }],
            default: "json".to_owned(),
        },
        path: path.to_vec(),
        selected: None,
    }
}

/// `from`'s values over `into`'s: each option and argument `from` holds replaces `into`'s of that
/// name, and `from`'s stdin, when it holds one, replaces `into`'s.
#[must_use]
pub fn merged(mut into: InputValues, from: InputValues) -> InputValues {
    into.arguments.extend(from.arguments);
    into.options.extend(from.options);
    if from.stdin.is_some() {
        into.stdin = from.stdin;
    }
    into
}

/// A piped stdin's content handle over `stream`, named `stdin`, as a run prepares one.
#[must_use]
pub fn stdin_content(stream: Arc<dyn crate::host::InputStream>) -> Content {
    Content {
        kind: crate::inputs::ContentKind::Stdin,
        name: "stdin".to_owned(),
        source: crate::inputs::content::ContentSource::Stdin(stream),
    }
}

/// A file's content handle at `path`, named `name`, as a run prepares one for the operand `name`:
/// opened afresh on every read.
#[must_use]
pub fn file_content(path: std::path::PathBuf, name: &str) -> Content {
    Content {
        kind: crate::inputs::ContentKind::File {
            path: path.to_string_lossy().into_owned(),
        },
        name: name.to_owned(),
        source: crate::inputs::content::ContentSource::File(path),
    }
}

/// The members of an action context a test states.
pub struct ActionParts<I> {
    /// The typed inputs.
    pub inputs: I,
    /// The routed Command's values by name, which `ctx.argument` and `ctx.option` read.
    pub locals: InputValues,
    /// The global options' values by name, which `ctx.globals` reads.
    pub globals: InputValues,
    /// The passthrough words.
    pub passthrough: Vec<String>,
    /// Whether the run may ask.
    pub interactive: bool,
    /// The graph.
    pub graph: Arc<CommandGraph>,
    /// The routed node.
    pub command: Arc<CommandNode>,
    /// The provided values.
    pub provided: UnitProvided,
}

/// The context an action receives, built from `parts` over `run`.
pub fn action_context<I: Inputs, R: UnitResult>(
    run: &UnitRun,
    parts: ActionParts<I>,
) -> Context<I, R> {
    let UnitBinding(binding) = R::binding(&parts.command.path);
    let out = run.out(Channel::action(binding));
    let style = crate::style::style();
    Context {
        inputs: parts.inputs,
        passthrough: parts.passthrough,
        supplied: SuppliedInputs::default(),
        interactive: parts.interactive,
        graph: parts.graph,
        command: parts.command,
        out,
        host: run.host(),
        signal: run.signal.clone(),
        style,
        log: run.log(None),
        stdin: None,
        run: Arc::clone(&run.state),
        provided: parts.provided.values("The action"),
        values: Arc::new(RunInputs {
            locals: parts.locals,
            globals: parts.globals,
            invoked_by: InvokedBy::Argv,
        }),
    }
}

/// The members of a middleware context a test states.
pub struct MiddlewareParts<O> {
    /// The plugin's typed options, or `None` as under a held global fault.
    pub options: Option<O>,
    /// Every global option's value by name.
    pub globals: InputValues,
    /// The plugin's own options that validated.
    pub own_options: InputValues,
    /// The routed request's values, or `None` as under a held fault.
    pub request: Option<(InputValues, Vec<String>, Option<Content>)>,
    /// The spelling that supplied each of the plugin's options.
    pub spellings: Vec<(String, String)>,
    /// What the rest of the chain resolves with; `None` makes `next.run()` fail with `unstated`.
    pub outcome: Option<ChainOutcome>,
    /// The sentence `next.run()` fails with when no outcome is stated.
    pub unstated: String,
    /// The view the routed Command's result renders through, or `None` for a Command with none.
    pub view: Option<String>,
    /// The graph.
    pub graph: Arc<CommandGraph>,
    /// The routed node.
    pub command: Arc<CommandNode>,
    /// The plugin identity the middleware's log and handlers name.
    pub identity: String,
}

/// The context and the rest of the chain a middleware receives, built from `parts` over `run`.
pub fn middleware_context<O>(
    run: &UnitRun,
    parts: MiddlewareParts<O>,
) -> (MiddlewareContext<O>, Next) {
    let validated = parts.own_options.option_names();
    // A view a test states is the default of a result that holds it, so a selection reads back
    // whatever name the middleware assigns, and no boundary checks it.
    let result = parts.view.map(|name| DeclaredResult {
        kind: ResultCallKind::Views,
        views: Vec::new(),
        default: name,
    });
    let context = MiddlewareContext {
        options: parts.options,
        own_options: OwnOptions {
            values: parts.own_options,
            validated,
        },
        spellings: Spellings(parts.spellings.into_iter().collect()),
        graph: parts.graph,
        command: parts.command,
        request: parts.request.map(|(values, passthrough, stdin)| Request {
            values,
            passthrough,
            stdin,
        }),
        host: run.host(),
        out: run.out(Channel::plain()),
        signal: run.signal.clone(),
        log: run.log(Some(&parts.identity)),
        run: Arc::clone(&run.state),
        globals: parts.globals,
        selection: Arc::new(Mutex::new(ViewSelection::new(result))),
        identity: Arc::from(parts.identity.as_str()),
    };
    let next = Next::stated(parts.outcome.ok_or(parts.unstated));
    (context, next)
}

/// The facts a failure hook context reads.
pub struct FailureHookParts {
    /// The application name.
    pub application: String,
    /// The routed path.
    pub path: Vec<String>,
    /// How the run received its inputs.
    pub invoked_by: InvokedBy,
    /// The selected view.
    pub view: Option<String>,
    /// Its media type.
    pub media_type: Option<String>,
    /// The graph.
    pub graph: Arc<CommandGraph>,
    /// The routed node.
    pub command: Arc<CommandNode>,
    /// A test's reader of received values.
    pub read_received: Option<ReceivedReader>,
}

/// The context an `on_failure` hook receives, built from `parts` over `run`.
#[must_use]
pub fn failure_hook_context(run: &UnitRun, parts: FailureHookParts) -> FailureHookContext {
    FailureHookContext {
        application: parts.application,
        path: parts.path,
        invoked_by: parts.invoked_by,
        view: parts.view,
        media_type: parts.media_type,
        style: crate::style::style(),
        graph: parts.graph,
        command: parts.command,
        log: run.log(None),
        read_received: parts.read_received,
    }
}

/// The context an opener receives, built over `run` with these global option values, graph, and
/// provided values.
#[must_use]
pub fn provider_context(
    run: &UnitRun,
    options: InputValues,
    graph: Arc<CommandGraph>,
    provided: UnitProvided,
) -> ProviderContext {
    ProviderContext {
        options,
        host: run.host(),
        out: run.out(Channel::plain()),
        style: crate::style::style(),
        graph,
        log: run.log(None),
        signal: run.signal.clone(),
        invoked_by: InvokedBy::Argv,
        run: Arc::clone(&run.state),
        provided: provided.values("The provider"),
    }
}

/// The context a view receives: this width and background, measuring with color and modifiers
/// written when `color` is set, and as plain text otherwise.
#[must_use]
pub fn view_context(
    columns: Option<u16>,
    background: Option<Background>,
    color: bool,
) -> ViewContext {
    let capabilities = if color {
        loomcli_style::Capabilities {
            color: true,
            modifiers: true,
            depth: loomcli_style::ColorDepth::Truecolor,
            ..loomcli_style::Capabilities::PLAIN
        }
    } else {
        loomcli_style::Capabilities::PLAIN
    };
    ViewContext::new(
        background,
        columns,
        crate::style::style(),
        loomcli_style::Renderer::new(capabilities, Palette::new()),
    )
}
