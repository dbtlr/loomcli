//! Ports the operator behavior of fixed-count option occurrences.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use loomcli_core::{Application, Arg, Command, Context, Opt, Outcome, SuppliedValue};
use serde_json::json;
use support::{dispatched, report, run, usage};

async fn point_values(ctx: Context) -> Outcome {
    let point = ctx.option::<Option<Vec<String>>>("point")?;
    let points = ctx.option::<Vec<Vec<String>>>("points")?;
    let supplied = match ctx.supplied.options.get("points") {
        Some(SuppliedValue::Tuples(groups)) => json!(groups),
        _ => serde_json::Value::Null,
    };
    ctx.out
        .print(&json!([point, points, supplied]).to_string())
        .await
}

#[tokio::test]
async fn each_occurrence_gives_the_action_its_own_group() {
    let app = Application::new("draw")
        .option("verbose", Opt::count().short('v'))
        .option("point", Opt::string().arity(2).short('p'))
        .option("points", Opt::string().arity(2).multiple())
        .action(point_values);

    assert_eq!(
        dispatched(
            &app,
            &["-vp", "-5", "-", "--points", "3", "4", "--points", "5", "6"]
        )
        .await,
        json!([
            ["-5", "-"],
            [["3", "4"], ["5", "6"]],
            [["3", "4"], ["5", "6"]]
        ])
    );
    assert_eq!(dispatched(&app, &[]).await, json!([null, [], []]));
}

#[tokio::test]
async fn only_separate_plain_words_fill_an_occurrence() {
    let app = Application::new("draw")
        .option("point", Opt::string().arity(2).short('p'))
        .option("verbose", Opt::boolean().short('v'))
        .action(report);
    for (args, spelling) in [
        (&["--point=3", "4"][..], "--point"),
        (&["-p3", "4"], "-p"),
        (&["-vp=3", "4"], "-p"),
    ] {
        assert_eq!(
            run(&app, args).await,
            usage(&format!(
                "draw: Option \"{spelling}\" takes its values as separate words. Supply each one after \"{spelling}\" as its own word."
            ))
        );
    }
    for args in [&["--point", "3"][..], &["--point", "3", "--", "4"]] {
        assert_eq!(
            run(&app, args).await,
            usage(
                "draw: Option \"--point\" requires 2 values and received 1. Supply 2 values after \"--point\"."
            )
        );
    }
    assert_eq!(
        run(&app, &["--point", "--", "a", "b"]).await,
        usage(
            "draw: Option \"--point\" requires 2 values and received 0. Supply 2 values after \"--point\"."
        )
    );
    for (word, spelling) in [("--token=secret", "--token"), ("-old", "-o")] {
        assert_eq!(
            run(&app, &["--point", "3", word]).await,
            usage(&format!(
                "draw: Option \"--point\" requires 2 values, and \"{spelling}\" reads as an option. Supply 2 values after \"--point\"; a value that reads as an option cannot be one of them."
            ))
        );
    }
}

#[tokio::test]
async fn rebinding_preserves_the_group_and_uses_the_routed_policy() {
    let app = Application::new("draw")
        .option("point", Opt::string().arity(2))
        .command(
            Command::new("child")
                .argument("rest", Arg::string().variadic())
                .option("point", Opt::string().arity(2).last_wins())
                .action(report),
        )
        .action(report);
    let args = ["--point", "1", "2", "child", "--point", "3", "4", "done"];
    let result = dispatched(&app, &args).await;
    assert_eq!(result["command"], json!(["child"]));
    assert_eq!(result["options"], json!({"point":["3","4"]}));
    assert_eq!(result["args"], json!({"rest":["done"]}));
}

#[tokio::test]
async fn arity_environment_binding_splits_untrimmed_and_requires_the_declared_count() {
    use loomcli_core::RunOptions;
    use loomcli_testing::{MockFields, mock_process};
    use std::sync::Arc;

    let app = Application::new("draw")
        .option(
            "point",
            Opt::string()
                .arity(2)
                .env(["POINT", "FALLBACK"])
                .env_delimiter("x"),
        )
        .action(report);
    for (point, fallback, expected) in [
        (" x", "a xb", json!([" ", ""])),
        ("", "800x600", json!(["800", "600"])),
        ("", "", serde_json::Value::Null),
    ] {
        let handle = mock_process(
            MockFields::new()
                .env("POINT", point)
                .env("FALLBACK", fallback),
        );
        let code = app
            .run(RunOptions::new().process(Arc::clone(&handle) as _))
            .await;
        let output: serde_json::Value = serde_json::from_str(&handle.stdout_text()).unwrap();
        assert_eq!(code.get(), 0);
        assert_eq!(output["options"]["point"], expected);
    }

    let handle = mock_process(MockFields::new().env("POINT", "800"));
    let code = app
        .run(RunOptions::new().process(Arc::clone(&handle) as _))
        .await;
    assert_eq!(code.get(), 2);
    assert_eq!(
        handle.stderr_text(),
        "draw: Option \"--point\" (from POINT): Use 2 values separated by \"x\".\n"
    );
}

