//! A question's link to an input of the routed Command, checked at the call, and the interaction
//! decision that resolves it.

use crate::messages;
use loomcli_core::{
    Context, DeclarationError, DiagnosticParts, DiagnosticRule, Error, Failure, FatalError,
    OptionNode, SuppliedValue, ValueLink, diagnostic_rule, is_prose_line, missing_input_error,
};

/// `@loomcli/prompts/link`.
pub(crate) const LINK_RULE: DiagnosticRule = diagnostic_rule(
    "@loomcli/prompts/link",
    "Invalid question",
    "A question asks in one line of prose and links at most one local option or argument of the routed Command, of the kind the question accepts, and a select or multiselect question offers enough choices that are not disabled to be answered.",
);

/// A malformed question: the authoring fault its call returns.
pub(crate) fn invalid(sentence: impl Into<String>, correction: &str) -> Error {
    DeclarationError::new(
        LINK_RULE,
        DiagnosticParts::new(sentence).correction(correction),
    )
    .into()
}

/// A question the run cannot ask: it links no input, and the run is not interactive.
#[derive(Debug, Failure)]
#[failure(code = "interaction-unavailable")]
pub struct InteractionUnavailableError {
    #[failure(base)]
    base: FatalError,
}

impl InteractionUnavailableError {
    /// The failure for the question `message` of the Command `command`, its words from the
    /// application's name.
    #[must_use]
    pub fn new(message: &str, command: &str) -> Self {
        Self {
            base: FatalError::new(messages::interaction_unavailable(message, command)),
        }
    }
}

/// The kind of question a link serves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LinkKind {
    Text,
    Secret,
    Confirm,
    Select,
    Multiselect,
}

/// How a question resolves.
pub(crate) enum Resolved {
    /// Skipped: the linked input's validated value answers it.
    Answered,
    /// Asked, with the raw supplied value and the input's declared default.
    Ask {
        /// The raw value the invocation supplied, when it supplied one.
        supplied: Option<SuppliedValue>,
        /// The input's declared default.
        declared: Option<serde_json::Value>,
    },
}

fn command_phrase(name: Option<&str>) -> String {
    name.map_or_else(
        || "the root Command".to_owned(),
        |name| format!("Command \"{name}\""),
    )
}

/// Whether a raw supplied value counts as supplied: a list counts only when it holds a value.
pub(crate) fn is_supplied(value: Option<&SuppliedValue>) -> bool {
    match value {
        None => false,
        Some(SuppliedValue::Many(values)) => !values.is_empty(),
        Some(_) => true,
    }
}

