//! Items the derive macros and `loomcli-testing` reach. Not part of the public contract.

pub mod unit;

/// The phantom marker a declaration carries its type parameters in, without owning them.
pub type Types<A, B, C> = std::marker::PhantomData<fn() -> (A, B, C)>;

/// A shared render function over `D` with context `X`; an `Err` is the view's failure.
pub type RenderFn<D, X> =
    std::sync::Arc<dyn Fn(&D, &X) -> Result<String, crate::Error> + Send + Sync>;

/// One validated input value with its type erased.
#[derive(Clone)]
pub enum RawValue {
    /// The input was omitted and has no default.
    Absent,
    /// One value.
    One(std::sync::Arc<dyn std::any::Any + Send + Sync>),
    /// Several values.
    Many(Vec<std::sync::Arc<dyn std::any::Any + Send + Sync>>),
    /// A Boolean option's value.
    Flag(bool),
    /// A counted option's count.
    Count(u32),
}

/// The state one run shares between its context, output, log, and chain: the run's host, its
/// output, and its log events.
pub struct RunState {
    pub(crate) host: std::sync::Arc<crate::host::Host>,
    pub(crate) output: std::sync::Arc<crate::output::emit::Output>,
    pub(crate) log: std::sync::Arc<crate::output::RunLog>,
    /// The run's place in its signal source's lane, which its contexts' shutdown, suspend, and
    /// resume handlers join.
    pub(crate) place: crate::signals::lane::Place,
    /// What an action's call reuses of the run, once routing reached the chain.
    pub(crate) calls: Option<std::sync::Arc<crate::invocation::run::CallScope>>,
}

impl RunState {
    /// What receives a run-scoped handler's panic: an `error` log event, `sentence`, with the panic
    /// message under `error`, naming `plugin`, or none for an action's. A handler that runs after
    /// the run's state is gone has nowhere to report.
    pub(crate) fn handler_failed(
        self: &std::sync::Arc<Self>,
        plugin: Option<std::sync::Arc<str>>,
        sentence: &'static str,
    ) -> crate::signals::lane::Failed {
        let run = std::sync::Arc::downgrade(self);
        std::sync::Arc::new(move |message: String| {
            if let Some(run) = run.upgrade() {
                let log = crate::output::Log {
                    run,
                    plugin: plugin.clone(),
                };
                log.error(
                    sentence,
                    crate::output::LogFields::new().field("error", message),
                );
            }
        })
    }

    /// Registers a shutdown handler on the run's place, its panic logged naming `plugin`.
    pub(crate) fn on_shutdown(
        self: &std::sync::Arc<Self>,
        plugin: Option<std::sync::Arc<str>>,
        handler: impl FnOnce(crate::signals::ShutdownEvent) + Send + 'static,
    ) -> crate::signals::Registration {
        self.place.on_shutdown(
            Box::new(handler),
            Some(self.handler_failed(plugin, crate::messages::SHUTDOWN_HANDLER_FAILED)),
        )
    }

    /// Registers a suspend handler on the run's place, its panic logged naming `plugin`.
    pub(crate) fn on_suspend(
        self: &std::sync::Arc<Self>,
        plugin: Option<std::sync::Arc<str>>,
        handler: impl Fn() + Send + Sync + 'static,
    ) -> crate::signals::Registration {
        self.place.on_suspend(
            std::sync::Arc::new(handler),
            Some(self.handler_failed(plugin, crate::messages::SUSPEND_HANDLER_FAILED)),
        )
    }

    /// Registers a resume handler on the run's place, its panic logged naming `plugin`.
    pub(crate) fn on_resume(
        self: &std::sync::Arc<Self>,
        plugin: Option<std::sync::Arc<str>>,
        handler: impl Fn() + Send + Sync + 'static,
    ) -> crate::signals::Registration {
        self.place.on_resume(
            std::sync::Arc::new(handler),
            Some(self.handler_failed(plugin, crate::messages::RESUME_HANDLER_FAILED)),
        )
    }
}

/// The built graph behind an inspected graph, which the parser and `locate` read: the declarations
/// it was built from, and the grammar each Command's words are read with.
pub struct GraphLink {
    pub(crate) application: std::sync::Arc<crate::application::declaration::ApplicationDeclaration>,
    pub(crate) grammar: crate::invocation::parse::Grammar,
}

impl std::fmt::Debug for GraphLink {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("GraphLink").finish_non_exhaustive()
    }
}

// Two graphs compare by their published data; the link is how a graph was built, not what it says.
impl PartialEq for GraphLink {
    fn eq(&self, _other: &Self) -> bool {
        true
    }
}

