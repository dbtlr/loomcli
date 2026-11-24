//! The help page's blocks and rows, ported from the reference's `help-page.test.ts` and the help
//! cases of `views.test.ts`, run against fixture applications on the mock process.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{Outcome, dispatch, page, run, verbose_stand_in, version_stand_in};
use loomcli_core::{
    Application, Arg, Command, Done, NoInputs, NoResult, Opt, Polarity, View, override_view,
};
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::help::extension::{
    CommandExample, HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::help::help;
use loomcli_plugins::help::views::{HelpPage, help_page};

type App = Application<NoInputs, NoResult, Done>;

/// An application that installs help and the version stand-in, as the reference's fixtures do.
fn installed(name: &str) -> Application<NoInputs, NoResult, loomcli_core::Fresh> {
    Application::new(name).plugins((help(), version_stand_in()))
}

/// A group, a child with an action and children of its own, and a root that has both forms.
fn nested() -> App {
    let clear = Command::new("clear")
        .description("Empty the cache.")
        .action(dispatch);
    let cache = Command::new("cache")
        .description("Manage the cache.")
        .command(clear);
    let now = Command::new("now")
        .description("Copy it at once.")
        .action(dispatch);
    let sync = Command::new("sync")
        .description("Copy the store to a remote.")
        .command(now)
        .action(dispatch);
    installed("store")
        .description("Keep a local store.")
        .version("1.2.0")
        .command(cache)
        .command(sync)
        .action(dispatch)
}

/// One option row for each left cell the page can print, on a root that folds in the globals.
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
        // A placeholder on a Boolean option is accepted and never shown.
        .option(
            "verbose",
            Opt::boolean()
                .description("Say more.")
                .extend([HELP_INPUT.value(HelpInputFacts::placeholder("level"))]),
        )
        .action(dispatch)
}

/// One row for each fact the right-cell rule can carry, and two rows that carry none. A Rust
/// default is a raw string, so the reference's number, bigint, and non-finite defaults are their
/// strings here, which print the same bytes.
fn facts() -> App {
    installed("app")
        .description("Show one right cell for each fact.")
        .version("1.2.0")
        .argument(
            "path",
            Arg::string().description("Dot path to read.").required(),
        )
        .argument(
            "depth",
            Arg::string().default("1").description("How deep to walk."),
        )
        .option(
            "field",
            Opt::string()
                .description("A field to keep.")
                .multiple()
                .required()
                .short('F'),
        )
        .option(
            "legacy-field",
            Opt::string()
                .deprecated("Use --field instead.")
                .description("A field to keep, the old way.")
                .multiple()
                .required(),
        )
        .option(
            "mode",
            Opt::string().default("plain").description("How to print."),
        )
        .option(
            "tags",
            Opt::string()
                .default(["one", "two"])
                .description("The tags to keep.")
                .multiple(),
        )
        .option(
            "limit",
            Opt::string().default("3").description("How many rows."),
        )
        .option(
            "label",
            Opt::string().default("a\nb").description("The label."),
        )
        .option(
            "count",
            Opt::string().default("10").description("How many items."),
        )
        .option(
            "nan",
            Opt::string().default("NaN").description("The unset ratio."),
        )
        .option(
            "inf",
            Opt::string()
                .default("Infinity")
                .description("The upper bound."),
        )
        .option("note", Opt::string().description("A note."))
        .option("source", Opt::string().required())
        .option("plain", Opt::boolean())
        .option(
            "legacy-quiet",
            Opt::boolean()
                .deprecated("Use --quiet instead.")
                .description("Print nothing, the old way.")
                .polarity(Polarity::Negative),
        )
        .action(dispatch)
}

/// Every spelling a counted option and a string option with an implied value print.
fn kinds() -> App {
    installed("copyit")
        .description("Copy files with backups.")
        .version("1.2.0")
        .argument(
            "files",
            Arg::string()
                .description("The files to copy.")
                .required()
                .variadic(),
        )
        .option(
            "backup",
            Opt::string()
                .description("How to back up each file.")
                .extend([HELP_INPUT.value(
                    HelpInputFacts::placeholder("control")
                        .accepts("Use none, simple, or numbered."),
                )])
                .implied("simple")
                .short('b'),
        )
        .option(
            "suffix",
            Opt::string()
                .default("~")
                .description("The backup suffix.")
                .implied(".bak"),
        )
        .option(
            "color",
            Opt::string().implied("auto").short('c').short_only(),
        )
        .option("tag", Opt::string().implied("a\nb").multiple().required())
        .option(
            "mode",
            Opt::string()
                .implied("fast")
                .required()
                .short('m')
                .short_only(),
        )
        .option(
            "verbose",
            Opt::count()
                .description("Say more.")
                .extend([
                    HELP_INPUT.value(HelpInputFacts::placeholder("level").accepts("Never shown."))
                ])
                .short('v'),
        )
        .option("quiet", Opt::count().short('q').short_only())
        .option("level", Opt::count().deprecated("Use -v instead."))
        .action(dispatch)
}

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

