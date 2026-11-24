//! The suggestions plugin, ported from the reference's `suggestions.test.ts`. The fixture
//! application mirrors `fixtures/suggestions.ts`; a case that compares with core's text runs the
//! same argv on a baseline application without the plugin.
//!
//! Not ported here: the help plugin's failure hint and the help takeover (the `help` package
//! owns them), and the two cases that rebuild one failure instance after an earlier report (a
//! Rust failure is a value that is boxed once per report, so no instance outlives its report).

#![cfg(feature = "suggestions")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    Application, Build, Command, Context, Done, FailureView, FatalError, InputError,
    InvocationOutcome, InvocationValues, InvokeOptions, NoInputs, NoResult, Opt, Plugin, Polarity,
    ProcessHandle, ReleaseFacts, RunOptions, SuppliedValue, UnknownCommandError, UsageError,
    failure, override_view,
};
use loomcli_plugins::suggestions::suggestions;
use loomcli_testing::{MockFields, mock_process};

type App = Application<NoInputs, NoResult, Done>;

async fn dispatch(ctx: Context) -> loomcli_core::Outcome {
    ctx.out.print("dispatched").await
}

/// A plugin whose only contribution is one hint for every failure, so a test reads hint order.
fn pointer(name: &str) -> Plugin {
    let hint = format!("{name} hint.");
    Plugin::new(format!("fixture/{}", name.to_lowercase())).on_failure(move |_, _| hint.clone())
}

/// A plugin whose only contribution is an override of the unknown-command view, naming its owner.
fn overriding(name: &'static str) -> Plugin {
    Plugin::new(format!("fixture/{name}")).views([override_view(
        failure::<UnknownCommandError>(),
        FailureView::new(move |_: &UnknownCommandError, _| format!("{name}: unknown-command\n")),
    )])
}

fn leaf(name: &str) -> Command<NoInputs, NoResult, loomcli_core::Done> {
    Command::new(name).action(dispatch)
}

/// The application: groups isolate the matcher cases, and `opts` holds options of every spelling
/// kind.
fn kit(plugins: Vec<Plugin>, overrides: Vec<loomcli_core::ViewOverride>) -> App {
    let mut application = Application::new("kit").plugins(plugins);
    if !overrides.is_empty() {
        application = application.overrides(overrides);
    }
    application
        .global_option("file", Opt::string())
        .command(
            Command::new("edits")
                .command(leaf("get"))
                .command(leaf("lane"))
                .command(leaf("Build")),
        )
        .command(
            Command::new("budget")
                .command(leaf("four"))
                .command(leaf("fives"))
                .command(leaf("seasoned"))
                .command(leaf("overnight")),
        )
        .command(
            Command::new("rank")
                .command(leaf("tap"))
                .command(leaf("tip"))
                .command(leaf("top"))
                .command(leaf("tup")),
        )
        .command(
            Command::new("excluded")
                .command(Command::new("secret").hidden().action(dispatch))
                .command(
                    Command::new("legacy")
                        .deprecated("Use keys instead.")
                        .action(dispatch),
                )
                .command(Command::new("keys").alias("ls").action(dispatch)),
        )
        .command(
            Command::new("opts")
                .option("field", Opt::string())
                .option("color", Opt::boolean().polarity(Polarity::Both))
                .option("verbosity-level", Opt::boolean().polarity(Polarity::Both))
                .option("ééé", Opt::boolean())
                .option("xy", Opt::boolean())
                .option("keep", Opt::boolean().short('k'))
                .option("secret", Opt::boolean().hidden())
                .option("older", Opt::boolean().deprecated("Use --keep instead."))
                .action(dispatch),
        )
        .command(
            Command::new("tally")
                .hidden()
                .option("quietness", Opt::count().short('q'))
                .option("backup", Opt::string().implied("simple"))
                .action(dispatch),
        )
        .command(
            Command::new("work")
                .argument("name", loomcli_core::Arg::string().required())
                .option("end", Opt::string())
                .action(|ctx: Context| async move {
                    let ending = match ctx.supplied.options.get("end") {
                        Some(SuppliedValue::One(text)) => text.clone(),
                        _ => String::new(),
                    };
                    match ending.as_str() {
                        "fatal" => Err(FatalError::new(
                            "The store is locked. Close the other session.",
                        )
                        .into()),
                        "input" => {
                            Err(InputError::new("Supply a shorter name.", Vec::new()).into())
                        }
                        _ => ctx.out.print("dispatched").await,
                    }
                }),
        )
        .action(dispatch)
}

/// The scenarios the reference fixture names.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scenario {
    AppCommand,
    AppUsage,
    Core,
    HintCore,
    Hinted,
    Plain,
    PluginAfter,
    PluginBefore,
}

