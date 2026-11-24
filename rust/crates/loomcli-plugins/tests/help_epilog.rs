//! Epilogs, ported from the reference's `help-epilog.test.ts` (the help and manifest cases; the man
//! page cases belong to the manpage package): a page ends with the epilog of the routed Command and
//! of each of its ancestors, the Application's last, on both variants.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{noop, panic_message, render_at, text};
use loomcli_core::{Application, Command, read_extension};
use loomcli_plugins::help::extension::{HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::help::{Help, help};
use loomcli_plugins::manifest::extension::MANIFEST_COMMAND;

type Kit = loomcli_core::GroupApplication<loomcli_core::NoInputs, loomcli_core::NoResult>;

fn epilog(text: &str) -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    HELP_COMMAND.value(HelpCommandFacts::new().epilog(text))
}

/// The kit fixture: an Application whose support link ends every page, and two groups that add
/// theirs.
fn kit(settings: Help, hidden_depth: bool) -> Kit {
    let max = Command::new("max")
        .description("Print the deepest level.")
        .action(noop);
    let depth = Command::new("depth")
        .description("Measure how deeply the document nests.")
        .extend([epilog("Depth counts from the root.")]);
    let depth = if hidden_depth { depth.hidden() } else { depth };
    let stats = Command::new("stats")
        .description("Report facts about the document.")
        .extend([epilog(
            "Each statistic is described at https://example.com/stats.",
        )])
        .command(depth.command(max));
    Application::new("kit")
        .plugins((settings,))
        .description("A fixture kit.")
        .extend([epilog("Report a bug at https://example.com/kit/issues.")])
        .command(stats)
}

const LEAF_END: [&str; 8] = [
    "GLOBAL OPTIONS",
    "  -h, --help  Show this help.",
    "",
    "  Depth counts from the root.",
    "",
    "  Each statistic is described at https://example.com/stats.",
    "",
    "  Report a bug at https://example.com/kit/issues.",
];

#[tokio::test]
async fn a_leaf_page_ends_with_its_ancestors_epilogs_nearest_first_and_the_applications_last() {
    for spelling in ["-h", "--help"] {
        let mut lines = vec![
            "kit stats depth max · Print the deepest level.",
            "",
            "USAGE",
            "  kit stats depth max [options]",
            "",
        ];
        lines.extend(LEAF_END);
        assert_eq!(
            render_at(
                &kit(help(), false),
                &["stats", "depth", "max", spelling],
                None,
                None
            )
            .await,
            text(&lines)
        );
    }
}

#[tokio::test]
async fn a_group_page_ends_with_its_own_epilog_then_the_applications_after_the_child_hint() {
    let page = render_at(&kit(help(), false), &["stats", "--help"], None, None).await;
    assert!(page.ends_with(&text(&[
        "Run kit stats <command> --help for command details.",
        "",
        "  Each statistic is described at https://example.com/stats.",
        "",
        "  Report a bug at https://example.com/kit/issues.",
    ])));
    assert!(!page.contains("Depth counts from the root."));
}

#[tokio::test]
async fn the_root_page_ends_with_the_applications_epilog_alone() {
    let page = render_at(&kit(help(), false), &["-h"], None, None).await;
    assert!(page.ends_with(&text(&[
        "Run kit <command> -h for command details.",
        "",
        "  Report a bug at https://example.com/kit/issues.",
    ])));
    assert!(!page.contains("Run kit --help for details and examples."));
}

#[tokio::test]
async fn two_equal_epilogs_on_one_path_both_print() {
    let same = "Report a bug at https://example.com/kit/issues.";
    let application = Application::new("kit")
        .plugins((help(),))
        .extend([epilog(same)])
        .command(Command::new("leaf").extend([epilog(same)]).action(noop));
    let page = render_at(&application, &["leaf", "-h"], None, None).await;
    let indented = format!("  {same}");
    assert!(page.ends_with(&text(&["", &indented, "", &indented])));
}

#[tokio::test]
async fn a_hidden_group_on_the_path_still_contributes_its_epilog() {
    let page = render_at(
        &kit(help(), true),
        &["stats", "depth", "max", "-h"],
        None,
        None,
    )
    .await;
    assert!(page.ends_with(&text(&LEAF_END)));
}

const LONG: &str = "Questions about this kit go to the support forum, which answers within a day.";

fn markdown()
-> loomcli_core::Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Application::new("kit")
        .plugins((help(),))
        .extend([epilog(&format!("{LONG}\nSee the forum.\n\n- One item.\n"))])
        .action(noop)
}

#[tokio::test]
async fn off_a_terminal_an_epilog_keeps_each_authored_line_and_its_blank_line_between_blocks() {
    let page = render_at(&markdown(), &["-h"], None, None).await;
    let long = format!("  {LONG}");
    assert!(page.ends_with(&text(&["", &long, "  See the forum.", "", "  ● One item."])));
}

#[tokio::test]
async fn on_a_terminal_an_epilog_paragraph_reflows_at_its_two_space_indent() {
    let page = render_at(&markdown(), &["-h"], Some(40), None).await;
    assert!(page.ends_with(&text(&[
        "",
        "  Questions about this kit go to the",
        "  support forum, which answers within a",
        "  day. See the forum.",
        "",
        "  ● One item.",
    ])));
}

#[tokio::test]
async fn each_epilog_is_parsed_on_its_own_so_a_fence_one_leaves_open_ends_with_it() {
    let application = Application::new("kit")
        .plugins((help(),))
        .extend([epilog("Report a bug at the tracker.")])
        .command(
            Command::new("leaf")
                .extend([epilog("```\nkit leaf")])
                .action(noop),
        );
    let page = render_at(&application, &["leaf", "-h"], None, None).await;
    assert!(page.ends_with(&text(&[
        "",
        "    kit leaf",
        "",
        "  Report a bug at the tracker."
    ])));
}

#[tokio::test]
async fn the_help_command_prints_the_epilogs_help_prints() {
    let application = kit(help().command(true), false);
    let by_command = render_at(&application, &["help", "stats", "depth", "max"], None, None).await;
    assert_eq!(
        by_command,
        render_at(
            &application,
            &["stats", "depth", "max", "--help"],
            None,
            None
        )
        .await
    );
    assert!(by_command.contains("  Report a bug at https://example.com/kit/issues.\n"));
}

#[test]
fn a_whitespace_only_epilog_faults_at_the_call_that_receives_it() {
    for value in ["", " \n\t"] {
        let message = panic_message(|| drop(Application::new("kit").extend([epilog(value)])));
        assert!(
            message
                .unwrap()
                .contains("Supply Markdown that holds a character other than whitespace."),
            "{value:?}"
        );
    }
}

#[test]
fn help_supplies_no_manifest_value_for_a_command_whose_help_value_holds_an_epilog_alone() {
    let application = Application::new("kit")
        .plugins((help(),))
        .extend([epilog("Report a bug at the tracker.")])
        .action(noop);
    let graph = application.inspect().unwrap();
    assert_eq!(
        read_extension(&graph.root, &MANIFEST_COMMAND).unwrap(),
        Vec::new()
    );
}