#[derive(Debug, PartialEq, Eq, loomcli_core::Inputs)]
struct DrawInputs {
    #[option(arity, default = ["800", "600"], last_wins)]
    resize: [String; 2],
    #[option(arity)]
    point: Option<[String; 2]>,
    #[option(arity, default = [["0", "0"], ["1", "1"]])]
    marks: Vec<[String; 2]>,
}

#[tokio::test]
async fn derived_fields_and_by_name_reads_share_the_same_arity_value() {
    use loomcli_core::Inputs;
    let app = Application::new("draw").inputs::<DrawInputs>().action(
        |ctx: Context<DrawInputs>| async move {
            let read = ctx.option::<Option<Vec<String>>>("resize")?;
            ctx.out
                .print(
                    &json!([ctx.inputs.resize, ctx.inputs.point, ctx.inputs.marks, read])
                        .to_string(),
                )
                .await
        },
    );
    assert_eq!(
        dispatched(&app, &[]).await,
        json!([
            ["800", "600"],
            null,
            [["0", "0"], ["1", "1"]],
            ["800", "600"]
        ])
    );
    assert_eq!(
        dispatched(
            &app,
            &[
                "--resize", "1", "2", "--resize", "3", "4", "--point", "5", "6", "--marks", "7",
                "8"
            ]
        )
        .await,
        json!([["3", "4"], ["5", "6"], [["7", "8"]], ["3", "4"]]),
    );
    let inputs = DrawInputs {
        resize: ["1".into(), "2".into()],
        point: Some(["3".into(), "4".into()]),
        marks: vec![["5".into(), "6".into()]],
    };
    let values = inputs.into_values();
    assert_eq!(
        values.option::<Vec<Vec<String>>>("marks").unwrap(),
        vec![vec!["5", "6"]]
    );
    assert_eq!(
        DrawInputs::extract(&values).unwrap().point,
        Some(["3".into(), "4".into()])
    );
}

#[test]
fn locate_keeps_the_latest_occurrence_and_the_open_groups_words() {
    use loomcli_core::{WordPosition, locate};
    let graph = Application::new("draw")
        .option("point", Opt::string().arity(2).last_wins())
        .action(report)
        .inspect()
        .unwrap();
    let WordPosition::Value { prefix, typed, .. } = locate(
        &graph,
        &[
            "--point", "1", "2", "--point", "3", "4", "--point", "5", "6",
        ],
    ) else {
        panic!("the last word completes the open occurrence");
    };
    assert_eq!(prefix, "6");
    assert_eq!(typed.options["point"], ["3", "4", "5"]);
    assert!(matches!(locate(&graph, &["--point="]), WordPosition::None));
}

#[test]
fn arity_failures_and_the_declaring_diagnostic_have_their_own_facts() {
    use loomcli_core::{
        AttachedValueRefusal, FailureFacts, MissingValueError, MissingValueForm,
        UnexpectedValueError,
    };
    let missing = MissingValueError::for_arity("--point", 2, 1, None);
    assert_eq!(missing.arity(), Some(2));
    assert_eq!(missing.code(), "missing-value");
    assert_eq!(
        MissingValueError::new("--point", MissingValueForm::Separate).arity(),
        None
    );
    let extra = UnexpectedValueError::new("--point", "secret", AttachedValueRefusal::Arity);
    assert_eq!(extra.value(), "secret");
    assert!(!extra.message().contains("secret"));
    let arity_error = support::faults::panic_message(|| {
        let _ = Application::new("draw").global_option("point", Opt::string().arity(1));
    });
    assert!(arity_error.contains("@loomcli/core/option-arity"));
    assert!(arity_error.contains("Option \"point\" declares arity 1."));
    let arity_error = support::faults::panic_message(|| {
        let _ = Command::new("draw").option("point", Opt::string().arity(0));
    });
    assert!(arity_error.contains("Option \"point\" declares arity 0."));
    let delimiter_error = support::faults::panic_message(|| {
        let _ = Application::new("draw").option(
            "point",
            Opt::string().arity(2).env(["POINT"]).env_delimiter(""),
        );
    });
    assert!(delimiter_error.contains("@loomcli/core/env-delimiter"));
}

