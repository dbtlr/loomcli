//! Ordered help sections, ported from the reference's `help-sections.test.ts`.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{loom_theme, noop, page, panic_message, run, run_with, styled};
use loomcli_core::{
    AnyPlugin, Application, Arg, Command, NoInputs, NoResult, Opt, Plugin, read_extension,
};
use loomcli_plugins::help::extension::{
    HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::help::help;
use loomcli_testing::MockFields;

type Done = loomcli_core::Application<NoInputs, NoResult, loomcli_core::Done>;
type Group = loomcli_core::GroupApplication<NoInputs, NoResult>;

fn command_section(path: &[&str]) -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    HELP_COMMAND.value(HelpCommandFacts::new().section(path))
}

fn input_section(path: &[&str]) -> loomcli_core::ExtensionValue<loomcli_core::OptionTarget> {
    HELP_INPUT.value(HelpInputFacts::new().section(path))
}

fn owned(paths: &[&[&str]]) -> Vec<Vec<String>> {
    paths
        .iter()
        .map(|path| path.iter().map(|part| (*part).to_owned()).collect())
        .collect()
}

#[test]
fn section_paths_and_page_orders_are_help_metadata_stored_as_authored_without_installing_help() {
    let application = Application::new("sections")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .command_sections(&[&["Work", "Read"]])
                .option_sections(&[&["Output"]])
                .section(&[" Root ", "Unused"]),
        )])
        .global_option(
            "quiet",
            Opt::boolean().extend([input_section(&["Output", "Logging"])]),
        )
        .action(noop);
    let graph = application.inspect().unwrap();
    let command = read_extension(&graph.root, &HELP_COMMAND).unwrap().unwrap();
    assert_eq!(command.command_sections, Some(owned(&[&["Work", "Read"]])));
    assert_eq!(command.option_sections, Some(owned(&[&["Output"]])));
    assert_eq!(
        command.section,
        Some(owned(&[&[" Root ", "Unused"]]).remove(0))
    );
    let input = read_extension(&*graph.globals[0], &HELP_INPUT)
        .unwrap()
        .unwrap();
    assert_eq!(
        input.section,
        Some(owned(&[&["Output", "Logging"]]).remove(0))
    );
}

fn commands(include_default: bool) -> Group {
    let next = Command::new("next")
        .description("Find ready tasks.")
        .extend([command_section(&["Work commands", "Read"])])
        .action(noop);
    let done = Command::new("done")
        .description("Complete a task.")
        .extend([command_section(&["Work commands", "Lifecycle"])])
        .action(noop);
    let doctor = Command::new("doctor")
        .description("Check the application.")
        .action(noop);
    let application = Application::new("work")
        .plugins((help(),))
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .command_sections(&[
                    &["Work commands", "Read"],
                    &["Work commands", "Lifecycle"],
                    &["commands"],
                ])
                .section(&["Ignored root membership"]),
        )])
        .command(done)
        .command(next)
        .command(
            Command::new("hidden")
                .extend([command_section(&["Invisible"])])
                .hidden()
                .action(noop),
        );
    if include_default {
        application.command(doctor)
    } else {
        application
    }
}

#[tokio::test]
async fn nested_command_sections_replace_defaults_and_retain_the_child_hint() {
    for spelling in ["--help", "-h"] {
        let hint = format!("Run work <command> {spelling} for command details.");
        assert_eq!(
            run(&commands(true), &[spelling]).await,
            page(&[
                "work",
                "",
                "USAGE",
                "  work <command> [options]",
                "",
                "WORK COMMANDS",
                "  READ",
                "    next  Find ready tasks.",
                "  LIFECYCLE",
                "    done  Complete a task.",
                "",
                "COMMANDS",
                "  doctor  Check the application.",
                "",
                "GLOBAL OPTIONS",
                "  -h, --help  Show this help.",
                "",
                &hint,
            ])
        );
    }
}

