//! Ports `boolean-environment.test.ts`, `environment-empty.test.ts`, `environment-lists.test.ts`,
//! and the cases of `input-sources.test.ts` that need no plugin: environment bindings and their
//! grammars, precedence over the default, the supplied record of a filled value, the diagnostics
//! that name a variable, and the problems' order. Every case runs an Application end to end on the
//! mock process. The configuration tier's cases run through `__private::install_source`, the slot a
//! plugin's source claims.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use loomcli_core::__private::{SourceProbe, install_source};
use loomcli_core::{
    Activation, Application, Arg, Command, Context, Done, Error, Extension, NoInputs, NoResult,
    Opt, OptionTarget, Plugin, Polarity, SourceAnswer, SourceValue, read_extension,
};
use serde_json::{Value, json};
use support::validators::{Calls, Digits, NonEmpty, Source, calls, seen};
use support::{fields, middleware_options_json, record_json, run_with, values, values_json};

type App = Application<NoInputs, NoResult, Done>;

/// Values an action saw, one JSON record per run that reached it.
type Seen = Arc<Mutex<Vec<Value>>>;

fn seen_values() -> Seen {
    Arc::new(Mutex::new(Vec::new()))
}

/// An action that records the validated values it read.
fn recording(seen: &Seen) -> impl Fn(Context) -> futures_like::Ready + Send + Sync + 'static {
    let seen = Arc::clone(seen);
    move |ctx: Context| {
        if let Ok(mut seen) = seen.lock() {
            seen.push(values_json(&ctx)["options"].clone());
        }
        futures_like::ready()
    }
}

/// A ready future of `Ok(())`, so a recording action needs no async block that captures state.
mod futures_like {
    pub type Ready = std::future::Ready<loomcli_core::Outcome>;

    pub fn ready() -> Ready {
        std::future::ready(Ok(()))
    }
}

fn taken(seen: &Seen) -> Vec<Value> {
    seen.lock()
        .map(|mut seen| std::mem::take(&mut *seen))
        .unwrap_or_default()
}

// boolean-environment.test.ts

fn booleans(seen: &Seen) -> App {
    Application::new("app")
        .option(
            "total",
            Opt::boolean()
                .description("The total option.")
                .env(["APP_TOTAL"]),
        )
        .option(
            "quiet",
            Opt::boolean()
                .description("The quiet option.")
                .env(["APP_QUIET"])
                .polarity(Polarity::Negative),
        )
        .option(
            "color",
            Opt::boolean()
                .description("The color option.")
                .env(["APP_COLOR"])
                .polarity(Polarity::Both),
        )
        .action(recording(seen))
}

#[tokio::test]
async fn each_word_of_the_grammar_fills_a_boolean_option_under_every_polarity() {
    let seen = seen_values();
    let app = booleans(&seen);
    for (value, expected) in [
        ("true", true),
        ("YES", true),
        ("y", true),
        ("On", true),
        ("1", true),
        ("False", false),
        ("no", false),
        ("N", false),
        ("OFF", false),
        ("0", false),
    ] {
        let ran = run_with(
            &app,
            fields(
                &[],
                &[
                    ("APP_COLOR", value),
                    ("APP_QUIET", value),
                    ("APP_TOTAL", value),
                ],
            ),
        )
        .await;
        assert_eq!((ran.status, ran.stderr.as_str()), (0, ""), "{value}");
        assert_eq!(
            taken(&seen),
            vec![json!({ "total": expected, "quiet": expected, "color": expected })],
            "{value}"
        );
    }
}

#[tokio::test]
async fn a_value_outside_the_grammar_fails_naming_each_variable() {
    let issue = "Use true, false, yes, no, y, n, on, off, 1, or 0.";
    let seen = seen_values();
    let app = booleans(&seen);
    for value in ["maybe", " yes", "on ", "ye", "t", "f", "2"] {
        let ran = run_with(
            &app,
            fields(
                &[],
                &[
                    ("APP_COLOR", value),
                    ("APP_QUIET", value),
                    ("APP_TOTAL", value),
                ],
            ),
        )
        .await;
        assert_eq!(ran.status, 2, "{value:?}");
        assert!(taken(&seen).is_empty(), "{value:?}");
        for line in [
            format!("Option \"--total\" (from APP_TOTAL): {issue}\n"),
            format!("Option \"--no-quiet\" (from APP_QUIET): {issue}\n"),
            format!("Option \"--color\" (from APP_COLOR): {issue}\n"),
        ] {
            assert!(ran.stderr.contains(&line), "{value:?}: {}", ran.stderr);
        }
    }
}

// environment-empty.test.ts

fn prefixed(seen: &Seen, allow_empty: bool) -> App {
    let option = Opt::string()
        .default("fallback")
        .env(["APP_PREFIX", "LEGACY_PREFIX"]);
    let option = if allow_empty {
        option.env_allow_empty()
    } else {
        option
    };
    Application::new("app")
        .option("prefix", option)
        .action(recording(seen))
}

async fn prefix_of(allow_empty: bool, env: &[(&str, &str)], argv: &[&str]) -> Vec<Value> {
    let seen = seen_values();
    let ran = run_with(&prefixed(&seen, allow_empty), fields(argv, env)).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    taken(&seen)
        .into_iter()
        .map(|options| options["prefix"].clone())
        .collect()
}

#[tokio::test]
async fn an_empty_variable_is_unset_without_env_allow_empty() {
    assert_eq!(
        prefix_of(false, &[("APP_PREFIX", "")], &[]).await,
        [json!("fallback")]
    );
}

#[tokio::test]
async fn under_env_allow_empty_a_defined_empty_variable_fills_the_empty_string() {
    assert_eq!(
        prefix_of(true, &[("APP_PREFIX", "")], &[]).await,
        [json!("")]
    );
    assert_eq!(
        prefix_of(true, &[("APP_PREFIX", "x")], &[]).await,
        [json!("x")]
    );
    assert_eq!(prefix_of(true, &[], &[]).await, [json!("fallback")]);
}

#[tokio::test]
async fn under_env_allow_empty_the_first_defined_name_supplies_the_option() {
    assert_eq!(
        prefix_of(true, &[("APP_PREFIX", ""), ("LEGACY_PREFIX", "old")], &[]).await,
        [json!("")]
    );
    assert_eq!(
        prefix_of(true, &[("LEGACY_PREFIX", "")], &[]).await,
        [json!("")]
    );
    assert_eq!(
        prefix_of(true, &[("LEGACY_PREFIX", "old")], &[]).await,
        [json!("old")]
    );
    // Without the setter the empty first name falls through to the later name.
    assert_eq!(
        prefix_of(false, &[("APP_PREFIX", ""), ("LEGACY_PREFIX", "old")], &[]).await,
        [json!("old")]
    );
}

#[tokio::test]
async fn argv_outranks_a_defined_empty_variable() {
    assert_eq!(
        prefix_of(true, &[("APP_PREFIX", "")], &["--prefix", "cli"]).await,
        [json!("cli")]
    );
}

#[tokio::test]
async fn the_empty_string_satisfies_required_and_never_fills_the_implied_value() {
    let seen = seen_values();
    let app = Application::new("app")
        .option(
            "needed",
            Opt::string()
                .env(["APP_NEEDED"])
                .env_allow_empty()
                .implied("implied")
                .required(),
        )
        .action(recording(&seen));
    let ran = run_with(&app, fields(&[], &[("APP_NEEDED", "")])).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert_eq!(taken(&seen), [json!({ "needed": "" })]);
}

#[tokio::test]
async fn a_validator_that_rejects_the_empty_string_fails_naming_the_variable() {
    let app = Application::new("app")
        .option(
            "prefix",
            Opt::string()
                .env(["APP_PREFIX"])
                .env_allow_empty()
                .validate(NonEmpty("Supply a prefix.")),
        )
        .action(values);
    let ran = run_with(&app, fields(&[], &[("APP_PREFIX", "")])).await;
    assert_eq!(ran.status, 2);
    assert_eq!(
        ran.stderr,
        "app: Option \"--prefix\" (from APP_PREFIX): Supply a prefix.\n"
    );
}

#[test]
fn inspect_publishes_env_allow_empty_on_a_string_option_alone() {
    let graph = Application::new("app")
        .option(
            "prefix",
            Opt::string().env(["APP_PREFIX"]).env_allow_empty(),
        )
        .option("plain", Opt::string().env(["APP_PLAIN"]))
        .option("path", Opt::content())
        .action(values)
        .inspect()
        .expect("the graph builds");
    let options = serde_json::to_value(&graph.root.options).expect("the nodes serialize");
    assert_eq!(options[0]["envAllowEmpty"], json!(true));
    assert_eq!(options[1]["envAllowEmpty"], json!(false));
    assert!(options[2].get("envAllowEmpty").is_none());
}

/// The binding a configuration source fills by: a key in its settings.
const CONFIG_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/key");

/// A source that answers `configured` for every option it is asked about, and records the names.
fn configured<I, R, S>(application: Application<I, R, S>, asked: &Calls) -> Application<I, R, S> {
    let asked = Arc::clone(asked);
    install_source(
        application,
        "@fixture/config",
        &CONFIG_KEY,
        &[],
        move |probe: SourceProbe| {
            let names: Vec<String> = probe
                .requests
                .iter()
                .map(|request| request.name().to_owned())
                .collect();
            if let Ok(mut asked) = asked.lock() {
                asked.push(json!(names));
            }
            let answers: BTreeMap<String, SourceAnswer> = names
                .into_iter()
                .map(|name| {
                    (
                        name,
                        SourceAnswer::new(
                            SourceValue::String("configured".to_owned()),
                            "the fixture settings",
                        ),
                    )
                })
                .collect();
            std::future::ready(Ok::<_, Error>(answers))
        },
    )
}

async fn configured_prefix(allow_empty: bool, env: &[(&str, &str)]) -> (Vec<Value>, Vec<Value>) {
    let values = seen_values();
    let asked = calls();
    let option = Opt::string()
        .env(["APP_PREFIX"])
        .extend([CONFIG_KEY.value("prefix".to_owned())]);
    let option = if allow_empty {
        option.env_allow_empty()
    } else {
        option
    };
    let app = configured(
        Application::new("app")
            .option("prefix", option)
            .action(recording(&values)),
        &asked,
    );
    let ran = run_with(&app, fields(&[], env)).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    (
        seen(&asked),
        taken(&values)
            .into_iter()
            .map(|options| options["prefix"].clone())
            .collect(),
    )
}

