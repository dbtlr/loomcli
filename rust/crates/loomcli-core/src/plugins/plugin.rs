//! The plugin builder.
//!
//! Every call judges the rules its own contribution carries and panics at the author's line with
//! the fault's Developer Diagnostic, as an authoring call does; the rules that pair two plugins, or
//! a plugin and the application, are judged where `Application::plugins` installs the list.

use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use crate::commands::AnyCommand;
use crate::commands::declaration::{CommandDeclaration, OptionInput, option_extensions, raise};
use crate::diagnostics::{DiagnosticParts, Finding, Literal, rules};
use crate::failures::messages::{mid_sentence, quoted};
use crate::failures::{DeclarationError, Failure, FailureEncoding, Translation};
use crate::inputs::table::{self, InputSite, ScopeOption, check_option_config, check_option_name};
use crate::inputs::{
    DeclarationCall, GlobalInputs, GlobalOptionDecl, Inputs, NoInputs, OptionDecl,
};
use crate::inspection::CommandGraph;
use crate::invocation::{IntoOutcome, Outcome};
use crate::output::{LogDestination, LogEvent, LogHook, ViewContribution};
use crate::style::ThemeMapping;
use crate::support::{BoxFuture, IntoList};

use super::extension::{ExtensionSubject, admit_descriptor, values_literal};
use super::{
    AnyExtension, AttachedCommand, ConfigurationSource, EnvironmentAdditions, EnvironmentContext,
    FailureHookContext, Hints, IntoHints, MiddlewareContext, Next,
};

/// The options of a plugin that declares none typed.
pub type NoOptions = NoInputs;

/// What activates a plugin's middleware. There is no default.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Activation {
    /// Every invocation that reaches the chain.
    Always,
    /// An invocation in which any of these plugin options is present: supplied as a token or filled
    /// by an input source, whatever its value. A declared default activates nothing.
    Options(Vec<String>),
}

impl Activation {
    /// Activation by the plugin's own options, by declared name. A name the plugin has not declared
    /// by the `middleware` call is a fault at that call, under `plugin-option-name`.
    pub fn options(names: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Activation::Options(names.into_iter().map(Into::into).collect())
    }
}

/// A plugin's middleware as installation stores it: what activates it, and its handler with the
/// plugin's options type erased, which reads the options back as that type for each call.
#[derive(Clone)]
pub(crate) struct StoredMiddleware {
    pub(crate) activation: Activation,
    pub(crate) handler: MiddlewareHandler,
}

/// A middleware with its plugin's options type erased: it builds the typed context from the call.
pub(crate) type MiddlewareHandler =
    Arc<dyn Fn(super::middleware::ChainCall, Next) -> BoxFuture<'static, Outcome> + Send + Sync>;

/// An `on_command_attach` hook.
pub(crate) type AttachHook =
    Arc<dyn Fn(&mut AttachedCommand) -> Result<(), crate::Error> + Send + Sync>;

/// An `on_graph_built` hook.
pub(crate) type GraphHook = Arc<dyn Fn(&CommandGraph) -> Result<(), crate::Error> + Send + Sync>;

/// An `on_failure` hook: its hint lines, or its failure.
pub(crate) type FailureHook =
    Arc<dyn Fn(&dyn Failure, &FailureHookContext) -> Result<Hints, crate::Error> + Send + Sync>;

/// An `on_environment` hook.
pub(crate) type EnvironmentHook = Arc<
    dyn Fn(EnvironmentContext) -> BoxFuture<'static, Result<EnvironmentAdditions, crate::Error>>
        + Send
        + Sync,
>;

/// A plugin: the contributions one crate makes to an Application, built from its identity.
///
/// `O` is the plugin's options struct, which its middleware and source read typed. Building the
/// value runs none of its code: hooks run at graph build or when the run reaches them, and the
/// middleware runs inside an invocation whose activation matched.
///
/// ```
/// use loomcli_core::{Activation, Application, Context, MiddlewareContext, NoOptions, Opt, Plugin};
///
/// fn timing() -> Plugin {
///     Plugin::new("@acme/timing")
///         .option("time", Opt::boolean())
///         .middleware(
///             Activation::options(["time"]),
///             |ctx: MiddlewareContext<NoOptions>, next| async move {
///                 next.run().await?;
///                 ctx.out.info("Timed.").await
///             },
///         )
/// }
///
/// let app = Application::new("app")
///     .plugins([timing()])
///     .action(|_: Context| async { Ok(()) });
/// assert_eq!(app.inspect().unwrap().globals[0].name(), "time");
/// ```
#[must_use]
pub struct Plugin<O = NoOptions> {
    pub(crate) inner: crate::__private::PluginState,
    pub(crate) _options: PhantomData<fn() -> O>,
}

