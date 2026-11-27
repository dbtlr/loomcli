//! The configuration plugin's answers: each request whose path leads to a value in the file the
//! run read, once the file passed the schema, so a value the schema removed fills nothing. A value
//! the option cannot take writes one `-v` line per issue in core's form for a dropped fill, and
//! answers nothing. Every sentence is fixed, and no file content reaches the terminal at the
//! default verbosity.

use std::collections::BTreeMap;

use loomcli_core::{
    Error, InputIdentity, InputKind, InvokedBy, Issue, OptionNode, PathSegment, SourceAnswer,
    SourceContext, SourceValue, issue_path, read_extension, reported_spelling,
};

use super::document::Value;
use super::extension::CONFIG_INPUT;
use super::messages;
use super::number::js_number_text;
use super::shared::{Loaded, directory_of};
use super::strict::{self, LinkedProblem, Strict};

/// A value read at a request's path: one the option takes, or the issues that say why not.
enum Shaped {
    Value(SourceValue),
    Wrong(Vec<Issue>),
}

/// The string a string option takes from one value: a string as it is, a finite number as its
/// JSON text, and a TOML integer as its exact digits. A TOML date or time already reads as the
/// text the file wrote.
fn text_of(value: &Value) -> Option<String> {
    match value {
        Value::Text(text) => Some(text.clone()),
        Value::Integer(number) => Some(number.to_string()),
        // An overflowing JSON literal, TOML inf and nan, and YAML .inf and .nan are no finite number.
        Value::Number(number) if number.is_finite() => Some(js_number_text(*number)),
        _ => None,
    }
}

/// The count a counted option takes from one value: a number that is a whole number of 0 or more.
/// A TOML integer counts as the nearest number.
fn count_of(value: &Value) -> Option<f64> {
    #[allow(clippy::cast_precision_loss)]
    let count = match value {
        Value::Number(number) => *number,
        Value::Integer(number) => *number as f64,
        _ => return None,
    };
    (count.is_finite() && count.fract() == 0.0 && count >= 0.0).then_some(count)
}

/// The list a multiple option takes from an array, or one issue per item that is not a string or a
/// number, at its position.
fn shape_list(items: &[super::document::Item]) -> Shaped {
    let mut texts = Vec::new();
    let mut issues = Vec::new();
    for (position, item) in items.iter().enumerate() {
        match text_of(&item.value) {
            Some(text) => texts.push(text),
            None => issues.push(
                Issue::new(messages::STRING_OR_NUMBER_ISSUE).at(PathSegment::Index(position)),
            ),
        }
    }
    if issues.is_empty() {
        Shaped::Value(SourceValue::List(texts))
    } else {
        Shaped::Wrong(issues)
    }
}

/// The raw value an option takes from one value, by the option's type, or the issues it raises.
/// A string option with an implied value takes a string by the string rule, never its implied
/// value.
fn shape(request: &OptionNode, value: &Value) -> Shaped {
    let wrong = |message: &str| Shaped::Wrong(vec![Issue::new(message)]);
    match request {
        OptionNode::Boolean(_) => match value {
            Value::Bool(flag) => Shaped::Value(SourceValue::Bool(*flag)),
            _ => wrong(messages::BOOLEAN_ISSUE),
        },
        OptionNode::Count(_) => count_of(value).map_or_else(
            || wrong(messages::COUNT_ISSUE),
            |count| Shaped::Value(SourceValue::Number(count)),
        ),
        OptionNode::String(node) if let Some(arity) = node.arity => {
            shape_arity(value, arity, node.multiple)
        }
        OptionNode::String(node) if node.multiple => list_of(value),
        OptionNode::Content(node) if node.multiple => list_of(value),
        _ => text_of(value).map_or_else(
            || wrong(messages::STRING_OR_NUMBER_ISSUE),
            |text| Shaped::Value(SourceValue::String(text)),
        ),
    }
}