#[tokio::test]
async fn routing_keeps_an_arity_fault_and_rejects_a_different_value_class() {
    let app = |child_count| {
        Application::new("draw")
            .option("point", Opt::string().arity(2).short('p'))
            .command(
                Command::new("child")
                    .option("point", Opt::string().arity(child_count).short('p'))
                    .action(report),
            )
            .action(report)
    };
    let application = app(2);
    assert_eq!(
        dispatched(&application, &["-p", "1", "2", "child"]).await["options"],
        json!({"point": ["1", "2"]})
    );
    let failure = run(&application, &["--point=1", "child"]).await;
    assert_eq!(failure.status, 2);
    assert!(
        failure
            .stderr
            .contains("takes its values as separate words")
    );
    let failure = run(
        &application,
        &["--point", "1", "2", "-p", "3", "4", "child"],
    )
    .await;
    assert_eq!(failure.status, 2);
    assert!(
        failure
            .stderr
            .contains("Option \"-p\" can be supplied only once.")
    );
    let failure = run(&app(3), &["--point", "1", "2", "child"]).await;
    assert_eq!(failure.status, 2);
    assert!(failure.stderr.contains("Option \"--point\""));
    assert!(!failure.stderr.contains("requires 3 values"));
}

#[tokio::test]
async fn validators_read_each_word_and_issues_prefix_its_group_and_position() {
    use support::validators::Number;
    let app = Application::new("draw")
        .option(
            "resize",
            Opt::string()
                .arity(2)
                .validate(Number("Use an integer."))
                .default(["800", "600"]),
        )
        .option(
            "point",
            Opt::string()
                .arity(2)
                .multiple()
                .validate(Number("Use an integer.")),
        )
        .action(|ctx: Context| async move {
            let resize = ctx.option::<Option<Vec<u64>>>("resize")?;
            let points = ctx.option::<Vec<Vec<u64>>>("point")?;
            ctx.out.print(&json!([resize, points]).to_string()).await
        });
    assert_eq!(dispatched(&app, &[]).await, json!([[800, 600], []]));
    assert_eq!(
        dispatched(&app, &["--resize", "1", "2", "--point", "3", "4"]).await,
        json!([[1, 2], [[3, 4]]])
    );
    assert_eq!(
        run(&app, &["--resize", "800", "x"]).await,
        usage("draw: Option \"--resize\" at 1: Use an integer.")
    );
    assert_eq!(
        run(&app, &["--point", "1", "2", "--point", "x", "y"]).await,
        usage(
            "draw: Option \"--point\" at 1.0: Use an integer.\ndraw: Option \"--point\" at 1.1: Use an integer."
        )
    );
}

