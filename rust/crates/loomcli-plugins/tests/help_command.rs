//! The help Command, ported from the reference's `help-command.test.ts`: `help <command>` prints
//! the page `--help` after that path prints.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use std::sync::{Arc, Mutex};

use help_support::{Outcome, noop, panic_message, run, run_with};
use loomcli_core::{
    Application, Command, InvocationOutcome, InvocationValues, InvokeOptions, NoInputs, NoResult,
    ProcessHandle, RunOptions,
};
use loomcli_plugins::help::{Help, help};
use loomcli_testing::{MockFields, MockTerminal, ProgramAnswer, ProgramCall, mock_process};
use tokio_util::sync::CancellationToken;

type App = loomcli_core::GroupApplication<NoInputs, NoResult>;

/// One of the notes Commands, which does nothing.
fn note(name: &str, description: &str) -> Command {
    Command::new(name).description(description).action(noop)
}

/// An application with a leaf, an aliased group with a child, a hidden leaf, and a deprecated
/// leaf.
fn notes(settings: Help) -> App {
    Application::new("notes")
        .plugins((settings,))
        .description("Keep notes in a folder.")
        .command(note("add", "Add a note."))
        .command(
            Command::new("cache")
                .description("Manage the cache.")
                .alias("c")
                .command(note("clear", "Empty the cache.")),
        )
        .command(
            Command::new("debug")
                .description("Dump state.")
                .hidden()
                .action(noop),
        )
        .command(
            Command::new("old")
                .deprecated("Use add instead.")
                .description("Add, the old way.")
                .action(noop),
        )
}

fn names(application: &App) -> Vec<String> {
    application
        .inspect()
        .unwrap()
        .root
        .children
        .iter()
        .filter_map(|child| child.name.clone())
        .collect()
}

#[test]
fn with_no_setting_or_command_false_help_attaches_no_command() {
    for settings in [help(), help().command(false)] {
        assert_eq!(names(&notes(settings)), ["add", "cache", "debug", "old"]);
    }
}

#[tokio::test]
async fn help_words_print_the_page_help_after_their_path_prints() {
    let application = notes(help().command(true));
    let cases: [(&[&str], &[&str]); 8] = [
        (&[], &[]),
        (&["add"], &["add"]),
        (&["cache"], &["cache"]),
        (&["cache", "clear"], &["cache", "clear"]),
        (&["c", "clear"], &["cache", "clear"]),
        (&["debug"], &["debug"]),
        (&["old"], &["old"]),
        (&["help"], &["help"]),
    ];
    for (words, path) in cases {
        let mut argv: Vec<&str> = path.to_vec();
        argv.push("--help");
        let expected = run(&application, &argv).await;
        assert_eq!(expected.status, 0);
        let mut argv = vec!["help"];
        argv.extend_from_slice(words);
        assert_eq!(run(&application, &argv).await, expected, "help {words:?}");
    }
}

#[tokio::test]
async fn the_root_page_lists_the_help_command_first() {
    let outcome = run(&notes(help().command(true)), &["--help"]).await;
    assert!(
        outcome.stdout.contains(
            &[
                "COMMANDS",
                "  help             Show help for a command.",
                "  add              Add a note.",
                "  cache <command>  Manage the cache.",
            ]
            .join("\n")
        )
    );
}

#[tokio::test]
async fn the_help_commands_own_page_states_its_usage_and_its_argument() {
    assert_eq!(
        run(&notes(help().command(true)), &["help", "--help"]).await,
        help_support::page(&[
            "notes help · Show help for a command.",
            "",
            "USAGE",
            "  notes help [command...] [options]",
            "",
            "ARGUMENTS",
            "  command  The command to show help for, as you would type it. The application itself when left out.",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help  Show this help.",
        ])
    );
}

#[tokio::test]
async fn a_word_that_names_no_command_fails_as_an_unknown_command_and_prints_no_page() {
    let application = notes(help().command(true));
    let cases: [(&[&str], &str); 3] = [
        (
            &["gte"],
            "Unknown command \"gte\". Use one of: help, add, cache.",
        ),
        (
            &["cache", "clera"],
            "Unknown command \"clera\". Use one of: clear.",
        ),
        (
            &["add", "extra"],
            "Unknown command \"extra\". Supply the name of a declared command.",
        ),
    ];
    for (words, sentence) in cases {
        let mut argv = vec!["help"];
        argv.extend_from_slice(words);
        assert_eq!(
            run(&application, &argv).await,
            Outcome {
                status: 2,
                stdout: String::new(),
                stderr: format!("notes: {sentence}\nRun \"notes help --help\" to see the usage.\n"),
            }
        );
    }
}