fn application(scenario: Scenario) -> App {
    use Scenario::*;
    match scenario {
        AppCommand => kit(
            vec![suggestions()],
            vec![override_view(
                failure::<UnknownCommandError>(),
                FailureView::new(|_: &UnknownCommandError, _| "app: unknown-command\n".to_owned()),
            )],
        ),
        AppUsage => kit(
            vec![suggestions()],
            vec![override_view(
                failure::<UsageError>(),
                FailureView::new(|_: &UsageError, _| "app: usage\n".to_owned()),
            )],
        ),
        Core => kit(Vec::new(), Vec::new()),
        HintCore => kit(vec![pointer("First"), pointer("Second")], Vec::new()),
        Hinted => kit(
            vec![suggestions(), pointer("First"), pointer("Second")],
            Vec::new(),
        ),
        Plain => kit(vec![suggestions()], Vec::new()),
        PluginAfter => kit(vec![suggestions(), overriding("after")], Vec::new()),
        PluginBefore => kit(vec![overriding("before"), suggestions()], Vec::new()),
    }
}

/// One argv run of a scenario on a mock process that reports a distributed build.
async fn run(scenario: Scenario, argv: &[&str]) -> (u8, String) {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = application(scenario)
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    (code.get(), process.stderr_text())
}

async fn written(scenario: Scenario, argv: &[&str]) -> String {
    run(scenario, argv).await.1
}

async fn suggested(argv: &[&str]) -> String {
    written(Scenario::Plain, argv).await
}

fn command(token: &str, fix: &str) -> String {
    format!("kit: Unknown command \"{token}\". {fix}\n")
}

fn option(spelling: &str, fix: &str) -> String {
    format!("kit: Unknown option \"{spelling}\". {fix}\n")
}

/// The run under the plugin equals the run under the baseline, which must have failed.
async fn unchanged(argv: &[&str], scenario: Scenario, baseline: Scenario) {
    let core = run(baseline, argv).await;
    assert_ne!(core.0, 0, "the baseline run of {argv:?} succeeded");
    assert_eq!(run(scenario, argv).await, core, "{argv:?}");
}

async fn same_as_core(argv: &[&str]) {
    unchanged(argv, Scenario::Plain, Scenario::Core).await;
}

// The matcher.

#[tokio::test]
async fn an_insertion_a_deletion_a_substitution_and_an_adjacent_transposition_each_cost_1() {
    for typo in ["gt", "gett", "gat", "gte"] {
        assert_eq!(
            suggested(&["edits", typo]).await,
            command(typo, "Did you mean \"get\"?")
        );
    }
}

#[tokio::test]
async fn the_failure_exits_with_the_usage_code() {
    assert_eq!(run(Scenario::Plain, &["edits", "gte"]).await.0, 2);
}

#[tokio::test]
async fn a_non_adjacent_transposition_costs_2_past_the_budget_of_a_4_code_point_token() {
    same_as_core(&["edits", "nale"]).await;
}

#[tokio::test]
async fn a_token_of_up_to_4_code_points_allows_1_edit() {
    assert_eq!(
        suggested(&["budget", "fuor"]).await,
        command("fuor", "Did you mean \"four\"?")
    );
    same_as_core(&["budget", "fxxr"]).await;
}

#[tokio::test]
async fn a_token_of_5_code_points_allows_2_edits() {
    assert_eq!(
        suggested(&["budget", "fivxx"]).await,
        command("fivxx", "Did you mean \"fives\"?")
    );
    same_as_core(&["budget", "fxxxs"]).await;
}

#[tokio::test]
async fn a_token_of_8_code_points_allows_2_edits() {
    assert_eq!(
        suggested(&["budget", "seasxxed"]).await,
        command("seasxxed", "Did you mean \"seasoned\"?")
    );
    same_as_core(&["budget", "sxasxxed"]).await;
}

#[tokio::test]
async fn a_token_longer_than_8_code_points_allows_3_edits() {
    assert_eq!(
        suggested(&["budget", "ovxxxight"]).await,
        command("ovxxxight", "Did you mean \"overnight\"?")
    );
    same_as_core(&["budget", "oxxxxight"]).await;
}

#[tokio::test]
async fn a_token_of_one_code_point_matches_nothing() {
    same_as_core(&["opts", "--x"]).await;
}

#[tokio::test]
async fn a_token_that_differs_only_in_case_matches_at_distance_0_and_prints_as_declared() {
    assert_eq!(
        suggested(&["edits", "GET"]).await,
        command("GET", "Did you mean \"get\"?")
    );
    assert_eq!(
        suggested(&["edits", "build"]).await,
        command("build", "Did you mean \"Build\"?")
    );
}

