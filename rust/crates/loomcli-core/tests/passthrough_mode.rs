//! The first bare delimiter and the Command's passthrough declaration.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod support;

use loomcli_core::{Application, Arg, Context};
use support::{report, run};

#[tokio::test]
async fn the_delimiter_makes_hyphen_words_arguments_by_default() {
    let app = Application::new("rm")
        .argument("path", Arg::string().required())
        .action(|ctx: Context| async move {
            let path: Option<String> = ctx.argument("path")?;
            ctx.out
                .print(&serde_json::json!({"path": path}).to_string())
                .await
        });
    let result = run(&app, &["--", "-draft.txt"]).await;
    assert_eq!(result.status, 0);
    assert_eq!(result.stdout, "{\"path\":\"-draft.txt\"}\n");
    assert!(result.stderr.is_empty());
}

#[tokio::test]
async fn a_bare_delimiter_does_not_discard_an_extra_word() {
    let app = Application::new("one").action(report);
    let result = run(&app, &["--", "two"]).await;
    assert_eq!(result.status, 2);
    assert!(result.stderr.contains("accepts no arguments"));
}

#[derive(loomcli_core::Inputs)]
struct ForwardInputs {
    #[passthrough(description = "Forward words.")]
    words: Vec<String>,
}

#[tokio::test]
async fn a_derived_passthrough_field_and_the_context_receive_the_same_tail() {
    let app = Application::new("forward")
        .inputs::<ForwardInputs>()
        .action(|ctx: Context<ForwardInputs>| async move {
            assert_eq!(ctx.inputs.words, ctx.passthrough);
            ctx.out
                .print(&serde_json::json!(ctx.inputs.words).to_string())
                .await
        });
    assert_eq!(
        run(&app, &["--", "--", "", "-x"]).await.stdout,
        "[\"--\",\"\",\"-x\"]\n"
    );
    assert_eq!(run(&app, &[]).await.stdout, "[]\n");
    assert_eq!(
        app.inspect()
            .ok()
            .and_then(|graph| graph.root.passthrough.clone())
            .and_then(|mode| mode.description)
            .as_deref(),
        Some("Forward words."),
    );
}

#[test]
fn a_unit_context_round_trips_derived_passthrough_words() {
    let ctx = loomcli_testing::action_context::<_, loomcli_core::NoResult>(
        loomcli_testing::ActionValues::new(ForwardInputs {
            words: vec!["--".to_owned(), "".to_owned()],
        }),
    );
    assert_eq!(ctx.inputs.words, ["--", ""]);
    assert_eq!(ctx.passthrough, ctx.inputs.words);
}

async fn noop(_: Context) -> loomcli_core::Outcome {
    Ok(())
}

use loomcli_core::{
    Command, FailureFacts, InvocationOutcome, InvocationValues, InvokeOptions, Passthrough,
    UnexpectedArgumentError, WordPosition, locate,
};
use loomcli_testing::{MockFields, mock_process};

fn fixture() -> Application {
    Application::new("rm")
        .argument("path", Arg::string().required())
        .command(
            Command::new("copy")
                .argument("src", Arg::string().required().variadic())
                .argument("dest", Arg::string().required())
                .action(report),
        )
        .command(
            Command::new("headcopy")
                .argument("head", Arg::string().required())
                .argument("src", Arg::string().variadic())
                .argument("dest", Arg::string().required())
                .action(|ctx: Context| async move {
                    let src: Vec<String> = ctx.argument("src")?;
                    let head: Option<String> = ctx.argument("head")?;
                    let dest: Option<String> = ctx.argument("dest")?;
                    ctx.out
                        .print(
                            &serde_json::json!({"head": head, "src": src, "dest": dest})
                                .to_string(),
                        )
                        .await
                }),
        )
        .command(
            Command::new("wrapper")
                .argument("path", Arg::string())
                .passthrough(Passthrough::new().description("Forward words."))
                .action(report),
        )
        .command(Command::new("group").command(Command::new("leaf").action(noop)))
        .command(
            Command::new("one")
                .argument("item", Arg::string())
                .action(noop),
        )
        .action(report)
}

#[tokio::test]
async fn an_explicit_named_tail_requires_the_mode_unless_empty() {
    let app = Application::new("kit")
        .command(
            Command::new("store").command(
                Command::new("get")
                    .argument("path", Arg::string())
                    .action(noop),
            ),
        )
        .action(noop);
    let process = mock_process(MockFields::new());
    for (path, subject, accepted) in [
        (&[][..], "The root Command", 0),
        (&["store", "get"][..], "Command \"get\"", 1),
    ] {
        let outcome = app
            .invoke(
                path,
                InvocationValues::new().passthrough(["tail"]),
                InvokeOptions::new(),
                Some(process.clone()),
            )
            .await;
        let InvocationOutcome::Failed {
            failure, exit_code, ..
        } = outcome
        else {
            panic!("expected failure");
        };
        let failure = failure
            .downcast_failure::<UnexpectedArgumentError>()
            .unwrap();
        assert_eq!(failure.command(), path);
        assert_eq!(failure.accepted(), accepted);
        assert_eq!(failure.extra(), ["tail"]);
        assert_eq!(
            failure.message(),
            format!("{subject} declares no passthrough. Remove passthrough from the values.")
        );
        assert_eq!(exit_code.get(), 2);
    }
    assert!(matches!(
        app.invoke(
            &[],
            InvocationValues::new().passthrough([] as [&str; 0]),
            InvokeOptions::new(),
            Some(process)
        )
        .await,
        InvocationOutcome::Completed { .. }
    ));
}

