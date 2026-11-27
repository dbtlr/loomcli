//! The dotenv plugin's verbosity, skip reasons, and event fields.

use std::sync::{Arc, Mutex};

use loomcli_core::{LogEvent, LogLevel, Plugin};
use loomcli_plugins::verbose::verbose;

use super::*;

const LAYERED: &[(&str, &str)] = &[
    (
        ".env",
        "DATABASE_URL=postgres://localhost/notes\nLOG_LEVEL=info\n",
    ),
    (
        ".env.development",
        "API_TOKEN=from-file\nDATABASE_URL=postgres://dev/notes\nSYNC_URL=https://dev\n",
    ),
];
const DEVELOPMENT: &[(&str, &str)] = &[("NODE_ENV", "development"), ("API_TOKEN", "set")];
const IMPORTS: &str =
    "› Imported 2 variables from .env.development.\n› Imported 1 variable from .env.\n";

fn app(plugin: Plugin, events: Arc<Mutex<Vec<LogEvent>>>) -> App {
    let observer = Plugin::new("fixture/observer").on_log(move |event, _| {
        events.lock().unwrap().push(event.clone());
    });
    Application::new("notes")
        .plugins((plugin, verbose(), observer))
        .action(|_: Context| async { Ok(()) })
}

fn fields(scratch: &Scratch, files: &[(&str, &str)], env: &[(&str, &str)]) -> MockFields {
    for (name, value) in files {
        fs::write(scratch.0.join(name), value).unwrap();
    }
    env.iter().fold(
        MockFields::new().cwd(&scratch.0),
        |fields, (name, value)| fields.env(name, value),
    )
}

async fn run(
    files: &[(&str, &str)],
    env: &[(&str, &str)],
    argv: &[&str],
    plugin: Plugin,
) -> (String, Vec<LogEvent>) {
    let scratch = Scratch::new();
    let mock = mock_process(fields(&scratch, files, env).argv(argv.iter().copied()));
    let events = Arc::new(Mutex::new(Vec::new()));
    assert_eq!(
        app(plugin, Arc::clone(&events))
            .run(RunOptions::new().process(mock.clone()))
            .await
            .get(),
        0
    );
    let events = events.lock().unwrap().clone();
    (mock.stderr_text(), events)
}

async fn stderr(files: &[(&str, &str)], env: &[(&str, &str)], argv: &[&str]) -> String {
    run(files, env, argv, dotenv().plugin()).await.0
}

#[tokio::test]
async fn the_default_verbosity_adds_no_line() {
    assert_eq!(stderr(LAYERED, DEVELOPMENT, &[]).await, "");
}

#[tokio::test]
async fn verbose_counts_imports_from_most_to_least_specific() {
    assert_eq!(stderr(LAYERED, DEVELOPMENT, &["-v"]).await, IMPORTS);
}

#[tokio::test]
async fn trace_names_each_skipped_variable_after_its_file() {
    assert_eq!(
        stderr(LAYERED, DEVELOPMENT, &["-vv"]).await,
        concat!(
            "› Imported 2 variables from .env.development.\n",
            "  ┆ Skipped API_TOKEN from .env.development: already set.\n",
            "› Imported 1 variable from .env.\n",
            "  ┆ Skipped DATABASE_URL from .env: already set from .env.development.\n",
        ),
    );
}

#[tokio::test]
async fn lists_take_precedence_over_the_environment() {
    let files = &[(".env", "API_TOKEN=a\nPATH=/opt/bin\nHOME=/fixture\n")];
    assert_eq!(
        run(
            files,
            &[("PATH", "/usr/bin")],
            &["-vv"],
            dotenv().except(["PATH"]).plugin()
        )
        .await
        .0,
        "› Imported 2 variables from .env.\n  ┆ Skipped PATH from .env: on the except list.\n",
    );
    assert_eq!(
        run(
            files,
            &[("HOME", "/home/me")],
            &["-vv"],
            dotenv().only(["API_TOKEN"]).plugin()
        )
        .await
        .0,
        concat!(
            "› Imported 1 variable from .env.\n",
            "  ┆ Skipped PATH from .env: not on the only list.\n",
            "  ┆ Skipped HOME from .env: not on the only list.\n",
        ),
    );
}

