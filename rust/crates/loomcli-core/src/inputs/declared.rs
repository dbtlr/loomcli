//! One declared input as validation reads it, and the declared values validated before any token:
//! each default and each implied value, in the default phase.

use std::sync::Arc;

use crate::application::declaration::{ApplicationDeclaration, global_site};
use crate::commands::declaration::{
    ArgumentInput, CommandDeclaration, InputDeclaration, OptionInput, local_site,
};
use crate::diagnostics::{DiagnosticParts, DiagnosticRule, rules};
use crate::failures::DeclarationError;
use crate::failures::messages::quoted;
use crate::host::Host;
use crate::plugins::plugin::plugin_option_site;

use super::content::ContentSettings;
use super::messages;
use super::options::{ErasedOutput, ErasedValidator};
use super::table::InputSite;
use super::{
    ArgumentDecl, DefaultValue, InputIdentity, InputKind, Issue, OptionDecl, ValidationContext,
    ValidationPhase, issue_path,
};
use crate::__private::RawValue;

/// One declaration, an argument or an option, read through one view.
#[derive(Clone, Copy)]
pub(crate) enum Declared<'a> {
    Argument(&'a ArgumentInput),
    Option(&'a OptionInput),
}

/// When a declaration requires a value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Presence {
    Optional,
    Required,
    NonInteractive,
}

impl<'a> Declared<'a> {
    /// The declaration as one input of a Command's authoring order.
    pub(crate) fn of(input: &'a InputDeclaration) -> Self {
        match input {
            InputDeclaration::Argument(argument) => Declared::Argument(argument),
            InputDeclaration::Option(option) => Declared::Option(option),
        }
    }

    pub(crate) fn name(self) -> &'a str {
        match self {
            Declared::Argument(argument) => &argument.name,
            Declared::Option(option) => &option.name,
        }
    }

    pub(crate) fn kind(self) -> InputKind {
        match self {
            Declared::Argument(_) => InputKind::Argument,
            Declared::Option(_) => InputKind::Option,
        }
    }

    /// The identity a validator and a problem read.
    pub(crate) fn identity(self, global: bool) -> InputIdentity {
        InputIdentity {
            global,
            kind: self.kind(),
            name: self.name().to_owned(),
        }
    }

    /// Whether the input collects a list: a multiple option or a variadic argument.
    pub(crate) fn collects(self) -> bool {
        match self {
            Declared::Argument(argument) => match &argument.decl {
                ArgumentDecl::String(argument) => argument.variadic,
                ArgumentDecl::Content(argument) => argument.variadic,
            },
            Declared::Option(option) => option.decl.multiple(),
        }
    }

    /// The arity count for a string option that declares one.
    pub(crate) fn arity(self) -> Option<usize> {
        self.option().and_then(OptionDecl::arity)
    }

    /// The option declaration, for an option.
    pub(crate) fn option(self) -> Option<&'a OptionDecl> {
        match self {
            Declared::Option(option) => Some(&option.decl),
            Declared::Argument(_) => None,
        }
    }

    /// The declared validator of a string input.
    pub(crate) fn validator(self) -> Option<&'a ErasedValidator> {
        match self {
            Declared::Argument(argument) => match &argument.decl {
                ArgumentDecl::String(argument) => argument.validator.as_ref(),
                ArgumentDecl::Content(_) => None,
            },
            Declared::Option(option) => match &option.decl {
                OptionDecl::String(option) => option.validator.as_ref(),
                _ => None,
            },
        }
    }

    /// The declared default of a string input.
    pub(crate) fn default(self) -> Option<&'a DefaultValue> {
        match self {
            Declared::Argument(argument) => match &argument.decl {
                ArgumentDecl::String(argument) => argument.default.as_ref(),
                ArgumentDecl::Content(_) => None,
            },
            Declared::Option(option) => match &option.decl {
                OptionDecl::String(option) => option.default.as_ref(),
                _ => None,
            },
        }
    }

    /// The implied value a string option declares, which a bare spelling supplies.
    pub(crate) fn implied(self) -> Option<&'a str> {
        match self {
            Declared::Option(option) => match &option.decl {
                OptionDecl::String(option) => option.implied.as_deref(),
                _ => None,
            },
            Declared::Argument(_) => None,
        }
    }

    /// Whether the omission reaches the validator.
    pub(crate) fn validates_omission(self) -> bool {
        match self {
            Declared::Argument(argument) => match &argument.decl {
                ArgumentDecl::String(argument) => argument.validate_omitted,
                ArgumentDecl::Content(_) => false,
            },
            Declared::Option(option) => match &option.decl {
                OptionDecl::String(option) => option.validate_omitted,
                _ => false,
            },
        }
    }

    /// The presence rule of a string input; every other kind decides its own absence.
    pub(crate) fn presence(self) -> Presence {
        let (required, non_interactive) = match self {
            Declared::Argument(argument) => match &argument.decl {
                ArgumentDecl::String(argument) => {
                    (argument.required, argument.required_non_interactive)
                }
                ArgumentDecl::Content(_) => (false, false),
            },
            Declared::Option(option) => match &option.decl {
                OptionDecl::String(option) => (option.required, option.required_non_interactive),
                _ => (false, false),
            },
        };
        if required {
            Presence::Required
        } else if non_interactive {
            Presence::NonInteractive
        } else {
            Presence::Optional
        }
    }

    /// What a content input takes, or `None` for any other input.
    pub(crate) fn content(self) -> Option<ContentSettings> {
        match self {
            Declared::Argument(argument) => match &argument.decl {
                ArgumentDecl::Content(content) => Some(ContentSettings {
                    stdin: content.stdin,
                    required: content.required,
                    min: content.min,
                    max: content.max,
                }),
                ArgumentDecl::String(_) => None,
            },
            Declared::Option(option) => match &option.decl {
                OptionDecl::Content(content) => Some(ContentSettings {
                    stdin: content.stdin,
                    required: content.required,
                    min: content.min,
                    max: content.max,
                }),
                _ => None,
            },
        }
    }

    /// How a declaration fault names the input: by kind and declared name.
    pub(crate) fn subject(self) -> String {
        match self {
            Declared::Argument(argument) => format!("Argument {}", quoted(&argument.name)),
            Declared::Option(option) => format!("Option {}", quoted(&option.name)),
        }
    }
}

