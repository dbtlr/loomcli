//! What lifecycle hooks receive: the attached Command, the failure hook's context, and the
//! environment hook's context.

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::commands::declaration::{
    ArgumentInput, InputDeclaration, OptionInput, ResultCall, ResultCallKind, ViewEntry,
    input_extensions, local_site, option_extensions,
};
use crate::diagnostics::{DiagnosticParts, Finding, rules};
use crate::failures::DeclarationError;
use crate::failures::sentences::{command_sentence, command_subject, quoted};
use crate::host::Env;
use crate::inputs::table::{self, ScopeOption, check_option_config, check_option_name};
use crate::inputs::{ArgumentDecl, OptionDecl};
use crate::inspection::build::result_node;
use crate::inspection::{CommandGraph, CommandNode, OptionGroupKind, ResultNode};
use crate::invocation::InvokedBy;
use crate::output::{Log, Out, ResultView};
use crate::style::ContextualStyle;
use crate::support::is_declared_name;

use super::extension::{ExtensionSite, ExtensionSubject, validate_layer, values_literal};
use super::{CommandTarget, ExtensionValue};

/// A Command as an `on_command_attach` hook receives it: its facts to read, and the seven dynamic
/// builder calls the reference publishes, `argument`, `option`, `exclusive`, `one_required`,
/// `required_together`, `views`, and `extend`.
///
/// A hook receives `&mut AttachedCommand` and returns `Ok(())` to hand it back. Each call meets every
/// declaration rule at the call: a call that faults returns the `DeclarationError` and changes
/// nothing, so a hook either propagates it with `?`, which core reports as itself, a build fault,
/// or handles it and continues without the rejected declaration, as a reference hook that catches
/// the throw does. Core judges what a hook declared against every other declaration at graph build,
/// with the hook's plugin and the Command named. The authoring order the types enforce on an
/// author's own calls does not bind a hook.
pub struct AttachedCommand {
    pub(crate) inner: Box<crate::__private::AttachedState>,
}

/// One input a lifecycle hook declared: the plugin whose hook declared it, its name, and its kind.
#[derive(Clone, Debug)]
pub(crate) struct HookInput {
    pub(crate) identity: String,
    pub(crate) name: String,
    pub(crate) argument: bool,
}

impl AttachedCommand {
    /// The canonical name, or `None` for the root.
    #[must_use]
    pub fn name(&self) -> Option<&str> {
        self.inner.command.name.as_deref()
    }

    /// The route from the root.
    #[must_use]
    pub fn path(&self) -> &[String] {
        &self.inner.path
    }

    /// Whether the Command registered an action.
    #[must_use]
    pub fn has_action(&self) -> bool {
        self.inner.command.action.is_some()
    }

    /// The declared argument names, in order.
    #[must_use]
    pub fn arguments(&self) -> Vec<String> {
        self.inner
            .command
            .arguments()
            .map(|argument| argument.name.clone())
            .collect()
    }

    /// The declared local option names, in order.
    #[must_use]
    pub fn options(&self) -> Vec<String> {
        self.inner
            .command
            .options()
            .map(|option| option.name.clone())
            .collect()
    }

    /// The declared result, as `inspect()` publishes it, with the names earlier calls added.
    #[must_use]
    pub fn result(&self) -> Option<ResultNode> {
        self.inner.result.clone()
    }

    /// The extension record `inspect()` would publish for the Command at this hook: the author's
    /// layers, then every value an earlier hook or this hook's earlier `extend` calls added. Read a
    /// value typed through [`read_extension`](crate::read_extension).
    #[must_use]
    pub fn extensions(&self) -> &serde_json::Map<String, serde_json::Value> {
        &self.inner.record
    }

    /// The subject an input this hook declares is named by in a fault about its extension values.
    fn input_subject(&self, kind: &str, name: &str) -> ExtensionSubject {
        let command = self.inner.command.name.as_deref();
        ExtensionSubject {
            phrase: format!("on {} {kind} {}", command_subject(command), quoted(name)),
            sentence: format!("{} {kind} {}", command_sentence(command), quoted(name)),
        }
    }

    /// Records one input the running hook declared.
    fn record(&mut self, name: &str, argument: bool) {
        let identity = self.inner.identity.clone();
        self.inner.hooked.push(HookInput {
            identity,
            name: name.to_owned(),
            argument,
        });
    }

