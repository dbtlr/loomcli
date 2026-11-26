//! The input-source stage: the environment, then the configuration source, filling every option
//! in scope that argv left unfilled, and then the withdrawal of an exclusive group's lower tiers.
//!
//! The configuration source is the single slot a plugin claims. Core reaches it through
//! [`SourceSlot`], the erased form a plugin's `ConfigurationSource` becomes: the binding descriptor
//! that marks an option configuration-bound, the claiming plugin's own options, and the resolver.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::__private::{RawValue, RunState};
use crate::commands::declaration::OptionInput;
use crate::diagnostics::{DiagnosticParts, rules};
use crate::failures::messages::{as_sentence, quoted, reason_of};
use crate::failures::{Error, InternalError};
use crate::host::{Env, Host};
use crate::inspection::{CommandGraph, OptionGroup, OptionNode};
use crate::invocation::InvokedBy;
use crate::invocation::parse::{Fill, OptionValues};
use crate::plugins::{SourceAnswer, SourceValue};
use crate::support::{BoxFuture, is_prose_line};

use super::groups::{Tier, claims, losing_members};
use super::pass::{Provenance, Validation};
use super::{InputIdentity, InputKind, InputValues, OptionDecl};

/// What a configuration source's resolver receives, before its plugin's typed form wraps it.
pub(crate) struct SourceCall {
    /// The claiming plugin's own options, validated before the call.
    pub(crate) options: InputValues,
    /// The node of each option the source is asked to fill, the globals first.
    pub(crate) requests: Vec<OptionNode>,
    pub(crate) host: Arc<Host>,
    pub(crate) graph: Arc<CommandGraph>,
    pub(crate) invoked_by: InvokedBy,
    /// The run's state, which the source's output and log write through.
    pub(crate) run: Arc<RunState>,
}

/// A resolver with its plugin's options type erased.
pub(crate) type Resolve = Arc<
    dyn Fn(SourceCall) -> BoxFuture<'static, Result<BTreeMap<String, SourceAnswer>, Error>>
        + Send
        + Sync,
>;

/// The configuration source the Application's one claiming plugin installed.
#[derive(Clone)]
pub(crate) struct SourceSlot {
    /// The claiming plugin's identity, which a fault of its source names.
    pub(crate) plugin: String,
    /// The identity of the option-target descriptor that marks an option configuration-bound.
    pub(crate) binding: &'static str,
    /// The names of the plugin's own global options, which validate before the call.
    pub(crate) own: Vec<String>,
    pub(crate) resolve: Resolve,
}

/// One scope the stage fills: its options in declaration order, and the values the run holds for
/// them, which the stage writes each fill into.
pub(crate) struct StageScope<'a> {
    pub(crate) global: bool,
    pub(crate) options: Vec<&'a OptionInput>,
    pub(crate) values: OptionValues,
}

/// What the stage found beside the values it filled, and the fault that stopped it: the
/// configuration source's own failure, or a fault of its answers.
pub(crate) struct SourceOutcome {
    pub(crate) provenance: Provenance,
    pub(crate) fault: Option<Error>,
}

/// The Boolean grammar a bound variable is read through: the whole value, case-insensitive.
fn truth(value: &str) -> Option<bool> {
    match value.to_lowercase().as_str() {
        "true" | "yes" | "y" | "on" | "1" => Some(true),
        "false" | "no" | "n" | "off" | "0" => Some(false),
        _ => None,
    }
}

/// What one variable holds under the environment rules: a fill, or a value outside the grammar.
enum Reading {
    Fill(Fill),
    Rejected,
}