/// Where a declaration sits: among the global options, or on the Command at a path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DeclKey {
    /// The Command's path from the root, or `None` for a global option.
    pub(crate) command: Option<Vec<String>>,
    pub(crate) kind: InputKind,
    pub(crate) name: String,
}

impl DeclKey {
    pub(crate) fn of(command: Option<&[String]>, input: Declared<'_>) -> Self {
        Self {
            command: command.map(<[String]>::to_vec),
            kind: input.kind(),
            name: input.name().to_owned(),
        }
    }
}

/// Every declared default and implied value of one graph, each its validator's output, validated
/// once per run before any token is read.
#[derive(Clone, Default)]
pub(crate) struct DeclaredValues {
    pub(crate) defaults: Vec<(DeclKey, RawValue)>,
    pub(crate) implied: Vec<(DeclKey, ErasedOutput)>,
}

impl DeclaredValues {
    pub(crate) fn default_of(&self, key: &DeclKey) -> Option<&RawValue> {
        self.defaults
            .iter()
            .find(|(known, _)| known == key)
            .map(|(_, value)| value)
    }

    pub(crate) fn implied_of(&self, key: &DeclKey) -> Option<&ErasedOutput> {
        self.implied
            .iter()
            .find(|(known, _)| known == key)
            .map(|(_, value)| value)
    }
}

/// The issues one rejection reports. A validator that returned none still rejected the value, so
/// core's placeholder stands in for its silence.
pub(crate) fn reported(issues: Vec<Issue>) -> Vec<Issue> {
    if issues.is_empty() {
        vec![Issue::new(messages::SILENT_REJECTION)]
    } else {
        issues
    }
}

/// One line per issue under the input's subject. A path segment may hold text the operator typed,
/// so the line escapes the path.
pub(crate) fn messages(subject: &str, issues: &[Issue]) -> Vec<String> {
    issues
        .iter()
        .map(|issue| messages::issue_line(subject, issue_path(issue).as_deref(), &issue.message))
        .collect()
}

/// An erased string, the value of an input with no validator.
pub(crate) fn text(value: &str) -> ErasedOutput {
    Arc::new(value.to_owned())
}