#[tokio::test]
async fn under_env_allow_empty_an_empty_variable_clears_a_configured_value_unasked() {
    assert_eq!(
        configured_prefix(true, &[("APP_PREFIX", "")]).await,
        (vec![], vec![json!("")])
    );
    assert_eq!(
        configured_prefix(false, &[("APP_PREFIX", "")]).await,
        (vec![json!(["prefix"])], vec![json!("configured")])
    );
}

// environment-lists.test.ts

fn lists(seen: &Seen) -> App {
    Application::new("app")
        .option(
            "field",
            Opt::string()
                .default(["fallback"])
                .env(["APP_FIELDS", "APP_FIELDS_OLD"])
                .env_delimiter(",")
                .multiple(),
        )
        .option(
            "path",
            Opt::string()
                .env(["APP_PATHS"])
                .env_delimiter("::")
                .multiple(),
        )
        .action(recording(seen))
}

async fn lists_of(env: &[(&str, &str)], argv: &[&str]) -> Value {
    let seen = seen_values();
    let ran = run_with(&lists(&seen), fields(argv, env)).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    let options = taken(&seen).pop().unwrap_or(Value::Null);
    json!([options["field"], options["path"]])
}

#[tokio::test]
async fn a_variable_splits_at_each_delimiter_and_a_value_with_none_fills_one_item() {
    assert_eq!(
        lists_of(&[("APP_FIELDS", "name,size")], &[]).await,
        json!([["name", "size"], []])
    );
    assert_eq!(
        lists_of(&[("APP_FIELDS", "name")], &[]).await,
        json!([["name"], []])
    );
}

#[tokio::test]
async fn a_delimiter_of_several_characters_is_matched_literally() {
    assert_eq!(
        lists_of(&[("APP_PATHS", "a::b:c::d")], &[]).await,
        json!([["fallback"], ["a", "b:c", "d"]])
    );
}

#[tokio::test]
async fn no_item_is_trimmed_and_a_stray_delimiter_fills_an_empty_item() {
    assert_eq!(
        lists_of(&[("APP_FIELDS", " a , b,")], &[]).await,
        json!([[" a ", " b", ""], []])
    );
    assert_eq!(
        lists_of(&[("APP_FIELDS", ",a,,b")], &[]).await,
        json!([["", "a", "", "b"], []])
    );
}

#[tokio::test]
async fn the_first_name_that_holds_a_non_empty_value_supplies_the_list() {
    assert_eq!(
        lists_of(&[("APP_FIELDS", ""), ("APP_FIELDS_OLD", "x,y")], &[]).await,
        json!([["x", "y"], []])
    );
}

#[tokio::test]
async fn the_list_replaces_the_default_and_an_empty_variable_is_unset() {
    assert_eq!(
        lists_of(&[("APP_FIELDS", "a")], &[]).await,
        json!([["a"], []])
    );
    assert_eq!(
        lists_of(&[("APP_FIELDS", "")], &[]).await,
        json!([["fallback"], []])
    );
}

#[tokio::test]
async fn an_occurrence_in_argv_outranks_the_variable() {
    assert_eq!(
        lists_of(&[("APP_FIELDS", "a,b")], &["--field", "z"]).await,
        json!([["z"], []])
    );
}

#[tokio::test]
async fn a_variable_satisfies_a_required_multiple_option() {
    let seen = seen_values();
    let app = Application::new("app")
        .option(
            "needed",
            Opt::string()
                .env(["APP_NEEDED"])
                .env_delimiter(",")
                .multiple()
                .required(),
        )
        .action(recording(&seen));
    let ran = run_with(&app, fields(&[], &[("APP_NEEDED", "a,b")])).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert_eq!(taken(&seen), [json!({ "needed": ["a", "b"] })]);
}

#[tokio::test]
async fn a_multiple_content_option_reads_each_item_as_a_path() {
    let app = Application::new("app")
        .option(
            "file",
            Opt::content()
                .env(["APP_FILES"])
                .env_delimiter(",")
                .multiple(),
        )
        .action(values);
    let ran = run_with(&app, fields(&[], &[("APP_FILES", "a.txt,missing.txt")])).await;
    assert_eq!(ran.status, 2);
    assert_eq!(
        ran.stderr,
        "app: Option \"--file\" (from APP_FILES) at 0: Expected a readable file that exists.\n\
         app: Option \"--file\" (from APP_FILES) at 1: Expected a readable file that exists.\n"
    );
}

#[tokio::test]
async fn an_item_the_validator_rejects_fails_naming_the_variable_and_the_position() {
    let app = Application::new("app")
        .option(
            "field",
            Opt::string()
                .env(["FIELDS"])
                .env_delimiter(",")
                .multiple()
                .validate(NonEmpty("Supply a field name.")),
        )
        .action(values);
    let ran = run_with(&app, fields(&[], &[("FIELDS", "name,")])).await;
    assert_eq!(ran.status, 2);
    assert_eq!(
        ran.stderr,
        "app: Option \"--field\" (from FIELDS) at 1: Supply a field name.\n"
    );
}

// input-sources.test.ts: the environment tier, precedence, and diagnostics.

/// The fixture's application: a validated global `limit` bound to a variable with a default, and a
/// `count` Command whose options bind variables of each kind.
fn fixture(file_calls: &Calls) -> App {
    let count = Command::new("count")
        .option(
            "max",
            Opt::string()
                .env(["FIXTURE_MAX"])
                .required()
                .validate(Digits("Supply a whole number.")),
        )
        .option(
            "file",
            Opt::string()
                .env(["FIXTURE_FILE"])
                .validate_omitted(Source {
                    message: None,
                    calls: Arc::clone(file_calls),
                }),
        )
        .option("total", Opt::boolean().env(["FIXTURE_TOTAL"]))
        .option(
            "quiet",
            Opt::boolean()
                .env(["FIXTURE_QUIET"])
                .polarity(Polarity::Negative),
        )
        .option(
            "color",
            Opt::boolean()
                .env(["FIXTURE_COLOR"])
                .polarity(Polarity::Both),
        )
        .action(values);
    Application::new("app")
        .global_option(
            "limit",
            Opt::string()
                .default("10")
                .env(["FIXTURE_LIMIT"])
                .validate(Digits("Supply a whole number.")),
        )
        .global_option("verbose", Opt::boolean().env(["FIXTURE_VERBOSE"]))
        .command(count)
        .action(values)
}

#[tokio::test]
async fn argv_wins_over_the_environment_and_the_environment_over_the_default() {
    let app = fixture(&calls());
    let limit = |ran: support::Ran| {
        serde_json::from_str::<Value>(ran.stdout.trim()).unwrap_or(Value::Null)["options"]["limit"]
            .clone()
    };
    let env = [("FIXTURE_LIMIT", "2")];
    assert_eq!(
        limit(run_with(&app, fields(&["--limit", "1"], &env)).await),
        json!("1")
    );
    assert_eq!(limit(run_with(&app, fields(&[], &env)).await), json!("2"));
    assert_eq!(
        limit(run_with(&app, fields(&[], &[("FIXTURE_LIMIT", "")])).await),
        json!("10")
    );
}

#[tokio::test]
async fn a_value_filled_from_the_environment_is_supplied_in_every_sense() {
    let file_calls = calls();
    let app = fixture(&file_calls);
    let filled = run_with(
        &app,
        fields(
            &["count"],
            &[("FIXTURE_FILE", "a.txt"), ("FIXTURE_MAX", "7")],
        ),
    )
    .await;
    assert_eq!((filled.status, filled.stderr.as_str()), (0, ""));
    assert_eq!(
        serde_json::from_str::<Value>(filled.stdout.trim()).unwrap_or(Value::Null),
        json!({
            "args": {},
            "options": {
                "limit": "10", "verbose": false, "max": "7", "file": "file:a.txt",
                "total": false, "quiet": true, "color": false,
            },
        })
    );
    // The validator that also judges omission receives the filled value, and `supplied` holds it.
    let recorded = seen(&file_calls);
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0]["absent"], json!(false));
    assert_eq!(recorded[0]["supplied"]["options"]["file"], json!("a.txt"));
    // The action cannot tell the environment from the flag.
    let flagged = run_with(
        &app,
        fields(&["count", "--max", "7", "--file", "a.txt"], &[]),
    )
    .await;
    assert_eq!(flagged, filled);
}

#[tokio::test]
async fn a_boolean_variable_fills_its_option_under_every_polarity() {
    let app = fixture(&calls());
    for (value, expected) in [("true", true), ("1", true), ("FALSE", false), ("0", false)] {
        let ran = run_with(
            &app,
            fields(
                &["count", "--max", "1"],
                &[
                    ("FIXTURE_COLOR", value),
                    ("FIXTURE_QUIET", value),
                    ("FIXTURE_TOTAL", value),
                ],
            ),
        )
        .await;
        assert_eq!(ran.status, 0, "{value}: {}", ran.stderr);
        let options =
            &serde_json::from_str::<Value>(ran.stdout.trim()).unwrap_or(Value::Null)["options"];
        assert_eq!(
            json!([options["total"], options["quiet"], options["color"]]),
            json!([expected, expected, expected]),
            "{value}"
        );
    }
}

#[tokio::test]
async fn a_boolean_variable_outside_the_grammar_is_a_usage_failure_naming_the_variable() {
    let app = fixture(&calls());
    let ran = run_with(
        &app,
        fields(&["count", "--max", "1"], &[("FIXTURE_TOTAL", "maybe")]),
    )
    .await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (
            2,
            "",
            "app: Option \"--total\" (from FIXTURE_TOTAL): Use true, false, yes, no, y, n, on, off, 1, or 0.\n"
        )
    );
    // A negative-only option is named by the one spelling an operator types for it.
    let ran = run_with(
        &app,
        fields(&["count", "--max", "1"], &[("FIXTURE_QUIET", " true")]),
    )
    .await;
    assert_eq!(
        ran.stderr,
        "app: Option \"--no-quiet\" (from FIXTURE_QUIET): Use true, false, yes, no, y, n, on, off, 1, or 0.\n"
    );
}

