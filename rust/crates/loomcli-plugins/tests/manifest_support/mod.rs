//! Shared fixtures for the manifest tests: a small application that spreads every entry rule over
//! its Commands, and a runner that records what one invocation wrote.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    Application, Build, Command, Context, Done, InputSchema, Issue, NoInputs, NoResult, Opt,
    Plugin, Polarity, ProcessHandle, ReleaseFacts, RunOptions, State, ValidationContext, Validator,
};
use loomcli_plugins::manifest::extension::{
    CommandExample, MANIFEST_COMMAND, ManifestCommandFacts,
};
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Map, Value, json};

pub type App = Application<NoInputs, NoResult, Done>;

/// What one invocation wrote.
#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

pub async fn run<I, R, S: State>(application: &Application<I, R, S>, argv: &[&str]) -> Ran {
    run_as(application, argv, Build::Distributed).await
}

pub async fn run_as<I, R, S: State>(
    application: &Application<I, R, S>,
    argv: &[&str],
    build: Build,
) -> Ran {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build)),
    );
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// The document one invocation printed, after checking that it succeeded.
pub async fn document_of<I, R, S: State>(
    application: &Application<I, R, S>,
    argv: &[&str],
) -> Value {
    let ran = run(application, argv).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""), "{ran:?}");
    serde_json::from_str(&ran.stdout).unwrap()
}

/// The Command entry at a path of child names under a document's `command`.
pub fn entry_at<'a>(document: &'a Value, names: &[&str]) -> &'a Value {
    let mut entry = &document["command"];
    for name in names {
        entry = entry["children"]
            .as_array()
            .unwrap()
            .iter()
            .find(|child| child["name"] == *name)
            .unwrap_or_else(|| panic!("the document holds no child {name:?}"));
    }
    entry
}

/// The keys of an object in printed order.
pub fn keys(value: &Value) -> Vec<&str> {
    value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect()
}

/// The action every fixture Command runs.
pub async fn dispatched(ctx: Context) -> loomcli_core::Outcome {
    ctx.out.print("dispatched").await
}

/// Accepts one or more ASCII digits and publishes the schema a pattern validator would.
#[derive(Clone)]
pub struct Digits;

impl Validator for Digits {
    type Output = String;
    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if !input.is_empty() && input.bytes().all(|byte| byte.is_ascii_digit()) {
            Ok(input.to_owned())
        } else {
            Err(vec![Issue::new("Supply digits.")])
        }
    }
    fn input_schema(&self) -> InputSchema {
        schema(json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "string",
            "pattern": "^[0-9]+$",
        }))
    }
}

/// Accepts any text and publishes the plain string schema.
#[derive(Clone)]
pub struct AnyText;

impl Validator for AnyText {
    type Output = String;
    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_owned())
    }
    fn input_schema(&self) -> InputSchema {
        schema(json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "string",
        }))
    }
}

