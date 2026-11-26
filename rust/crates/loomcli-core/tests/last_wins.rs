//! Ports the last-wins invocation and inspection cases from the reference.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use loomcli_core::{Application, Arg, Command, Context, Opt, Passthrough};
use serde_json::json;
use support::{dispatched, report, run, usage};

#[tokio::test]
async fn global_last_wins_crosses_routing_layers_and_stops_at_the_delimiter() {
    let app = Application::new("mailer")
        .global_option("editor", Opt::string().short('e').last_wins())
        .command(
            Command::new("draft")
                .argument("rest", Arg::string().variadic())
                .action(report),
        );
    let args = ["--editor", "vim", "draft", "-e", "nano"];
    assert_eq!(
        dispatched(&app, &args).await["options"],
        json!({"editor": "nano"})
    );
    let args = ["--editor", "vim", "draft", "note.txt", "-e", "nano"];
    assert_eq!(
        dispatched(&app, &args).await["options"],
        json!({"editor": "nano"})
    );
    let args = ["-e", "vim", "draft", "--", "--editor", "nano"];
    let value = dispatched(&app, &args).await;
    assert_eq!(value["options"], json!({"editor": "vim"}));
    assert_eq!(value["args"], json!({"rest": ["--editor", "nano"]}));
}

#[tokio::test]
async fn the_routed_command_decides_the_repeat_policy() {
    let app = Application::new("mailer")
        .option("editor", Opt::string())
        .command(
            Command::new("draft")
                .option("editor", Opt::string().last_wins())
                .action(report),
        )
        .action(report);
    let args = [
        "--editor", "vim", "--editor", "ed", "draft", "--editor", "nano",
    ];
    assert_eq!(
        dispatched(&app, &args).await["options"],
        json!({"editor": "nano"})
    );

    let app = Application::new("mailer")
        .option("editor", Opt::string().last_wins())
        .command(
            Command::new("draft")
                .option("editor", Opt::string())
                .action(report),
        )
        .action(report);
    assert_eq!(
        run(&app, &args).await,
        usage("mailer: Option \"--editor\" can be supplied only once. Remove the repeated option.")
    );
}

#[tokio::test]
async fn a_replacement_uses_its_own_implied_value_note() {
    let app = Application::new("mailer")
        .option("mode", Opt::string().implied("fast").last_wins())
        .option("level", Opt::string().implied("fast").multiple())
        .action(|ctx: Context| async move {
            let mode = ctx.option::<Option<String>>("mode")?;
            let level = ctx.option::<Vec<String>>("level")?;
            ctx.out
                .print(&json!({ "mode": mode, "level": level }).to_string())
                .await
        });
    assert_eq!(
        dispatched(&app, &["--mode", "--mode=slow", "--level", "--level=slow"]).await,
        json!({"mode": "slow", "level": ["fast", "slow"]}),
    );
    assert_eq!(
        dispatched(&app, &["--mode=slow", "--mode"]).await["mode"],
        "fast",
    );
}

#[tokio::test]
async fn a_missing_value_still_faults_and_the_delimiter_ends_occurrences() {
    let app = Application::new("mailer")
        .option("editor", Opt::string().aliases(["ed"]).last_wins())
        .passthrough(Passthrough::new())
        .action(report);
    let args = ["--editor", "--ed", "nano"];
    assert_eq!(
        run(&app, &args).await,
        usage(
            "mailer: Option \"--editor\" requires a value. Supply a value after \"--editor\", or attach one that starts with a hyphen as \"--editor=<value>\"."
        )
    );
    let args = ["--editor", "vim", "--ed=nano", "--", "--editor", "after"];
    let value = dispatched(&app, &args).await;
    assert_eq!(value["options"], json!({"editor": "nano"}));
    assert_eq!(value["passthrough"], json!(["--editor", "after"]));
}

#[tokio::test]
async fn only_the_winning_occurrence_reaches_the_validator() {
    use std::sync::Arc;
    use support::validators::{Digits, Echo, calls, seen};
    let calls = calls();
    let app = Application::new("mailer")
        .option(
            "editor",
            Opt::string().last_wins().validate(Digits("Use digits.")),
        )
        .option(
            "mode",
            Opt::string().last_wins().implied("fast").validate(Echo {
                label: "mode",
                calls: Arc::clone(&calls),
            }),
        )
        .action(report);
    let args = [
        "--editor",
        "rejected",
        "--editor",
        "5",
        "--mode",
        "--mode=slow",
    ];
    assert_eq!(
        dispatched(&app, &args).await["options"],
        json!({"editor": "5", "mode": "slow"})
    );
    let seen = seen(&calls);
    assert_eq!(seen.len(), 2);
    assert_eq!(seen[0]["context"]["phase"], "default");
    assert_eq!(seen[0]["value"], "fast");
    assert_eq!(seen[1]["context"]["phase"], "invocation");
    assert_eq!(seen[1]["value"], "slow");
    assert_eq!(
        seen[1]["context"]["supplied"]["options"],
        json!({"editor": "5", "mode": "slow"})
    );
}