/// The receiver every finding about a plugin's own calls prints: `Plugin::new("@acme/log")`.
pub(crate) fn plugin_receiver(identity: &str) -> String {
    format!("Plugin::new({})", Literal::from(identity))
}

/// How a sentence opens when it names one plugin.
pub(crate) fn plugin_sentence(identity: &str) -> String {
    format!("Plugin {}", quoted(identity))
}

/// Where one of a plugin's own options was declared: its `option()` call on the plugin.
pub(crate) fn plugin_option_site(identity: &str, name: &str, decl: &OptionDecl) -> InputSite {
    InputSite {
        call: "option",
        receiver: Some(plugin_receiver(identity)),
        path: Vec::new(),
        name: name.to_owned(),
        config: decl.literal(),
        subject: format!("{} option {}", plugin_sentence(identity), quoted(name)),
    }
}

/// The plugin's options as one scope: two options of one plugin meet in the global table every
/// Command's table holds, so they share its rules: one key, one owner per spelling, and each
/// variable bound once.
fn check_own_options(identity: &str, options: &[OptionInput]) -> Result<(), DeclarationError> {
    let scope: Vec<ScopeOption<'_>> = options
        .iter()
        .map(|option| ScopeOption {
            name: &option.name,
            decl: &option.decl,
            site: plugin_option_site(identity, &option.name, &option.decl),
        })
        .collect();
    table::compile(&scope, &format!("plugin {}", quoted(identity)))?;
    let bound = table::bound_variables(&scope, |option| {
        format!("plugin {} option {}", quoted(identity), quoted(option.name))
    });
    table::claim_variables(&[], bound)
}

/// The finding that marks entry `index` of a list one of the plugin's calls holds.
fn entry_finding(identity: &str, call: &str, count: usize, index: usize) -> Finding {
    Finding::new(
        format!("{}.{call}", plugin_receiver(identity)),
        vec![values_literal(count)],
    )
    .mark(format!("0.{index}"))
}

/// The `plugin-option-name` fault of a call that names an option the plugin has not declared.
fn unknown_option(identity: &str, finding: Finding, clause: &str, name: &str) -> DeclarationError {
    DeclarationError::new(
        rules::PLUGIN_OPTION_NAME,
        DiagnosticParts::new(format!(
            "{} {clause} option {}, which the plugin does not declare.",
            plugin_sentence(identity),
            quoted(name)
        ))
        .finding(finding)
        .correction("Declare the option on the plugin before the call that names it."),
    )
}

impl crate::__private::PluginState {
    fn new(identity: String) -> Self {
        Self {
            identity,
            options: Vec::new(),
            descriptors: Default::default(),
            middleware: None,
            on_command_attach: None,
            on_graph_built: None,
            on_failure: None,
            on_log: None,
            on_environment: None,
            views: Vec::new(),
            translators: Vec::new(),
            failure_encoders: Vec::new(),
            source: None,
            theme: None,
            commands: Vec::new(),
        }
    }

    /// One global option of the plugin: its name, its builder's own facts, its extension values,
    /// and the plugin's options as one scope with it.
    fn declare_option(&mut self, name: &str, decl: OptionDecl) -> Result<(), DeclarationError> {
        let site = plugin_option_site(&self.identity, name, &decl);
        check_option_name(name, &site)?;
        check_option_config(
            &ScopeOption {
                name,
                decl: &decl,
                site: site.clone(),
            },
            true,
        )?;
        let mut registry = self.descriptors.clone();
        let extensions = option_extensions(
            &decl,
            &mut registry,
            &site,
            ExtensionSubject {
                phrase: format!("on {}", mid_sentence(&site.subject)),
                sentence: site.subject.clone(),
            },
        )?;
        let mut options = self.options.clone();
        options.push(OptionInput {
            name: name.to_owned(),
            decl,
            extensions,
        });
        check_own_options(&self.identity, &options)?;
        self.descriptors = registry;
        self.options = options;
        Ok(())
    }

