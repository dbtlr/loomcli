//! Ports `format-plugin.test.ts`: `--format`, the views the hook adds, the middleware, the hook
//! collisions, and the short setting. The reference installs `help()` and `version()` ahead of the
//! formatter; those plugins belong to other packages, so a fixture that read their output reads the
//! graph instead, and the test map names each such case.

#![cfg(feature = "format")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    Activation, AnyPlugin, Application, AttachedViews, Build, Command, Context, Done, Inputs,
    NoInputs, NoResult, Opt, Plugin, ProcessHandle, ReleaseFacts, ResultViews, RunOptions, State,
    ValueResult, View,
};
use loomcli_plugins::format::{format, json_mapped};
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Value, json};

#[derive(Debug, PartialEq, Eq)]
struct Ran {
    status: u8,
    stderr: String,
    stdout: String,
}

fn ran(status: u8, stdout: &str, stderr: &str) -> Ran {
    Ran {
        status,
        stderr: stderr.to_owned(),
        stdout: stdout.to_owned(),
    }
}

type App = Application<NoInputs, NoResult, Done>;

async fn run<S: State>(application: &Application<NoInputs, NoResult, S>, argv: &[&str]) -> Ran {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// The table view of the reference fixture: `table:<label>:<value>`.
fn table() -> View<Value> {
    View::new(|data: &Value, _| {
        format!(
            "table:{}:{}\n",
            data["label"].as_str().unwrap(),
            data["value"]
        )
    })
}

/// A `count` Command over `views` whose action emits the one fixture row.
fn counting(views: ResultViews<Value>) -> Command<NoInputs, ValueResult<Value>> {
    Command::new("count").result(views).action(
        |ctx: Context<NoInputs, ValueResult<Value>>| async move {
            ctx.out.results(json!({ "label": "a", "value": 1 })).await
        },
    )
}

fn only_table() -> ResultViews<Value> {
    ResultViews::new().view("table", table())
}

fn app_of(command: Command<NoInputs, ValueResult<Value>>, plugins: Vec<AnyPlugin>) -> App {
    Application::new("app")
        .plugins(plugins)
        .command(command)
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await })
}

/// The `count` node's result and options, as `inspect()` publishes them.
fn inspected(application: &App) -> (Value, Vec<Value>) {
    let graph = application.inspect().unwrap();
    let count = graph.command(&["count"]).unwrap();
    let options = count
        .options
        .iter()
        .map(|option| serde_json::to_value(option).unwrap())
        .collect();
    (serde_json::to_value(&count.result).unwrap(), options)
}

fn format_option(application: &App) -> Value {
    inspected(application)
        .1
        .into_iter()
        .find(|option| option["name"] == "format")
        .expect("the --format option")
}

fn formatted() -> Vec<AnyPlugin> {
    vec![format().into()]
}

/// A plugin ahead of `format()` whose always-on middleware assigns a view of its own.
fn earlier() -> Plugin {
    Plugin::new("@fixture/earlier").middleware(Activation::Always, |context, next| async move {
        if context.view().is_some() {
            context.select_view("table");
        }
        next.run().await?;
        Ok(())
    })
}

/// A plugin whose hook adds a `custom` view and makes it the default.
fn change_default() -> Plugin {
    Plugin::new("@fixture/default").on_command_attach(|command| {
        if command.result().is_some() {
            command.views(
                AttachedViews::new()
                    .view(
                        "custom",
                        View::new(|data: &Value, _| format!("custom:{}\n", data["label"])),
                    )
                    .view("json", table())
                    .default_view("custom"),
            )?;
        }
        Ok(())
    })
}

fn author_json() -> App {
    let mapped = json_mapped(|data: &Value| json!({ "label": data["label"] }));
    app_of(
        counting(
            ResultViews::new()
                .view("json", mapped)
                .view("table", table()),
        ),
        formatted(),
    )
}

fn author_ndjson() -> App {
    app_of(
        counting(
            ResultViews::new()
                .view("ndjson", table())
                .view("table", table()),
        ),
        formatted(),
    )
}