#[tokio::test]
async fn supplied_arity_values_are_whole_groups_in_each_word_validation_context() {
    use std::sync::Arc;
    use support::validators::{Echo, calls, seen};
    let recording = calls();
    let echo = || Echo {
        label: "point",
        calls: Arc::clone(&recording),
    };
    let app = Application::new("draw")
        .global_option("global", Opt::string().arity(2).validate(echo()))
        .command(
            Command::new("child")
                .option("point", Opt::string().arity(2).multiple().validate(echo()))
                .action(report),
        );
    let _ = dispatched(
        &app,
        &[
            "--global", "a", "b", "child", "--point", "1", "2", "--point", "3", "4",
        ],
    )
    .await;
    let calls = seen(&recording);
    assert_eq!(
        calls
            .iter()
            .map(|call| call["value"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["a", "b", "1", "2", "3", "4"]
    );
    for call in calls {
        assert_eq!(
            call["context"]["supplied"]["options"],
            json!({"global": ["a", "b"], "point": [["1", "2"], ["3", "4"]]})
        );
    }
}

#[tokio::test]
async fn requiring_arity_values_names_the_count_and_exclusive_groups_withdraw_a_fill() {
    use loomcli_core::{ValueLink, missing_input_error};
    let app = Application::new("draw")
        .option("point", Opt::string().arity(2).required())
        .option("marks", Opt::string().arity(2).required().multiple())
        .action(report);
    assert_eq!(
        run(&app, &[]).await,
        usage(
            "draw: Option \"--point\" is required. Supply 2 values.\ndraw: Option \"--marks\" is required. Supply at least one set of 2 values."
        )
    );
    let app = Application::new("draw")
        .option("point", Opt::string().arity(2).multiple())
        .action(|ctx: Context| async move {
            Err(missing_input_error(
                &ctx,
                &ValueLink::option("point", "Point"),
            ))
        });
    assert_eq!(
        run(&app, &[]).await,
        usage(
            "draw: Option \"--point\" is required when input is not interactive. Supply at least one set of 2 values."
        )
    );
    let app = Application::new("draw")
        .option(
            "point",
            Opt::string().arity(2).env(["POINT"]).env_delimiter(","),
        )
        .option("center", Opt::boolean())
        .exclusive(&["point", "center"])
        .action(report);
    let ran = support::run_with(&app, support::fields(&["--center"], &[("POINT", "1,2")])).await;
    assert_eq!(ran.status, 0);
    let value: serde_json::Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(value["options"], json!({"center": true}));
}

#[tokio::test]
async fn invoking_by_name_preserves_option_like_words_and_checks_group_lengths() {
    use loomcli_core::{InvocationOutcome, InvocationValues, InvokeOptions};
    let app = Application::new("draw")
        .option("point", Opt::string().arity(2))
        .option("points", Opt::string().arity(2).multiple())
        .action(point_values);
    for (points, expected) in [
        (
            json!([[1, 2], ["--", "-x"]]),
            json!([["1", "2"], ["--", "-x"]]),
        ),
        (json!(["3", "4"]), json!([["3", "4"]])),
        (json!([]), json!([])),
    ] {
        let result = app
            .invoke(
                &[],
                InvocationValues::new()
                    .option("point", json!([800, "600"]))
                    .option("points", points),
                InvokeOptions::new(),
                None,
            )
            .await;
        let InvocationOutcome::Completed { output, .. } = result else {
            panic!("the call should complete")
        };
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&output).unwrap(),
            json!([["800", "600"], expected, expected])
        );
    }
    for (name, value, suffix) in [
        ("point", json!([1]), "."),
        ("point", json!([[1, 2], [3, 4]]), "."),
        ("points", json!([[1]]), ", or a list of such lists."),
    ] {
        let result = app
            .invoke(
                &[],
                InvocationValues::new().option(name, value),
                InvokeOptions::new(),
                None,
            )
            .await;
        let InvocationOutcome::Failed {
            exit_code,
            messages,
            ..
        } = result
        else {
            panic!("the call should fail")
        };
        assert_eq!(exit_code.get(), 2);
        assert_eq!(
            messages,
            format!("draw: Option \"{name}\": Use a list of 2 strings or numbers{suffix}\n")
        );
    }
}

#[tokio::test]
async fn a_configuration_source_supplies_or_drops_one_complete_grouped_value() {
    use loomcli_core::__private::{SourceProbe, install_source};
    use loomcli_core::{
        Build, Error, Extension, OptionTarget, ReleaseFacts, SourceAnswer, SourceValue,
    };
    use std::collections::BTreeMap;
    use support::validators::Digits;
    const BINDING: Extension<OptionTarget, String> = Extension::new("@fixture/source/arity");
    let app = |point: SourceValue, points: SourceValue| {
        install_source(
            Application::new("draw")
                .option(
                    "point",
                    Opt::string()
                        .arity(2)
                        .validate(Digits("Use an integer."))
                        .extend([BINDING.value("point".to_owned())]),
                )
                .option(
                    "points",
                    Opt::string()
                        .arity(2)
                        .multiple()
                        .extend([BINDING.value("points".to_owned())]),
                )
                .action(point_values),
            "@fixture/source",
            &BINDING,
            &[],
            move |_: SourceProbe| {
                std::future::ready(Ok::<_, Error>(BTreeMap::from([
                    (
                        "point".into(),
                        SourceAnswer::new(point.clone(), "point in settings"),
                    ),
                    (
                        "points".into(),
                        SourceAnswer::new(points.clone(), "points in settings"),
                    ),
                ])))
            },
        )
    };
    let pair = || SourceValue::List(vec!["800".into(), "600".into()]);
    let group = || SourceValue::Tuples(vec![vec!["1".into(), "2".into()]]);
    assert_eq!(
        dispatched(&app(pair(), group()), &[]).await,
        json!([["800", "600"], [["1", "2"]], [["1", "2"]]])
    );
    assert_eq!(
        dispatched(
            &app(
                SourceValue::List(vec!["800".into(), "wrong".into()]),
                group()
            ),
            &[]
        )
        .await[0],
        serde_json::Value::Null
    );
    for (point, points, sentence) in [
        (
            SourceValue::List(vec!["1".into()]),
            group(),
            "an array of 2 strings.",
        ),
        (
            pair(),
            SourceValue::List(vec!["1".into(), "2".into()]),
            "an array of arrays, each of 2 strings.",
        ),
    ] {
        let ran = support::run_with(
            &app(point, points),
            support::fields(&[], &[]).release(ReleaseFacts::new(Build::Development)),
        )
        .await;
        assert_eq!(ran.status, 1);
        assert!(ran.stderr.contains(sentence), "{ran:?}");
    }
}

