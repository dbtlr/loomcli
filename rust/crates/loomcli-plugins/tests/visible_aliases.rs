//! Help, man pages, completion, manifest, MCP, and suggestions from visible-aliases.test.ts.

#![cfg(all(
    feature = "help",
    feature = "manpage",
    feature = "manifest",
    feature = "completion",
    feature = "mcp",
    feature = "suggestions"
))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;
mod mcp_support;

use help_support::{custom_theme, noop, render_at, run, styled};
use loomcli_core::{
    AnyPlugin, Application, Command, Context, Done, NoInputs, NoResult, Opt, Polarity,
    RegionOptions, locate,
};
use loomcli_plugins::completion::test_support::answer;
use loomcli_plugins::help::help;
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::manpage::test_support::{ManPage, man_pages};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpCommandFacts};
use loomcli_plugins::mcp::mcp;
use loomcli_plugins::suggestions::suggestions;
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Done>;

fn store(themed: bool) -> App {
    let mut plugins: Vec<AnyPlugin> = vec![
        help().into(),
        manifest().into(),
        mcp().into(),
        suggestions().into(),
    ];
    if themed {
        plugins.push(custom_theme().into());
    }
    let list = Command::new("list")
        .description("List the cache.")
        .extend([MCP_COMMAND.value(McpCommandFacts::new())])
        .alias("dir")
        .visible_alias("ls")
        .option(
            "min-bytes",
            Opt::string()
                .aliases(["mb"])
                .description("The smallest size.")
                .visible_aliases(["minimum"]),
        )
        .option(
            "color",
            Opt::boolean()
                .description("Color the rows.")
                .polarity(Polarity::Both)
                .visible_aliases(["colour"]),
        )
        .option(
            "quiet",
            Opt::boolean()
                .polarity(Polarity::Negative)
                .visible_aliases(["silent"]),
        )
        .option("verbose", Opt::count().visible_aliases(["loud", "chatty"]))
        .action(noop);
    let remove = Command::new("remove")
        .description("Remove an entry.")
        .visible_alias("rm")
        .visible_alias("delete")
        .action(noop);
    let old = Command::new("old")
        .deprecated("Use list instead.")
        .description("List it.")
        .visible_alias("ol")
        .action(noop);
    let clear = Command::new("clear")
        .description("Empty the cache.")
        .action(noop);
    Application::new("store")
        .plugins(plugins)
        .version("1.0.0")
        .global_option(
            "profile",
            Opt::string()
                .description("The profile.")
                .visible_aliases(["prof"]),
        )
        .command(
            Command::new("cache")
                .description("Manage the cache.")
                .command(clear)
                .command(list)
                .command(remove)
                .command(old),
        )
        .action(noop)
}

fn contains(text: &str, part: &str) {
    assert!(text.contains(part), "missing {part:?} in:\n{text}");
}

#[tokio::test]
async fn group_help_lists_visible_aliases_as_each_members_first_fact() {
    let page = render_at(&store(false), &["cache", "--help"], None, None).await;
    contains(
        &page,
        concat!(
            "COMMANDS\n",
            "  clear   Empty the cache.\n",
            "  list    List the cache.  (alias: ls)\n",
            "  remove  Remove an entry.  (aliases: rm, delete)\n",
            "  old     List it.  (alias: ol, deprecated: Use list instead.)\n",
        ),
    );
}

#[tokio::test]
async fn help_lists_option_aliases_using_the_options_first_long_form() {
    let page = render_at(&store(false), &["cache", "list", "--help"], None, None).await;
    contains(
        &page,
        concat!(
            "OPTIONS\n",
            "      --min-bytes <min-bytes>  The smallest size.  (alias: --minimum)\n",
            "      --[no-]color             Color the rows.  (alias: --colour)\n",
            "      --no-quiet               (alias: --no-silent, default: true)\n",
            "      --verbose...             (aliases: --loud, --chatty)\n",
            "\nGLOBAL OPTIONS\n",
            "      --profile <profile>  The profile.  (alias: --prof)\n",
        ),
    );
}

