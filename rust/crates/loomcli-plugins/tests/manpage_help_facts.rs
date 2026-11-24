//! The man page halves of two reference files that mostly belong to the help plugin: the `the man
//! page` group and the fence case of `help-epilog.test.ts`, and the man page half of
//! `content-help.test.ts`.

#![cfg(feature = "manpage")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;

use loomcli_core::{Application, Arg, Command, CommandGraph, Context, Opt, Outcome};
use loomcli_plugins::help::extension::{CommandExample, HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::manpage::test_support::man_pages;

async fn noop(_context: Context) -> Outcome {
    Ok(())
}

fn pages_of(graph: &CommandGraph) -> BTreeMap<String, String> {
    man_pages(graph)
        .unwrap()
        .into_iter()
        .map(|page| (page.file, page.text))
        .collect()
}

fn epilog(text: &str) -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    HELP_COMMAND.value(HelpCommandFacts::new().epilog(text))
}

#[test]
fn a_nested_page_prints_its_epilogs_under_notes_after_environment_and_before_see_also() {
    let max = Command::new("max")
        .description("Print the deepest level.")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .epilog("- Levels count from one.")
                .examples([CommandExample::new("stats max")]),
        )])
        .option(
            "limit",
            Opt::string()
                .description("Stop at this level.")
                .env(["KIT_LIMIT"]),
        )
        .action(noop);
    let stats = Command::new("stats")
        .description("Report facts.")
        .extend([epilog("Each statistic is described online.")])
        .command(max);
    let graph = Application::new("kit")
        .extend([epilog("Report a bug at the tracker.")])
        .command(stats)
        .inspect()
        .unwrap();
    let pages = pages_of(&graph);
    let after_examples = pages["kit-stats-max.1"]
        .split("\n.SH \"EXAMPLES\"\n")
        .nth(1)
        .unwrap();
    assert_eq!(
        after_examples,
        [
            ".nf",
            r"\fB$ kit stats max\fR",
            ".fi",
            r#".SH "ENVIRONMENT""#,
            ".TP",
            r"\fBKIT_LIMIT\fR",
            r"Supplies \fB\-\-limit\fR.",
            r#".SH "NOTES""#,
            r".IP \(bu 2",
            "Levels count from one.",
            ".PP",
            "Each statistic is described online.",
            ".PP",
            "Report a bug at the tracker.",
            r#".SH "SEE ALSO""#,
            r"\fBkit\fR(1), \fBkit\-stats\fR(1)",
            "",
        ]
        .join("\n")
    );
    assert!(
        pages["kit.1"].contains("\n.SH \"NOTES\"\nReport a bug at the tracker.\n.SH \"SEE ALSO\"")
    );
}

#[test]
fn an_epilog_that_opens_with_a_list_item_writes_no_paragraph_request_before_it() {
    let leaf = Command::new("leaf").extend([epilog("First.")]).action(noop);
    let graph = Application::new("kit")
        .extend([epilog("- Second.")])
        .command(leaf)
        .inspect()
        .unwrap();
    assert!(
        pages_of(&graph)["kit-leaf.1"]
            .contains("\n.SH \"NOTES\"\nFirst.\n.IP \\(bu 2\nSecond.\n.SH \"SEE ALSO\"")
    );
}

#[test]
fn a_page_with_no_epilog_on_its_path_has_no_notes() {
    let graph = Application::new("kit")
        .command(Command::new("leaf").action(noop))
        .inspect()
        .unwrap();
    let pages = pages_of(&graph);
    assert!(!pages.is_empty());
    for text in pages.values() {
        assert!(!text.contains("NOTES"));
    }
}

#[test]
fn each_epilog_is_parsed_on_its_own_so_a_fence_one_leaves_open_ends_with_it() {
    let graph = Application::new("kit")
        .extend([epilog("Report a bug at the tracker.")])
        .command(
            Command::new("leaf")
                .extend([epilog("```\nkit leaf")])
                .action(noop),
        )
        .inspect()
        .unwrap();
    assert!(pages_of(&graph)["kit-leaf.1"].contains(
        ".SH \"NOTES\"\n.RS 4\n.nf\nkit leaf\n.fi\n.RE\n.PP\nReport a bug at the tracker.\n.SH \"SEE ALSO\""
    ));
}

#[test]
fn man_pages_name_a_content_bound_with_the_right_source_noun() {
    for (bound, facts) in [
        (0, "min: 0 sources, max: 0 sources"),
        (1, "min: 1 source, max: 1 source"),
        (2, "min: 2 sources, max: 2 sources"),
    ] {
        let graph = Application::new("count")
            .description("Count sources.")
            .argument(
                "files",
                Arg::content()
                    .description("The files.")
                    .variadic()
                    .min(bound)
                    .max(bound),
            )
            .option(
                "extra",
                Opt::content()
                    .description("The additional files.")
                    .multiple()
                    .min(bound)
                    .max(bound),
            )
            .action(noop)
            .inspect()
            .unwrap();
        let root = &man_pages(&graph).unwrap()[0].text;
        assert!(
            root.contains(&format!("The files.  (file path, {facts})")),
            "{bound}: {root}"
        );
        assert!(
            root.contains(&format!("The additional files.  (file path, {facts},")),
            "{bound}: {root}"
        );
    }
}
