//! The Application declaration and its entry points: `run`, `main`, `invoke`, `inspect`, `check`.
//!
//! An Application is the unnamed root Command plus the facts and contributions only the root has:
//! the name, version, and description every projection reads, the plugins, the view overrides, the
//! translators, global options, and the shutdown budget.

pub(crate) mod declaration;

use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::commands::{
    AnyCommand, CarriesResult, Configuring, Done, Group, NoResultYet, Open, Passthrough, State,
    TakesGlobals,
};
use crate::failures::{DeclarationError, ExitCode, Translation};
use crate::host::ProcessHandle;
use crate::inputs::{
    ArgumentDecl, GlobalInputs, GlobalOptionDecl, Inputs, NoInputs, OptionDecl, Stdin,
};
use crate::invocation::{Context, InvocationOutcome, InvocationValues, InvokeOptions, Outcome};
use crate::output::{
    NoResult, ResultKind, ResultViews, RowViews, RowsResult, ValueResult, ViewOverride,
};
use crate::plugins::{
    AnyPlugin, AnyProvider, CommandTarget, ExtensionValue, Lifetime, Provider, ProviderContext,
};
use crate::style::RenderingPolicy;
use crate::support::IntoList;

/// An application: the unnamed root Command, its plugins, and the facts projections read.
///
/// `Application::new(name)` starts in the `Configuring` state, the only one that takes
/// `plugins()`, so the plugins' options and Commands join before the application's own.
///
/// ```
/// use std::sync::Arc;
///
/// use loomcli_core::{Application, Command, Context, Opt, RunOptions};
/// use loomcli_testing::{MockFields, mock_process};
///
/// let app = Application::new("greet")
///     .global_option("loud", Opt::boolean().short('l'))
///     .command(Command::new("hello").action(|ctx: Context| async move {
///         let loud: bool = ctx.option("loud")?;
///         ctx.out.print(if loud { "HELLO" } else { "hello" }).await
///     }));
///
/// let process = mock_process(MockFields::new().argv(["-l", "hello"]));
/// let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
/// let code = runtime.block_on(app.run(RunOptions::new().process(Arc::clone(&process) as _)));
/// assert_eq!((code.get(), process.stdout_text()), (0, "HELLO\n".to_owned()));
/// ```
#[must_use]
pub struct Application<I = NoInputs, R = NoResult, S = Done> {
    pub(crate) declaration: Arc<declaration::ApplicationDeclaration>,
    pub(crate) graphs: Arc<crate::inspection::build::KeptGraphs>,
    pub(crate) _types: crate::__private::Types<I, R, S>,
}

impl<I, R, S> Clone for Application<I, R, S> {
    fn clone(&self) -> Self {
        Self {
            declaration: Arc::clone(&self.declaration),
            graphs: Arc::clone(&self.graphs),
            _types: PhantomData,
        }
    }
}

impl Application<NoInputs, NoResult, Configuring> {
    /// Declares an application. The name is a portable name; another is a fault at this call.
    #[track_caller]
    pub fn new(name: &str) -> Self {
        Application {
            declaration: Arc::new(crate::commands::declaration::raise(
                declaration::ApplicationDeclaration::new(name),
            )),
            graphs: Arc::default(),
            _types: PhantomData,
        }
    }

    /// Installs the plugins, in composition order. Their Commands attach to the root first, and
    /// their options become global options. This is the only way in, once.
    #[track_caller]
    pub fn plugins(
        self,
        plugins: impl IntoList<AnyPlugin>,
    ) -> Application<NoInputs, NoResult, crate::commands::Fresh> {
        let mut application = self;
        let plugins = plugins
            .into_list()
            .into_iter()
            .map(|plugin| plugin.inner)
            .collect();
        raise(application.declared().install(plugins));
        application.retyped()
    }
}

// Each state bound sits in the method's where clause, not the impl header, so a call the state
// removes reports the bound's `on_unimplemented` message (E0277) rather than a bare E0599.
/// An Application whose root has subcommands and no action of its own, the shape most
/// multi-command tools take, as a function that builds one names its return type.
///
/// ```
/// use loomcli_core::{Application, Command, Context, GroupApplication};
///
/// fn app() -> GroupApplication {
///     Application::new("shipit")
///         .command(Command::new("deploy").action(|_: Context| async { Ok(()) }))
///         .command(Command::new("release").action(|_: Context| async { Ok(()) }))
/// }
///
/// assert!(app().inspect().is_ok());
/// ```
pub type GroupApplication<I = NoInputs, R = NoResult> = Application<I, R, Group>;

