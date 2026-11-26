//! Context builders: the context one author function receives, built for a unit test with no
//! Application and no run.
//!
//! A built context carries what the test states and core's own machinery for the rest: it writes
//! through core's output onto its process handle, by default a fresh [`mock_process`] the test
//! never reads, so a test that reads what the function wrote states a mock of its own and reads its
//! streams. Its log reaches the hooks the test attaches with `on_log`, and no other, a shutdown,
//! suspend, or resume handler registered on it is never called, its signal never cancels, and `ctx.invoke` resolves cancelled with 130. No default,
//! validator, input source, or environment preparation runs: each input holds the value the test
//! stated.

use std::sync::Arc;

use loomcli_core::__private::unit::{
    self, ActionParts, FailureHookParts, MiddlewareParts, ReceivedReader, UnitLog, UnitLogHook,
    UnitProvided, UnitResult, UnitRun,
};
use loomcli_core::{
    Application, Background, ChainOutcome, CommandGraph, CommandNode, Content, Context,
    EnvironmentContext, FailureFacts, FailureHookContext, InputProblem, InputValues, Inputs,
    IntoOutcome, InvokedBy, Lifetime, LogDestination, LogEvent, MiddlewareContext, Next,
    ProcessHandle, Provider, ProviderContext, ResultTransform, SuppliedValue, ViewContext,
};

use crate::{MockFields, mock_process};

/// The graph a built context reads when the test states none: an Application named `app` whose
/// root runs an action and declares nothing.
fn default_graph() -> Arc<CommandGraph> {
    let application = Application::new("app").action(|_ctx: Context| async { Ok(()) });
    match application.inspect() {
        Ok(graph) => graph,
        // A root with an action and no declaration always builds.
        Err(fault) => unreachable!("the default graph builds: {}", fault.message()),
    }
}

/// The node at `path` in `graph`, walking each Command's children by name.
#[track_caller]
fn node_at(graph: &CommandGraph, path: &[String], builder: &str) -> Arc<CommandNode> {
    let mut node = Arc::clone(&graph.root);
    for (depth, word) in path.iter().enumerate() {
        let child = node
            .children
            .iter()
            .find(|child| child.name.as_deref() == Some(word.as_str()))
            .cloned();
        node = child.unwrap_or_else(|| {
            panic!(
                "{builder} has no Command at \"{}\" in its graph. State a path the graph declares.",
                path[..=depth].join(" ")
            )
        });
    }
    node
}

/// The process a context runs on: the stated one, or a fresh mock no one reads.
fn process_or_mock(process: Option<Arc<dyn ProcessHandle>>) -> Arc<dyn ProcessHandle> {
    process.unwrap_or_else(|| mock_process(MockFields::new()) as Arc<dyn ProcessHandle>)
}

/// A test's log hook in the form a built context's log calls.
fn log_hook<T, H>(hook: H) -> UnitLogHook
where
    T: IntoOutcome,
    H: Fn(&LogEvent, &LogDestination) -> T + Send + Sync + 'static,
{
    Arc::new(move |event, destination| hook(event, destination).into_outcome())
}

/// Supplies the process facts and observed log hooks for an environment hook's context.
#[derive(Default)]
#[must_use]
pub struct EnvironmentValues {
    process: Option<Arc<dyn ProcessHandle>>,
    logs: Vec<UnitLogHook>,
}

impl EnvironmentValues {
    /// Uses a fresh mock with an empty environment and no log observers.
    pub fn new() -> Self {
        Self::default()
    }

    /// Reads the working directory and environment from this handle and writes warnings to it.
    pub fn process(mut self, process: Arc<dyn ProcessHandle>) -> Self {
        self.process = Some(process);
        self
    }

    /// Adds a hook that receives the environment hook's log events in call order.
    pub fn on_log<T, H>(mut self, hook: H) -> Self
    where
        T: IntoOutcome,
        H: Fn(&LogEvent, &LogDestination) -> T + Send + Sync + 'static,
    {
        self.logs.push(log_hook(hook));
        self
    }
}

