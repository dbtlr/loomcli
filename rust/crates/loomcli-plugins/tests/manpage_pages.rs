//! The page set and the pages, ported from the reference's `manpage-pages.test.ts`: fixture
//! applications inspected, and each page compared byte for byte.

#![cfg(feature = "manpage")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::sync::Arc;

use loomcli_core::{
    Application, Build, Command, CommandGraph, Context, FailureFacts, InputSchema, Issue, NoInputs,
    NoResult, Opt, Outcome, Polarity, ProcessHandle, ReleaseFacts, RunOptions, ValidationContext,
    Validator,
};
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::help::extension::{
    CommandExample, HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::manpage::manpage;
use loomcli_plugins::manpage::test_support::man_pages;
use loomcli_testing::{MockFields, mock_process};
use serde_json::json;

async fn noop(_context: Context) -> Outcome {
    Ok(())
}

/// Each page of an application's set by file name, in graph order, as `generate` and `install`
/// write them.
fn set_of(graph: &CommandGraph) -> Vec<(String, String)> {
    man_pages(graph)
        .unwrap()
        .into_iter()
        .map(|page| (page.file, page.text))
        .collect()
}

fn pages_of(graph: &CommandGraph) -> BTreeMap<String, String> {
    set_of(graph).into_iter().collect()
}

fn keys(graph: &CommandGraph) -> Vec<String> {
    set_of(graph).into_iter().map(|(file, _)| file).collect()
}

/// A page as its lines, each ended by a line feed.
fn page(lines: &[&str]) -> String {
    format!("{}\n", lines.join("\n"))
}

/// A validator that publishes the schema exactly as supplied and accepts every value.
struct Shaped(serde_json::Value);

impl Validator for Shaped {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_owned())
    }

    fn input_schema(&self) -> InputSchema {
        self.0.as_object().cloned()
    }
}

fn section_of(path: &[&str]) -> loomcli_core::ExtensionValue<loomcli_core::OptionTarget> {
    HELP_INPUT.value(HelpInputFacts::new().section(path))
}

fn level() -> Command<NoInputs, NoResult, loomcli_core::Done> {
    Command::new("level")
        .description("Set the level.")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .examples([
                    CommandExample::new("level --color").note("Turn color on."),
                    CommandExample::new("level -q"),
                ])
                .option_sections(&[&["Output", "Shape"], &["Output"]])
                .section(&["Work", "Change"]),
        )])
        .option(
            "color",
            Opt::boolean()
                .description("Color the output.")
                .env(["KIT_COLOR"])
                .extend([section_of(&["Output"])])
                .polarity(Polarity::Both),
        )
        .option(
            "pager",
            Opt::boolean()
                .description("Use the pager.")
                .env(["KIT_PAGER"])
                .polarity(Polarity::Negative),
        )
        .option(
            "quiet",
            Opt::boolean()
                .description("Say less.")
                .env(["KIT_QUIET"])
                .short('q')
                .short_only(),
        )
        .option(
            "debug",
            Opt::count()
                .description("Debug more.")
                .env(["KIT_DEBUG"])
                .short('d'),
        )
        .option(
            "backup",
            Opt::string()
                .description("Back up first.")
                .extend([HELP_INPUT
                    .value(HelpInputFacts::placeholder("control").section(&["Output", "Shape"]))])
                .implied("simple")
                .short('b'),
        )
        .option(
            "mode",
            Opt::string()
                .description("The mode.")
                .env(["KIT_MODE", "KIT_LEGACY_MODE"])
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("level.mode"))])
                .validate(Shaped(
                    json!({ "enum": ["fast", "slow"], "type": "string" }),
                )),
        )
        .option(
            "secret",
            Opt::string()
                .description("Hidden.")
                .env(["KIT_SECRET"])
                .hidden(),
        )
        .option("plain", Opt::boolean().description("Long only."))
        .option("raw", Opt::boolean().env(["KIT_RAW"]))
        .option(
            "field",
            Opt::string()
                .env(["KIT_FIELDS"])
                .env_delimiter("\t")
                .multiple(),
        )
        .action(noop)
}