#[tokio::test]
async fn problems_report_the_global_options_then_the_local_options() {
    let app = fixture(&calls());
    let ran = run_with(
        &app,
        fields(
            &["count", "--max", "x"],
            &[
                ("FIXTURE_LIMIT", "many"),
                ("FIXTURE_TOTAL", "maybe"),
                ("FIXTURE_VERBOSE", "maybe"),
            ],
        ),
    )
    .await;
    assert_eq!(
        ran.stderr,
        "app: Option \"--limit\" (from FIXTURE_LIMIT): Supply a whole number.\n\
         app: Option \"--verbose\" (from FIXTURE_VERBOSE): Use true, false, yes, no, y, n, on, off, 1, or 0.\n\
         app: Option \"--max\": Supply a whole number.\n\
         app: Option \"--total\" (from FIXTURE_TOTAL): Use true, false, yes, no, y, n, on, off, 1, or 0.\n"
    );
}

#[tokio::test]
async fn a_failure_on_a_filled_value_names_its_source_and_an_argv_message_is_unchanged() {
    let app = fixture(&calls());
    let ran = run_with(&app, fields(&[], &[("FIXTURE_LIMIT", "many")])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Option \"--limit\" (from FIXTURE_LIMIT): Supply a whole number.\n"
        )
    );
    let ran = run_with(&app, fields(&["--limit", "many"], &[])).await;
    assert_eq!(
        ran.stderr,
        "app: Option \"--limit\": Supply a whole number.\n"
    );
}

#[tokio::test]
async fn a_counted_variable_fills_its_count_and_one_occurrence_beats_it() {
    let seen = seen_values();
    let app = Application::new("app")
        .option("level", Opt::count().short('l').env(["APP_LEVEL"]))
        .action(recording(&seen));
    for (value, expected) in [("0", 0), ("3", 3), ("007", 7), ("12", 12)] {
        let ran = run_with(&app, fields(&[], &[("APP_LEVEL", value)])).await;
        assert_eq!(ran.status, 0, "{value}: {}", ran.stderr);
        assert_eq!(taken(&seen), [json!({ "level": expected })], "{value}");
    }
    for value in ["-1", "1.5", " 3", "three"] {
        let ran = run_with(&app, fields(&[], &[("APP_LEVEL", value)])).await;
        assert_eq!(
            (ran.status, ran.stderr.as_str()),
            (
                2,
                "app: Option \"--level\" (from APP_LEVEL): Use a whole number of 0 or more.\n"
            ),
            "{value:?}"
        );
    }
    let ran = run_with(&app, fields(&["-l"], &[("APP_LEVEL", "5")])).await;
    assert_eq!(ran.status, 0);
    assert_eq!(taken(&seen), [json!({ "level": 1 })]);
    // Nothing supplied reads 0.
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!(ran.status, 0);
    assert_eq!(taken(&seen), [json!({ "level": 0 })]);
}

#[tokio::test]
async fn a_variable_fills_a_string_option_with_an_implied_value_with_the_string_it_holds() {
    let seen = seen_values();
    let app = Application::new("app")
        .option(
            "backup",
            Opt::string().implied("simple").env(["APP_BACKUP"]),
        )
        .action(recording(&seen));
    let ran = run_with(&app, fields(&[], &[("APP_BACKUP", "numbered")])).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert_eq!(taken(&seen), [json!({ "backup": "numbered" })]);
    let ran = run_with(&app, fields(&["--backup"], &[("APP_BACKUP", "numbered")])).await;
    assert_eq!(ran.status, 0);
    assert_eq!(taken(&seen), [json!({ "backup": "simple" })]);
}

#[tokio::test]
async fn the_first_name_in_a_list_that_holds_a_value_supplies_the_option() {
    let seen = seen_values();
    let app = Application::new("app")
        .option(
            "region",
            Opt::string()
                .env(["AWS_REGION", "AWS_DEFAULT_REGION"])
                .validate(NonEmpty("Supply a region.")),
        )
        .option("debug", Opt::boolean().env(["APP_DEBUG", "DEBUG"]))
        .action(recording(&seen));
    let ran = run_with(
        &app,
        fields(&[], &[("AWS_REGION", "eu"), ("AWS_DEFAULT_REGION", "us")]),
    )
    .await;
    assert_eq!(ran.status, 0);
    assert_eq!(taken(&seen)[0]["region"], json!("eu"));
    // An empty value is unset, and the next name is read.
    let ran = run_with(
        &app,
        fields(&[], &[("AWS_REGION", ""), ("AWS_DEFAULT_REGION", "us")]),
    )
    .await;
    assert_eq!(ran.status, 0);
    assert_eq!(taken(&seen)[0]["region"], json!("us"));
    // A value outside the grammar on a listed name fails naming that variable, and never falls
    // through to a later name.
    let ran = run_with(&app, fields(&[], &[("APP_DEBUG", "maybe"), ("DEBUG", "1")])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Option \"--debug\" (from APP_DEBUG): Use true, false, yes, no, y, n, on, off, 1, or 0.\n"
        )
    );
    let ran = run_with(&app, fields(&[], &[("DEBUG", "maybe")])).await;
    assert_eq!(
        ran.stderr,
        "app: Option \"--debug\" (from DEBUG): Use true, false, yes, no, y, n, on, off, 1, or 0.\n"
    );
}

#[tokio::test]
async fn a_name_no_shell_sets_never_fills_and_case_matters() {
    let seen = seen_values();
    let app = Application::new("app")
        .option("token", Opt::string().env(["app-token", "APP_TOKEN"]))
        .action(recording(&seen));
    let ran = run_with(&app, fields(&[], &[("app_token", "lower")])).await;
    assert_eq!(ran.status, 0);
    assert_eq!(taken(&seen), [json!({})]);
    let ran = run_with(&app, fields(&[], &[("app-token", "hyphen")])).await;
    assert_eq!(ran.status, 0);
    assert_eq!(taken(&seen), [json!({ "token": "hyphen" })]);
}

#[tokio::test]
async fn an_empty_variable_list_still_reports_the_required_message() {
    // A configuration answer of an empty list is a fill, which the required message reports with
    // its source.
    const LIST_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/list");
    let app = install_source(
        Application::new("app")
            .option(
                "field",
                Opt::string()
                    .multiple()
                    .required()
                    .extend([LIST_KEY.value("fields".to_owned())]),
            )
            .action(values),
        "@fixture/config",
        &LIST_KEY,
        &[],
        |_probe: SourceProbe| {
            std::future::ready(Ok::<_, Error>(BTreeMap::from([(
                "field".to_owned(),
                SourceAnswer::new(SourceValue::List(Vec::new()), "fields in fixture.json"),
            )])))
        },
    );
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Option \"--field\" (from fields in fixture.json) is required. Supply at least one value.\n"
        )
    );
}

// input-sources.test.ts: the configuration tier, through the source slot.

/// Settings the fixture source answers from, keyed by the binding value an option carries.
type Settings = Vec<(&'static str, SourceValue)>;

/// The fixture's configuration source: its own `config` option, validated before the call, and a
/// resolver that answers each requested option whose binding names a key in `settings`, labeled
/// `<key> in <config>`, and records each call's own options and requests.
fn sourced<I, R, S>(
    application: Application<I, R, S>,
    settings: Settings,
    record: &Calls,
) -> Application<I, R, S> {
    let record = Arc::clone(record);
    let settings = Arc::new(settings);
    install_source(
        application,
        "@fixture/config",
        &CONFIG_KEY,
        &["config"],
        move |probe: SourceProbe| {
            let strict = probe
                .host
                .env
                .get("FIXTURE_STRICT")
                .is_some_and(|value| value == "true");
            let config: Option<String> = probe.options.option("config").unwrap_or_default();
            let names: Vec<String> = probe
                .requests
                .iter()
                .map(|request| request.name().to_owned())
                .collect();
            if let Ok(mut record) = record.lock() {
                record.push(json!({ "options": { "config": config }, "requests": names }));
            }
            let mut answers = BTreeMap::new();
            for request in &probe.requests {
                let key = read_extension(request, &CONFIG_KEY).ok().flatten();
                let Some(value) = key.as_ref().and_then(|key| {
                    settings
                        .iter()
                        .find(|(known, _)| known == key)
                        .map(|(_, value)| value.clone())
                }) else {
                    continue;
                };
                let answer = SourceAnswer::new(
                    value,
                    format!(
                        "{} in {}",
                        key.unwrap_or_default(),
                        config.clone().unwrap_or_default()
                    ),
                );
                answers.insert(
                    request.name().to_owned(),
                    if strict { answer.strict() } else { answer },
                );
            }
            std::future::ready(Ok::<_, Error>(answers))
        },
    )
}

/// The fixture's application under its configuration source: a global `limit` bound to a variable
/// and a configuration key, the source's own `config` option, a `level` the source fills, and the
/// verbose mark `-v`, so a run writes its debug lines.
fn configured_fixture(settings: Settings, record: &Calls) -> App {
    sourced(
        Application::new("app")
            .global_option("verbose", Opt::count().verbose().short('v'))
            .global_option(
                "limit",
                Opt::string()
                    .default("10")
                    .env(["FIXTURE_LIMIT"])
                    .validate(Digits("Supply a whole number."))
                    .extend([CONFIG_KEY.value("limits.bytes".to_owned())]),
            )
            .global_option(
                "config",
                Opt::string()
                    .default("fixture.json")
                    .env(["FIXTURE_CONFIG_FILE"])
                    .validate(JsonFile),
            )
            .global_option(
                "level",
                Opt::string()
                    .env(["FIXTURE_LEVEL"])
                    .extend([CONFIG_KEY.value("log.level".to_owned())]),
            )
            .action(values),
        settings,
        record,
    )
}

/// The source's own option: a JSON file name.
#[derive(Clone)]
struct JsonFile;

impl loomcli_core::Validator for JsonFile {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        if input.ends_with(".json") {
            Ok(input.to_owned())
        } else {
            Err(vec![loomcli_core::Issue::new("Supply a JSON file.")])
        }
    }
}