    /// One call of a `GlobalInputs` struct's declarations, applied as `option()`. A hand-written
    /// impl can still list an input no global option can be, which is `option-config` here.
    fn declare_call(&mut self, call: DeclarationCall) -> Result<(), DeclarationError> {
        let receiver = plugin_receiver(&self.identity);
        let (sentence, finding) = match call {
            DeclarationCall::Option(name, OptionDecl::Content(content)) => (
                format!(
                    "{} option {} is a content option, which stays local to its Command.",
                    plugin_sentence(&self.identity),
                    quoted(&name)
                ),
                Finding::new(
                    format!("{receiver}.option"),
                    vec![name.as_str().into(), OptionDecl::Content(content).literal()],
                )
                .mark("1"),
            ),
            DeclarationCall::Option(name, decl) => return self.declare_option(&name, decl),
            DeclarationCall::Argument(name, decl) => (
                format!(
                    "Plugin options declare argument {}, which only a Command takes.",
                    quoted(&name)
                ),
                Finding::new(
                    format!("{receiver}.argument"),
                    vec![name.as_str().into(), decl.literal()],
                )
                .mark("0"),
            ),
            DeclarationCall::Stdin(stdin) => (
                "Plugin options declare stdin, which only a Command reads.".to_owned(),
                Finding::new(format!("{receiver}.stdin"), vec![stdin.literal()]).mark("0"),
            ),
            DeclarationCall::Group(_, names) => (
                "Plugin options declare an option group, which only a Command declares.".to_owned(),
                Finding::new(format!("{receiver}.exclusive"), vec![Literal::from(names)]).mark("0"),
            ),
        };
        Err(DeclarationError::new(
            rules::OPTION_CONFIG,
            DiagnosticParts::new(sentence)
                .finding(finding)
                .correction("Declare it on the Command with inputs::<I>() instead."),
        ))
    }

    /// Adjusts the declaration of the plugin's option `name` with `adjust`, then judges it as the
    /// declaring call did.
    fn adjust_option(
        &mut self,
        name: &str,
        finding: Finding,
        clause: &str,
        adjust: impl FnOnce(&mut OptionDecl),
    ) -> Result<(), DeclarationError> {
        let Some(index) = self.options.iter().position(|option| option.name == name) else {
            return Err(unknown_option(&self.identity, finding, clause, name));
        };
        let mut options = self.options.clone();
        if let Some(option) = options.get_mut(index) {
            adjust(&mut option.decl);
            check_option_config(
                &ScopeOption {
                    name,
                    decl: &option.decl,
                    site: plugin_option_site(&self.identity, name, &option.decl),
                },
                true,
            )?;
        }
        check_own_options(&self.identity, &options)?;
        self.options = options;
        Ok(())
    }

    /// The middleware's activation, whose names are the plugin's own options.
    /// The `handler-registered-twice` fault when `taken`: the plugin already holds the handler the
    /// `call` setter registers.
    fn check_vacant(&self, taken: bool, call: &str) -> Result<(), DeclarationError> {
        if !taken {
            return Ok(());
        }
        let finding = Finding::new(
            format!("{}.{call}", plugin_receiver(&self.identity)),
            vec![Literal::Opaque],
        )
        .mark("0");
        Err(DeclarationError::new(
            rules::HANDLER_REGISTERED_TWICE,
            DiagnosticParts::new(format!(
                "Plugin {} registers {call} twice.",
                quoted(&self.identity)
            ))
            .finding(finding)
            .correction("Register it once, and do every concern's work in that one handler."),
        ))
    }

    fn check_activation(&self, activation: &Activation) -> Result<(), DeclarationError> {
        let Activation::Options(names) = activation else {
            return Ok(());
        };
        for (index, name) in names.iter().enumerate() {
            if !self.options.iter().any(|option| &option.name == name) {
                let names: Vec<Literal> = names.iter().map(|name| name.as_str().into()).collect();
                let finding = Finding::new(
                    format!("{}.middleware", plugin_receiver(&self.identity)),
                    vec![
                        Literal::builder(format!("Activation::options({})", Literal::List(names))),
                        Literal::Opaque,
                    ],
                )
                .mark("0")
                .note(format!("entry {index} names {}", quoted(name)));
                return Err(unknown_option(
                    &self.identity,
                    finding,
                    "activates its middleware on",
                    name,
                ));
            }
        }
        Ok(())
    }

