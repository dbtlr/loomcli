//! The explain plugin on an Application of its own: `--explain` explains the routed Command and
//! takes the invocation over, and an unknown option's report from argv points at the explanation.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use explain::explain;
use explain::extension::{EXPLAIN_COMMAND, ExplainFacts};
use loomcli_core::{
    Application, Arg, Command, Context, Done, Error, InvocationOutcome, InvocationValues,
    InvokeOptions, NoInputs, NoResult, ProcessHandle, RunOptions,
};
use loomcli_testing::{MockFields, assert_assembles, mock_process};

type App = Application<NoInputs, NoResult, Done>;

/// A notes application: a root with an explanation, `add` with one, and `list` with none.
fn notes() -> App {
    Application::new("notes")
        .plugins((explain(),))
        .description("Keep notes.")
        .extend([EXPLAIN_COMMAND.value(ExplainFacts {
            details: "Notes live in one file.".to_owned(),
            examples: None,
        })])
        .command(
            Command::new("add")
                .description("Add a note.")
                .extend([EXPLAIN_COMMAND.value(ExplainFacts {
                    details: "The note's text is one argument.".to_owned(),
                    examples: Some(vec!["notes add \"Buy milk\"".to_owned()]),
                })])
                .argument("text", Arg::string().description("The note.").required())
                .action(|ctx: Context| async move { ctx.out.print("added").await }),
        )
        .command(
            Command::new("list")
                .action(|ctx: Context| async move { ctx.out.print("listed").await }),
        )
        .action(|ctx: Context| async move { ctx.out.print("root").await })
}

async fn run(argv: &[&str]) -> (u8, String, String) {
    let process = mock_process(MockFields::new().argv(argv.iter().copied()));
    let code = notes()
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

fn printed(stdout: &str) -> (u8, String, String) {
    (0, stdout.to_owned(), String::new())
}

#[test]
fn the_plugin_assembles_and_publishes_its_option_and_extension() {
    assert_assembles(&notes());
    let graph = notes().inspect().unwrap();
    let option = &graph.globals[0];
    assert_eq!((option.name(), option.short()), ("explain", Some("-e")));
    assert_eq!(
        serde_json::to_value(&graph.root.extensions).unwrap(),
        serde_json::json!({ "@loom/explain/command": { "details": "Notes live in one file." } })
    );
}

#[tokio::test]
async fn explain_at_the_root_prints_the_application_name_description_and_details() {
    let root = printed("notes\nKeep notes.\nNotes live in one file.\n");
    assert_eq!(run(&["--explain"]).await, root);
    assert_eq!(run(&["-e"]).await, root);
}

#[tokio::test]
async fn explain_on_a_command_prints_its_path_description_details_and_examples() {
    assert_eq!(
        run(&["add", "--explain"]).await,
        printed(
            "notes add\nAdd a note.\nThe note's text is one argument.\n  notes add \"Buy milk\"\n"
        )
    );
}

#[tokio::test]
async fn a_command_with_no_explanation_prints_its_path_alone() {
    assert_eq!(run(&["list", "-e"]).await, printed("notes list\n"));
}

#[tokio::test]
async fn explain_takes_over_a_held_fault_and_runs_no_action() {
    assert_eq!(
        run(&["add", "--bogus", "--explain"]).await,
        printed(
            "notes add\nAdd a note.\nThe note's text is one argument.\n  notes add \"Buy milk\"\n"
        )
    );
}

#[tokio::test]
async fn an_unknown_option_from_argv_points_at_the_explanation() {
    assert_eq!(
        run(&["add", "x", "--bogus"]).await,
        (
            2,
            String::new(),
            "notes: Unknown option \"--bogus\". Supply a declared option, or pass it as an argument after \"--\".\nRun \"notes add --explain\" to explain this command.\n".to_owned()
        )
    );
}

#[tokio::test]
async fn another_failure_gets_no_hint() {
    assert_eq!(
        run(&["add"]).await,
        (
            2,
            String::new(),
            "notes: Argument \"text\" requires a value. Supply a value for \"text\".\n".to_owned()
        )
    );
}

#[tokio::test]
async fn an_invocation_by_name_gets_no_hint() {
    let outcome = notes()
        .invoke(
            &["add"],
            InvocationValues::new()
                .arg("text", "x")
                .option("bogus", true),
            InvokeOptions::<Error>::new(),
            Some(mock_process(MockFields::new()) as Arc<dyn ProcessHandle>),
        )
        .await;
    let InvocationOutcome::Failed { messages, .. } = outcome else {
        panic!("the invocation did not fail");
    };
    // The same failure class from argv carries the hint; by name it carries none.
    assert_eq!(
        messages,
        "notes: Unknown option \"bogus\". Supply the name of a declared option.\n"
    );
}