fn options_of(ran: &support::Ran) -> Value {
    serde_json::from_str::<Value>(ran.stdout.trim()).unwrap_or(Value::Null)["options"].clone()
}

#[tokio::test]
async fn the_environment_wins_over_the_source_and_the_source_over_the_default() {
    let record = calls();
    let settings = vec![("limits.bytes", SourceValue::String("3".to_owned()))];
    let app = configured_fixture(settings, &record);
    let both = [("FIXTURE_LIMIT", "2")];
    assert_eq!(
        options_of(&run_with(&app, fields(&["--limit", "1"], &both)).await)["limit"],
        json!("1")
    );
    assert_eq!(
        options_of(&run_with(&app, fields(&[], &both)).await)["limit"],
        json!("2")
    );
    assert_eq!(
        options_of(&run_with(&app, fields(&[], &[("FIXTURE_LIMIT", "")])).await)["limit"],
        json!("3")
    );
    let ran = run_with(&configured_fixture(Vec::new(), &record), fields(&[], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        options_of(&ran),
        json!({ "verbose": 0, "limit": "10", "config": "fixture.json" })
    );
    assert_eq!(
        seen(&record).last(),
        Some(&json!({ "options": { "config": "fixture.json" }, "requests": ["limit", "level"] }))
    );
}

#[tokio::test]
async fn the_source_is_never_called_when_every_bound_option_is_already_filled() {
    let record = calls();
    let app = configured_fixture(Vec::new(), &record);
    let ran = run_with(
        &app,
        fields(&["--limit", "1"], &[("FIXTURE_LEVEL", "info")]),
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        options_of(&ran),
        json!({ "verbose": 0, "limit": "1", "config": "fixture.json", "level": "info" })
    );
    assert!(seen(&record).is_empty());
}

#[tokio::test]
async fn a_boolean_variable_outside_the_grammar_keeps_the_source_uncalled() {
    const FLAG_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/flag");
    let asked = calls();
    let recorded = Arc::clone(&asked);
    let app = install_source(
        Application::new("app")
            .option(
                "trace",
                Opt::boolean()
                    .env(["FIXTURE_TRACE"])
                    .extend([FLAG_KEY.value("trace".to_owned())]),
            )
            .action(values),
        "@fixture/config",
        &FLAG_KEY,
        &[],
        move |_probe: SourceProbe| {
            if let Ok(mut asked) = recorded.lock() {
                asked.push(json!("called"));
            }
            std::future::ready(Ok::<_, Error>(BTreeMap::new()))
        },
    );
    let ran = run_with(&app, fields(&[], &[("FIXTURE_TRACE", "maybe")])).await;
    assert_eq!(ran.status, 2);
    assert!(seen(&asked).is_empty());
}

#[tokio::test]
async fn a_source_answers_a_multiple_option_with_a_list_and_an_empty_string_fills() {
    let record = calls();
    let app = sourced(
        Application::new("app")
            .global_option("config", Opt::string().default("fixture.json"))
            .option(
                "field",
                Opt::string()
                    .multiple()
                    .extend([CONFIG_KEY.value("fields".to_owned())]),
            )
            .option(
                "prefix",
                Opt::string()
                    .default("unused")
                    .extend([CONFIG_KEY.value("prefix".to_owned())]),
            )
            .action(values),
        vec![
            (
                "fields",
                SourceValue::List(vec!["name".to_owned(), "size".to_owned()]),
            ),
            ("prefix", SourceValue::String(String::new())),
        ],
        &record,
    );
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        options_of(&ran),
        json!({ "config": "fixture.json", "field": ["name", "size"], "prefix": "" })
    );
}

#[tokio::test]
async fn a_variable_list_replaces_the_source_which_is_never_asked_for_the_option() {
    let record = calls();
    let app = sourced(
        Application::new("app")
            .global_option("config", Opt::string().default("fixture.json"))
            .option(
                "field",
                Opt::string()
                    .multiple()
                    .env(["FIXTURE_FIELDS"])
                    .env_delimiter(",")
                    .extend([CONFIG_KEY.value("fields".to_owned())]),
            )
            .action(values),
        vec![("fields", SourceValue::List(vec!["configured".to_owned()]))],
        &record,
    );
    let ran = run_with(&app, fields(&[], &[("FIXTURE_FIELDS", "a,b")])).await;
    assert_eq!(options_of(&ran)["field"], json!(["a", "b"]));
    assert!(seen(&record).is_empty());
}

#[tokio::test]
async fn a_configuration_value_its_validator_rejects_falls_back_to_the_default_and_is_named_at_v() {
    let record = calls();
    let settings = vec![("limits.bytes", SourceValue::String("many".to_owned()))];
    let app = configured_fixture(settings, &record);
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(options_of(&ran)["limit"], json!("10"));
    let verbose = run_with(&app, fields(&["-v"], &[])).await;
    assert_eq!(verbose.status, 0);
    assert_eq!(options_of(&verbose)["limit"], json!("10"));
    assert!(
        verbose.stderr.contains(
            "Ignored option \"--limit\" from limits.bytes in fixture.json: Supply a whole number.\n"
        ),
        "{}",
        verbose.stderr
    );
    assert_eq!(verbose.stderr.matches("Ignored option").count(), 1);
    // The environment outranks the file, so a rejected variable still fails the run.
    let settings = vec![("limits.bytes", SourceValue::String("3".to_owned()))];
    let ran = run_with(
        &configured_fixture(settings, &record),
        fields(&[], &[("FIXTURE_LIMIT", "many")]),
    )
    .await;
    assert_eq!(ran.status, 2);
}

#[tokio::test]
async fn a_strict_configuration_answer_fails_with_its_label_or_fills_as_usual() {
    let record = calls();
    let strict = [("FIXTURE_STRICT", "true")];
    let rejected = configured_fixture(
        vec![("limits.bytes", SourceValue::String("many".to_owned()))],
        &record,
    );
    let ran = run_with(&rejected, fields(&["-v"], &strict)).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (
            2,
            "",
            "app: Option \"--limit\" (from limits.bytes in fixture.json): Supply a whole number.\n",
        )
    );
    let accepted = configured_fixture(
        vec![("limits.bytes", SourceValue::String("3".to_owned()))],
        &record,
    );
    let ran = run_with(&accepted, fields(&[], &strict)).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(options_of(&ran)["limit"], json!("3"));
}

#[tokio::test]
async fn one_rejected_item_drops_the_whole_list_which_a_required_multiple_option_reports_missing() {
    let record = calls();
    let app = sourced(
        Application::new("app")
            .global_option("verbose", Opt::count().verbose().short('v'))
            .global_option("config", Opt::string().default("fixture.json"))
            .option(
                "fields",
                Opt::string()
                    .multiple()
                    .required()
                    .validate(NonEmpty("Supply a field name."))
                    .extend([CONFIG_KEY.value("fields".to_owned())]),
            )
            .action(values),
        vec![(
            "fields",
            SourceValue::List(vec!["a".to_owned(), String::new()]),
        )],
        &record,
    );
    let ran = run_with(&app, fields(&["-v"], &[])).await;
    assert_eq!(ran.status, 2);
    assert!(
        ran.stderr.contains(
            "Ignored option \"--fields\" at 1 from fields in fixture.json: Supply a field name.\n"
        ),
        "{}",
        ran.stderr
    );
    assert!(
        ran.stderr
            .contains("app: Option \"--fields\" is required. Supply at least one value.\n"),
        "{}",
        ran.stderr
    );
    assert_eq!(ran.stderr.matches("Ignored option").count(), 1);
}

#[tokio::test]
async fn a_dropped_fill_leaves_a_required_option_missing_with_no_source_in_its_message() {
    let record = calls();
    let app = sourced(
        Application::new("app")
            .global_option("config", Opt::string().default("fixture.json"))
            .option(
                "min-bytes",
                Opt::string()
                    .required()
                    .validate(Digits("Supply a byte count."))
                    .extend([CONFIG_KEY.value("minBytes".to_owned())]),
            )
            .option(
                "field",
                Opt::string()
                    .multiple()
                    .required()
                    .validate(NonEmpty("Supply a field name."))
                    .extend([CONFIG_KEY.value("fields".to_owned())]),
            )
            .action(values),
        vec![
            ("minBytes", SourceValue::String("lots".to_owned())),
            (
                "fields",
                SourceValue::List(vec!["name".to_owned(), String::new()]),
            ),
        ],
        &record,
    );
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Option \"--min-bytes\" is required. Supply a value.\n\
             app: Option \"--field\" is required. Supply at least one value.\n"
        )
    );
}

#[tokio::test]
async fn a_dropped_fill_validates_as_unfilled_and_supplied_keeps_the_raw_value() {
    let record = calls();
    let file_calls = calls();
    let app = sourced(
        Application::new("app")
            .global_option("config", Opt::string().default("fixture.json"))
            .option(
                "file",
                Opt::string()
                    .validate_omitted(Source {
                        message: None,
                        calls: Arc::clone(&file_calls),
                    })
                    .extend([CONFIG_KEY.value("file".to_owned())]),
            )
            .option(
                "size",
                Opt::string()
                    .validate(Digits("Supply a size."))
                    .extend([CONFIG_KEY.value("size".to_owned())]),
            )
            .action(|ctx: Context| async move {
                let line = json!({
                    "supplied": record_json(&ctx.supplied.options),
                    "values": values_json(&ctx)["options"],
                });
                ctx.out.print(&line.to_string()).await
            }),
        vec![("size", SourceValue::String("big".to_owned()))],
        &record,
    );
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        serde_json::from_str::<Value>(ran.stdout.trim()).unwrap_or(Value::Null),
        json!({
            // A default is not supplied, and a dropped fill keeps its raw value here.
            "supplied": { "size": "big" },
            "values": { "config": "fixture.json", "file": "stdin" },
        })
    );
}