fn show() -> Command<NoInputs, NoResult, loomcli_core::Done> {
    Command::new("show")
        .description("Show the kit.")
        .extend([HELP_COMMAND.value(HelpCommandFacts::new().section(&["Work", "Read"]))])
        .argument(
            "name",
            loomcli_core::Arg::string()
                .description("The part to show.")
                .required(),
        )
        .action(noop)
}

/// An application that installs neither help nor the configuration plugin.
fn kit() -> Arc<CommandGraph> {
    Application::new("kit")
        .plugins((manpage(),))
        .description("A kit.")
        .version("1.2.3")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new().command_sections(&[&["Work", "Read"], &["Work", "Change"]]),
        )])
        .global_option(
            "file",
            Opt::string()
                .description("The file to read.")
                .env(["KIT_FILE"])
                .extend([HELP_INPUT.value(HelpInputFacts::placeholder("path"))])
                .short('f'),
        )
        .global_option(
            "verbose",
            Opt::count()
                .description("Say more.")
                .extend([section_of(&["Logging"])])
                .short('v'),
        )
        .command(level())
        .command(show())
        .command(Command::new("bare").action(noop))
        .inspect()
        .unwrap()
}

fn plain_app(name: &str) -> loomcli_core::Application<NoInputs, NoResult, loomcli_core::Fresh> {
    Application::new(name).plugins((manpage(),))
}

#[test]
fn the_set_holds_a_page_for_the_root_each_visible_child_and_the_plugin_commands() {
    assert_eq!(
        keys(&kit()),
        [
            "kit.1",
            "kit-manpage.1",
            "kit-manpage-generate.1",
            "kit-manpage-install.1",
            "kit-manpage-update.1",
            "kit-manpage-uninstall.1",
            "kit-level.1",
            "kit-show.1",
            "kit-bare.1",
        ]
    );
}

#[test]
fn the_set_gives_no_page_to_a_hidden_command_or_one_under_it_nor_to_an_alias() {
    let graph = plain_app("kit")
        .description("A kit.")
        .command(
            Command::new("secret")
                .description("Hidden.")
                .hidden()
                .command(
                    Command::new("inner")
                        .description("Under a hidden Command.")
                        .action(noop),
                ),
        )
        .command(
            Command::new("list")
                .description("List.")
                .alias("ls")
                .action(noop),
        )
        .inspect()
        .unwrap();
    let others: Vec<String> = keys(&graph)
        .into_iter()
        .filter(|file| !file.starts_with("kit-manpage"))
        .collect();
    assert_eq!(others, ["kit.1", "kit-list.1"]);
    let root = &pages_of(&graph)["kit.1"];
    assert!(!root.contains("secret"));
    assert!(!root.split_whitespace().any(|word| word == "ls"));
}

#[test]
fn the_root_page_lists_its_sections_in_help_order_and_the_globals() {
    assert_eq!(
        pages_of(&kit())["kit.1"],
        page(&[
            r#".TH "KIT" "1" "" "kit 1.2.3" """#,
            r#".SH "NAME""#,
            r"kit \- A kit.",
            r#".SH "SYNOPSIS""#,
            ".nf",
            r"\fBkit\fR <command> [options]",
            ".fi",
            r#".SH "WORK""#,
            r#".SS "READ""#,
            ".TP",
            r"\fBshow\fR",
            "Show the kit.",
            r#".SS "CHANGE""#,
            ".TP",
            r"\fBlevel\fR",
            "Set the level.",
            r#".SH "COMMANDS""#,
            ".TP",
            r"\fBmanpage\fR <command>",
            "Write or install the man pages.",
            ".TP",
            r"\fBbare\fR",
            r#".SH "GLOBAL OPTIONS""#,
            ".TP",
            r"\fB\-f\fR, \fB\-\-file\fR <\fIpath\fR>",
            "The file to read.",
            ".br",
            r"Environment: \fBKIT_FILE\fR",
            r#".SH "LOGGING""#,
            ".TP",
            r"\fB\-v\fR, \fB\-\-verbose\fR...",
            "Say more.",
            r#".SH "ENVIRONMENT""#,
            ".TP",
            r"\fBKIT_FILE\fR",
            r"Supplies \fB\-\-file\fR.",
            r#".SH "SEE ALSO""#,
            r"\fBkit\-show\fR(1), \fBkit\-level\fR(1), \fBkit\-manpage\fR(1), \fBkit\-bare\fR(1)",
        ])
    );
}