impl<I, R, S: State> Application<I, R, S> {
    /// Sets the description every projection reads.
    pub fn description(self, text: impl Into<String>) -> Self
    where
        S: Open,
    {
        let mut application = self;
        application.declared().description = Some(text.into());
        application
    }

    /// Sets the version; an unversioned application reads `0.0.0`.
    pub fn version(self, version: impl Into<String>) -> Self
    where
        S: Open,
    {
        let mut application = self;
        application.declared().version = Some(version.into());
        application
    }

    /// Lists the view overrides: of a failure class, a lane, or any declared view. The
    /// application's come first in resolution, and the first override of one key wins. An override
    /// keyed by a declared view whose identity core, or an earlier override, gives another view type
    /// is `two-package-copies`.
    #[track_caller]
    pub fn overrides(self, overrides: impl IntoList<ViewOverride>) -> Self
    where
        S: Open,
    {
        let mut application = self;
        let overrides = overrides.into_list();
        let mut known: Vec<crate::output::ViewContribution> = application
            .declaration
            .overrides
            .iter()
            .cloned()
            .map(crate::output::ViewContribution::Override)
            .collect();
        known.extend(application.declaration.plugin_views());
        raise(crate::output::registry::check_overrides(&known, &overrides));
        application.declared().overrides.extend(overrides);
        application
    }

    /// Lists the application's translators, consulted before any plugin's.
    #[track_caller]
    pub fn translators(self, translations: impl IntoList<Translation>) -> Self
    where
        S: Open,
    {
        let mut application = self;
        application
            .declared()
            .translators
            .extend(translations.into_list());
        application
    }

    /// Lists the providers the root's own action reads.
    #[track_caller]
    pub fn uses(self, providers: impl IntoList<AnyProvider>) -> Self
    where
        S: Open,
    {
        let mut application = self;
        let providers = providers.into_list();
        let declared = application.declared();
        raise(crate::plugins::check_uses(
            None,
            &declared.root.uses,
            &providers,
        ));
        declared.root.uses.extend(providers);
        application
    }

    /// Sets the shutdown budget: the milliseconds runs get to unwind after an ending signal, 500
    /// unless set.
    #[track_caller]
    pub fn shutdown_timeout(self, milliseconds: u32) -> Self
    where
        S: Open,
    {
        let mut application = self;
        raise(application.declared().set_shutdown_timeout(milliseconds));
        application
    }

    /// Sets the rendering policy the application declares.
    pub fn rendering(self, policy: RenderingPolicy) -> Self
    where
        S: Open,
    {
        let mut application = self;
        application.declared().rendering = policy;
        application
    }