fn options() -> Done {
    Application::new("report")
        .plugins((help(),))
        .extend([
            HELP_COMMAND.value(HelpCommandFacts::new().option_sections(&[
                &["Output", "Logging"],
                &["Output", "Format"],
                &["options"],
            ])),
        ])
        .global_option(
            "quiet",
            Opt::boolean()
                .description("Suppress progress.")
                .extend([input_section(&["output", "format"])])
                .short('q'),
        )
        .global_option(
            "log",
            Opt::boolean()
                .description("Print logs.")
                .extend([input_section(&["Output", "Logging"])])
                .short('l'),
        )
        .argument(
            "files",
            Arg::string()
                .description("Files to read.")
                .required()
                .variadic(),
        )
        .option(
            "format",
            Opt::string()
                .description("Select the format.")
                .extend([input_section(&["OUTPUT", "FORMAT"])])
                .short('f'),
        )
        .option(
            "stream",
            Opt::boolean()
                .description("Stream results.")
                .extend([input_section(&["Output"])]),
        )
        .option(
            "strict",
            Opt::boolean().description("Reject unreadable files."),
        )
        .action(noop)
}

#[tokio::test]
async fn named_sections_combine_local_and_global_options_and_fold_defaults_on_a_childless_root() {
    assert_eq!(
        run(&options(), &["--help"]).await,
        page(&[
            "report",
            "",
            "USAGE",
            "  report <files...> [options]",
            "",
            "ARGUMENTS",
            "  files  Files to read.",
            "",
            "OUTPUT",
            "      --stream  Stream results.",
            "  LOGGING",
            "    -l, --log  Print logs.",
            "  FORMAT",
            "    -f, --format <format>  Select the format.",
            "    -q, --quiet            Suppress progress.",
            "",
            "OPTIONS",
            "      --strict  Reject unreadable files.",
            "  -h, --help    Show this help.",
        ])
    );
}

fn sectioned(
    name: &str,
    section: Option<&[&str]>,
    description: Option<&str>,
    hidden: bool,
) -> Command {
    let command = Command::new(name);
    let command = match description {
        Some(description) => command.description(description),
        None => command,
    };
    let command = match section {
        Some(path) => command.extend([command_section(path)]),
        None => command,
    };
    let command = if hidden { command.hidden() } else { command };
    command.action(noop)
}

fn ordered(parent_only: bool) -> Group {
    let contributed: AnyPlugin = Plugin::new("@fixture/sections")
        .commands([sectioned(
            "info",
            Some(&["Machinery"]),
            Some("Inspect machinery."),
            false,
        )])
        .into();
    let mut order: Vec<&[&str]> = Vec::new();
    if parent_only {
        order.push(&["Work"]);
    }
    order.extend::<[&[&str]; 7]>([
        &["Work", "Archive"],
        &["Machinery"],
        &["Work", "Read"],
        &["Extra"],
        &["Work", "Lifecycle"],
        &["work", "read"],
        &["Missing"],
    ]);
    Application::new("ordered")
        .plugins((help(), contributed))
        .extend([HELP_COMMAND.value(HelpCommandFacts::new().command_sections(&order))])
        .command(sectioned(
            "hidden",
            Some(&["Zeta"]),
            Some("Never print this."),
            true,
        ))
        .command(sectioned("doctor", None, None, false))
        .command(sectioned(
            "next",
            Some(&["Work", "Read"]),
            Some("Find tasks."),
            false,
        ))
        .command(sectioned(
            "move",
            Some(&["Work", "Edit"]),
            Some("Move work."),
            false,
        ))
        .command(sectioned(
            "done",
            Some(&["Work", "Lifecycle"]),
            Some("Finish work."),
            false,
        ))
        .command(sectioned(
            "overview",
            Some(&["work", "read"]),
            Some("Project overview."),
            false,
        ))
        .command(sectioned(
            "status",
            Some(&["Work"]),
            Some("Show status."),
            false,
        ))
        .command(sectioned(
            "archive",
            Some(&["Work", "Archive"]),
            Some("Never print this."),
            true,
        ))
        .command(sectioned(
            "extra",
            Some(&["Extra"]),
            Some("More work."),
            false,
        ))
        .command(sectioned("alpha", Some(&["Alpha"]), None, false))
        .command(sectioned("zeta", Some(&["Zeta"]), None, false))
}

