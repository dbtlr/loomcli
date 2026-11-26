//! Ports the `settings and the graph` cases of `service.test.ts`: the label's grammar at the call,
//! and the run words that must route to a Command with an action on every graph build.

#![cfg(feature = "service")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use loomcli_core::{
    Application, Build, Command, Context, DeclarationError, FailureFacts, Group, NoInputs,
    NoResult, Opt, ProcessHandle, ReleaseFacts, RunOptions,
};
use loomcli_plugins::service::service;
use loomcli_testing::{MockFields, mock_process};

type App = Application<NoInputs, NoResult, Group>;

/// An application whose `service()` runs `words`, beside a Command with options and a group.
fn graph_application(words: &[&str]) -> App {
    Application::new("notes")
        .plugins((service("com.acme.notes", words.iter().copied()),))
        .description("Keep notes in sync.")
        .command(
            Command::new("serve")
                .passthrough(loomcli_core::Passthrough::new())
                .description("Serve the notes.")
                .option("port", Opt::string().description("The port to serve on."))
                .option("verbose", Opt::boolean().description("Write more."))
                .action(|context: Context| async move { context.out.print("serving").await }),
        )
        .command(
            Command::new("cache")
                .description("Manage the cache.")
                .command(
                    Command::new("clear")
                        .description("Clear the cache.")
                        .action(
                            |context: Context| async move { context.out.print("cleared").await },
                        ),
                ),
        )
}

const UNROUTED_CORRECTION: &str =
    "Name the words of a Command that has an action, as the application's command line takes them.";

fn unrouted_sentence(words: &str) -> String {
    format!(
        "Plugin \"@loomcli/plugins/service\" setting \"run\" does not route to a Command with an action: {words}."
    )
}

fn only_fault(faults: &[DeclarationError]) -> &DeclarationError {
    assert_eq!(faults.len(), 1, "{faults:?}");
    &faults[0]
}

#[test]
fn run_words_that_route_nowhere_fail_the_build_with_run_unrouted_and_check_reports_it() {
    let cases: [(&str, &[&str]); 6] = [
        ("an unknown Command", &["bogus"]),
        ("a group", &["cache"]),
        ("an unknown option", &["serve", "--bogus"]),
        ("a misplaced option", &["--port", "8080", "serve"]),
        ("an unexpected argument", &["serve", "extra"]),
        ("an option with no value", &["serve", "--port"]),
    ];
    for (name, words) in cases {
        let application = graph_application(words);
        let faults = application.check();
        let fault = only_fault(&faults);
        assert_eq!(
            fault.rule().map(|rule| rule.identity()),
            Some("@loomcli/plugins/service/run-unrouted"),
            "{name}"
        );
        assert_eq!(
            fault.sentence(),
            unrouted_sentence(&words.join(" ")),
            "{name}"
        );
        let inspected = application.inspect().expect_err(name);
        assert_eq!(inspected.sentence(), fault.sentence(), "{name}");
        assert!(
            inspected.message().contains(UNROUTED_CORRECTION),
            "{name}: {}",
            inspected.message()
        );
    }
}

async fn run_graph(words: &[&str], build: Build) -> (u8, String, String) {
    let process = mock_process(
        MockFields::new()
            .argv(["serve"])
            .release(ReleaseFacts::new(build)),
    );
    let code = graph_application(words)
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[tokio::test]
async fn a_distributed_run_of_unrouted_words_fails_generically() {
    let (status, stdout, stderr) = run_graph(&["bogus"], Build::Distributed).await;
    assert_eq!(
        (status, stdout.as_str(), stderr.as_str()),
        (1, "", "notes: Something went wrong.\n")
    );
}

#[tokio::test]
async fn a_development_build_renders_the_run_unrouted_developer_diagnostic() {
    let (status, stdout, stderr) = run_graph(&["bogus"], Build::Development).await;
    assert_eq!(status, 1);
    assert_eq!(stdout, "");
    assert!(
        stderr.contains("@loomcli/plugins/service/run-unrouted"),
        "{stderr}"
    );
    assert!(stderr.contains(&unrouted_sentence("bogus")), "{stderr}");
    assert!(stderr.contains(UNROUTED_CORRECTION), "{stderr}");
}

#[tokio::test]
async fn run_words_that_end_in_passthrough_words_or_name_a_nested_command_route_and_pass() {
    let cases: [&[&str]; 5] = [
        &["serve", "--", "a", "b"],
        &["serve", "--"],
        &["serve", "--port", "8080"],
        &["serve", "--verbose", "--port=1"],
        &["cache", "clear"],
    ];
    for words in cases {
        assert!(graph_application(words).check().is_empty(), "{words:?}");
        let (status, _, stderr) = run_graph(words, Build::Distributed).await;
        assert_eq!(status, 0, "{words:?}: {stderr}");
    }
}

/// The diagnostic a call panics with, or none when it returns.
fn panic_message(call: impl FnOnce()) -> Option<String> {
    catch_unwind(AssertUnwindSafe(call)).err().map(|payload| {
        payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| {
                payload
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
            })
            .unwrap_or_default()
    })
}

#[test]
fn the_label_follows_the_grammar_at_the_call() {
    let longest = format!("a.{}", "b".repeat(245));
    let too_long = format!("a.{}", "b".repeat(246));
    let cases = [
        ("com.acme.notes", true),
        ("a.b", true),
        ("A1.b-2.c--d", true),
        ("notes", false),
        (".com.acme", false),
        ("com..acme", false),
        ("com.acme.", false),
        ("com.-acme", false),
        ("com.acme_notes", false),
        ("com.acm\u{e9}", false),
        (longest.as_str(), true),
        (too_long.as_str(), false),
    ];
    for (label, valid) in cases {
        let message = panic_message(|| drop(service(label, ["serve"])));
        assert_eq!(message.is_none(), valid, "{label}");
        if let Some(message) = message {
            assert!(
                message.contains("@loomcli/plugins/service/settings"),
                "{message}"
            );
            assert!(
                message.contains(
                    "Plugin \"@loomcli/plugins/service\" setting \"label\" is not a reverse-DNS name."
                ),
                "{message}"
            );
            assert!(
                message.contains("Supply a label such as com.acme.notes."),
                "{message}"
            );
        }
    }
}