    /// The descriptors the plugin defines, each admitted against those it already holds.
    fn define_extensions(
        &mut self,
        descriptors: Vec<AnyExtension>,
    ) -> Result<(), DeclarationError> {
        let mut registry = self.descriptors.clone();
        let count = descriptors.len();
        for (index, descriptor) in descriptors.iter().enumerate() {
            let place = entry_finding(&self.identity, "extensions", count, index);
            admit_descriptor(&mut registry, descriptor, Some(place))?;
        }
        self.descriptors = registry;
        Ok(())
    }

    /// The views list: every identity names one declared view, core's included.
    fn add_views(&mut self, views: Vec<ViewContribution>) -> Result<(), DeclarationError> {
        let mut listed = self.views.clone();
        listed.extend(views);
        let count = listed.len();
        let identity = self.identity.clone();
        crate::output::registry::check_contributions(&[], &listed, |index| {
            entry_finding(&identity, "views", count, index)
        })?;
        self.views = listed;
        Ok(())
    }

    /// The failure encoders: one per media type.
    fn add_encoders(&mut self, encoders: Vec<FailureEncoding>) -> Result<(), DeclarationError> {
        let mut listed = self.failure_encoders.clone();
        listed.extend(encoders);
        let count = listed.len();
        for (index, encoding) in listed.iter().enumerate() {
            let Some(first) = listed[..index]
                .iter()
                .position(|earlier| earlier.media_type == encoding.media_type)
            else {
                continue;
            };
            return Err(DeclarationError::new(
                rules::FAILURE_ENCODER_TAKEN,
                DiagnosticParts::new(format!(
                    "{} registers two failure encoders for {}.",
                    plugin_sentence(&self.identity),
                    quoted(&encoding.media_type)
                ))
                .finding(
                    entry_finding(&self.identity, "failure_encoders", count, first)
                        .note("the first encoding"),
                )
                .finding(
                    entry_finding(&self.identity, "failure_encoders", count, index)
                        .note("the second encoding"),
                )
                .correction("Register one."),
            ));
        }
        self.failure_encoders = listed;
        Ok(())
    }

    /// The Commands the plugin attaches to the root, each judged by the attach the root applies,
    /// as a finished Command and against the plugin's own earlier Commands.
    fn add_commands(&mut self, commands: Vec<AnyCommand>) -> Result<(), DeclarationError> {
        let mut root = CommandDeclaration {
            children: self.commands.clone(),
            ..CommandDeclaration::default()
        };
        for command in commands {
            root.attach(command.declaration)?;
        }
        self.commands = root.children;
        Ok(())
    }
}

impl Plugin<NoOptions> {
    /// A plugin with this identity: the crate's package name, or `<package>/<plugin>` for a crate
    /// that ships several. Core compares identities by equality.
    pub fn new(identity: impl Into<String>) -> Self {
        Plugin {
            inner: crate::__private::PluginState::new(identity.into()),
            _options: PhantomData,
        }
    }

    /// Declares the plugin's global options from an inputs struct; its middleware and source read
    /// them typed. A struct that cannot be global options does not implement [`GlobalInputs`], a
    /// compile error at this call. The application's settings reach these declarations through
    /// [`Plugin::short`] and [`Plugin::env`].
    #[track_caller]
    pub fn options<P: GlobalInputs>(self) -> Plugin<P> {
        let mut inner = self.inner;
        for call in P::declare(crate::inputs::Declarations::new()).calls {
            raise(inner.declare_call(call));
        }
        Plugin {
            inner,
            _options: PhantomData,
        }
    }
}

impl<O: Inputs> Plugin<O> {
    /// Declares one global option by name.
    #[track_caller]
    pub fn option(self, name: &str, option: impl Into<GlobalOptionDecl>) -> Self {
        let mut plugin = self;
        raise(plugin.inner.declare_option(name, option.into().0));
        plugin
    }

    /// Gives the plugin's option `name` the short spelling `letter`: how a factory applies the
    /// application's `short` setting to an option it declared, typed or by name. The adjusted
    /// declaration meets every rule the declaring call meets. A name the plugin has not declared is
    /// a fault at this call, under `plugin-option-name`.
    #[track_caller]
    pub fn short(self, name: &str, letter: char) -> Self {
        let mut plugin = self;
        let finding = Finding::new(
            format!("{}.short", plugin_receiver(&plugin.inner.identity)),
            vec![name.into(), letter.into()],
        )
        .mark("0");
        raise(
            plugin
                .inner
                .adjust_option(name, finding, "sets a short spelling on", |decl| {
                    decl.facts_mut().short = Some(letter);
                }),
        );
        plugin
    }