#[tokio::test]
async fn an_answers_directory_is_the_working_directory_its_validator_reads() {
    const DIR_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/dir");
    let echoes = calls();
    let directory = std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("sources-directory");
    let answer_directory = directory.clone();
    let app = install_source(
        Application::new("app")
            .option(
                "path",
                Opt::string()
                    .validate(support::validators::Echo {
                        label: "path",
                        calls: Arc::clone(&echoes),
                    })
                    .extend([DIR_KEY.value("path".to_owned())]),
            )
            .action(values),
        "@fixture/config",
        &DIR_KEY,
        &[],
        move |_probe: SourceProbe| {
            std::future::ready(Ok::<_, Error>(BTreeMap::from([(
                "path".to_owned(),
                SourceAnswer::new(
                    SourceValue::String("data.txt".to_owned()),
                    "path in tiers.json",
                )
                .directory(answer_directory.clone()),
            )])))
        },
    );
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let recorded = seen(&echoes);
    assert_eq!(
        recorded[0]["context"]["host"]["cwd"],
        json!(directory.to_string_lossy())
    );
}

#[tokio::test]
async fn an_answer_the_answers_rule_rejects_is_a_defect() {
    const RULE_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/rule");
    let cases: Vec<(SourceAnswer, &str, &str)> = vec![
        (
            SourceAnswer::new(SourceValue::Bool(true), "limit in settings"),
            "limit",
            "Plugin \"@fixture/config\" answered option \"limit\" with a value that is not a string.",
        ),
        (
            SourceAnswer::new(SourceValue::String("1".to_owned()), "two\nlines"),
            "limit",
            "Plugin \"@fixture/config\" answered option \"limit\" with an answer that is not { value, label }.",
        ),
        (
            SourceAnswer::new(SourceValue::String("1".to_owned()), "limit in settings")
                .directory("relative/dir"),
            "limit",
            "Plugin \"@fixture/config\" answered option \"limit\" with a directory that is not an absolute path.",
        ),
        (
            SourceAnswer::new(SourceValue::String("1".to_owned()), "other in settings"),
            "other",
            "Plugin \"@fixture/config\" answered option \"other\", which core did not request.",
        ),
    ];
    for (answer, name, sentence) in cases {
        let answer = Arc::new((name.to_owned(), answer));
        let app = install_source(
            Application::new("app")
                .option(
                    "limit",
                    Opt::string().extend([RULE_KEY.value("limit".to_owned())]),
                )
                .action(values),
            "@fixture/config",
            &RULE_KEY,
            &[],
            move |_probe: SourceProbe| {
                let answers = BTreeMap::from([(answer.0.clone(), answer.1.clone())]);
                std::future::ready(Ok::<_, Error>(answers))
            },
        );
        let process = loomcli_testing::mock_process(loomcli_testing::MockFields::new().release(
            loomcli_core::ReleaseFacts::new(loomcli_core::Build::Distributed),
        ));
        let code = app
            .run(loomcli_core::RunOptions::new().process(Arc::clone(&process) as _))
            .await;
        assert_eq!(code.get(), 1, "{sentence}");
        assert_eq!(
            process.stderr_text(),
            "app: Something went wrong.\n",
            "{sentence}"
        );
        // A development build shows the sentence in its Developer Diagnostic.
        let ran = run_with(&app, fields(&[], &[])).await;
        assert_eq!(ran.status, 1);
        assert!(
            ran.stderr.contains("@loomcli/core/source-answers") && ran.stderr.contains(sentence),
            "{}",
            ran.stderr
        );
    }
}

#[tokio::test]
async fn a_rejected_source_option_skips_the_source_and_reports_with_every_other_problem() {
    let record = calls();
    let app = sourced(
        Application::new("app")
            .global_option(
                "config",
                Opt::string().default("fixture.json").validate(JsonFile),
            )
            .option(
                "min-bytes",
                Opt::string()
                    .required()
                    .extend([CONFIG_KEY.value("minBytes".to_owned())]),
            )
            .option("name", Opt::string().required())
            .action(values),
        vec![("minBytes", SourceValue::String("4".to_owned()))],
        &record,
    );
    let ran = run_with(&app, fields(&["--config", "settings.toml"], &[])).await;
    assert!(seen(&record).is_empty());
    // An option the skipped source would have filled reports no missing value.
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Option \"--config\": Supply a JSON file.\n\
             app: Option \"--name\" is required. Supply a value.\n"
        )
    );
}

#[tokio::test]
async fn a_resolver_failure_keeps_its_class_and_a_foreign_error_is_the_plugins_fault() {
    let failing = |error: fn() -> Error| {
        install_source(
            Application::new("app")
                .option(
                    "limit",
                    Opt::string().extend([CONFIG_KEY.value("limit".to_owned())]),
                )
                .action(values),
            "@fixture/config",
            &CONFIG_KEY,
            &[],
            move |_probe: SourceProbe| {
                std::future::ready(Err::<BTreeMap<String, SourceAnswer>, Error>(error()))
            },
        )
    };
    let input = failing(|| {
        loomcli_core::InputError::new("File \"missing.json\" does not exist.", Vec::new()).into()
    });
    let ran = run_with(&input, fields(&[], &[])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (2, "app: File \"missing.json\" does not exist.\n")
    );
    let foreign = failing(|| Error::from(std::io::Error::other("disk on fire")));
    let ran = run_with(&foreign, fields(&[], &[])).await;
    assert_eq!(ran.status, 1);
    assert!(
        ran.stderr.contains(
            "Plugin \"@fixture/config\" failed in its configuration source: disk on fire."
        ),
        "{}",
        ran.stderr
    );
}

#[tokio::test]
async fn a_local_parse_fault_is_reported_ahead_of_a_source_fault() {
    let app = install_source(
        Application::new("app")
            .global_option(
                "limit",
                Opt::string().extend([CONFIG_KEY.value("limit".to_owned())]),
            )
            .action(values),
        "@fixture/config",
        &CONFIG_KEY,
        &[],
        |_probe: SourceProbe| {
            std::future::ready(Err::<BTreeMap<String, SourceAnswer>, Error>(
                loomcli_core::InputError::new("The source failed.", Vec::new()).into(),
            ))
        },
    );
    let ran = run_with(&app, fields(&["--unknown"], &[])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Unknown option \"--unknown\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
        )
    );
}

#[tokio::test]
async fn the_sources_own_options_resolve_before_the_call_and_are_never_requested() {
    let record = calls();
    let app = configured_fixture(Vec::new(), &record);
    let ran = run_with(&app, fields(&[], &[("FIXTURE_CONFIG_FILE", "env.json")])).await;
    assert_eq!(ran.status, 0);
    assert_eq!(
        seen(&record),
        [json!({ "options": { "config": "env.json" }, "requests": ["limit", "level"] })]
    );
}

#[tokio::test]
async fn a_typed_inputs_struct_reads_a_filled_value_as_a_typed_field() {
    let seen = seen_values();
    let recorded = Arc::clone(&seen);
    let app = Application::new("app")
        .option(
            "depth",
            Opt::string()
                .env(["APP_DEPTH"])
                .validate(support::validators::Number("Use digits.")),
        )
        .argument("name", Arg::string())
        .action(move |ctx: Context| {
            let depth: Result<Option<u64>, Error> = ctx.option("depth");
            if let Ok(mut seen) = recorded.lock() {
                seen.push(json!(depth.ok().flatten()));
            }
            async { Ok(()) }
        });
    let ran = run_with(&app, fields(&[], &[("APP_DEPTH", "12")])).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert_eq!(taken(&seen), [json!(12)]);
}

/// The reference's `tracing` schema: it records the working directory and the value each call
/// saw, rejects `bad`, and accepts an omission as nothing.
#[derive(Clone)]
struct Tracing(Calls);

impl Tracing {
    fn record(&self, value: Option<&str>, context: &loomcli_core::ValidationContext) {
        if let Ok(mut calls) = self.0.lock() {
            calls.push(json!({ "cwd": context.host.cwd, "value": value }));
        }
    }
}

impl loomcli_core::Validator for Tracing {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        context: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        self.record(Some(input), context);
        if input == "bad" {
            Err(vec![loomcli_core::Issue::new("Supply a good one.")])
        } else {
            Ok(input.to_owned())
        }
    }
}

impl loomcli_core::OmissionValidator for Tracing {
    fn validate_omission(
        &self,
        context: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        self.record(None, context);
        Ok("none".to_owned())
    }
}

#[tokio::test]
async fn a_dropped_fill_validates_its_omission_against_the_runs_working_directory() {
    let traced = calls();
    let app = install_source(
        Application::new("app")
            .option(
                "omitted",
                Opt::string()
                    .validate_omitted(Tracing(Arc::clone(&traced)))
                    .extend([CONFIG_KEY.value("omitted".to_owned())]),
            )
            .action(values),
        "@fixture/config",
        &CONFIG_KEY,
        &[],
        |_probe: SourceProbe| {
            std::future::ready(Ok::<_, Error>(BTreeMap::from([(
                "omitted".to_owned(),
                SourceAnswer::new(
                    SourceValue::String("bad".to_owned()),
                    "omitted in fixture.json",
                )
                .directory("/srv/project"),
            )])))
        },
    );
    let ran = run_with(&app, fields(&[], &[]).cwd("/loom-test")).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        seen(&traced),
        [
            json!({ "cwd": "/srv/project", "value": "bad" }),
            json!({ "cwd": "/loom-test", "value": null }),
        ]
    );
}

/// An application whose `input` content option the fixture source fills from `input`.
fn reading(settings: Settings, directory: Option<std::path::PathBuf>) -> App {
    let settings = Arc::new(settings);
    install_source(
        Application::new("app")
            .global_option("verbose", Opt::count().verbose().short('v'))
            .option(
                "input",
                Opt::content().extend([CONFIG_KEY.value("input".to_owned())]),
            )
            .action(|ctx: Context| async move {
                let input: Option<loomcli_core::Content> = ctx.option("input")?;
                let path = input.and_then(|input| match input.kind {
                    loomcli_core::ContentKind::File { path } => Some(path),
                    _ => None,
                });
                ctx.out.print(&json!({ "path": path }).to_string()).await
            }),
        "@fixture/config",
        &CONFIG_KEY,
        &[],
        move |probe: SourceProbe| {
            let strict = probe
                .host
                .env
                .get("FIXTURE_STRICT")
                .is_some_and(|value| value == "true");
            let answers = settings
                .iter()
                .map(|(key, value)| {
                    let answer = SourceAnswer::new(value.clone(), format!("{key} in fixture.json"));
                    let answer = match &directory {
                        Some(directory) => answer.directory(directory.clone()),
                        None => answer,
                    };
                    (
                        (*key).to_owned(),
                        if strict { answer.strict() } else { answer },
                    )
                })
                .collect::<BTreeMap<_, _>>();
            std::future::ready(Ok::<_, Error>(answers))
        },
    )
}

