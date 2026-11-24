//! Help wraps to the destination's columns, ported from the reference's `help-wrap.test.ts`, through
//! fixtures whose host reports a fixed stdout width and an environment with no `COLUMNS`. The
//! version-line case belongs to the version package.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{block, blocks, loom_theme, noop, plain, run_with, styled, version_stand_in};
use loomcli_core::{
    AnyPlugin, Application, Command, Done, Fresh, NoInputs, NoResult, Opt, RenderingPolicy, Stdin,
};
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::help::extension::{
    CommandExample, HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::help::help;
use loomcli_testing::{MockFields, MockTerminal, StreamName};

type App = Application<NoInputs, NoResult, Done>;

/// The root every fixture starts from: help, the version stand-in, and the Loom theme when
/// `themed`.
fn root(name: &str, themed: bool) -> Application<NoInputs, NoResult, Fresh> {
    let mut installed: Vec<AnyPlugin> = vec![help().into(), version_stand_in().into()];
    if themed {
        installed.push(loom_theme().into());
    }
    Application::new(name).plugins(installed)
}

/// What one page printed, at a terminal `columns` wide or on a pipe, with `env`, after it exited
/// cleanly. Color, modifiers, and hyperlinks are off unless `policy` says otherwise.
async fn render(
    application: &App,
    argv: &[&str],
    columns: Option<u16>,
    env: &[(&str, &str)],
    policy: Option<RenderingPolicy>,
) -> String {
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .platform("linux");
    for (name, value) in env {
        fields = fields.env(name, value);
    }
    if let Some(columns) = columns {
        fields = fields.terminal(MockTerminal::new(columns, 24).streams([StreamName::Stdout]));
    }
    let (outcome, _) = run_with(application, fields, Some(policy.unwrap_or_else(plain))).await;
    assert_eq!(outcome.stderr, "");
    assert_eq!(outcome.status, 0);
    outcome.stdout
}

async fn at(application: &App, columns: Option<u16>) -> String {
    render(application, &["--help"], columns, &[], None).await
}

fn lines(expected: &[&str]) -> Vec<String> {
    expected.iter().map(|line| (*line).to_owned()).collect()
}

/// A root with one option whose right cell holds a description, accepted values, and a fact.
fn rows() -> App {
    root("app", false)
        .option(
            "format",
            Opt::string()
                .default("table")
                .description("Select the output format.")
                .extend([HELP_INPUT.value(HelpInputFacts::new().accepts("One of: table, json."))])
                .short('o'),
        )
        .option(
            "width",
            Opt::string()
                .default("8")
                .description("Set the width of each column.")
                .extend([HELP_INPUT.value(HelpInputFacts::new().section(&["Layout", "Columns"]))])
                .short('w'),
        )
        .option("quiet", Opt::boolean())
        .action(noop)
}

/// A root with children whose COMMANDS row set needs 2 + 12 + 13 = 27 columns.
fn children() -> App {
    root("app", false)
        .description("Read values.")
        .command(
            Command::new("alpha")
                .description("Read the configuration values.")
                .action(noop),
        )
        .command(
            Command::new("beta-gamma")
                .description("Write values.")
                .action(noop),
        )
        .action(noop)
}

#[tokio::test]
async fn a_page_at_a_width_it_already_fits_prints_as_it_does_off_a_terminal() {
    for application in [rows(), children()] {
        assert_eq!(
            at(&application, Some(200)).await,
            at(&application, None).await
        );
    }
}

#[tokio::test]
async fn columns_narrows_the_page_on_a_terminal_and_changes_nothing_on_a_pipe() {
    let application = root("app", false)
        .description(
            "Read and reshape one document from a file or a pipe, and print the result in a chosen format.",
        )
        .action(noop);
    let with = |columns: Option<u16>, env: &'static [(&'static str, &'static str)]| {
        let application = &application;
        async move { render(application, &["--help"], columns, env, None).await }
    };
    assert_ne!(with(Some(60), &[]).await, with(Some(100), &[]).await);
    assert_eq!(
        with(Some(100), &[("COLUMNS", "60")]).await,
        with(Some(60), &[]).await
    );
    assert_eq!(
        with(Some(100), &[("COLUMNS", "150")]).await,
        with(Some(100), &[]).await
    );
    assert_eq!(
        with(None, &[("COLUMNS", "60")]).await,
        with(None, &[]).await
    );
}

