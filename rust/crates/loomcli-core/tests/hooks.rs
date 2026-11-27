//! The lifecycle hooks: `on_command_attach` and `on_graph_built` at graph build, the values hooks
//! add to collecting extensions, `on_environment` before validation, `on_log` delivery, and the
//! theme slot.
//!
//! Ported from the reference's `attach.test.ts`, `graph-built.test.ts`,
//! `collecting-extensions.test.ts` (hook part), `environment-hooks.test.ts`,
//! `observing-log-events.test.ts` (plugin delivery), `own-options.test.ts` (declaration part), and
//! `theme-preparation.test.ts`, with the middleware reads, `app.invoke`, and an action's `invoke`
//! those files reach, and `forged-values.test.ts` through a hook's calls.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Arg, AttachedCommand, AttachedViews, Build, Command, CommandTarget, Context,
    DeclarationError, DiagnosticParts, DiagnosticRule, EX_CONFIG, Error, Extension, FatalError,
    Issue, LogDestination, LogEvent, NoInputs, Opt, Plugin, ReleaseFacts, RenderingPolicy,
    ResultViews, State, Switch, ThemeMapping, ValidationContext, Validator, ValueResult, View,
    diagnostic_rule, failure, override_view, read_extension, style,
};
use loomcli_testing::MockFields;
use serde_json::{Value, json};
use support::faults::rule_text;
use support::{Ran, run_with};

type Notes = Arc<Mutex<Vec<Value>>>;

fn noted(notes: &Notes) -> Vec<Value> {
    notes.lock().unwrap().clone()
}

async fn printing(ctx: Context, text: &'static str) -> loomcli_core::Outcome {
    ctx.out.print(text).await
}

fn named(name: &'static str) -> Command {
    Command::new(name).action(move |ctx: Context| printing(ctx, name))
}

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

// attach.test.ts

/// `count`, whose result renders the JSON of the options it received through the views given.
fn counted(views: ResultViews<String>) -> Command<NoInputs, ValueResult<String>> {
    Command::new("count").result(views).action(
        |ctx: Context<NoInputs, ValueResult<String>>| async move {
            let options = support::values_json(&ctx)["options"].to_string();
            ctx.out.results(options).await
        },
    )
}

fn prefixed(prefix: &'static str) -> View<String> {
    View::new(move |value: &String, _| format!("{prefix}:{value}\n"))
}

/// A hook-added view over the result's JSON data.
fn json_view(prefix: &'static str) -> View<Value> {
    View::new(move |value: &Value, _| format!("{prefix}:{}\n", value.as_str().unwrap_or_default()))
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

fn facts(command: &AttachedCommand) -> Value {
    json!({
        "arguments": command.arguments(),
        "hasAction": command.has_action(),
        "name": command.name(),
        "options": command.options(),
        "path": command.path(),
        "result": command.result(),
    })
}

/// The plugin that reads the request: it prints the local options the routed request carries.
fn reader() -> Plugin {
    Plugin::new("@fixture/reader").middleware(
        loomcli_core::Activation::Always,
        |ctx, next: loomcli_core::Next| async move {
            let mut options = serde_json::Map::new();
            if let Some(request) = &ctx.request {
                for node in &ctx.command.options {
                    if let Ok(Some(value)) = request.values.option::<Option<String>>(node.name()) {
                        options.insert(node.name().to_owned(), json!(value));
                    }
                }
            }
            ctx.out
                .print(&format!("request:{}", Value::Object(options)))
                .await?;
            next.run().await.map(|_| ())
        },
    )
}

#[tokio::test]
async fn a_hook_declares_an_option_the_action_reads_the_request_carries_and_inspect_publishes() {
    let application = Application::new("app")
        .plugins([
            reader(),
            on_count("@loomcli/plugins/format", |command| {
                command.option(
                    "format",
                    Opt::string().description("Select the output format."),
                )?;
                Ok(())
            }),
        ])
        .command(counted(ResultViews::new().view("text", prefixed("text"))))
        .action(|ctx: Context| printing(ctx, "root"));
    let ran = support::run(&application, &["count", "--format", "json"]).await;
    assert_eq!(ran.stderr, "");
    assert_eq!(
        ran.stdout,
        "request:{\"format\":\"json\"}\ntext:{\"format\":\"json\"}\n"
    );
    let graph = application.inspect().unwrap();
    let count = graph.command(&["count"]).unwrap();
    let options: Vec<&str> = count.options.iter().map(|option| option.name()).collect();
    assert_eq!(options, ["format"]);
    assert_eq!(
        serde_json::to_value(&count.result).unwrap(),
        json!({ "default": "text", "kind": "value", "mediaTypes": { "text": null }, "views": ["text"] })
    );
}

#[tokio::test]
async fn the_root_arrives_through_the_same_surface_where_option_declares_a_root_local_option() {
    let notes: Notes = Arc::default();
    let application = Application::new("app")
        .plugins([Plugin::new("@loomcli/plugins/format").on_command_attach({
            let notes = Arc::clone(&notes);
            move |command| {
                if command.name().is_some() {
                    return Ok(());
                }
                notes
                    .lock()
                    .unwrap()
                    .push(json!({ "name": command.name(), "path": command.path() }));
                command.option("quiet", Opt::boolean())?;
                Ok(())
            }
        })])
        .command(counted(ResultViews::new().view("text", prefixed("text"))))
        .action(|ctx: Context| async move {
            let options = support::values_json(&ctx)["options"].to_string();
            ctx.out.print(&format!("root:{options}")).await
        });
    let ran = support::run(&application, &["--quiet"]).await;
    assert_eq!(ran.stderr, "");
    assert_eq!(ran.stdout, "root:{\"quiet\":true}\n");
    assert_eq!(noted(&notes), [json!({ "name": null, "path": [] })]);
}

/// The groups probe: a hook on the root declares `first` and `second`, then hands both to `group`.
fn group_hook<G>(group: G) -> Application
where
    G: Fn(&mut AttachedCommand) -> Result<(), Error> + Send + Sync + 'static,
{
    Application::new("groups")
        .description("Groups probe.")
        .plugins([
            Plugin::new("@fixture/group-hook").on_command_attach(move |command| {
                if command.name().is_some() {
                    return Ok(());
                }
                command
                    .option("first", Opt::boolean().description("First choice."))?
                    .option("second", Opt::boolean().description("Second choice."))?;
                group(command)
            }),
        ])
        .action(|ctx: Context| printing(ctx, "ran"))
}

#[tokio::test]
async fn a_hook_groups_its_declared_local_options_after_action_registration() {
    let application = group_hook(|command| {
        command.exclusive(&["first", "second"])?;
        Ok(())
    });
    assert_eq!(
        support::run(&application, &["--first", "--second"]).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "groups: Options \"--first\" and \"--second\" cannot be used together. \
                     Supply only one of them.\n"
                .to_owned(),
        }
    );
    assert_eq!(
        support::run(&application, &["--first"]).await.stdout,
        "ran\n"
    );
    let graph = application.inspect().unwrap();
    assert_eq!(
        serde_json::to_value(&graph.root.option_groups).unwrap(),
        json!([{ "kind": "exclusive", "options": ["first", "second"] }])
    );
    let together = group_hook(|command| {
        command.required_together(&["first", "second"])?;
        Ok(())
    });
    assert_eq!(support::run(&together, &["--first"]).await.status, 2);
    let one = group_hook(|command| {
        command.one_required(&["first", "second"])?;
        Ok(())
    });
    assert_eq!(support::run(&one, &[]).await.status, 2);
    assert_eq!(support::run(&one, &["--second"]).await.status, 0);
}