/// Builds the context a test passes to one `on_environment` hook. The default mock has an empty
/// environment and working directory `/loom-test`. Provide a mock to observe warnings on stderr.
#[must_use]
pub fn environment_context(values: EnvironmentValues) -> EnvironmentContext {
    let run = UnitRun::new(
        process_or_mock(values.process),
        UnitLog {
            application: "app".to_owned(),
            path: Vec::new(),
            hooks: values.logs,
        },
    );
    unit::environment_context(&run)
}

/// The log a context built for `graph` at `path` publishes to `hooks`.
fn unit_log(graph: &CommandGraph, path: &[String], hooks: Vec<UnitLogHook>) -> UnitLog {
    UnitLog {
        application: graph.name.clone(),
        path: path.to_vec(),
        hooks,
    }
}

/// A typed struct written as values and read back, so the context holds both: the inverse
/// `Inputs::into_values` promises.
#[track_caller]
fn extract_values<I: Inputs>(values: InputValues, builder: &str) -> (I, InputValues) {
    match I::extract(&values) {
        Ok(inputs) => (inputs, values),
        Err(error) => {
            let reason = match (error.failure(), error.foreign()) {
                (Some(failure), _) => failure.message().to_owned(),
                (None, Some(foreign)) => foreign.to_string(),
                (None, None) => String::new(),
            };
            panic!(
                "{builder} could not read the stated inputs back from their into_values(): {reason} An Inputs impl's extract reads what its into_values writes."
            )
        }
    }
}

/// A content handle over piped `bytes`, named `stdin`, as a run prepares one for piped stdin: the
/// value a test gives a `Content` input or a `#[stdin]` field. Its first read takes the bytes; a
/// later read finds the stream at its end, as a run's stdin does.
#[must_use]
pub fn piped_content(bytes: impl Into<Vec<u8>>) -> Content {
    unit::stdin_content(Arc::new(crate::mock::Piped::new(bytes.into())))
}

/// A content handle over the file at `path`, named as the operand `path`, as a run prepares one for
/// `--file path` from the working directory `cwd`: the path is joined to `cwd` without normalizing,
/// and each read opens the file afresh.
#[must_use]
pub fn file_content(cwd: impl AsRef<std::path::Path>, path: &str) -> Content {
    unit::file_content(cwd.as_ref().join(path), path)
}

/// The values an action context is built from: the action's inputs, and optional overrides of every
/// other member.
#[must_use]
pub struct ActionValues<I> {
    pub(crate) inputs: I,
    pub(crate) globals: InputValues,
    pub(crate) passthrough: Option<Vec<String>>,
    pub(crate) interactive: bool,
    pub(crate) process: Option<Arc<dyn ProcessHandle>>,
    pub(crate) graph: Option<Arc<CommandGraph>>,
    pub(crate) command: Vec<String>,
    pub(crate) provided: UnitProvided,
    pub(crate) log: Vec<UnitLogHook>,
}

impl<I: Inputs> ActionValues<I> {
    /// Values with these inputs.
    pub fn new(inputs: I) -> Self {
        Self {
            inputs,
            globals: InputValues::new(),
            passthrough: None,
            interactive: false,
            process: None,
            graph: None,
            command: Vec::new(),
            provided: UnitProvided::default(),
            log: Vec::new(),
        }
    }

    /// Sets the global options `ctx.globals::<G>()` and `ctx.option::<T>(name)` read, from a typed
    /// struct through [`Inputs::into_values`]. Call it once per struct; later fields replace earlier
    /// ones of the same name.
    pub fn globals<G: Inputs>(mut self, globals: G) -> Self {
        self.globals = unit::merged(self.globals, globals.into_values());
        self
    }

    /// Overrides the passthrough words the typed inputs supply.
    pub fn passthrough(mut self, words: &[&str]) -> Self {
        self.passthrough = Some(words.iter().map(|word| (*word).to_owned()).collect());
        self
    }

    /// Makes the run interactive.
    pub fn interactive(mut self) -> Self {
        self.interactive = true;
        self
    }

    /// Runs on this process handle, such as a mock, whose streams receive what the action writes
    /// and whose facts the context's host holds.
    pub fn process(mut self, process: Arc<dyn ProcessHandle>) -> Self {
        self.process = Some(process);
        self
    }