/// A root with no description, prose across three line terminators, and two examples.
fn prose() -> App {
    installed("app")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .details("first line\r\nsecond line\u{85}third line")
                .examples(vec![
                    CommandExample::new("run one").note("The first job."),
                    CommandExample::new("run two"),
                ]),
        )])
        .version("1.2.0")
        .action(dispatch)
}

/// A child of each listing shape: plain, deprecated, hidden, both, and an all-hidden group.
fn children() -> App {
    let get = Command::new("get")
        .description("Read one value at a path.")
        .action(dispatch);
    let fetch = Command::new("fetch")
        .deprecated("Use get instead.")
        .description("Read one value at a path.")
        .action(dispatch);
    let debug = Command::new("debug")
        .description("Dump the document.")
        .hidden()
        .option("depth", Opt::string().description("How deep to walk."))
        .option(
            "trace",
            Opt::boolean().description("Trace the run.").hidden(),
        )
        .action(dispatch);
    let gone = Command::new("gone")
        .deprecated("Use get instead.")
        .description("Read the old way.")
        .hidden()
        .action(dispatch);
    let clear = Command::new("clear")
        .description("Empty the cache.")
        .hidden()
        .action(dispatch);
    let cache = Command::new("cache")
        .description("Manage the cache.")
        .command(clear);
    installed("app")
        .description("Do the work.")
        .version("1.2.0")
        .command(get)
        .command(fetch)
        .command(debug)
        .command(gone)
        .command(cache)
        .action(dispatch)
}

/// A root with an action whose every child is hidden.
fn unlisted() -> App {
    let debug = Command::new("debug")
        .description("Dump the document.")
        .hidden()
        .action(dispatch);
    installed("app")
        .description("Do the work.")
        .version("1.2.0")
        .command(debug)
        .action(dispatch)
}

/// A hidden option and a deprecated option in each scope a page prints as its own section.
fn scoped() -> App {
    let run = Command::new("run")
        .description("Run one job.")
        .action(dispatch);
    installed("app")
        .description("Do the work.")
        .version("1.2.0")
        .global_option("key", Opt::string().description("The key to use."))
        .global_option(
            "token",
            Opt::string().description("The token to use.").hidden(),
        )
        .option(
            "mode",
            Opt::string()
                .default("plain")
                .deprecated("Use --style instead.")
                .description("How to print."),
        )
        .option(
            "trace",
            Opt::boolean().description("Trace the run.").hidden(),
        )
        .option(
            "secret",
            Opt::string()
                .description("The secret to use.")
                .hidden()
                .required(),
        )
        .command(run)
        .action(dispatch)
}

/// A hidden option of each scope on a root that folds the globals into its own OPTIONS.
fn folded() -> App {
    installed("app")
        .description("Do the work.")
        .version("1.2.0")
        .global_option("key", Opt::string().description("The key to use."))
        .global_option(
            "token",
            Opt::string().description("The token to use.").hidden(),
        )
        .option("mode", Opt::string().description("How to print."))
        .option(
            "trace",
            Opt::boolean().description("Trace the run.").hidden(),
        )
        .action(dispatch)
}

/// Descriptions and a deprecation message an author wrote across several lines.
fn multiline() -> App {
    let fetch = Command::new("fetch")
        .deprecated("Use get\ninstead.")
        .description("Read one value\r\nat a path.")
        .option("depth", Opt::string().description("How deep\nto walk."))
        .action(dispatch);
    installed("app")
        .description("Do the\nwork.")
        .version("1.2.0")
        .command(fetch)
        .action(dispatch)
}