#[tokio::test]
async fn the_token_is_normalized_to_nfc_before_the_comparison() {
    let decomposed = format!("--{}", "e\u{301}".repeat(3));
    assert_eq!(
        suggested(&["opts", &decomposed]).await,
        option(&decomposed, "Did you mean \"--ééé\"?")
    );
}

#[tokio::test]
async fn lengths_and_distances_count_code_points_not_code_units() {
    assert_eq!(
        suggested(&["edits", "ge😀"]).await,
        command("ge😀", "Did you mean \"get\"?")
    );
}

#[tokio::test]
async fn leading_hyphens_are_left_out_of_an_option_comparison() {
    assert_eq!(
        suggested(&["opts", "--fields"]).await,
        option("--fields", "Did you mean \"--field\"?")
    );
    assert_eq!(
        suggested(&["opts", "---field"]).await,
        option("---field", "Did you mean one of these: --field, --file?")
    );
}

#[tokio::test]
async fn matches_rank_by_distance_then_graph_order_and_at_most_three_print() {
    assert_eq!(
        suggested(&["rank", "tep"]).await,
        command("tep", "Did you mean one of these: tap, tip, top?")
    );
    assert_eq!(
        suggested(&["rank", "TUP"]).await,
        command("TUP", "Did you mean one of these: tup, tap, tip?")
    );
}

#[tokio::test]
async fn a_global_option_ranks_ahead_of_the_routed_command_option_at_one_distance() {
    assert_eq!(
        suggested(&["opts", "--fiel"]).await,
        option("--fiel", "Did you mean one of these: --file, --field?")
    );
}

#[tokio::test]
async fn a_negative_spelling_answers_its_own_typo_and_never_the_positive_spelling() {
    assert_eq!(
        suggested(&["opts", "--no-colr"]).await,
        option("--no-colr", "Did you mean \"--no-color\"?")
    );
    assert_eq!(
        suggested(&["opts", "--colr"]).await,
        option("--colr", "Did you mean \"--color\"?")
    );
}

#[tokio::test]
async fn an_option_offers_only_the_nearer_of_its_two_spellings() {
    assert_eq!(
        suggested(&["opts", "--nocolor"]).await,
        option("--nocolor", "Did you mean \"--no-color\"?")
    );
    assert_eq!(
        suggested(&["opts", "--Verbosity-Level"]).await,
        option("--Verbosity-Level", "Did you mean \"--verbosity-level\"?")
    );
}

#[tokio::test]
async fn an_option_offers_both_spellings_when_the_typo_is_as_near_to_each() {
    assert_eq!(
        suggested(&["opts", "--noclor"]).await,
        option(
            "--noclor",
            "Did you mean one of these: --color, --no-color?"
        )
    );
}

#[tokio::test]
async fn a_counted_option_offers_its_long_spelling_alone() {
    assert_eq!(
        suggested(&["tally", "--quietnes"]).await,
        option("--quietnes", "Did you mean \"--quietness\"?")
    );
    assert_eq!(
        suggested(&["tally", "--no-quietness"]).await,
        option("--no-quietness", "Did you mean \"--quietness\"?")
    );
}

#[tokio::test]
async fn an_implied_value_option_offers_its_long_spelling_alone() {
    assert_eq!(
        suggested(&["tally", "--bakup"]).await,
        option("--bakup", "Did you mean \"--backup\"?")
    );
    assert_eq!(
        suggested(&["tally", "--bakup=numbered"]).await,
        option("--bakup", "Did you mean \"--backup\"?")
    );
}

#[tokio::test]
async fn a_plugin_option_is_a_candidate() {
    let application = Application::new("kit")
        .plugins((suggestions(), declaring_plugin()))
        .command(Command::new("opts").action(dispatch))
        .action(dispatch);
    let process = mock_process(MockFields::new().argv(["opts", "--verbos"]));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 2);
    assert_eq!(
        process.stderr_text(),
        option("--verbos", "Did you mean \"--verbose\"?")
    );
}

/// A plugin that declares one global option, as the reference's `help()` declares `--help`.
fn declaring_plugin() -> Plugin {
    Plugin::new("fixture/verbose").option("verbose", Opt::boolean())
}

// An invocation by name.

#[tokio::test]
async fn an_unknown_option_suggests_the_declared_name_where_argv_suggests_the_spelling() {
    assert_eq!(
        suggested(&["opts", "--kepe"]).await,
        option("--kepe", "Did you mean \"--keep\"?")
    );
    let process = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let outcome = application(Scenario::Plain)
        .invoke(
            &["opts"],
            InvocationValues::new().option("kepe", true),
            InvokeOptions::new(),
            Some(process as Arc<dyn ProcessHandle>),
        )
        .await;
    match outcome {
        InvocationOutcome::Failed { messages, .. } => {
            assert_eq!(messages, option("kepe", "Did you mean \"keep\"?"));
        }
        other => panic!("{other:?}"),
    }
}