#[test]
fn graph_and_locate_publish_arity_for_local_and_routing_occurrences() {
    use loomcli_core::{WordPosition, locate};
    let graph = Application::new("draw")
        .option("point", Opt::string().arity(2).short('p'))
        .option("ordinary", Opt::string())
        .option("flag", Opt::boolean())
        .command(Command::new("child").action(report))
        .action(report)
        .inspect()
        .unwrap();
    let published = serde_json::to_value(&*graph).unwrap();
    assert_eq!(published["root"]["options"][0]["arity"], 2);
    assert_eq!(
        published["root"]["options"][1]["arity"],
        serde_json::Value::Null
    );
    assert!(published["root"]["options"][2].get("arity").is_none());
    for (args, words) in [(&["-p", ""][..], &[][..]), (&["-p", "1", ""], &["1"][..])] {
        let WordPosition::Value { typed, .. } = locate(&graph, args) else {
            panic!("expected a value position")
        };
        assert_eq!(
            typed
                .options
                .get("point")
                .map(Vec::as_slice)
                .unwrap_or_default(),
            words
        );
    }
    assert!(matches!(
        locate(&graph, &["-p", "1", "2", "ch"]),
        WordPosition::Command { .. }
    ));
    let WordPosition::Command { typed, .. } = locate(&graph, &["-p", "1", "2", "ch"]) else {
        panic!("routing remains open");
    };
    assert_eq!(typed.options["point"], ["1", "2"]);
}

#[tokio::test]
async fn routing_consumes_the_words_of_a_repeated_or_incomplete_arity_occurrence() {
    let app = Application::new("draw")
        .global_option("origin", Opt::string().arity(2))
        .option("size", Opt::string().arity(2))
        .option("verbose", Opt::boolean())
        .command(
            Command::new("pair")
                .option("size", Opt::string().arity(2))
                .action(report),
        )
        .command(
            Command::new("single")
                .option("size", Opt::string())
                .action(report),
        );
    for name in ["origin", "size"] {
        let spelling = format!("--{name}");
        assert_eq!(
            run(&app, &[&spelling, "1", "2", &spelling, "3", "4", "pair"]).await,
            usage(&format!(
                "draw: Option \"{spelling}\" can be supplied only once. Remove the repeated option."
            ))
        );
    }
    assert_eq!(
        run(&app, &["--size", "800", "--verbose", "pair"]).await,
        usage(
            "draw: Option \"--size\" requires 2 values, and \"--verbose\" reads as an option. Supply 2 values after \"--size\"; a value that reads as an option cannot be one of them."
        )
    );
    assert_eq!(
        run(&app, &["--size", "800", "600", "single"]).await,
        usage("draw: Option \"--size\" belongs to command \"single\". Supply it after \"single\".")
    );
}

#[tokio::test]
async fn grouped_defaults_are_validated_before_supplied_words_and_read_as_fresh_values() {
    use loomcli_core::{Build, ReleaseFacts};
    use support::validators::Number;
    let rejected = Application::new("draw")
        .option(
            "size",
            Opt::string()
                .arity(2)
                .default(["800", "x"])
                .validate(Number("Use an integer.")),
        )
        .action(report);
    let fields =
        support::fields(&["--size", "1", "2"], &[]).release(ReleaseFacts::new(Build::Development));
    let ran = support::run_with(&rejected, fields).await;
    assert_eq!(ran.status, 1);
    assert!(
        ran.stderr.contains("Option \"size\" at 1: Use an integer."),
        "{ran:?}"
    );

    let fresh = Application::new("draw")
        .option(
            "points",
            Opt::string().arity(2).multiple().default([["a", "b"]]),
        )
        .action(|ctx: Context| async move {
            let mut points = ctx.option::<Vec<Vec<String>>>("points")?;
            ctx.out.print(&json!(points).to_string()).await?;
            points[0].push("written".to_owned());
            Ok(())
        });
    for _ in 0..2 {
        assert_eq!(dispatched(&fresh, &[]).await, json!([["a", "b"]]));
    }
}