#[test]
fn a_child_page_holds_its_own_options_in_help_order_its_examples_and_its_environment() {
    assert_eq!(
        pages_of(&kit())["kit-level.1"],
        page(&[
            r#".TH "KIT\-LEVEL" "1" "" "kit 1.2.3" """#,
            r#".SH "NAME""#,
            r"kit\-level \- Set the level.",
            r#".SH "SYNOPSIS""#,
            ".nf",
            r"\fBkit level\fR [options]",
            ".fi",
            r#".SH "OUTPUT""#,
            ".TP",
            r"\fB\-\-[no\-]color\fR",
            "Color the output.",
            ".br",
            r"Environment: \fBKIT_COLOR\fR",
            r#".SS "SHAPE""#,
            ".TP",
            r"\fB\-b\fR, \fB\-\-backup\fR[=<\fIcontrol\fR>]",
            "Back up first.  (implied: simple)",
            r#".SH "OPTIONS""#,
            ".TP",
            r"\fB\-\-no\-pager\fR",
            "Use the pager.  (default: true)",
            ".br",
            r"Environment: \fBKIT_PAGER\fR",
            ".TP",
            r"\fB\-q\fR",
            "Say less.",
            ".br",
            r"Environment: \fBKIT_QUIET\fR",
            ".TP",
            r"\fB\-d\fR, \fB\-\-debug\fR...",
            "Debug more.",
            ".br",
            r"Environment: \fBKIT_DEBUG\fR",
            ".TP",
            r"\fB\-\-mode\fR <\fImode\fR>",
            "The mode. One of: fast, slow.",
            ".br",
            r"Environment: \fBKIT_MODE\fR, \fBKIT_LEGACY_MODE\fR",
            ".br",
            r"Configuration: \fBlevel.mode\fR",
            ".TP",
            r"\fB\-\-plain\fR",
            "Long only.",
            ".TP",
            r"\fB\-\-raw\fR",
            r"Environment: \fBKIT_RAW\fR",
            ".TP",
            r"\fB\-\-field\fR <\fIfield\fR>",
            "(repeatable)",
            ".br",
            r"Environment: \fBKIT_FIELDS\fR (a list separated by \(dq\et\(dq)",
            r#".SH "EXAMPLES""#,
            ".nf",
            r"\fB$ kit level \-\-color\fR",
            ".fi",
            ".RS 4",
            "Turn color on.",
            ".RE",
            ".PP",
            ".nf",
            r"\fB$ kit level \-q\fR",
            ".fi",
            r#".SH "ENVIRONMENT""#,
            ".TP",
            r"\fBKIT_COLOR\fR",
            r"Supplies \fB\-\-[no\-]color\fR.",
            ".TP",
            r"\fBKIT_PAGER\fR",
            r"Supplies \fB\-\-no\-pager\fR.",
            ".TP",
            r"\fBKIT_QUIET\fR",
            r"Supplies \fB\-q\fR.",
            ".TP",
            r"\fBKIT_DEBUG\fR",
            r"Supplies \fB\-\-debug\fR.",
            ".TP",
            r"\fBKIT_MODE\fR",
            r"Supplies \fB\-\-mode\fR.",
            ".TP",
            r"\fBKIT_LEGACY_MODE\fR",
            r"Supplies \fB\-\-mode\fR.",
            ".TP",
            r"\fBKIT_RAW\fR",
            r"Supplies \fB\-\-raw\fR.",
            ".TP",
            r"\fBKIT_FIELDS\fR",
            r"Supplies \fB\-\-field\fR as a list separated by \(dq\et\(dq.",
            r#".SH "SEE ALSO""#,
            r"\fBkit\fR(1)",
        ])
    );
}

fn lines_of(text: &str) -> Vec<&str> {
    text.split('\n').collect()
}