// Excluded members.

#[tokio::test]
async fn a_hidden_child_a_deprecated_child_and_an_alias_are_never_suggested() {
    for typo in ["secrt", "legcy", "lss"] {
        same_as_core(&["excluded", typo]).await;
    }
}

#[tokio::test]
async fn a_hidden_option_and_a_deprecated_option_are_never_suggested() {
    for typo in ["--secrt", "--oldr"] {
        same_as_core(&["opts", typo]).await;
    }
}

#[tokio::test]
async fn a_short_spelling_is_never_a_candidate() {
    same_as_core(&["opts", "-z"]).await;
}

// The sentence.

#[tokio::test]
async fn a_token_holding_a_control_character_or_a_bidirectional_control_is_escaped() {
    assert_eq!(
        suggested(&["edits", "ge\u{7}t"]).await,
        command("ge\\u0007t", "Did you mean \"get\"?")
    );
    assert_eq!(
        suggested(&["edits", "g\u{202e}et"]).await,
        command("g\\u202eet", "Did you mean \"get\"?")
    );
}

#[tokio::test]
async fn with_no_match_the_view_writes_core_text_an_escaped_token_included() {
    for argv in [
        &["edits", "zzzz"][..],
        &["edits", "zz\u{7}zz"],
        &["opts", "--zzzz"],
    ] {
        same_as_core(argv).await;
    }
}

#[tokio::test]
async fn with_no_match_the_view_writes_core_text_with_its_hints() {
    unchanged(&["edits", "zzzz"], Scenario::Hinted, Scenario::HintCore).await;
}

#[tokio::test]
async fn the_hook_adds_no_hint_and_every_hint_prints_under_the_sentence_in_installation_order() {
    assert_eq!(
        written(Scenario::Hinted, &["edits", "gte"]).await,
        "kit: Unknown command \"gte\". Did you mean \"get\"?\nFirst hint.\nSecond hint.\n"
    );
}

#[tokio::test]
async fn a_group_with_no_subcommand_keeps_core_text() {
    same_as_core(&["rank"]).await;
}

#[tokio::test]
async fn a_misplaced_option_keeps_core_text_which_already_names_the_command_that_declares_it() {
    let core = run(Scenario::Core, &["--color", "opts"]).await;
    assert_eq!(
        core.1,
        "kit: Option \"--color\" belongs to command \"opts\". Supply it after \"opts\".\n"
    );
    same_as_core(&["--color", "opts"]).await;
}

#[tokio::test]
async fn an_input_error_and_a_fatal_error_an_action_throws_keep_core_text() {
    same_as_core(&["work", "x", "--end", "input"]).await;
    same_as_core(&["work", "x", "--end", "fatal"]).await;
}

#[tokio::test]
async fn a_failure_reported_twice_in_one_process_keeps_each_report_its_own_sentence() {
    // Two runs of one application, one after the other, each get their own suggestion, and a run
    // with nothing near gets core's text, whatever address the failure lands on.
    for _ in 0..3 {
        assert_eq!(
            suggested(&["opts", "--fiel"]).await,
            option("--fiel", "Did you mean one of these: --file, --field?")
        );
        assert_eq!(
            suggested(&["opts", "--zzzzz"]).await,
            written(Scenario::Core, &["opts", "--zzzzz"]).await
        );
    }
}

// Precedence.

#[tokio::test]
async fn the_applications_override_of_the_unknown_command_view_wins() {
    assert_eq!(
        written(Scenario::AppCommand, &["edits", "gte"]).await,
        "app: unknown-command\n"
    );
}

#[tokio::test]
async fn the_applications_override_of_a_class_above_both_views_wins() {
    assert_eq!(
        written(Scenario::AppUsage, &["edits", "gte"]).await,
        "app: usage\n"
    );
    assert_eq!(
        written(Scenario::AppUsage, &["opts", "--fields"]).await,
        "app: usage\n"
    );
}

#[tokio::test]
async fn an_earlier_installed_plugins_override_wins_and_a_later_installed_one_loses() {
    assert_eq!(
        written(Scenario::PluginBefore, &["edits", "gte"]).await,
        "before: unknown-command\n"
    );
    assert_eq!(
        written(Scenario::PluginAfter, &["edits", "gte"]).await,
        command("gte", "Did you mean \"get\"?")
    );
}

#[test]
fn the_plugin_installs_once_under_its_identity() {
    let result = std::panic::catch_unwind(|| {
        let _ = Application::new("kit").plugins((suggestions(), suggestions()));
    });
    assert!(result.is_err());
}