/// `change_default()` installed ahead of or after the formatter.
fn hook_order(before: bool) -> App {
    let plugins: Vec<AnyPlugin> = if before {
        vec![change_default().into(), format().into()]
    } else {
        vec![format().into(), change_default().into()]
    };
    app_of(counting(only_table()), plugins)
}

fn earlier_view() -> App {
    let views = ResultViews::new()
        .view("json", json_mapped(|data: &Value| data.clone()))
        .view("table", table());
    app_of(counting(views), vec![earlier().into(), format().into()])
}

fn no_result() -> App {
    Application::new("app")
        .plugins(formatted())
        .command(
            Command::new("count")
                .action(|ctx: Context| async move { ctx.out.print("dispatched").await }),
        )
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await })
}

fn short_app() -> App {
    app_of(counting(only_table()), vec![format().short('f').into()])
}

const ROW: &str = "{\n  \"label\": \"a\",\n  \"value\": 1\n}\n";

#[tokio::test]
async fn an_author_declared_json_view_is_kept_with_its_own_map_and_its_declared_position() {
    let application = author_json();
    let (result, _) = inspected(&application);
    assert_eq!(
        result,
        json!({
            "default": "json",
            "kind": "value",
            "mediaTypes": { "json": "application/json", "jsonl": "application/jsonl", "table": null },
            "views": ["json", "table", "jsonl"],
        })
    );
    // The default view is the author's json, so an omitted --format renders through its own map.
    assert_eq!(
        run(&application, &["count"]).await,
        ran(0, "{\n  \"label\": \"a\"\n}\n", "")
    );
    assert_eq!(
        run(&application, &["count", "--format", "jsonl"]).await,
        ran(0, "{\"label\":\"a\",\"value\":1}\n", "")
    );
}

#[tokio::test]
async fn an_author_declared_ndjson_key_is_not_served_by_the_alias_which_names_it_directly() {
    let application = author_ndjson();
    let (result, _) = inspected(&application);
    assert_eq!(
        result,
        json!({
            "default": "ndjson",
            "kind": "value",
            "mediaTypes": {
                "json": "application/json",
                "jsonl": "application/jsonl",
                "ndjson": null,
                "table": null,
            },
            "views": ["ndjson", "table", "json", "jsonl"],
        })
    );
    assert_eq!(
        run(&application, &["count", "--format", "ndjson"]).await,
        ran(0, "table:a:1\n", "")
    );
}

#[tokio::test]
async fn an_omitted_format_leaves_an_earlier_plugins_view_assignment_in_place() {
    assert_eq!(
        run(&earlier_view(), &["count"]).await,
        ran(0, "table:a:1\n", "")
    );
}

#[tokio::test]
async fn a_supplied_format_still_wins_over_an_earlier_plugin_because_format_runs_after_it() {
    assert_eq!(
        run(&earlier_view(), &["count", "--format", "json"]).await,
        ran(0, ROW, "")
    );
}

#[tokio::test]
async fn format_on_a_command_with_no_result_is_the_unknown_option_error() {
    let ran = run(&no_result(), &["count", "--format", "json"]).await;
    assert_eq!(ran.status, 2);
    assert_eq!(ran.stdout, "");
    assert_eq!(
        ran.stderr,
        "app: Unknown option \"--format\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
    );
}

#[test]
fn a_no_result_command_has_no_format_option() {
    let graph = no_result().inspect().unwrap();
    assert!(graph.command(&["count"]).unwrap().options.is_empty());
}

#[tokio::test]
async fn a_rejected_format_is_the_validators_issue_at_exit_2() {
    assert_eq!(
        run(&short_app(), &["count", "--format", "yaml"]).await,
        ran(
            2,
            "",
            "app: Option \"--format\": Supply one of table, json, jsonl.\n"
        )
    );
}

#[test]
fn a_hook_collision_with_a_local_option_is_a_build_fault_naming_the_plugin_and_the_command() {
    let command = Command::new("count")
        .option("format", Opt::boolean())
        .result(only_table())
        .action(|ctx: Context<_, ValueResult<Value>>| async move {
            ctx.out.results(json!({ "label": "a", "value": 1 })).await
        });
    let application = Application::new("app")
        .plugins(formatted())
        .command(command)
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    let fault = application.inspect().expect_err("a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/option-declared-twice")
    );
    assert_eq!(
        fault.sentence(),
        "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"count\", which is already declared as a local option."
    );
}

