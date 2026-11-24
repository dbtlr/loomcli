//! The run's interaction decision, and what an action needs to ask the operator: the missing-input
//! failure, the question's validation context, and linked validation.

use std::sync::Arc;

use crate::commands::declaration::CommandDeclaration;
use crate::diagnostics::{DiagnosticParts, rules};
use crate::failures::sentences::quoted;
use crate::failures::{DeclarationError, Error, InputError};
use crate::host::{Env, Host};
use crate::inspection::{OptionNode, reported_spelling};
use crate::invocation::{Context, InvokedBy};

use super::declared::Declared;
use super::typed::input_read;
use super::{InputIdentity, InputKind, InputProblem, Issue, ValidationContext, ValidationPhase};

/// The input a question's answer is validated as: an option or an argument of the routed Command.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum ValueLink {
    /// An option, by declared name.
    Option {
        /// The option.
        name: String,
        /// The question's message.
        message: String,
    },
    /// An argument, by declared name.
    Argument {
        /// The argument.
        name: String,
        /// The question's message.
        message: String,
    },
}

impl ValueLink {
    /// A link to the local option `name`, asked with `message`.
    pub fn option(name: impl Into<String>, message: impl Into<String>) -> Self {
        ValueLink::Option {
            name: name.into(),
            message: message.into(),
        }
    }

    /// A link to the argument `name`, asked with `message`.
    pub fn argument(name: impl Into<String>, message: impl Into<String>) -> Self {
        ValueLink::Argument {
            name: name.into(),
            message: message.into(),
        }
    }

    fn identity(&self) -> InputIdentity {
        let (kind, name) = match self {
            ValueLink::Option { name, .. } => (InputKind::Option, name),
            ValueLink::Argument { name, .. } => (InputKind::Argument, name),
        };
        InputIdentity {
            global: false,
            kind,
            name: name.clone(),
        }
    }
}

/// Whether the run is under CI: `CI` set, nonempty, and not `false`, as ci-info reads it.
pub(crate) fn under_ci(env: &Env) -> bool {
    env.get("CI")
        .is_some_and(|value| !value.is_empty() && value != "false")
}

/// The run's interaction decision: stdin and stderr are terminals, the run is not under CI, and
/// the marked option, when the Application declares one, does not read `false`.
pub(crate) fn interaction_decision(host: &Host, marked: Option<bool>) -> bool {
    host.terminal.stdin().is_tty
        && host.terminal.stderr().is_tty
        && !under_ci(&host.env)
        && marked != Some(false)
}

/// How a missing-input fault names the routed Command.
fn command_phrase(name: Option<&str>) -> String {
    name.map_or_else(
        || "the root Command".to_owned(),
        |name| format!("Command {}", quoted(name)),
    )
}

/// The `missing-input-name` fault for a link that names no input of the routed Command.
fn missing_input_name(kind: &str, name: &str, command: Option<&str>) -> Error {
    DeclarationError::new(
        rules::MISSING_INPUT_NAME,
        DiagnosticParts::new(format!(
            "missing_input_error() received {kind} {}, which {} does not declare.",
            quoted(name),
            command_phrase(command)
        ))
        .correction(format!(
            "Supply the name of {} of the routed Command.",
            if kind == "option" {
                "a local option"
            } else {
                "an argument"
            }
        )),
    )
    .into()
}