#[tokio::test]
async fn a_right_cell_wraps_as_one_text_under_its_column_in_direct_rows_and_under_an_inner_heading()
{
    let stdout = at(&rows(), Some(40)).await;
    assert_eq!(
        block(&stdout, "OPTIONS"),
        lines(&[
            "OPTIONS",
            "  -o, --format <format>  Select the",
            "                         output format.",
            "                         One of: table,",
            "                         json.",
            "                         (default:",
            "                         table)",
            "      --quiet",
            "  -h, --help             Show this help.",
            "  -V, --version          Print the",
            "                         version.",
        ])
    );
    assert_eq!(
        block(&stdout, "LAYOUT"),
        lines(&[
            "LAYOUT",
            "  COLUMNS",
            "    -w, --width <width>  Set the width",
            "                         of each column.",
            "                         (default: 8)",
        ])
    );
}

#[tokio::test]
async fn a_row_set_stacks_exactly_when_its_indent_left_column_and_floor_exceed_the_columns() {
    assert_eq!(
        block(&at(&children(), Some(27)).await, "COMMANDS"),
        lines(&[
            "COMMANDS",
            "  alpha       Read the",
            "              configuration",
            "              values.",
            "  beta-gamma  Write values.",
        ])
    );
    let stdout = at(&children(), Some(26)).await;
    assert_eq!(
        block(&stdout, "COMMANDS"),
        lines(&[
            "COMMANDS",
            "  alpha",
            "      Read the",
            "      configuration",
            "      values.",
            "  beta-gamma",
            "      Write values.",
        ])
    );
    // GLOBAL OPTIONS needs 2 + 15 + 8 = 25 columns, so it keeps two columns.
    assert_eq!(
        block(&stdout, "GLOBAL OPTIONS"),
        lines(&[
            "GLOBAL OPTIONS",
            "  -h, --help     Show this",
            "                 help.",
            "  -V, --version  Print the",
            "                 version.",
        ])
    );
}

/// A root with one direct COMMANDS row and one row under the inner heading WRITE.
fn nested(inner: &str) -> App {
    root("app", false)
        .command(
            Command::new("alpha")
                .description("Read the configuration values.")
                .action(noop),
        )
        .command(
            Command::new(inner)
                .description("Write values.")
                .extend([
                    HELP_COMMAND.value(HelpCommandFacts::new().section(&["Commands", "Write"]))
                ])
                .action(noop),
        )
        .action(noop)
}

#[tokio::test]
async fn an_outer_headings_direct_rows_and_an_inner_headings_rows_stack_independently() {
    assert_eq!(
        block(&at(&nested("beta"), Some(21)).await, "COMMANDS"),
        lines(&[
            "COMMANDS",
            "  alpha",
            "      Read the",
            "      configuration",
            "      values.",
            "  WRITE",
            "    beta  Write",
            "          values.",
        ])
    );
    assert_eq!(
        block(
            &at(&nested("beta-delta-epsilon"), Some(30)).await,
            "COMMANDS"
        ),
        lines(&[
            "COMMANDS",
            "  alpha  Read the",
            "         configuration values.",
            "  WRITE",
            "    beta-delta-epsilon",
            "        Write values.",
        ])
    );
}

#[tokio::test]
async fn a_stacked_right_cell_whose_unit_is_wider_than_its_space_overflows_on_its_own_line() {
    let application = root("app", false)
        .command(
            Command::new("alpha")
                .description("See https://example.com/a/very/long/path now.")
                .action(noop),
        )
        .action(noop);
    assert_eq!(
        block(&at(&application, Some(20)).await, "COMMANDS"),
        lines(&[
            "COMMANDS",
            "  alpha",
            "      See",
            "      https://example.com/a/very/long/path",
            "      now.",
        ])
    );
}

/// A page whose literals are each wider than a narrow terminal.
fn literals() -> App {
    let details = [
        "Use `one two three four five six` here.",
        "",
        "See [docs](https://example.com/a/very/long/path).",
        "",
        "```",
        "const value = compute(input, options);",
        "```",
    ]
    .join("\n");
    root("app", false)
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .details(details)
                .examples(vec![CommandExample::new("go --mode fast --level high")]),
        )])
        .option("mode", Opt::string().required())
        .option("level", Opt::string().required())
        .command(Command::new("go").description("Go.").action(noop))
        .action(noop)
}