#[tokio::test]
async fn a_hook_collision_is_reported_at_exit_1_with_the_generic_message_in_a_distributed_build() {
    let command = Command::new("count")
        .option("format", Opt::boolean())
        .result(only_table())
        .action(|ctx: Context<_, ValueResult<Value>>| async move {
            ctx.out.results(json!({ "label": "a", "value": 1 })).await
        });
    let application = Application::new("app")
        .plugins(formatted())
        .command(command)
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    assert_eq!(
        run(&application, &["count"]).await,
        ran(1, "", "app: Something went wrong.\n")
    );
}

#[tokio::test]
async fn a_hook_collision_with_a_global_option_is_a_build_fault() {
    let application = Application::new("app")
        .plugins(formatted())
        .global_option("format", Opt::boolean())
        .command(counting(only_table()))
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    let fault = application.inspect().expect_err("a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/option-declared-twice")
    );
    assert_eq!(
        fault.sentence(),
        "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"count\", which is already declared as a global option."
    );
    assert_eq!(
        run(&application, &["count"]).await,
        ran(1, "", "app: Something went wrong.\n")
    );
}

/// A plugin option named `format`, installed ahead of `format()`.
#[derive(Inputs)]
struct Claim {
    /// Claim the name first.
    #[option]
    format: bool,
}

#[tokio::test]
async fn a_hook_collision_with_another_plugins_option_is_a_build_fault() {
    let claimant = Plugin::new("@fixture/claimant").options::<Claim>();
    let application = app_of(
        counting(only_table()),
        vec![claimant.into(), format().into()],
    );
    let fault = application.inspect().expect_err("a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/option-declared-twice")
    );
    assert_eq!(
        fault.sentence(),
        "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"count\", which is already declared as an option of plugin \"@fixture/claimant\"."
    );
    assert_eq!(
        run(&application, &["count"]).await,
        ran(1, "", "app: Something went wrong.\n")
    );
}

#[tokio::test]
async fn a_format_with_no_value_or_given_twice_follows_the_rules_every_string_option_follows() {
    let application = short_app();
    assert_eq!(
        run(&application, &["count", "--format"]).await,
        ran(
            2,
            "",
            "app: Option \"--format\" requires a value. Supply a value after \"--format\".\n"
        )
    );
    assert_eq!(
        run(
            &application,
            &["count", "--format", "json", "--format", "json"]
        )
        .await,
        ran(
            2,
            "",
            "app: Option \"--format\" can be supplied only once. Remove the repeated option.\n"
        )
    );
}

#[test]
fn a_default_formatter_gives_format_no_short_spelling() {
    assert_eq!(format_option(&hook_order(false))["short"], Value::Null);
}

#[tokio::test]
async fn a_default_formatter_has_no_short_f() {
    assert_eq!(
        run(&hook_order(false), &["count", "-f", "json"])
            .await
            .status,
        2
    );
}

#[tokio::test]
async fn a_short_setting_gives_format_that_spelling_and_it_selects_a_view() {
    let application = short_app();
    let option = format_option(&application);
    assert_eq!(option["short"], "-f");
    assert_eq!(
        run(&application, &["count", "-f", "json"]).await,
        ran(0, ROW, "")
    );
}

#[test]
fn a_short_spelling_the_commands_own_option_holds_is_the_spelling_taken_fault_naming_both() {
    let command = Command::new("count")
        .option("file", Opt::string().short('f'))
        .result(only_table())
        .action(|ctx: Context<_, ValueResult<Value>>| async move {
            ctx.out.results(json!({ "label": "a", "value": 1 })).await
        });
    let application = Application::new("app")
        .plugins(vec![AnyPlugin::from(format().short('f'))])
        .command(command)
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    let fault = application.inspect().expect_err("a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/spelling-taken")
    );
    assert_eq!(
        fault.sentence(),
        "Plugin \"@loomcli/plugins/format\" declares option \"format\" with spelling \"-f\" on Command \"count\", which \"--file\" already uses."
    );
}