    /// Declares an argument.
    pub fn argument(
        &mut self,
        name: &str,
        argument: impl Into<ArgumentDecl>,
    ) -> Result<&mut Self, DeclarationError> {
        let decl = argument.into();
        let state = &self.inner;
        let command = state.command.name.as_deref();
        let site = local_site(command, &state.path, "argument", name, decl.literal());
        if !is_declared_name(name) {
            return Err(DeclarationError::new(
                rules::DECLARED_NAME,
                DiagnosticParts::new(format!(
                    "{} declares an argument named {}.",
                    command_sentence(command),
                    quoted(name)
                ))
                .finding(site.unread().named(None))
                .correction(table::DECLARED_NAME_CORRECTION),
            ));
        }
        if let Some((setter, reason)) = decl.config_conflict() {
            return Err(DeclarationError::new(
                rules::OPTION_CONFIG,
                DiagnosticParts::new(format!("Argument {} {reason}.", quoted(name)))
                    .finding(site.finding(&format!("1.{setter}")))
                    .correction("Remove the setter the argument kind or its other facts exclude."),
            ));
        }
        let mut registry = state.registry.clone();
        let extensions = input_extensions(
            decl.extensions(),
            &mut registry,
            &site,
            "1.extend.0",
            self.input_subject("argument", name),
        )?;
        self.inner.registry = registry;
        self.inner
            .command
            .inputs
            .push(InputDeclaration::Argument(ArgumentInput {
                name: name.to_owned(),
                decl,
                extensions,
            }));
        self.record(name, true);
        Ok(self)
    }

    /// Declares a local option. It is the hook's plugin's own option for `own_options`, but it
    /// activates nothing.
    pub fn option(
        &mut self,
        name: &str,
        option: impl Into<OptionDecl>,
    ) -> Result<&mut Self, DeclarationError> {
        let decl = option.into();
        let state = &self.inner;
        let site = local_site(
            state.command.name.as_deref(),
            &state.path,
            "option",
            name,
            decl.literal(),
        );
        check_option_name(name, &site)?;
        check_option_config(
            &ScopeOption {
                name,
                decl: &decl,
                site: site.clone(),
            },
            false,
        )?;
        let mut registry = state.registry.clone();
        let extensions = option_extensions(
            &decl,
            &mut registry,
            &site,
            self.input_subject("option", name),
        )?;
        self.inner.registry = registry;
        self.inner
            .command
            .inputs
            .push(InputDeclaration::Option(OptionInput {
                name: name.to_owned(),
                decl,
                extensions,
            }));
        self.record(name, false);
        Ok(self)
    }

    /// Declares that at most one of these local options is supplied. The group meets the
    /// `option-group` rule at the call, as an author's `exclusive` does: it names two or more
    /// options, each once, each a local option the Command declares at this call, the author's
    /// and every hook's so far. A call that faults returns its `DeclarationError` and adds no group.
    pub fn exclusive(&mut self, names: &[&str]) -> Result<&mut Self, DeclarationError> {
        self.group(OptionGroupKind::Exclusive, names)
    }

    /// Declares that at least one of these local options is supplied, under the rules
    /// [`exclusive`](Self::exclusive) states.
    pub fn one_required(&mut self, names: &[&str]) -> Result<&mut Self, DeclarationError> {
        self.group(OptionGroupKind::OneRequired, names)
    }

    /// Declares that these local options are supplied together or not at all, under the rules
    /// [`exclusive`](Self::exclusive) states.
    pub fn required_together(&mut self, names: &[&str]) -> Result<&mut Self, DeclarationError> {
        self.group(OptionGroupKind::RequiredTogether, names)
    }

    /// One option group, judged against the Command as the hook holds it.
    fn group(
        &mut self,
        kind: OptionGroupKind,
        names: &[&str],
    ) -> Result<&mut Self, DeclarationError> {
        self.inner.command.declare_group(kind, names)?;
        Ok(self)
    }

    /// Adds or replaces result views by name; the record names the default, as an author's
    /// `views()` record does.
    pub fn views(&mut self, replacements: AttachedViews) -> Result<&mut Self, DeclarationError> {
        let entries = replacements
            .views
            .into_iter()
            .map(|(key, view)| ViewEntry {
                key,
                media_type: view.media_type(),
                view: Arc::new(view),
            })
            .collect();
        self.inner.command.results.push(ResultCall {
            kind: ResultCallKind::Views,
            entries,
            default: replacements.default,
        });
        self.inner.result = result_node(&self.inner.command);
        Ok(self)
    }