#[tokio::test]
async fn usage_forms_left_cells_code_and_example_commands_print_whole_on_a_narrow_terminal() {
    let stdout = at(&literals(), Some(15)).await;
    let lines: Vec<&str> = stdout.split('\n').collect();
    for expected in [
        "  app --mode <mode> --level <level> [options]",
        "      --level <level>",
        "    const value = compute(input, options);",
        "  $ app go --mode fast --level high",
    ] {
        assert!(lines.contains(&expected), "{expected:?} in {stdout}");
    }
}

#[tokio::test]
async fn a_details_code_span_a_hints_command_and_a_link_destination_never_break() {
    let stdout = at(&literals(), Some(24)).await;
    assert_eq!(
        blocks(&stdout)[1..3].to_vec(),
        vec![
            lines(&["  Use", "  `one two three four five six`", "  here."]),
            lines(&["  See docs", "  (https://example.com/a/very/long/path)."]),
        ]
    );
    assert_eq!(
        blocks(&at(&literals(), Some(15)).await)
            .last()
            .cloned()
            .unwrap(),
        lines(&["Run", "app <command> --help", "for command", "details."])
    );
}

/// A page with prose, commands, options, and an example, whose only long lines are literals.
fn whole_page() -> App {
    root("app", false)
        .description("Read and reshape one document from a file or a pipe.")
        .extend([
            HELP_COMMAND.value(HelpCommandFacts::new().examples(vec![CommandExample::new(
                "get nested.deep.value --file doc.json",
            )])),
        ])
        .option(
            "file",
            Opt::string()
                .description("The document to read. Omit it to read piped text.")
                .short('f'),
        )
        .option(
            "format",
            Opt::string()
                .default("table")
                .description("Select the output format.")
                .extend([HELP_INPUT.value(HelpInputFacts::new().accepts("One of: table, json."))])
                .short('o'),
        )
        .option(
            "width",
            Opt::string()
                .default("8")
                .description("Set the width of each column.")
                .extend([HELP_INPUT.value(HelpInputFacts::new().section(&["Layout", "Columns"]))])
                .short('w'),
        )
        .option("quiet", Opt::boolean())
        .command(
            Command::new("get")
                .description("Read one value at a path in the document.")
                .action(noop),
        )
        .command(
            Command::new("select")
                .description("Keep the named fields of the document.")
                .action(noop),
        )
        .action(noop)
}

#[tokio::test]
async fn a_whole_page_fits_40_and_60_columns_and_only_a_literal_runs_past_them() {
    for columns in [40_usize, 60] {
        let stdout = at(&whole_page(), Some(u16::try_from(columns).unwrap())).await;
        let overflowing: Vec<&str> = stdout
            .split('\n')
            .filter(|line| line.chars().count() > columns)
            .collect();
        assert!(overflowing.iter().all(|line| line.starts_with("  $ ")));
        assert_eq!(overflowing.len(), usize::from(columns == 40));
    }
}

/// A root whose Details is the given Markdown.
fn details(markdown: &str) -> App {
    root("app", false)
        .extend([HELP_COMMAND.value(HelpCommandFacts::new().details(markdown))])
        .action(noop)
}

/// The Details lines of a page, between the masthead and USAGE and OPTIONS.
async fn details_at(markdown: &str, columns: Option<u16>) -> Vec<String> {
    let all = blocks(&at(&details(markdown), columns).await);
    all[1..all.len() - 2].concat()
}

#[tokio::test]
async fn a_paragraph_authored_across_lines_joins_and_wraps_on_a_terminal_and_keeps_its_lines_off_one()
 {
    let markdown = "The first line of text\nand the second line\nand the third.";
    assert_eq!(
        details_at(markdown, Some(40)).await,
        lines(&[
            "  The first line of text and the second",
            "  line and the third.",
        ])
    );
    assert_eq!(
        details_at(markdown, Some(200)).await,
        lines(&["  The first line of text and the second line and the third."])
    );
    assert_eq!(
        details_at(markdown, None).await,
        lines(&[
            "  The first line of text",
            "  and the second line",
            "  and the third.",
        ])
    );
}