#[tokio::test]
async fn a_groups_own_format_option_is_a_build_fault_even_without_a_requested_format() {
    let clear = Command::new("clear").action(|_: Context| async { Ok(()) });
    let cache = Command::new("cache")
        .option("format", Opt::string())
        .command(clear);
    let application = Application::new("app").plugins(formatted()).command(cache);
    let fault = application.inspect().expect_err("a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/option-declared-twice")
    );
    assert_eq!(
        fault.sentence(),
        "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"cache\", which is already declared as a local option."
    );
    assert_eq!(
        run(&application, &["cache", "clear"]).await,
        ran(1, "", "app: Something went wrong.\n")
    );
}

#[tokio::test]
async fn a_groups_own_short_spelling_is_a_build_fault_even_without_a_requested_format() {
    let clear = Command::new("clear").action(|_: Context| async { Ok(()) });
    let cache = Command::new("cache")
        .option("force", Opt::boolean().short('f'))
        .command(clear);
    let application = Application::new("app")
        .plugins(vec![AnyPlugin::from(format().short('f'))])
        .command(cache);
    let fault = application.inspect().expect_err("a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/spelling-taken")
    );
    assert_eq!(
        fault.sentence(),
        "Plugin \"@loomcli/plugins/format\" declares option \"format\" with spelling \"-f\" on Command \"cache\", which \"--force\" already uses."
    );
    assert_eq!(
        run(&application, &["cache", "clear"]).await,
        ran(1, "", "app: Something went wrong.\n")
    );
}

/// A plugin option `--help` with the short spelling `-h`, as help's is.
#[derive(Inputs)]
struct Helper {
    /// Show this help.
    #[option(short = 'h')]
    help: bool,
}

#[test]
fn a_short_spelling_another_plugins_option_holds_is_the_spelling_taken_fault_naming_both() {
    let helper = Plugin::new("@fixture/helper").options::<Helper>();
    let application = app_of(
        counting(only_table()),
        vec![helper.into(), format().short('h').into()],
    );
    let fault = application.inspect().expect_err("a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/spelling-taken")
    );
    assert_eq!(
        fault.sentence(),
        "Plugin \"@loomcli/plugins/format\" declares option \"format\" with spelling \"-h\" on Command \"count\", which \"--help\" already uses."
    );
}

#[test]
fn a_short_setting_of_no_settings_empty_settings_or_one_ascii_letter_builds_its_plugin() {
    for plugin in [
        AnyPlugin::from(format()),
        AnyPlugin::from(format().short('f')),
        AnyPlugin::from(format().short('F')),
    ] {
        let application = app_of(counting(only_table()), vec![plugin]);
        assert!(application.inspect().is_ok());
    }
}

#[test]
fn the_formatter_describes_its_declared_default_and_publishes_the_ordered_views_as_its_enum() {
    let option = format_option(&author_json());
    assert_eq!(
        option["description"],
        "Select the output format, json by default."
    );
    assert_eq!(option["schema"]["enum"], json!(["json", "table", "jsonl"]));
    assert!(option.get("default").is_none());
    assert_eq!(option["control"], true);
}

#[test]
fn the_format_description_records_the_hook_time_default_and_its_enum_the_hook_time_names() {
    for (application, names, selected) in [
        (hook_order(true), "table, custom, json, jsonl", "custom"),
        (hook_order(false), "table, json, jsonl", "table"),
        (author_ndjson(), "ndjson, table, json, jsonl", "ndjson"),
    ] {
        let option = format_option(&application);
        assert_eq!(
            option["description"],
            format!("Select the output format, {selected} by default.")
        );
        let expected: Vec<&str> = names.split(", ").collect();
        assert_eq!(option["schema"]["enum"], json!(expected));
        assert!(option.get("default").is_none());
    }
}

#[test]
fn a_result_without_the_formatter_invents_no_selector_or_list_of_views() {
    let application = Application::new("app")
        .command(counting(only_table()))
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    let (_, options) = inspected(&application);
    assert!(options.is_empty());
}