#[test]
fn a_list_variables_delimiter_reads_as_one_unbroken_json_string_on_a_string_or_a_content_option() {
    let graph = plain_app("kit")
        .option(
            "field",
            Opt::string()
                .env(["KIT_FIELDS"])
                .env_delimiter(" ")
                .multiple(),
        )
        .option(
            "file",
            Opt::content()
                .env(["KIT_FILES"])
                .env_delimiter(",")
                .multiple(),
        )
        .action(noop)
        .inspect()
        .unwrap();
    let pages = pages_of(&graph);
    let lines = lines_of(&pages["kit.1"]);
    for expected in [
        r"Environment: \fBKIT_FIELDS\fR (a list separated by \(dq\ \(dq)",
        r"Environment: \fBKIT_FILES\fR (a list separated by \(dq,\(dq)",
        r"Supplies \fB\-\-field\fR as a list separated by \(dq\ \(dq.",
        r"Supplies \fB\-\-file\fR as a list separated by \(dq,\(dq.",
    ] {
        assert!(lines.contains(&expected), "{expected}");
    }
}

#[test]
fn an_environment_entry_says_when_an_empty_value_supplies_a_string_option() {
    let graph = plain_app("kit")
        .option(
            "prefix",
            Opt::string()
                .env(["KIT_PREFIX", "OLD_PREFIX"])
                .env_allow_empty(),
        )
        .option("suffix", Opt::string().env(["KIT_SUFFIX"]))
        .action(noop)
        .inspect()
        .unwrap();
    let pages = pages_of(&graph);
    let lines = lines_of(&pages["kit.1"]);
    assert!(lines.contains(&r"Supplies \fB\-\-prefix\fR, even with an empty value."));
    assert!(lines.contains(&r"Supplies \fB\-\-suffix\fR."));
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.contains("even with an empty value"))
            .count(),
        2
    );
}

#[test]
fn a_command_with_no_description_has_the_page_name_alone_under_name() {
    assert_eq!(
        pages_of(&kit())["kit-bare.1"],
        page(&[
            r#".TH "KIT\-BARE" "1" "" "kit 1.2.3" """#,
            r#".SH "NAME""#,
            r"kit\-bare",
            r#".SH "SYNOPSIS""#,
            ".nf",
            r"\fBkit bare\fR [options]",
            ".fi",
            r#".SH "SEE ALSO""#,
            r"\fBkit\fR(1)",
        ])
    );
}

#[test]
fn an_argument_is_italic_and_a_page_under_a_group_names_the_root_and_its_parent() {
    let pages = pages_of(&kit());
    assert!(
        pages["kit-show.1"].contains(
            &[
                r#".SH "ARGUMENTS""#,
                ".TP",
                r"\fIname\fR",
                "The part to show."
            ]
            .join("\n")
        )
    );
    assert!(
        pages["kit-manpage-generate.1"].contains(
            &[
                r#".SH "SYNOPSIS""#,
                ".nf",
                r"\fBkit manpage generate\fR \-\-out <folder> [options]",
                ".fi",
            ]
            .join("\n")
        )
    );
    assert!(
        pages["kit-manpage-generate.1"].contains(
            &[
                ".TP",
                r"\fB\-\-out\fR <\fIfolder\fR>",
                "The folder to write the man pages in. It is created when missing.  (required)",
            ]
            .join("\n")
        )
    );
    let second_last = |file: &str| {
        let lines = lines_of(&pages[file]);
        lines[lines.len() - 2].to_owned()
    };
    assert_eq!(
        second_last("kit-manpage-install.1"),
        r"\fBkit\fR(1), \fBkit\-manpage\fR(1)"
    );
    assert_eq!(
        second_last("kit-manpage.1"),
        r"\fBkit\fR(1), \fBkit\-manpage\-generate\fR(1), \fBkit\-manpage\-install\fR(1), \fBkit\-manpage\-update\fR(1), \fBkit\-manpage\-uninstall\fR(1)"
    );
}

#[test]
fn a_deprecated_command_opens_its_description_with_its_message_and_its_parent_marks_the_entry() {
    let graph = plain_app("kit")
        .description("A kit.")
        .command(
            Command::new("old")
                .deprecated("Use new.")
                .description("Old.")
                .extend([HELP_COMMAND.value(HelpCommandFacts::new().details("Still works."))])
                .action(noop),
        )
        .inspect()
        .unwrap();
    let pages = pages_of(&graph);
    assert!(
        pages["kit-old.1"].contains(
            &[
                r#".SH "DESCRIPTION""#,
                "Deprecated: Use new.",
                ".PP",
                "Still works."
            ]
            .join("\n")
        )
    );
    assert!(
        pages["kit.1"].contains(&[".TP", r"\fBold\fR", "Old.  (deprecated: Use new.)"].join("\n"))
    );
}