/// One raw value through an input's validator, or as itself without one: a list value by value,
/// each issue at its position before its own path, and every other value once.
pub(crate) fn validate_list(
    validator: Option<&ErasedValidator>,
    values: &[String],
    context: &dyn Fn() -> ValidationContext,
    implied: Option<(&[usize], &ErasedOutput)>,
    cancelled: &dyn Fn() -> bool,
) -> Result<Vec<ErasedOutput>, Vec<Issue>> {
    let mut outputs = Vec::new();
    let mut issues = Vec::new();
    for (position, value) in values.iter().enumerate() {
        if cancelled() {
            break;
        }
        if let Some((positions, output)) = implied
            && positions.contains(&position)
        {
            outputs.push(Arc::clone(output));
            continue;
        }
        let verdict = match validator {
            Some(validator) => validator.validate(value, &context()),
            None => Ok(text(value)),
        };
        match verdict {
            Ok(output) => outputs.push(output),
            Err(found) => issues.extend(
                reported(found)
                    .into_iter()
                    .map(|issue| issue.at(super::PathSegment::Index(position))),
            ),
        }
    }
    if issues.is_empty() {
        Ok(outputs)
    } else {
        Err(issues)
    }
}

/// Validates every word of each arity occurrence, retaining the occurrence boundaries.
pub(crate) fn validate_arity(
    validator: Option<&ErasedValidator>,
    tuples: &[Vec<String>],
    multiple: bool,
    context: &dyn Fn() -> ValidationContext,
    cancelled: &dyn Fn() -> bool,
) -> Result<RawValue, Vec<Issue>> {
    let mut outputs = Vec::new();
    let mut issues = Vec::new();
    for (occurrence, words) in tuples.iter().enumerate() {
        let Some(validator) = validator else {
            outputs.push(Arc::new(words.clone()) as ErasedOutput);
            continue;
        };
        match validate_list(Some(validator), words, context, None, cancelled) {
            Ok(words) => {
                // Each word was erased by this same validator, so its pack knows the output type.
                if let Some(output) = (validator.pack)(&words) {
                    outputs.push(output);
                } else {
                    issues.extend(reported(Vec::new()));
                }
            }
            Err(found) if multiple => issues.extend(
                found
                    .into_iter()
                    .map(|issue| issue.at(super::PathSegment::Index(occurrence))),
            ),
            Err(found) => issues.extend(found),
        }
    }
    if !issues.is_empty() {
        Err(issues)
    } else if multiple {
        Ok(RawValue::Many(outputs))
    } else {
        Ok(outputs.pop().map_or(RawValue::Absent, RawValue::One))
    }
}

/// One scalar raw value through an input's validator, or as itself without one.
pub(crate) fn validate_one(
    validator: Option<&ErasedValidator>,
    value: &str,
    context: &ValidationContext,
) -> Result<ErasedOutput, Vec<Issue>> {
    match validator {
        Some(validator) => validator.validate(value, context),
        None => Ok(text(value)),
    }
}

/// How each declared value names itself when its validator rejects it, and the fix.
struct DeclaredFault {
    rule: DiagnosticRule,
    noun: &'static str,
    setter: &'static str,
    correction: &'static str,
}

const DEFAULT_FAULT: DeclaredFault = DeclaredFault {
    rule: rules::INVALID_DEFAULT,
    noun: "default",
    setter: "default",
    correction: "Fix the default or its validator.",
};

const IMPLIED_FAULT: DeclaredFault = DeclaredFault {
    rule: rules::INVALID_IMPLIED,
    noun: "implied value",
    setter: "implied",
    correction: "Fix the implied value or its validator.",
};

/// The declaration fault a rejected declared value is: one line per issue under the sentence,
/// marking the setter that declares it on the call that declared the input.
fn declared_fault(
    input: Declared<'_>,
    issues: Vec<Issue>,
    site: &InputSite,
    fault: &DeclaredFault,
) -> DeclarationError {
    let subject = input.subject();
    let mut lines = vec![format!("{subject} has an invalid {}.", fault.noun)];
    lines.extend(messages(&subject, &reported(issues)));
    DeclarationError::new(
        fault.rule,
        DiagnosticParts::new(lines.join("\n"))
            .finding(site.finding(&format!("1.{}", fault.setter)))
            .correction(fault.correction),
    )
}

/// One declaration whose declared values are validated, with where it sits.
struct Placed<'a> {
    input: Declared<'a>,
    global: bool,
    command: Option<Vec<String>>,
    site: InputSite,
}