/// Where `out.render` writes: the run's output and the destination of the caller's channel.
pub struct RenderSite<'a> {
    pub(crate) output: std::sync::Arc<crate::output::emit::Output>,
    pub(crate) destination: crate::output::emit::Stream,
    pub(crate) _call: std::marker::PhantomData<&'a ()>,
}

impl RenderSite<'_> {
    /// A whole view rendered now, its function resolved through the registry, and the write of its
    /// text, which waits for its turn on the destination.
    pub(crate) fn whole<D: ?Sized + 'static>(
        &self,
        identity: Option<&str>,
        view: &crate::View<D>,
        data: &D,
    ) -> Prepared {
        let rendered = self
            .output
            .render_whole(self.destination, identity, view, data);
        let output = std::sync::Arc::clone(&self.output);
        let destination = self.destination;
        Prepared(Box::pin(async move {
            output.write(destination, rendered?).await
        }))
    }

    /// A sequence through a row view the registry resolves, written as its source yields.
    pub(crate) fn rows<R: Send + 'static>(
        &self,
        identity: Option<&str>,
        view: &crate::RowView<R>,
        source: crate::RowSource<R>,
    ) -> Prepared {
        let view = self.output.resolve_rows(identity, view);
        let output = std::sync::Arc::clone(&self.output);
        let destination = self.destination;
        Prepared(Box::pin(async move {
            output
                .sequence(
                    destination,
                    source,
                    crate::output::emit::SequenceView::Rows(view),
                    Ok,
                )
                .await
        }))
    }
}