#[tokio::test]
async fn a_hook_group_call_that_faults_returns_its_declaration_error_and_changes_nothing() {
    let caught: Notes = Arc::default();
    let application = group_hook({
        let caught = Arc::clone(&caught);
        move |command| {
            for names in [&["first"][..], &["first", "first"], &["first", "absent"]] {
                if let Err(fault) = command.exclusive(names) {
                    caught.lock().unwrap().push(json!(rule_text(&fault)));
                }
            }
            Ok(())
        }
    });
    assert_eq!(
        support::run(&application, &["--first", "--second"]).await,
        Ran {
            status: 0,
            stdout: "ran\n".to_owned(),
            stderr: String::new(),
        }
    );
    assert_eq!(
        noted(&caught),
        [
            json!(
                "The root Command declares exclusive with fewer than two options. Name at least two local options."
            ),
            json!("The root Command exclusive repeats option \"first\". Name each option once."),
            json!(
                "The root Command exclusive names undeclared local option \"absent\". Declare the local option before naming it in a group."
            ),
        ]
    );
    assert!(application.inspect().unwrap().root.option_groups.is_empty());
    let propagated = group_hook(|command| {
        command.one_required(&["first", "absent"])?;
        Ok(())
    });
    let ran = support::run(&propagated, &[]).await;
    assert_eq!(ran.status, 1);
    assert!(
        ran.stderr.contains("@loomcli/core/option-group"),
        "{}",
        ran.stderr
    );
}

#[tokio::test]
async fn a_hook_reads_each_commands_facts_root_first_then_each_child_depth_first() {
    let notes: Notes = Arc::default();
    let application = Application::new("app")
        .plugins([Plugin::new("@fixture/facts").on_command_attach({
            let notes = Arc::clone(&notes);
            move |command| {
                notes.lock().unwrap().push(facts(command));
                Ok(())
            }
        })])
        .command(counted(
            ResultViews::new()
                .view("json", prefixed("json"))
                .view("text", prefixed("text")),
        ))
        .command(
            Command::new("get")
                .argument("path", Arg::string().required())
                .option("raw", Opt::boolean())
                .action(|ctx: Context| printing(ctx, "get")),
        )
        .command(Command::new("cache").command(named("clear")))
        .action(|ctx: Context| printing(ctx, "root"));
    support::run(&application, &[]).await;
    let seen = noted(&notes);
    let paths: Vec<&Value> = seen.iter().map(|fact| &fact["path"]).collect();
    assert_eq!(
        paths,
        [
            &json!([]),
            &json!(["count"]),
            &json!(["get"]),
            &json!(["cache"]),
            &json!(["cache", "clear"])
        ]
    );
    support::assert_matches(
        &seen[0],
        &json!({ "hasAction": true, "name": null, "result": null }),
    );
    support::assert_matches(
        &seen[1],
        &json!({
            "hasAction": true,
            "name": "count",
            "result": {
                "default": "json",
                "kind": "value",
                "mediaTypes": { "json": null, "text": null },
                "views": ["json", "text"]
            }
        }),
    );
    support::assert_matches(
        &seen[2],
        &json!({ "arguments": ["path"], "name": "get", "options": ["raw"] }),
    );
    support::assert_matches(
        &seen[3],
        &json!({ "hasAction": false, "name": "cache", "result": null }),
    );
}

#[tokio::test]
async fn a_views_call_reshapes_the_result_the_same_hook_then_reads() {
    let notes: Notes = Arc::default();
    let application = Application::new("app")
        .plugins([on_count("@loomcli/plugins/format", {
            let notes = Arc::clone(&notes);
            move |command| {
                let before = command.result();
                command.views(
                    AttachedViews::new()
                        .view("json", json_view("json"))
                        .default_view("json"),
                )?;
                notes
                    .lock()
                    .unwrap()
                    .push(json!({ "after": command.result(), "before": before }));
                Ok(())
            }
        })])
        .command(counted(ResultViews::new().view("text", prefixed("text"))))
        .action(|ctx: Context| printing(ctx, "root"));
    let ran = support::run(&application, &["count"]).await;
    assert_eq!(ran.stdout, "json:{}\n");
    assert_eq!(
        serde_json::to_string(&noted(&notes)[0]).unwrap(),
        r#"{"after":{"default":"json","kind":"value","mediaTypes":{"text":null,"json":null},"views":["text","json"]},"before":{"default":"text","kind":"value","mediaTypes":{"text":null},"views":["text"]}}"#
    );
    let graph = application.inspect().unwrap();
    assert_eq!(
        serde_json::to_string(&graph.command(&["count"]).unwrap().result).unwrap(),
        r#"{"default":"json","kind":"value","mediaTypes":{"text":null,"json":null},"views":["text","json"]}"#
    );
}

#[tokio::test]
async fn two_plugins_hooks_run_in_installation_order_and_the_later_replaces_a_view_by_name() {
    let notes: Notes = Arc::default();
    let application = Application::new("app")
        .plugins([
            on_count("@acme/out", |command| {
                command.views(
                    AttachedViews::new()
                        .view("json", json_view("json"))
                        .default_view("json"),
                )?;
                Ok(())
            }),
            on_count("@loomcli/plugins/format", {
                let notes = Arc::clone(&notes);
                move |command| {
                    notes.lock().unwrap().push(json!({
                        "identity": "@loomcli/plugins/format",
                        "views": command.result().map(|result| result.views),
                    }));
                    command.views(AttachedViews::new().view("json", json_view("second")))?;
                    Ok(())
                }
            }),
        ])
        .command(counted(ResultViews::new().view("text", prefixed("text"))))
        .action(|ctx: Context| printing(ctx, "root"));
    assert_eq!(
        support::run(&application, &["count"]).await.stdout,
        "second:{}\n"
    );
    assert_eq!(
        noted(&notes),
        [json!({ "identity": "@loomcli/plugins/format", "views": ["text", "json"] })]
    );
}

// graph-built.test.ts

