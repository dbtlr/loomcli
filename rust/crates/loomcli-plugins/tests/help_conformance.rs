//! Help pages of the conformance corpus, reproduced byte for byte by small applications shaped like
//! the reference's jsonkit and textstat examples. The other plugins those examples install are
//! stood in for by plugins that declare the same options and Commands, so the help page, which
//! reads the graph alone, prints what the reference's examples print.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{Outcome, noop, run, verbose_stand_in, version_stand_in};
use loomcli_core::{
    AnyPlugin, Application, Arg, Command, Done, InputSchema, Issue, NoInputs, NoResult, Opt,
    Plugin, Polarity, ValidationContext, Validator,
};
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::help::extension::{
    CommandExample, HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::help::help;
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Done>;

/// A validator that accepts every value and publishes a closed set as its schema.
struct OneOf(Value);

impl Validator for OneOf {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_owned())
    }

    fn input_schema(&self) -> InputSchema {
        self.0.as_object().cloned()
    }
}

fn one_of(values: &[&str]) -> OneOf {
    OneOf(json!({ "enum": values, "type": "string" }))
}

/// A plugin that declares one global option.
fn global(identity: &str, name: &str, option: loomcli_core::BooleanOpt) -> AnyPlugin {
    Plugin::new(identity).option(name, option).into()
}

/// A plugin that attaches one Command.
fn attaching(identity: &str, command: impl Into<loomcli_core::AnyCommand>) -> AnyPlugin {
    Plugin::new(identity).commands([command.into()]).into()
}

/// The content input every jsonkit Command that reads the document declares.
fn file() -> loomcli_core::ContentOpt {
    Opt::content()
        .description("The document to read. Omit it to read piped text.")
        .extend([HELP_INPUT.value(HelpInputFacts::placeholder("path"))])
        .required()
        .short('f')
        .stdin()
}

fn read(section: &str) -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    HELP_COMMAND.value(HelpCommandFacts::new().section(&["Document commands", section]))
}