    /// Reads this graph; the routed node is its root unless [`ActionValues::command`] names another.
    pub fn graph(mut self, graph: Arc<CommandGraph>) -> Self {
        self.graph = Some(graph);
        self
    }

    /// Routes to the Command at `path` in the graph, which `ctx.command` holds.
    pub fn command(mut self, path: &[&str]) -> Self {
        self.command = path.iter().map(|word| (*word).to_owned()).collect();
        self
    }

    /// Supplies a provider's value in place of its opener.
    pub fn provide<V: Send + Sync + 'static, L: Lifetime>(
        mut self,
        provider: &Provider<V, L>,
        value: V,
    ) -> Self {
        self.provided.provide(provider, value);
        self
    }

    /// Attaches an `on_log` hook, as `Plugin::on_log` installs one, that observes each event the
    /// context's `log` publishes. Hooks are called in the order they were attached; an event names
    /// the graph's application, version `0.0.0`, and the routed path. A hook's `Err` is dropped.
    pub fn on_log<T, H>(mut self, hook: H) -> Self
    where
        T: IntoOutcome,
        H: Fn(&LogEvent, &LogDestination) -> T + Send + Sync + 'static,
    {
        self.log.push(log_hook(hook));
        self
    }
}

/// Builds the context an action receives. `ctx.argument::<T>(name)` and `ctx.option::<T>(name)`
/// read the inputs' own values, written through [`Inputs::into_values`]; `out.results` writes a
/// value result as one line of JSON and rows as one JSON line each.
///
/// # Panics
///
/// When the graph holds no Command at the stated path, or the inputs' `extract` cannot read what
/// their `into_values` wrote.
#[track_caller]
pub fn action_context<I: Inputs, R: UnitResult>(values: ActionValues<I>) -> Context<I, R> {
    let mut locals = values.inputs.into_values();
    if let Some(words) = values.passthrough {
        locals = locals.with_passthrough(words);
    }
    let (inputs, locals) = extract_values::<I>(locals, "action_context");
    let passthrough = locals.passthrough().to_vec();
    let graph = values.graph.unwrap_or_else(default_graph);
    let command = node_at(&graph, &values.command, "action_context");
    let log = unit_log(&graph, &values.command, values.log);
    let run = UnitRun::new(process_or_mock(values.process), log);
    unit::action_context(
        &run,
        ActionParts {
            inputs,
            locals,
            globals: values.globals,
            passthrough,
            interactive: values.interactive,
            graph,
            command,
            provided: values.provided,
        },
    )
}

/// The values a middleware context is built from.
#[must_use]
pub struct MiddlewareValues<O> {
    pub(crate) options: Option<O>,
    pub(crate) own_options: Option<InputValues>,
    pub(crate) request: Option<InputValues>,
    pub(crate) invoked_by: InvokedBy,
    pub(crate) outcome: Option<ChainOutcome>,
    pub(crate) process: Option<Arc<dyn ProcessHandle>>,
    pub(crate) graph: Option<Arc<CommandGraph>>,
    pub(crate) command: Vec<String>,
    pub(crate) spellings: Vec<(String, String)>,
    pub(crate) view: Option<String>,
    pub(crate) media_type: Option<String>,
    pub(crate) transform: Option<ResultTransform>,
    pub(crate) plugin: String,
    pub(crate) log: Vec<UnitLogHook>,
}

impl<O: Inputs> MiddlewareValues<O> {
    /// Values with these plugin options; `None` reads as a held global fault.
    pub fn new(options: Option<O>) -> Self {
        Self {
            options,
            own_options: None,
            request: None,
            invoked_by: InvokedBy::Argv,
            outcome: None,
            process: None,
            graph: None,
            command: Vec::new(),
            spellings: Vec::new(),
            view: None,
            media_type: None,
            transform: None,
            plugin: "@loom-test/plugin".to_owned(),
            log: Vec::new(),
        }
    }

    /// What the rest of the chain resolves with. Unstated, `next.run()` fails with a sentence that
    /// asks for it.
    pub fn outcome(mut self, outcome: ChainOutcome) -> Self {
        self.outcome = Some(outcome);
        self
    }