/// The paths of every Command in one graph, depth first, each joined by a space.
fn paths(node: &loomcli_core::CommandNode) -> Vec<String> {
    std::iter::once(node.path.join(" "))
        .chain(node.children.iter().flat_map(|child| paths(child)))
        .collect()
}

#[tokio::test]
async fn every_graph_hook_runs_once_per_build_in_installation_order_after_every_attach_hook() {
    let calls: Notes = Arc::default();
    let graphs: Arc<Mutex<Vec<usize>>> = Arc::default();
    let judge = |identity: &'static str| {
        let calls = Arc::clone(&calls);
        let graphs = Arc::clone(&graphs);
        Plugin::new(identity).on_graph_built(move |graph| {
            graphs
                .lock()
                .unwrap()
                .push(std::ptr::from_ref(graph) as usize);
            let options: Vec<String> = graph
                .command(&["count"])
                .map(|count| {
                    count
                        .options
                        .iter()
                        .map(|option| option.name().to_owned())
                        .collect()
                })
                .unwrap_or_default();
            calls.lock().unwrap().push(json!({
                "commands": paths(&graph.root),
                "identity": identity,
                "options": options,
            }));
            Ok(())
        })
    };
    let attaching = Plugin::new("@fixture/attach")
        .commands([named("doctor")])
        .on_command_attach(|command| {
            if command.name() == Some("count") {
                command.option("format", Opt::string())?;
            }
            Ok(())
        });
    let read_by_action: Arc<Mutex<usize>> = Arc::default();
    let application = Application::new("probe")
        .plugins([attaching, judge("@fixture/first"), judge("@fixture/second")])
        .command(Command::new("count").action({
            let read_by_action = Arc::clone(&read_by_action);
            move |ctx: Context| {
                let read_by_action = Arc::clone(&read_by_action);
                async move {
                    *read_by_action.lock().unwrap() = Arc::as_ptr(&ctx.graph) as usize;
                    Ok(())
                }
            }
        }));
    let ran = ran(&application, &["count"], Build::Distributed).await;
    assert_eq!(ran.status, 0);
    assert_eq!(calls.lock().unwrap().len(), 2);
    let action = *read_by_action.lock().unwrap();
    assert!(graphs.lock().unwrap().iter().all(|graph| *graph == action));
    let _ = application.inspect().unwrap();
    let calls = noted(&calls);
    assert_eq!(calls.len(), 4);
    assert_eq!(
        calls[..2],
        [
            json!({ "commands": ["", "doctor", "count"], "identity": "@fixture/first", "options": ["format"] }),
            json!({ "commands": ["", "doctor", "count"], "identity": "@fixture/second", "options": ["format"] }),
        ]
    );
}

#[tokio::test]
async fn both_forms_of_invoke_reuse_the_already_judged_graph() {
    let calls: Arc<Mutex<usize>> = Arc::default();
    let judge = |identity: &'static str| {
        let calls = Arc::clone(&calls);
        Plugin::new(identity).on_graph_built(move |_| {
            *calls.lock().unwrap() += 1;
            Ok(())
        })
    };
    let application = Application::new("probe")
        .plugins([judge("@fixture/first"), judge("@fixture/second")])
        .command(named("count"))
        .command(Command::new("caller").action(|ctx: Context| async move {
            let outcome = ctx
                .invoke(
                    &["count"],
                    loomcli_core::InvocationValues::new(),
                    loomcli_core::InvokeOptions::<Error>::new(),
                )
                .await;
            assert!(matches!(
                outcome,
                loomcli_core::InvocationOutcome::Completed { .. }
            ));
            Ok(())
        }));
    let count = || *calls.lock().unwrap();
    let process = loomcli_testing::mock_process(MockFields::new());
    let marks = [
        ran(&application, &["count"], Build::Distributed)
            .await
            .status,
        u8::try_from(count()).unwrap(),
    ];
    assert_eq!(marks, [0, 2], "run");
    let _ = application.inspect().unwrap();
    assert_eq!(count(), 4, "inspect");
    let outcome = application
        .invoke(
            &["count"],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<Error>::new(),
            Some(Arc::clone(&process) as _),
        )
        .await;
    assert!(matches!(
        outcome,
        loomcli_core::InvocationOutcome::Completed { .. }
    ));
    assert_eq!(count(), 4, "app.invoke");
    let outcome = application
        .invoke(
            &["caller"],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<Error>::new(),
            Some(Arc::clone(&process) as _),
        )
        .await;
    assert!(matches!(
        outcome,
        loomcli_core::InvocationOutcome::Completed { .. }
    ));
    assert_eq!(count(), 4, "app.invoke with an action invoke");
}

const REJECTING: DiagnosticRule = diagnostic_rule(
    "@fixture/judge/shared-name",
    "Two Commands share one description",
    "Each Command describes its own job.",
);

fn rejecting(seen: &Notes) -> Vec<Plugin> {
    let judge = Plugin::new("@fixture/judge")
        .on_failure({
            let seen = Arc::clone(seen);
            move |_, _| seen.lock().unwrap().push(json!("onFailure"))
        })
        .on_graph_built({
            let seen = Arc::clone(seen);
            move |_| {
                seen.lock().unwrap().push(json!("judge"));
                Err(DeclarationError::new(
                    REJECTING,
                    DiagnosticParts::new("Commands \"a\" and \"b\" share one description.")
                        .correction("Describe what each Command does in its own words."),
                )
                .into())
            }
        });
    let later = Plugin::new("@fixture/later").on_graph_built({
        let seen = Arc::clone(seen);
        move |_| {
            seen.lock().unwrap().push(json!("later"));
            Ok(())
        }
    });
    vec![judge, later]
}

#[tokio::test]
async fn a_graph_hooks_declaration_error_fails_run_stops_later_hooks_and_runs_no_failure_hook() {
    let seen: Notes = Arc::default();
    let application = Application::new("probe")
        .description("Probe the graph.")
        .plugins(rejecting(&seen))
        .action(|ctx: Context| printing(ctx, "action"));
    let distributed = ran(&application, &[], Build::Distributed).await;
    assert_eq!(
        distributed,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "probe: Something went wrong.\n".to_owned(),
        }
    );
    assert_eq!(noted(&seen), [json!("judge")]);
    let fault = application.inspect().unwrap_err();
    assert!(
        loomcli_core::FailureFacts::message(&fault)
            .contains("Commands \"a\" and \"b\" share one description.")
    );
    let development = ran(&application, &[], Build::Development).await;
    assert_eq!(development.status, 1);
    assert!(
        development
            .stderr
            .starts_with("-- TWO COMMANDS SHARE ONE DESCRIPTION --"),
        "{}",
        development.stderr
    );
    assert!(development.stderr.contains(
        " @fixture/judge/shared-name\n\nCommands \"a\" and \"b\" share one description.\n"
    ));
}