/// Checks a question's message and link, then resolves it under the run's interaction decision.
pub(crate) fn resolve_link<I, R: 'static>(
    context: &Context<I, R>,
    message: &str,
    link: Option<&ValueLink>,
    skip_if_supplied: bool,
    kind: LinkKind,
) -> Result<Resolved, Error> {
    if !is_prose_line(message) {
        return Err(invalid(
            "A question message must be one nonempty line.",
            "Supply a one-line message.",
        ));
    }
    let command = &context.command;
    let (supplied, declared, missing) = match link {
        None => {
            if !context.interactive {
                let mut words = vec![context.graph.name.clone()];
                words.extend(command.path.iter().cloned());
                return Err(InteractionUnavailableError::new(message, &words.join(" ")).into());
            }
            return Ok(Resolved::Ask {
                supplied: None,
                declared: None,
            });
        }
        Some(ValueLink::Argument { name, .. }) => {
            let Some(argument) = command.arguments.iter().find(|input| input.name == *name) else {
                return Err(invalid(
                    format!(
                        "The question \"{message}\" links argument \"{name}\", which {} does not declare.",
                        command_phrase(command.name.as_deref())
                    ),
                    "Link an argument of the routed Command.",
                ));
            };
            let content = argument.kind.is_some();
            if kind == LinkKind::Multiselect && (content || !argument.variadic) {
                return Err(invalid(
                    format!(
                        "The question \"{message}\" links argument \"{name}\", which is not a variadic string argument."
                    ),
                    "Link a multiple string option or a variadic string argument.",
                ));
            }
            if kind != LinkKind::Multiselect
                && (content || argument.variadic || kind == LinkKind::Confirm)
            {
                return Err(invalid(
                    format!(
                        "The question \"{message}\" links argument \"{name}\", which is not a string argument that takes one value."
                    ),
                    "Link a string option or argument that takes one value.",
                ));
            }
            (
                context.supplied.args.get(name).cloned(),
                argument.default.as_ref().map(|value| value.value.clone()),
                link,
            )
        }
        Some(ValueLink::Option { name, .. }) => {
            if context
                .graph
                .globals
                .iter()
                .any(|input| input.name() == name)
            {
                return Err(invalid(
                    format!("The question \"{message}\" links global option \"{name}\"."),
                    "Link a local option of the routed Command.",
                ));
            }
            let Some(option) = command.options.iter().find(|input| input.name() == name) else {
                return Err(invalid(
                    format!(
                        "The question \"{message}\" links option \"{name}\", which {} does not declare.",
                        command_phrase(command.name.as_deref())
                    ),
                    "Link a local option of the routed Command.",
                ));
            };
            check_kind(option, kind, message)?;
            let declared = match option.as_ref() {
                OptionNode::String(string) => string.default.as_ref().map(|d| d.value.clone()),
                _ => None,
            };
            (context.supplied.options.get(name).cloned(), declared, link)
        }
        Some(_) => return Ok(Resolved::Answered),
    };
    let present = is_supplied(supplied.as_ref());
    if present && (!context.interactive || skip_if_supplied) {
        return Ok(Resolved::Answered);
    }
    if !context.interactive {
        return Err(missing.map_or_else(
            || Error::from_foreign("The question links no input.".into()),
            |link| missing_input_error(context, link),
        ));
    }
    Ok(Resolved::Ask {
        supplied: if present { supplied } else { None },
        declared,
    })
}

fn check_kind(option: &OptionNode, kind: LinkKind, message: &str) -> Result<(), Error> {
    let name = option.name();
    match kind {
        LinkKind::Multiselect => {
            if !matches!(option, OptionNode::String(string) if string.multiple && string.arity.is_none())
            {
                return Err(invalid(
                    format!(
                        "The question \"{message}\" links option \"{name}\", which is not a multiple string option."
                    ),
                    "Link a multiple string option or a variadic string argument.",
                ));
            }
        }
        LinkKind::Confirm => {
            if !matches!(option, OptionNode::Boolean(_)) {
                return Err(invalid(
                    format!(
                        "The question \"{message}\" links option \"{name}\", which is not a Boolean option."
                    ),
                    "Link a Boolean option.",
                ));
            }
        }
        LinkKind::Text | LinkKind::Secret | LinkKind::Select => {
            if !matches!(option, OptionNode::String(string) if !string.multiple && string.arity.is_none())
            {
                return Err(invalid(
                    format!(
                        "The question \"{message}\" links option \"{name}\", which is not a string option that takes one value."
                    ),
                    "Link a string option or argument that takes one value.",
                ));
            }
        }
    }
    Ok(())
}

/// The linked input's validated value, which answers a skipped question.
pub(crate) fn linked_value<T: Clone + Send + Sync + 'static, I, R>(
    context: &Context<I, R>,
    link: Option<&ValueLink>,
) -> Result<Option<T>, Error> {
    match link {
        Some(ValueLink::Option { name, .. }) => context.option::<Option<T>>(name),
        Some(ValueLink::Argument { name, .. }) => context.argument::<Option<T>>(name),
        _ => Ok(None),
    }
}

/// The linked list input's validated values, which answer a skipped multiselect.
pub(crate) fn linked_values<T: Clone + Send + Sync + 'static, I, R>(
    context: &Context<I, R>,
    link: Option<&ValueLink>,
) -> Result<Vec<T>, Error> {
    match link {
        Some(ValueLink::Option { name, .. }) => context.option::<Vec<T>>(name),
        Some(ValueLink::Argument { name, .. }) => context.argument::<Vec<T>>(name),
        _ => Ok(Vec::new()),
    }
}

/// The value a linked input holds once validated, or the fault of an input that holds none.
pub(crate) fn present<T>(value: Option<T>, message: &str) -> Result<T, Error> {
    value.ok_or_else(|| {
        Error::from_foreign(
            format!("The input the question \"{message}\" links holds no validated value.").into(),
        )
    })
}