#[tokio::test]
async fn a_partial_order_ignores_hidden_paths_and_keeps_outer_sections_contiguous() {
    let work = [
        "WORK",
        "  status  Show status.",
        "  READ",
        "    next      Find tasks.",
        "    overview  Project overview.",
        "  LIFECYCLE",
        "    done  Finish work.",
        "  EDIT",
        "    move  Move work.",
    ];
    let machinery = ["MACHINERY", "  info  Inspect machinery."];
    for parent_only in [false, true] {
        let mut lines = vec!["ordered", "", "USAGE", "  ordered <command> [options]", ""];
        if parent_only {
            lines.extend(work);
            lines.push("");
            lines.extend(machinery);
        } else {
            lines.extend(machinery);
            lines.push("");
            lines.extend(work);
        }
        lines.extend([
            "",
            "EXTRA",
            "  extra  More work.",
            "",
            "COMMANDS",
            "  doctor",
            "",
            "ALPHA",
            "  alpha",
            "",
            "ZETA",
            "  zeta",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help  Show this help.",
            "",
            "Run ordered <command> --help for command details.",
        ]);
        assert_eq!(
            run(&ordered(parent_only), &["--help"]).await,
            page(&lines),
            "parent only: {parent_only}"
        );
    }
}

/// Whether building with one invalid path in one slot faults under `invalid-extension-value`.
fn rejected(path: &[&str], slot: &str) -> bool {
    let value = || HELP_INPUT.value(HelpInputFacts::new().section(path));
    let message = panic_message(|| {
        let application = match slot {
            "command" => Application::new("invalid")
                .extend([HELP_COMMAND.value(HelpCommandFacts::new().section(path))])
                .action(noop),
            "local" => Application::new("invalid")
                .option("quiet", Opt::boolean().extend([value()]))
                .action(noop),
            "global" => Application::new("invalid")
                .global_option("quiet", Opt::boolean().extend([value()]))
                .action(noop),
            "plugin" => Application::new("invalid")
                .plugins((Plugin::new("@fixture/invalid")
                    .option("quiet", Opt::boolean().extend([value()])),))
                .action(noop),
            "commands" => Application::new("invalid")
                .extend([HELP_COMMAND.value(HelpCommandFacts::new().command_sections(&[path]))])
                .action(noop),
            _ => Application::new("invalid")
                .extend([HELP_COMMAND.value(HelpCommandFacts::new().option_sections(&[path]))])
                .action(noop),
        };
        if let Err(fault) = application.inspect() {
            panic!("{}", loomcli_core::FailureFacts::message(&fault));
        }
    });
    message.is_some_and(|message| message.contains("invalid-extension-value"))
}

#[test]
fn invalid_paths_are_rejected_by_ordinary_extension_validation_in_every_declaration_slot() {
    let paths: [&[&str]; 4] = [&[], &["One", "Two", "Three"], &[" "], &["One\nTwo"]];
    let mut verdicts = Vec::new();
    for path in paths {
        for slot in [
            "command", "local", "global", "plugin", "commands", "options",
        ] {
            verdicts.push((path, slot, rejected(path, slot)));
        }
    }
    assert_eq!(verdicts.len(), 24);
    for (path, slot, verdict) in verdicts {
        assert!(verdict, "{path:?} in {slot}");
    }
}

#[tokio::test]
async fn named_only_child_listings_keep_the_hint_without_printing_commands() {
    for spelling in ["--help", "-h"] {
        let outcome = run(&commands(false), &[spelling]).await;
        assert_eq!(outcome.status, 0);
        assert_eq!(outcome.stderr, "");
        assert!(!outcome.stdout.contains("\nCOMMANDS\n"));
        assert!(outcome.stdout.contains(&format!(
            "Run work <command> {spelling} for command details.\n"
        )));
    }
}