    /// Sets the plugin's own options that validated, which `own_options` reads; by default those of
    /// the typed options, when given.
    pub fn own_options(mut self, values: InputValues) -> Self {
        self.own_options = Some(values);
        self
    }

    /// Sets the routed request's argument and local option values, which `request.values` reads;
    /// by default the request is `None`, as under a held fault.
    pub fn request(mut self, values: InputValues) -> Self {
        self.request = Some(values);
        self
    }

    /// Sets how the run received its inputs. Unstated, it reads as [`InvokedBy::Argv`].
    pub fn invoked_by(mut self, invoked_by: InvokedBy) -> Self {
        self.invoked_by = invoked_by;
        self
    }

    /// Records the spelling that supplied the plugin's option `name`.
    pub fn spelling(mut self, name: &str, spelling: &str) -> Self {
        self.spellings.push((name.to_owned(), spelling.to_owned()));
        self
    }

    /// Sets the view the routed Command's result renders through, which `view()` reads until the
    /// middleware selects another. Unstated, `view()` reads `None`, as on a Command with no result.
    pub fn view(mut self, name: &str) -> Self {
        self.view = Some(name.to_owned());
        self
    }

    /// Sets the media type that `media_type()` reads until the middleware assigns another.
    /// Unstated, it reads `None` regardless of the view.
    pub fn media_type(mut self, media_type: &str) -> Self {
        self.media_type = Some(media_type.to_owned());
        self
    }

    /// Sets the result transform that `transform()` reads until the middleware assigns another.
    /// Unstated, it reads `None`.
    pub fn transform(mut self, transform: ResultTransform) -> Self {
        self.transform = Some(transform);
        self
    }

    /// Names the plugin whose middleware this is, which its log events and handlers name;
    /// `@loom-test/plugin` unless stated.
    pub fn plugin(mut self, identity: &str) -> Self {
        identity.clone_into(&mut self.plugin);
        self
    }

    /// Runs on this process handle.
    pub fn process(mut self, process: Arc<dyn ProcessHandle>) -> Self {
        self.process = Some(process);
        self
    }

    /// Reads this graph; the routed node is its root unless [`MiddlewareValues::command`] names
    /// another.
    pub fn graph(mut self, graph: Arc<CommandGraph>) -> Self {
        self.graph = Some(graph);
        self
    }

    /// Routes to the Command at `path` in the graph, which `ctx.command` holds.
    pub fn command(mut self, path: &[&str]) -> Self {
        self.command = path.iter().map(|word| (*word).to_owned()).collect();
        self
    }

    /// Attaches an `on_log` hook, as `Plugin::on_log` installs one, that observes each event the
    /// context's `log` publishes. Hooks are called in the order they were attached; an event names the plugin,
    /// the graph's application, version `0.0.0`, and the routed path. A hook's `Err` is dropped.
    pub fn on_log<T, H>(mut self, hook: H) -> Self
    where
        T: IntoOutcome,
        H: Fn(&LogEvent, &LogDestination) -> T + Send + Sync + 'static,
    {
        self.log.push(log_hook(hook));
        self
    }
}

/// The sentence a `next.run()` resolves with when the test stated no outcome.
const UNSTATED_NEXT: &str = "middleware_context has no outcome for this middleware's next to resolve. Add one to its values, such as .outcome(ChainOutcome::Dispatched).";

/// Builds the context and the rest of the chain a middleware receives.
///
/// The context keeps the last media type and result transform the middleware assigns. The test's
/// `Next` resolves with the stated outcome without reaching a dispatch boundary.
///
/// # Panics
///
/// When the graph holds no Command at the stated path, or the options' `extract` cannot read what
/// their `into_values` wrote.
#[track_caller]
pub fn middleware_context<O: Inputs>(values: MiddlewareValues<O>) -> (MiddlewareContext<O>, Next) {
    let (options, globals) = match values.options {
        Some(options) => {
            let (options, globals) =
                extract_values::<O>(options.into_values(), "middleware_context");
            (Some(options), globals)
        }
        None => (None, InputValues::new()),
    };
    let own_options = values.own_options.unwrap_or_else(|| globals.clone());
    let graph = values.graph.unwrap_or_else(default_graph);
    let command = node_at(&graph, &values.command, "middleware_context");
    let log = unit_log(&graph, &values.command, values.log);
    let run = UnitRun::new(process_or_mock(values.process), log);
    unit::middleware_context(
        &run,
        MiddlewareParts {
            options,
            globals,
            own_options,
            request: values.request.map(|values| (values, Vec::new(), None)),
            invoked_by: values.invoked_by,
            spellings: values.spellings,
            outcome: values.outcome,
            unstated: UNSTATED_NEXT.to_owned(),
            view: values.view,
            media_type: values.media_type,
            transform: values.transform,
            graph,
            command,
            identity: values.plugin,
        },
    )
}