#[tokio::test]
async fn help_masthead_prints_aliases_before_deprecation_with_the_canonical_path() {
    let app = store(false);
    for (word, prefix) in [
        (
            "ls",
            "store cache list · List the cache.\n  Alias: ls\n\nUSAGE\n  store cache list [options]\n",
        ),
        (
            "rm",
            "store cache remove · Remove an entry.\n  Aliases: rm, delete\n\n",
        ),
        (
            "old",
            "store cache old · List it.\n  Alias: ol\n  Deprecated: Use list instead.\n\n",
        ),
        ("clear", "store cache clear · Empty the cache.\n\nUSAGE\n"),
    ] {
        let page = render_at(&app, &["cache", word, "-h"], None, None).await;
        assert!(page.starts_with(prefix), "{page}");
    }
}

#[tokio::test]
async fn the_masthead_hangs_alias_names_when_there_is_room() {
    let app = store(false);
    for (columns, line) in [
        (17, "\n  Aliases: rm,\n           delete\n\n"),
        (16, "\n  Aliases: rm,\n  delete\n\n"),
    ] {
        let page = render_at(&app, &["cache", "remove", "-h"], Some(columns), None).await;
        contains(&page, line);
    }
}

#[tokio::test]
async fn mcp_lists_the_canonical_tool_and_declared_inputs() {
    let tools = mcp_support::tools_of(&store(false)).await;
    assert_eq!(tools.len(), 1, "{tools:?}");
    assert_eq!(tools[0]["name"], "cache_list");
    let keys: Vec<_> = tools[0]["inputSchema"]["properties"]
        .as_object()
        .unwrap()
        .keys()
        .collect();
    assert_eq!(keys, ["min-bytes", "color", "quiet", "verbose", "profile"]);
}

#[tokio::test]
async fn suggestions_compare_canonical_names_and_spellings() {
    let app = store(false);
    for (argv, expected) in [
        (
            &["cache", "delet"][..],
            concat!(
                "store: Unknown command \"delet\". Use one of: clear, list, remove.\n",
                "Run \"store cache --help\" to see the usage.\n",
            ),
        ),
        (
            &["cache", "lst"][..],
            concat!(
                "store: Unknown command \"lst\". Did you mean \"list\"?\n",
                "Run \"store cache --help\" to see the usage.\n",
            ),
        ),
        (
            &["cache", "list", "--chaty"][..],
            concat!(
                "store: Unknown option \"--chaty\". Supply a declared option; prefix a hyphenated path with \"./\".\n",
                "Run \"store cache list --help\" to see the usage.\n",
            ),
        ),
    ] {
        let ran = run(&app, argv).await;
        assert_eq!(ran.status, 2, "{argv:?}");
        assert!(ran.stdout.is_empty(), "{argv:?}: {}", ran.stdout);
        assert_eq!(ran.stderr, expected, "{argv:?}");
    }
}

fn pages() -> Vec<ManPage> {
    let graph = store(false).inspect().unwrap();
    man_pages(&graph).unwrap()
}

fn man_page<'a>(pages: &'a [ManPage], name: &str) -> &'a str {
    &pages.iter().find(|page| page.file == name).unwrap().text
}

#[test]
fn man_pages_keep_aliases_on_the_canonical_pages_and_rows() {
    let pages = pages();
    contains(
        man_page(&pages, "store-cache.1"),
        concat!(
            ".TP\n",
            r"\fBlist\fR",
            "\n",
            "List the cache.  (alias: ls)\n",
            ".TP\n",
            r"\fBremove\fR",
            "\n",
            "Remove an entry.  (aliases: rm, delete)\n",
            ".TP\n",
            r"\fBold\fR",
            "\n",
            "List it.  (alias: ol, deprecated: Use list instead.)\n",
        ),
    );
    contains(
        man_page(&pages, "store-cache-list.1"),
        concat!(
            ".TP\n",
            r"\fB\-\-min\-bytes\fR <\fImin\-bytes\fR>",
            "\n",
            r"The smallest size.  (alias: \-\-minimum)",
            "\n",
            ".TP\n",
            r"\fB\-\-[no\-]color\fR",
            "\n",
            r"Color the rows.  (alias: \-\-colour)",
            "\n",
            ".TP\n",
            r"\fB\-\-no\-quiet\fR",
            "\n",
            r"(alias: \-\-no\-silent, default: true)",
            "\n",
            ".TP\n",
            r"\fB\-\-verbose\fR...",
            "\n",
            r"(aliases: \-\-loud, \-\-chatty)",
            "\n",
        ),
    );
    assert!(
        !pages
            .iter()
            .any(|page| matches!(page.file.as_str(), "store-cache-ls.1" | "store-cache-dir.1"))
    );
}