    /// Declares a root-local option.
    #[track_caller]
    pub fn option(
        self,
        name: &str,
        option: impl Into<OptionDecl>,
    ) -> Application<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut application = self;
        let declared = application.declared();
        raise(
            declared
                .root
                .declare_option(name, option.into(), &declared.global_table),
        );
        application.retyped()
    }

    /// Declares standalone stdin for the root's action.
    #[track_caller]
    pub fn stdin(self, stdin: Stdin) -> Application<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut application = self;
        raise(application.declared().root.declare_stdin(stdin));
        application.retyped()
    }

    /// Enables passthrough after the first bare `--`. A second declaration is a call fault.
    #[track_caller]
    pub fn passthrough(self, mode: Passthrough) -> Application<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut application = self;
        raise(application.declared().root.declare_passthrough(mode));
        application.retyped()
    }

    /// Requires stdin and stderr at a terminal outside CI. A second declaration is a call fault.
    #[track_caller]
    pub fn needs_terminal(self) -> Application<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut application = self;
        raise(application.declared().root.declare_terminal_need());
        application.retyped()
    }

    /// Declares that at most one of these root-local options is supplied.
    #[track_caller]
    pub fn exclusive(self, names: &[&str]) -> Self
    where
        S: Open,
    {
        let mut application = self;
        raise(
            application
                .declared()
                .root
                .declare_group(crate::inspection::OptionGroupKind::Exclusive, names),
        );
        application
    }

    /// Declares that at least one of these root-local options is supplied.
    #[track_caller]
    pub fn one_required(self, names: &[&str]) -> Self
    where
        S: Open,
    {
        let mut application = self;
        raise(
            application
                .declared()
                .root
                .declare_group(crate::inspection::OptionGroupKind::OneRequired, names),
        );
        application
    }

    /// Declares that these root-local options are supplied together or not at all.
    #[track_caller]
    pub fn required_together(self, names: &[&str]) -> Self
    where
        S: Open,
    {
        let mut application = self;
        raise(
            application
                .declared()
                .root
                .declare_group(crate::inspection::OptionGroupKind::RequiredTogether, names),
        );
        application
    }

    /// Declares a global option, shared by every action. A global option declares no presence rule.
    #[track_caller]
    pub fn global_option(
        self,
        name: &str,
        option: impl Into<GlobalOptionDecl>,
    ) -> Application<I, R, <S as State>::Declared>
    where
        S: TakesGlobals,
    {
        let mut application = self;
        raise(application.declared().declare_global(name, option.into().0));
        application.retyped()
    }

    /// Declares the fields of `G` as global options; an action reads them with `ctx.globals::<G>()`.
    /// A struct that cannot be global options does not implement [`GlobalInputs`], a compile error
    /// at this call.
    #[track_caller]
    pub fn globals<G: GlobalInputs>(self) -> Application<I, R, <S as State>::Declared>
    where
        S: TakesGlobals,
    {
        let mut application = self;
        let calls = G::declare(crate::inputs::Declarations::new()).calls;
        let declared = application.declared();
        for call in calls {
            raise(declared.declare_global_call(call));
        }
        application.retyped()
    }

    /// Declares a positional argument for the root action.
    #[track_caller]
    pub fn argument(
        self,
        name: &str,
        argument: impl Into<ArgumentDecl>,
    ) -> Application<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut application = self;
        raise(
            application
                .declared()
                .root
                .declare_argument(name, argument.into()),
        );
        application.retyped()
    }

    /// Attaches a child Command to the root.
    #[track_caller]
    pub fn command(self, child: impl Into<AnyCommand>) -> Application<I, R, Group>
    where
        S: Open,
    {
        let mut application = self;
        raise(application.declared().attach(child.into().declaration));
        application.retyped()
    }
}

impl<R, S: State> Application<NoInputs, R, S> {
    /// Declares the fields of `J` as the root's arguments and options, and types the root action's
    /// inputs as `J`.
    #[track_caller]
    pub fn inputs<J>(self) -> Application<J, R, <S as State>::Declared>
    where
        S: Open,
        J: Inputs,
    {
        let mut application = self;
        let calls = J::declare(crate::inputs::Declarations::new()).calls;
        let declared = application.declared();
        raise(declared.root.declare_all(calls, &declared.global_table));
        application.retyped()
    }
}

impl<I, R, S: State> Application<I, R, S> {
    /// Declares a result of one value for the root's action.
    #[track_caller]
    pub fn result<V: Serialize + Send + Sync + 'static>(
        self,
        views: ResultViews<V>,
    ) -> Application<I, ValueResult<V>, <S as State>::Declared>
    where
        S: Open,
        R: NoResultYet,
    {
        let mut application = self;
        application
            .declared()
            .root
            .results
            .push(views.call(crate::commands::declaration::ResultCallKind::Value));
        application.retyped()
    }

    /// Declares a result of rows for the root's action.
    #[track_caller]
    pub fn rows<Row: Serialize + Send + Sync + 'static>(
        self,
        views: RowViews<Row>,
    ) -> Application<I, RowsResult<Row>, <S as State>::Declared>
    where
        S: Open,
        R: NoResultYet,
    {
        let mut application = self;
        application
            .declared()
            .root
            .results
            .push(views.call(crate::commands::declaration::ResultCallKind::Rows));
        application.retyped()
    }
}