#[tokio::test]
async fn a_list_item_continues_after_its_marker_nested_two_levels_and_a_quote_carries_its_marker() {
    let markdown = [
        "- A first item whose text runs long enough to wrap.",
        "  - A nested item whose text also runs long enough.",
        "",
        "> A quoted line of text that runs long enough to wrap.",
    ]
    .join("\n");
    assert_eq!(
        details_at(&markdown, Some(30)).await,
        lines(&[
            "  ● A first item whose text",
            "    runs long enough to wrap.",
            "    ● A nested item whose text",
            "      also runs long enough.",
            "  > A quoted line of text that",
            "  > runs long enough to wrap.",
        ])
    );
}

#[tokio::test]
async fn ordered_items_right_align_their_markers_and_wrap_under_their_text_column() {
    let markdown = (0..10)
        .map(|index| {
            if index == 0 {
                "1. A first item whose text runs long.".to_owned()
            } else {
                format!("{}. Item {}", index + 1, index + 1)
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let rendered = details_at(&markdown, Some(30)).await;
    assert_eq!(
        rendered[..3].to_vec(),
        lines(&[
            "   1. A first item whose text",
            "      runs long.",
            "   2. Item 2",
        ])
    );
    assert_eq!(
        rendered[rendered.len() - 2..].to_vec(),
        lines(&["   9. Item 9", "  10. Item 10"])
    );
    assert_eq!(
        details_at("3) one\n3) two", None).await,
        lines(&["  3. one", "  4. two"])
    );
}

#[tokio::test]
async fn a_nested_ordered_list_starts_at_its_bullet_parent_text_column_and_aligns_on_its_own() {
    assert_eq!(
        details_at("- parent\n  9. nine\n  9. ten", Some(30)).await,
        lines(&["  ● parent", "     9. nine", "    10. ten"])
    );
}

#[tokio::test]
async fn a_level_1_heading_underlines_the_widest_wrapped_line_off_a_terminal_and_on_one() {
    assert_eq!(
        details_at("# A heading that is long enough to wrap", None).await,
        lines(&[
            "  A heading that is long enough to wrap",
            "  ─────────────────────────────────────",
        ])
    );
    assert_eq!(
        details_at(
            "# A heading that is long enough to wrap\n## Level two\n",
            Some(30)
        )
        .await,
        lines(&[
            "  A heading that is long",
            "  enough to wrap",
            "  ──────────────────────",
            "  Level two",
        ])
    );
}

#[tokio::test]
async fn a_heading_wraps_and_code_keeps_every_line_as_written() {
    let markdown = [
        "# A heading that is long enough to wrap",
        "",
        "```",
        "first code line that is longer than thirty",
        "second",
        "```",
    ]
    .join("\n");
    assert_eq!(
        details_at(&markdown, Some(30)).await,
        lines(&[
            "  A heading that is long",
            "  enough to wrap",
            "  ──────────────────────",
            "    first code line that is longer than thirty",
            "    second",
        ])
    );
}

/// Color off and modifiers on.
fn modifiers_only() -> RenderingPolicy {
    RenderingPolicy::new()
        .color(loomcli_core::Switch::Never)
        .modifiers(loomcli_core::Switch::Always)
}

#[tokio::test]
async fn an_emphasis_pair_on_one_authored_line_stays_styled_after_the_join() {
    let stdout = render(
        &details("Some *emphasis* here\nand more."),
        &["--help"],
        Some(200),
        &[],
        Some(modifiers_only()),
    )
    .await;
    assert_eq!(
        blocks(&stdout)[1],
        lines(&["  Some \u{1b}[3memphasis\u{1b}[23m here and more."])
    );
}

/// A root with a long description, a deprecated child, and an example with a long note.
fn hanging() -> App {
    root("app", false)
        .description("Read and reshape one document from a file or a pipe.")
        .version("v1.2.3")
        .extend([HELP_COMMAND.value(HelpCommandFacts::new().examples(vec![
            CommandExample::new("old")
                .note("Reads the document from the named file and prints it."),
        ]))])
        .command(
            Command::new("old")
                .deprecated("Use the new command, which reads every format this one did.")
                .description("Read.")
                .action(noop),
        )
        .action(noop)
}

#[tokio::test]
async fn at_40_columns_each_prose_text_continues_where_its_first_line_started() {
    let stdout = at(&hanging(), Some(40)).await;
    assert_eq!(
        blocks(&stdout)[0],
        lines(&[
            "app · Read and reshape one document from",
            "      a file or a pipe.",
        ])
    );
    assert_eq!(
        block(&stdout, "EXAMPLES"),
        lines(&[
            "EXAMPLES",
            "  $ app old",
            "    Reads the document from the named",
            "    file and prints it.",
        ])
    );
    assert_eq!(
        blocks(&stdout).last().cloned().unwrap(),
        lines(&["Run app <command> --help for command", "details."])
    );
    assert_eq!(
        blocks(&render(&hanging(), &["old", "--help"], Some(40), &[], None).await)[0],
        lines(&[
            "app old · Read.",
            "  Deprecated: Use the new command, which",
            "              reads every format this",
            "              one did.",
        ])
    );
}

#[tokio::test]
async fn a_text_with_less_than_one_column_left_for_it_prints_unwrapped() {
    let application = root("application", false)
        .description("Read values from somewhere.")
        .action(noop);
    // At 2 columns even the fallback indent of 2 leaves no column, so the description stays whole.
    assert_eq!(
        blocks(&at(&application, Some(2)).await)[0],
        lines(&["application · Read values from somewhere."])
    );
    assert_eq!(
        block(&at(&children(), Some(6)).await, "COMMANDS"),
        lines(&[
            "COMMANDS",
            "  alpha",
            "      Read the configuration values.",
            "  beta-gamma",
            "      Write values.",
        ])
    );
}

#[tokio::test]
async fn a_tab_in_a_description_details_and_an_example_command_expands_on_a_terminal_alone() {
    let application = root("app", false)
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .details("A\tB\n\n```\nx\ty\n```")
                .examples(vec![CommandExample::new("run\tfast")]),
        )])
        .option("name", Opt::string().description("Name\tthe value."))
        .action(noop);
    let terminal = at(&application, Some(80)).await;
    assert!(!terminal.contains('\t'));
    assert_eq!(
        blocks(&terminal)[1..3].to_vec(),
        vec![lines(&["  A       B"]), lines(&["    x       y"])]
    );
    assert_eq!(
        block(&terminal, "OPTIONS")[1],
        "      --name <name>  Name    the value."
    );
    // An example command is a literal, so its tab expands from the start of its page line.
    assert_eq!(block(&terminal, "EXAMPLES")[1], "  $ app run     fast");
    let piped = at(&application, None).await;
    assert_eq!(
        blocks(&piped)[1..3].to_vec(),
        vec![lines(&["  A\tB"]), lines(&["    x\ty"])]
    );
    assert_eq!(
        block(&piped, "OPTIONS")[1],
        "      --name <name>  Name\tthe value."
    );
    assert_eq!(block(&piped, "EXAMPLES")[1], "  $ app run\tfast");
}