/// The values a failure hook context is built from.
#[must_use]
pub struct FailureHookValues {
    pub(crate) application: String,
    pub(crate) path: Vec<String>,
    pub(crate) invoked_by: InvokedBy,
    pub(crate) view: Option<String>,
    pub(crate) media_type: Option<String>,
    pub(crate) graph: Option<Arc<CommandGraph>>,
    pub(crate) log: Vec<UnitLogHook>,
    pub(crate) read_received: Option<ReceivedReader>,
}

impl FailureHookValues {
    /// Values for `application` at `path`, run from argv.
    pub fn new(application: &str, path: &[&str]) -> Self {
        Self {
            application: application.to_owned(),
            path: path.iter().map(|word| (*word).to_owned()).collect(),
            invoked_by: InvokedBy::Argv,
            view: None,
            media_type: None,
            graph: None,
            log: Vec::new(),
            read_received: None,
        }
    }

    /// Sets how the run received its inputs.
    pub fn invoked_by(mut self, invoked_by: InvokedBy) -> Self {
        self.invoked_by = invoked_by;
        self
    }

    /// Sets the selected view and its media type.
    pub fn view(mut self, name: &str, media_type: Option<&str>) -> Self {
        self.view = Some(name.to_owned());
        self.media_type = media_type.map(str::to_owned);
        self
    }

    /// Reads this graph, whose node at the path is the context's `command`.
    pub fn graph(mut self, graph: Arc<CommandGraph>) -> Self {
        self.graph = Some(graph);
        self
    }

    /// Sets the reader for `ctx.received(problem)`, which returns `None` by default.
    pub fn received(
        mut self,
        reader: impl Fn(&InputProblem) -> Option<SuppliedValue> + Send + Sync + 'static,
    ) -> Self {
        self.read_received = Some(Arc::new(reader));
        self
    }

    /// Attaches an `on_log` hook, as `Plugin::on_log` installs one, that observes each event the
    /// context's `log` publishes. Hooks are called in the order they were attached; an event names
    /// the stated application, version `0.0.0`, and the stated path. A hook's `Err` is dropped.
    pub fn on_log<T, H>(mut self, hook: H) -> Self
    where
        T: IntoOutcome,
        H: Fn(&LogEvent, &LogDestination) -> T + Send + Sync + 'static,
    {
        self.log.push(log_hook(hook));
        self
    }
}

/// Builds the context an `on_failure` hook receives. Its `command` is the graph's node at the path
/// when the graph declares one there, and its root otherwise, as for a path routing never reached.
#[must_use]
pub fn failure_hook_context(values: FailureHookValues) -> FailureHookContext {
    let graph = values.graph.unwrap_or_else(default_graph);
    let mut command = Arc::clone(&graph.root);
    for word in &values.path {
        match command
            .children
            .iter()
            .find(|child| child.name.as_deref() == Some(word.as_str()))
        {
            Some(child) => command = Arc::clone(child),
            None => break,
        }
    }
    let log = UnitLog {
        application: values.application.clone(),
        path: values.path.clone(),
        hooks: values.log,
    };
    let run = UnitRun::new(process_or_mock(None), log);
    unit::failure_hook_context(
        &run,
        FailureHookParts {
            application: values.application,
            path: values.path,
            invoked_by: values.invoked_by,
            view: values.view,
            media_type: values.media_type,
            graph,
            command,
            read_received: values.read_received,
        },
    )
}

