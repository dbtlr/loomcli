//! Ports the answer, Commands, and name suites of `completion.test.ts`: the `__complete` protocol
//! read byte for byte, the print Commands, and the identifier and quoting helpers. The scripts as
//! text and as sourced by real shells are in `completion_scripts.rs`.

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::sync::Arc;

use completion_support::{complete, framed, nothing, run_kit, shaped};
use loomcli_core::{Application, Command, CommandGraph, Opt, Polarity, WordPosition, locate};
use loomcli_plugins::completion::test_support::{
    answer, bash_script, fish_script, identifier, powershell_quoted, powershell_script, zsh_script,
};

/// A function that makes a script for an application name.
type Script = fn(&str) -> String;

const GLOBAL_LINES: [&str; 4] = [
    "--file\tThe document.",
    "--color\tColor output.",
    "--no-color\tColor output.",
    "--help\tShow this help.",
];

fn lines_with<'a>(first: &[&'a str], rest: &[&'a str]) -> Vec<&'a str> {
    first.iter().chain(rest).copied().collect()
}

/// The answer for the words, on a graph built without a run.
fn answered(graph: &CommandGraph, words: &[&str]) -> String {
    answer(graph, &locate(graph, words))
}

#[tokio::test]
async fn a_command_position_offers_visible_canonical_children_with_descriptions_reduced_to_display_text()
 {
    let root = framed(
        &[
            "completion\tPrint or install a shell completion script.",
            "paths\tWalkall paths.",
            "keys\tList keys.",
            "cache",
        ],
        4,
    );
    assert_eq!(complete(&[""]).await, root);
    assert_eq!(
        complete(&["cache", ""]).await,
        framed(&["clear\tClear.", "list\tList entries."], 4)
    );
    assert_eq!(
        complete(&["p"]).await,
        framed(&["paths\tWalkall paths."], 4)
    );
}

#[tokio::test]
async fn the_completion_group_offers_its_shells_and_installing_children_and_never_complete() {
    assert_eq!(
        complete(&["completion", ""]).await,
        framed(
            &[
                "bash\tPrint the Bash completion script.",
                "zsh\tPrint the Zsh completion script.",
                "fish\tPrint the Fish completion script.",
                "powershell\tPrint the PowerShell completion script.",
                "install\tInstall completion for your shell.",
                "update\tBring installed completion up to date with this version.",
                "uninstall\tRemove completion from your shell.",
            ],
            4
        )
    );
    assert_eq!(
        complete(&["completion", "install", ""]).await,
        framed(&["bash", "zsh", "fish", "pwsh"], 4)
    );
    assert_eq!(complete(&["completion", "_"]).await, framed(&[], 4));
}

#[tokio::test]
async fn an_alias_a_hidden_command_and_a_deprecated_command_are_never_offered_and_each_still_routes()
 {
    assert_eq!(complete(&["l"]).await, framed(&[], 4));
    assert_eq!(complete(&["d"]).await, framed(&[], 4));
    assert_eq!(complete(&["f"]).await, framed(&[], 4));
    assert_eq!(complete(&["ls", "--"]).await, framed(&GLOBAL_LINES, 4));
    assert_eq!(
        complete(&["debug", "--d"]).await,
        framed(&["--dump\tDump."], 4)
    );
    assert_eq!(
        complete(&["fetch", "--d"]).await,
        framed(&["--deep\tDeep."], 4)
    );
}

#[test]
fn an_options_alias_is_never_offered_and_a_typed_one_completes_its_options_value() {
    let graph = Application::new("kit")
        .option(
            "metric",
            Opt::string()
                .aliases(["measure"])
                .validate(shaped(["bytes", "words"])),
        )
        .option(
            "color",
            Opt::boolean().aliases(["colour"]).polarity(Polarity::Both),
        )
        .action(nothing)
        .inspect()
        .unwrap();
    assert_eq!(
        answered(&graph, &["--"]),
        framed(&["--metric", "--color", "--no-color"], 4)
    );
    assert_eq!(answered(&graph, &["--measure", "w"]), framed(&["words"], 4));
    assert_eq!(
        answered(&graph, &["--measure=b"]),
        framed(&["--measure=bytes"], 4)
    );
}

#[tokio::test]
async fn an_option_position_offers_long_spellings_and_short_ones_too_when_the_word_is_exactly_a_hyphen()
 {
    assert_eq!(
        complete(&["paths", "--"]).await,
        framed(
            &lines_with(
                &GLOBAL_LINES,
                &[
                    "--format\tThe view.",
                    "--field\tA field.",
                    "--quiet\tSay less."
                ]
            ),
            4
        )
    );
    assert_eq!(
        complete(&["paths", "-"]).await,
        framed(
            &[
                "--file\tThe document.",
                "--color\tColor output.",
                "--no-color\tColor output.",
                "--help\tShow this help.",
                "-h\tShow this help.",
                "--format\tThe view.",
                "-f\tThe view.",
                "--field\tA field.",
                "--quiet\tSay less.",
                "-q\tSay less.",
            ],
            4
        )
    );
    assert_eq!(
        complete(&["paths", "--n"]).await,
        framed(&["--no-color\tColor output."], 4)
    );
    assert_eq!(complete(&["paths", "-q"]).await, framed(&[], 4));
}

/// A root with its own action, a local `--format`, a `cache` group, and `--help` by hand, as the
/// reference's `format()` and `help()` plugins make it.
fn store() -> Arc<CommandGraph> {
    Application::new("store")
        .option("format", Opt::string().description("The view."))
        .global_option(
            "help",
            Opt::boolean().description("Show this help.").short('h'),
        )
        .command(Command::new("cache").command(Command::new("list").action(nothing)))
        .action(nothing)
        .inspect()
        .unwrap()
}

#[test]
fn a_roots_own_format_before_a_groups_name_leaves_routing_open_so_the_groups_children_are_offered()
{
    let graph = store();
    assert_eq!(
        answered(&graph, &["--format", "json", "cache", ""]),
        answered(&graph, &["cache", ""])
    );
    assert_eq!(
        answered(&graph, &["--format", "json", "cache", ""]),
        framed(&["list"], 4)
    );
}

#[test]
fn a_roots_own_format_before_a_groups_name_leaves_routing_open_for_a_hyphen_word_too() {
    let graph = store();
    let offered = answered(&graph, &["cache", "--h"]);
    assert_eq!(offered, framed(&["--help\tShow this help."], 4));
    assert_eq!(
        answered(&graph, &["--format", "json", "cache", "--h"]),
        offered
    );
}

#[test]
fn a_value_is_never_offered_empty_and_never_as_a_word_whose_first_character_is_a_tilde() {
    let graph = Application::new("kit")
        .command(
            Command::new("one")
                .option(
                    "v",
                    Opt::string().validate(shaped(["", "~", "~root", "a~b"])),
                )
                .argument(
                    "value",
                    loomcli_core::Arg::string().validate(shaped(["~root", "b~c"])),
                )
                .action(nothing),
        )
        .inspect()
        .unwrap();
    // After a lead the word starts with a hyphen, and no shell expands a tilde after `--v=`.
    assert_eq!(
        answered(&graph, &["one", "--v="]),
        framed(&["--v=~", "--v=~root", "--v=a~b"], 4)
    );
    assert_eq!(answered(&graph, &["one", "--v", ""]), framed(&["a~b"], 4));
    assert_eq!(answered(&graph, &["one", ""]), framed(&["b~c"], 4));
}

#[tokio::test]
async fn a_supplied_option_is_not_offered_again_unless_it_is_a_multiple_string_option() {
    assert_eq!(
        complete(&["paths", "--format", "json", "-q", "--f"]).await,
        framed(&["--file\tThe document.", "--field\tA field."], 4)
    );
    assert_eq!(
        complete(&["paths", "--field", "a", "--fi"]).await,
        framed(&["--file\tThe document.", "--field\tA field."], 4)
    );
    assert_eq!(
        complete(&["--file", "x", "paths", "--fi"]).await,
        framed(&["--field\tA field."], 4)
    );
}

#[tokio::test]
async fn a_counted_option_is_offered_again_because_another_occurrence_adds_to_its_count() {
    assert_eq!(
        complete(&["backups", "-v", "--v"]).await,
        framed(&["--verbose\tSay more."], 4)
    );
    assert_eq!(
        complete(&["backups", "-vv", "--verbose", "--v"]).await,
        framed(&["--verbose\tSay more."], 4)
    );
}

/// The verbose plugin's two options, declared directly: a verbose-marked `--verbose` and a
/// quiet-marked `--quiet`.
fn verbosity() -> Arc<CommandGraph> {
    Application::new("kit")
        .global_option(
            "verbose",
            Opt::count()
                .description("Show more detail. Repeat it for more.")
                .short('v')
                .verbose(),
        )
        .global_option(
            "quiet",
            Opt::count()
                .description("Hide info and success messages.")
                .short('q')
                .quiet(),
        )
        .action(nothing)
        .inspect()
        .unwrap()
}

#[test]
fn the_quiet_marked_option_is_not_offered_again_once_given_because_a_further_q_adds_nothing() {
    let graph = verbosity();
    assert_eq!(
        answered(&graph, &["--q"]),
        framed(&["--quiet\tHide info and success messages."], 4)
    );
    assert_eq!(answered(&graph, &["-q", "--q"]), framed(&[], 4));
}

#[test]
fn the_verbose_marked_option_is_offered_until_it_is_given_twice_because_the_verbosity_stops_at_2() {
    let graph = verbosity();
    let offered = framed(&["--verbose\tShow more detail. Repeat it for more."], 4);
    assert_eq!(answered(&graph, &["-v", "--v"]), offered);
    assert_eq!(answered(&graph, &["-vv", "--v"]), framed(&[], 4));
    assert_eq!(
        answered(&graph, &["-v", "--verbose", "--v"]),
        framed(&[], 4)
    );
}

#[tokio::test]
async fn a_string_option_with_an_implied_value_offers_its_values_only_when_they_are_attached() {
    assert_eq!(
        complete(&["backups", "--backup="]).await,
        framed(
            &["--backup=none", "--backup=simple", "--backup=numbered"],
            4
        )
    );
    assert_eq!(
        complete(&["backups", "--backup=n"]).await,
        framed(&["--backup=none", "--backup=numbered"], 4)
    );
    assert_eq!(
        complete(&["backups", "-bn"]).await,
        framed(&["-bnone", "-bnumbered"], 4)
    );
    // A bare spelling is complete, so the next word offers what follows it and no value.
    assert_eq!(
        complete(&["backups", "--backup", ""]).await,
        framed(&["disk", "tape"], 4)
    );
    assert_eq!(
        complete(&["backups", "-b", ""]).await,
        framed(&["disk", "tape"], 4)
    );
}

#[tokio::test]
async fn a_value_position_offers_the_closed_set_after_its_lead_filtered_by_the_typed_value() {
    assert_eq!(
        complete(&["paths", "--format", ""]).await,
        framed(&["json", "jsonl", "table"], 4)
    );
    assert_eq!(complete(&["paths", "-f", "t"]).await, framed(&["table"], 4));
    assert_eq!(
        complete(&["paths", "--format="]).await,
        framed(&["--format=json", "--format=jsonl", "--format=table"], 4)
    );
    assert_eq!(
        complete(&["paths", "--format=j"]).await,
        framed(&["--format=json", "--format=jsonl"], 4)
    );
    assert_eq!(complete(&["paths", "--format=x"]).await, framed(&[], 4));
}

#[tokio::test]
async fn an_argument_offers_exact_values_once_leaving_out_every_value_a_shell_cannot_hold() {
    assert_eq!(
        complete(&["keys", ""]).await,
        framed(
            &[
                "plain",
                "$(touch sentinel)",
                "`touch sentinel`",
                ";touch sentinel"
            ],
            4
        )
    );
    assert_eq!(
        complete(&["ls", "$"]).await,
        framed(&["$(touch sentinel)"], 4)
    );
}

#[tokio::test]
async fn an_input_with_no_closed_set_and_the_passthrough_tail_leave_the_shell_its_files() {
    assert_eq!(complete(&["--file", ""]).await, framed(&[], 0));
    assert_eq!(complete(&["--old", ""]).await, framed(&[], 0));
    assert_eq!(complete(&["paths", "--", "x"]).await, framed(&[], 0));
}

#[tokio::test]
async fn a_structural_fault_offers_nothing_and_reports_an_error() {
    assert_eq!(complete(&["nope", ""]).await, framed(&[], 1));
    assert_eq!(complete(&["paths", "--bogus", ""]).await, framed(&[], 1));
}

#[tokio::test]
async fn a_typed_help_or_a_hostile_word_is_read_as_a_word_and_never_activates_anything() {
    assert_eq!(
        complete(&["--help", ""]).await,
        framed(
            &[
                "completion\tPrint or install a shell completion script.",
                "paths\tWalkall paths.",
                "keys\tList keys.",
                "cache",
            ],
            4
        )
    );
    assert_eq!(complete(&["$(touch sentinel)", ""]).await, framed(&[], 1));
}

#[test]
fn a_description_reads_each_line_break_as_a_space_with_every_control_character_removed() {
    let graph = Application::new("kit")
        .command(Command::new("one").description("First.").action(nothing))
        .inspect()
        .unwrap();
    let one = Arc::clone(&graph.root.children[0]);
    let child = |name: &str, description: Option<&str>| {
        let mut node = (*one).clone();
        node.name = Some(name.to_owned());
        node.description = description.map(str::to_owned);
        Arc::new(node)
    };
    let mut root = (*graph.root).clone();
    root.children = vec![
        child("one", Some("Line\u{7} one.\r\nLine two.")),
        child("two", Some("\tTwo.\u{2029}More.")),
        child("three", None),
        child("four", Some("Four.\nFour more.")),
        child("five", Some("\t")),
    ];
    let position = WordPosition::Command {
        argument: None,
        command: Arc::new(root),
        prefix: String::new(),
    };
    assert_eq!(
        answer(&graph, &position),
        framed(
            &[
                "one\tLine one. Line two.",
                "two\tTwo. More.",
                "three",
                "four\tFour. Four more.",
                "five",
            ],
            4
        )
    );
}

#[tokio::test]
async fn each_shell_command_prints_its_script_for_the_application_name_in_one_exact_write() {
    let shells: [(&str, Script); 4] = [
        ("bash", bash_script),
        ("fish", fish_script),
        ("powershell", powershell_script),
        ("zsh", zsh_script),
    ];
    for (shell, script) in shells {
        let ran = run_kit(&["completion", shell]).await;
        assert_eq!(
            (ran.status, ran.stderr.as_str(), ran.stdout),
            (0, "", script("kit")),
            "{shell}"
        );
    }
}

#[tokio::test]
async fn the_completion_group_lists_its_visible_shells_when_the_subcommand_is_missing() {
    let ran = run_kit(&["completion"]).await;
    assert_ne!(ran.status, 0);
    assert_eq!(ran.stdout, "");
    assert!(
        ran.stderr.contains("bash, zsh, fish, powershell"),
        "{}",
        ran.stderr
    );
    assert!(!ran.stderr.contains("__complete"), "{}", ran.stderr);
}

#[test]
fn an_identifier_keeps_ascii_letters_and_digits_and_encodes_every_other_code_point() {
    assert_eq!(identifier("jsonkit"), "jsonkit");
    assert_eq!(identifier("git-lfs"), "git_2d_lfs");
    assert_eq!(identifier("a_b.c"), "a_5f_b_2e_c");
    assert_eq!(identifier("x\u{1f600}"), "x_1f600_");
    assert_ne!(identifier("a-b"), identifier("a_2d_b"));
}

#[test]
fn a_powershell_single_quoted_string_writes_the_apostrophe_and_each_of_u2018_through_u201b_twice() {
    let quotes = ['\u{2018}', '\u{2019}', '\u{201a}', '\u{201b}'];
    assert_eq!(
        powershell_quoted("/home/o'neil/.local/share"),
        "'/home/o''neil/.local/share'"
    );
    for quote in quotes {
        assert_eq!(
            powershell_quoted(&format!("/home/a{quote}b/x")),
            format!("'/home/a{quote}{quote}b/x'")
        );
        assert_eq!(
            powershell_quoted(&format!("it{quote}s")),
            format!("'it{quote}{quote}s'")
        );
    }
    let joined: String = quotes
        .iter()
        .map(char::to_string)
        .collect::<Vec<_>>()
        .join("'");
    let doubled: String = quotes
        .iter()
        .map(|quote| format!("{quote}{quote}"))
        .collect::<Vec<_>>()
        .join("''");
    assert_eq!(powershell_quoted(&joined), format!("'{doubled}'"));
}

#[test]
fn a_powershell_single_quoted_string_keeps_every_other_character_as_it_is() {
    for text in [
        "jsonkit",
        "git-lfs",
        "C:\\Users\\me",
        "\"$(New-Item sentinel)\"",
        "`n $HOME @a {b} (c) ;|&<>#,",
        "x\u{201c}y\u{201d}z",
        "x\u{1f600}",
        "",
    ] {
        assert_eq!(powershell_quoted(text), format!("'{text}'"));
    }
}

/// `completion bash --help` reaches the help page when `help()` is installed beside `completion()`.
#[cfg(all(feature = "completion", feature = "help"))]
#[tokio::test]
async fn a_shell_command_reaches_help_when_help_is_installed() {
    use loomcli_plugins::completion::completion;
    use loomcli_plugins::help::help;
    use loomcli_testing::MockFields;

    let application = Application::new("kit").plugins((help(), completion()));
    let ran = completion_support::run_on(
        &application,
        &["completion", "bash", "--help"],
        MockFields::new(),
    )
    .await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert!(
        ran.stdout.contains("Print the Bash completion script."),
        "{}",
        ran.stdout
    );
}