/// The error to return for a required input the run could not ask for: core's `InputError` with one
/// `missing` problem, in core's words, so the run exits 2. An option is named by its reported
/// spelling from argv and by its declared name from an invocation by name. A link that names no
/// local option, or no argument, of the routed Command is instead the `DeclarationError` of
/// `@loomcli/core/missing-input-name`.
pub fn missing_input_error<I, R>(context: &Context<I, R>, link: &ValueLink) -> Error {
    let command = &context.command;
    let named = context.values.invoked_by == InvokedBy::Name;
    let conditional = if context.interactive {
        ""
    } else {
        " when input is not interactive"
    };
    match link {
        ValueLink::Option { name, .. } => {
            let Some(option) = command.options.iter().find(|option| option.name() == name) else {
                return missing_input_name("option", name, command.name.as_deref());
            };
            let spelling = if named {
                name.clone()
            } else {
                reported_spelling(option)
            };
            let forms: Vec<&str> = match option.as_ref() {
                OptionNode::Boolean(boolean) => {
                    let mut forms: Vec<&str> =
                        [boolean.long.as_deref(), boolean.negative.as_deref()]
                            .into_iter()
                            .flatten()
                            .collect();
                    if forms.is_empty()
                        && let Some(short) = boolean.short.as_deref()
                    {
                        forms.push(short);
                    }
                    forms
                }
                _ => Vec::new(),
            };
            let value_fix = match option.as_ref() {
                OptionNode::String(string) if string.multiple => "Supply at least one value.",
                _ => "Supply a value.",
            };
            let fix = if !named && !forms.is_empty() {
                format!(
                    "Supply {}.",
                    forms
                        .iter()
                        .map(|form| quoted(form))
                        .collect::<Vec<_>>()
                        .join(" or ")
                )
            } else {
                value_fix.to_owned()
            };
            InputError::new(
                format!(
                    "Option {} is required{conditional}. {fix}",
                    quoted(&spelling)
                ),
                vec![InputProblem::Missing {
                    input: link.identity(),
                    spelling,
                }],
            )
            .into()
        }
        ValueLink::Argument { name, .. } => {
            let Some(argument) = command
                .arguments
                .iter()
                .find(|argument| argument.name == *name)
            else {
                return missing_input_name("argument", name, command.name.as_deref());
            };
            let amount = if argument.variadic {
                "at least one value"
            } else {
                "a value"
            };
            InputError::new(
                format!(
                    "Argument {} requires {amount}{conditional}. Supply a value for {}.",
                    quoted(name),
                    quoted(name)
                ),
                vec![InputProblem::Missing {
                    input: link.identity(),
                    spelling: name.clone(),
                }],
            )
            .into()
        }
    }
}

/// The routed Command's declaration in the graph the context's run built.
fn routed_declaration<I, R>(context: &Context<I, R>) -> Option<&CommandDeclaration> {
    context
        .graph
        .link
        .application
        .root
        .at(&context.command.path)
}

/// Validates `value` as the linked input's validator judges one token, in the question phase, and
/// returns its typed output for one value: a multiple option's or a variadic argument's validator
/// judges one value per call, and an input with no validator answers the value itself as a
/// `String`. The outer `Err` is the `input-read` declaration fault: a `T` that is not the linked
/// input's output type for one value.
pub fn validate_linked_value<T: Clone + Send + Sync + 'static, I, R>(
    context: &Context<I, R>,
    link: &ValueLink,
    value: &str,
) -> Result<Result<T, Vec<Issue>>, Error> {
    let identity = link.identity();
    let declared = routed_declaration(context).and_then(|command| {
        command
            .inputs
            .iter()
            .map(Declared::of)
            .find(|input| input.kind() == identity.kind && input.name() == identity.name)
    });
    let output = match declared.and_then(Declared::validator) {
        Some(validator) => {
            let message = match link {
                ValueLink::Option { message, .. } | ValueLink::Argument { message, .. } => message,
            };
            match validator.validate(
                value,
                &question_validation_context(context, Some(link), message),
            ) {
                Ok(output) => output,
                Err(issues) => return Ok(Err(super::declared::reported(issues))),
            }
        }
        None => super::declared::text(value),
    };
    output.downcast_ref::<T>().cloned().map(Ok).ok_or_else(|| {
        input_read(format!(
            "The question linked to {} {} reads another type than its validator produces.",
            match identity.kind {
                InputKind::Argument => "argument",
                _ => "option",
            },
            quoted(&identity.name)
        ))
    })
}

/// The validation context a question's own validator receives, in the question phase: the run's
/// host, the routed path, the passthrough words, and a copy of what the invocation supplied. A
/// linked question identifies its option or argument, and an unlinked one is the question named by
/// its message.
pub fn question_validation_context<I, R>(
    context: &Context<I, R>,
    link: Option<&ValueLink>,
    message: &str,
) -> ValidationContext {
    ValidationContext {
        phase: ValidationPhase::Question,
        host: Arc::clone(&context.host),
        input: link.map_or_else(
            || InputIdentity {
                global: false,
                kind: InputKind::Question,
                name: message.to_owned(),
            },
            ValueLink::identity,
        ),
        command: Some(context.command.path.clone()),
        passthrough: Some(context.passthrough.clone()),
        supplied: Some(context.supplied.clone()),
    }
}

impl CommandDeclaration {
    /// The Command at `path` below this one, by canonical names.
    pub(crate) fn at(&self, path: &[String]) -> Option<&CommandDeclaration> {
        path.iter().try_fold(self, |command, name| {
            command
                .children
                .iter()
                .find(|child| child.name.as_deref() == Some(name.as_str()))
        })
    }
}