/// The values a provider context is built from.
#[must_use]
pub struct ProviderValues<G> {
    pub(crate) globals: G,
    pub(crate) process: Option<Arc<dyn ProcessHandle>>,
    pub(crate) graph: Option<Arc<CommandGraph>>,
    pub(crate) provided: UnitProvided,
    pub(crate) log: Vec<UnitLogHook>,
}

impl<G: Inputs> ProviderValues<G> {
    /// Values with these global options, written into `options` through [`Inputs::into_values`],
    /// so the opener's `ctx.globals::<G>()` reads them back.
    pub fn new(globals: G) -> Self {
        Self {
            globals,
            process: None,
            graph: None,
            provided: UnitProvided::default(),
            log: Vec::new(),
        }
    }

    /// Runs on this process handle.
    pub fn process(mut self, process: Arc<dyn ProcessHandle>) -> Self {
        self.process = Some(process);
        self
    }

    /// Reads this graph.
    pub fn graph(mut self, graph: Arc<CommandGraph>) -> Self {
        self.graph = Some(graph);
        self
    }

    /// Supplies the value of a provider the opener's provider uses, which `ctx.provided` reads.
    pub fn provide<V: Send + Sync + 'static, L: Lifetime>(
        mut self,
        provider: &Provider<V, L>,
        value: V,
    ) -> Self {
        self.provided.provide(provider, value);
        self
    }

    /// Attaches an `on_log` hook, as `Plugin::on_log` installs one, that observes each event the
    /// context's `log` publishes. Hooks are called in the order they were attached; an event names
    /// the graph's application, version `0.0.0`, and an empty path. A hook's `Err` is dropped.
    pub fn on_log<T, H>(mut self, hook: H) -> Self
    where
        T: IntoOutcome,
        H: Fn(&LogEvent, &LogDestination) -> T + Send + Sync + 'static,
    {
        self.log.push(log_hook(hook));
        self
    }
}

/// Builds the context an opener receives.
#[must_use]
pub fn provider_context<G: Inputs>(values: ProviderValues<G>) -> ProviderContext {
    let options = values.globals.into_values();
    let graph = values.graph.unwrap_or_else(default_graph);
    let log = unit_log(&graph, &[], values.log);
    let run = UnitRun::new(process_or_mock(values.process), log);
    unit::provider_context(&run, options, graph, values.provided)
}

/// The values a view context is built from: a width, a background, and color.
#[derive(Clone, Debug, Default)]
#[must_use]
pub struct ViewValues {
    pub(crate) columns: Option<u16>,
    pub(crate) background: Option<Background>,
    pub(crate) color: bool,
}

impl ViewValues {
    /// No width, as a destination that is not a terminal; no background; no color.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the width.
    pub fn columns(mut self, columns: u16) -> Self {
        self.columns = Some(columns);
        self
    }

    /// Sets the background.
    pub fn background(mut self, background: Background) -> Self {
        self.background = Some(background);
        self
    }

    /// Measures as a destination that writes color and modifiers does.
    pub fn color(mut self) -> Self {
        self.color = true;
        self
    }
}

/// Builds the context a view receives: the stated width and background, with core's own measures,
/// `width`, `plain`, `wrap`, and `expand_tabs`, under the stated color.
///
/// A test calls the view with it: `render` on a `View` or a `DeclaredView`, and `render_head`,
/// `render_row`, and `render_tail` on a `RowView` or a `DeclaredRowView`. A declared view's own
/// function runs, because no view registry is read.
///
/// ```
/// use loomcli_core::{View, ViewContext};
/// use loomcli_testing::{ViewValues, view_context};
///
/// let heading = View::new(|title: &str, ctx: &ViewContext| {
///     let rule = usize::from(ctx.columns.unwrap_or(40)).saturating_sub(ctx.width(title) + 1);
///     format!("{title} {}\n", "-".repeat(rule))
/// });
/// let ctx = view_context(ViewValues::new().columns(12));
/// assert_eq!(heading.render("Notes", &ctx).unwrap(), "Notes ------\n");
/// ```
#[must_use]
pub fn view_context(values: ViewValues) -> ViewContext {
    unit::view_context(values.columns, values.background, values.color)
}