#[tokio::test]
async fn a_child_page_owns_option_order_and_lists_plugin_globals_in_authored_sections() {
    let tracing: AnyPlugin = Plugin::new("@fixture/tracing")
        .option(
            "trace",
            Opt::boolean()
                .description("Trace calls.")
                .extend([input_section(&["Trace"])]),
        )
        .into();
    let child = Command::new("tools")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .option_sections(&[&["Global options"], &["Options"]])
                .section(&["Root commands"]),
        )])
        .argument(
            "file",
            Arg::string().description("File to read.").required(),
        )
        .option("mode", Opt::boolean().description("Use mode."))
        .action(noop);
    let application = Application::new("scoped")
        .plugins((help(), tracing))
        .extend([
            HELP_COMMAND.value(HelpCommandFacts::new().option_sections(&[
                &["Trace"],
                &["Output"],
                &["Global options"],
            ])),
        ])
        .global_option(
            "quiet",
            Opt::boolean()
                .description("Say less.")
                .extend([input_section(&["Output"])])
                .short('q'),
        )
        .command(child);
    assert_eq!(
        run(&application, &["tools", "--help"]).await,
        page(&[
            "scoped tools",
            "",
            "USAGE",
            "  scoped tools <file> [options]",
            "",
            "ARGUMENTS",
            "  file  File to read.",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help  Show this help.",
            "",
            "OPTIONS",
            "      --mode  Use mode.",
            "",
            "OUTPUT",
            "  -q, --quiet  Say less.",
            "",
            "TRACE",
            "      --trace  Trace calls.",
        ])
    );
}

#[tokio::test]
async fn a_nested_command_uses_its_own_child_section_order_without_enclosing_its_page() {
    let parent = Command::new("tools")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .command_sections(&[&["Read"], &["Edit"]])
                .section(&["Outer", "Ignored"]),
        )])
        .command(sectioned("edit", Some(&["Edit"]), None, false))
        .command(sectioned("read", Some(&["Read"]), None, false));
    let application = Application::new("nested")
        .plugins((help(),))
        .extend([
            HELP_COMMAND.value(HelpCommandFacts::new().command_sections(&[&["Edit"], &["Read"]]))
        ])
        .command(parent);
    assert_eq!(
        run(&application, &["tools", "--help"]).await,
        page(&[
            "nested tools",
            "",
            "USAGE",
            "  nested tools <command> [options]",
            "",
            "READ",
            "  read",
            "",
            "EDIT",
            "  edit",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help  Show this help.",
            "",
            "Run nested tools <command> --help for command details.",
        ])
    );
}

#[test]
fn grouping_preserves_graph_authoring_order_including_hidden_and_plugin_attached_commands() {
    let graph = ordered(false).inspect().unwrap();
    let names: Vec<String> = graph
        .root
        .children
        .iter()
        .filter_map(|child| child.name.clone())
        .collect();
    assert_eq!(
        names,
        [
            "info", "hidden", "doctor", "next", "move", "done", "overview", "status", "archive",
            "extra", "alpha", "zeta",
        ]
    );
}

fn wide() -> Done {
    Application::new("wide")
        .plugins((help(), loom_theme()))
        .option(
            "field",
            Opt::string()
                .description("Fields.")
                .extend([HELP_INPUT.value(
                    HelpInputFacts::placeholder("界界")
                        .section(&["out\u{e001}put", "fi\u{e002}les"]),
                )])
                .short('F'),
        )
        .option(
            "mark",
            Opt::string()
                .description("Short.")
                .extend([HELP_INPUT.value(
                    HelpInputFacts::placeholder("é").section(&["OUT\u{e001}PUT", "FI\u{e002}LES"]),
                )])
                .short('x')
                .short_only(),
        )
        .option(
            "hidden-long-name",
            Opt::boolean()
                .extend([input_section(&["out\u{e001}put", "fi\u{e002}les"])])
                .hidden(),
        )
        .action(noop)
}

#[tokio::test]
async fn nested_rows_measure_terminal_columns_and_literal_heading_markers_print_without_markup() {
    assert_eq!(
        run(&wide(), &["--help"]).await,
        page(&[
            "wide",
            "",
            "USAGE",
            "  wide [options]",
            "",
            "OUT\u{e001}PUT",
            "  FI\u{e002}LES",
            "    -F, --field <界界>  Fields.",
            "    -x <é>              Short.",
            "",
            "OPTIONS",
            "  -h, --help  Show this help.",
        ])
    );
    let (outcome, _) = run_with(&wide(), MockFields::new().argv(["--help"]), Some(styled())).await;
    assert_eq!(outcome.status, 0);
    assert_eq!(outcome.stderr, "");
    assert!(
        outcome
            .stdout
            .contains("\u{1b}[90mOUT\u{e001}PUT\u{1b}[39m\n  \u{1b}[90mFI\u{e002}LES\u{1b}[39m\n")
    );
}