#[tokio::test]
async fn lists_and_environment_take_precedence_over_a_more_specific_file() {
    let files = &[
        (".env", "API_TOKEN=two\nPATH=/opt/two\n"),
        (".env.local", "API_TOKEN=one\nPATH=/opt/one\n"),
    ];
    assert_eq!(
        run(
            files,
            &[("API_TOKEN", "set")],
            &["-vv"],
            dotenv().except(["PATH"]).plugin()
        )
        .await
        .0,
        concat!(
            "  ┆ Skipped API_TOKEN from .env.local: already set.\n",
            "  ┆ Skipped PATH from .env.local: on the except list.\n",
            "  ┆ Skipped API_TOKEN from .env: already set.\n",
            "  ┆ Skipped PATH from .env: on the except list.\n",
        ),
    );
}

#[tokio::test]
async fn an_empty_environment_value_is_set_and_an_empty_import_has_no_debug_line() {
    assert_eq!(
        stderr(&[(".env", "API_TOKEN=a\n")], &[("API_TOKEN", "")], &["-vv"]).await,
        "  ┆ Skipped API_TOKEN from .env: already set.\n",
    );
}

#[tokio::test]
async fn a_repeated_name_is_counted_once_in_its_first_position() {
    assert_eq!(
        stderr(
            &[(".env", "BETA=1\nALPHA=2\nBETA=3\n")],
            &[("BETA", "set")],
            &["-vv"]
        )
        .await,
        "› Imported 1 variable from .env.\n  ┆ Skipped BETA from .env: already set.\n",
    );
}

#[tokio::test]
async fn a_malformed_assignment_keeps_its_warning_and_a_missing_file_is_silent() {
    assert_eq!(
        stderr(&[(".env", "API_TOKEN=\"open\n")], &[], &["-vv"]).await,
        "⚠ Skipped API_TOKEN on line 1 of .env: the line is not a valid assignment. Correct the line, or remove it.\n",
    );
    assert_eq!(stderr(&[], &[], &["-vv"]).await, "");
}

#[tokio::test]
async fn output_and_events_hold_no_values_and_record_no_change_event() {
    let secret = "fixture-secret-0123456789";
    let assignment = format!("API_TOKEN={secret}\n");
    let (stderr, events) = run(
        &[(".env", &assignment), (".env.local", &assignment)],
        &[],
        &["-vv"],
        dotenv().plugin(),
    )
    .await;
    assert_eq!(
        stderr,
        "› Imported 1 variable from .env.local.\n  ┆ Skipped API_TOKEN from .env: already set from .env.local.\n",
    );
    assert!(!serde_json::to_string(&events).unwrap().contains(secret));
    assert_eq!(
        events
            .iter()
            .map(|event| (event.level, event.message.as_str()))
            .collect::<Vec<_>>(),
        [
            (LogLevel::Debug, "Imported {count} variable from {file}."),
            (
                LogLevel::Trace,
                "Skipped {name} from {file}: already set from {specific}."
            ),
        ],
    );
}

#[tokio::test]
async fn a_control_character_in_the_filename_is_escaped() {
    assert_eq!(
        stderr(
            &[(".env.te\u{7}st", "A=1\n")],
            &[("NODE_ENV", "te\u{7}st")],
            &["-v"]
        )
        .await,
        "› Imported 1 variable from .env.te\\u0007st.\n",
    );
}

#[tokio::test]
async fn quiet_subtracts_one_verbosity_step() {
    assert_eq!(stderr(LAYERED, DEVELOPMENT, &["-v", "-q"]).await, "");
    assert_eq!(stderr(LAYERED, DEVELOPMENT, &["-vv", "-q"]).await, IMPORTS);
}

#[tokio::test]
async fn a_named_invocation_captures_its_verbose_line() {
    let scratch = Scratch::new();
    let app = app(dotenv().plugin(), Arc::new(Mutex::new(Vec::new())));
    for (verbose, expected) in [(0, ""), (1, "› Imported 1 variable from .env.\n")] {
        let mock = mock_process(fields(&scratch, &[(".env", "API_TOKEN=a\n")], &[]));
        let outcome = app
            .invoke(
                &[],
                InvocationValues::new().option("verbose", verbose),
                InvokeOptions::new(),
                Some(mock),
            )
            .await;
        assert!(
            matches!(outcome, InvocationOutcome::Completed { messages, .. } if messages == expected)
        );
    }
}
