//! The document `--manifest` prints, built from the command graph as ordered JSON.
//!
//! Every field is present; an absent scalar reads `null` and an empty list reads `[]`. Each object
//! lists its keys in the order the contract gives them, which `serde_json`'s `preserve_order`
//! keeps.

use std::collections::BTreeMap;

use loomcli_core::{
    ArgumentNode, CommandGraph, CommandNode, DeclarationError, DiagnosticParts, DiagnosticRule,
    Error, Finding, Literal, OptionNode, ResultNode, diagnostic_rule, escape_control_characters,
    read_extension,
};
use serde_json::{Map, Value, json};

use super::extension::{DeclaredFailure, MANIFEST_COMMAND};
use crate::encode::{escape_controls, stringify};

/// The token rule, stated once so no entry repeats it.
const TOKENS: &str = "Every input is a string token. An input's schema describes the value one token must satisfy, and each token of a multiple option or a variadic argument, and each word of an arity option, satisfies it alone. The configuration schema describes the configuration the application reads, not a token. A null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.";

/// The Meaning column of core's Invocation table, with its code formatting removed.
const CORE_EXIT_CODES: [(u16, &str); 8] = [
    (0, "Successful execution and core output"),
    (
        1,
        "Expected action failure, internal failure, or invalid declarations",
    ),
    (2, "Invalid invocation inputs"),
    (129, "Cancelled by SIGHUP"),
    (
        130,
        "Cancelled by SIGINT, a caller-supplied abort, or the action's cancel()",
    ),
    (131, "Cancelled by SIGQUIT"),
    (141, "Stopped because the reader of stdout closed the pipe"),
    (143, "Cancelled by SIGTERM"),
];

/// What the media types `application/json` and `application/jsonl` promise. A result's
/// `mediaTypes` names the views that declare each, so the statements apply by media type and never
/// by view name.
const JSON_ENCODING: &str = "The output is one JSON document. Unless the Command's view reshapes it, a value result is the value and a rows result is the array of its rows.";
const JSONL_ENCODING: &str = "Each line is one JSON document: one line per element when the printed value is an array, nothing for an empty array, and one line otherwise. Unless the view reshapes it, a rows result prints one line per row.";

const FAILURE_CODE_CONFLICT: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/manifest/failure-code-conflict",
    "Failure code conflict",
    "The manifest lists each failure code once for the whole application, with one exit code and one meaning, so a consumer reads one contract for each code. Two declarations of one code that disagree leave it no single entry to list.",
);

/// A description or a migration message on one line: each line break an author wrote (CRLF, or one
/// of LF, VT, FF, CR, NEL, LS, PS) reads as a space.
pub(crate) fn single_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\r' if characters.peek() == Some(&'\n') => {
                characters.next();
                out.push(' ');
            }
            '\n' | '\u{b}' | '\u{c}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

fn line_of(text: Option<&str>) -> Value {
    text.map_or(Value::Null, |text| Value::String(single_line(text)))
}

fn strings(values: &[String]) -> Value {
    Value::Array(values.iter().cloned().map(Value::String).collect())
}

fn text_or_null(text: Option<&String>) -> Value {
    text.map_or(Value::Null, |text| Value::String(text.clone()))
}

fn schema_of(schema: &Option<Map<String, Value>>) -> Value {
    schema.clone().map_or(Value::Null, Value::Object)
}

fn count_or_null(count: Option<usize>) -> Value {
    count.map_or(Value::Null, |count| json!(count))
}

fn serialized<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

fn default_of(default: &Option<loomcli_core::DeclaredDefault>) -> Value {
    default
        .as_ref()
        .map_or(Value::Null, |default| json!({ "value": default.value }))
}