/// Reads one option's bound variables in list order. The first variable holding a non-empty value
/// supplies the option, and an empty one is unset, unless a string option's binding lets an empty
/// value supply it. A string option receives the raw string, never its implied value, and a
/// multiple option the list its delimiter splits the value into, every item kept. A Boolean option
/// reads the whole value through the grammar, and a counted option reads it as ASCII digits. A
/// value outside the grammar stops at its variable and never falls through.
fn read_variable(decl: &OptionDecl, env: &Env) -> Option<(Reading, String)> {
    let allow_empty = matches!(decl, OptionDecl::String(option) if option.env_allow_empty);
    let variable = decl.facts().env.iter().find(|name| {
        env.get(name.as_str())
            .is_some_and(|value| allow_empty || !value.is_empty())
    })?;
    let raw = env.get(variable.as_str())?;
    let reading = match decl {
        OptionDecl::String(option) if let Some(arity) = option.arity => {
            let words = match option.env_delimiter.as_deref() {
                Some(delimiter) => raw.split(delimiter).map(str::to_owned).collect::<Vec<_>>(),
                None => vec![raw.to_owned()],
            };
            if words.len() == arity {
                Reading::Fill(Fill::Tuples(vec![words]))
            } else {
                Reading::Rejected
            }
        }
        OptionDecl::String(option) => {
            Reading::Fill(split(raw, option.multiple, option.env_delimiter.as_deref()))
        }
        OptionDecl::Content(option) => {
            Reading::Fill(split(raw, option.multiple, option.env_delimiter.as_deref()))
        }
        OptionDecl::Count(_) => {
            if !raw.is_empty() && raw.bytes().all(|byte| byte.is_ascii_digit()) {
                // A count beyond the largest the run holds reads as that largest count.
                Reading::Fill(Fill::Count(raw.parse().unwrap_or(u32::MAX)))
            } else {
                Reading::Rejected
            }
        }
        OptionDecl::Boolean(_) => {
            truth(raw).map_or(Reading::Rejected, |value| Reading::Fill(Fill::Flag(value)))
        }
    };
    Some((reading, variable.clone()))
}

/// A string variable's fill: the list its delimiter splits it into on a multiple option, else
/// the raw string.
fn split(raw: &str, multiple: bool, delimiter: Option<&str>) -> Fill {
    match delimiter {
        Some(delimiter) if multiple => {
            Fill::List(raw.split(delimiter).map(str::to_owned).collect())
        }
        _ => Fill::Text(raw.to_owned()),
    }
}

/// The environment tier: each option in scope that argv left unfilled reads its bound variable.
/// A fill is labeled with the variable that supplied it, and a Boolean or counted one outside its
/// grammar is recorded as rejected, which fills nothing.
fn fill_from_environment(
    scopes: &mut [&mut StageScope<'_>],
    env: &Env,
    provenance: &mut Provenance,
) {
    for scope in scopes.iter_mut() {
        for option in &scope.options {
            if scope.values.is_supplied(&option.name) {
                continue;
            }
            match read_variable(&option.decl, env) {
                Some((Reading::Fill(fill), variable)) => {
                    scope.values.fill(&option.name, fill);
                    provenance.labels.push((option.name.clone(), variable));
                }
                Some((Reading::Rejected, variable)) => {
                    provenance.rejected.push((option.name.clone(), variable));
                }
                None => {}
            }
        }
    }
}

/// The shape one option's raw value takes, which decides what an answer must hold.
#[derive(Clone, Copy)]
enum RawKind {
    Boolean,
    Count,
    List,
    String,
    Tuple(usize),
    Tuples(usize),
}

impl RawKind {
    fn of(decl: &OptionDecl) -> Self {
        match decl {
            OptionDecl::Boolean(_) => RawKind::Boolean,
            OptionDecl::Count(_) => RawKind::Count,
            _ if let Some(arity) = decl.arity() => {
                if decl.multiple() {
                    RawKind::Tuples(arity)
                } else {
                    RawKind::Tuple(arity)
                }
            }
            _ if decl.multiple() => RawKind::List,
            _ => RawKind::String,
        }
    }

    /// How a fault names the value an answer owed.
    fn owed(self) -> String {
        match self {
            RawKind::Boolean => "a Boolean".to_owned(),
            RawKind::Count => "a whole number of 0 or more".to_owned(),
            RawKind::List => "an array of strings".to_owned(),
            RawKind::String => "a string".to_owned(),
            RawKind::Tuple(arity) => format!("an array of {arity} strings"),
            RawKind::Tuples(arity) => format!("an array of arrays, each of {arity} strings"),
        }
    }

    /// The answered value as the raw type its option takes, or `None` when it holds another.
    fn fill(self, value: &SourceValue) -> Option<Fill> {
        match (self, value) {
            (RawKind::Tuple(arity), SourceValue::List(words)) if words.len() == arity => {
                Some(Fill::Tuples(vec![words.clone()]))
            }
            (RawKind::Tuples(arity), SourceValue::Tuples(tuples))
                if tuples.iter().all(|words| words.len() == arity) =>
            {
                Some(Fill::Tuples(tuples.clone()))
            }
            (RawKind::List, SourceValue::List(list)) => Some(Fill::List(list.clone())),
            (RawKind::Boolean, SourceValue::Bool(flag)) => Some(Fill::Flag(*flag)),
            (RawKind::Count, SourceValue::Number(number))
                if number.is_finite() && number.fract() == 0.0 && *number >= 0.0 =>
            {
                // A whole number beyond the largest count the run holds reads as that count.
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let count = number.min(f64::from(u32::MAX)) as u32;
                Some(Fill::Count(count))
            }
            (RawKind::String, SourceValue::String(text)) => Some(Fill::Text(text.clone())),
            _ => None,
        }
    }
}

/// One option the stage asks the configuration source about, with the scope that holds it.
struct Requested<'a> {
    option: &'a OptionInput,
    global: bool,
}