#[tokio::test]
async fn a_configuration_path_its_content_option_cannot_read_falls_back_and_is_named_at_v() {
    let missing = || vec![("input", SourceValue::String("absent.txt".to_owned()))];
    let ran = run_with(
        &reading(missing(), None),
        fields(&[], &[]).cwd("/loom-test"),
    )
    .await;
    assert_eq!(
        ran,
        support::Ran {
            status: 0,
            stdout: "{\"path\":null}\n".to_owned(),
            stderr: String::new(),
        }
    );
    let verbose = run_with(
        &reading(missing(), None),
        fields(&["-v"], &[]).cwd("/loom-test"),
    )
    .await;
    assert_eq!(verbose.status, 0);
    assert!(
        verbose.stderr.contains(
            "Ignored option \"--input\" from input in fixture.json: \
             Expected a readable file that exists.\n"
        ),
        "{}",
        verbose.stderr
    );
    // A path typed on the command line still fails the run.
    let typed = run_with(
        &reading(missing(), None),
        fields(&["--input", "absent.txt"], &[]).cwd("/loom-test"),
    )
    .await;
    assert_eq!(
        (typed.status, typed.stderr.as_str()),
        (
            2,
            "app: Option \"--input\": Expected a readable file that exists.\n"
        )
    );
}

#[tokio::test]
async fn a_strict_configuration_path_its_content_option_cannot_read_fails_with_its_label() {
    let app = reading(
        vec![("input", SourceValue::String("absent.txt".to_owned()))],
        None,
    );
    let ran = run_with(
        &app,
        fields(&["-v"], &[("FIXTURE_STRICT", "true")]).cwd("/loom-test"),
    )
    .await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (
            2,
            "",
            "app: Option \"--input\" (from input in fixture.json): Expected a readable file that exists.\n",
        )
    );
}

#[tokio::test]
async fn a_relative_configuration_path_for_a_content_option_resolves_against_the_answers_directory()
{
    let directory = std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("sources-reading");
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("source.txt"), "text").unwrap();
    let app = reading(
        vec![("input", SourceValue::String("source.txt".to_owned()))],
        Some(directory.clone()),
    );
    let ran = run_with(&app, fields(&[], &[]).cwd("/loom-test")).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        ran.stdout,
        format!(
            "{}\n",
            json!({ "path": directory.join("source.txt").to_string_lossy() })
        )
    );
}

#[tokio::test]
async fn an_option_the_skipped_source_would_have_filled_never_judges_its_omission() {
    let record = calls();
    let region = calls();
    let app = sourced(
        Application::new("app")
            .global_option(
                "config",
                Opt::string().default("fixture.json").validate(JsonFile),
            )
            .option(
                "region",
                Opt::string()
                    .validate_omitted(Source {
                        message: Some("Supply a region."),
                        calls: Arc::clone(&region),
                    })
                    .extend([CONFIG_KEY.value("region".to_owned())]),
            )
            .option("title", Opt::string().required())
            .action(values),
        Vec::new(),
        &record,
    );
    let ran = run_with(
        &app,
        fields(&["--config", "settings.toml", "--title", "t"], &[]),
    )
    .await;
    assert_eq!(
        ran,
        support::Ran {
            status: 2,
            stdout: String::new(),
            stderr: "app: Option \"--config\": Supply a JSON file.\n".to_owned(),
        }
    );
    assert!(seen(&record).is_empty());
    assert!(seen(&region).is_empty());
}

#[tokio::test]
async fn an_argument_named_like_an_option_the_skipped_source_would_have_filled_judges_its_omission()
{
    let record = calls();
    let file = calls();
    let app = sourced(
        Application::new("app")
            .global_option(
                "config",
                Opt::string().default("fixture.json").validate(JsonFile),
            )
            .argument(
                "file",
                Arg::string().validate_omitted(Source {
                    message: Some("Supply a file."),
                    calls: Arc::clone(&file),
                }),
            )
            .option(
                "file",
                Opt::string().extend([CONFIG_KEY.value("file".to_owned())]),
            )
            .action(values),
        Vec::new(),
        &record,
    );
    let ran = run_with(&app, fields(&["--config", "settings.toml"], &[])).await;
    assert_eq!(
        ran,
        support::Ran {
            status: 2,
            stdout: String::new(),
            stderr: "app: Option \"--config\": Supply a JSON file.\n\
                     app: Argument \"file\": Supply a file.\n"
                .to_owned(),
        }
    );
    assert!(seen(&record).is_empty());
    assert_eq!(seen(&file).len(), 1);
    assert_eq!(seen(&file)[0]["absent"], json!(true));
}

/// The fixture application's `count` Command: a required `max`, and a `total` the source fills.
fn counting(config: loomcli_core::StringOpt, record: &Calls) -> App {
    sourced(
        Application::new("app")
            .global_option(
                "limit",
                Opt::string()
                    .default("10")
                    .validate(Digits("Supply a whole number."))
                    .extend([CONFIG_KEY.value("limits.bytes".to_owned())]),
            )
            .global_option("config", config)
            .global_option(
                "level",
                Opt::string().extend([CONFIG_KEY.value("log.level".to_owned())]),
            )
            .command(
                Command::new("count")
                    .option(
                        "max",
                        Opt::string()
                            .required()
                            .validate(Digits("Supply a whole number.")),
                    )
                    .option(
                        "total",
                        Opt::boolean().extend([CONFIG_KEY.value("total".to_owned())]),
                    )
                    .action(values),
            )
            .action(values),
        Vec::new(),
        record,
    )
}