/// One option's entry. The `aliases` field carries the option's visible aliases as bare names.
fn option_entry(node: &OptionNode) -> Value {
    let mut entry = Map::new();
    let aliases = json!(node.visible_aliases());
    let mut put = |key: &str, value: Value| {
        entry.insert(key.to_owned(), value);
    };
    match node {
        OptionNode::Boolean(node) => {
            put("type", json!("boolean"));
            put("name", json!(node.name));
            put("description", line_of(node.description.as_deref()));
            put("deprecated", line_of(node.deprecated.as_deref()));
            put("control", json!(node.control));
            put("long", text_or_null(node.long.as_ref()));
            put("short", text_or_null(node.short.as_ref()));
            put("negative", text_or_null(node.negative.as_ref()));
            put("aliases", aliases);
            put("polarity", serialized(&node.polarity));
            put("interaction", json!(node.interaction));
            put("color", json!(node.color));
            put("plain", json!(node.plain));
            put("schema", schema_of(&node.schema));
            put("env", strings(&node.env));
        }
        OptionNode::Count(node) => {
            put("type", json!("count"));
            put("name", json!(node.name));
            put("description", line_of(node.description.as_deref()));
            put("deprecated", line_of(node.deprecated.as_deref()));
            put("control", json!(node.control));
            put("long", text_or_null(node.long.as_ref()));
            put("short", text_or_null(node.short.as_ref()));
            put("aliases", aliases);
            put("verbose", json!(node.verbose));
            put("quiet", json!(node.quiet));
            put("schema", schema_of(&node.schema));
            put("env", strings(&node.env));
        }
        OptionNode::Content(node) => {
            put("type", json!("content"));
            put("stdin", json!(node.stdin));
            put("min", count_or_null(node.min));
            put("max", count_or_null(node.max));
            put("name", json!(node.name));
            put("description", line_of(node.description.as_deref()));
            put("deprecated", line_of(node.deprecated.as_deref()));
            put("control", json!(node.control));
            put("long", text_or_null(node.long.as_ref()));
            put("short", text_or_null(node.short.as_ref()));
            put("aliases", aliases);
            put("required", json!(node.required));
            put("requiredWhen", serialized(&node.required_when));
            put("multiple", json!(node.multiple));
            put("schema", schema_of(&node.schema));
            put("env", strings(&node.env));
            put("envDelimiter", text_or_null(node.env_delimiter.as_ref()));
            put("default", default_of(&node.default));
            put("implied", text_or_null(node.implied.as_ref()));
        }
        OptionNode::String(node) => {
            put("type", json!("string"));
            put("name", json!(node.name));
            put("description", line_of(node.description.as_deref()));
            put("deprecated", line_of(node.deprecated.as_deref()));
            put("control", json!(node.control));
            put("long", text_or_null(node.long.as_ref()));
            put("short", text_or_null(node.short.as_ref()));
            put("aliases", aliases);
            put("required", json!(node.required));
            put("requiredWhen", serialized(&node.required_when));
            put("multiple", json!(node.multiple));
            put("arity", json!(node.arity));
            put("lastWins", json!(node.last_wins));
            put("schema", schema_of(&node.schema));
            put("env", strings(&node.env));
            put("envDelimiter", text_or_null(node.env_delimiter.as_ref()));
            put("envAllowEmpty", json!(node.env_allow_empty));
            put("default", default_of(&node.default));
            put("implied", text_or_null(node.implied.as_ref()));
            put("background", json!(node.background));
        }
        // `OptionNode` is non-exhaustive; every kind core defines is handled above.
        _ => {}
    }
    Value::Object(entry)
}

/// One argument's entry: its node without `validated`, `validateOmitted`, and `extensions`.
fn argument_entry(node: &ArgumentNode) -> Value {
    let mut entry = Map::new();
    if node.kind.is_some() {
        entry.insert("type".to_owned(), json!("content"));
        entry.insert("stdin".to_owned(), json!(node.stdin.unwrap_or(false)));
        entry.insert("min".to_owned(), count_or_null(node.min));
        entry.insert("max".to_owned(), count_or_null(node.max));
    }
    entry.insert("name".to_owned(), json!(node.name));
    entry.insert(
        "description".to_owned(),
        line_of(node.description.as_deref()),
    );
    entry.insert("required".to_owned(), json!(node.required));
    entry.insert("requiredWhen".to_owned(), serialized(&node.required_when));
    entry.insert("variadic".to_owned(), json!(node.variadic));
    entry.insert("schema".to_owned(), schema_of(&node.schema));
    entry.insert("default".to_owned(), default_of(&node.default));
    Value::Object(entry)
}

fn result_entry(node: &ResultNode) -> Value {
    json!({
        "kind": serialized(&node.kind),
        "views": node.views,
        "default": node.default,
        "mediaTypes": node.media_types,
    })
}

