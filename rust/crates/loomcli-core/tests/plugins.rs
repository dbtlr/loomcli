//! The plugin contract: installation and its composition faults, plugin options and Commands
//! joining the graph, the hook-collision rules of graph build, and plugin failure views.
//!
//! Ported from the reference's `plugins.test.ts`, `plugin-diagnostics.test.ts`,
//! `plugin-commands.test.ts`, `plugin-options.test.ts` (the parts no middleware reads), and
//! `configuration-schema.test.ts`. A fault a call can judge panics at that call with its whole
//! Developer Diagnostic; a build fault is returned by `inspect()` and rendered by `run()`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Activation, AnyCommand, Application, Arg, AttachedCommand, Build, Command, ConfigurationSource,
    Context, DeclarationError, Done, Error, Extension, FatalError, InputError, NoInputs, NoResult,
    Opt, OptionTarget, Outcome, Plugin, ReleaseFacts, ResultViews, State, ThemeMapping,
    ValueResult, View, encode_failure, failure, override_view, style, view,
};
use loomcli_testing::MockFields;
use serde_json::json;
use support::faults::{panic_message, panic_rule, rule_name, rule_text, thrown};
use support::{Ran, run_with};

type App = Application<NoInputs, NoResult, Done>;

async fn dispatch(ctx: Context) -> Outcome {
    ctx.out.print("dispatched").await
}

/// An action that prints `ran:<name>`.
fn named(name: &'static str) -> Command {
    Command::new(name)
        .action(move |ctx: Context| async move { ctx.out.print(&format!("ran:{name}")).await })
}

/// A run on the mock in `build` with these words.
async fn ran<I, R, S: State>(
    application: &Application<I, R, S>,
    argv: &[&str],
    build: Build,
) -> Ran {
    run_with(
        application,
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(build)),
    )
    .await
}

// plugins.test.ts: every row a call can judge throws from that call.

#[test]
fn an_identity_installed_twice_faults_at_the_plugins_call() {
    assert_eq!(
        thrown(|| {
            let _ = Application::new("app")
                .plugins([Plugin::new("@loomcli/help"), Plugin::new("@loomcli/help")])
                .action(dispatch);
        }),
        "The Application installs plugin \"@loomcli/help\" twice. Install each plugin once."
    );
}

#[test]
fn a_plugin_option_and_a_global_option_under_one_key_fault_at_the_global_option() {
    assert_eq!(
        thrown(|| {
            let _ = Application::new("app")
                .plugins([Plugin::new("@loomcli/help").option("help", Opt::boolean())])
                .global_option("help", Opt::boolean())
                .action(dispatch);
        }),
        "Option \"help\" is declared by plugin \"@loomcli/help\" and as a global option. Rename one declaration."
    );
}

#[test]
fn a_plugin_option_and_a_local_option_under_one_key_fault_at_the_attach() {
    assert_eq!(
        thrown(|| {
            let get = Command::new("get")
                .option("help", Opt::boolean())
                .action(dispatch);
            let _ = Application::new("app")
                .plugins([Plugin::new("@loomcli/help").option("help", Opt::boolean())])
                .command(get);
        }),
        "Option \"help\" is declared by plugin \"@loomcli/help\" and as a local option on Command \"get\". Rename the local option."
    );
}

#[test]
fn two_plugins_that_declare_one_option_key_fault_at_installation() {
    assert_eq!(
        thrown(|| {
            let _ = Application::new("app")
                .plugins([
                    Plugin::new("@loomcli/log").option("verbose", Opt::boolean()),
                    Plugin::new("@acme/trace").option("verbose", Opt::boolean()),
                ])
                .action(dispatch);
        }),
        "Option \"verbose\" is declared by plugin \"@loomcli/log\" and plugin \"@acme/trace\". Install one of them or rename the option."
    );
}