#[tokio::test]
async fn the_sources_own_options_meet_their_validator_once_per_value() {
    let record = calls();
    let echoes = calls();
    let config = Opt::string()
        .default("fixture.json")
        .validate(support::validators::Echo {
            label: "config",
            calls: Arc::clone(&echoes),
        });
    let ran = run_with(
        &counting(config, &record),
        fields(&["--config", "argv.json"], &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let calls: Vec<(Value, Value)> = seen(&echoes)
        .iter()
        .map(|call| (call["value"].clone(), call["context"]["phase"].clone()))
        .collect();
    // The declared default, validated before any token is read, then the typed value.
    assert_eq!(
        calls,
        [
            (json!("fixture.json"), json!("default")),
            (json!("argv.json"), json!("invocation")),
        ]
    );
    assert_eq!(
        seen(&record),
        [json!({ "options": { "config": "argv.json" }, "requests": ["limit", "level"] })]
    );
}

#[tokio::test]
async fn a_source_options_validator_reads_the_same_context_as_every_other_validator() {
    let record = calls();
    let echoes = calls();
    let config = Opt::string()
        .default("fixture.json")
        .validate(support::validators::Echo {
            label: "config",
            calls: Arc::clone(&echoes),
        });
    let argv = [
        "count",
        "--max",
        "7",
        "--limit",
        "3",
        "--config",
        "other.json",
    ];
    let ran = run_with(&counting(config, &record), fields(&argv, &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let invocation = seen(&echoes)
        .into_iter()
        .find(|call| call["context"]["phase"] == json!("invocation"))
        .unwrap();
    let supplied = &invocation["context"]["supplied"]["options"];
    assert_eq!(
        (&supplied["limit"], &supplied["max"]),
        (&json!("3"), &json!("7"))
    );
    assert_eq!(
        seen(&record),
        [json!({ "options": { "config": "other.json" }, "requests": ["level", "total"] })]
    );
}

#[tokio::test]
async fn under_a_local_parse_fault_a_global_options_validator_still_runs() {
    let record = calls();
    let limits = calls();
    let app = sourced(
        Application::new("app")
            .global_option("config", Opt::string().default("fixture.json"))
            .global_option(
                "limit",
                Opt::string().validate(support::validators::Echo {
                    label: "limit",
                    calls: Arc::clone(&limits),
                }),
            )
            .command(Command::new("count").action(values))
            .action(values),
        Vec::new(),
        &record,
    );
    let ran = run_with(&app, fields(&["count", "--bogus", "--limit", "many"], &[])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
        )
    );
    let calls: Vec<Value> = seen(&limits)
        .iter()
        .map(|call| call["value"].clone())
        .collect();
    assert_eq!(calls, [json!("many")]);
}

// input-sources.test.ts: activation of a plugin's middleware by a filled value.

/// A validator that accepts a lowercase word, the reference's `/^[a-z]+$/`.
#[derive(Clone)]
struct LevelName;

impl loomcli_core::Validator for LevelName {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        if !input.is_empty() && input.chars().all(|c| c.is_ascii_lowercase()) {
            Ok(input.to_owned())
        } else {
            Err(vec![loomcli_core::Issue::new("Supply a level name.")])
        }
    }
}

/// The reference's log plugin: `level`, which a variable and the configuration key `log.level`
/// fill, and `verbose`, which a variable fills. Either activates a middleware that prints the
/// global options.
fn log_plugin() -> Plugin {
    Plugin::new("@fixture/log")
        .option(
            "level",
            Opt::string()
                .env(["FIXTURE_LEVEL"])
                .extend([CONFIG_KEY.value("log.level".to_owned())])
                .validate(LevelName),
        )
        .option("verbose", Opt::boolean().env(["FIXTURE_VERBOSE"]))
        .middleware(
            Activation::options(["verbose", "level"]),
            |ctx, next| async move {
                ctx.out
                    .print(&format!("log:{}", middleware_options_json(&ctx)))
                    .await?;
                next.run().await.map(|_| ())
            },
        )
}

/// The log plugin's application under the configuration source: the source's own `config`
/// option, a `count` Command with a bound Boolean, and a `cache` group.
fn logged(settings: Settings, record: &Calls) -> App {
    sourced(
        Application::new("app")
            .plugins([log_plugin()])
            .global_option("config", Opt::string().default("fixture.json"))
            .command(
                Command::new("count")
                    .option("total", Opt::boolean().env(["FIXTURE_TOTAL"]))
                    .action(values),
            )
            .command(Command::new("cache").command(Command::new("clear").action(values)))
            .action(values),
        settings,
        record,
    )
}

/// The line of `stdout` the log middleware printed, if it ran.
fn log_line(stdout: &str) -> Option<&str> {
    stdout.lines().find(|line| line.starts_with("log:"))
}

#[tokio::test]
async fn a_plugins_option_filled_from_the_environment_activates_its_middleware_with_false_as_well()
{
    let record = calls();
    let app = logged(Vec::new(), &record);
    let on = run_with(&app, fields(&[], &[("FIXTURE_VERBOSE", "1")])).await;
    assert_eq!(
        log_line(&on.stdout),
        Some(r#"log:{"config":"fixture.json","verbose":true}"#)
    );
    let off = run_with(&app, fields(&[], &[("FIXTURE_VERBOSE", "false")])).await;
    assert_eq!(
        log_line(&off.stdout),
        Some(r#"log:{"config":"fixture.json","verbose":false}"#)
    );
    let unfilled = run_with(&app, fields(&[], &[])).await;
    assert_eq!(
        (unfilled.status, unfilled.stderr.as_str()),
        (0, ""),
        "{unfilled:?}"
    );
    assert_eq!(log_line(&unfilled.stdout), None);
}

#[tokio::test]
async fn a_dropped_fill_activates_no_middleware() {
    let record = calls();
    let loud = |level: &str| vec![("log.level", SourceValue::String(level.to_owned()))];
    let dropped = run_with(&logged(loud("LOUD1"), &record), fields(&[], &[])).await;
    assert_eq!((dropped.status, dropped.stderr.as_str()), (0, ""));
    assert_eq!(log_line(&dropped.stdout), None, "{dropped:?}");
    let filled = run_with(&logged(loud("loud"), &record), fields(&[], &[])).await;
    assert_eq!(
        log_line(&filled.stdout),
        Some(r#"log:{"config":"fixture.json","level":"loud","verbose":false}"#)
    );
}

#[tokio::test]
async fn with_a_local_parse_fault_a_plugins_option_still_fills_and_activates() {
    let record = calls();
    let app = logged(Vec::new(), &record);
    let env = [("FIXTURE_TOTAL", "1"), ("FIXTURE_VERBOSE", "1")];
    let ran = run_with(&app, fields(&["count", "--bogus"], &env)).await;
    assert_eq!(
        ran,
        support::Ran {
            status: 2,
            stdout: "log:{\"config\":\"fixture.json\",\"verbose\":true}\n".to_owned(),
            stderr: "app: Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".\n".to_owned(),
        }
    );
    assert_eq!(
        seen(&record),
        [json!({ "options": { "config": "fixture.json" }, "requests": ["level"] })]
    );
    let group = run_with(&app, fields(&["cache"], &[("FIXTURE_VERBOSE", "1")])).await;
    assert_eq!(
        group,
        support::Ran {
            status: 2,
            stdout: "log:{\"config\":\"fixture.json\",\"verbose\":true}\n".to_owned(),
            stderr: "app: Command \"cache\" requires a subcommand. Use one of: clear.\n".to_owned(),
        }
    );
}

/// The fixture's `count` application under a resolver that always fails with `error`.
fn failing_count(error: fn() -> Error) -> App {
    install_source(
        Application::new("app")
            .global_option(
                "limit",
                Opt::string().extend([CONFIG_KEY.value("limits.bytes".to_owned())]),
            )
            .command(
                Command::new("count")
                    .option("max", Opt::string().required())
                    .action(values),
            )
            .action(values),
        "@fixture/config",
        &CONFIG_KEY,
        &[],
        move |_probe: SourceProbe| {
            std::future::ready(Err::<BTreeMap<String, SourceAnswer>, Error>(error()))
        },
    )
}

#[tokio::test]
async fn an_input_error_from_the_resolver_replaces_every_other_problem() {
    let failure = "app: Option \"--config\": File \"missing.json\" does not exist.\n";
    let app = failing_count(|| {
        loomcli_core::InputError::new(
            "Option \"--config\": File \"missing.json\" does not exist.",
            Vec::new(),
        )
        .into()
    });
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (2, failure));
    // The required --max is never validated once the source has raised its own problem.
    let ran = run_with(&app, fields(&["count"], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (2, failure));
    let ran = run_with(&app, fields(&["count", "--bogus"], &[])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Unknown option \"--bogus\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
        )
    );
}

/// An application's own failure that declares a sysexits code, raised from the source.
#[derive(Debug, loomcli_core::Failure)]
#[failure(exit_code = loomcli_core::EX_UNAVAILABLE)]
struct RegistryUnavailableError {
    #[failure(base)]
    base: loomcli_core::FatalError,
}

#[tokio::test]
async fn a_failure_class_the_resolver_raises_reports_with_its_declared_code() {
    let app = failing_count(|| {
        RegistryUnavailableError {
            base: loomcli_core::FatalError::new("The settings registry is unavailable."),
        }
        .into()
    });
    let ran = run_with(&app, fields(&["count"], &[])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (69, "The settings registry is unavailable.\n")
    );
}

// input-sources.test.ts: a takeover under a held fault, cancellation around the call, and the
// ordinary channels a source writes and reads, through a plugin's own `source`.

/// A help plugin that takes over, so a held fault is never raised under it.
fn help_plugin() -> Plugin {
    Plugin::new("@fixture/help")
        .option("help", Opt::boolean().short('h'))
        .middleware(Activation::options(["help"]), |ctx, _next| async move {
            ctx.out.print("help").await
        })
}

/// How the fixture's source behaves on its call.
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Answer,
    Throw,
    InputError,
    Declared,
    Cancel,
    Warn,
    Context,
}

/// The fixture's configuration plugin: a source that prints the options it is asked about, then
/// acts as `mode` says. `token` is the caller's token, which the `Cancel` mode cancels.
fn config_plugin(
    mode: Mode,
    token: &tokio_util::sync::CancellationToken,
    printed: &Calls,
) -> Plugin {
    let token = token.clone();
    let printed = Arc::clone(printed);
    Plugin::new("@fixture/config")
        .extensions([loomcli_core::AnyExtension::from(CONFIG_KEY)])
        .source(loomcli_core::ConfigurationSource::new(
            &CONFIG_KEY,
            move |context: loomcli_core::SourceContext<NoInputs>| {
                let token = token.clone();
                let printed = Arc::clone(&printed);
                async move {
                    let names: Vec<&str> = context.requests.iter().map(|request| request.name()).collect();
                    printed.lock().unwrap().push(json!(format!("source:{}", json!({ "requests": names }))));
                    match mode {
                        Mode::Throw => {
                            return Err(Error::from_foreign("the settings file is locked".into()));
                        }
                        Mode::InputError => {
                            return Err(loomcli_core::InputError::new(
                                "Option \"--config\": File \"missing.json\" does not exist.",
                                vec![loomcli_core::InputProblem::Invalid {
                                    input: loomcli_core::InputIdentity::new(
                                        true,
                                        loomcli_core::InputKind::Option,
                                        "config",
                                    ),
                                    spelling: "--config".to_owned(),
                                    issues: vec![loomcli_core::Issue::new(
                                        "File \"missing.json\" does not exist.",
                                    )],
                                }],
                            )
                            .into());
                        }
                        Mode::Declared => {
                            return Err(RegistryUnavailableError {
                                base: loomcli_core::FatalError::new(
                                    "The settings registry is unavailable.",
                                ),
                            }
                            .into());
                        }
                        Mode::Cancel => {
                            token.cancel();
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                            printed.lock().unwrap().push(json!("source:settled"));
                        }
                        Mode::Warn => {
                            let path = context
                                .host
                                .env
                                .get("FIXTURE_WARN_PATH")
                                .cloned()
                                .unwrap_or_else(|| "a.json".to_owned());
                            context
                                .out
                                .warn(&format!(
                                    "Skipped {}: the file is not valid JSON.",
                                    context.style.escape(&path)
                                ))
                                .await?;
                        }
                        Mode::Context => {
                            let globals: Vec<bool> = context
                                .requests
                                .iter()
                                .map(|request| {
                                    context.graph.globals.iter().any(|node| **node == *request)
                                })
                                .collect();
                            let routed = context.graph.command(&["select"]).is_some_and(|select| {
                                select
                                    .options
                                    .iter()
                                    .any(|option| context.requests.iter().any(|request| **option == *request))
                            });
                            printed.lock().unwrap().push(json!(format!(
                                "context:{}",
                                json!({ "globals": globals, "name": context.graph.name, "routed": routed })
                            )));
                        }
                        Mode::Answer => {}
                    }
                    Ok(BTreeMap::new())
                }
            },
        ))
}

/// The fixture's application under the configuration plugin (unless `plain`), the help plugin,
/// and the overrides a case installs.
fn help_app(plugins: Vec<Plugin>, overrides: Vec<loomcli_core::ViewOverride>) -> App {
    let mut installed = plugins;
    installed.push(help_plugin());
    Application::new("app")
        .plugins(installed)
        .overrides(overrides)
        .global_option(
            "limit",
            Opt::string()
                .default("10")
                .env(["FIXTURE_LIMIT"])
                .validate(Digits("Supply a whole number."))
                .extend([CONFIG_KEY.value("limits.bytes".to_owned())]),
        )
        .global_option(
            "level",
            Opt::string().extend([CONFIG_KEY.value("log.level".to_owned())]),
        )
        .command(
            Command::new("count")
                .option("max", Opt::string().required())
                .action(values),
        )
        .command(
            Command::new("select")
                .option(
                    "fields",
                    Opt::string()
                        .multiple()
                        .extend([CONFIG_KEY.value("fields".to_owned())]),
                )
                .action(values),
        )
        .action(|ctx: Context| async move { ctx.out.print("root").await })
}

/// A distributed run of `app` with these words and variables, and the source's printed lines.
async fn sourced_run(app: &App, argv: &[&str], env: &[(&str, &str)]) -> support::Ran {
    run_with(
        app,
        fields(argv, env).release(loomcli_core::ReleaseFacts::new(
            loomcli_core::Build::Distributed,
        )),
    )
    .await
}

fn printed_lines(printed: &Calls) -> Vec<String> {
    seen(printed)
        .iter()
        .map(|line| line.as_str().unwrap_or_default().to_owned())
        .collect()
}

const ASKED: &str = "source:{\"requests\":[\"limit\",\"level\"]}";

#[tokio::test]
async fn a_bad_variable_and_a_failing_source_report_nothing_under_help() {
    let token = tokio_util::sync::CancellationToken::new();
    let plain = help_app(Vec::new(), Vec::new());
    assert_eq!(
        sourced_run(&plain, &["--help"], &[("FIXTURE_LIMIT", "many")]).await,
        support::Ran {
            status: 0,
            stdout: "help\n".to_owned(),
            stderr: String::new()
        }
    );
    assert_eq!(
        sourced_run(&plain, &[], &[("FIXTURE_LIMIT", "many")]).await,
        support::usage("app: Option \"--limit\" (from FIXTURE_LIMIT): Supply a whole number.")
    );
    for (mode, status, stderr) in [
        (Mode::Throw, 1, "app: Something went wrong.\n"),
        (
            Mode::InputError,
            2,
            "app: Option \"--config\": File \"missing.json\" does not exist.\n",
        ),
        (
            Mode::Declared,
            69,
            "The settings registry is unavailable.\n",
        ),
    ] {
        let printed = calls();
        let app = help_app(vec![config_plugin(mode, &token, &printed)], Vec::new());
        assert_eq!(
            sourced_run(&app, &["--help"], &[]).await,
            support::Ran {
                status: 0,
                stdout: "help\n".to_owned(),
                stderr: String::new()
            }
        );
        assert_eq!(printed_lines(&printed), [ASKED]);
        let ran = sourced_run(&app, &[], &[]).await;
        assert_eq!(
            (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
            (status, "", stderr)
        );
    }
}

#[tokio::test]
async fn an_input_error_from_the_resolver_reaches_an_override_with_its_problems() {
    let token = tokio_util::sync::CancellationToken::new();
    let printed = calls();
    let input = loomcli_core::override_view(
        loomcli_core::failure::<loomcli_core::InputError>(),
        loomcli_core::FailureView::new(|failure: &loomcli_core::InputError, _| {
            let problems: Vec<Value> = failure
                .problems()
                .iter()
                .map(|problem| match problem {
                    loomcli_core::InputProblem::Invalid { input, spelling, issues } => json!({
                        "input": input,
                        "issues": issues.iter().map(|issue| json!({ "message": issue.message })).collect::<Vec<_>>(),
                        "reason": "invalid",
                        "spelling": spelling,
                    }),
                    _ => Value::Null,
                })
                .collect();
            format!("{}\n", Value::Array(problems))
        }),
    );
    let app = help_app(
        vec![config_plugin(Mode::InputError, &token, &printed)],
        vec![input],
    );
    assert_eq!(
        sourced_run(&app, &[], &[]).await.stderr,
        "[{\"input\":{\"global\":true,\"kind\":\"option\",\"name\":\"config\"},\"issues\":[{\"message\":\"File \\\"missing.json\\\" does not exist.\"}],\"reason\":\"invalid\",\"spelling\":\"--config\"}]\n"
    );
}

#[tokio::test]
async fn a_run_cancelled_before_it_starts_calls_no_source() {
    let token = tokio_util::sync::CancellationToken::new();
    let printed = calls();
    let app = help_app(
        vec![config_plugin(Mode::Answer, &token, &printed)],
        Vec::new(),
    );
    token.cancel();
    let process = loomcli_testing::mock_process(fields(&[], &[]));
    let code = app
        .run(
            loomcli_core::RunOptions::new()
                .process(Arc::clone(&process) as _)
                .signal(token),
        )
        .await;
    assert_eq!(
        (code.get(), process.stdout_text(), process.stderr_text()),
        (130, String::new(), String::new())
    );
    assert!(printed_lines(&printed).is_empty());
}

#[tokio::test]
async fn an_abort_during_the_source_call_awaits_it_and_dispatches_nothing() {
    let token = tokio_util::sync::CancellationToken::new();
    let printed = calls();
    let app = help_app(
        vec![config_plugin(Mode::Cancel, &token, &printed)],
        Vec::new(),
    );
    let process = loomcli_testing::mock_process(fields(&[], &[]));
    let code = app
        .run(
            loomcli_core::RunOptions::new()
                .process(Arc::clone(&process) as _)
                .signal(token),
        )
        .await;
    assert_eq!(
        (code.get(), process.stdout_text(), process.stderr_text()),
        (130, String::new(), String::new())
    );
    assert_eq!(printed_lines(&printed), [ASKED, "source:settled"]);
}

#[tokio::test]
async fn the_source_reads_the_graph_inspect_returns_with_each_request_a_node_inside_it() {
    let token = tokio_util::sync::CancellationToken::new();
    let printed = calls();
    let app = help_app(
        vec![config_plugin(Mode::Context, &token, &printed)],
        Vec::new(),
    );
    let ran = sourced_run(&app, &["select"], &[]).await;
    assert_eq!(ran.status, 0, "{ran:?}");
    assert_eq!(
        printed_lines(&printed),
        [
            "source:{\"requests\":[\"limit\",\"level\",\"fields\"]}",
            "context:{\"globals\":[true,true,false],\"name\":\"app\",\"routed\":true}",
        ]
    );
}

#[tokio::test]
async fn a_source_warns_through_the_warn_lane_ahead_of_a_takeover_and_an_override_reaches_it() {
    let token = tokio_util::sync::CancellationToken::new();
    let warned = "Skipped a.json: the file is not valid JSON.\n";
    let printed = calls();
    let app = help_app(
        vec![config_plugin(Mode::Warn, &token, &printed)],
        Vec::new(),
    );
    assert_eq!(
        sourced_run(&app, &[], &[]).await,
        support::Ran {
            status: 0,
            stdout: "root\n".to_owned(),
            stderr: format!("\u{26a0} {warned}"),
        }
    );
    assert_eq!(
        sourced_run(&app, &["--help"], &[]).await,
        support::Ran {
            status: 0,
            stdout: "help\n".to_owned(),
            stderr: format!("\u{26a0} {warned}"),
        }
    );
    let overridden = help_app(
        vec![config_plugin(Mode::Warn, &token, &printed)],
        vec![loomcli_core::override_view(
            loomcli_core::lanes::warn(),
            loomcli_core::View::new(|message: &str, _| format!("warned: {message}")),
        )],
    );
    assert_eq!(
        sourced_run(&overridden, &[], &[]).await.stderr,
        format!("warned: {warned}")
    );
}

#[tokio::test]
async fn a_source_whose_binding_the_plugin_leaves_out_of_its_extensions_list_still_answers() {
    let unlisted = Plugin::new("@fixture/config").source(loomcli_core::ConfigurationSource::new(
        &CONFIG_KEY,
        |context: loomcli_core::SourceContext<NoInputs>| async move {
            let mut answers = BTreeMap::new();
            for request in &context.requests {
                if read_extension(request, &CONFIG_KEY)
                    .ok()
                    .flatten()
                    .as_deref()
                    == Some("limits.bytes")
                {
                    answers.insert(
                        request.name().to_owned(),
                        SourceAnswer::new(
                            SourceValue::String("3".to_owned()),
                            "limits.bytes in fixture.json",
                        ),
                    );
                }
            }
            Ok(answers)
        },
    ));
    let app = help_app(vec![unlisted], Vec::new());
    let ran = run_with(&app, fields(&["count", "--max", "1"], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let printed: Value = serde_json::from_str(ran.stdout.trim()).unwrap();
    assert_eq!(printed["options"]["limit"], json!("3"));
}

#[test]
fn inspect_publishes_env_on_bound_and_unbound_options_of_every_kind_in_declaration_order() {
    let graph = Application::new("app")
        .plugins([Plugin::new("@fixture/log")
            .option("level", Opt::string().env(["FIXTURE_LEVEL"]))
            .option("help", Opt::boolean())])
        .global_option("limit", Opt::string().env(["FIXTURE_LIMIT"]))
        .command(
            Command::new("count")
                .option("max", Opt::string().required().env(["FIXTURE_MAX"]))
                .option("total", Opt::boolean().env(["FIXTURE_TOTAL"]))
                .option("quiet", Opt::count().env(["FIXTURE_QUIET"]))
                .option("file", Opt::content().env(["FIXTURE_FILE"]))
                .option("title", Opt::string())
                .action(values),
        )
        .command(
            Command::new("region")
                .option(
                    "area",
                    Opt::string().env(["FIXTURE_AREA", "FIXTURE_DEFAULT_AREA"]),
                )
                .option(
                    "debug",
                    Opt::boolean().env(["FIXTURE_DEBUG", "FIXTURE_DEBUG_FALLBACK"]),
                )
                .action(values),
        )
        .action(values)
        .inspect()
        .unwrap();
    let envs = |options: &[Arc<loomcli_core::OptionNode>]| {
        options
            .iter()
            .map(|option| {
                let node = serde_json::to_value(&**option).unwrap();
                json!([option.name(), node["env"]])
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        envs(&graph.globals),
        [
            json!(["limit", ["FIXTURE_LIMIT"]]),
            json!(["level", ["FIXTURE_LEVEL"]]),
            json!(["help", []]),
        ]
    );
    assert_eq!(
        envs(&graph.command(&["count"]).unwrap().options),
        [
            json!(["max", ["FIXTURE_MAX"]]),
            json!(["total", ["FIXTURE_TOTAL"]]),
            json!(["quiet", ["FIXTURE_QUIET"]]),
            json!(["file", ["FIXTURE_FILE"]]),
            json!(["title", []]),
        ]
    );
    assert_eq!(
        envs(&graph.command(&["region"]).unwrap().options),
        [
            json!(["area", ["FIXTURE_AREA", "FIXTURE_DEFAULT_AREA"]]),
            json!(["debug", ["FIXTURE_DEBUG", "FIXTURE_DEBUG_FALLBACK"]]),
        ]
    );
}