/// The failures one Command's `MANIFEST_COMMAND` values declare, in collection order. An entry
/// identical to an earlier one on the same Command is listed once, at the first.
fn failures_of(node: &CommandNode) -> Result<Vec<DeclaredFailure>, Error> {
    let mut entries: Vec<DeclaredFailure> = Vec::new();
    for value in read_extension(node, &MANIFEST_COMMAND)? {
        for declared in value.failures {
            if !entries.contains(&declared) {
                entries.push(declared);
            }
        }
    }
    Ok(entries)
}

/// One declared failure and the Command that declares it, as a conflict names them.
struct Declaration<'a> {
    command: &'a CommandNode,
    failure: DeclaredFailure,
}

/// Every Command in the application, hidden ones included: the root, then each child's subtree.
fn every_command<'a>(node: &'a CommandNode, into: &mut Vec<&'a CommandNode>) {
    into.push(node);
    for child in &node.children {
        every_command(child, into);
    }
}

/// How a conflict names one Command: by name, or as the unnamed root.
fn command_subject(node: &CommandNode) -> String {
    node.name.as_ref().map_or_else(
        || "the root Command".to_owned(),
        |name| format!("Command \"{name}\""),
    )
}

/// The finding for one declaration of a conflicting failure: the value that declared it, rebuilt
/// with the entry the graph holds, and noting the Command that holds it.
fn declaration_finding(declaration: &Declaration<'_>) -> Finding {
    let failure = &declaration.failure;
    let rebuilt = Literal::builder("ManifestCommandFacts::new()").call(
        "failures",
        vec![Literal::List(vec![Literal::builder(format!(
            "DeclaredFailure::new({:?}, {}, {:?})",
            failure.code, failure.exit_code, failure.meaning
        ))])],
    );
    Finding::new("MANIFEST_COMMAND.value", vec![rebuilt])
        .mark("0.failures")
        .note(format!("on {}", command_subject(declaration.command)))
}

/// The fault for one failure code declared with two exit codes, or with one exit code and two
/// meanings.
fn conflict_error(first: &Declaration<'_>, second: &Declaration<'_>) -> Error {
    let same_code = first.failure.exit_code == second.failure.exit_code;
    let clause = |declaration: &Declaration<'_>| {
        if same_code {
            format!(
                "meaning \"{}\"",
                escape_control_characters(&declaration.failure.meaning)
            )
        } else {
            format!("exit code {}", declaration.failure.exit_code)
        }
    };
    let sentence = format!(
        "Failure \"{}\" is declared with {} on {} and {} on {}.",
        first.failure.code,
        clause(first),
        command_subject(first.command),
        clause(second),
        command_subject(second.command),
    );
    DeclarationError::new(
        FAILURE_CODE_CONFLICT,
        DiagnosticParts::new(sentence)
            .finding(declaration_finding(first))
            .finding(declaration_finding(second))
            .correction("Declare one exit code and one meaning for each failure code."),
    )
    .into()
}

/// Each failure the application declares, once per failure code, in the order a depth-first walk
/// from the root first meets it. A code means one failure across the application, so one declared
/// with a second exit code or meaning is a `DeclarationError`.
fn application_failures(root: &CommandNode) -> Result<Vec<DeclaredFailure>, Error> {
    let mut commands = Vec::new();
    every_command(root, &mut commands);
    let mut first: Vec<Declaration<'_>> = Vec::new();
    for command in commands {
        for failure in failures_of(command)? {
            match first
                .iter()
                .find(|known| known.failure.code == failure.code)
            {
                None => first.push(Declaration { command, failure }),
                Some(known) if known.failure != failure => {
                    return Err(conflict_error(known, &Declaration { command, failure }));
                }
                Some(_) => {}
            }
        }
    }
    Ok(first
        .into_iter()
        .map(|declaration| declaration.failure)
        .collect())
}