/// Options that bind variables and a configuration key, and one that hides its bindings.
fn bindings() -> App {
    installed("app")
        .description("Show each binding fact.")
        .version("1.2.0")
        .option(
            "region",
            Opt::string()
                .default("eu")
                .description("The region to use.")
                .env(["APP_REGION", "APP_ZONE"])
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("cloud.region"))])
                .implied("us"),
        )
        .option(
            "cache",
            Opt::boolean()
                .description("Use the cache.")
                .env(["APP_CACHE"]),
        )
        .option(
            "retries",
            Opt::string().extend([CONFIG_INPUT.value(ConfigInputFacts::path("retries"))]),
        )
        .option(
            "old",
            Opt::string()
                .deprecated("Use --region instead.")
                .env(["APP_OLD"])
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("old"))]),
        )
        .option(
            "token",
            Opt::string()
                .description("The access token.")
                .env(["APP_TOKEN"])
                .extend((
                    CONFIG_INPUT.value(ConfigInputFacts::path("token")),
                    HELP_INPUT.value(HelpInputFacts::new().hide_bindings()),
                )),
        )
        .action(dispatch)
}

/// Multiple options whose variables hold a delimited list, and one that hides its bindings.
fn list_bindings() -> App {
    installed("app")
        .description("Show each list binding.")
        .version("1.2.0")
        .option(
            "field",
            Opt::string()
                .description("A field to print.")
                .env(["APP_FIELDS", "FIELDS"])
                .env_delimiter(",")
                .multiple(),
        )
        .option(
            "word",
            Opt::string()
                .env(["APP_WORDS"])
                .env_delimiter(" ")
                .multiple(),
        )
        .option(
            "secret",
            Opt::string()
                .env(["APP_SECRETS"])
                .env_delimiter(";")
                .extend([HELP_INPUT.value(HelpInputFacts::new().hide_bindings())])
                .multiple(),
        )
        .action(dispatch)
}

/// The fetchit root with the verbose and quiet marks.
fn verbose() -> App {
    Application::new("fetchit")
        .plugins((help(), version_stand_in(), verbose_stand_in()))
        .description("Fetch records.")
        .version("1.2.0")
        .action(dispatch)
}

/// The reference's `branded` fixture under one override of the help page.
fn branded(replacement: View<HelpPage>) -> App {
    let child = Command::new("get")
        .description("Read one value at a path.")
        .action(dispatch);
    installed("app")
        .description("A fixture application.")
        .version("1.2.0")
        .overrides([override_view(help_page(), replacement)])
        .command(child)
        .action(dispatch)
}

#[tokio::test]
async fn a_root_with_an_action_and_children_prints_both_usage_forms_and_the_closing_hint() {
    assert_eq!(
        run(&nested(), &["--help"]).await,
        page(&[
            "store · Keep a local store.",
            "",
            "USAGE",
            "  store [options]",
            "  store <command> [options]",
            "",
            "COMMANDS",
            "  cache <command>  Manage the cache.",
            "  sync [command]   Copy the store to a remote.",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
            "",
            "Run store <command> --help for command details.",
        ])
    );
}

#[tokio::test]
async fn a_group_prints_the_children_form_alone() {
    assert_eq!(
        run(&nested(), &["cache", "--help"]).await,
        page(&[
            "store cache · Manage the cache.",
            "",
            "USAGE",
            "  store cache <command> [options]",
            "",
            "COMMANDS",
            "  clear  Empty the cache.",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
            "",
            "Run store cache <command> --help for command details.",
        ])
    );
}

#[tokio::test]
async fn a_child_with_an_action_and_children_of_its_own_prints_both_forms() {
    assert_eq!(
        run(&nested(), &["sync", "--help"]).await,
        page(&[
            "store sync · Copy the store to a remote.",
            "",
            "USAGE",
            "  store sync [options]",
            "  store sync <command> [options]",
            "",
            "COMMANDS",
            "  now  Copy it at once.",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
            "",
            "Run store sync <command> --help for command details.",
        ])
    );
}