#[test]
fn a_plugin_spelling_a_global_option_uses_faults_at_the_global_option() {
    assert_eq!(
        thrown(|| {
            let _ = Application::new("app")
                .plugins([Plugin::new("@loomcli/help").option("help", Opt::boolean().short('h'))])
                .global_option("host", Opt::string().short('h'))
                .action(dispatch);
        }),
        "Option spelling \"-h\" is used by plugin \"@loomcli/help\" option \"help\" and the global option \"host\". Change one declaration."
    );
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Details {
    details: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct OtherDetails {
    details: u32,
}

const FACTS: Extension<loomcli_core::CommandTarget, Details> =
    Extension::new("@fixture/facts/command");

/// A descriptor another copy of the defining crate would hold: one identity, another value type.
const TWIN: Extension<loomcli_core::CommandTarget, OtherDetails> =
    Extension::new("@fixture/facts/command");

#[test]
fn a_second_descriptor_under_a_plugins_identity_faults_where_it_joins() {
    assert_eq!(
        thrown(|| {
            let get = Command::new("get")
                .extend([TWIN.value(OtherDetails { details: 1 })])
                .action(dispatch);
            let _ = Application::new("app")
                .plugins([Plugin::new("@fixture/facts").extensions([FACTS])])
                .command(get);
        }),
        "Extension \"@fixture/facts/command\" is defined twice. Install one copy of the package that defines it."
    );
}

// plugins.test.ts: every row a lifecycle hook raises, which only the graph build knows.

/// The Command a hook reshapes: one value result under one declared view.
fn counted() -> Command<NoInputs, ValueResult<String>> {
    Command::new("count")
        .result(
            ResultViews::new().view("text", View::new(|value: &String, _| format!("{value}\n"))),
        )
        .action(|ctx: Context<NoInputs, ValueResult<String>>| async move {
            ctx.out.results("counted".to_owned()).await
        })
}

/// The plugin every hook row names, with the hook `act` over the `count` Command alone.
fn formatter(
    act: impl Fn(&mut AttachedCommand) -> Result<(), Error> + Send + Sync + 'static,
) -> Plugin {
    on_count("@loomcli/plugins/format", act)
}

fn on_count(
    identity: &str,
    act: impl Fn(&mut AttachedCommand) -> Result<(), Error> + Send + Sync + 'static,
) -> Plugin {
    Plugin::new(identity).on_command_attach(move |command| {
        if command.name() == Some("count") {
            act(command)
        } else {
            Ok(())
        }
    })
}

fn declares_format(command: &mut AttachedCommand) -> Result<(), Error> {
    command.option("format", Opt::string())?;
    Ok(())
}

fn declares_tag(command: &mut AttachedCommand) -> Result<(), Error> {
    command.argument("tag", Arg::string())?;
    Ok(())
}

fn declares_tag_option(command: &mut AttachedCommand) -> Result<(), Error> {
    command.option("tag", Opt::string())?;
    Ok(())
}

/// The hook scenarios, each an application whose build faults, with its rule and its text.
fn hook_scenarios() -> Vec<(&'static str, App, &'static str, &'static str)> {
    let with_hooks = |plugins: Vec<Plugin>, count: loomcli_core::AnyCommand| -> App {
        Application::new("app")
            .plugins(plugins)
            .command(count)
            .action(dispatch)
    };
    vec![
        (
            "hook-throws",
            with_hooks(
                vec![formatter(|_| {
                    Err(Error::from_foreign("the hook broke".into()))
                })],
                counted().into(),
            ),
            "broken-attach-hook",
            "Plugin \"@loomcli/plugins/format\" failed in onCommandAttach for Command \"count\": the hook broke. Return Ok(()) from on_command_attach, and return a DeclarationError as its Err only to reject the declaration.",
        ),
        (
            "hook-throws-declaration",
            with_hooks(
                vec![formatter(|_| {
                    Err(DeclarationError::sentence_only(
                        "Plugin \"@loomcli/plugins/format\" requires a result on Command \"count\". Declare one or omit the plugin.",
                    )
                    .into())
                })],
                counted().into(),
            ),
            "none",
            "Plugin \"@loomcli/plugins/format\" requires a result on Command \"count\". Declare one or omit the plugin.",
        ),
        (
            "hook-local-collision",
            with_hooks(
                vec![formatter(declares_format)],
                Command::new("count")
                    .option("format", Opt::string())
                    .action(dispatch)
                    .into(),
            ),
            "option-declared-twice",
            "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"count\", which is already declared as a local option. Rename the Command's option or omit the plugin.",
        ),
        (
            "hook-global-collision",
            Application::new("app")
                .plugins([formatter(declares_format)])
                .global_option("format", Opt::string())
                .command(counted())
                .action(dispatch),
            "option-declared-twice",
            "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"count\", which is already declared as a global option. Rename the global option or omit the plugin.",
        ),
        (
            "hook-plugin-collision",
            with_hooks(
                vec![
                    Plugin::new("@acme/out").option("format", Opt::string()),
                    formatter(declares_format),
                ],
                counted().into(),
            ),
            "option-declared-twice",
            "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"count\", which is already declared as an option of plugin \"@acme/out\". Install one of them.",
        ),
        (
            "hook-hook-collision",
            with_hooks(
                vec![
                    on_count("@acme/out", declares_format),
                    formatter(declares_format),
                ],
                counted().into(),
            ),
            "option-declared-twice",
            "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"count\", which is already declared as an option plugin \"@acme/out\" declared through onCommandAttach. Install one of them.",
        ),
        (
            "hook-argument-collision",
            with_hooks(
                vec![formatter(declares_format)],
                Command::new("count")
                    .argument("format", Arg::string())
                    .action(dispatch)
                    .into(),
            ),
            "name-shared-across-kinds",
            "Plugin \"@loomcli/plugins/format\" declares option \"format\" on Command \"count\", which is already declared as an argument. Rename the Command's argument or omit the plugin.",
        ),
        (
            "hook-argument-author-collision",
            with_hooks(
                vec![formatter(declares_tag)],
                Command::new("count")
                    .argument("tag", Arg::string())
                    .action(dispatch)
                    .into(),
            ),
            "argument-declared-twice",
            "Plugin \"@loomcli/plugins/format\" declares argument \"tag\" on Command \"count\", which is already declared as an argument. Rename the Command's argument or omit the plugin.",
        ),
        (
            "hook-argument-local-collision",
            with_hooks(
                vec![formatter(declares_tag)],
                Command::new("count")
                    .option("tag", Opt::string())
                    .action(dispatch)
                    .into(),
            ),
            "name-shared-across-kinds",
            "Plugin \"@loomcli/plugins/format\" declares argument \"tag\" on Command \"count\", which is already declared as a local option. Rename the Command's option or omit the plugin.",
        ),
        (
            "hook-argument-global-collision",
            Application::new("app")
                .plugins([formatter(declares_tag)])
                .global_option("tag", Opt::string())
                .command(counted())
                .action(dispatch),
            "name-shared-across-kinds",
            "Plugin \"@loomcli/plugins/format\" declares argument \"tag\" on Command \"count\", which is already declared as a global option. Rename the global option or omit the plugin.",
        ),
        (
            "hook-argument-plugin-collision",
            with_hooks(
                vec![
                    Plugin::new("@acme/out").option("tag", Opt::string()),
                    formatter(declares_tag),
                ],
                counted().into(),
            ),
            "name-shared-across-kinds",
            "Plugin \"@loomcli/plugins/format\" declares argument \"tag\" on Command \"count\", which is already declared as an option of plugin \"@acme/out\". Install one of them.",
        ),
        (
            "hook-argument-hook-option-collision",
            with_hooks(
                vec![
                    on_count("@acme/out", declares_tag_option),
                    formatter(declares_tag),
                ],
                counted().into(),
            ),
            "name-shared-across-kinds",
            "Plugin \"@loomcli/plugins/format\" declares argument \"tag\" on Command \"count\", which is already declared as an option plugin \"@acme/out\" declared through onCommandAttach. Install one of them.",
        ),
        (
            "hook-argument-hook-collision",
            with_hooks(
                vec![on_count("@acme/out", declares_tag), formatter(declares_tag)],
                counted().into(),
            ),
            "argument-declared-twice",
            "Plugin \"@loomcli/plugins/format\" declares argument \"tag\" on Command \"count\", which is already declared as an argument plugin \"@acme/out\" declared through onCommandAttach. Install one of them.",
        ),
        (
            "hook-spelling-collision",
            Application::new("app")
                .plugins([formatter(|command| {
                    command.option("format", Opt::string().short('f'))?;
                    Ok(())
                })])
                .global_option("file", Opt::string().short('f'))
                .command(counted())
                .action(dispatch),
            "spelling-taken",
            "Plugin \"@loomcli/plugins/format\" declares option \"format\" with spelling \"-f\" on Command \"count\", which \"--file\" already uses. Change one of the two spellings or omit the plugin.",
        ),
    ]
}

#[tokio::test]
async fn inspect_and_run_reject_each_hook_declaration_alike() {
    for (scenario, application, rule, text) in hook_scenarios() {
        let fault = application.inspect().expect_err(scenario);
        assert_eq!(rule_text(&fault), text, "{scenario}");
        assert_eq!(rule_name(&fault), rule, "{scenario}");
        assert_eq!(
            ran(&application, &[], Build::Distributed).await,
            Ran {
                status: 1,
                stdout: String::new(),
                stderr: "app: Something went wrong.\n".to_owned(),
            },
            "{scenario}"
        );
    }
}

fn failures_plugin() -> Plugin {
    Plugin::new("@fixture/failures").views([
        override_view(
            failure::<InputError>(),
            loomcli_core::FailureView::new(|failure: &InputError, _| {
                format!(
                    "plugin input: {}\n",
                    loomcli_core::FailureFacts::message(failure)
                )
            }),
        ),
        override_view(
            failure::<FatalError>(),
            loomcli_core::FailureView::new(|failure: &FatalError, _| {
                format!(
                    "plugin fatal: {}\n",
                    loomcli_core::FailureFacts::message(failure)
                )
            }),
        ),
    ])
}

/// The fixture's `get`, which stops with `out.fatal` when asked.
fn fixture_app(application: Application<NoInputs, NoResult, loomcli_core::Fresh>) -> App {
    let get = Command::new("get")
        .argument("path", Arg::string().required())
        .action(|ctx: Context| async move {
            if ctx.host.env.contains_key("LOOM_FIXTURE_ACTION") {
                return Err(ctx.out.fatal("the action stopped the invocation"));
            }
            ctx.out.print("got").await
        });
    application.command(get).action(dispatch)
}

#[tokio::test]
async fn a_plugins_failure_views_answer_the_classes_the_application_leaves_to_them() {
    let application = fixture_app(Application::new("app").plugins([failures_plugin()]));
    assert_eq!(
        ran(&application, &["get"], Build::Distributed).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr:
                "plugin input: Argument \"path\" requires a value. Supply a value for \"path\".\n"
                    .to_owned(),
        }
    );
    let fatal = run_with(
        &application,
        MockFields::new()
            .argv(["get", "a.b"])
            .env("LOOM_FIXTURE_ACTION", "fatal")
            .release(ReleaseFacts::new(Build::Distributed)),
    )
    .await;
    assert_eq!(
        fatal,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "plugin fatal: the action stopped the invocation\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn one_class_overridden_by_the_application_and_a_plugin_resolves_first_in_wins() {
    let application = fixture_app(
        Application::new("app")
            .plugins([failures_plugin()])
            .overrides([override_view(
                failure::<InputError>(),
                loomcli_core::FailureView::new(|failure: &InputError, _| {
                    format!(
                        "app input: {}\n",
                        loomcli_core::FailureFacts::message(failure)
                    )
                }),
            )]),
    );
    assert_eq!(
        ran(&application, &["get"], Build::Distributed).await.stderr,
        "app input: Argument \"path\" requires a value. Supply a value for \"path\".\n"
    );
    // The plugin still answers the class the application left to it.
    let fatal = run_with(
        &application,
        MockFields::new()
            .argv(["get", "a.b"])
            .env("LOOM_FIXTURE_ACTION", "fatal"),
    )
    .await;
    assert_eq!(
        fatal.stderr,
        "plugin fatal: the action stopped the invocation\n"
    );
    assert_eq!(fatal.status, 1);
}

#[test]
fn a_hook_declares_an_option_after_the_action_which_the_closures_do_not_close() {
    let application = Application::new("app")
        .plugins([formatter(declares_format)])
        .command(Command::new("count").action(dispatch))
        .action(dispatch);
    let graph = application.inspect().unwrap();
    let count = graph.command(&["count"]).unwrap();
    assert_eq!(count.options[0].name(), "format");
}

#[tokio::test]
async fn an_alias_of_an_option_a_hook_declares_binds_that_option() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let application = Application::new("app")
        .plugins([on_count("@acme/format", |command| {
            command.option("shape", Opt::string().aliases(["form"]))?;
            Ok(())
        })])
        .command(Command::new("count").action({
            let received = Arc::clone(&received);
            move |ctx: Context| {
                let received = Arc::clone(&received);
                async move {
                    received
                        .lock()
                        .unwrap()
                        .push(ctx.option::<Option<String>>("shape")?);
                    Ok(())
                }
            }
        }));
    let ran = run_with(
        &application,
        MockFields::new().argv(["count", "--form", "round"]),
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(*received.lock().unwrap(), vec![Some("round".to_owned())]);
}

#[tokio::test]
async fn a_plugin_that_declares_nothing_installs_and_costs_the_invocation_nothing() {
    let application = Application::new("app")
        .plugins([Plugin::new("@loomcli/help")])
        .action(dispatch);
    assert!(application.inspect().is_ok());
    assert_eq!(
        ran(&application, &[], Build::Distributed).await,
        Ran {
            status: 0,
            stdout: "dispatched\n".to_owned(),
            stderr: String::new(),
        }
    );
}

// plugin-diagnostics.test.ts: each fault by the rule, sentence, and correction its diagnostic pins.

/// The rule and the text of the diagnostic a faulty call panics with.
fn panicked(declare: impl FnOnce()) -> (String, String) {
    let message = panic_message(declare);
    let rule = panic_rule(&message);
    let paragraphs: Vec<String> = message
        .split("\n\n")
        .map(|paragraph| {
            paragraph
                .lines()
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();
    (
        rule,
        format!("{} {}", paragraphs[1], paragraphs.last().unwrap()),
    )
}

#[test]
fn an_attach_hook_that_fails_reports_broken_attach_hook_with_its_reason_on_one_line() {
    let fault = Application::new("probe")
        .plugins([Plugin::new("@acme/format").on_command_attach(|command| {
            if command.name() == Some("count") {
                return Err(Error::from_foreign("No format\nfor this Command".into()));
            }
            Ok(())
        })])
        .command(named("count"))
        .inspect()
        .unwrap_err();
    assert_eq!(rule_name(&fault), "broken-attach-hook");
    assert_eq!(
        fault.sentence(),
        "Plugin \"@acme/format\" failed in onCommandAttach for Command \"count\": No format\\u000afor this Command."
    );
    assert!(loomcli_core::FailureFacts::cause(&fault).is_some());
}

#[test]
fn two_encoders_for_one_media_type_in_one_plugin_fault_at_its_call() {
    let line = |_: &loomcli_core::FailureForm| String::from("line\n");
    assert_eq!(
        panicked(|| {
            let _ = Plugin::new("@acme/json").failure_encoders([
                encode_failure("application/json", line),
                encode_failure("application/json", line),
            ]);
        }),
        (
            "failure-encoder-taken".to_owned(),
            "Plugin \"@acme/json\" registers two failure encoders for \"application/json\". Register one."
                .to_owned()
        )
    );
}

#[test]
fn two_plugins_that_encode_one_media_type_fault_at_installation() {
    let line = |_: &loomcli_core::FailureForm| String::from("line\n");
    assert_eq!(
        panicked(|| {
            let _ = Application::new("probe").plugins([
                Plugin::new("@acme/json").failure_encoders([encode_failure("application/json", line)]),
                Plugin::new("@acme/wire").failure_encoders([encode_failure("application/json", line)]),
            ]);
        }),
        (
            "failure-encoder-taken".to_owned(),
            "Plugin \"@acme/wire\" registers a failure encoder for \"application/json\", which plugin \"@acme/json\" already registers. Install one of them."
                .to_owned()
        )
    );
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Notes {
    notes: String,
}

#[test]
fn two_descriptors_under_one_identity_in_a_plugins_list_fault_at_its_call() {
    const NOTES: Extension<loomcli_core::CommandTarget, Notes> =
        Extension::new("@acme/notes/command");
    const OTHER_NOTES: Extension<loomcli_core::CommandTarget, Details> =
        Extension::new("@acme/notes/command");
    assert_eq!(
        panicked(|| {
            let _ = Plugin::new("@acme/notes").extensions((NOTES, OTHER_NOTES));
        }),
        (
            "two-package-copies".to_owned(),
            "Extension \"@acme/notes/command\" is defined twice. Install one copy of the package that defines it."
                .to_owned()
        )
    );
}

#[test]
fn a_graph_hook_that_fails_reports_broken_graph_hook_with_its_reason_on_one_line() {
    let fault = Application::new("probe")
        .plugins([Plugin::new("@acme/mcp").on_graph_built(|_| {
            Err(Error::from_foreign(
                "Two tools share\nthe name \"scratch_create\"".into(),
            ))
        })])
        .action(dispatch)
        .inspect()
        .unwrap_err();
    assert_eq!(rule_name(&fault), "broken-graph-hook");
    assert_eq!(
        rule_text(&fault),
        "Plugin \"@acme/mcp\" failed in onGraphBuilt: Two tools share\\u000athe name \"scratch_create\". Return Ok(()) from on_graph_built, and return a DeclarationError as its Err only to reject the graph."
    );
}

#[test]
fn a_hook_options_alias_or_short_spelling_another_option_uses_is_spelling_taken() {
    let alias = Application::new("probe")
        .plugins([on_count("@acme/format", |command| {
            command.option("shape", Opt::string().aliases(["file"]))?;
            Ok(())
        })])
        .command(
            Command::new("count")
                .option("file", Opt::string())
                .action(dispatch),
        )
        .inspect()
        .unwrap_err();
    assert_eq!(rule_name(&alias), "spelling-taken");
    assert_eq!(
        rule_text(&alias),
        "Plugin \"@acme/format\" declares option \"shape\" with spelling \"--file\" on Command \"count\", which \"--file\" already uses. Change one of the two spellings or omit the plugin."
    );
    let short = Application::new("probe")
        .plugins([on_count("@acme/format", |command| {
            command.option("shape", Opt::string().short('f'))?;
            Ok(())
        })])
        .command(
            Command::new("count")
                .option("file", Opt::string().short('f'))
                .action(dispatch),
        )
        .inspect()
        .unwrap_err();
    assert_eq!(
        rule_text(&short),
        "Plugin \"@acme/format\" declares option \"shape\" with spelling \"-f\" on Command \"count\", which \"--file\" already uses. Change one of the two spellings or omit the plugin."
    );
}

#[test]
fn a_hook_option_under_a_local_options_key_is_option_declared_twice() {
    let fault = Application::new("probe")
        .plugins([on_count("@acme/format", declares_format)])
        .command(
            Command::new("count")
                .option("format", Opt::boolean())
                .action(dispatch),
        )
        .inspect()
        .unwrap_err();
    assert_eq!(rule_name(&fault), "option-declared-twice");
    assert_eq!(
        rule_text(&fault),
        "Plugin \"@acme/format\" declares option \"format\" on Command \"count\", which is already declared as a local option. Rename the Command's option or omit the plugin."
    );
}

#[test]
fn a_second_theme_claim_is_slot_taken() {
    assert_eq!(
        panicked(|| {
            let _ = Application::new("probe").plugins([
                Plugin::new("@acme/copper")
                    .theme(ThemeMapping::new().entry("highlight", style().yellow())),
                Plugin::new("@acme/slate")
                    .theme(ThemeMapping::new().entry("highlight", style().blue())),
            ]);
        }),
        (
            "slot-taken".to_owned(),
            "Plugin \"@acme/slate\" claims the theme slot, which plugin \"@acme/copper\" already holds. Install one owner."
                .to_owned()
        )
    );
}

#[test]
fn a_second_configuration_source_is_slot_taken() {
    const KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/key");
    let source = || {
        ConfigurationSource::new(&KEY, |_: loomcli_core::SourceContext<NoInputs>| async {
            Ok(std::collections::BTreeMap::new())
        })
    };
    assert_eq!(
        panicked(|| {
            let _ = Application::new("probe").plugins([
                Plugin::new("@acme/one").source(source()),
                Plugin::new("@acme/two").source(source()),
            ]);
        }),
        (
            "slot-taken".to_owned(),
            "Plugin \"@acme/two\" declares a configuration source, which plugin \"@acme/one\" already declares. Install one source."
                .to_owned()
        )
    );
}

#[test]
fn two_view_types_under_one_identity_in_a_plugins_views_are_two_package_copies() {
    assert_eq!(
        panicked(|| {
            let _ = Plugin::new("@acme/brand").views((
                view("@acme/page", View::new(|text: &String, _| text.clone())),
                view("@acme/page", View::new(|count: &u32, _| count.to_string())),
            ));
        }),
        (
            "two-package-copies".to_owned(),
            "View \"@acme/page\" is declared by two distinct objects. Install one copy of the package that declares it."
                .to_owned()
        )
    );
}

#[test]
fn an_application_override_listed_before_plugins_meets_a_plugins_view_of_another_type() {
    assert_eq!(
        panicked(|| {
            let _ = Application::new("probe")
                .overrides([override_view(
                    view("@acme/page", View::new(|text: &String, _| text.clone())),
                    View::new(|text: &String, _| text.clone()),
                )])
                .plugins([Plugin::new("@acme/brand").views((view(
                    "@acme/page",
                    View::new(|count: &u32, _| count.to_string()),
                ),))]);
        }),
        (
            "two-package-copies".to_owned(),
            "View \"@acme/page\" is declared by two distinct objects. Install one copy of the package that declares it."
                .to_owned()
        )
    );
}

#[test]
fn a_plugin_installed_twice_reports_plugin_installed_twice() {
    assert_eq!(
        panicked(|| {
            let _ = Application::new("probe")
                .plugins([Plugin::new("@acme/log"), Plugin::new("@acme/log")]);
        })
        .0,
        "plugin-installed-twice"
    );
}

// The Rust-only plugin-option-name rule.

#[test]
fn a_setting_or_an_activation_that_names_an_undeclared_option_faults_at_its_call() {
    assert_eq!(
        panicked(|| {
            let _ = Plugin::new("@acme/format").short("format", 'f');
        }),
        (
            "plugin-option-name".to_owned(),
            "Plugin \"@acme/format\" sets a short spelling on option \"format\", which the plugin does not declare. Declare the option on the plugin before the call that names it."
                .to_owned()
        )
    );
    assert_eq!(
        panicked(|| {
            let _ = Plugin::new("@acme/format").env("format", ["ACME_FORMAT"]);
        })
        .0,
        "plugin-option-name"
    );
    assert_eq!(
        panicked(|| {
            let _ = Plugin::new("@acme/explain").middleware(
                Activation::options(["explain"]),
                |_: loomcli_core::MiddlewareContext<NoInputs>, _next| async { Ok(()) },
            );
        }),
        (
            "plugin-option-name".to_owned(),
            "Plugin \"@acme/explain\" activates its middleware on option \"explain\", which the plugin does not declare. Declare the option on the plugin before the call that names it."
                .to_owned()
        )
    );
}

// The Rust-only handler-registered-twice rule.

#[test]
fn a_second_registration_of_a_hook_or_the_middleware_faults_at_its_call() {
    assert_eq!(
        panicked(|| {
            let _ = Plugin::new("@acme/tags")
                .on_command_attach(|_| Ok(()))
                .on_command_attach(|_| Ok(()));
        }),
        (
            "handler-registered-twice".to_owned(),
            "Plugin \"@acme/tags\" registers on_command_attach twice. Register it once, and do every concern's work in that one handler."
                .to_owned()
        )
    );
    let twice = [
        panicked(|| {
            let _ = Plugin::new("@acme/x")
                .on_graph_built(|_| Ok(()))
                .on_graph_built(|_| Ok(()));
        }),
        panicked(|| {
            let _ = Plugin::new("@acme/x")
                .on_failure(|_, _| ())
                .on_failure(|_, _| ());
        }),
        panicked(|| {
            let _ = Plugin::new("@acme/x").on_log(|_, _| ()).on_log(|_, _| ());
        }),
        panicked(|| {
            let _ = Plugin::new("@acme/x")
                .on_environment(|_| async { Ok(std::collections::BTreeMap::new()) })
                .on_environment(|_| async { Ok(std::collections::BTreeMap::new()) });
        }),
        panicked(|| {
            let _ = Plugin::new("@acme/x")
                .middleware(
                    Activation::Always,
                    |_: loomcli_core::MiddlewareContext<NoInputs>, _next| async { Ok(()) },
                )
                .middleware(
                    Activation::Always,
                    |_: loomcli_core::MiddlewareContext<NoInputs>, _next| async { Ok(()) },
                );
        }),
    ];
    let sentences: Vec<&str> = twice
        .iter()
        .map(|(rule, text)| {
            assert_eq!(rule, "handler-registered-twice");
            text.split(" twice.").next().unwrap()
        })
        .collect();
    assert_eq!(
        sentences,
        [
            "Plugin \"@acme/x\" registers on_graph_built",
            "Plugin \"@acme/x\" registers on_failure",
            "Plugin \"@acme/x\" registers on_log",
            "Plugin \"@acme/x\" registers on_environment",
            "Plugin \"@acme/x\" registers middleware",
        ]
    );
}

#[test]
fn a_setting_adjusts_the_option_and_meets_the_declaring_calls_rules() {
    let application = Application::new("app")
        .plugins([Plugin::new("@acme/format")
            .option("format", Opt::string())
            .short("format", 'o')
            .env("format", ["ACME_FORMAT"])])
        .action(dispatch);
    let graph = application.inspect().unwrap();
    let format = &graph.globals[0];
    assert_eq!(format.short(), Some("-o"));
    assert_eq!(
        serde_json::to_value(&**format).unwrap()["env"],
        json!(["ACME_FORMAT"])
    );
    // A short spelling the color mark excludes is the declaring call's own fault.
    assert_eq!(
        panicked(|| {
            let _ = Plugin::new("@acme/color")
                .option("color", Opt::boolean().color())
                .short("color", 'c');
        })
        .0,
        "option-config"
    );
}

// plugin-commands.test.ts

/// A plugin that attaches `commands`.
fn attaching(identity: &str, commands: Vec<AnyCommand>) -> Plugin {
    Plugin::new(identity).commands(commands)
}

fn children<I, R, S: State>(application: &Application<I, R, S>) -> Vec<String> {
    application
        .inspect()
        .unwrap()
        .root
        .children
        .iter()
        .map(|child| child.name.clone().unwrap_or_default())
        .collect()
}

#[tokio::test]
async fn plugin_commands_attach_ahead_of_the_applications_and_route_like_any_other() {
    let application = Application::new("app")
        .plugins([
            attaching(
                "@acme/first",
                vec![named("alpha").into(), named("beta").into()],
            ),
            attaching("@acme/second", vec![named("gamma").into()]),
        ])
        .command(named("local"));
    assert_eq!(children(&application), ["alpha", "beta", "gamma", "local"]);
    assert_eq!(
        support::run(&application, &["gamma"]).await,
        Ran {
            status: 0,
            stdout: "ran:gamma\n".to_owned(),
            stderr: String::new(),
        }
    );
    assert_eq!(
        support::run(&application, &["local"]).await.stdout,
        "ran:local\n"
    );
}

/// A `doctor` Command that prints the hook-declared `quiet`.
fn quiet_doctor() -> Command {
    Command::new("doctor").action(|ctx: Context| async move {
        let quiet = ctx.option::<bool>("quiet")?;
        ctx.out.print(&format!("quiet:{quiet}")).await
    })
}

fn quiet_hook(command: &mut AttachedCommand) -> Result<(), Error> {
    if command.name() == Some("doctor") {
        command.option("quiet", Opt::boolean())?;
    }
    Ok(())
}

#[tokio::test]
async fn a_lifecycle_hook_runs_over_a_plugin_command_its_own_plugins_included() {
    let hooked = Application::new("app")
        .plugins([
            Plugin::new("@acme/quiet").on_command_attach(quiet_hook),
            attaching("@acme/doctor", vec![quiet_doctor().into()]),
        ])
        .command(named("local"));
    assert_eq!(
        support::run(&hooked, &["doctor", "--quiet"]).await.stdout,
        "quiet:true\n"
    );
    let own = Application::new("app")
        .plugins([Plugin::new("@acme/doctor")
            .commands([quiet_doctor()])
            .on_command_attach(quiet_hook)])
        .command(named("local"));
    assert_eq!(
        support::run(&own, &["doctor", "--quiet"]).await.stdout,
        "quiet:true\n"
    );
}

#[tokio::test]
async fn routing_descends_into_the_children_of_a_group_a_plugin_attaches() {
    let application = Application::new("app")
        .plugins([
            Plugin::new("@acme/tools").commands([Command::new("tools").command(named("clear"))])
        ])
        .command(named("local"));
    assert_eq!(
        support::run(&application, &["tools", "clear"]).await,
        Ran {
            status: 0,
            stdout: "ran:clear\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[test]
fn every_command_rule_rejects_a_plugin_command_where_the_root_attaches_it() {
    let doctor = || attaching("@acme/doctor", vec![named("doctor").into()]);
    let twins = "The root Command attaches two children named \"doctor\". Rename or remove one.";
    assert_eq!(
        thrown(|| {
            let _ = Application::new("app")
                .plugins([doctor()])
                .command(named("doctor"));
        }),
        twins
    );
    assert_eq!(
        thrown(|| {
            let _ = Application::new("app").plugins([
                doctor(),
                attaching("@acme/clinic", vec![named("doctor").into()]),
            ]);
        }),
        twins
    );
    assert_eq!(
        thrown(|| {
            let _ = Application::new("app")
                .plugins([doctor()])
                .command(Command::new("check").alias("doctor").action(dispatch));
        }),
        "The root Command attaches child \"check\" with alias \"doctor\", which is also the name of child \"doctor\". Rename or remove one."
    );
    assert_eq!(
        thrown(|| {
            let _ = Application::new("app")
                .plugins([attaching(
                    "@acme/doctor",
                    vec![
                        Command::new("doctor")
                            .option("quiet", Opt::boolean())
                            .action(dispatch)
                            .into(),
                    ],
                )])
                .global_option("quiet", Opt::boolean());
        }),
        "Option \"quiet\" is declared as a global option and as a local option on Command \"doctor\". Rename the local option."
    );
    let root = Application::new("app")
        .plugins([doctor()])
        .argument("files", Arg::string().variadic())
        .action(dispatch);
    assert_eq!(children(&root), ["doctor"]);
    assert_eq!(
        thrown(|| {
            let _ = attaching("@acme/doctor", vec![Command::new("doctor").into()]);
        }),
        "Command \"doctor\" has no action. Register an action."
    );
    assert_eq!(
        thrown(|| {
            let _ = attaching(
                "@acme/doctor",
                vec![named("doctor").into(), named("doctor").into()],
            );
        }),
        twins
    );
}

#[test]
fn the_plugins_commands_leave_global_option_open() {
    let application = Application::new("app")
        .plugins([attaching("@acme/doctor", vec![named("doctor").into()])])
        .global_option("file", Opt::string())
        .command(named("local"));
    assert_eq!(children(&application), ["doctor", "local"]);
}

// plugin-options.test.ts: the parts no middleware reads.

/// The fixture's settings plugin: four options of every kind a plugin declares.
fn settings() -> Plugin {
    Plugin::new("@fixture/settings")
        .option(
            "cache",
            Opt::boolean().polarity(loomcli_core::Polarity::Both),
        )
        .option("mode", Opt::string().default("plain").short('m'))
        .option("quiet", Opt::boolean().short('q'))
        .option("tags", Opt::string().default(["one"]).multiple())
}

/// The fixture's application: a global `file`, `get <path>` with a local `raw`, and a group.
fn options_app(plugins: Vec<Plugin>) -> App {
    let get = Command::new("get")
        .argument("path", Arg::string().required())
        .option("raw", Opt::boolean())
        .action(|ctx: Context| async move {
            let values = support::values_json(&ctx);
            let path = values["args"]["path"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            ctx.out
                .print(&format!("get:{path}:{}", values["options"]))
                .await
        });
    Application::new("app")
        .plugins(plugins)
        .global_option("file", Opt::string().short('f'))
        .command(get)
        .command(Command::new("cache").command(named("clear")))
        .action(dispatch)
}

/// The fixture's level plugin: a validated option with a short spelling and a variable.
fn level() -> Plugin {
    Plugin::new("@fixture/level").option(
        "level",
        Opt::string()
            .short('l')
            .env(["FIXTURE_LEVEL"])
            .validate(support::validators::OneOfUpper(
                &["debug", "info", "warn"],
                "Use debug, info, or warn.",
            )),
    )
}

const DEFAULTS: &str = r#""cache":false,"mode":"plain","quiet":false,"tags":["one"]"#;

#[tokio::test]
async fn a_plugins_option_values_reach_every_action_at_any_placement() {
    let application = options_app(vec![settings()]);
    assert_eq!(
        support::run(&application, &["get", "a.b"]).await,
        Ran {
            status: 0,
            stdout: format!("get:a.b:{{{DEFAULTS},\"raw\":false}}\n"),
            stderr: String::new(),
        }
    );
    let values = r#""cache":false,"mode":"fancy","quiet":true,"tags":["a","b"]"#;
    assert_eq!(
        support::run(
            &application,
            &[
                "-q", "--mode", "fancy", "--tags", "a", "--tags", "b", "get", "a.b"
            ]
        )
        .await
        .stdout,
        format!("get:a.b:{{{values},\"raw\":false}}\n")
    );
    let placed = r#""cache":false,"mode":"fancy","quiet":false,"tags":["one"]"#;
    assert_eq!(
        support::run(&application, &["get", "a.b", "--mode", "fancy"])
            .await
            .stdout,
        format!("get:a.b:{{{placed},\"raw\":false}}\n")
    );
}

#[tokio::test]
async fn a_declared_default_reaches_each_run_afresh() {
    let application = options_app(vec![settings()]);
    let values = r#""cache":false,"mode":"plain","quiet":true,"tags":["one"]"#;
    for _ in 0..2 {
        assert_eq!(
            support::run(&application, &["-q", "get", "a.b"])
                .await
                .stdout,
            format!("get:a.b:{{{values},\"raw\":false}}\n")
        );
    }
}

#[tokio::test]
async fn a_plugins_validated_option_reaches_the_action_as_its_validators_output() {
    let application = options_app(vec![settings(), level()]);
    let values = r#""cache":false,"mode":"plain","quiet":true,"tags":["one"],"level":"INFO""#;
    assert_eq!(
        support::run(&application, &["-q", "--level", "info", "get", "a.b"])
            .await
            .stdout,
        format!("get:a.b:{{{values},\"raw\":false}}\n")
    );
}

#[tokio::test]
async fn a_value_a_plugins_validator_rejects_is_an_input_problem_aggregated_globals_first() {
    let application = options_app(vec![settings(), level()]);
    assert_eq!(
        support::run(&application, &["--level", "loud", "get", "a.b"]).await,
        support::usage("app: Option \"--level\": Use debug, info, or warn.")
    );
    assert_eq!(
        support::run(&application, &["-l", "loud", "get"]).await,
        support::usage(
            "app: Option \"--level\": Use debug, info, or warn.\napp: Argument \"path\" requires a value. Supply a value for \"path\"."
        )
    );
    let from_env = run_with(
        &application,
        support::fields(&["get", "a.b"], &[("FIXTURE_LEVEL", "loud")]),
    )
    .await;
    assert_eq!(
        from_env,
        support::usage("app: Option \"--level\" (from FIXTURE_LEVEL): Use debug, info, or warn.")
    );
    let warn = run_with(
        &application,
        support::fields(&["get", "a.b"], &[("FIXTURE_LEVEL", "warn")]),
    )
    .await;
    assert!(warn.stdout.contains(r#""level":"WARN""#), "{warn:?}");
}

#[tokio::test]
async fn a_structural_fault_in_a_plugins_option_is_held_like_any_global_options() {
    let application = options_app(vec![settings()]);
    assert_eq!(
        support::run(&application, &["--mode"]).await,
        support::usage("app: Option \"--mode\" requires a value. Supply a value after \"--mode\".")
    );
    assert_eq!(
        support::run(&application, &["-q", "get", "a.b", "-q"]).await,
        support::usage("app: Option \"-q\" can be supplied only once. Remove the repeated option.")
    );
}

#[tokio::test]
async fn a_plugins_letters_read_in_a_short_group_under_the_getopt_rule() {
    let application = options_app(vec![settings()]);
    let values = r#""cache":false,"mode":"fancy","quiet":true,"tags":["one"]"#;
    assert_eq!(
        support::run(&application, &["-qmfancy", "get", "a.b"])
            .await
            .stdout,
        format!("get:a.b:{{{values},\"raw\":false}}\n")
    );
    assert_eq!(
        support::run(&application, &["-Zq", "get", "a.b"]).await,
        support::usage(
            "app: Unknown option \"-Z\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
}

#[test]
fn inspect_lists_each_plugins_options_after_the_applications_with_the_nodes_a_global_publishes() {
    let graph = options_app(vec![settings(), level()]).inspect().unwrap();
    let names: Vec<&str> = graph.globals.iter().map(|option| option.name()).collect();
    assert_eq!(names, ["file", "cache", "mode", "quiet", "tags", "level"]);
    assert_eq!(
        serde_json::to_string(&*graph.globals[2]).unwrap(),
        r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--mode","name":"mode","short":"-m","default":{"value":"plain"},"envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"}"#
    );
    assert_eq!(
        serde_json::to_string(&*graph.globals[1]).unwrap(),
        r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--cache","name":"cache","short":null,"color":false,"interaction":false,"negative":"--no-cache","polarity":"both","schema":null,"type":"boolean"}"#
    );
    let level = serde_json::to_value(&*graph.globals[5]).unwrap();
    assert_eq!(level["env"], json!(["FIXTURE_LEVEL"]));
    assert_eq!(level["long"], json!("--level"));
    assert_eq!(level["short"], json!("-l"));
    assert_eq!(level["validated"], json!(true));
}

#[tokio::test]
async fn a_typed_options_struct_declares_the_plugins_options() {
    #[derive(loomcli_core::Inputs)]
    struct ExplainOptions {
        /// Explain the selected command and exit.
        #[option(short = 'e', control)]
        explain: bool,
    }
    let application = Application::new("app")
        .plugins([Plugin::new("@loom/explain").options::<ExplainOptions>()])
        .action(|ctx: Context| async move {
            let explain = ctx.option::<bool>("explain")?;
            ctx.out.print(&format!("explain:{explain}")).await
        });
    let graph = application.inspect().unwrap();
    assert_eq!(graph.globals[0].name(), "explain");
    assert_eq!(graph.globals[0].short(), Some("-e"));
    assert_eq!(
        support::run(&application, &["-e"]).await.stdout,
        "explain:true\n"
    );
}

// configuration-schema.test.ts

const CONFIG_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/config/key");

fn source_plugin(schema: Option<serde_json::Map<String, serde_json::Value>>) -> Plugin {
    let source = ConfigurationSource::new(
        &CONFIG_KEY,
        |_: loomcli_core::SourceContext<NoInputs>| async { Ok(std::collections::BTreeMap::new()) },
    );
    let source = match schema {
        Some(schema) => source.schema(Some(schema)),
        None => source,
    };
    Plugin::new("@fixture/config")
        .extensions([CONFIG_KEY])
        .source(source)
}

#[test]
fn the_graph_reads_configuration_null_when_no_plugin_claims_the_source_slot() {
    let none = Application::new("app").action(dispatch).inspect().unwrap();
    assert_eq!(
        serde_json::to_value(&none).unwrap()["configuration"],
        json!(null)
    );
    let other = Application::new("app")
        .plugins([Plugin::new("@fixture/other")])
        .action(dispatch)
        .inspect()
        .unwrap();
    assert_eq!(
        serde_json::to_value(&other).unwrap()["configuration"],
        json!(null)
    );
}

#[test]
fn a_sources_schema_publishes_on_the_configuration_fact() {
    let schema = json!({
        "properties": { "retries": { "type": "integer" }, "title": { "type": "string" } },
        "type": "object"
    });
    let graph = Application::new("app")
        .plugins([source_plugin(schema.as_object().cloned())])
        .action(dispatch)
        .inspect()
        .unwrap();
    assert_eq!(
        serde_json::to_value(&graph).unwrap()["configuration"],
        json!({ "schema": schema })
    );
}

#[test]
fn a_source_with_no_schema_reads_schema_null() {
    let graph = Application::new("app")
        .plugins([source_plugin(None)])
        .action(dispatch)
        .inspect()
        .unwrap();
    assert_eq!(
        serde_json::to_value(&graph).unwrap()["configuration"],
        json!({ "schema": null })
    );
}

#[tokio::test]
async fn a_graph_hook_reads_the_configuration_fact_of_a_run() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("@fixture/observer").on_graph_built({
        let seen = Arc::clone(&seen);
        move |graph| {
            seen.lock()
                .unwrap()
                .push(serde_json::to_value(&graph.configuration).unwrap());
            Ok(())
        }
    });
    let application = Application::new("app")
        .plugins([source_plugin(None), observer])
        .action(dispatch);
    let ran = ran(&application, &[], Build::Distributed).await;
    assert_eq!(ran.status, 0);
    assert_eq!(*seen.lock().unwrap(), vec![json!({ "schema": null })]);
}