impl<I, R, S: State> Application<I, R, S> {
    /// Adds or replaces the root result's views by name, in every state.
    #[track_caller]
    pub fn views(self, replacements: <R as CarriesResult>::Views) -> Self
    where
        R: CarriesResult,
    {
        let mut application = self;
        application
            .declared()
            .root
            .results
            .push(R::views_call(replacements).0);
        application
    }
}

impl<I: Inputs, R: ResultKind, S: State> Application<I, R, S> {
    /// Registers the root's action. A handler that captures state clones it into the future it
    /// returns, as [`Command::action`](crate::Command::action) states.
    pub fn action<H, Fut>(self, handler: H) -> Application<I, R, Done>
    where
        S: Open,
        H: Fn(Context<I, R>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Outcome> + Send + 'static,
    {
        let mut application = self;
        application.declared().root.action =
            Some(crate::commands::erase_action::<I, R, H, Fut>(handler));
        application.retyped()
    }
}

impl<I, R, S: State> Application<I, R, S> {
    /// Attaches extension values to the root, in every state. A value its descriptor's rules reject
    /// is a fault at this call, under `invalid-extension-value`.
    #[track_caller]
    pub fn extend(self, values: impl IntoList<ExtensionValue<CommandTarget>>) -> Self {
        let mut application = self;
        raise(application.declared().root.extend(&values.into_list()));
        application
    }

    /// The application name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.declaration.name
    }

    /// Runs one invocation on the process handle the options name, or the real process's, and
    /// resolves its exit code, which it also writes to the handle. It does not call the real
    /// process's exit listeners, so a process-scoped `on_shutdown` handler does not run at a normal
    /// end: a program's entry point is [`main`](Self::main) or [`main_async`](Self::main_async),
    /// which do. The run takes its place in its
    /// handle's signal lane at this call, before the returned future is first polled, so core
    /// listens for the ending signals from the call until the run resolves and a signal raised
    /// right after the call reaches the run. Core never calls `std::process::exit`; a shutdown ends
    /// by re-raising its ending signal on the handle's signal source with core's listeners gone, so
    /// on the real process the default disposition ends it with the shell's status, as the
    /// reference does.
    pub fn run(&self, options: RunOptions) -> crate::support::BoxFuture<'static, ExitCode> {
        Box::pin(crate::invocation::run::run(
            &self.declaration,
            &self.graphs,
            options,
        ))
    }

    /// Builds a current-thread tokio runtime, runs on the real process, and returns the exit code,
    /// for an application with no runtime of its own: `fn main() -> ExitCode { app().main() }`.
    /// As the run returns, core calls the real process's exit listeners, so every pending
    /// `on_shutdown` handler runs with `ShutdownCause::Exit`. A run a shutdown cut short never
    /// returns here: the shutdown's re-raised signal ends the process.
    ///
    /// Called on a thread that already drives a tokio runtime, it panics with the
    /// `@loomcli/core/entry-point` Developer Diagnostic: an application with a runtime of its own
    /// awaits [`main_async`](Self::main_async) instead.
    #[track_caller]
    pub fn main(&self) -> std::process::ExitCode {
        if tokio::runtime::Handle::try_current().is_ok() {
            raise::<()>(Err(crate::invocation::run::entry_inside_runtime(
                &self.declaration.name,
            )));
        }
        let code = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime.block_on(self.run(RunOptions::new())),
            Err(error) => crate::invocation::run::unstarted(&self.declaration, &error),
        };
        crate::host::real::process_exiting(i32::from(code.get()));
        code.into()
    }

    /// Runs on the real process inside the caller's tokio runtime and returns the exit code, for an
    /// application with a runtime of its own:
    /// `#[tokio::main] async fn main() -> ExitCode { app().main_async().await }`. It is
    /// [`main`](Self::main) without the runtime: as the run returns, core calls the real process's
    /// exit listeners, so every pending `on_shutdown` handler runs with `ShutdownCause::Exit`, which
    /// awaiting [`run`](Self::run) alone never does. The run takes its place in the real process's
    /// signal lane at this call, as `run` does. A run a shutdown cut short never returns here: the
    /// shutdown's re-raised signal ends the process.
    pub fn main_async(
        &self,
    ) -> impl Future<Output = std::process::ExitCode> + Send + 'static + use<I, R, S> {
        let run = self.run(RunOptions::new());
        async move {
            let code = run.await;
            crate::host::real::process_exiting(i32::from(code.get()));
            code.into()
        }
    }

    /// Runs the Command at `path` of the graph for the captured build, with named values in place of
    /// argv, and captures what it writes: `output` is stdout and `messages` stderr, both plain
    /// text, on a host with no argv, an empty stdin, and no terminal. It reads its facts from
    /// `process`, or the real process's handle, and makes no process effect: it keeps core
    /// listening for no signal, writes no exit code, and touches no real stream. It reuses the
    /// graph and runs its own validation, as `run` does.
    pub async fn invoke<M: Send + 'static>(
        &self,
        path: &[&str],
        values: InvocationValues,
        options: InvokeOptions<M>,
        process: Option<Arc<dyn ProcessHandle>>,
    ) -> InvocationOutcome<M> {
        crate::invocation::run::invoke(
            &self.declaration,
            &self.graphs,
            path,
            values,
            options,
            process,
        )
        .await
    }

    /// Returns the shared graph of the baked build, building it on the first successful call
    /// that needs it. The graph has the same identity as the one actions read in that build.
    pub fn inspect(&self) -> Result<Arc<crate::inspection::CommandGraph>, DeclarationError> {
        self.graphs
            .get(&self.declaration, &crate::shipping::ReleaseFacts::baked())
    }

    /// Builds a fresh graph and returns the build fault, if any. Once the graph is built,
    /// returns every fault reported by `on_graph_built` hooks.
    ///
    /// The run validates declared defaults and implied values against its own host.
    #[must_use]
    pub fn check(&self) -> Vec<DeclarationError> {
        crate::inspection::build::check(&self.declaration)
    }
}