/// jsonkit's shape: the help Command and four plugin Commands, then its own seven, two hidden and
/// one deprecated, and the globals of its plugins in installation order.
fn jsonkit() -> App {
    let doctor = Command::new("doctor")
        .description("Check the host this application runs on.")
        .action(noop);
    let completion = Command::new("completion")
        .description("Print or install a shell completion script.")
        .command(
            Command::new("bash")
                .description("Print the bash completion script.")
                .action(noop),
        );
    let mcp = Command::new("mcp")
        .description("Serve this application's tools to an MCP client over stdin and stdout.")
        .command(
            Command::new("config")
                .description("Print the MCP client configuration.")
                .action(noop),
        )
        .action(noop);
    let manpage = Command::new("manpage")
        .description("Write or install the man pages.")
        .command(
            Command::new("generate")
                .description("Write the man pages.")
                .action(noop),
        );
    let installed: Vec<AnyPlugin> = vec![
        help().command(true).into(),
        version_stand_in().into(),
        global(
            "@loomcli/plugins/manifest",
            "manifest",
            Opt::boolean()
                .control()
                .description("Print this command's manifest as JSON.")
                .short('M'),
        ),
        attaching("@loom/doctor", doctor),
        attaching("@loomcli/plugins/completion", completion),
        attaching("@loomcli/plugins/mcp", mcp),
        attaching("@loomcli/plugins/manpage", manpage),
        global(
            "@loom/explain",
            "explain",
            Opt::boolean()
                .control()
                .description("Explain the selected command and exit.")
                .short('e'),
        ),
        global(
            "@loomcli/plugins/color",
            "color",
            Opt::boolean()
                .color()
                .description("Turn color on or off, overriding NO_COLOR.")
                .polarity(Polarity::Both),
        ),
        verbose_stand_in().into(),
    ];
    let get = Command::new("get")
        .description("Read one value at a path.")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .details(
                    "A path is a dot-separated walk from the root of the document.\n\n- A **key** reads an object's member, such as `user.name`.\n- A **whole number** reads an array's item, such as `items.0`.\n\nThe document is *JSON*; see [the format](https://www.json.org/json-en.html).\n",
                )
                .examples(vec![
                    CommandExample::new("get name -f doc.json"),
                    CommandExample::new("get nested.deep.value -f doc.json"),
                ])
                .section(&["Document commands", "Read"]),
        )])
        .argument("path", Arg::string().description("Dot path to read.").required())
        .option("file", file())
        .action(noop);
    let keys = Command::new("keys")
        .description("List the keys at a path.")
        .alias("ls")
        .extend([read("Read")])
        .option("file", file())
        .action(noop);
    let select = Command::new("select")
        .description("Keep the named fields of the document.")
        .extend([read("Reshape")])
        .option("file", file())
        .option(
            "field",
            Opt::string()
                .description("A field to keep. Repeat it for several.")
                .multiple()
                .required()
                .short('F'),
        )
        .action(noop);
    let max =
        Command::new("max")
            .description("Print the deepest nesting level under a path.")
            .extend([HELP_COMMAND.value(HelpCommandFacts::new().examples(vec![
                CommandExample::new("stats depth max user -f doc.json"),
            ]))])
            .argument(
                "path",
                Arg::string().description("Dot path to measure. Omit it for the root."),
            )
            .option("file", file())
            .action(noop);
    let stats = Command::new("stats")
        .description("Report facts about the document's shape.")
        .extend([read("Read")])
        .command(
            Command::new("depth")
                .description("Measure how deeply the document nests.")
                .command(max),
        );
    let fetch = Command::new("fetch")
        .deprecated("Use get instead.")
        .description("Read one value at a path.")
        .extend([read("Read")])
        .argument(
            "path",
            Arg::string().description("Dot path to read.").required(),
        )
        .option("file", file())
        .action(noop);
    let debug = Command::new("debug")
        .description("Dump the parsed document.")
        .hidden()
        .option("file", file())
        .action(noop);
    let paths = Command::new("paths")
        .description("List every path in the document.")
        .hidden()
        .option("file", file())
        .action(noop);
    Application::new("jsonkit")
        .plugins(installed)
        .description("Read and reshape one JSON document.")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .command_sections(&[
                    &["Document commands", "Read"],
                    &["Document commands", "Reshape"],
                ])
                .details(
                    "With no subcommand, jsonkit summarizes the document and its top-level keys.",
                )
                .examples(vec![
                    CommandExample::new("-f doc.json"),
                    CommandExample::new("get user.name -f doc.json"),
                ]),
        )])
        .option("file", file())
        .option(
            "format",
            Opt::string()
                .description("Select the output format, records by default.")
                .short('o')
                .validate(one_of(&["records", "json", "jsonl"])),
        )
        .command(get)
        .command(keys)
        .command(select)
        .command(stats)
        .command(fetch)
        .command(debug)
        .command(paths)
        .action(noop)
}