#[tokio::test]
async fn a_graph_hook_that_fails_otherwise_reports_broken_graph_hook_with_its_error_as_cause() {
    let application = Application::new("probe")
        .plugins([Plugin::new("@fixture/broken")
            .on_graph_built(|_| Err(Error::from_foreign("the graph is odd".into())))])
        .action(|ctx: Context| printing(ctx, "action"));
    assert_eq!(
        ran(&application, &[], Build::Distributed).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "probe: Something went wrong.\n".to_owned(),
        }
    );
    let development = ran(&application, &[], Build::Development).await;
    assert_eq!(development.status, 1);
    assert!(development.stderr.starts_with("-- BROKEN GRAPH HOOK --"));
    assert!(
        development
            .stderr
            .lines()
            .next()
            .unwrap()
            .ends_with(" @loomcli/core/broken-graph-hook")
    );
    let fault = application.inspect().unwrap_err();
    let cause = loomcli_core::FailureFacts::cause(&fault).unwrap();
    assert_eq!(cause.foreign().unwrap().to_string(), "the graph is odd");
}

#[test]
fn check_collects_every_graph_hooks_judgment_where_inspect_stops_at_the_first() {
    let judge = |identity: &'static str| {
        Plugin::new(identity).on_graph_built(move |_| {
            Err(DeclarationError::sentence_only(format!("{identity} rejects the graph.")).into())
        })
    };
    let application = Application::new("probe")
        .plugins([judge("@fixture/first"), judge("@fixture/second")])
        .action(|ctx: Context| printing(ctx, "action"));
    let sentences: Vec<String> = application
        .check()
        .iter()
        .map(|fault| fault.sentence().to_owned())
        .collect();
    assert_eq!(
        sentences,
        [
            "@fixture/first rejects the graph.",
            "@fixture/second rejects the graph."
        ]
    );
    assert_eq!(
        application.inspect().unwrap_err().sentence(),
        "@fixture/first rejects the graph."
    );
}