/// A root whose options are `-o, --out <folder>`, then `--quiet` when it is long-only.
fn outputs(quiet: bool, section: Option<&[&str]>) -> App {
    let facts = |facts: HelpInputFacts| match section {
        Some(path) => facts.section(path),
        None => facts,
    };
    let application = root("app", false).option(
        "out",
        Opt::string()
            .description("The folder to write the pages into.")
            .extend([HELP_INPUT.value(facts(HelpInputFacts::placeholder("folder")))])
            .short('o'),
    );
    let application = if quiet {
        let option = Opt::boolean().description("Print nothing.");
        let option = match section {
            Some(_) => option.extend([HELP_INPUT.value(facts(HelpInputFacts::new()))]),
            None => option,
        };
        application.option("quiet", option)
    } else {
        application
    };
    application.action(noop)
}

/// The columns where a stacked block's left cells start their text, and where its right cells do.
fn starts(lines: &[String]) -> (Vec<usize>, Vec<usize>) {
    let mut left = Vec::new();
    let mut right = Vec::new();
    for line in lines.iter().skip(1) {
        let column = line.len() - line.trim_start().len();
        if line.trim_start().starts_with('-') {
            left.push(column);
        } else {
            right.push(column);
        }
    }
    (left, right)
}

#[tokio::test]
async fn a_stacked_set_holding_a_long_only_option_starts_its_right_cells_past_every_spelling() {
    let options = block(&at(&outputs(true, None), Some(28)).await, "OPTIONS");
    assert_eq!(
        options,
        lines(&[
            "OPTIONS",
            "  -o, --out <folder>",
            "          The folder to",
            "          write the pages",
            "          into.",
            "      --quiet",
            "          Print nothing.",
            "  -h, --help",
            "          Show this help.",
            "  -V, --version",
            "          Print the version.",
        ])
    );
    let (left, right) = starts(&options);
    assert!(right.iter().all(|column| !left.contains(column)));
}