#[test]
fn man_description_opens_with_the_alias_paragraph() {
    let pages = pages();
    contains(
        man_page(&pages, "store-cache-list.1"),
        ".SH \"DESCRIPTION\"\nAlias: ls\n.SH",
    );
    contains(
        man_page(&pages, "store-cache-remove.1"),
        ".SH \"DESCRIPTION\"\nAliases: rm, delete\n.SH",
    );
    contains(
        man_page(&pages, "store-cache-old.1"),
        ".SH \"DESCRIPTION\"\nAlias: ol\n.PP\nDeprecated: Use list instead.\n.SH",
    );
    assert!(!man_page(&pages, "store-cache-clear.1").contains("DESCRIPTION"));
}

fn completed(app: &App, words: &[&str]) -> String {
    let graph = app.inspect().unwrap();
    answer(&graph, &locate(&graph, words))
}

fn offering(lines: &[&str]) -> String {
    let mut text = String::new();
    for line in lines {
        text.push_str(line);
        text.push('\n');
    }
    text.push_str(":4\n");
    text
}

#[test]
fn completion_falls_back_to_visible_aliases_per_command() {
    let app = store(false);
    for (prefix, expected) in [
        (
            "",
            &[
                "clear\tEmpty the cache.",
                "list\tList the cache.",
                "remove\tRemove an entry.",
            ][..],
        ),
        ("l", &["list\tList the cache."]),
        ("ls", &["ls\tList the cache."]),
        ("r", &["remove\tRemove an entry."]),
        ("d", &["delete\tRemove an entry."]),
        ("di", &[]),
        ("o", &[]),
    ] {
        assert_eq!(
            completed(&app, &["cache", prefix]),
            offering(expected),
            "{prefix:?}"
        );
    }
}

#[test]
fn completion_falls_back_to_visible_alias_spellings_per_option() {
    let app = store(false);
    for (prefix, expected) in [
        ("--min", &["--min-bytes\tThe smallest size."][..]),
        ("--mini", &["--minimum\tThe smallest size."]),
        ("--mb", &[]),
        ("--colo", &["--color\tColor the rows."]),
        ("--colou", &["--colour\tColor the rows."]),
        ("--no-c", &["--no-color\tColor the rows."]),
        ("--no-colou", &["--no-colour\tColor the rows."]),
        ("--no-s", &["--no-silent"]),
        ("--s", &[]),
        ("--l", &["--loud"]),
        ("--c", &["--color\tColor the rows.", "--chatty"]),
        ("--prof", &["--profile\tThe profile."]),
    ] {
        assert_eq!(
            completed(&app, &["cache", "list", prefix]),
            offering(expected),
            "{prefix:?}"
        );
    }
    assert_eq!(
        completed(&app, &["cache", "list", "--minimum", "5", "--mini"]),
        offering(&[])
    );
}

#[test]
fn a_single_hyphen_offers_canonical_short_and_long_spellings() {
    let answer = completed(&store(false), &["cache", "list", "-"]);
    contains(&answer, "--min-bytes\tThe smallest size.\n");
    assert!(
        answer.lines().any(|line| line.starts_with("-h\t")),
        "{answer}"
    );
    for spelling in [
        "--minimum",
        "--colour",
        "--no-colour",
        "--no-silent",
        "--loud",
        "--chatty",
        "--prof",
        "--mb",
    ] {
        assert!(
            !answer
                .lines()
                .any(|line| line.split('\t').next() == Some(spelling)),
            "{answer}"
        );
    }
}

async fn manifest_of(app: &App, words: &[&str]) -> Value {
    let argv = [words, &["--manifest"]].concat();
    let ran = run(app, &argv).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert!(ran.stderr.is_empty(), "{}", ran.stderr);
    serde_json::from_str(&ran.stdout).unwrap()
}