#[test]
fn check_adds_a_broken_graph_hook_and_runs_no_hook_over_a_build_fault() {
    let calls: Notes = Arc::default();
    let breaking = || {
        let calls = Arc::clone(&calls);
        Plugin::new("@fixture/break").on_graph_built(move |_| {
            calls.lock().unwrap().push(json!("called"));
            Err(Error::from_foreign("The hook broke.".into()))
        })
    };
    let broken = Application::new("probe")
        .plugins([breaking()])
        .action(|ctx: Context| printing(ctx, "action"));
    let faults: Vec<(String, String)> = broken
        .check()
        .iter()
        .map(|fault| {
            (
                support::faults::rule_name(fault),
                fault.sentence().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        faults,
        [(
            "broken-graph-hook".to_owned(),
            "Plugin \"@fixture/break\" failed in onGraphBuilt: The hook broke.".to_owned()
        )]
    );
    assert_eq!(noted(&calls), [json!("called")]);
    let unbuilt = Application::new("probe").plugins([breaking()]);
    let faults: Vec<(String, String)> = unbuilt
        .check()
        .iter()
        .map(|fault| {
            (
                support::faults::rule_name(fault),
                fault.sentence().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        faults,
        [(
            "command-without-action".to_owned(),
            "The root Command has no action.".to_owned()
        )]
    );
    assert_eq!(noted(&calls), [json!("called")]);
}

// collecting-extensions.test.ts: the values hooks add.

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Note {
    note: String,
}

fn note(text: &str) -> Note {
    Note {
        note: text.to_owned(),
    }
}

fn a_note(value: &Note) -> Result<(), Vec<Issue>> {
    if value.note.is_empty() {
        Err(vec![Issue::new("Supply a note")])
    } else {
        Ok(())
    }
}

const NOTES: Extension<CommandTarget, Note, loomcli_core::Collecting> =
    Extension::collecting("@fixture/notes/command").check(a_note);
const SINGLE: Extension<CommandTarget, Note> =
    Extension::new("@fixture/single/command").check(a_note);
const OPTION_NOTES: Extension<loomcli_core::OptionTarget, Note, loomcli_core::Collecting> =
    Extension::collecting("@fixture/notes/option");

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct OtherNote {
    other: String,
}

/// A descriptor another copy of the defining crate would hold: one identity, another value type.
const TWIN: Extension<CommandTarget, OtherNote, loomcli_core::Collecting> =
    Extension::collecting("@fixture/notes/command");

fn get() -> Command {
    Command::new("get")
        .extend((
            NOTES.value(note("constructor")),
            SINGLE.value(note("constructor")),
        ))
        .option(
            "raw",
            Opt::boolean().extend([OPTION_NOTES.value(note("option"))]),
        )
        .action(|ctx: Context| printing(ctx, "get"))
        .extend((NOTES.value(note("layer")), SINGLE.value(note("layer"))))
}

fn on_get(
    identity: &str,
    act: impl Fn(&mut AttachedCommand) -> Result<(), Error> + Send + Sync + 'static,
) -> Plugin {
    Plugin::new(identity).on_command_attach(move |command| {
        if command.name() == Some("get") {
            act(command)
        } else {
            Ok(())
        }
    })
}

fn supplier(identity: &str, text: &'static str) -> Plugin {
    on_get(identity, move |command| {
        command.extend([NOTES.value(note(text))])?;
        Ok(())
    })
}

#[test]
fn hooks_supply_values_after_the_author_layers_in_installation_order() {
    let graph = Application::new("app")
        .plugins([
            supplier("@fixture/first", "first hook"),
            on_get("@fixture/replacing", |command| {
                command.extend([SINGLE.value(note("hook"))])?;
                Ok(())
            }),
            supplier("@fixture/second", "second hook"),
        ])
        .command(get())
        .command(named("bare"))
        .inspect()
        .unwrap();
    let get = graph.command(&["get"]).unwrap();
    assert_eq!(
        Value::Object(get.extensions.clone()),
        json!({
            "@fixture/notes/command": [
                { "note": "constructor" },
                { "note": "layer" },
                { "note": "first hook" },
                { "note": "second hook" }
            ],
            "@fixture/single/command": { "note": "hook" }
        })
    );
    assert_eq!(
        Value::Object(get.options[0].extensions().clone()),
        json!({ "@fixture/notes/option": [{ "note": "option" }] })
    );
    let bare = graph.command(&["bare"]).unwrap();
    assert!(bare.extensions.is_empty());
    assert_eq!(
        read_extension(get, &NOTES).unwrap(),
        [
            note("constructor"),
            note("layer"),
            note("first hook"),
            note("second hook")
        ]
    );
    assert_eq!(read_extension(bare, &NOTES).unwrap(), Vec::<Note>::new());
}

#[test]
fn a_hook_reads_the_author_values_and_every_earlier_hook_value_typed_and_as_the_record() {
    let notes: Notes = Arc::default();
    let reading = |identity: &'static str| {
        let notes = Arc::clone(&notes);
        on_get(identity, move |command| {
            notes.lock().unwrap().push(json!({
                "notes": read_extension(&*command, &NOTES)?,
                "reader": identity,
                "single": read_extension(&*command, &SINGLE)?,
            }));
            notes.lock().unwrap().push(json!({
                "reader": identity,
                "record": command.extensions(),
            }));
            Ok(())
        })
    };
    Application::new("app")
        .plugins([
            reading("@fixture/before"),
            supplier("@fixture/first", "first hook"),
            reading("@fixture/after"),
        ])
        .command(get())
        .inspect()
        .unwrap();
    assert_eq!(
        noted(&notes),
        [
            json!({
                "notes": [{ "note": "constructor" }, { "note": "layer" }],
                "reader": "@fixture/before",
                "single": { "note": "layer" }
            }),
            json!({
                "reader": "@fixture/before",
                "record": {
                    "@fixture/notes/command": [{ "note": "constructor" }, { "note": "layer" }],
                    "@fixture/single/command": { "note": "layer" }
                }
            }),
            json!({
                "notes": [{ "note": "constructor" }, { "note": "layer" }, { "note": "first hook" }],
                "reader": "@fixture/after",
                "single": { "note": "layer" }
            }),
            json!({
                "reader": "@fixture/after",
                "record": {
                    "@fixture/notes/command": [
                        { "note": "constructor" },
                        { "note": "layer" },
                        { "note": "first hook" }
                    ],
                    "@fixture/single/command": { "note": "layer" }
                }
            }),
        ]
    );
}

#[test]
fn a_hook_that_replaces_an_ordinary_value_leaves_its_key_where_it_first_appeared() {
    let ordered = Command::new("ordered")
        .extend((
            SINGLE.value(note("constructor")),
            NOTES.value(note("constructor")),
        ))
        .action(|ctx: Context| printing(ctx, "ordered"));
    let graph = Application::new("app")
        .plugins([
            Plugin::new("@fixture/replacing").on_command_attach(|command| {
                if command.name() == Some("ordered") {
                    command.extend([SINGLE.value(note("hook"))])?;
                }
                Ok(())
            }),
        ])
        .command(ordered)
        .inspect()
        .unwrap();
    let keys: Vec<&String> = graph.root.children[0].extensions.keys().collect();
    assert_eq!(keys, ["@fixture/single/command", "@fixture/notes/command"]);
}

#[test]
fn a_hook_that_declares_an_option_and_then_extends_keeps_both() {
    let graph = Application::new("app")
        .plugins([on_get("@fixture/both", |command| {
            command
                .option("extra", Opt::boolean())?
                .extend([NOTES.value(note("hook"))])?;
            Ok(())
        })])
        .command(get())
        .inspect()
        .unwrap();
    let get = &graph.root.children[0];
    let options: Vec<&str> = get.options.iter().map(|option| option.name()).collect();
    assert_eq!(options, ["raw", "extra"]);
    assert_eq!(
        get.extensions["@fixture/notes/command"],
        json!([{ "note": "constructor" }, { "note": "layer" }, { "note": "hook" }])
    );
}

#[test]
fn a_second_value_of_a_collecting_extension_in_one_extend_call_replaces_the_first() {
    let graph = Application::new("app")
        .plugins([Plugin::new("@fixture/twice").on_command_attach(|command| {
            command.extend((NOTES.value(note("a")), NOTES.value(note("b"))))?;
            Ok(())
        })])
        .command(get())
        .inspect()
        .unwrap();
    assert_eq!(
        graph.root.children[0].extensions["@fixture/notes/command"],
        json!([{ "note": "constructor" }, { "note": "layer" }, { "note": "b" }])
    );
}

const INVALID: &str = "Command \"get\" holds an invalid \"@fixture/notes/command\" value: Supply a note. Correct the value.";

#[test]
fn a_value_a_hook_passes_to_extend_is_rejected_at_the_call_and_a_hook_that_handles_it_continues() {
    let fault = Application::new("app")
        .plugins([on_get("@fixture/rejecting", |command| {
            command.extend([NOTES.value(note(""))])?;
            Ok(())
        })])
        .command(get())
        .inspect()
        .unwrap_err();
    assert_eq!(rule_text(&fault), INVALID);
    let caught: Notes = Arc::default();
    let graph = Application::new("app")
        .plugins([on_get("@fixture/rejecting", {
            let caught = Arc::clone(&caught);
            move |command| {
                if let Err(fault) = command.extend([NOTES.value(note(""))]) {
                    caught.lock().unwrap().push(json!(rule_text(&fault)));
                    command.extend([SINGLE.value(note("after the catch"))])?;
                }
                Ok(())
            }
        })])
        .command(get())
        .inspect()
        .unwrap();
    assert_eq!(noted(&caught), [json!(INVALID)]);
    let get = &graph.root.children[0];
    assert_eq!(
        get.extensions["@fixture/notes/command"],
        json!([{ "note": "constructor" }, { "note": "layer" }])
    );
    assert_eq!(
        get.extensions["@fixture/single/command"],
        json!({ "note": "after the catch" })
    );
}

const TWICE: &str = "Extension \"@fixture/notes/command\" is defined twice. Install one copy of the package that defines it.";

#[test]
fn extend_rejects_a_second_descriptor_of_one_identity_wherever_it_meets_the_first() {
    let twin = |command: &mut AttachedCommand| -> Result<(), Error> {
        command.extend([TWIN.value(OtherNote {
            other: "twin".to_owned(),
        })])?;
        Ok(())
    };
    // At the call, against the Command's own author layer.
    let at_call = Application::new("app")
        .plugins([on_get("@fixture/twin", twin)])
        .command(get())
        .inspect()
        .unwrap_err();
    assert_eq!(rule_text(&at_call), TWICE);
    // The root's hook meets the descriptor the child's author layer carries.
    let returned = Application::new("app")
        .plugins([
            Plugin::new("@fixture/returning").on_command_attach(move |command| {
                if command.name().is_none() {
                    twin(command)?;
                }
                Ok(())
            }),
        ])
        .command(get())
        .inspect()
        .unwrap_err();
    assert_eq!(rule_text(&returned), TWICE);
    // Two hooks on one Command, each extending with a descriptor of one identity.
    let hooks = Application::new("app")
        .plugins([
            supplier("@fixture/first", "first hook"),
            on_get("@fixture/twin", twin),
        ])
        .command(Command::new("get").action(|ctx: Context| printing(ctx, "get")))
        .inspect()
        .unwrap_err();
    assert_eq!(rule_text(&hooks), TWICE);
}

#[test]
fn a_rejected_extend_call_the_hook_handles_registers_none_of_its_descriptors() {
    let graph = Application::new("app")
        .plugins([
            Plugin::new("@fixture/rejected-twin").on_command_attach(|command| {
                if command.name().is_none() {
                    let _ = command.extend([TWIN.value(OtherNote {
                        other: "twin".to_owned(),
                    })]);
                }
                Ok(())
            }),
        ])
        .command(get())
        .inspect();
    assert!(graph.is_ok());
}

#[test]
fn an_invalid_author_value_is_reported_before_a_hook_on_that_command_runs() {
    let message = support::faults::thrown(|| {
        let _ = Application::new("app")
            .plugins([on_get("@fixture/throwing", |_| {
                Err(Error::from_foreign("the hook failed".into()))
            })])
            .command(
                Command::new("get")
                    .extend([NOTES.value(note(""))])
                    .action(|ctx: Context| printing(ctx, "get")),
            );
    });
    assert_eq!(message, INVALID);
}

// environment-hooks.test.ts

/// A validator that records its phase and the token variable it reads.
#[derive(Clone)]
struct Timing(Notes);

impl Validator for Timing {
    type Output = String;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<String, Vec<Issue>> {
        let phase = match context.phase {
            loomcli_core::ValidationPhase::Default => "default",
            loomcli_core::ValidationPhase::Invocation => "invocation",
            _ => "question",
        };
        let token = context
            .host
            .env
            .get("LOOM_DOTENV_TOKEN")
            .cloned()
            .unwrap_or_else(|| "undefined".to_owned());
        self.0
            .lock()
            .unwrap()
            .push(json!(format!("{phase}:{token}")));
        Ok(input.to_owned())
    }
}

/// The fixture's two plugins: the first imports the token, the second reads it and adds a later
/// value the first's import wins over.
fn environment_plugins(events: &Notes, answer: &'static str) -> Vec<Plugin> {
    let first = Plugin::new("fixture/first").on_environment({
        let events = Arc::clone(events);
        move |_| {
            let events = Arc::clone(&events);
            async move {
                events.lock().unwrap().push(json!("first"));
                match answer {
                    "fatal" => {
                        Err(UnreadableFileError::new("The .env file cannot be read.").into())
                    }
                    "foreign" => Err(ParserError.into()),
                    "dashed" => Ok(BTreeMap::from([("my-var".to_owned(), "dashed".to_owned())])),
                    "precedence" => Ok(BTreeMap::from([
                        ("EMPTY".to_owned(), "file".to_owned()),
                        ("SET".to_owned(), "file".to_owned()),
                        ("UNDEFINED".to_owned(), "file".to_owned()),
                    ])),
                    _ => Ok(BTreeMap::from([(
                        "LOOM_DOTENV_TOKEN".to_owned(),
                        "imported".to_owned(),
                    )])),
                }
            }
        }
    });
    let second = Plugin::new("fixture/second")
        .middleware(loomcli_core::Activation::Always, {
            let events = Arc::clone(events);
            move |ctx, next: loomcli_core::Next| {
                let events = Arc::clone(&events);
                async move {
                    let token = ctx
                        .host
                        .env
                        .get("LOOM_DOTENV_TOKEN")
                        .cloned()
                        .unwrap_or_else(|| "undefined".to_owned());
                    events
                        .lock()
                        .unwrap()
                        .push(json!(format!("middleware:{token}")));
                    next.run().await.map(|_| ())
                }
            }
        })
        .on_environment({
            let events = Arc::clone(events);
            move |context| {
                let events = Arc::clone(&events);
                async move {
                    let token = context
                        .env
                        .get("LOOM_DOTENV_TOKEN")
                        .cloned()
                        .unwrap_or_else(|| "undefined".to_owned());
                    events
                        .lock()
                        .unwrap()
                        .push(json!(format!("second:{token}")));
                    Ok(BTreeMap::from([(
                        "LOOM_DOTENV_TOKEN".to_owned(),
                        "later".to_owned(),
                    )]))
                }
            }
        });
    vec![first, second]
}

/// A library's error, which the fixture application translates wherever a translator is offered it.
#[derive(Debug)]
struct ParserError;

impl std::fmt::Display for ParserError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("The parser broke.")
    }
}

impl std::error::Error for ParserError {}

#[derive(Debug, loomcli_core::Failure)]
#[failure(exit_code = EX_CONFIG)]
struct UnreadableFileError {
    #[failure(base)]
    base: FatalError,
}

impl UnreadableFileError {
    fn new(message: &str) -> Self {
        Self {
            base: FatalError::new(message),
        }
    }
}

fn environment_app(
    events: &Notes,
    answer: &'static str,
) -> loomcli_core::Application<NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Application::new("app")
        .description("Exercise environment preparation.")
        .plugins(environment_plugins(events, answer))
        .translators([loomcli_core::translate(|_: ParserError| {
            Ok(FatalError::new("translated"))
        })])
        .option(
            "check",
            Opt::string()
                .default("default")
                .validate(Timing(Arc::clone(events))),
        )
        .option(
            "token",
            Opt::string()
                .env(["LOOM_DOTENV_TOKEN"])
                .validate(Timing(Arc::clone(events))),
        )
        .command(Command::new("child").action(|ctx: Context| async move {
            let token = ctx
                .host
                .env
                .get("LOOM_DOTENV_TOKEN")
                .cloned()
                .unwrap_or_default();
            ctx.out.print(&token).await
        }))
        .action({
            let events = Arc::clone(events);
            move |ctx: Context| {
                let events = Arc::clone(&events);
                async move {
                    let line = json!({
                        "events": noted(&events),
                        "options": support::values_json(&ctx)["options"],
                        "env": ctx.host.env,
                    });
                    ctx.out.print(&line.to_string()).await
                }
            }
        })
}