    /// Binds the plugin's option `name` to these environment variables: how a factory applies the
    /// application's `env` setting. The rules are the declaring call's, and a name the plugin has
    /// not declared is a fault at this call, under `plugin-option-name`.
    #[track_caller]
    pub fn env(self, name: &str, variables: impl IntoIterator<Item = impl Into<String>>) -> Self {
        let mut plugin = self;
        let variables: Vec<String> = variables.into_iter().map(Into::into).collect();
        let finding = Finding::new(
            format!("{}.env", plugin_receiver(&plugin.inner.identity)),
            vec![
                name.into(),
                Literal::List(
                    variables
                        .iter()
                        .map(|variable| variable.as_str().into())
                        .collect(),
                ),
            ],
        )
        .mark("0");
        raise(plugin.inner.adjust_option(
            name,
            finding,
            "binds environment variables to",
            |decl| {
                decl.facts_mut().env = variables;
            },
        ));
        plugin
    }

    /// Registers the middleware and what activates it. A plugin holds one middleware, and one
    /// handler for each hook: a second registration of any of them panics at the call under
    /// `handler-registered-twice`.
    #[track_caller]
    pub fn middleware<H, Fut>(self, activation: Activation, handler: H) -> Self
    where
        H: Fn(MiddlewareContext<O>, Next) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Outcome> + Send + 'static,
    {
        let mut plugin = self;
        raise(
            plugin
                .inner
                .check_vacant(plugin.inner.middleware.is_some(), "middleware"),
        );
        raise(plugin.inner.check_activation(&activation));
        let handler: MiddlewareHandler =
            Arc::new(move |call, next| Box::pin(handler(MiddlewareContext::<O>::of(call), next)));
        plugin.inner.middleware = Some(StoredMiddleware {
            activation,
            handler,
        });
        plugin
    }

    /// Registers the hook core calls once per Command, root first, depth first, at graph build.
    ///
    /// The hook edits the Command in place and returns `Ok(())`. An `Err` is a build fault: a
    /// `DeclarationError`, such as one a call returned, reports as itself, and any other error is
    /// `broken-attach-hook`, naming the plugin and the Command and keeping the error as its cause.
    /// Every build fault renders by build with exit 1, the generic message in a distributed build.
    #[track_caller]
    pub fn on_command_attach(
        self,
        hook: impl Fn(&mut AttachedCommand) -> Result<(), crate::Error> + Send + Sync + 'static,
    ) -> Self {
        let mut plugin = self;
        raise(plugin.inner.check_vacant(
            plugin.inner.on_command_attach.is_some(),
            "on_command_attach",
        ));
        plugin.inner.on_command_attach = Some(Arc::new(hook));
        plugin
    }

    /// Registers the hook that judges the built graph. It returns a `DeclarationError` to reject
    /// the graph, which reports as itself; any other error is `broken-graph-hook`, naming the plugin.
    #[track_caller]
    pub fn on_graph_built(
        self,
        hook: impl Fn(&CommandGraph) -> Result<(), crate::Error> + Send + Sync + 'static,
    ) -> Self {
        let mut plugin = self;
        raise(
            plugin
                .inner
                .check_vacant(plugin.inner.on_graph_built.is_some(), "on_graph_built"),
        );
        plugin.inner.on_graph_built = Some(Arc::new(hook));
        plugin
    }

    /// Registers the hook that adds hint lines below a failure's report.
    ///
    /// Core boxes each reported failure once and moves it no more until its report is written, so
    /// every hook and then the failure's view receive the same `&dyn Failure` at one address; a
    /// plugin that correlates the two, as suggestions does, keys on that address
    /// (`std::ptr::addr_of!(*failure)`) within one report.
    #[track_caller]
    pub fn on_failure<H: IntoHints>(
        self,
        hook: impl Fn(&dyn Failure, &FailureHookContext) -> H + Send + Sync + 'static,
    ) -> Self {
        let mut plugin = self;
        raise(
            plugin
                .inner
                .check_vacant(plugin.inner.on_failure.is_some(), "on_failure"),
        );
        plugin.inner.on_failure = Some(Arc::new(move |failure, context| {
            hook(failure, context).into_hints()
        }));
        plugin
    }