#[test]
fn an_own_root_command_named_or_aliased_help_collides_with_the_help_command() {
    let named = panic_message(|| drop(notes(help().command(true)).command(note("help", "Mine."))));
    assert!(named.unwrap().contains("sibling-name-taken"));
    let aliased = panic_message(|| {
        drop(
            notes(help().command(true)).command(
                Command::new("assist")
                    .description("Mine.")
                    .alias("help")
                    .action(noop),
            ),
        );
    });
    assert!(aliased.unwrap().contains("sibling-name-taken"));
}

#[test]
fn an_own_help_command_installs_beside_help_with_the_setting_off() {
    let application = notes(help()).command(note("help", "Mine."));
    assert!(names(&application).contains(&"help".to_owned()));
}

/// A terminal of five rows with a `TERM` that draws.
fn short_terminal(fields: MockFields) -> MockFields {
    fields
        .env("TERM", "xterm-256color")
        .terminal(MockTerminal::new(80, 5))
}

#[tokio::test]
async fn with_paging_on_a_long_page_from_the_help_command_goes_to_the_pager() {
    let (page, _) = run_with(
        &notes(help().command(true)),
        short_terminal(MockFields::new().argv(["--help"])),
        None,
    )
    .await;
    let calls: Arc<Mutex<Vec<ProgramCall>>> = Arc::default();
    let recorded = Arc::clone(&calls);
    let fields = short_terminal(MockFields::new().argv(["help"])).script("/bin/sh", move |call| {
        recorded.lock().unwrap().push(call);
        async { Ok(ProgramAnswer::new()) }
    });
    let (outcome, _) = run_with(&notes(help().command(true).paging(true)), fields, None).await;
    assert_eq!(outcome.status, 0);
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].args, ["-c", "exec less"]);
    assert_eq!(calls[0].input, page.stdout);
    assert_eq!(outcome.stdout, "");
}

#[tokio::test]
async fn a_run_cancelled_while_the_pager_is_open_ends_the_pager_and_resolves_130() {
    let controller = CancellationToken::new();
    let ended: Arc<Mutex<Option<CancellationToken>>> = Arc::default();
    let (cancel, mark) = (controller.clone(), Arc::clone(&ended));
    let fields = short_terminal(MockFields::new().argv(["help"])).script("/bin/sh", move |call| {
        let (cancel, mark) = (cancel.clone(), Arc::clone(&mark));
        async move {
            cancel.cancel();
            // The pager's own signal is cancelled when the run ends it.
            *mark.lock().unwrap() = Some(call.signal.clone());
            call.signal.cancelled().await;
            Ok(ProgramAnswer::new().code(143))
        }
    });
    let process = mock_process(fields);
    let code = notes(help().command(true).paging(true))
        .run(
            RunOptions::new()
                .process(Arc::clone(&process) as Arc<dyn ProcessHandle>)
                .signal(controller),
        )
        .await;
    assert_eq!(code.get(), 130);
    assert!(
        ended
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
    );
    assert_eq!(process.stdout_text(), "");
}

#[tokio::test]
async fn an_invocation_by_name_captures_the_same_page() {
    let application = notes(help().command(true));
    let expected = run(&application, &["cache", "--help"]).await;
    let outcome = application
        .invoke(
            &["help"],
            InvocationValues::new().arg("command", vec!["cache"]),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new()) as Arc<dyn ProcessHandle>),
        )
        .await;
    match outcome {
        InvocationOutcome::Completed { output, .. } => assert_eq!(output, expected.stdout),
        _ => panic!("the help Command completes"),
    }
}

#[tokio::test]
async fn a_word_after_the_delimiter_is_an_argument_of_the_help_command() {
    let app = notes(help().command(true));
    let expected = run(&app, &["add", "--help"]).await;
    assert_eq!(expected.status, 0);
    assert_eq!(run(&app, &["help", "--", "add"]).await, expected);
}