#[tokio::test]
async fn environment_hooks_compose_before_defaults_and_bound_inputs_and_middleware_read_the_host() {
    let events: Notes = Arc::default();
    let ran = support::run(&environment_app(&events, "timing"), &[]).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let printed: Value = serde_json::from_str(ran.stdout.trim()).unwrap();
    assert_eq!(
        printed["events"],
        json!([
            "first",
            "second:imported",
            "default:imported",
            "invocation:imported",
            "middleware:imported"
        ])
    );
    assert_eq!(
        printed["options"],
        json!({ "check": "default", "token": "imported" })
    );
}

#[tokio::test]
async fn existing_and_empty_variables_win_while_undefined_ones_are_filled() {
    let events: Notes = Arc::default();
    let ran = run_with(
        &environment_app(&events, "precedence"),
        support::fields(&[], &[("EMPTY", ""), ("SET", "shell")]),
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let printed: Value = serde_json::from_str(ran.stdout.trim()).unwrap();
    support::assert_matches(
        &printed["env"],
        &json!({ "EMPTY": "", "SET": "shell", "UNDEFINED": "file" }),
    );
}

#[tokio::test]
async fn a_failure_class_a_hook_returns_keeps_its_exit_code_and_message() {
    let events: Notes = Arc::default();
    assert_eq!(
        support::run(&environment_app(&events, "fatal"), &[]).await,
        Ran {
            status: 78,
            stdout: String::new(),
            stderr: "The .env file cannot be read.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn any_other_error_from_a_hook_is_a_foreign_throw_no_translator_sees() {
    let events: Notes = Arc::default();
    let application = environment_app(&events, "foreign");
    let ran = ran(&application, &[], Build::Development).await;
    assert_eq!(ran.status, 1);
    assert!(
        ran.stderr.starts_with("-- UNHANDLED EXCEPTION --"),
        "{}",
        ran.stderr
    );
    assert!(
        ran.stderr
            .contains(" @loomcli/core/foreign-throw\n\nThe parser broke.\n")
    );
}

#[tokio::test]
async fn a_hook_may_add_a_variable_whose_name_holds_lowercase_letters_and_a_dash() {
    let events: Notes = Arc::default();
    let ran = support::run(&environment_app(&events, "dashed"), &[]).await;
    let printed: Value = serde_json::from_str(ran.stdout.trim()).unwrap();
    assert_eq!(printed["env"]["my-var"], json!("dashed"));
}

#[test]
fn inspection_and_checking_prepare_no_environment() {
    let events: Notes = Arc::default();
    let application = environment_app(&events, "timing");
    let _ = application.inspect().unwrap();
    assert!(application.check().is_empty());
    assert!(noted(&events).is_empty());
}

#[tokio::test]
async fn cancellation_before_or_during_preparation_starts_no_later_hook() {
    for during in [false, true] {
        let events: Notes = Arc::default();
        let token = tokio_util::sync::CancellationToken::new();
        let first = Plugin::new("fixture/first").on_environment({
            let events = Arc::clone(&events);
            let token = token.clone();
            move |_| {
                let events = Arc::clone(&events);
                let token = token.clone();
                async move {
                    events.lock().unwrap().push(json!("first"));
                    if during {
                        token.cancel();
                    }
                    Ok(BTreeMap::from([(
                        "LOOM_DOTENV_TOKEN".to_owned(),
                        "imported".to_owned(),
                    )]))
                }
            }
        });
        let second = Plugin::new("fixture/second").on_environment({
            let events = Arc::clone(&events);
            move |_| {
                let events = Arc::clone(&events);
                async move {
                    events.lock().unwrap().push(json!("second"));
                    Ok(BTreeMap::new())
                }
            }
        });
        let application = Application::new("app")
            .plugins([first, second])
            .action(|ctx: Context| printing(ctx, "action"));
        if !during {
            token.cancel();
        }
        let process = loomcli_testing::mock_process(MockFields::new());
        let code = application
            .run(
                loomcli_core::RunOptions::new()
                    .process(Arc::clone(&process) as _)
                    .signal(token.clone()),
            )
            .await;
        assert_eq!(code.get(), 130, "during: {during}");
        assert!(!process.stderr_text().contains("failed"));
        assert_eq!(process.stdout_text(), "");
        let expected: Vec<Value> = if during {
            vec![json!("first")]
        } else {
            Vec::new()
        };
        assert_eq!(noted(&events), expected, "during: {during}");
    }
    // A hook that fails after the run was cancelled during it still reports its failure, and no
    // later hook starts. The run stopped before its declared values were validated, so the
    // failure's own code stands, as the reference resolves a cancellation only after them.
    let events: Notes = Arc::default();
    let token = tokio_util::sync::CancellationToken::new();
    let failing = Plugin::new("fixture/first").on_environment({
        let token = token.clone();
        move |_| {
            let token = token.clone();
            async move {
                token.cancel();
                Err::<BTreeMap<String, String>, loomcli_core::Error>(
                    std::io::Error::other("The parser broke.").into(),
                )
            }
        }
    });
    let second = Plugin::new("fixture/second").on_environment({
        let events = Arc::clone(&events);
        move |_| {
            let events = Arc::clone(&events);
            async move {
                events.lock().unwrap().push(json!("second"));
                Ok(BTreeMap::new())
            }
        }
    });
    let application = Application::new("app")
        .plugins([failing, second])
        .action(|ctx: Context| printing(ctx, "action"));
    let process = loomcli_testing::mock_process(
        MockFields::new().release(loomcli_core::ReleaseFacts::new(Build::Distributed)),
    );
    let code = application
        .run(
            loomcli_core::RunOptions::new()
                .process(Arc::clone(&process) as _)
                .signal(token),
        )
        .await;
    assert_eq!(
        (
            code.get(),
            process.stdout_text(),
            process.stderr_text(),
            noted(&events)
        ),
        (
            1,
            String::new(),
            "app: Something went wrong.\n".to_owned(),
            Vec::new()
        )
    );
}

// observing-log-events.test.ts: a plugin's on_log hook.

#[tokio::test]
async fn each_installed_plugins_log_hook_receives_each_event_in_installation_order() {
    let seen: Notes = Arc::default();
    let observer = |identity: &'static str| {
        let seen = Arc::clone(&seen);
        Plugin::new(identity).on_log(move |event: &LogEvent, destination: &LogDestination| {
            seen.lock().unwrap().push(json!({
                "hook": identity,
                "message": event.message,
                "plugin": event.plugin,
                "platform": destination.platform,
            }));
        })
    };
    let application = Application::new("app")
        .plugins([observer("@acme/first"), observer("@acme/second")])
        .action(|ctx: Context| async move {
            ctx.log.info("started", ());
            Ok(())
        });
    let ran = support::run(&application, &[]).await;
    assert_eq!(ran.status, 0);
    assert_eq!(
        noted(&seen),
        [
            json!({ "hook": "@acme/first", "message": "started", "plugin": null, "platform": "linux" }),
            json!({ "hook": "@acme/second", "message": "started", "plugin": null, "platform": "linux" }),
        ]
    );
}

#[tokio::test]
async fn a_failure_hook_and_an_environment_hook_log_under_their_plugins_identity() {
    let seen: Notes = Arc::default();
    let application = Application::new("app")
        .plugins([
            Plugin::new("@acme/env").on_environment(|context| async move {
                context.log.info("preparing", ());
                Ok(BTreeMap::new())
            }),
            Plugin::new("@acme/hint").on_failure(|_, context| {
                context.log.info("hinting", ());
            }),
            Plugin::new("@acme/observer").on_log({
                let seen = Arc::clone(&seen);
                move |event: &LogEvent, _: &LogDestination| {
                    seen.lock()
                        .unwrap()
                        .push(json!([event.message, event.plugin]));
                }
            }),
        ])
        .action(|ctx: Context| async move { Err(ctx.out.fatal("stopped")) });
    let ran = support::run(&application, &[]).await;
    assert_eq!(ran.status, 1);
    assert_eq!(
        noted(&seen),
        [
            json!(["preparing", "@acme/env"]),
            json!(["stopped", null]),
            json!(["hinting", "@acme/hint"]),
        ]
    );
}

// own-options.test.ts: the declaration part.

#[tokio::test]
async fn a_plugins_own_global_option_and_a_hook_declared_local_option_validate_as_ordinary_inputs()
{
    let application = Application::new("owns")
        .plugins([Plugin::new("@fixture/owns")
            .option("mine", Opt::string().validate(support::validators::Upper))
            .on_command_attach(|command| {
                if command.name() == Some("get") {
                    command.option("local", Opt::string().validate(support::validators::Upper))?;
                }
                Ok(())
            })])
        .command(
            Command::new("get")
                .option(
                    "depth",
                    Opt::string().validate(support::validators::Digits("Use digits.")),
                )
                .action(|ctx: Context| async move {
                    let options = support::values_json(&ctx)["options"].to_string();
                    ctx.out.print(&options).await
                }),
        );
    assert_eq!(
        support::run(&application, &["get", "--mine", "abc", "--local", "xyz"])
            .await
            .stdout,
        "{\"mine\":\"ABC\",\"local\":\"XYZ\"}\n"
    );
    let ran = support::run(&application, &["get", "--mine", "abc", "--depth", "x"]).await;
    assert_eq!(ran.status, 2);
}

// theme-preparation.test.ts

#[tokio::test]
async fn a_validated_theme_reaches_the_failure_view_when_the_root_or_a_hook_build_fails() {
    for hook in [false, true] {
        let palette =
            Plugin::new("palette").theme(ThemeMapping::new().entry("issue", style().cyan()));
        let failing = Plugin::new("failing").on_command_attach(|_| {
            Err(DeclarationError::sentence_only("The hook rejects the Command.").into())
        });
        let plugins = if hook {
            vec![palette, failing]
        } else {
            vec![palette]
        };
        let invalid = override_view(
            failure::<DeclarationError>(),
            loomcli_core::FailureView::new(|_: &DeclarationError, context| {
                format!(
                    "{}\n",
                    context.view_context.style.token("issue").apply("invalid")
                )
            }),
        );
        let application = Application::new("theme-preparation")
            .plugins(plugins)
            .rendering(RenderingPolicy::new().color(Switch::Always))
            .overrides([invalid]);
        let ran = if hook {
            let application = application.action(|ctx: Context| printing(ctx, "action"));
            ran(&application, &[], Build::Distributed).await
        } else {
            ran(&application, &[], Build::Distributed).await
        };
        assert_eq!(
            ran,
            Ran {
                status: 1,
                stdout: String::new(),
                stderr: "\u{1b}[36minvalid\u{1b}[39m\n".to_owned(),
            },
            "hook: {hook}"
        );
    }
}

#[test]
fn a_theme_whose_entry_names_a_token_panics_at_the_claim() {
    let message = support::faults::panic_message(|| {
        let _ = Plugin::new("palette")
            .theme(ThemeMapping::new().entry("issue", style().token("other")));
    });
    assert!(!message.is_empty());
}

// forged-values.test.ts

/// A value that would forge a banner, reorder the line, and end it, were a sentence to hold it raw.
const FORGED: &str = "x\n\n-- FAKE BANNER ---- @loomcli/core/other\u{202e}\u{85}\n";

/// A control character, a line or paragraph separator, or a bidirectional control.
fn holds_control(text: &str) -> bool {
    text.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
            )
    })
}

