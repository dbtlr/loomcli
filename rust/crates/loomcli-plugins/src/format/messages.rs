//! The sentences of the format plugin.

use loomcli_core::escape_control_characters;
use serde_json::Value;

pub(super) const GROUP_FORMAT_DESCRIPTION: &str = "Select the output format.";
pub(super) const FIELDS_DESCRIPTION: &str =
    "Select top-level fields of json and jsonl output, as a comma list.";
pub(super) const FIELDS_ISSUE: &str = "Supply field names separated by commas, such as name,size.";

pub(super) fn format_description(default: &str) -> String {
    let default = escape_control_characters(default);
    format!("Select the output format, {default} by default.")
}

pub(super) fn format_issue(names: &[String]) -> String {
    format!(
        "Supply one of {}.",
        joined(names.iter().map(String::as_str), ", ")
    )
}

fn joined<'a>(names: impl Iterator<Item = &'a str>, separator: &str) -> String {
    names
        .map(escape_control_characters)
        .collect::<Vec<_>>()
        .join(separator)
}

fn quoted(name: &str) -> String {
    format!("\"{}\"", escape_control_characters(name))
}

pub(super) fn fields_need_encoding(spelling: &str, format: &str, views: &[String]) -> String {
    let fields = quoted(spelling);
    if views.is_empty() {
        return format!(
            "Option {fields} applies only to output the formatter provides, and the formatter provides none here. Remove the option."
        );
    }
    let view_list = || views.iter().map(String::as_str);
    let named = joined(view_list(), " and ");
    let choices = joined(view_list(), " or ");
    let format = quoted(format);
    format!(
        "Option {fields} applies only to the {named} output the formatter provides. Remove the option, or select {choices} with {format}."
    )
}

pub(super) fn unknown_fields(spelling: &str, unknown: &[&str], available: &[&str]) -> String {
    let fields = quoted(spelling);
    let unknown = unknown
        .iter()
        .map(|name| quoted(name))
        .collect::<Vec<_>>()
        .join(", ");
    if available.is_empty() {
        return format!(
            "Option {fields} names {unknown}, but the output holds no fields. Remove the option."
        );
    }
    let available = joined(available.iter().copied(), ", ");
    format!(
        "Option {fields} names {unknown}, which the output does not hold. Supply fields from {available}."
    )
}

pub(super) fn fields_need_objects(spelling: &str, value: &Value) -> String {
    let fields = quoted(spelling);
    let kind = match value {
        Value::Array(_) => "an array",
        Value::Bool(_) => "a Boolean",
        Value::Null => "null",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Object(_) => "a value that is not an object",
    };
    format!(
        "Option {fields} selects fields of objects, but the output holds {kind}. Remove the option."
    )
}