/// The exit-code table: core's rows, and a row for each other exit code a failure declared
/// anywhere in the application carries, naming its failure codes in the order the walk first meets
/// them. An exit code core's own row explains adds no row. Rows print in ascending numeric order.
fn exit_code_table(root: &CommandNode) -> Result<Value, Error> {
    let mut rows: BTreeMap<u16, String> = CORE_EXIT_CODES
        .iter()
        .map(|(code, meaning)| (*code, (*meaning).to_owned()))
        .collect();
    let mut declared: BTreeMap<u16, Vec<String>> = BTreeMap::new();
    for failure in application_failures(root)? {
        let exit_code = u16::from(failure.exit_code);
        if !rows.contains_key(&exit_code) {
            declared.entry(exit_code).or_default().push(failure.code);
        }
    }
    for (exit_code, codes) in declared {
        rows.insert(
            exit_code,
            format!("Declared failures: {}", codes.join(", ")),
        );
    }
    Ok(Value::Object(
        rows.into_iter()
            .map(|(code, meaning)| (code.to_string(), Value::String(meaning)))
            .collect(),
    ))
}

/// One Command's entry, with its visible descendants nested under `children`. `details`,
/// `examples`, and `failures` are the Command's collected values, in collection order.
fn command_entry(node: &CommandNode) -> Result<Value, Error> {
    let values = read_extension(node, &MANIFEST_COMMAND)?;
    let details: Vec<Value> = values
        .iter()
        .filter_map(|value| value.details.clone().map(Value::String))
        .collect();
    let examples: Vec<Value> = values
        .iter()
        .flat_map(|value| &value.examples)
        .map(|example| json!({ "command": example.command, "note": example.note }))
        .collect();
    let failures: Vec<Value> = failures_of(node)?
        .into_iter()
        .map(|failure| {
            json!({
                "code": failure.code,
                "exitCode": failure.exit_code,
                "meaning": failure.meaning,
            })
        })
        .collect();
    let children = node
        .children
        .iter()
        .filter(|child| !child.hidden)
        .map(|child| command_entry(child))
        .collect::<Result<Vec<_>, _>>()?;
    let stdin = node.stdin.as_ref().map_or(Value::Null, |stdin| {
        json!({
            "description": line_of(stdin.description.as_deref()),
            "required": stdin.required,
        })
    });
    let passthrough = node.passthrough.as_ref().map_or(
        Value::Null,
        |mode| json!({ "description": line_of(mode.description.as_deref()) }),
    );
    Ok(json!({
        "stdin": stdin,
        "passthrough": passthrough,
        "name": node.name,
        "aliases": node.visible_aliases,
        "path": node.path,
        "description": line_of(node.description.as_deref()),
        "details": details,
        "examples": examples,
        "deprecated": line_of(node.deprecated.as_deref()),
        "hasAction": node.has_action,
        "needsTerminal": node.needs_terminal,
        "result": node.result.as_ref().map_or(Value::Null, result_entry),
        "failures": failures,
        "arguments": node.arguments.iter().map(|argument| argument_entry(argument)).collect::<Vec<_>>(),
        "optionGroups": crate::option_groups::visible_option_groups(node).map(serialized).collect::<Vec<_>>(),
        "options": node.options.iter().filter(|option| !option.hidden()).map(|option| option_entry(option)).collect::<Vec<_>>(),
        "children": children,
    }))
}

/// The routed Command's slice: its entry, plus the Application facts and the fixed statements an
/// agent needs to read it with no second document. A hidden Command routed to directly is the
/// slice's own entry. The exit-code table reads the whole application, so every slice carries the
/// same table and a conflicting failure code fails every slice.
pub(crate) fn manifest_document(
    graph: &CommandGraph,
    command: &CommandNode,
) -> Result<Value, Error> {
    Ok(json!({
        "name": graph.name,
        "version": graph.version,
        "description": line_of(graph.description.as_deref()),
        "tokens": TOKENS,
        "exitCodes": exit_code_table(&graph.root)?,
        "encodings": { "json": JSON_ENCODING, "jsonl": JSONL_ENCODING },
        "globals": graph.globals.iter().filter(|option| !option.hidden()).map(|option| option_entry(option)).collect::<Vec<_>>(),
        "configuration": graph.configuration.as_ref().map_or(Value::Null, |configuration| json!({ "schema": schema_of(&configuration.schema) })),
        "command": command_entry(command)?,
    }))
}

/// The document as text: two-space-indented JSON and one newline, with DEL and the C1 controls,
/// U+007F through U+009F, written as lowercase `\uXXXX` since JSON leaves them raw.
pub(crate) fn document_text(document: &Value) -> String {
    // A `Value` holds plain JSON data, so the encoder cannot fail.
    let mut text = stringify(document, true).unwrap_or_default();
    text.push('\n');
    escape_controls(&text)
}