impl<I, R, S> Application<I, R, S> {
    /// The declaration to change: this value's own, or a copy when another value shares it.
    fn declared(&mut self) -> &mut declaration::ApplicationDeclaration {
        self.graphs = Arc::default();
        Arc::make_mut(&mut self.declaration)
    }

    /// The same declaration in another authoring state or with other types.
    fn retyped<J, Q, T>(self) -> Application<J, Q, T> {
        Application {
            declaration: self.declaration,
            graphs: self.graphs,
            _types: PhantomData,
        }
    }
}

use crate::commands::declaration::raise;

/// How `run` runs: the process handle, a rendering policy override, the caller's signal, and, for a
/// test, substituted provider openers.
#[derive(Clone, Default)]
#[must_use]
pub struct RunOptions {
    pub(crate) process: Option<Arc<dyn ProcessHandle>>,
    pub(crate) rendering: Option<RenderingPolicy>,
    pub(crate) signal: Option<CancellationToken>,
    pub(crate) substitutes: Vec<AnyProvider>,
    /// Whoever observes the run's progress events: nothing under `run()`, a test through
    /// `__private::observe_progress`.
    pub(crate) progress: Option<crate::output::emit::ProgressObserver>,
}

impl RunOptions {
    /// The real process, the declared policy, and no caller signal.
    pub fn new() -> Self {
        Self::default()
    }

    /// Runs on this process handle.
    pub fn process(mut self, process: Arc<dyn ProcessHandle>) -> Self {
        self.process = Some(process);
        self
    }

    /// Overrides fields of the application's rendering policy.
    pub fn rendering(mut self, policy: RenderingPolicy) -> Self {
        self.rendering = Some(policy);
        self
    }

    /// Cancels the run when `signal` is cancelled, with the reason `caller`.
    pub fn signal(mut self, signal: CancellationToken) -> Self {
        self.signal = Some(signal);
        self
    }

    /// Builds `provider`'s value with `opener` in place of its own, for every run inside this one:
    /// the Rust counterpart of the reference's module mocking of an opener, for a test that runs a
    /// Command which uses a provider. The provider keeps its name, lifetime, `uses`, and `close`.
    pub fn substitute<V, L, H, Fut>(mut self, provider: &Provider<V, L>, opener: H) -> Self
    where
        V: Send + Sync + 'static,
        L: Lifetime,
        H: Fn(ProviderContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<V, crate::Error>> + Send + 'static,
    {
        self.substitutes.push(provider.substituted(opener));
        self
    }
}
