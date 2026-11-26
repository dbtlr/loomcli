//! The formatter's hidden group options through help, routing, and completion.

#![cfg(all(feature = "format", feature = "help"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod format_support;

use loomcli_core::{
    AnyPlugin, Application, Command, Context, Group, NoInputs, NoResult, Opt, ResultViews,
    ValueResult, View, WordPosition, locate,
};
use loomcli_plugins::{format::format, help::help};

use format_support::{failure_line, ran, run};

fn list() -> Command<NoInputs, ValueResult<String>> {
    Command::new("list")
        .result(
            ResultViews::new().view("text", View::new(|value: &String, _| format!("{value}\n"))),
        )
        .action(|ctx: Context<NoInputs, ValueResult<String>>| async move {
            ctx.out.results("a".to_owned()).await
        })
}

fn notes() -> Application<NoInputs, NoResult, Group> {
    Application::new("notes")
        .plugins([AnyPlugin::from(help()), format().into()])
        .command(list())
        .command(Command::new("plain").action(|_: Context| async { Ok(()) }))
        .command(
            Command::new("export")
                .option("format", Opt::string())
                .action(|ctx: Context| async move {
                    let format = ctx.option::<Option<String>>("format")?.unwrap_or_default();
                    ctx.out.print(&format!("export:{format}")).await
                }),
        )
}

const MISSING: &str = "A command is required. Use one of: list, plain, export.";
const ROOT_HINT: &str = "Run \"notes --help\" to see the usage.";

#[tokio::test]
async fn a_group_format_selects_the_failure_encoder() {
    for name in ["json", "jsonl", "ndjson"] {
        assert_eq!(
            run(&notes(), &["--format", name]).await,
            ran(
                2,
                "",
                &failure_line("missing-subcommand", 2, MISSING, &[ROOT_HINT])
            )
        );
    }
}

#[tokio::test]
async fn a_rejected_group_format_leaves_the_held_failure_in_text() {
    assert_eq!(
        run(&notes(), &["--format", "yaml"]).await,
        ran(2, "", &format!("notes: {MISSING}\n{ROOT_HINT}\n"))
    );
}

#[tokio::test]
async fn a_format_before_a_child_name_selects_its_view() {
    assert_eq!(
        run(&notes(), &["--format", "json", "list"]).await,
        ran(0, "\"a\"\n", "")
    );
}

#[tokio::test]
async fn a_format_before_a_child_without_that_option_is_unknown_on_the_child() {
    assert_eq!(
        run(&notes(), &["--format", "json", "plain"]).await,
        ran(
            2,
            "",
            "notes: Unknown option \"--format\". Supply a declared option; prefix a hyphenated path with \"./\".\nRun \"notes plain --help\" to see the usage.\n"
        )
    );
}

#[tokio::test]
async fn a_childs_own_format_option_takes_the_occurrence() {
    assert_eq!(
        run(&notes(), &["--format", "csv", "export"]).await,
        ran(0, "export:csv\n", "")
    );
}

#[tokio::test]
async fn group_format_is_hidden_in_help_and_marked_hidden_in_the_graph() {
    let app = notes();
    let page = run(&app, &["--help"]).await;
    assert_eq!((page.status, page.stderr.as_str()), (0, ""));
    assert!(!page.stdout.contains("--format"));
    assert!(
        app.inspect()
            .unwrap()
            .root
            .options
            .iter()
            .any(|option| option.name() == "format" && option.hidden())
    );
}

#[test]
fn locate_completes_values_and_children_after_a_hidden_format() {
    let graph = notes().inspect().unwrap();
    match locate(&graph, &["--format", ""]) {
        WordPosition::Value {
            command, option, ..
        } => {
            assert!(command.path.is_empty());
            assert_eq!(option.name(), "format");
        }
        other => panic!("expected option value, got {other:?}"),
    }
    assert!(
        matches!(locate(&graph, &["--format", "json", ""]), WordPosition::Command { command, .. } if command.path.is_empty())
    );
}

#[cfg(feature = "completion")]
#[tokio::test]
async fn completion_offers_only_json_and_jsonl_for_the_group() {
    let app = Application::new("notes")
        .plugins([
            AnyPlugin::from(format()),
            loomcli_plugins::completion::completion().into(),
        ])
        .command(list());
    assert_eq!(
        run(&app, &["completion", "__complete", "--", "--format", ""]).await,
        ran(0, "json\njsonl\n:4\n", "")
    );
}