#[tokio::test]
async fn named_passthrough_ranks_after_unknown_option_exclude_and_argument_names() {
    let app = Application::new("kit").command(Command::new("get").action(noop));
    for (values, options, wanted) in [
        (
            InvocationValues::new().option("unknown", true),
            InvokeOptions::new(),
            "Unknown option \"unknown\".",
        ),
        (
            InvocationValues::new(),
            InvokeOptions::new().exclude(["unknown"]),
            "Unknown option \"unknown\".",
        ),
        (
            InvocationValues::new().arg("unknown", "x"),
            InvokeOptions::new(),
            "Command \"get\" declares no argument \"unknown\".",
        ),
    ] {
        let outcome = app
            .invoke(
                &["get"],
                values.passthrough(["tail"]),
                options,
                Some(mock_process(MockFields::new())),
            )
            .await;
        let InvocationOutcome::Failed { form, .. } = outcome else {
            panic!("expected failure");
        };
        assert!(form.message.starts_with(wanted), "{}", form.message);
    }
}

#[tokio::test]
async fn the_mode_preserves_delimiters_without_filling_arguments() {
    let app = fixture();
    let graph = app.inspect().unwrap();
    let wrapper = graph.command(&["wrapper"]).unwrap();
    assert_eq!(
        wrapper.passthrough.as_ref().unwrap().description.as_deref(),
        Some("Forward words.")
    );
    assert!(matches!(
        locate(&graph, &["wrapper", "--", ""]),
        WordPosition::Passthrough { .. }
    ));
    assert!(
        matches!(locate(&graph, &["--", ""]), WordPosition::Argument { argument, .. } if argument.name == "path")
    );
    let argv = support::dispatched(&app, &["wrapper", "--", "-x", "--"]).await;
    assert_eq!(argv["args"], serde_json::json!({}));
    assert_eq!(argv["passthrough"], serde_json::json!(["-x", "--"]));
    let outcome = app
        .invoke(
            &["wrapper"],
            InvocationValues::new().passthrough(["--", "-x"]),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    let InvocationOutcome::Completed { output, .. } = outcome else {
        panic!("expected completion");
    };
    let printed = serde_json::from_str::<serde_json::Value>(&output).unwrap();
    assert_eq!(printed["args"], serde_json::json!({}));
    assert_eq!(printed["passthrough"], serde_json::json!(["--", "-x"]));
}

#[tokio::test]
async fn positional_binding_reserves_the_required_suffix() {
    let app = fixture();
    for (words, sources) in [
        (&["copy", "a", "b", "dest"][..], ["a", "b"]),
        (&["copy", "a", "--", "b", "dest"][..], ["a", "b"]),
        (&["copy", "a", "--", "--", "dest"][..], ["a", "--"]),
    ] {
        let report = support::dispatched(&app, words).await;
        assert_eq!(
            report["args"],
            serde_json::json!({"src": sources, "dest": "dest"})
        );
    }
    for words in [
        &["headcopy", "x", "a", "b", "dest"][..],
        &["headcopy", "x", "a", "--", "b", "dest"][..],
        &["headcopy", "x", "--", "a", "b", "dest"][..],
    ] {
        assert_eq!(
            run(&app, words).await.stdout,
            "{\"head\":\"x\",\"src\":[\"a\",\"b\"],\"dest\":\"dest\"}\n"
        );
    }
    assert_eq!(
        run(&app, &["headcopy", "x", "dest"]).await.stdout,
        "{\"head\":\"x\",\"src\":[],\"dest\":\"dest\"}\n"
    );
    let missing = run(&app, &["copy", "a"]).await;
    assert_eq!(missing.status, 2);
    assert!(
        missing
            .stderr
            .contains("Argument \"src\" requires at least one value")
    );
    assert!(
        !missing
            .stderr
            .contains("Argument \"dest\" requires a value")
    );

    let named = app
        .invoke(
            &["copy"],
            InvocationValues::new()
                .arg("dest", "dest")
                .arg("src", vec!["a", "b"]),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    let InvocationOutcome::Completed { output, .. } = named else {
        panic!("expected completion");
    };
    let printed: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(
        printed["args"],
        serde_json::json!({"src": ["a", "b"], "dest": "dest"})
    );
}

fn panic_message(action: impl FnOnce()) -> String {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(action))
        .expect_err("declaration should fault")
        .downcast::<String>()
        .map(|text| *text)
        .unwrap()
}

#[test]
fn invalid_arguments_after_a_variadic_explain_the_fault() {
    for (declaration, reason) in [
        (
            loomcli_core::ArgumentDecl::from(Arg::string()),
            "is optional",
        ),
        (Arg::string().variadic().into(), "is variadic"),
        (
            Arg::string().required_when_non_interactive().into(),
            "is required only when input is not interactive",
        ),
        (Arg::content().into(), "is a content argument"),
    ] {
        let fault = panic_message(|| {
            let _ = Command::new("copy")
                .argument("src", Arg::string().variadic())
                .argument("dest", declaration);
        });
        assert!(fault.contains(&format!("Argument \"dest\" {reason} and follows variadic argument \"src\" on Command \"copy\".")), "{fault}");
    }
    let fault = panic_message(|| {
        let _ = Command::new("c")
            .argument("s", Arg::string().variadic())
            .argument("d", Arg::string().required())
            .argument("e", Arg::string());
    });
    assert!(fault.contains("Argument \"e\" is optional and follows variadic argument \"s\""));
    let fault = panic_message(|| {
        let _ = Application::new("c")
            .argument("s", Arg::string().variadic())
            .argument("d", Arg::string().required())
            .argument("e", Arg::string());
    });
    assert!(fault.contains("Argument \"e\" is optional and follows variadic argument \"s\""));
}

#[test]
fn optional_and_conditionally_required_variadics_allow_a_required_suffix() {
    for src in [
        Arg::string().variadic(),
        Arg::string().variadic().required_when_non_interactive(),
    ] {
        let graph = Application::new("mv")
            .argument("src", src)
            .argument("dest", Arg::string().required())
            .action(noop)
            .inspect()
            .unwrap();
        for words in [&[][..], &["a"][..]] {
            assert!(
                matches!(locate(&graph, words), WordPosition::Argument { argument, .. } if argument.name == "src")
            );
        }
    }
}

#[test]
fn a_group_cannot_declare_passthrough() {
    for (mode, call) in [
        (Passthrough::new(), "passthrough(Passthrough::new())"),
        (
            Passthrough::new().description("x"),
            "passthrough(Passthrough::new().description(\"x\"))",
        ),
    ] {
        let message = panic_message(|| {
            let _ = Application::new("app").command(
                Command::new("group")
                    .passthrough(mode)
                    .command(Command::new("leaf").action(noop)),
            );
        });
        assert!(message.contains(call), "{message}");
        assert!(message.contains(
            "Command \"group\" declares passthrough but registers no action to receive it."
        ));
        assert!(
            message.contains(
                "Declare passthrough on the Command that reads it, or register an action."
            )
        );
        assert!(!message.contains("undefined"));
    }
    let root = Application::new("app")
        .passthrough(Passthrough::new())
        .command(Command::new("leaf").action(noop))
        .inspect()
        .unwrap_err();
    assert_eq!(
        root.rule().unwrap().identity(),
        "@loomcli/core/command-without-action"
    );
}

#[tokio::test]
async fn extra_tails_fail_and_unknown_option_corrections_follow_the_mode() {
    let app = fixture();
    assert_eq!(run(&app, &["one", "--", "first", "extra"]).await.status, 2);
    let group = run(&app, &["group", "--", "leaf"]).await;
    assert_eq!(
        group,
        support::usage("rm: Command \"group\" accepts no arguments. Remove the supplied values.")
    );
    assert_eq!(
        run(&app, &["--draft.txt"]).await,
        support::usage(
            "rm: Unknown option \"--draft.txt\". Supply a declared option, or pass it as an argument after \"--\"."
        )
    );
    assert_eq!(
        run(&app, &["wrapper", "--draft.txt"]).await,
        support::usage(
            "rm: Unknown option \"--draft.txt\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
}

#[tokio::test]
async fn passthrough_does_not_inherit() {
    let app = Application::new("app")
        .passthrough(Passthrough::new())
        .command(Command::new("child").action(report))
        .action(noop);
    let child = support::dispatched(&app, &["child"]).await;
    assert_eq!(child["passthrough"], serde_json::json!([]));
    assert_eq!(run(&app, &["child", "--", "x"]).await.status, 2);
    let outcome = app
        .invoke(
            &["child"],
            InvocationValues::new().passthrough(["x"]),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    assert!(matches!(outcome, InvocationOutcome::Failed { exit_code, .. } if exit_code.get() == 2));
}

#[test]
fn a_second_passthrough_declaration_faults_at_the_call() {
    let fault = panic_message(|| {
        let _ = Application::new("app")
            .passthrough(Passthrough::new())
            .inputs::<ForwardInputs>();
    });
    assert!(fault.contains("@loomcli/core/passthrough-declared-twice"));
}