pub fn schema(value: Value) -> InputSchema {
    match value {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

/// A plugin that adds what help adds in the reference: details and an example on `get`.
pub fn prose_plugin() -> Plugin {
    Plugin::new("@fixture/help").on_command_attach(|command| {
        if command.name() == Some("get") {
            command.extend([MANIFEST_COMMAND.value(
                ManifestCommandFacts::new()
                    .details("Help prose.")
                    .examples(vec![CommandExample::new("get b").note("B.")]),
            )])?;
        }
        Ok(())
    })
}

/// Every entry rule the manifest states, spread over a small application.
pub fn application(short: Option<char>) -> App {
    let manifest = match short {
        Some(letter) => loomcli_plugins::manifest::manifest().short(letter),
        None => loomcli_plugins::manifest::manifest(),
    };
    let get = Command::new("get")
        .description("Read one value.")
        .argument(
            "path",
            loomcli_core::Arg::string()
                .description("The path.")
                .required(),
        )
        .option(
            "raw",
            Opt::boolean()
                .description("Print raw.")
                .env(["APP_RAW"])
                .polarity(Polarity::Both),
        )
        .option("debug", Opt::boolean().hidden())
        .option(
            "limit",
            Opt::string()
                .default("10")
                .description("The limit.")
                .env(["APP_LIMIT", "APP_LIMIT_FALLBACK"])
                .env_allow_empty()
                .short('l')
                .validate(Digits),
        )
        .option(
            "tag",
            Opt::string()
                .env(["APP_TAGS"])
                .env_delimiter(",")
                .multiple(),
        )
        .option(
            "verbose",
            Opt::count()
                .description("Say more.")
                .env(["APP_VERBOSE"])
                .short('v'),
        )
        .option("backup", Opt::string().default("none").implied("simple"))
        .option("mode", Opt::string().validate(AnyText))
        .action(dispatched)
        .extend([MANIFEST_COMMAND.value(ManifestCommandFacts::new().details("Quote a path."))])
        .extend([MANIFEST_COMMAND
            .value(ManifestCommandFacts::new().examples(vec![CommandExample::new("get a")]))]);
    let old = Command::new("old")
        .deprecated("Use get instead.")
        .action(dispatched);
    let secret = Command::new("secret")
        .description("A hidden command.")
        .hidden()
        .action(dispatched);
    let clear = Command::new("clear")
        .description("Empty the cache.")
        .action(dispatched);
    let cache = Command::new("cache")
        .description("Manage the cache.")
        .command(clear);
    let weird = Command::new("weird")
        .description("A \u{9b} control, a \u{9f} edge, and a \u{a0} space.")
        .option(
            "marked",
            Opt::string().default("c\u{e000}\u{e001}\u{e002}\u{e003}d\u{e003}E000e"),
        )
        .action(dispatched);
    let pick = Command::new("pick")
        .argument(
            "index",
            loomcli_core::Arg::string().default("0").validate(Digits),
        )
        .action(dispatched);
    let empty = Command::new("empty")
        .action(dispatched)
        .extend([MANIFEST_COMMAND.value(ManifestCommandFacts::new())]);
    Application::new("app")
        .description("A fixture application.")
        .version("1.2.0")
        .plugins((prose_plugin(), manifest))
        .global_option(
            "file",
            Opt::string().description("The document.").short('f'),
        )
        .global_option("trace", Opt::boolean().hidden())
        .command(get)
        .command(old)
        .command(secret)
        .command(cache)
        .command(weird)
        .command(empty)
        .command(pick)
        .action(dispatched)
}

/// The fixed prose and tables every document carries.
pub fn tokens() -> &'static str {
    "Every input is a string token. An input's schema describes the value one token must satisfy, and each token of a multiple option or a variadic argument, and each word of an arity option, satisfies it alone. The configuration schema describes the configuration the application reads, not a token. A null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name."
}

pub fn core_exit_codes() -> Map<String, Value> {
    let rows = [
        ("0", "Successful execution and core output"),
        (
            "1",
            "Expected action failure, internal failure, or invalid declarations",
        ),
        ("2", "Invalid invocation inputs"),
        ("129", "Cancelled by SIGHUP"),
        (
            "130",
            "Cancelled by SIGINT, a caller-supplied abort, or the action's cancel()",
        ),
        ("131", "Cancelled by SIGQUIT"),
        (
            "141",
            "Stopped because the reader of stdout closed the pipe",
        ),
        ("143", "Cancelled by SIGTERM"),
    ];
    rows.iter()
        .map(|(code, meaning)| ((*code).to_owned(), json!(meaning)))
        .collect()
}

pub fn encodings() -> Value {
    json!({
        "json": "The output is one JSON document. Unless the Command's view reshapes it, a value result is the value and a rows result is the array of its rows.",
        "jsonl": "Each line is one JSON document: one line per element when the printed value is an array, nothing for an empty array, and one line otherwise. Unless the view reshapes it, a rows result prints one line per row.",
    })
}

/// Asserts two documents are equal, naming the first path where they differ.
pub fn assert_same(actual: &Value, expected: &Value) {
    fn walk(path: &str, actual: &Value, expected: &Value) {
        match (actual, expected) {
            (Value::Object(a), Value::Object(e)) => {
                for (key, value) in e {
                    match a.get(key) {
                        Some(found) => walk(&format!("{path}.{key}"), found, value),
                        None => panic!("missing {path}.{key}"),
                    }
                }
                for key in a.keys() {
                    assert!(e.contains_key(key), "unexpected {path}.{key}");
                }
            }
            (Value::Array(a), Value::Array(e)) => {
                assert_eq!(a.len(), e.len(), "length of {path}: {a:?} vs {e:?}");
                for (index, (a, e)) in a.iter().zip(e).enumerate() {
                    walk(&format!("{path}[{index}]"), a, e);
                }
            }
            _ => assert_eq!(actual, expected, "at {path}"),
        }
    }
    walk("$", actual, expected);
}