    /// Registers the hook that observes each log event of a run. It returns `()` or a
    /// `Result<(), E>`; a failing hook stays installed, and core reports the run's first such
    /// failure once, after every other report, as a `foreign-throw` defect.
    #[track_caller]
    pub fn on_log<T: IntoOutcome>(
        self,
        hook: impl Fn(&LogEvent, &LogDestination) -> T + Send + Sync + 'static,
    ) -> Self {
        let mut plugin = self;
        raise(
            plugin
                .inner
                .check_vacant(plugin.inner.on_log.is_some(), "on_log"),
        );
        let hook: LogHook =
            Arc::new(move |event, destination| hook(event, destination).into_outcome());
        plugin.inner.on_log = Some(hook);
        plugin
    }

    /// Registers the hook that adds environment variables before any input validates, once per
    /// outer run, in installation order.
    #[track_caller]
    pub fn on_environment<H, Fut>(self, hook: H) -> Self
    where
        H: Fn(EnvironmentContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<EnvironmentAdditions, crate::Error>> + Send + 'static,
    {
        let mut plugin = self;
        raise(
            plugin
                .inner
                .check_vacant(plugin.inner.on_environment.is_some(), "on_environment"),
        );
        plugin.inner.on_environment = Some(Arc::new(move |context| Box::pin(hook(context))));
        plugin
    }

    /// Lists the extension descriptors the plugin defines.
    #[track_caller]
    pub fn extensions(self, descriptors: impl IntoList<AnyExtension>) -> Self {
        let mut plugin = self;
        raise(plugin.inner.define_extensions(descriptors.into_list()));
        plugin
    }

    /// Lists the views the plugin declares and the overrides it makes.
    #[track_caller]
    pub fn views(self, views: impl IntoList<ViewContribution>) -> Self {
        let mut plugin = self;
        raise(plugin.inner.add_views(views.into_list()));
        plugin
    }

    /// Lists the plugin's translators.
    #[track_caller]
    pub fn translators(self, translations: impl IntoList<Translation>) -> Self {
        let mut plugin = self;
        plugin.inner.translators.extend(translations.into_list());
        plugin
    }

    /// Lists the plugin's failure encoders, one per media type.
    #[track_caller]
    pub fn failure_encoders(self, encoders: impl IntoList<FailureEncoding>) -> Self {
        let mut plugin = self;
        raise(plugin.inner.add_encoders(encoders.into_list()));
        plugin
    }

    /// Claims the single configuration-source slot. Core admits the binding's descriptor itself,
    /// so a binding the plugin does not also list under `extensions` works the same. A second call
    /// replaces the first claim.
    #[track_caller]
    pub fn source(self, source: ConfigurationSource<O>) -> Self {
        let mut plugin = self;
        let place = Finding::new(
            format!("{}.source", plugin_receiver(&plugin.inner.identity)),
            vec![Literal::Opaque],
        )
        .mark("0");
        let mut registry = plugin.inner.descriptors.clone();
        raise(admit_descriptor(
            &mut registry,
            &source.binding,
            Some(place),
        ));
        plugin.inner.descriptors = registry;
        plugin.inner.source = Some(source.claim(&plugin.inner.identity));
        plugin
    }

    /// Claims the single theme slot. A mapping whose value is a chain that names a semantic token
    /// panics at this call with the style error, as the reference's `plugin()` throws it. A second
    /// call replaces the first claim.
    #[track_caller]
    pub fn theme(self, theme: ThemeMapping) -> Self {
        let mut plugin = self;
        match crate::style::Theme::build(&theme) {
            Ok(built) => plugin.inner.theme = Some(built),
            Err(error) => panic!("{error}"),
        }
        plugin
    }

    /// Lists the Commands the plugin attaches to the root, ahead of the application's own.
    #[track_caller]
    pub fn commands(self, commands: impl IntoList<AnyCommand>) -> Self {
        let mut plugin = self;
        raise(plugin.inner.add_commands(commands.into_list()));
        plugin
    }

    /// The plugin's identity.
    #[must_use]
    pub fn identity(&self) -> &str {
        &self.inner.identity
    }
}

/// A plugin with its options type erased, as an Application's `plugins` list holds it.
pub struct AnyPlugin {
    pub(crate) inner: crate::__private::PluginState,
}

impl<O> From<Plugin<O>> for AnyPlugin {
    fn from(plugin: Plugin<O>) -> Self {
        AnyPlugin {
            inner: plugin.inner,
        }
    }
}