fn aliases(entries: &Value) -> Value {
    Value::Array(
        entries
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| json!([entry["name"], entry["aliases"]]))
            .collect(),
    )
}

fn keys(value: &Value) -> Vec<&str> {
    value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect()
}

#[tokio::test]
async fn the_manifest_lists_visible_command_aliases_after_the_name() {
    let document = manifest_of(&store(false), &["cache"]).await;
    let command = &document["command"];
    assert_eq!(
        aliases(&command["children"]),
        json!([
            ["clear", []],
            ["list", ["ls"]],
            ["remove", ["rm", "delete"]],
            ["old", ["ol"]],
        ])
    );
    assert_eq!(command["aliases"], json!([]));
    let list = &command["children"][1];
    assert_eq!(
        keys(list)[..5],
        ["stdin", "passthrough", "name", "aliases", "path"]
    );
    assert!(list.get("visibleAliases").is_none());
}

#[tokio::test]
async fn the_manifest_lists_visible_option_aliases_as_bare_names() {
    let document = manifest_of(&store(false), &["cache", "list"]).await;
    let options = &document["command"]["options"];
    assert_eq!(
        aliases(options),
        json!([
            ["min-bytes", ["minimum"]],
            ["color", ["colour"]],
            ["quiet", ["silent"]],
            ["verbose", ["loud", "chatty"]],
        ])
    );
    assert_eq!(
        aliases(&document["globals"]),
        json!([["profile", ["prof"]], ["help", []], ["manifest", []]])
    );
    assert_eq!(
        keys(&options[0])[5..9],
        ["long", "short", "aliases", "required"]
    );
    assert_eq!(
        keys(&options[1])[5..10],
        ["long", "short", "negative", "aliases", "polarity"]
    );
    assert_eq!(
        keys(&options[3])[5..9],
        ["long", "short", "aliases", "verbose"]
    );
    assert!(options[0].get("visibleAliases").is_none());
}

#[tokio::test]
async fn the_alias_line_and_alias_fact_use_the_dim_theme() {
    let app = store(true);
    let page = render_at(&app, &["cache", "ls", "-h"], None, Some(styled())).await;
    contains(&page, "\n  \x1b[35mAlias: ls\x1b[39m\n");
    let group = render_at(&app, &["cache", "-h"], None, Some(styled())).await;
    contains(&group, "  \x1b[35m(alias: ls)\x1b[39m\n");
}

#[tokio::test]
async fn a_redundant_visible_alias_appears_in_neither_help_nor_manifest() {
    let app = Application::new("store")
        .plugins((help(), manifest()))
        .option(
            "color",
            Opt::boolean()
                .polarity(Polarity::Both)
                .visible_aliases(["no-color", "colour"]),
        )
        .action(noop);
    let page = render_at(&app, &["--help"], None, None).await;
    assert!(
        page.lines()
            .any(|line| line.split_whitespace().collect::<Vec<_>>()
                == ["--[no-]color", "(alias:", "--colour)"]),
        "{page}"
    );
    assert!(!page.contains("--no-no-color"), "{page}");
    let document = manifest_of(&app, &[]).await;
    assert_eq!(
        aliases(&document["command"]["options"]),
        json!([["color", ["colour"]]])
    );
}

#[tokio::test]
async fn a_visible_alias_turns_on_the_plain_switch_and_appears_in_help() {
    let app = Application::new("notes")
        .plugins([help()])
        .global_option("plain", Opt::boolean().plain().visible_aliases(["simple"]))
        .action(|ctx: Context| async move {
            let live = ctx.out.region(RegionOptions::new()).live();
            ctx.out.print(&live.to_string()).await
        });
    let terminal = loomcli_testing::MockFields::new()
        .argv(["--simple"])
        .env("TERM", "xterm-256color")
        .terminal(loomcli_testing::MockTerminal::new(40, 24));
    let (ran, _) = help_support::run_with(&app, terminal, None).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (0, "false\n", "")
    );
    contains(
        &render_at(&app, &["--help"], None, None).await,
        "(alias: --simple)",
    );
}