/// textstat's shape: one root Command with a variadic content argument and sectioned options,
/// whose page folds the globals of its plugins into OPTIONS.
fn textstat() -> App {
    let installed: Vec<AnyPlugin> = vec![
        help().into(),
        version_stand_in().into(),
        global(
            "@loomcli/plugins/manifest",
            "manifest",
            Opt::boolean()
                .control()
                .description("Print this command's manifest as JSON.")
                .short('M'),
        ),
        Plugin::new("@loomcli/plugins/config")
            .option(
                "config",
                Opt::string()
                    .description("Read configuration from this file alone.")
                    .short('c'),
            )
            .option(
                "no-config",
                Opt::boolean().description("Read no configuration file."),
            )
            .into(),
        global(
            "@loom/explain",
            "explain",
            Opt::boolean()
                .control()
                .description("Explain the selected command and exit.")
                .short('e'),
        ),
    ];
    let section = |path: &[&str]| HELP_INPUT.value(HelpInputFacts::new().section(path));
    Application::new("textstat")
        .plugins(installed)
        .description("Count bytes, words, or lines across text sources.")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .details(
                    "Textstat counts files and piped text in order. Use - to place stdin among the files.",
                )
                .examples(vec![
                    CommandExample::new("one.txt two.txt"),
                    CommandExample::new("--metric words --total *.md"),
                ]),
        )])
        .argument(
            "files",
            Arg::content()
                .description("The files and piped text to count. Use - to place stdin.")
                .stdin()
                .variadic(),
        )
        .option(
            "metric",
            Opt::string()
                .default("bytes")
                .description("What each row counts.")
                .extend([section(&["Counting", "Measure"])])
                .short('m')
                .validate(one_of(&["bytes", "words", "lines"])),
        )
        .option(
            "min-bytes",
            Opt::string()
                .aliases(["minimum"])
                .default("0")
                .description("Drop a source smaller than this many bytes.")
                .env(["TEXTSTAT_MIN_BYTES"])
                .extend((
                    CONFIG_INPUT.value(ConfigInputFacts::path("minBytes")),
                    section(&["Counting", "Filter"]),
                ))
                .short('b'),
        )
        .option(
            "total",
            Opt::boolean()
                .description("Add a total row.")
                .env(["TEXTSTAT_TOTAL"])
                .extend((
                    CONFIG_INPUT.value(ConfigInputFacts::path("total")),
                    section(&["Counting", "Summary"]),
                ))
                .short('t'),
        )
        .option(
            "timing",
            Opt::boolean().description("Print how long each source took.").hidden(),
        )
        .option(
            "format",
            Opt::string()
                .description("Select the output format, table by default.")
                .short('f')
                .validate(one_of(&["table", "json", "jsonl"])),
        )
        .action(noop)
}

/// The captured stdout, stderr, and exit code of one conformance case.
fn expected(id: &str) -> Outcome {
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../conformance/expected")
        .join(id);
    let read = |name: &str| std::fs::read_to_string(folder.join(name)).unwrap();
    Outcome {
        status: read("exit").trim().parse().unwrap(),
        stdout: read("stdout"),
        stderr: read("stderr"),
    }
}

#[tokio::test]
async fn jsonkit_help_pages_match_the_conformance_corpus() {
    let application = jsonkit();
    let cases: [(&str, &[&str]); 18] = [
        ("jsonkit-help-root-long", &["--help"]),
        ("jsonkit-help-root-short", &["-h"]),
        ("jsonkit-help-get-long", &["get", "--help"]),
        ("jsonkit-help-select-long", &["select", "--help"]),
        ("jsonkit-help-fetch-deprecated-long", &["fetch", "--help"]),
        (
            "jsonkit-help-stats-depth-long",
            &["stats", "depth", "--help"],
        ),
        (
            "jsonkit-help-stats-depth-max-long",
            &["stats", "depth", "max", "--help"],
        ),
        ("jsonkit-help-command-root", &["help"]),
        ("jsonkit-help-command-get", &["help", "get"]),
        ("jsonkit-help-command-select", &["help", "select"]),
        ("jsonkit-help-command-stats", &["help", "stats"]),
        (
            "jsonkit-help-command-stats-depth-max",
            &["help", "stats", "depth", "max"],
        ),
        ("jsonkit-help-command-fetch-deprecated", &["help", "fetch"]),
        ("jsonkit-help-command-help", &["help", "help"]),
        ("jsonkit-help-command-long-flag", &["help", "get", "--help"]),
        ("jsonkit-help-command-unknown", &["help", "typo"]),
        ("jsonkit-help-command-unknown-near", &["help", "gte"]),
        (
            "jsonkit-help-command-unknown-nested",
            &["help", "stats", "depht"],
        ),
    ];
    for (id, argv) in cases {
        assert_eq!(run(&application, argv).await, expected(id), "{id}");
    }
}

#[tokio::test]
async fn textstat_help_pages_match_the_conformance_corpus() {
    let application = textstat();
    for (id, argv) in [
        ("textstat-help-long", &["--help"][..]),
        ("textstat-help-short", &["-h"][..]),
        (
            "textstat-help-held-unknown-option",
            &["--bogus", "--help"][..],
        ),
    ] {
        assert_eq!(run(&application, argv).await, expected(id), "{id}");
    }
}