fn shape_arity(value: &Value, arity: usize, multiple: bool) -> Shaped {
    fn tuple(value: &Value, arity: usize) -> Option<Vec<String>> {
        let Value::Array(array) = value else {
            return None;
        };
        if array.items.len() != arity {
            return None;
        }
        array
            .items
            .iter()
            .map(|item| text_of(&item.value))
            .collect()
    }

    let shaped = if multiple {
        match value {
            Value::Array(array) => array
                .items
                .iter()
                .map(|item| tuple(&item.value, arity))
                .collect::<Option<Vec<_>>>()
                .map(SourceValue::Tuples),
            _ => None,
        }
    } else {
        tuple(value, arity).map(SourceValue::List)
    };
    match shaped {
        Some(value) => Shaped::Value(value),
        None => Shaped::Wrong(vec![Issue::new(messages::arity_issue(arity, multiple))]),
    }
}

fn list_of(value: &Value) -> Shaped {
    match value {
        Value::Array(array) => shape_list(&array.items),
        _ => Shaped::Wrong(vec![Issue::new(messages::STRING_LIST_ISSUE)]),
    }
}

/// Answers each request whose bound path holds a value. A wrong shape logs its issues or, when
/// strict covers it, contributes the option's problem to the file's failure.
pub(crate) fn answer_all<O>(
    context: &SourceContext<O>,
    loaded: Loaded,
    strict: &Strict,
) -> Result<BTreeMap<String, SourceAnswer>, Error> {
    let mut answers = BTreeMap::new();
    let mut problems = Vec::new();
    let Some(usable) = &loaded.usable else {
        return Ok(answers);
    };
    for request in &context.requests {
        let Some(binding) = read_extension(request, &CONFIG_INPUT)? else {
            continue;
        };
        let Some(value) = usable.object.at_path(&binding.path) else {
            continue;
        };
        let covered = strict.covers_link(&binding.path);
        let label = messages::source_label(&binding.path, &usable.file.shown);
        match shape(request, value) {
            Shaped::Value(value) => {
                let answer = SourceAnswer::new(value, label).directory(directory_of(usable));
                answers.insert(
                    request.name().to_owned(),
                    if covered { answer.strict() } else { answer },
                );
            }
            Shaped::Wrong(issues) => {
                let spelling = if context.invoked_by == InvokedBy::Name {
                    request.name().to_owned()
                } else {
                    reported_spelling(request)
                };
                if covered {
                    let global = context
                        .graph
                        .globals
                        .iter()
                        .any(|option| option.name() == request.name());
                    problems.push(LinkedProblem {
                        input: InputIdentity::new(global, InputKind::Option, request.name()),
                        spelling,
                        issues,
                        label,
                    });
                } else {
                    for issue in issues {
                        let (template, fields) = messages::ignored_option(
                            &spelling,
                            issue_path(&issue).as_deref(),
                            &label,
                            &issue.message,
                        );
                        context.log.debug(template, fields);
                    }
                }
            }
        }
    }
    if loaded.file_issues.is_empty() && problems.is_empty() {
        Ok(answers)
    } else {
        Err(strict::failure(loaded.file_issues, problems, context.invoked_by).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_string_option_takes_a_string_or_a_finite_number_as_its_json_text() {
        assert_eq!(text_of(&Value::Text("a".into())), Some("a".into()));
        assert_eq!(text_of(&Value::Number(5.0)), Some("5".into()));
        assert_eq!(text_of(&Value::Number(1e21)), Some("1e+21".into()));
        assert_eq!(text_of(&Value::Number(-0.0)), Some("0".into()));
        assert_eq!(
            text_of(&Value::Integer(12_345_678_901_234_567_890)),
            Some("12345678901234567890".into())
        );
        assert_eq!(text_of(&Value::Number(f64::INFINITY)), None);
        assert_eq!(text_of(&Value::Bool(true)), None);
        assert_eq!(text_of(&Value::Null), None);
    }

    #[test]
    fn a_count_is_a_whole_number_of_0_or_more() {
        assert_eq!(count_of(&Value::Number(3.0)), Some(3.0));
        assert_eq!(count_of(&Value::Number(0.0)), Some(0.0));
        assert_eq!(count_of(&Value::Integer(10)), Some(10.0));
        for value in [
            Value::Number(-1.0),
            Value::Number(1.5),
            Value::Text("3".into()),
            Value::Bool(true),
        ] {
            assert_eq!(count_of(&value), None);
        }
    }
}
