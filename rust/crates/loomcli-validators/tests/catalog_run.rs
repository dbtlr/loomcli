//! Ports `catalog-run.test.ts` and the Application cases of `pipe.test.ts`, `date-time.test.ts`,
//! and `path.test.ts`: the graph reads each published schema, a default passes the validator, the
//! action receives the output, and a rejection reads its catalog sentence. The manifest document
//! belongs to the plugins package; the graph is what it reads.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use std::sync::Arc;

use loomcli_core::{
    Application, Context, Done, NoInputs, NoResult, Opt, Outcome, RunOptions, Validator,
};
use loomcli_testing::{MockFields, mock_process};
use loomcli_validators::{
    IpVersion, KeyValuePair, bytes, create_validator, date, date_time, integer, ip, key_value,
    one_of, path, pipe, time,
};
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Done>;

struct Ran {
    status: u8,
    stdout: String,
    stderr: String,
}

async fn run(app: &App, fields: MockFields) -> Ran {
    let process = mock_process(fields);
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

fn args(words: &[&str]) -> MockFields {
    MockFields::new().argv(words.iter().copied())
}

/// The schema the inspected graph carries for the root option `name`.
fn graph_schema(app: &App, name: &str) -> Value {
    let graph = app.inspect().unwrap();
    let node = graph
        .root
        .options
        .iter()
        .find(|node| node.name() == name)
        .unwrap();
    serde_json::to_value(node).unwrap()["schema"].clone()
}

fn published_of(validator: &impl Validator) -> Value {
    Value::Object(validator.input_schema().unwrap())
}

async fn upload_action(ctx: Context) -> Outcome {
    let limit: Option<u64> = ctx.option("limit").unwrap();
    let bind: Option<std::net::IpAddr> = ctx.option("bind").unwrap();
    let labels: Vec<KeyValuePair> = ctx.option("label").unwrap();
    let line = json!({
        "bind": bind.map(|address| address.to_string()),
        "labels": labels.iter().map(|pair| json!({"key": pair.key, "value": pair.value})).collect::<Vec<_>>(),
        "limit": limit,
    });
    ctx.out.print(&line.to_string()).await
}

fn upload() -> App {
    Application::new("upload")
        .option(
            "limit",
            Opt::string().default("10MB").validate(bytes().max("10GiB")),
        )
        .option("bind", Opt::string().validate(ip().version(IpVersion::V6)))
        .option("label", Opt::string().multiple().validate(key_value()))
        .action(upload_action)
}

#[test]
fn the_inspected_graph_reads_each_published_schema() {
    let app = upload();
    assert_eq!(
        graph_schema(&app, "limit"),
        published_of(&bytes().max("10GiB"))
    );
    assert_eq!(
        graph_schema(&app, "bind"),
        published_of(&ip().version(IpVersion::V6))
    );
    assert_eq!(graph_schema(&app, "label"), published_of(&key_value()));
    assert_eq!(graph_schema(&app, "bind")["format"], "ipv6");
    assert_eq!(graph_schema(&app, "label")["pattern"], r"^[\s\S]+=");
}

#[tokio::test]
async fn the_action_receives_the_byte_count_the_canonical_address_and_the_pairs_in_order() {
    let ran = run(
        &upload(),
        args(&[
            "--limit",
            "512Mi",
            "--bind",
            "2001:DB8:0:0:0:0:0:1",
            "--label",
            "a=1",
            "--label",
            "a=2",
        ]),
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let printed: Value = serde_json::from_str(ran.stdout.lines().next().unwrap()).unwrap();
    assert_eq!(
        printed,
        json!({
            "bind": "2001:db8::1",
            "labels": [{"key": "a", "value": "1"}, {"key": "a", "value": "2"}],
            "limit": 536_870_912,
        })
    );
    let fallback = run(&upload(), args(&[])).await;
    let printed: Value = serde_json::from_str(fallback.stdout.lines().next().unwrap()).unwrap();
    assert_eq!(printed["limit"], 10_000_000);
    assert_eq!(printed["labels"], json!([]));
}

#[tokio::test]
async fn a_rejected_token_reads_its_catalog_sentence_under_the_option() {
    let ran = run(&upload(), args(&["--limit", "11GiB", "--label", "nope"])).await;
    assert_eq!(ran.status, 2);
    assert!(
        ran.stderr.contains("Expected a size of at most 10GiB."),
        "{}",
        ran.stderr
    );
    assert!(
        ran.stderr
            .contains("Expected a key and a value as key=value."),
        "{}",
        ran.stderr
    );
}

async fn remind_action(ctx: Context) -> Outcome {
    let at: jiff::civil::Time = ctx
        .option::<Option<jiff::civil::Time>>("at")
        .unwrap()
        .unwrap();
    let on: String = ctx.option::<Option<String>>("on").unwrap().unwrap();
    let milliseconds = (i64::from(at.hour()) * 3600 + i64::from(at.minute()) * 60) * 1000;
    ctx.out
        .print(&json!({ "at": milliseconds, "on": on }).to_string())
        .await
}

fn remind() -> App {
    Application::new("remind")
        .option(
            "on",
            Opt::string()
                .required()
                .validate(date().layouts(["%d/%m/%Y"])),
        )
        .option(
            "at",
            Opt::string()
                .default("9:00am")
                .validate(time().layouts(["%I:%M%p"]).min("06:00")),
        )
        .action(remind_action)
}

#[tokio::test]
async fn a_layout_schema_reaches_the_graph_and_the_action_receives_the_output() {
    let app = remind();
    assert_eq!(
        graph_schema(&app, "on"),
        published_of(&date().layouts(["%d/%m/%Y"]))
    );
    assert_eq!(
        graph_schema(&app, "at"),
        published_of(&time().layouts(["%I:%M%p"]).min("06:00"))
    );
    assert_eq!(
        graph_schema(&app, "on")["anyOf"],
        json!([{"format": "date"}, {"pattern": "^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$"}])
    );
    assert_eq!(
        graph_schema(&app, "at")["anyOf"][1],
        json!({"pattern": "^[0-9]{1,2}:[0-9]{1,2}[AaPp][Mm]$"})
    );

    let ran = run(&remind(), args(&["--on", "25/9/2026", "--at", "9:30pm"])).await;
    let printed: Value = serde_json::from_str(ran.stdout.lines().next().unwrap()).unwrap();
    assert_eq!(printed, json!({"at": 77_400_000, "on": "2026-09-25"}));
    let fallback = run(&remind(), args(&["--on", "2026-09-25"])).await;
    let printed: Value = serde_json::from_str(fallback.stdout.lines().next().unwrap()).unwrap();
    assert_eq!(printed, json!({"at": 32_400_000, "on": "2026-09-25"}));

    let rejected = run(&remind(), args(&["--on", "31/04/2026", "--at", "5:00am"])).await;
    assert_eq!(rejected.status, 2);
    assert!(
        rejected
            .stderr
            .contains("Expected a date as YYYY-MM-DD or DD/MM/YYYY, such as 2026-09-25."),
        "{}",
        rejected.stderr
    );
    assert!(
        rejected
            .stderr
            .contains("Expected a time of at least 06:00."),
        "{}",
        rejected.stderr
    );
}

#[tokio::test]
async fn a_run_reports_a_rejected_date_time_as_invalid_input_with_the_sentence() {
    let app: App = Application::new("probe")
        .option("at", Opt::string().required().validate(date_time()))
        .action(|ctx: Context| async move {
            let at: jiff::Timestamp = ctx
                .option::<Option<jiff::Timestamp>>("at")
                .unwrap()
                .unwrap();
            ctx.out.print(&at.to_string()).await
        });
    let ran = run(&app, args(&["--at=2026-02-30T10:00:00"]).time_zone("UTC")).await;
    assert_eq!(ran.status, 2);
    assert_eq!(ran.stdout, "");
    assert_eq!(
        ran.stderr,
        "probe: Option \"--at\": Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.\n"
    );
    let ok = run(
        &app,
        args(&["--at=2026-09-25T14:30:00"]).time_zone("Asia/Tokyo"),
    )
    .await;
    assert_eq!(
        (ok.status, ok.stdout.as_str()),
        (0, "2026-09-25T05:30:00Z\n")
    );
}

#[tokio::test]
async fn a_run_reports_a_rejected_path_as_invalid_input_with_the_sentence() {
    let app: App = Application::new("probe")
        .option("target", Opt::string().validate(path()))
        .action(|ctx: Context| async move {
            let target: Option<std::path::PathBuf> = ctx.option("target").unwrap();
            ctx.out.print(&format!("{target:?}")).await
        });
    let ran = run(&app, args(&["--target="]).cwd("/loom/work")).await;
    assert_eq!(ran.status, 2);
    assert_eq!(ran.stdout, "");
    assert_eq!(
        ran.stderr,
        "probe: Option \"--target\": Expected a nonempty path with no NUL character.\n"
    );
    let ok = run(&app, args(&["--target", "a/../b"]).cwd("/loom/work")).await;
    assert_eq!(
        (ok.status, ok.stdout.as_str()),
        (0, "Some(\"/loom/work/b\")\n")
    );
}

#[tokio::test]
async fn a_pipe_publishes_firsts_schema_and_checks_each_value_of_a_multiple_option() {
    let even = pipe(
        integer().min(2),
        |count: i64, _context: &loomcli_core::ValidationContext| {
            if count % 2 == 0 {
                Ok(count)
            } else {
                Err(vec![loomcli_core::Issue::new("Expected an even number.")])
            }
        },
    );
    let app: App = Application::new("pairs")
        .option("size", Opt::string().multiple().validate(even))
        .action(|ctx: Context| async move {
            let sizes: Vec<i64> = ctx.option("size").unwrap();
            ctx.out.print(&json!(sizes).to_string()).await
        });
    assert_eq!(graph_schema(&app, "size"), published_of(&integer().min(2)));
    let ok = run(&app, args(&["--size", "4", "--size", "8"])).await;
    assert_eq!((ok.status, ok.stdout.as_str()), (0, "[4,8]\n"));
    let rejected = run(&app, args(&["--size", "4", "--size", "3"])).await;
    assert_eq!(rejected.status, 2);
    assert!(
        rejected.stderr.contains("Expected an even number."),
        "{}",
        rejected.stderr
    );
}

#[tokio::test]
async fn a_custom_validator_without_a_schema_publishes_null() {
    let plain =
        create_validator(|raw: &str, _context: &loomcli_core::ValidationContext| Ok(raw.len()));
    let app: App = Application::new("plain")
        .option("word", Opt::string().validate(plain))
        .action(|ctx: Context| async move { ctx.out.print("ok").await });
    assert_eq!(graph_schema(&app, "word"), Value::Null);
}

/// A first stage that judges the omission of its input and answers "fallback" for it.
struct Defaulted;

impl Validator for Defaulted {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _context: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        Ok(input.to_owned())
    }
}

impl loomcli_core::OmissionValidator for Defaulted {
    fn validate_omission(
        &self,
        _context: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        Ok("fallback".to_owned())
    }
}

#[tokio::test]
async fn an_omission_aware_first_sits_beside_validate_omitted_through_a_pipe() {
    let named = pipe(
        Defaulted,
        |raw: String, _context: &loomcli_core::ValidationContext| Ok(raw.to_uppercase()),
    );
    let app: App = Application::new("greet")
        .option("name", Opt::string().validate_omitted(named))
        .action(|ctx: Context| async move {
            let name: String = ctx.option::<Option<String>>("name").unwrap().unwrap();
            ctx.out.print(&format!("hello {name}")).await
        });
    let omitted = run(&app, args(&[])).await;
    assert_eq!(
        (
            omitted.status,
            omitted.stdout.as_str(),
            omitted.stderr.as_str()
        ),
        (0, "hello FALLBACK\n", "")
    );
    let given = run(&app, args(&["--name", "ada"])).await;
    assert_eq!((given.status, given.stdout.as_str()), (0, "hello ADA\n"));
}

#[tokio::test]
async fn a_run_rejecting_a_one_of_option_escapes_control_characters_in_the_declared_values() {
    let app: App = Application::new("probe")
        .option(
            "mode",
            Opt::string()
                .required()
                .validate(one_of(["a\u{1b}[31mb", "c\u{202e}d"])),
        )
        .action(|ctx: Context| async move { ctx.out.print("unreached").await });
    let ran = run(&app, args(&["--mode", "other"])).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (
            2,
            "",
            "probe: Option \"--mode\": Expected one of: a\\u001b[31mb, c\\u202ed.\n"
        )
    );
}
