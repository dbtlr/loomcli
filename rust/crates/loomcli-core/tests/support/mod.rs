//! Shared helpers for the tests that run an application end to end on the mock process.

#![allow(dead_code)]

use std::collections::BTreeMap;
use std::sync::Arc;

use loomcli_core::{Application, Context, Outcome, RunOptions, State, SuppliedValue};
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Value, json};

/// What one run wrote and resolved.
#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

/// Runs `application` on a mock process with these words after the program.
pub async fn run<I, R, S: State>(application: &Application<I, R, S>, argv: &[&str]) -> Ran {
    let process = mock_process(MockFields::new().argv(argv.iter().copied()));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// A run that failed with this usage text on stderr and exit 2.
pub fn usage(stderr: &str) -> Ran {
    Ran {
        status: 2,
        stdout: String::new(),
        stderr: format!("{stderr}\n"),
    }
}

/// One supplied value as JSON: a string, a list, a Boolean, or a count.
pub fn value_json(value: &SuppliedValue) -> Value {
    match value {
        SuppliedValue::One(text) => json!(text),
        SuppliedValue::Many(texts) => json!(texts),
        SuppliedValue::Tuples(groups) => json!(groups),
        SuppliedValue::Flag(flag) => json!(flag),
        SuppliedValue::Count(count) => json!(count),
        _ => Value::Null,
    }
}

/// A supplied record as a JSON object.
pub fn record_json(record: &BTreeMap<String, SuppliedValue>) -> Value {
    Value::Object(
        record
            .iter()
            .map(|(name, value)| (name.clone(), value_json(value)))
            .collect(),
    )
}

/// The action every fixture Command runs: it prints the path it ran on, the values the words
/// supplied, and the passthrough tail, as one JSON line.
pub async fn report(ctx: Context) -> Outcome {
    let line = json!({
        "args": record_json(&ctx.supplied.args),
        "command": ctx.command.path,
        "options": record_json(&ctx.supplied.options),
        "passthrough": ctx.passthrough,
    });
    ctx.out.print(&line.to_string()).await
}

/// The report a dispatched run printed, parsed, after asserting it wrote nothing to stderr and
/// exited 0.
pub async fn dispatched<I, R, S: State>(
    application: &Application<I, R, S>,
    argv: &[&str],
) -> Value {
    let ran = run(application, argv).await;
    assert_eq!(ran.stderr, "", "stderr of {argv:?}");
    assert_eq!(ran.status, 0, "status of {argv:?}");
    let line = ran.stdout.lines().next().unwrap_or_default().to_owned();
    serde_json::from_str(&line).unwrap_or(Value::Null)
}

/// Asserts that every key `expected` names holds the same value in `actual`.
#[track_caller]
pub fn assert_matches(actual: &Value, expected: &Value) {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => {
            for (key, value) in expected {
                let found = actual.get(key).unwrap_or(&Value::Null);
                assert_matches(found, value);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}

pub mod faults;
pub mod screen;
pub mod streams;
pub mod validators;

/// What a node says its value is.
#[derive(Clone, Copy)]
pub enum Kind {
    One,
    Many,
    Flag,
    Count,
    Content,
    Contents,
}

fn option_kind(node: &loomcli_core::OptionNode) -> Kind {
    match node {
        loomcli_core::OptionNode::Boolean(_) => Kind::Flag,
        loomcli_core::OptionNode::Count(_) => Kind::Count,
        loomcli_core::OptionNode::Content(content) if content.multiple => Kind::Contents,
        loomcli_core::OptionNode::Content(_) => Kind::Content,
        loomcli_core::OptionNode::String(string) if string.multiple => Kind::Many,
        _ => Kind::One,
    }
}

fn one<T: Clone + Send + Sync + 'static + serde::Serialize>(
    value: Result<Option<T>, loomcli_core::Error>,
) -> Result<Value, loomcli_core::Error> {
    value.map(|value| json!(value))
}

fn many<T: Clone + Send + Sync + 'static + serde::Serialize>(
    value: Result<Vec<T>, loomcli_core::Error>,
) -> Result<Value, loomcli_core::Error> {
    value.map(|value| json!(value))
}

/// One input's validated value read by name, as the JSON the reference's action prints: a string
/// or a list of strings (a number for a validator that answers one), a Boolean, a count, or a
/// content handle's name. `None` stands for an absent value, which the reference's JSON leaves out.
fn input_json<R>(
    ctx: &Context<loomcli_core::NoInputs, R>,
    name: &str,
    kind: Kind,
    argument: bool,
) -> Option<Value> {
    let read = || -> Result<Value, loomcli_core::Error> {
        macro_rules! by_name {
            ($t:ty) => {
                if argument {
                    ctx.argument::<$t>(name)
                } else {
                    ctx.option::<$t>(name)
                }
            };
        }
        match kind {
            Kind::Flag => by_name!(bool).map(|value| json!(value)),
            Kind::Count => by_name!(u32).map(|value| json!(value)),
            Kind::One => one(by_name!(Option<String>))
                .or_else(|_| one(by_name!(Option<u64>)))
                .or_else(|_| one(by_name!(Option<Value>))),
            Kind::Many => many(by_name!(Vec<String>))
                .or_else(|_| many(by_name!(Vec<u64>)))
                .or_else(|_| many(by_name!(Vec<Value>))),
            Kind::Content => by_name!(Option<loomcli_core::Content>)
                .map(|content| json!(content.map(|content| content.name))),
            Kind::Contents => by_name!(Vec<loomcli_core::Content>).map(|contents| {
                json!(
                    contents
                        .into_iter()
                        .map(|content| content.name)
                        .collect::<Vec<_>>()
                )
            }),
        }
    };
    read().ok().filter(|value| !value.is_null())
}

/// The routed Command's validated arguments and options and the global options, by declared name,
/// as the reference's actions print `args` and `options`: an absent value is left out.
pub fn values_json<R>(ctx: &Context<loomcli_core::NoInputs, R>) -> Value {
    let mut args = serde_json::Map::new();
    for argument in &ctx.command.arguments {
        let kind = match (argument.kind.is_some(), argument.variadic) {
            (true, true) => Kind::Contents,
            (true, false) => Kind::Content,
            (false, true) => Kind::Many,
            (false, false) => Kind::One,
        };
        if let Some(value) = input_json(ctx, &argument.name, kind, true) {
            args.insert(argument.name.clone(), value);
        }
    }
    let mut options = serde_json::Map::new();
    for option in ctx.graph.globals.iter().chain(&ctx.command.options) {
        if let Some(value) = input_json(ctx, option.name(), option_kind(option), false) {
            options.insert(option.name().to_owned(), value);
        }
    }
    json!({ "args": args, "options": options })
}

/// Every global option a middleware reads by name, as the reference prints `options`, or `null`.
pub fn middleware_options_json<O>(ctx: &loomcli_core::MiddlewareContext<O>) -> String {
    if ctx.options.is_none() {
        return "null".to_owned();
    }
    let mut record = serde_json::Map::new();
    for node in &ctx.graph.globals {
        let value = match &**node {
            loomcli_core::OptionNode::Boolean(_) => {
                ctx.option::<bool>(node.name()).ok().map(|flag| json!(flag))
            }
            loomcli_core::OptionNode::String(string) if string.multiple => ctx
                .option::<Vec<String>>(node.name())
                .ok()
                .map(|list| json!(list)),
            _ => ctx
                .option::<Option<String>>(node.name())
                .ok()
                .flatten()
                .map(|text| json!(text)),
        };
        if let Some(value) = value {
            record.insert(node.name().to_owned(), value);
        }
    }
    Value::Object(record).to_string()
}

/// An action that prints the validated values, the reference's `({ args, options }) => print(...)`.
pub async fn values(ctx: Context) -> Outcome {
    let line = values_json(&ctx);
    ctx.out.print(&line.to_string()).await
}

/// Runs `application` on a mock process built from `fields`.
pub async fn run_with<I, R, S: State>(
    application: &Application<I, R, S>,
    fields: MockFields,
) -> Ran {
    let process = mock_process(fields);
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// A mock process's fields with these words and these variables.
pub fn fields(argv: &[&str], env: &[(&str, &str)]) -> MockFields {
    env.iter().fold(
        MockFields::new().argv(argv.iter().copied()),
        |fields, (name, value)| fields.env(name, value),
    )
}
