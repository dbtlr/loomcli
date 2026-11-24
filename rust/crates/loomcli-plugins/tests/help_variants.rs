//! Compact and extended help, ported from the reference's `help-variants.test.ts`, and the help
//! takeover and value rules of `help-invocation.test.ts`.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{Outcome, dispatch, page, panic_message, run, version_stand_in};
use loomcli_core::{
    Application, Arg, Command, Done, Fresh, NoInputs, NoResult, Opt, Polarity, View, override_view,
};
use loomcli_plugins::help::extension::{
    CommandExample, HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::help::help;
use loomcli_plugins::help::views::{HelpPage, HelpVariant, help_page};

type App = Application<NoInputs, NoResult, Done>;

fn installed(name: &str) -> Application<NoInputs, NoResult, Fresh> {
    Application::new(name).plugins((help(), version_stand_in()))
}

/// A root whose only extended block is EXAMPLES, a child whose only one is Details, and a child
/// with neither, under an optional override of the page.
fn variants(replacement: Option<View<HelpPage>>) -> App {
    let get = Command::new("get")
        .description("Read one value at a path.")
        .extend([
            HELP_COMMAND.value(HelpCommandFacts::new().details("Reads the value at one dot path."))
        ])
        .action(dispatch);
    let keys = Command::new("keys")
        .description("List the keys at a path.")
        .action(dispatch);
    let application = installed("app")
        .description("A fixture application.")
        .extend([HELP_COMMAND
            .value(HelpCommandFacts::new().examples(vec![CommandExample::new("get a.b")]))])
        .version("1.2.0");
    let application = match replacement {
        Some(replacement) => application.overrides([override_view(help_page(), replacement)]),
        None => application,
    };
    application.command(get).command(keys).action(dispatch)
}

const GLOBALS: [&str; 3] = [
    "GLOBAL OPTIONS",
    "  -h, --help     Show this help.",
    "  -V, --version  Print the version.",
];

fn lines(parts: &[&[&'static str]]) -> Vec<&'static str> {
    parts.iter().flat_map(|part| part.iter().copied()).collect()
}

/// The compact root page: the child hint spelled `-h`, then the pointer to its EXAMPLES.
fn compact_root() -> Outcome {
    page(&lines(&[
        &[
            "app · A fixture application.",
            "",
            "USAGE",
            "  app [options]",
            "  app <command> [options]",
            "",
            "COMMANDS",
            "  get   Read one value at a path.",
            "  keys  List the keys at a path.",
            "",
        ],
        &GLOBALS,
        &[
            "",
            "Run app <command> -h for command details.",
            "Run app --help for details and examples.",
        ],
    ]))
}

#[tokio::test]
async fn help_prints_the_extended_page_with_the_details_and_examples_and_the_long_child_hint() {
    assert_eq!(
        run(&variants(None), &["--help"]).await,
        page(&lines(&[
            &[
                "app · A fixture application.",
                "",
                "USAGE",
                "  app [options]",
                "  app <command> [options]",
                "",
                "COMMANDS",
                "  get   Read one value at a path.",
                "  keys  List the keys at a path.",
                "",
            ],
            &GLOBALS,
            &[
                "",
                "EXAMPLES",
                "  $ app get a.b",
                "",
                "Run app <command> --help for command details.",
            ],
        ]))
    );
    assert_eq!(
        run(&variants(None), &["get", "--help"]).await,
        page(&lines(&[
            &[
                "app get · Read one value at a path.",
                "",
                "  Reads the value at one dot path.",
                "",
                "USAGE",
                "  app get [options]",
                "",
            ],
            &GLOBALS,
        ]))
    );
}

#[tokio::test]
async fn short_h_prints_the_compact_page_of_a_group_the_child_hint_ahead_of_the_pointer() {
    assert_eq!(run(&variants(None), &["-h"]).await, compact_root());
}

#[tokio::test]
async fn short_h_drops_the_details_of_a_leaf_and_points_to_the_extended_page() {
    assert_eq!(
        run(&variants(None), &["get", "-h"]).await,
        page(&lines(&[
            &[
                "app get · Read one value at a path.",
                "",
                "USAGE",
                "  app get [options]",
                "",
            ],
            &GLOBALS,
            &["", "Run app get --help for details and examples."],
        ]))
    );
}

#[tokio::test]
async fn short_h_on_a_leaf_with_neither_details_nor_examples_prints_the_extended_page() {
    let extended = run(&variants(None), &["keys", "--help"]).await;
    assert_eq!(run(&variants(None), &["keys", "-h"]).await, extended);
    assert!(!extended.stdout.contains("Run "));
}

#[tokio::test]
async fn a_letter_in_a_short_group_is_spelled_h_so_vh_prints_the_compact_page() {
    assert_eq!(run(&variants(None), &["-Vh"]).await, compact_root());
}

#[tokio::test]
async fn h_then_help_holds_the_repeated_option_and_the_earlier_h_stands() {
    assert_eq!(
        run(&variants(None), &["-h", "--help"]).await,
        compact_root()
    );
}

#[tokio::test]
async fn an_override_of_the_page_receives_the_variant() {
    let replacement = View::new(|page: &HelpPage, _context| {
        let variant = match page.variant {
            HelpVariant::Compact => "compact",
            HelpVariant::Extended => "extended",
        };
        format!(
            "{}:{variant}\n",
            page.command.name.as_deref().unwrap_or("root")
        )
    });
    let application = variants(Some(replacement));
    for (argv, stdout) in [
        (vec!["-h"], "root:compact\n"),
        (vec!["--help"], "root:extended\n"),
        (vec!["get", "-h"], "get:compact\n"),
    ] {
        assert_eq!(
            run(&application, &argv).await,
            Outcome {
                status: 0,
                stdout: stdout.to_owned(),
                stderr: String::new(),
            }
        );
    }
}

// The cases of `help-invocation.test.ts`.

/// The fixture root with one child, the version stand-in after help.
fn versioned() -> App {
    let child = Command::new("get")
        .description("Read one value at a path.")
        .action(dispatch);
    installed("app")
        .description("A fixture application.")
        .version("1.2.0")
        .command(child)
        .action(dispatch)
}

const ROOT: [&str; 14] = [
    "app · A fixture application.",
    "",
    "USAGE",
    "  app [options]",
    "  app <command> [options]",
    "",
    "COMMANDS",
    "  get  Read one value at a path.",
    "",
    "GLOBAL OPTIONS",
    "  -h, --help     Show this help.",
    "  -V, --version  Print the version.",
    "",
    "Run app <command> --help for command details.",
];

/// Arguments, variadics, and required local options, on a root that has both usage forms.
fn usage() -> App {
    let run = Command::new("run")
        .description("Run one job.")
        .argument(
            "source",
            Arg::string().description("Where to read.").required(),
        )
        .argument("target", Arg::string().description("Where to write."))
        .option(
            "out",
            Opt::string()
                .description("The output path.")
                .required()
                .short('o'),
        )
        .option(
            "tag",
            Opt::string()
                .description("A tag to apply.")
                .multiple()
                .required(),
        )
        .option("mode", Opt::string().description("How to run."))
        .action(dispatch);
    let pack = Command::new("pack")
        .description("Pack the files.")
        .argument(
            "files",
            Arg::string()
                .description("The files to pack.")
                .required()
                .variadic(),
        )
        .action(dispatch);
    installed("app")
        .description("Do the work.")
        .version("1.2.0")
        .global_option("key", Opt::string().description("The key to use."))
        .global_option(
            "file",
            Opt::string()
                .description("The document to read.")
                .short('f'),
        )
        .command(run)
        .command(pack)
        .action(dispatch)
}

/// The page of the cells fixture, a leaf root with short letters to group.
fn cells() -> App {
    installed("app")
        .description("Show one option row for each spelling.")
        .version("1.2.0")
        .option(
            "file",
            Opt::string()
                .description("The document to read.")
                .extend([HELP_INPUT.value(HelpInputFacts::placeholder("path"))])
                .short('f'),
        )
        .option(
            "explain",
            Opt::boolean().description("Explain the selected command and exit."),
        )
        .option(
            "metric",
            Opt::string()
                .default("bytes")
                .description("What each row counts.")
                .short('m')
                .short_only(),
        )
        .option(
            "total",
            Opt::boolean().description("Add a total row.").short('t'),
        )
        .option(
            "quiet",
            Opt::boolean()
                .description("Print nothing.")
                .polarity(Polarity::Negative),
        )
        .option(
            "cache",
            Opt::boolean()
                .description("Use the cache.")
                .polarity(Polarity::Both),
        )
        .option("verbose", Opt::boolean().description("Say more."))
        .action(dispatch)
}

#[tokio::test]
async fn help_then_version_prints_help() {
    assert_eq!(
        run(&versioned(), &["--help", "--version"]).await,
        page(&ROOT)
    );
}

#[tokio::test]
async fn version_then_help_prints_help_too_because_installation_order_decides_the_takeover() {
    assert_eq!(
        run(&versioned(), &["--version", "--help"]).await,
        page(&ROOT)
    );
}

#[tokio::test]
async fn short_h_renders_while_a_required_argument_is_missing_and_a_local_option_is_unknown() {
    assert_eq!(
        run(&usage(), &["run", "-h", "--nope"]).await,
        page(&[
            "app run · Run one job.",
            "",
            "USAGE",
            "  app run <source> [target] --out <out> --tag <tag>... [options]",
            "",
            "ARGUMENTS",
            "  source  Where to read.",
            "  target  Where to write.",
            "",
            "OPTIONS",
            "  -o, --out <out>    The output path.  (required)",
            "      --tag <tag>    A tag to apply.  (required, repeatable)",
            "      --mode <mode>  How to run.",
            "",
            "GLOBAL OPTIONS",
            "      --key <key>    The key to use.",
            "  -f, --file <file>  The document to read.",
            "  -h, --help         Show this help.",
            "  -V, --version      Print the version.",
        ])
    );
}

#[tokio::test]
async fn an_unknown_command_still_fails_in_routing_before_any_middleware_runs() {
    assert_eq!(
        run(&usage(), &["nope", "--help"]).await,
        Outcome {
            status: 2,
            stdout: String::new(),
            stderr: "app: Unknown command \"nope\". Use one of: run, pack.\nRun \"app --help\" to see the usage.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn a_short_group_mixes_helps_letter_with_a_local_letter() {
    let compact = run(&cells(), &["-h"]).await;
    assert_eq!(compact.status, 0);
    assert_eq!(run(&cells(), &["-ht"]).await, compact);
    assert_eq!(run(&cells(), &["-thmwords"]).await, compact);
}

#[tokio::test]
async fn a_letter_that_faults_ends_its_group_so_xh_reports_the_unknown_option() {
    assert_eq!(
        run(&cells(), &["-xh"]).await,
        Outcome {
            status: 2,
            stdout: String::new(),
            stderr: "app: Unknown option \"-x\". Supply a declared option; prefix a hyphenated path with \"./\".\nRun \"app --help\" to see the usage.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn a_missing_value_and_a_repeated_help_are_held_so_help_after_them_renders_the_page() {
    let extended = run(&cells(), &["--help"]).await;
    assert_eq!(extended.status, 0);
    assert_eq!(run(&cells(), &["--file", "--help"]).await, extended);
    assert_eq!(run(&cells(), &["--help", "--help"]).await, extended);
}

/// Checks the Developer Diagnostic a declaration call panicked with: the whole message, the
/// `invalid-extension-value` diagnostic around `sentence` with the `finding` lines, and then the
/// reference's reading of the thrown fault, its sentence and corrections joined by a space,
/// against `thrown` (the reference's `thrown:1: ` prefix aside: the exit code of a call-time fault
/// is the Declaration faults deviation).
fn rejection(sentence: &str, finding: &[&str], thrown: &str) -> impl Fn(Option<String>) {
    let expected = format!(
        "-- INVALID EXTENSION VALUE --------------- @loomcli/core/invalid-extension-value\n\n\
         {sentence}\n\n{}\n\n\
         An extension value passes its descriptor's schema at the call that carries it,\n\
         synchronously, so every plugin that reads it reads a value the schema accepted.\n\n\
         Correct the value.",
        finding.join("\n")
    );
    let thrown = thrown.to_owned();
    move |message: Option<String>| {
        let message = message.expect("the declaration faults at its call");
        assert_eq!(message, expected);
        let paragraphs: Vec<&str> = message.split("\n\n").collect();
        let read = format!("{} {}\n", paragraphs[1], paragraphs[paragraphs.len() - 1]);
        assert_eq!(read, thrown);
    }
}

#[test]
fn a_whitespace_only_details_value_is_rejected_at_its_call() {
    rejection(
        "The root Command holds an invalid \"@loomcli/plugins/help/command\" value: Supply Markdown that holds a character other than whitespace.",
        &[
            "    Application::new(…)",
            "      .extend([…])",
            "               ^ extension \"@loomcli/plugins/help/command\"",
        ],
        "The root Command holds an invalid \"@loomcli/plugins/help/command\" value: Supply Markdown that holds a character other than whitespace. Correct the value.\n",
    )(panic_message(|| {
        drop(
            Application::new("app")
                .plugins((help(),))
                .extend([HELP_COMMAND.value(HelpCommandFacts::new().details(" \t\n "))])
                .action(dispatch),
        );
    }));
}

#[test]
fn an_example_command_that_spans_two_lines_is_rejected() {
    rejection(
        "Command \"get\" holds an invalid \"@loomcli/plugins/help/command\" value: Supply one line that holds a character other than whitespace.",
        &[
            "    // get",
            "    Command::new(\"get\")",
            "      .extend([…])",
            "               ^ extension \"@loomcli/plugins/help/command\"",
        ],
        "Command \"get\" holds an invalid \"@loomcli/plugins/help/command\" value: Supply one line that holds a character other than whitespace. Correct the value.\n",
    )(panic_message(|| {
        let get = Command::new("get")
            .extend([HELP_COMMAND
                .value(HelpCommandFacts::new().examples(vec![CommandExample::new("get\none")]))])
            .action(dispatch);
        drop(
            Application::new("app")
                .plugins((help(),))
                .command(get)
                .action(dispatch),
        );
    }));
}

#[test]
fn a_placeholder_that_holds_whitespace_is_rejected() {
    rejection(
        "Global option \"file\" holds an invalid \"@loomcli/plugins/help/input\" value: Supply one word with no whitespace.",
        &[
            "    Application::new(…)",
            "      .global_option(\"file\", Opt::string().extend([…]))",
            "                                                   ^ extension \"@loomcli/plugins/help/input\"",
        ],
        "Global option \"file\" holds an invalid \"@loomcli/plugins/help/input\" value: Supply one word with no whitespace. Correct the value.\n",
    )(panic_message(|| {
        drop(
            Application::new("app")
                .plugins((help(),))
                .global_option(
                    "file",
                    Opt::string().extend([HELP_INPUT.value(HelpInputFacts::placeholder("a path"))]),
                )
                .action(dispatch),
        );
    }));
}