#[tokio::test]
async fn a_stacked_set_with_no_long_only_option_starts_its_right_cells_four_columns_in() {
    assert_eq!(
        block(&at(&outputs(false, None), Some(28)).await, "OPTIONS"),
        lines(&[
            "OPTIONS",
            "  -o, --out <folder>",
            "      The folder to write",
            "      the pages into.",
            "  -h, --help",
            "      Show this help.",
            "  -V, --version",
            "      Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_stacked_set_under_an_inner_heading_starts_its_right_cells_past_every_spelling() {
    let output = block(
        &at(&outputs(true, Some(&["Output", "Files"])), Some(28)).await,
        "OUTPUT",
    );
    assert_eq!(
        output,
        lines(&[
            "OUTPUT",
            "  FILES",
            "    -o, --out <folder>",
            "            The folder to",
            "            write the pages",
            "            into.",
            "        --quiet",
            "            Print nothing.",
        ])
    );
    let (left, right) = starts(&output[1..]);
    assert!(right.iter().all(|column| !left.contains(column)));
}

/// A root that reads stdin and declares an option group whose sentence is wide.
fn sentences() -> App {
    root("app", false)
        .option("format-json", Opt::boolean())
        .option("format-yaml", Opt::boolean())
        .option("format-toml", Opt::boolean())
        .exclusive(&["format-json", "format-yaml", "format-toml"])
        .stdin(
            Stdin::new()
                .description("The event stream that the application reads one record at a time.")
                .required(),
        )
        .action(noop)
}

/// The block whose first line starts with `opening`.
fn block_starting(stdout: &str, opening: &str) -> Vec<String> {
    blocks(stdout)
        .into_iter()
        .find(|lines| {
            lines
                .first()
                .is_some_and(|first| first.starts_with(opening))
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn the_input_sentences_and_an_option_group_sentence_wrap_at_their_indent() {
    let stdout = at(&sentences(), Some(40)).await;
    assert_eq!(
        block(&stdout, "INPUT"),
        lines(&[
            "INPUT",
            "  The event stream that the application",
            "  reads one record at a time.",
            "  Required. Reads piped or redirected",
            "  stdin. Terminal input is not accepted.",
            "  Example: <producer> | app",
        ])
    );
    assert_eq!(
        block_starting(&stdout, "  Use at most"),
        lines(&[
            "  Use at most one of --format-json,",
            "  --format-yaml, and --format-toml.",
        ])
    );
}

#[tokio::test]
async fn the_input_example_stays_whole_and_the_sentences_keep_their_lines_off_a_terminal() {
    assert_eq!(
        block(&at(&sentences(), Some(20)).await, "INPUT")
            .last()
            .cloned()
            .unwrap(),
        "  Example: <producer> | app"
    );
    let piped = at(&sentences(), None).await;
    assert_eq!(
        block(&piped, "INPUT"),
        lines(&[
            "INPUT",
            "  The event stream that the application reads one record at a time.",
            "  Required. Reads piped or redirected stdin. Terminal input is not accepted.",
            "  Example: <producer> | app",
        ])
    );
    assert_eq!(
        block_starting(&piped, "  Use at most"),
        lines(&["  Use at most one of --format-json, --format-yaml, and --format-toml."])
    );
}

/// A paragraph followed directly by a pipe table, whose last row is wider than 24 columns.
const TABLE: &str = "The fields of a record are\nlisted below.\n| Key | Value |   \n| --- | --- |\n| name | the full name of the user |";

#[tokio::test]
async fn table_rows_keep_their_lines_on_a_terminal_and_interrupt_the_paragraph_above_them() {
    assert_eq!(
        details_at(TABLE, Some(24)).await,
        lines(&[
            "  The fields of a record",
            "  are listed below.",
            "  | Key | Value |",
            "  | --- | --- |",
            "  | name | the full name of the user |",
        ])
    );
    assert_eq!(
        details_at(TABLE, Some(200)).await,
        lines(&[
            "  The fields of a record are listed below.",
            "  | Key | Value |",
            "  | --- | --- |",
            "  | name | the full name of the user |",
        ])
    );
}

#[tokio::test]
async fn table_rows_print_one_page_line_per_authored_line_off_a_terminal_read_inline_per_line() {
    assert_eq!(
        details_at(TABLE, None).await,
        lines(&[
            "  The fields of a record are",
            "  listed below.",
            "  | Key | Value |",
            "  | --- | --- |",
            "  | name | the full name of the user |",
        ])
    );
    let stdout = render(
        &details("| `a b` | *x* |\n| c | d |"),
        &["--help"],
        Some(200),
        &[],
        Some(modifiers_only()),
    )
    .await;
    assert_eq!(
        blocks(&stdout)[1],
        lines(&["  | `a b` | \u{1b}[3mx\u{1b}[23m |", "  | c | d |"])
    );
}

#[tokio::test]
async fn a_line_indented_four_spaces_directly_after_table_rows_reads_as_paragraph_text() {
    assert_eq!(
        details_at("Para.\n| a | b |\n    indented line after rows", None).await,
        lines(&["  Para.", "  | a | b |", "  indented line after rows"])
    );
    assert_eq!(
        details_at("| a | b |\n    indented line after rows", None).await,
        lines(&["  | a | b |", "  indented line after rows"])
    );
    assert_eq!(
        details_at("- item\n  | a | b |\n      deeper line", None).await,
        lines(&["  ● item", "    | a | b |", "    deeper line"])
    );
}

#[tokio::test]
async fn a_masthead_description_and_a_deprecation_continue_at_indent_2_when_their_hang_cannot_fit()
{
    let application = root("application", false)
        .description("Read the configuration values.")
        .command(
            Command::new("old")
                .deprecated("Use the configuration command.")
                .description("Read.")
                .action(noop),
        )
        .action(noop);
    assert_eq!(
        blocks(&at(&application, Some(20)).await)[0],
        lines(&["application · Read", "  the configuration", "  values.",])
    );
    assert_eq!(
        blocks(&render(&application, &["old", "--help"], Some(24), &[], None).await)[0],
        lines(&[
            "application old · Read.",
            "  Deprecated: Use the",
            "  configuration command.",
        ])
    );
}

#[tokio::test]
async fn a_list_item_continues_at_its_markers_column_when_its_hang_cannot_fit() {
    assert_eq!(
        details_at("- Set configurationvalue now.", Some(20)).await,
        lines(&["  ● Set", "  configurationvalue", "  now."])
    );
    assert_eq!(
        details_at("- outer\n  - Set configurationvalue now.", Some(20)).await,
        lines(&[
            "  ● outer",
            "    ● Set",
            "    configurationvalue",
            "    now.",
        ])
    );
}

/// The themed root with one child that is deprecated.
fn themed(name: &str, deprecated: &str) -> App {
    root("app", true)
        .command(
            Command::new(name)
                .deprecated(deprecated)
                .description("Read one.")
                .action(noop),
        )
        .action(noop)
}

#[tokio::test]
async fn a_wrapped_right_cell_closes_its_styles_before_the_indent_and_opens_them_after_it() {
    let stdout = render(
        &themed("get", "Use read."),
        &["--help"],
        Some(22),
        &[],
        Some(styled()),
    )
    .await;
    assert_eq!(
        block(&stdout, "\u{1b}[90mCOMMANDS\u{1b}[39m"),
        lines(&[
            "\u{1b}[90mCOMMANDS\u{1b}[39m",
            "  \u{1b}[33mget\u{1b}[39m  Read one.",
            "       \u{1b}[90m(\u{1b}[93mdeprecated:\u{1b}[39m",
            "       \u{1b}[93mUse read.\u{1b}[90m)\u{1b}[39m",
        ])
    );
}

#[tokio::test]
async fn a_wrapped_deprecation_message_and_a_stacked_row_keep_their_styles_on_every_line() {
    let application = themed("old", "Use the new command instead.");
    let stdout = render(
        &application,
        &["old", "--help"],
        Some(30),
        &[],
        Some(styled()),
    )
    .await;
    assert_eq!(
        blocks(&stdout)[0],
        lines(&[
            "\u{1b}[33;1mapp old\u{1b}[39;22m \u{1b}[90m·\u{1b}[39m Read one.",
            "  \u{1b}[93mDeprecated: Use the new\u{1b}[39m",
            "              \u{1b}[93mcommand instead.\u{1b}[39m",
        ])
    );
    let root_page = render(&application, &["--help"], Some(18), &[], Some(styled())).await;
    assert_eq!(
        block(&root_page, "\u{1b}[90mCOMMANDS\u{1b}[39m"),
        lines(&[
            "\u{1b}[90mCOMMANDS\u{1b}[39m",
            "  \u{1b}[33mold\u{1b}[39m",
            "      Read one.",
            "      \u{1b}[90m(\u{1b}[93mdeprecated:\u{1b}[39m",
            "      \u{1b}[93mUse the new\u{1b}[39m",
            "      \u{1b}[93mcommand\u{1b}[39m",
            "      \u{1b}[93minstead.\u{1b}[90m)\u{1b}[39m",
        ])
    );
}

/// An option bound to variables and to a configuration path whose segment holds a space.
fn bound(env: &[&str], themed: bool) -> App {
    root("app", themed)
        .option(
            "listen",
            Opt::string()
                .description("Where the server listens.")
                .env(env.iter().copied())
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("server.listen address"))]),
        )
        .action(noop)
}

#[tokio::test]
async fn a_variable_name_and_a_configuration_path_in_the_fact_parenthesis_never_break() {
    let application = bound(&["APP_SERVER_LISTEN_ADDRESS", "APP_ADDRESS"], false);
    for columns in [40_usize, 60] {
        let stdout = at(&application, Some(u16::try_from(columns).unwrap())).await;
        let lines: Vec<&str> = stdout.split('\n').collect();
        assert!(lines.iter().all(|line| line.chars().count() <= columns));
        for name in [
            "APP_SERVER_LISTEN_ADDRESS",
            "APP_ADDRESS",
            "server.listen address",
        ] {
            assert_eq!(
                lines.iter().filter(|line| line.contains(name)).count(),
                1,
                "{name} at {columns}"
            );
        }
        assert!(lines.iter().any(|line| line.contains("config:")));
    }
}

#[tokio::test]
async fn a_wrapped_binding_fact_prints_its_labels_names_and_separators_dim_on_every_line() {
    let stdout = render(
        &bound(&["APP_LISTEN", "APP_ADDRESS"], true),
        &["--help"],
        Some(40),
        &[],
        Some(styled()),
    )
    .await;
    assert_eq!(
        block(&stdout, "\u{1b}[90mOPTIONS\u{1b}[39m")[..5].to_vec(),
        lines(&[
            "\u{1b}[90mOPTIONS\u{1b}[39m",
            "      \u{1b}[33m--listen\u{1b}[39m \u{1b}[90;3m<listen>\u{1b}[39;23m",
            "          Where the server listens.",
            "          \u{1b}[90m(env: APP_LISTEN APP_ADDRESS,\u{1b}[39m",
            "          \u{1b}[90mconfig: server.listen address)\u{1b}[39m",
        ])
    );
}

/// A multiple option whose variable splits at a space, the delimiter a wrap could break.
fn list_bound(themed: bool) -> App {
    root("app", themed)
        .option(
            "word",
            Opt::string()
                .description("A word to count.")
                .env(["APP_WORDS"])
                .env_delimiter(" ")
                .multiple(),
        )
        .action(noop)
}

#[tokio::test]
async fn a_list_bindings_delimiter_literal_never_breaks_and_the_row_fits_40_and_60_columns() {
    assert_eq!(
        block(&at(&list_bound(false), Some(40)).await, "OPTIONS")[..5].to_vec(),
        lines(&[
            "OPTIONS",
            "      --word <word>  A word to count.",
            "                     (repeatable, env:",
            "                     APP_WORDS as a list",
            "                     separated by \" \")",
        ])
    );
    // At 36 columns a line ends between the literal's quotes unless the literal stays whole.
    for columns in [36_usize, 40, 60] {
        let stdout = at(&list_bound(false), Some(u16::try_from(columns).unwrap())).await;
        let lines: Vec<&str> = stdout.split('\n').collect();
        assert!(lines.iter().all(|line| line.chars().count() <= columns));
        assert_eq!(
            lines.iter().filter(|line| line.contains("\" \")")).count(),
            1
        );
    }
    // The words and the literal print dim on every line, as the names do.
    let stdout = render(
        &list_bound(true),
        &["--help"],
        Some(40),
        &[],
        Some(styled()),
    )
    .await;
    assert_eq!(
        block(&stdout, "\u{1b}[90mOPTIONS\u{1b}[39m")[3..5].to_vec(),
        lines(&[
            "                     \u{1b}[90mAPP_WORDS as a list\u{1b}[39m",
            "                     \u{1b}[90mseparated by \" \")\u{1b}[39m",
        ])
    );
}