    /// Attaches extension values. A value its descriptor's rules reject returns its
    /// `invalid-extension-value` fault, and no value of the call is added.
    pub fn extend(
        &mut self,
        values: impl crate::IntoList<ExtensionValue<CommandTarget>>,
    ) -> Result<&mut Self, DeclarationError> {
        let values = values.into_list();
        let state = &self.inner;
        let command = state.command.name.as_deref();
        let site = ExtensionSite {
            call: Finding::new("extend", vec![values_literal(values.len())])
                .path(state.path.clone()),
            at: "0".to_owned(),
        };
        let subject = ExtensionSubject {
            phrase: format!("on {}", command_subject(command)),
            sentence: command_sentence(command),
        };
        let mut registry = state.registry.clone();
        let layer = validate_layer(&values, &mut registry, &site, &subject)?;
        self.inner.registry = registry;
        self.inner.command.extensions.extend(layer);
        let (record, owners) = self.inner.command.extensions.publish();
        self.inner.record = record;
        self.inner.owners = owners;
        Ok(self)
    }
}

/// The result views a hook adds to any Command's result, with their data type erased, and the
/// default: the hook's form of [`ResultViews`](crate::ResultViews).
#[derive(Clone, Default)]
#[must_use]
pub struct AttachedViews {
    pub(crate) views: Vec<(String, ResultView)>,
    pub(crate) default: Option<String>,
}

impl AttachedViews {
    /// No views yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a view under `name`: a whole view over the result's JSON data, or a row view over each
    /// row's. A name listed again replaces its view in place.
    pub fn view(self, name: &str, view: impl Into<ResultView>) -> Self {
        let mut views = self;
        let view = view.into();
        match views.views.iter_mut().find(|(known, _)| known == name) {
            Some(entry) => entry.1 = view,
            None => views.views.push((name.to_owned(), view)),
        }
        views
    }

    /// Names the default view.
    pub fn default_view(self, name: &str) -> Self {
        Self {
            default: Some(name.to_owned()),
            ..self
        }
    }
}

/// The hint lines an `on_failure` hook adds.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Hints(pub(crate) Vec<String>);

/// What an `on_failure` hook returns: `()`, `Option<String>`, `String`, `Vec<String>`, or
/// [`Hints`] for its hint lines, or a `Result` of one of them whose `Err` is the hook's failure.
/// A hook that fails ends the hooks for that failure: core writes the failure's default text
/// through the plain fallback path and reports the hook's failure as a `foreign-throw` defect.
pub trait IntoHints {
    /// The hint lines, or the hook's failure.
    fn into_hints(self) -> Result<Hints, crate::Error>;
}

impl IntoHints for Hints {
    fn into_hints(self) -> Result<Hints, crate::Error> {
        Ok(self)
    }
}

impl IntoHints for () {
    fn into_hints(self) -> Result<Hints, crate::Error> {
        Ok(Hints(Vec::new()))
    }
}

impl IntoHints for Option<String> {
    fn into_hints(self) -> Result<Hints, crate::Error> {
        Ok(Hints(self.into_iter().collect()))
    }
}

impl IntoHints for String {
    fn into_hints(self) -> Result<Hints, crate::Error> {
        Ok(Hints(vec![self]))
    }
}

impl IntoHints for Vec<String> {
    fn into_hints(self) -> Result<Hints, crate::Error> {
        Ok(Hints(self))
    }
}

impl<H: IntoHints, E: Into<crate::Error>> IntoHints for Result<H, E> {
    fn into_hints(self) -> Result<Hints, crate::Error> {
        self.map_err(Into::into)?.into_hints()
    }
}

/// What an `on_failure` hook reads beside the failure.
#[derive(Clone)]
#[non_exhaustive]
pub struct FailureHookContext {
    /// The application name.
    pub application: String,
    /// The routed path, or the partial path routing walked.
    pub path: Vec<String>,
    /// How the run received its inputs.
    pub invoked_by: InvokedBy,
    /// The view the result would have rendered through.
    pub view: Option<String>,
    /// That view's media type.
    pub media_type: Option<String>,
    /// The style for stderr.
    pub style: ContextualStyle,
    /// The built graph.
    pub graph: Arc<CommandGraph>,
    /// The routed node, or the deepest one routing reached.
    pub command: Arc<CommandNode>,
    /// The log, tagged with the hook's plugin.
    pub log: Log,
}

/// Variables an environment hook adds. Empty adds none.
pub type EnvironmentAdditions = BTreeMap<String, String>;

/// What an `on_environment` hook reads: the working directory, a snapshot of the environment with
/// earlier hooks' additions, warnings, and the log.
#[non_exhaustive]
pub struct EnvironmentContext {
    /// The working directory.
    pub cwd: std::path::PathBuf,
    /// The environment, with earlier hooks' additions.
    pub env: Env,
    /// The log, tagged with the hook's plugin.
    pub log: Log,
    pub(crate) out: Out,
}

impl EnvironmentContext {
    /// Writes a warning to stderr.
    pub async fn warn(&self, message: &str) -> Result<(), crate::Error> {
        self.out.warn(message).await
    }
}