#[test]
fn a_line_break_in_a_description_a_deprecation_or_the_stdin_description_reads_as_a_space() {
    let graph = plain_app("kit")
        .description("First line.\nSecond line.")
        .command(
            Command::new("old")
                .deprecated("Use new.\r\nIt is faster.")
                .description("Old line.\nOld more.")
                .action(noop),
        )
        .command(
            Command::new("read")
                .description("Read line.\r\nRead more.")
                .argument(
                    "name",
                    loomcli_core::Arg::string().description("Name line.\nName more."),
                )
                .option("fast", Opt::boolean().description("Fast line.\nFast more."))
                .stdin(loomcli_core::Stdin::new().description("Input line.\nInput more."))
                .action(noop),
        )
        .inspect()
        .unwrap();
    let pages = pages_of(&graph);
    assert!(
        pages["kit.1"].contains(&[r#".SH "NAME""#, r"kit \- First line. Second line."].join("\n"))
    );
    assert!(pages["kit.1"].contains(&[".TP", r"\fBread\fR", "Read line. Read more."].join("\n")));
    assert!(
        pages["kit.1"].contains(
            &[
                ".TP",
                r"\fBold\fR",
                "Old line. Old more.  (deprecated: Use new. It is faster.)",
            ]
            .join("\n")
        )
    );
    assert!(
        pages["kit-old.1"]
            .contains(&[r#".SH "NAME""#, r"kit\-old \- Old line. Old more."].join("\n"))
    );
    assert!(
        pages["kit-old.1"]
            .contains(&[r#".SH "DESCRIPTION""#, "Deprecated: Use new. It is faster."].join("\n"))
    );
    let read = &pages["kit-read.1"];
    assert!(read.contains(&[r#".SH "NAME""#, r"kit\-read \- Read line. Read more."].join("\n")));
    assert!(read.contains(&[r#".SH "INPUT""#, "Input line. Input more."].join("\n")));
    assert!(read.contains(&[".TP", r"\fIname\fR", "Name line. Name more."].join("\n")));
    assert!(read.contains(&[".TP", r"\fB\-\-fast\fR", "Fast line. Fast more."].join("\n")));
    for text in pages.values() {
        assert!(!text.to_lowercase().contains(r"\eu000"));
    }
}

#[test]
fn a_root_whose_authored_option_section_holds_a_global_lists_it_there_and_its_child_page_does_not()
{
    let pages = pages_of(&kit());
    assert!(pages["kit.1"].contains(r#".SH "LOGGING""#));
    for word in ["LOGGING", "GLOBAL OPTIONS", "verbose", "KIT_FILE"] {
        assert!(!pages["kit-show.1"].contains(word), "{word}");
    }
}

/// What a collision build raises: the rule, sentence, and correction.
fn collision() -> Application<NoInputs, NoResult, loomcli_core::Group> {
    plain_app("kit")
        .description("A kit.")
        .command(Command::new("foo-bar").description("Flat.").action(noop))
        .command(
            Command::new("foo")
                .description("Group.")
                .command(Command::new("bar").description("Nested.").action(noop)),
        )
}

const COLLISION: &str = "Commands \"foo-bar\" and \"foo bar\" both give the man page kit-foo-bar.";

#[test]
fn a_root_child_foo_bar_beside_foo_bar_fails_the_build_under_page_name_taken() {
    let fault = collision().inspect().expect_err("the names collide");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/plugins/manpage/page-name-taken")
    );
    assert_eq!(fault.sentence(), COLLISION);
    assert_eq!(fault.correction(), ["Rename one of them, or hide one."]);
}

async fn run_collision(argv: &[&str], build: Build) -> (u8, String, String) {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build)),
    );
    let code = collision()
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[tokio::test]
async fn the_hyphen_collision_fails_every_run_with_the_pinned_diagnostic() {
    let fault = collision().inspect().expect_err("the names collide");
    for argv in [vec!["manpage", "install"], vec!["--help"]] {
        let developed = run_collision(&argv, Build::Development).await;
        assert_eq!(
            developed,
            (1, String::new(), format!("{}\n", fault.message())),
            "{argv:?}"
        );
        for part in [
            "@loomcli/plugins/manpage/page-name-taken",
            COLLISION,
            "Rename one of them, or hide one.",
        ] {
            assert!(developed.2.contains(part), "{argv:?}: {part}");
        }
        assert_eq!(
            run_collision(&argv, Build::Distributed).await,
            (1, String::new(), "kit: Something went wrong.\n".to_owned()),
            "{argv:?}"
        );
    }
}

#[test]
fn a_hidden_command_gives_no_page_so_the_same_graph_builds() {
    let graph = plain_app("kit")
        .description("A kit.")
        .command(
            Command::new("foo-bar")
                .description("Flat.")
                .hidden()
                .action(noop),
        )
        .command(
            Command::new("foo")
                .description("Group.")
                .command(Command::new("bar").description("Nested.").action(noop)),
        )
        .inspect()
        .unwrap();
    assert!(keys(&graph).contains(&"kit-foo-bar.1".to_owned()));
    assert_eq!(
        keys(&graph)
            .iter()
            .filter(|file| *file == "kit-foo-bar.1")
            .count(),
        1
    );
}

/// A string holding every character the escapes rule names, with an escape and non-ASCII text.
fn hostile() -> String {
    format!(
        ".lead 'q' \"dq\" `bt` ^c ~t \\b \\fB a-b {} caf{} {} {}",
        '\u{1b}', '\u{e9}', '\u{2014}', '\u{4e2d}'
    )
}

#[test]
fn every_page_is_ascii() {
    let hostile = hostile();
    // Markdown details print a lone backtick as written rather than as a code span.
    let details_hostile = hostile.replace("`bt`", "`bt");
    let compact = format!(".'\"`^~\\\\fB-{}{}{}", '\u{1b}', '\u{e9}', '\u{4e2d}');
    let details = [
        details_hostile.as_str(),
        "",
        &format!("# {details_hostile}"),
        "",
        "```",
        &hostile,
        "a\tb",
        "```",
    ]
    .join("\n");
    let graph = plain_app("kit")
        .description(hostile.clone())
        .version(compact)
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .details(details)
                .examples([CommandExample::new(hostile.clone()).note(hostile.clone())])
                .option_sections(&[&[hostile.as_str()]]),
        )])
        .option(
            "tab",
            Opt::boolean()
                .description("One\ttab.")
                .extend([section_of(&[hostile.as_str()])]),
        )
        .command(
            Command::new("child")
                .description(hostile.clone())
                .action(noop),
        )
        .action(noop)
        .inspect()
        .unwrap();
    let pages = pages_of(&graph);
    assert!(!pages.is_empty());
    for (file, text) in pages {
        assert!(
            text.chars()
                .all(|character| matches!(character, '\n' | '\t' | ' '..='~')),
            "{file}: {text}"
        );
    }
}

#[tokio::test]
async fn the_development_diagnostic_renders_the_headline_sentence_explanation_and_correction() {
    let (status, stdout, stderr) = run_collision(&["manpage", "install"], Build::Development).await;
    assert_eq!((status, stdout.as_str()), (1, ""));
    assert_eq!(
        stderr,
        "-- MAN PAGE NAME TAKEN ---------------- @loomcli/plugins/manpage/page-name-taken\n\nCommands \"foo-bar\" and \"foo bar\" both give the man page kit-foo-bar.\n\nThe manpage plugin writes one page for each Command an operator can find, named\nby the application name and the Command's path joined with hyphens, so a Command\nnamed with a hyphen can give the name of a child's page, and one page would\nreplace the other.\n\nRename one of them, or hide one.\n"
    );
}

#[test]
fn an_entry_with_an_empty_description_and_a_fact_keeps_the_gutter() {
    let graph = plain_app("kit")
        .description("A kit.")
        .command(
            Command::new("old")
                .description("")
                .deprecated("Use new.")
                .action(noop),
        )
        .inspect()
        .unwrap();
    let pages = pages_of(&graph);
    assert!(
        pages["kit.1"].contains(&[".TP", r"\fBold\fR", "  (deprecated: Use new.)"].join("\n")),
        "{}",
        pages["kit.1"]
    );
}