/// A view and its data, prepared for `out.render`: the write that remains.
pub struct Prepared(pub(crate) futures_core::future::BoxFuture<'static, Result<(), crate::Error>>);

/// What a stored action receives: the run's context without its typed inputs, and the validated
/// values of the routed Command the inputs struct is extracted from.
pub struct ActionCall {
    pub(crate) context: crate::invocation::Context,
    pub(crate) values: crate::inputs::InputValues,
}

/// A provider with its value type erased: name, value type, opener type, lifetime, uses, opener,
/// and close.
#[derive(Clone)]
pub struct ErasedProvider {
    pub(crate) name: std::sync::Arc<str>,
    pub(crate) value_type: std::any::TypeId,
    pub(crate) opener_type: std::any::TypeId,
    pub(crate) persistent: bool,
    pub(crate) uses: Vec<crate::plugins::AnyProvider>,
    pub(crate) open: crate::plugins::provider::ErasedOpen,
    pub(crate) close: Option<crate::plugins::provider::ErasedClose>,
}

/// A plugin's collected contributions, each judged on its own at the call that made it.
#[derive(Clone)]
pub struct PluginState {
    /// The plugin's identity.
    pub(crate) identity: String,
    /// The plugin's own global options, in declaration order.
    pub(crate) options: Vec<crate::commands::declaration::OptionInput>,
    /// Every descriptor the plugin defines, its options' values name, or its source binds.
    pub(crate) descriptors: crate::plugins::extension::DescriptorRegistry,
    pub(crate) middleware: Option<crate::plugins::plugin::StoredMiddleware>,
    pub(crate) on_command_attach: Option<crate::plugins::plugin::AttachHook>,
    pub(crate) on_graph_built: Option<crate::plugins::plugin::GraphHook>,
    pub(crate) on_failure: Option<crate::plugins::plugin::FailureHook>,
    pub(crate) on_log: Option<crate::output::LogHook>,
    pub(crate) on_environment: Option<crate::plugins::plugin::EnvironmentHook>,
    /// The views it declares and the overrides it makes, in list order.
    pub(crate) views: Vec<crate::output::ViewContribution>,
    pub(crate) translators: Vec<crate::failures::Translation>,
    pub(crate) failure_encoders: Vec<crate::failures::FailureEncoding>,
    /// The configuration source it claims, with the schema the graph publishes for it.
    pub(crate) source: Option<crate::plugins::source::ClaimedSource>,
    /// The theme it claims, built and checked at the claim.
    pub(crate) theme: Option<crate::style::Theme>,
    /// The Commands it attaches to the root, in list order.
    pub(crate) commands: Vec<crate::commands::declaration::CommandDeclaration>,
}

/// The Command an attach hook is editing: its declaration without its children, where it sits,
/// the plugin whose hook is running, what the hooks declared so far, and its published extensions.
pub struct AttachedState {
    pub(crate) command: crate::commands::declaration::CommandDeclaration,
    pub(crate) path: Vec<String>,
    pub(crate) identity: String,
    pub(crate) hooked: Vec<crate::plugins::hooks::HookInput>,
    pub(crate) registry: crate::plugins::extension::DescriptorRegistry,
    pub(crate) record: serde_json::Map<String, serde_json::Value>,
    pub(crate) owners: ExtensionOwners,
    pub(crate) result: Option<crate::inspection::ResultNode>,
}

/// The descriptor that stored each identity of a node's extension record, which `read_extension`
/// compares with the descriptor it reads through.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExtensionOwners(pub(crate) std::sync::Arc<Vec<crate::plugins::AnyExtension>>);

impl ExtensionOwners {
    /// The descriptor that stored `identity`.
    pub(crate) fn owner(&self, identity: &str) -> Option<&crate::plugins::AnyExtension> {
        self.0.iter().find(|owner| owner.identity == identity)
    }
}

/// A `views()` call's record with its view types erased.
pub struct ViewsCall(pub(crate) crate::commands::declaration::ResultCall);

/// What a configuration source installed through [`install_source`] is asked: the claiming
/// plugin's own validated options, the node of each option to fill, the run's host and graph, and
/// how the run received its inputs. `Plugin::source` hands a plugin's resolver the typed
/// `SourceContext` instead.
#[non_exhaustive]
pub struct SourceProbe {
    /// The claiming plugin's own options, validated before the call.
    pub options: crate::inputs::InputValues,
    /// The node of each option the source is asked to fill, the globals first.
    pub requests: Vec<crate::inspection::OptionNode>,
    /// The run's host.
    pub host: std::sync::Arc<crate::host::Host>,
    /// The run's graph.
    pub graph: std::sync::Arc<crate::inspection::CommandGraph>,
    /// How the run received its inputs.
    pub invoked_by: crate::invocation::InvokedBy,
}

/// Installs a configuration source on an Application, the slot a plugin's `source` claims, so a
/// test reaches the input-source stage's configuration tier with untyped options and no plugin:
/// `binding` marks an option configuration-bound, `own` names the global options the source's
/// plugin declares, and `resolve` answers by option name.
pub fn install_source<I, R, S, B, H, Fut>(
    application: crate::Application<I, R, S>,
    plugin: &str,
    binding: &crate::plugins::Extension<crate::plugins::OptionTarget, B>,
    own: &[&str],
    resolve: H,
) -> crate::Application<I, R, S>
where
    B: 'static,
    H: Fn(SourceProbe) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<
            Output = Result<
                std::collections::BTreeMap<String, crate::plugins::SourceAnswer>,
                crate::Error,
            >,
        > + Send
        + 'static,
{
    let mut declaration =
        crate::application::declaration::ApplicationDeclaration::clone(&application.declaration);
    declaration.source = Some(crate::inputs::sources::SourceSlot {
        plugin: plugin.to_owned(),
        binding: binding.identity(),
        own: own.iter().map(|name| (*name).to_owned()).collect(),
        resolve: std::sync::Arc::new(move |call: crate::inputs::sources::SourceCall| {
            Box::pin(resolve(SourceProbe {
                options: call.options,
                requests: call.requests,
                host: call.host,
                graph: call.graph,
                invoked_by: call.invoked_by,
            }))
        }),
    });
    crate::Application {
        declaration: std::sync::Arc::new(declaration),
        graphs: std::sync::Arc::default(),
        _types: std::marker::PhantomData,
    }
}

/// Installs an `on_log` hook on an Application after every installed plugin's, the hook a plugin's
/// `on_log` registers, so a test observes the run's log events without a plugin. Hooks are called
/// in the order they were installed.
pub fn install_log_hook<I, R, S, T, H>(
    application: crate::Application<I, R, S>,
    hook: H,
) -> crate::Application<I, R, S>
where
    T: crate::IntoOutcome,
    H: Fn(&crate::LogEvent, &crate::LogDestination) -> T + Send + Sync + 'static,
{
    let mut declaration =
        crate::application::declaration::ApplicationDeclaration::clone(&application.declaration);
    declaration
        .log_hooks
        .push(std::sync::Arc::new(move |event, destination| {
            hook(event, destination).into_outcome()
        }));
    crate::Application {
        declaration: std::sync::Arc::new(declaration),
        graphs: std::sync::Arc::default(),
        _types: std::marker::PhantomData,
    }
}

/// Observes the progress events of the run these options start, as `invoke`'s `on_progress` does,
/// so a test reads a region's events through `run()`, where nothing observes them otherwise.
pub fn observe_progress(
    options: crate::RunOptions,
    observer: impl Fn(&crate::ProgressEvent) + Send + Sync + 'static,
) -> crate::RunOptions {
    crate::RunOptions {
        progress: Some(std::sync::Arc::new(observer)),
        ..options
    }
}