#[tokio::test]
async fn winning_argv_occurrence_beats_the_environment_and_configuration() {
    use loomcli_core::__private::{SourceProbe, install_source};
    use loomcli_core::{Error, Extension, OptionTarget, SourceAnswer, SourceValue};
    use std::collections::BTreeMap;
    const BINDING: Extension<OptionTarget, String> = Extension::new("@fixture/source/key");
    let app = install_source(
        Application::new("mailer")
            .option(
                "editor",
                Opt::string()
                    .last_wins()
                    .env(["MAILER_EDITOR"])
                    .extend([BINDING.value("editor".to_owned())]),
            )
            .action(report),
        "@fixture/source",
        &BINDING,
        &[],
        |_: SourceProbe| {
            std::future::ready(Ok::<_, Error>(BTreeMap::from([(
                "editor".to_owned(),
                SourceAnswer::new(SourceValue::String("configured".to_owned()), "settings"),
            )])))
        },
    );
    for (args, env, want) in [
        (
            &["--editor", "vim", "--editor", "nano"][..],
            &[("MAILER_EDITOR", "emacs")][..],
            "nano",
        ),
        (
            &["--editor", "vim", "--editor", "nano"][..],
            &[][..],
            "nano",
        ),
        (&[][..], &[("MAILER_EDITOR", "emacs")][..], "emacs"),
        (&[][..], &[][..], "configured"),
    ] {
        let ran = support::run_with(&app, support::fields(args, env)).await;
        assert_eq!(ran.status, 0, "{ran:?}");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&ran.stdout).unwrap()["options"]["editor"],
            want
        );
    }
}

#[tokio::test]
async fn ordinary_boolean_and_string_options_still_reject_repeats() {
    let app = Application::new("mailer")
        .option("editor", Opt::string())
        .option("quiet", Opt::boolean())
        .action(report);
    for (args, spelling) in [
        (&["--editor", "vim", "--editor", "nano"][..], "--editor"),
        (&["--quiet", "--quiet"][..], "--quiet"),
    ] {
        assert_eq!(
            run(&app, args).await,
            usage(&format!(
                "mailer: Option \"{spelling}\" can be supplied only once. Remove the repeated option."
            ))
        );
    }
}

#[test]
fn graph_and_completion_publish_the_rules_for_the_latest_occurrence() {
    use loomcli_core::{WordPosition, locate};
    let graph = Application::new("mailer")
        .option("editor", Opt::string().last_wins().short('e'))
        .option("ordinary", Opt::string())
        .option("file", Opt::content())
        .argument("path", Arg::string())
        .action(report)
        .inspect()
        .unwrap();
    let json = serde_json::to_value(&*graph).unwrap();
    let entries = json["root"]["options"].as_array().unwrap();
    assert_eq!(entries[0]["lastWins"], true);
    assert_eq!(entries[1]["lastWins"], false);
    assert!(entries[2].get("lastWins").is_none());
    for (args, expected) in [
        (&["--editor", "vim", "--editor="][..], ""),
        (&["--editor", "vim", "-e", "na"][..], "na"),
    ] {
        let WordPosition::Value {
            option,
            prefix,
            typed,
            ..
        } = locate(&graph, args)
        else {
            panic!("expected an editor value")
        };
        assert_eq!(option.name(), "editor");
        assert_eq!(prefix, expected);
        assert_eq!(typed.options["editor"], ["vim"]);
    }
    assert!(matches!(
        locate(&graph, &["--editor", "vim", "--editor", "nano", "f"]),
        WordPosition::Argument { .. }
    ));
    assert!(matches!(
        locate(&graph, &["--ordinary", "x", "--ordinary="]),
        WordPosition::None
    ));
}

#[tokio::test]
async fn marked_background_follows_the_winning_occurrence_and_falls_back_for_auto() {
    use loomcli_core::Background;
    use loomcli_testing::MockTerminal;
    let app = Application::new("mailer")
        .global_option("background", Opt::string().background().last_wins())
        .global_option("name", Opt::string())
        .argument("rest", Arg::string().variadic())
        .action(|ctx: Context| async move {
            let choice = ctx.option::<Option<String>>("background")?;
            ctx.out
                .print(
                    &json!([choice, ctx.host.terminal.background.map(Background::name)])
                        .to_string(),
                )
                .await
        });
    for (args, expected) in [
        (
            &["--background=dark", "--background=light"][..],
            json!(["light", "light"]),
        ),
        (
            &["--background=light", "--background=auto"][..],
            json!(["auto", "dark"]),
        ),
        (
            &["--background=light", "notes.txt"][..],
            json!(["light", "light"]),
        ),
        (
            &["--background", "light", "--name", "x", "f"][..],
            json!(["light", "light"]),
        ),
    ] {
        let fields = support::fields(args, &[])
            .terminal(MockTerminal::new(80, 24).background(Background::Dark));
        let ran = support::run_with(&app, fields).await;
        assert_eq!(ran.status, 0, "{ran:?}");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&ran.stdout).unwrap(),
            expected
        );
    }
    assert_eq!(
        run(&app, &["--background=light", "--background"])
            .await
            .status,
        2
    );
}

#[tokio::test]
async fn middleware_reads_the_winning_spelling_and_a_fault_removes_its_value() {
    use loomcli_core::{Activation, Plugin};
    use std::sync::{Arc, Mutex};
    let calls = Arc::new(Mutex::new(Vec::new()));
    let record = Arc::clone(&calls);
    let plugin = Plugin::new("@fixture/fmt")
        .option("fmt", Opt::string().last_wins().short('f'))
        .middleware(Activation::Always, move |ctx, next| {
            let record = Arc::clone(&record);
            async move {
                record.lock().unwrap().push((
                    ctx.own_options.option::<Option<String>>("fmt")?,
                    ctx.spellings.get("fmt").map(str::to_owned),
                ));
                next.run().await?;
                Ok(())
            }
        });
    let app = Application::new("mailer").plugins([plugin]).action(report);
    assert_eq!(run(&app, &["--fmt", "json", "-f", "text"]).await.status, 0);
    assert_eq!(run(&app, &["-f", "json", "--fmt"]).await.status, 2);
    assert_eq!(
        *calls.lock().unwrap(),
        [
            (Some("text".into()), Some("-f".into())),
            (None, Some("-f".into()))
        ]
    );
}