/// One answer read under the answers rule, with the requested option it fills.
struct Answer<'a> {
    target: &'a Requested<'a>,
    fill: Fill,
    label: String,
    directory: Option<PathBuf>,
}

/// A fault the answers rule names.
fn answers_fault(sentence: String) -> Error {
    InternalError::without_cause(
        rules::SOURCE_ANSWERS,
        DiagnosticParts::new(sentence).correction(rules::SOURCE_ANSWERS_CORRECTION),
    )
    .into()
}

/// Every answer the resolver returned, read before any is filled, so an answer the rule rejects
/// leaves every requested option unfilled.
fn read_answers<'a>(
    plugin: &str,
    answers: BTreeMap<String, SourceAnswer>,
    requested: &'a [Requested<'a>],
) -> Result<Vec<Answer<'a>>, Error> {
    let sentence = format!("Plugin {}", quoted(plugin));
    let mut read = Vec::new();
    for (name, answer) in answers {
        let Some(target) = requested.iter().find(|target| target.option.name == name) else {
            return Err(answers_fault(format!(
                "{sentence} answered option {}, which core did not request.",
                quoted(&name)
            )));
        };
        let option = quoted(&name);
        if !is_prose_line(&answer.label) {
            return Err(answers_fault(format!(
                "{sentence} answered option {option} with an answer that is not {{ value, label }}."
            )));
        }
        let kind = RawKind::of(&target.option.decl);
        let Some(fill) = kind.fill(&answer.value) else {
            return Err(answers_fault(format!(
                "{sentence} answered option {option} with a value that is not {}.",
                kind.owed()
            )));
        };
        if answer
            .directory
            .as_ref()
            .is_some_and(|directory| !directory.is_absolute())
        {
            return Err(answers_fault(format!(
                "{sentence} answered option {option} with a directory that is not an absolute path."
            )));
        }
        read.push(Answer {
            target,
            fill,
            label: answer.label,
            directory: answer.directory,
        });
    }
    Ok(read)
}

/// What the stage reads beside its scopes.
pub(crate) struct StageFacts<'a> {
    pub(crate) host: &'a Arc<Host>,
    /// The routed Command's option groups, or none while a local fault is held.
    pub(crate) groups: &'a [OptionGroup],
    pub(crate) source: Option<&'a SourceSlot>,
    /// The node of one option in the graph `inspect()` returns for the run.
    pub(crate) request: &'a (dyn Fn(&str, bool) -> Option<OptionNode> + Sync),
    /// Builds the resolver's call around the plugin's validated options and the requests.
    pub(crate) call: &'a (dyn Fn(InputValues, Vec<OptionNode>) -> SourceCall + Sync),
    pub(crate) cancelled: &'a (dyn Fn() -> bool + Sync),
    /// The translators a resolver's foreign error is offered to, in resolution order.
    pub(crate) translations: &'a [crate::failures::Translation],
}