fn rejecting_note(_: &String) -> Result<(), Vec<Issue>> {
    Err(vec![Issue::new(FORGED)])
}

const LIMIT: Extension<CommandTarget, String> =
    Extension::new("@acme/limit/command").check(rejecting_note);
const NOTES_TEXT: Extension<CommandTarget, String> = Extension::new("@acme/notes/command");
const NOTES_NUMBER: Extension<CommandTarget, u32> = Extension::new("@acme/notes/command");

#[test]
fn an_author_supplied_value_reaches_a_declaration_sentence_escaped() {
    let reports: Notes = Arc::default();
    let record = {
        let reports = Arc::clone(&reports);
        move |scenario: &str, fault: DeclarationError| {
            reports.lock().unwrap().push(json!({
                "scenario": scenario,
                "rule": fault.rule().map(|rule| rule.identity().to_owned()),
                "sentence": fault.sentence(),
            }));
        }
    };
    let probing = Plugin::new("@acme/format").on_command_attach(move |command| {
        if command.name() != Some("get") {
            return Ok(());
        }
        for (scenario, outcome) in [
            (
                "hook-option-name",
                command.option(FORGED, Opt::string()).map(|_| ()),
            ),
            (
                "hook-option-dash",
                command.option("-bad", Opt::string()).map(|_| ()),
            ),
            (
                "extension-issue",
                command.extend([LIMIT.value("x".to_owned())]).map(|_| ()),
            ),
            (
                "extension-copies",
                command
                    .extend((NOTES_TEXT.value("a".to_owned()), NOTES_NUMBER.value(1)))
                    .map(|_| ()),
            ),
        ] {
            if let Err(fault) = outcome {
                record(scenario, fault);
            }
        }
        Ok(())
    });
    let _ = Application::new("probe")
        .plugins([probing])
        .command(named("get"))
        .inspect()
        .unwrap();
    let reports = noted(&reports);
    let rules: Vec<(String, String)> = reports
        .iter()
        .map(|report| {
            (
                report["scenario"].as_str().unwrap().to_owned(),
                report["rule"].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        rules,
        [
            ("hook-option-name", "@loomcli/core/declared-name"),
            ("hook-option-dash", "@loomcli/core/declared-name"),
            ("extension-issue", "@loomcli/core/invalid-extension-value"),
            ("extension-copies", "@loomcli/core/two-package-copies"),
        ]
        .map(|(scenario, rule)| (scenario.to_owned(), rule.to_owned()))
    );
    for report in &reports {
        assert!(
            !holds_control(report["sentence"].as_str().unwrap()),
            "{report}"
        );
    }
    // An author's own call panics with the diagnostic, whose every line holds the value escaped.
    let payload = std::panic::catch_unwind(|| {
        let _ = Command::new("get").option(FORGED, Opt::string());
    })
    .expect_err("the call faults");
    let message = payload
        .downcast_ref::<String>()
        .cloned()
        .unwrap_or_default();
    assert!(message.contains("@loomcli/core/declared-name"), "{message}");
    assert!(
        message
            .lines()
            .all(|line| !line.starts_with("-- FAKE") && !holds_control(line)),
        "{message}"
    );
}
