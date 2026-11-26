//! The plugins installed together: the twelve the reference jsonkit example and its interaction
//! switch install build one graph without a collision fault, and the help page lists each one's
//! Commands and options where `docs/plugins/help-page.md` places them. No reference file covers
//! the set; the expected pages are written by hand from the page rules: plugin Commands ahead of
//! the application's own in installation order, globals in `graph.globals` order under GLOBAL
//! OPTIONS on a root with children, a counted option with `...`, the quiet option without it, and
//! a negative Boolean as `--no-<name>` with the fact `default: true`.

#![cfg(all(
    feature = "help",
    feature = "suggestions",
    feature = "version",
    feature = "format",
    feature = "manifest",
    feature = "theme",
    feature = "color",
    feature = "verbose",
    feature = "interaction",
    feature = "completion",
    feature = "mcp",
    feature = "manpage"
))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{Outcome, page, run};
use loomcli_core::{
    Application, Command, Context, NoInputs, ResultViews, ThemeMapping, ValueResult, View,
};
use loomcli_plugins::color::color;
use loomcli_plugins::completion::completion;
use loomcli_plugins::format::format;
use loomcli_plugins::help::help;
use loomcli_plugins::interaction::interaction;
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::manpage::manpage;
use loomcli_plugins::mcp::mcp;
use loomcli_plugins::suggestions::suggestions;
use loomcli_plugins::theme::loom_theme;
use loomcli_plugins::verbose::verbose;
use loomcli_plugins::version::version;
use serde_json::{Value, json};

/// The one Command of the application: it counts, and prints its count through a text view.
fn count() -> Command<NoInputs, ValueResult<Value>> {
    Command::new("count")
        .description("Count the things.")
        .result(ResultViews::new().view(
            "text",
            View::new(|data: &Value, _| format!("{}\n", data["count"])),
        ))
        .action(|ctx: Context<NoInputs, ValueResult<Value>>| async move {
            ctx.out.results(json!({ "count": 3 })).await
        })
}

/// An application with every plugin of the set, in the reference jsonkit's installation order with
/// the interaction switch after verbose.
fn seams() -> loomcli_core::GroupApplication<NoInputs, loomcli_core::NoResult> {
    Application::new("seams")
        .plugins((
            help().command(true),
            suggestions(),
            version(),
            format().short('o'),
            manifest().short('M'),
            loom_theme(ThemeMapping::default()),
            color(),
            verbose(),
            interaction(),
            completion(),
            mcp(),
            manpage(),
        ))
        .description("Count things.")
        .version("1.2.3")
        .command(count())
}

/// The globals in installation order, the last block of a page with no hint.
const GLOBAL_OPTIONS: [&str; 8] = [
    "GLOBAL OPTIONS",
    "  -h, --help        Show this help.",
    "  -V, --version     Print the version.",
    "  -M, --manifest    Print this command's manifest as JSON.",
    "      --[no-]color  Turn color on or off, overriding NO_COLOR.",
    "  -v, --verbose...  Show more detail. Repeat it for more.",
    "  -q, --quiet       Hide info and success messages.",
    "      --no-input    Ask no questions, and take every answer from options.  (default: true)",
];

/// A page of `head`, the globals, then `tail`.
fn with_globals(head: &[&'static str], tail: &[&'static str]) -> Outcome {
    let lines: Vec<&str> = head
        .iter()
        .chain(GLOBAL_OPTIONS.iter())
        .chain(tail.iter())
        .copied()
        .collect();
    page(&lines)
}

#[test]
fn the_graph_assembles_without_a_collision_fault() {
    let graph = seams().inspect().unwrap();
    let children: Vec<&str> = graph
        .root
        .children
        .iter()
        .map(|child| child.name.as_deref().unwrap_or_default())
        .collect();
    assert_eq!(
        children,
        ["help", "completion", "mcp", "manpage", "count"],
        "plugin Commands ahead of the application's own, in installation order"
    );
}

#[tokio::test]
async fn the_root_page_lists_every_plugin_command_and_global() {
    let expected = with_globals(
        &[
            "seams · Count things.",
            "",
            "USAGE",
            "  seams <command> [options]",
            "",
            "COMMANDS",
            "  help                  Show help for a command.",
            "  completion <command>  Print or install a shell completion script.",
            "  mcp [command]         Serve this application's tools to an MCP client over stdin and stdout.",
            "  manpage <command>     Write or install the man pages.",
            "  count                 Count the things.",
            "",
        ],
        &["", "Run seams <command> --help for command details."],
    );
    assert_eq!(run(&seams(), &["--help"]).await, expected);
    assert_eq!(run(&seams(), &["help"]).await, expected);
}

#[tokio::test]
async fn a_leaf_page_carries_the_formatter_option_and_the_globals() {
    let expected = with_globals(
        &[
            "seams count · Count the things.",
            "",
            "USAGE",
            "  seams count [options]",
            "",
            "OPTIONS",
            "  -o, --format <format>  Select the output format, text by default. One of: text, json, jsonl.",
            "      --fields <fields>  Select top-level fields of json and jsonl output, as a comma list.  (repeatable)",
            "",
        ],
        &[],
    );
    assert_eq!(run(&seams(), &["count", "--help"]).await, expected);
}

#[tokio::test]
async fn the_application_runs_its_command_with_every_plugin_installed() {
    assert_eq!(run(&seams(), &["count"]).await, page(&["3"]));
    assert_eq!(
        run(&seams(), &["count", "--format", "json"]).await,
        page(&["{", "  \"count\": 3", "}"])
    );
    assert_eq!(
        run(&seams(), &["count", "--format", "jsonl"]).await,
        page(&["{\"count\":3}"])
    );
    assert_eq!(run(&seams(), &["--version"]).await, page(&["seams v1.2.3"]));
}