/// The input-source stage: the environment, then the configuration source, for every option in
/// scope that argv left unfilled, and then the withdrawal of an exclusive group's lower tiers.
/// When no option is left to ask, the source is never called. The source's own options pass their
/// validators first, through `validate_own`, and when one is rejected the source is never called
/// and each option it would have filled reports no missing value. A source fault stops the stage
/// and fills nothing more.
pub(crate) async fn fill_inputs<'a>(
    globals: &mut StageScope<'a>,
    mut locals: Option<&mut StageScope<'a>>,
    facts: &StageFacts<'_>,
    validate_own: impl FnOnce(
        &[InputIdentity],
        &Provenance,
        &OptionValues,
        Option<&OptionValues>,
    ) -> Result<Validation, Error>,
) -> SourceOutcome {
    let mut outcome = fill_tiers(globals, locals.as_deref_mut(), facts, validate_own).await;
    if outcome.fault.is_none()
        && let Some(locals) = locals
    {
        withdraw_losers(locals, facts.groups, &mut outcome.provenance);
    }
    outcome
}

/// The environment, then the configuration source.
async fn fill_tiers<'a>(
    globals: &mut StageScope<'a>,
    mut locals: Option<&mut StageScope<'a>>,
    facts: &StageFacts<'_>,
    validate_own: impl FnOnce(
        &[InputIdentity],
        &Provenance,
        &OptionValues,
        Option<&OptionValues>,
    ) -> Result<Validation, Error>,
) -> SourceOutcome {
    let mut provenance = Provenance::default();
    {
        let mut scopes: Vec<&mut StageScope<'_>> = vec![&mut *globals];
        if let Some(locals) = locals.as_deref_mut() {
            scopes.push(locals);
        }
        fill_from_environment(&mut scopes, &facts.host.env, &mut provenance);
    }
    let Some(source) = facts.source else {
        return SourceOutcome {
            provenance,
            fault: None,
        };
    };
    // The options to ask: still unfilled, configuration-bound, and holding no environment fault,
    // the globals first and then the routed Command's own, each in declaration order.
    let mut requested: Vec<Requested<'_>> = Vec::new();
    for scope in std::iter::once(&*globals).chain(locals.as_deref()) {
        for option in &scope.options {
            if !scope.values.is_supplied(&option.name)
                && provenance.rejected_variable(&option.name).is_none()
                && option
                    .extensions
                    .descriptors()
                    .any(|descriptor| descriptor.identity == source.binding)
            {
                requested.push(Requested {
                    option,
                    global: scope.global,
                });
            }
        }
    }
    if requested.is_empty() {
        return SourceOutcome {
            provenance,
            fault: None,
        };
    }
    let own: Vec<InputIdentity> = source
        .own
        .iter()
        .map(|name| InputIdentity {
            global: true,
            kind: InputKind::Option,
            name: name.clone(),
        })
        .collect();
    let local_values = locals.as_deref().map(|locals| &locals.values);
    let validated = match validate_own(&own, &provenance, &globals.values, local_values) {
        Ok(validated) => validated,
        Err(error) => {
            return SourceOutcome {
                provenance,
                fault: Some(error),
            };
        }
    };
    if validated.failure.is_some() {
        // A rejected own option skips the source, and what it would have filled reports no omission.
        provenance.unanswered = requested
            .iter()
            .map(|target| target.option.name.clone())
            .collect();
        return SourceOutcome {
            provenance,
            fault: None,
        };
    }
    if (facts.cancelled)() {
        return SourceOutcome {
            provenance,
            fault: None,
        };
    }
    let options = validated
        .values
        .iter()
        .filter(|(identity, _)| own.contains(identity))
        .fold(InputValues::new(), |values, (identity, value)| {
            values.with_raw_option(&identity.name, value.clone())
        });
    let requests = requested
        .iter()
        .filter_map(|target| (facts.request)(&target.option.name, target.global))
        .collect();
    let answers = match (source.resolve)((facts.call)(options, requests)).await {
        Ok(answers) => answers,
        Err(error) => {
            // The resolver's own failure keeps its class; a foreign error is offered to the
            // translators, and one no translator answers is the plugin's fault.
            let fault = if error.failure().is_some() {
                error
            } else {
                let error = crate::failures::translators::translated(error, facts.translations);
                if error.failure().is_some() {
                    error
                } else {
                    source_failure(&source.plugin, error)
                }
            };
            return SourceOutcome {
                provenance,
                fault: Some(fault),
            };
        }
    };
    let answers = match read_answers(&source.plugin, answers, &requested) {
        Ok(answers) => answers,
        Err(fault) => {
            return SourceOutcome {
                provenance,
                fault: Some(fault),
            };
        }
    };
    for answer in answers {
        let name = &answer.target.option.name;
        let scope = if answer.target.global {
            &mut *globals
        } else {
            match locals.as_deref_mut() {
                Some(locals) => locals,
                None => continue,
            }
        };
        scope.values.fill(name, answer.fill);
        provenance.labels.push((name.clone(), answer.label));
        provenance.fills.push((name.clone(), answer.directory));
    }
    SourceOutcome {
        provenance,
        fault: None,
    }
}