#[tokio::test]
async fn an_option_row_spells_each_polarity_and_placeholder_and_folds_in_the_globals() {
    assert_eq!(
        run(&cells(), &["--help"]).await,
        page(&[
            "app · Show one option row for each spelling.",
            "",
            "USAGE",
            "  app [options]",
            "",
            "OPTIONS",
            "  -f, --file <path>  The document to read.",
            "      --explain      Explain the selected command and exit.",
            "  -m <metric>        What each row counts.  (default: bytes)",
            "  -t, --total        Add a total row.",
            "      --no-quiet     Print nothing.  (default: true)",
            "      --[no-]cache   Use the cache.",
            "      --verbose      Say more.",
            "  -h, --help         Show this help.",
            "  -V, --version      Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_right_cell_carries_the_description_then_the_facts_in_one_parenthesis() {
    assert_eq!(
        run(&facts(), &["--help"]).await,
        page(&[
            "app · Show one right cell for each fact.",
            "",
            "USAGE",
            "  app <path> [depth] --field <field>... --legacy-field <legacy-field>... --source <source> [options]",
            "",
            "ARGUMENTS",
            "  path   Dot path to read.",
            "  depth  How deep to walk.  (default: 1)",
            "",
            "OPTIONS",
            "  -F, --field <field>                A field to keep.  (required, repeatable)",
            "      --legacy-field <legacy-field>  A field to keep, the old way.  (required, repeatable, deprecated: Use --field instead.)",
            "      --mode <mode>                  How to print.  (default: plain)",
            "      --tags <tags>                  The tags to keep.  (repeatable, default: one two)",
            "      --limit <limit>                How many rows.  (default: 3)",
            r"      --label <label>                The label.  (default: a\nb)",
            "      --count <count>                How many items.  (default: 10)",
            "      --nan <nan>                    The unset ratio.  (default: NaN)",
            "      --inf <inf>                    The upper bound.  (default: Infinity)",
            "      --note <note>                  A note.",
            "      --source <source>              (required)",
            "      --plain",
            "      --no-legacy-quiet              Print nothing, the old way.  (default: true, deprecated: Use --quiet instead.)",
            "  -h, --help                         Show this help.",
            "  -V, --version                      Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_counted_option_ends_with_an_ellipsis_and_an_implied_value_brackets_its_placeholder() {
    assert_eq!(
        run(&kinds(), &["--help"]).await,
        page(&[
            "copyit · Copy files with backups.",
            "",
            "USAGE",
            "  copyit <files...> --tag[=<tag>]... -m[<mode>] [options]",
            "",
            "ARGUMENTS",
            "  files  The files to copy.",
            "",
            "OPTIONS",
            "  -b, --backup[=<control>]  How to back up each file. Use none, simple, or numbered.  (implied: simple)",
            "      --suffix[=<suffix>]   The backup suffix.  (default: ~, implied: .bak)",
            "  -c[<color>]               (implied: auto)",
            r"      --tag[=<tag>]         (required, repeatable, implied: a\nb)",
            "  -m[<mode>]                (required, implied: fast)",
            "  -v, --verbose...          Say more.",
            "  -q...",
            "      --level...            (deprecated: Use -v instead.)",
            "  -h, --help                Show this help.",
            "  -V, --version             Print the version.",
        ])
    );
}

#[tokio::test]
async fn the_quiet_marked_option_prints_no_ellipsis() {
    assert_eq!(
        run(&verbose(), &["--help"]).await,
        page(&[
            "fetchit · Fetch records.",
            "",
            "USAGE",
            "  fetchit [options]",
            "",
            "OPTIONS",
            "  -h, --help        Show this help.",
            "  -V, --version     Print the version.",
            "  -v, --verbose...  Show more detail. Repeat it for more.",
            "  -q, --quiet       Hide info and success messages.",
        ])
    );
}

#[tokio::test]
async fn a_root_with_children_prints_global_options_and_the_action_form() {
    assert_eq!(
        run(&usage(), &["--help"]).await,
        page(&[
            "app · Do the work.",
            "",
            "USAGE",
            "  app [options]",
            "  app <command> [options]",
            "",
            "COMMANDS",
            "  run   Run one job.",
            "  pack  Pack the files.",
            "",
            "GLOBAL OPTIONS",
            "      --key <key>    The key to use.",
            "  -f, --file <file>  The document to read.",
            "  -h, --help         Show this help.",
            "  -V, --version      Print the version.",
            "",
            "Run app <command> --help for command details.",
        ])
    );
}

#[tokio::test]
async fn the_action_form_holds_the_arguments_then_the_node_required_options() {
    assert_eq!(
        run(&usage(), &["run", "--help"]).await,
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
async fn a_required_variadic_argument_prints_its_ellipsis_inside_the_required_brackets() {
    assert_eq!(
        run(&usage(), &["pack", "--help"]).await,
        page(&[
            "app pack · Pack the files.",
            "",
            "USAGE",
            "  app pack <files...> [options]",
            "",
            "ARGUMENTS",
            "  files  The files to pack.",
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
async fn a_node_with_no_description_prints_its_path_alone_with_details_joined_by_line_feeds() {
    assert_eq!(
        run(&prose(), &["--help"]).await,
        page(&[
            "app",
            "",
            "  first line",
            "  second line",
            "  third line",
            "",
            "USAGE",
            "  app [options]",
            "",
            "OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
            "",
            "EXAMPLES",
            "  $ app run one",
            "    The first job.",
            "  $ app run two",
        ])
    );
}

#[tokio::test]
async fn a_hidden_child_leaves_no_row_and_a_child_that_is_also_deprecated_leaves_none() {
    assert_eq!(
        run(&children(), &["--help"]).await,
        page(&[
            "app · Do the work.",
            "",
            "USAGE",
            "  app [options]",
            "  app <command> [options]",
            "",
            "COMMANDS",
            "  get              Read one value at a path.",
            "  fetch            Read one value at a path.  (deprecated: Use get instead.)",
            "  cache <command>  Manage the cache.",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
            "",
            "Run app <command> --help for command details.",
        ])
    );
}

#[tokio::test]
async fn a_deprecated_command_carries_its_message_on_a_second_masthead_line() {
    assert_eq!(
        run(&children(), &["fetch", "--help"]).await,
        page(&[
            "app fetch · Read one value at a path.",
            "  Deprecated: Use get instead.",
            "",
            "USAGE",
            "  app fetch [options]",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_line_break_in_a_description_or_a_deprecation_message_prints_as_one_space() {
    assert_eq!(
        run(&multiline(), &["--help"]).await,
        page(&[
            "app · Do the work.",
            "",
            "USAGE",
            "  app [options]",
            "  app <command> [options]",
            "",
            "COMMANDS",
            "  fetch  Read one value at a path.  (deprecated: Use get instead.)",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
            "",
            "Run app <command> --help for command details.",
        ])
    );
    assert_eq!(
        run(&multiline(), &["fetch", "--help"]).await,
        page(&[
            "app fetch · Read one value at a path.",
            "  Deprecated: Use get instead.",
            "",
            "USAGE",
            "  app fetch [options]",
            "",
            "OPTIONS",
            "      --depth <depth>  How deep to walk.",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_hidden_command_routed_to_directly_prints_its_own_page() {
    assert_eq!(
        run(&children(), &["debug", "--help"]).await,
        page(&[
            "app debug · Dump the document.",
            "",
            "USAGE",
            "  app debug [options]",
            "",
            "OPTIONS",
            "      --depth <depth>  How deep to walk.",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_group_whose_children_are_all_hidden_prints_the_children_form_and_no_listing() {
    assert_eq!(
        run(&children(), &["cache", "--help"]).await,
        page(&[
            "app cache · Manage the cache.",
            "",
            "USAGE",
            "  app cache <command> [options]",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_root_whose_children_are_all_hidden_prints_no_children_form_no_commands_and_no_hint() {
    assert_eq!(
        run(&unlisted(), &["--help"]).await,
        page(&[
            "app · Do the work.",
            "",
            "USAGE",
            "  app [options]",
            "",
            "GLOBAL OPTIONS",
            "  -h, --help     Show this help.",
            "  -V, --version  Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_hidden_option_leaves_the_action_form_and_both_option_sections_and_deprecated_is_last() {
    assert_eq!(
        run(&scoped(), &["--help"]).await,
        page(&[
            "app · Do the work.",
            "",
            "USAGE",
            "  app [options]",
            "  app <command> [options]",
            "",
            "COMMANDS",
            "  run  Run one job.",
            "",
            "OPTIONS",
            "      --mode <mode>  How to print.  (default: plain, deprecated: Use --style instead.)",
            "",
            "GLOBAL OPTIONS",
            "      --key <key>  The key to use.",
            "  -h, --help       Show this help.",
            "  -V, --version    Print the version.",
            "",
            "Run app <command> --help for command details.",
        ])
    );
}

#[tokio::test]
async fn a_hidden_global_option_leaves_global_options_on_a_non_root_page() {
    assert_eq!(
        run(&scoped(), &["run", "--help"]).await,
        page(&[
            "app run · Run one job.",
            "",
            "USAGE",
            "  app run [options]",
            "",
            "GLOBAL OPTIONS",
            "      --key <key>  The key to use.",
            "  -h, --help       Show this help.",
            "  -V, --version    Print the version.",
        ])
    );
}

#[tokio::test]
async fn a_hidden_option_of_either_scope_leaves_the_folded_root_options() {
    assert_eq!(
        run(&folded(), &["--help"]).await,
        page(&[
            "app · Do the work.",
            "",
            "USAGE",
            "  app [options]",
            "",
            "OPTIONS",
            "      --mode <mode>  How to print.",
            "      --key <key>    The key to use.",
            "  -h, --help         Show this help.",
            "  -V, --version      Print the version.",
        ])
    );
}

#[tokio::test]
async fn an_option_row_lists_its_variables_and_its_configuration_key_never_a_value() {
    let expected = page(&[
        "app · Show each binding fact.",
        "",
        "USAGE",
        "  app [options]",
        "",
        "OPTIONS",
        "      --region[=<region>]  The region to use.  (default: eu, implied: us, env: APP_REGION APP_ZONE, config: cloud.region)",
        "      --cache              Use the cache.  (env: APP_CACHE)",
        "      --retries <retries>  (config: retries)",
        "      --old <old>          (env: APP_OLD, config: old, deprecated: Use --region instead.)",
        "      --token <token>      The access token.",
        "  -h, --help               Show this help.",
        "  -V, --version            Print the version.",
    ]);
    assert_eq!(run(&bindings(), &["--help"]).await, expected);
    let compact = run(&bindings(), &["-h"]).await;
    assert!(compact.stdout.contains("(env: APP_CACHE)"));
    assert!(compact.stdout.contains("config: cloud.region)"));
    assert!(!compact.stdout.contains("APP_TOKEN"));
}

#[tokio::test]
async fn a_multiple_options_env_fact_names_its_delimiter_as_a_json_string_on_both_pages() {
    let expected = page(&[
        "app · Show each list binding.",
        "",
        "USAGE",
        "  app [options]",
        "",
        "OPTIONS",
        "      --field <field>    A field to print.  (repeatable, env: APP_FIELDS FIELDS as a list separated by \",\")",
        "      --word <word>      (repeatable, env: APP_WORDS as a list separated by \" \")",
        "      --secret <secret>  (repeatable)",
        "  -h, --help             Show this help.",
        "  -V, --version          Print the version.",
    ]);
    assert_eq!(run(&list_bindings(), &["--help"]).await, expected);
    let compact = run(&list_bindings(), &["-h"]).await;
    assert!(
        compact
            .stdout
            .contains("(repeatable, env: APP_FIELDS FIELDS as a list separated by \",\")")
    );
    assert!(!compact.stdout.contains("APP_SECRETS"));
    assert!(!compact.stdout.contains("\";\""));
}

// The help cases of `views.test.ts`.

#[tokio::test]
async fn an_override_of_the_help_page_changes_the_page_while_the_plugin_stays_installed() {
    let replacement = View::new(|page: &HelpPage, _context| {
        format!(
            "{}:{}\n",
            page.graph.name,
            page.command.name.as_deref().unwrap_or("root")
        )
    });
    let application = branded(replacement);
    assert_eq!(
        run(&application, &["--help"]).await,
        Outcome {
            status: 0,
            stdout: "app:root\n".to_owned(),
            stderr: String::new(),
        }
    );
    assert_eq!(
        run(&application, &["get", "--help"]).await,
        Outcome {
            status: 0,
            stdout: "app:get\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_broken_help_page_override_reports_one_diagnostic_and_returns_1() {
    let replacement = View::new(|_page: &HelpPage, _context| {
        Err::<String, _>(std::io::Error::other("Cannot render the page."))
    });
    let application = branded(replacement);
    let process =
        loomcli_testing::mock_process(loomcli_testing::MockFields::new().argv(["--help"]).release(
            loomcli_core::ReleaseFacts::new(loomcli_core::Build::Distributed),
        ));
    let code = application
        .run(loomcli_core::RunOptions::new().process(
            std::sync::Arc::clone(&process) as std::sync::Arc<dyn loomcli_core::ProcessHandle>
        ))
        .await;
    assert_eq!(code.get(), 1);
    assert_eq!(process.stdout_text(), "");
    assert_eq!(process.stderr_text(), "app: Something went wrong.\n");
}

#[tokio::test]
async fn a_graph_fact_that_carries_a_marker_character_prints_literally_on_the_help_page() {
    let child = Command::new("get")
        .description("Read one value at a path.")
        .action(dispatch);
    let application = installed("app")
        .description("A \u{e001}fixture\u{e002} application.")
        .version("1.2.0\u{e003}")
        .command(child)
        .action(dispatch);
    let outcome = run(&application, &["--help"]).await;
    assert_eq!(outcome.status, 0);
    assert_eq!(
        outcome.stdout.split('\n').next(),
        Some("app · A \u{e001}fixture\u{e002} application.")
    );
}