#[test]
fn format_publishes_the_dialect_then_the_enum_of_the_view_names_alone() {
    for (application, names) in [
        (hook_order(false), r#"["table","json","jsonl"]"#),
        (author_ndjson(), r#"["ndjson","table","json","jsonl"]"#),
    ] {
        assert_eq!(
            serde_json::to_string(&format_option(&application)["schema"]).unwrap(),
            format!(
                r#"{{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":{names}}}"#
            )
        );
    }
}

#[tokio::test]
async fn the_unadvertised_ndjson_alias_maps_to_jsonl_and_a_stray_name_lists_the_views() {
    let application = hook_order(false);
    assert_eq!(
        run(&application, &["count", "--format", "ndjson"]).await,
        ran(0, "{\"label\":\"a\",\"value\":1}\n", "")
    );
    assert_eq!(
        run(&application, &["count", "--format", "xml"]).await,
        ran(
            2,
            "",
            "app: Option \"--format\": Supply one of table, json, jsonl.\n"
        )
    );
}

#[tokio::test]
async fn a_view_another_plugins_hook_adds_before_the_formatter_is_accepted_by_format() {
    let application = hook_order(true);
    assert_eq!(
        run(&application, &["count"]).await,
        ran(0, "custom:\"a\"\n", "")
    );
    assert_eq!(
        run(&application, &["count", "--format", "custom"]).await,
        ran(0, "custom:\"a\"\n", "")
    );
}

#[tokio::test]
async fn a_view_another_plugins_hook_adds_after_the_formatter_is_not_in_its_enum() {
    assert_eq!(
        run(&hook_order(false), &["count", "--format", "custom"]).await,
        ran(
            2,
            "",
            "app: Option \"--format\": Supply one of table, json, jsonl.\n"
        )
    );
}

#[test]
fn a_short_setting_that_is_not_an_ascii_letter_is_a_build_fault() {
    let application = app_of(counting(only_table()), vec![format().short('1').into()]);
    let fault = application.inspect().expect_err("a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/option-config")
    );
    assert_eq!(
        fault.sentence(),
        "Option \"format\" declares a short spelling that is not one ASCII letter."
    );
}

#[tokio::test]
async fn format_with_a_row_result_collects_the_rows_for_json_and_jsonl() {
    let walk = Command::new("walk")
        .rows::<Value>(loomcli_core::RowViews::new().view(
            "table",
            loomcli_core::RowView::new(|row: &Value, _, _| format!("{}\n", row["key"])),
        ))
        .action(
            |ctx: Context<NoInputs, loomcli_core::RowsResult<Value>>| async move {
                ctx.out
                    .results(vec![json!({ "key": "a" }), json!({ "key": "b" })])
                    .await
            },
        );
    let application = Application::new("app")
        .plugins(formatted())
        .command(walk)
        .action(|ctx: Context| async move { ctx.out.print("dispatched").await });
    assert_eq!(
        run(&application, &["walk", "--format", "json"]).await,
        ran(
            0,
            "[\n  {\n    \"key\": \"a\"\n  },\n  {\n    \"key\": \"b\"\n  }\n]\n",
            ""
        )
    );
    assert_eq!(
        run(&application, &["walk", "--format", "jsonl"]).await,
        ran(0, "{\"key\":\"a\"}\n{\"key\":\"b\"}\n", "")
    );
}

/// A plugin with a boolean `--help` whose middleware prints a fixed page and stops the run, as
/// help's does; installed after the formatter, it takes over a run the formatter held a fault for.
#[derive(Inputs)]
struct PageOption {
    /// Print the page.
    #[option]
    help: bool,
}

fn paging() -> Plugin<PageOption> {
    Plugin::new("@fixture/page")
        .options::<PageOption>()
        .middleware(
            Activation::options(["help"]),
            |context: loomcli_core::MiddlewareContext<PageOption>, _next| async move {
                context.out.print("page of count").await
            },
        )
}

#[tokio::test]
async fn a_rejected_format_with_help_after_it_still_prints_the_page() {
    let application = app_of(
        counting(only_table()),
        vec![format().short('f').into(), paging().into()],
    );
    let page = run(&application, &["count", "--help"]).await;
    assert_eq!(page, ran(0, "page of count\n", ""));
    assert_eq!(
        run(&application, &["count", "--format", "yaml", "--help"]).await,
        page
    );
}