/// Every declaration of the graph in the order its declared values validate: the global options,
/// the application's own and then each plugin's at the plugin's own call, then each Command's own
/// inputs, the root first and then each child depth first.
fn placed(application: &ApplicationDeclaration) -> Vec<Placed<'_>> {
    let own = application.own_globals.iter().map(|option| Placed {
        input: Declared::Option(option),
        global: true,
        command: None,
        site: global_site(&option.name, &option.decl),
    });
    let plugins = application.plugins.iter().flat_map(|plugin| {
        plugin.options.iter().map(|option| Placed {
            input: Declared::Option(option),
            global: true,
            command: None,
            site: plugin_option_site(&plugin.identity, &option.name, &option.decl),
        })
    });
    let mut placed: Vec<Placed<'_>> = own.chain(plugins).collect();
    walk(&application.root, &[], &mut placed);
    placed
}

fn walk<'a>(command: &'a CommandDeclaration, path: &[String], placed: &mut Vec<Placed<'a>>) {
    for input in &command.inputs {
        let declared = Declared::of(input);
        let (call, literal) = match input {
            InputDeclaration::Argument(argument) => ("argument", argument.decl.literal()),
            InputDeclaration::Option(option) => ("option", option.decl.literal()),
        };
        placed.push(Placed {
            input: declared,
            global: false,
            command: Some(path.to_vec()),
            site: local_site(
                command.name.as_deref(),
                path,
                call,
                declared.name(),
                literal,
            ),
        });
    }
    for child in &command.children {
        let mut child_path = path.to_vec();
        child_path.push(child.name.clone().unwrap_or_default());
        walk(child, &child_path, placed);
    }
}

/// Validates every declared default and implied value of the graph before any token is read, in
/// declaration order, a declaration's default before its implied value, under the default phase
/// with the run's host. An implied value is judged whether or not the invocation holds a bare
/// spelling, because the author declared it. The first rejected value is the run's fault.
pub(crate) fn prepare_declared_values(
    application: &ApplicationDeclaration,
    host: &Arc<Host>,
) -> Result<DeclaredValues, DeclarationError> {
    let mut values = DeclaredValues::default();
    for entry in placed(application) {
        let input = entry.input;
        let context = || ValidationContext {
            phase: ValidationPhase::Default,
            host: Arc::clone(host),
            input: input.identity(entry.global),
            command: None,
            passthrough: None,
            supplied: None,
        };
        let key = DeclKey {
            command: entry.command.clone(),
            kind: input.kind(),
            name: input.name().to_owned(),
        };
        if let Some(default) = input.default() {
            let validator = input.validator();
            let output = match (input.arity(), default) {
                (Some(_), DefaultValue::Many(words)) => validate_arity(
                    validator,
                    std::slice::from_ref(words),
                    false,
                    &context,
                    &|| false,
                ),
                (Some(_), DefaultValue::Tuples(tuples)) => {
                    validate_arity(validator, tuples, true, &context, &|| false)
                }
                (_, DefaultValue::One(value)) if !input.collects() => {
                    validate_one(validator, value, &context()).map(RawValue::One)
                }
                (_, DefaultValue::One(value)) => validate_list(
                    validator,
                    std::slice::from_ref(value),
                    &context,
                    None,
                    &|| false,
                )
                .map(RawValue::Many),
                (_, DefaultValue::Many(values)) => {
                    validate_list(validator, values, &context, None, &|| false).map(RawValue::Many)
                }
                // The declaring call accepts grouped defaults only for multiple arity options.
                (_, DefaultValue::Tuples(_)) => Err(reported(Vec::new())),
            };
            match output {
                Ok(output) => values.defaults.push((key.clone(), output)),
                Err(issues) => {
                    return Err(declared_fault(input, issues, &entry.site, &DEFAULT_FAULT));
                }
            }
        }
        if let Some(implied) = input.implied() {
            // A bare spelling supplies one value, so even a multiple option's validator reads it.
            match validate_one(input.validator(), implied, &context()) {
                Ok(output) => values.implied.push((key, output)),
                Err(issues) => {
                    return Err(declared_fault(input, issues, &entry.site, &IMPLIED_FAULT));
                }
            }
        }
    }
    Ok(values)
}