/// The fault of a source whose resolver returned a foreign error no translator answered.
fn source_failure(plugin: &str, error: Error) -> Error {
    let sentence = format!(
        "Plugin {} failed in its configuration source: {}",
        quoted(plugin),
        as_sentence(&reason_of(&error))
    );
    InternalError::new(
        rules::FOREIGN_THROW,
        DiagnosticParts::new(sentence).correction(rules::FOREIGN_THROW_CORRECTION),
        error,
    )
    .into()
}

/// Right after the stage fills and before validation, withdraws each member of an exclusive option
/// group that a lower tier claimed beside a sibling a higher tier claimed. The option reads as
/// unfilled by every tier: its value is removed, and so are its label and its file, and nothing
/// validates it. A rejected variable of a member beside a sibling argv claimed is forgotten too.
fn withdraw_losers(
    locals: &mut StageScope<'_>,
    groups: &[OptionGroup],
    provenance: &mut Provenance,
) {
    if groups.is_empty() {
        return;
    }
    let absent: Vec<(String, bool)> = locals
        .options
        .iter()
        .filter_map(|option| match &option.decl {
            OptionDecl::Boolean(boolean) => Some((
                option.name.clone(),
                super::pass::absent_boolean(boolean.polarity),
            )),
            _ => None,
        })
        .collect();
    let rejected: Vec<String> = provenance
        .rejected
        .iter()
        .map(|(name, _)| name.clone())
        .collect();
    let tier_of = |name: &str| {
        if !claims(&locals.values, name, &absent) {
            None
        } else if provenance.fill(name).is_some() {
            Some(Tier::Configuration)
        } else if provenance.label(name).is_some() {
            Some(Tier::Environment)
        } else {
            Some(Tier::Argv)
        }
    };
    let losers = losing_members(groups, &rejected, &tier_of);
    for name in losers {
        if locals.values.is_supplied(&name) {
            locals.values.withdraw(&name);
            provenance.withdrawn.push(name.clone());
        }
        provenance.labels.retain(|(known, _)| *known != name);
        provenance.fills.retain(|(known, _)| *known != name);
        provenance.rejected.retain(|(known, _)| *known != name);
    }
}

impl InputValues {
    /// The table with the option `name` set to a raw value.
    pub(crate) fn with_raw_option(mut self, name: &str, value: RawValue) -> Self {
        self.options.insert(name.to_owned(), value);
        self
    }

    /// The table with the argument `name` set to a raw value.
    pub(crate) fn with_raw_argument(mut self, name: &str, value: RawValue) -> Self {
        self.arguments.insert(name.to_owned(), value);
        self
    }
}
