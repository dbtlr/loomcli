//! Suggestions for rejected closed-set values.

use std::borrow::Cow;

use loomcli_core::{
    FailureFacts, FailureHookContext, InputError, InputIdentity, InputKind, InputProblem, Issue,
    OptionNode, PathSegment, SuppliedValue,
};

use crate::closed_set::closed_set;

use super::{Spelled, messages, nearest, offered_option};

/// The rejected word of an issue, using its index to select a collected input's element.
fn received_at<'a>(raw: &'a SuppliedValue, path: &[PathSegment]) -> Option<&'a str> {
    match (raw, path) {
        (SuppliedValue::One(value), []) => Some(value),
        (SuppliedValue::Many(values), [PathSegment::Index(index)]) => {
            values.get(*index).map(String::as_str)
        }
        _ => None,
    }
}

fn accepted_values(input: &InputIdentity, context: &FailureHookContext) -> Option<Vec<String>> {
    let schema = match input.kind {
        InputKind::Argument => {
            &context
                .command
                .arguments
                .iter()
                .find(|argument| argument.name == input.name)?
                .schema
        }
        InputKind::Option => {
            let options = if input.global {
                &context.graph.globals
            } else {
                &context.command.options
            };
            let option = options
                .iter()
                .find(|option| option.name() == input.name && offered_option(option))?;
            let OptionNode::String(option) = option.as_ref() else {
                return None;
            };
            &option.schema
        }
        _ => return None,
    };
    closed_set(schema.as_ref())
}

/// Replaces the issue text after core's subject, preserving the spelling, origin, and issue path.
fn replace_issue(
    line: &str,
    issue: &Issue,
    raw: &SuppliedValue,
    candidates: &[Vec<String>],
) -> Option<String> {
    let value = received_at(raw, &issue.path)?;
    if candidates
        .iter()
        .flatten()
        .any(|accepted| accepted == value)
    {
        return None;
    }
    let prefix = line.strip_suffix(&issue.message)?;
    if !prefix.ends_with(": ") {
        return None;
    }
    let names = nearest(value, candidates, Spelled::Name);
    let fix = messages::value_suggestion(&names)?;
    Some(format!("{prefix}{fix}"))
}

/// Writes only replacements for single-line issues. Walking every issue's physical lines keeps
/// subsequent problems aligned with core's message even when an issue contains a newline.
pub(super) fn input_suggestion(
    failure: &InputError,
    context: &FailureHookContext,
) -> Option<String> {
    let mut lines: Vec<_> = failure.message().split('\n').map(Cow::Borrowed).collect();
    let mut offset = 0;
    let mut changed = false;
    for problem in failure.problems() {
        let InputProblem::Invalid { input, issues, .. } = problem else {
            offset += 1;
            continue;
        };
        let received = context.received(problem).and_then(|raw| {
            let accepted = accepted_values(input, context)?;
            let candidates: Vec<_> = accepted.into_iter().map(|value| vec![value]).collect();
            Some((raw, candidates))
        });
        for issue in issues {
            let width = issue.message.split('\n').count();
            if width == 1
                && let Some((raw, candidates)) = &received
                && let Some(line) = lines.get_mut(offset)
                && let Some(replacement) = replace_issue(line, issue, raw, candidates)
            {
                *line = Cow::Owned(replacement);
                changed = true;
            }
            offset += width;
        }
    }
    (changed && offset == lines.len()).then(|| lines.join("\n"))
}
