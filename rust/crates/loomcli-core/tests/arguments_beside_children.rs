//! Ports the routing, failure, and inspection cases of arguments-beside-children.test.ts.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use loomcli_core::{
    Application, Arg, Command, Context, FailureFacts, GroupCommand, InvocationOutcome,
    InvocationValues, InvokeOptions, NonCallableCommandError, Opt, Outcome, Passthrough,
    WordPosition, locate,
};
use loomcli_testing::{MockFields, mock_process};
use support::{Ran, run, usage};

async fn noop(_: Context) -> Outcome {
    Ok(())
}

fn completion() -> GroupCommand {
    Command::new("completion").alias("comp").command(
        Command::new("bash").action(|ctx: Context| async move { ctx.out.print("script").await }),
    )
}

fn textstat() -> Application {
    Application::new("textstat")
        .argument("files", Arg::string().variadic())
        .option("lines", Opt::boolean())
        .command(completion())
        .action(|ctx: Context| async move {
            let files: Vec<String> = ctx.argument("files")?;
            let lines: bool = ctx.option("lines")?;
            ctx.out
                .print(&format!("files:{} lines:{lines}", files.join(",")))
                .await
        })
}

#[tokio::test]
async fn exact_children_route_first_until_the_first_argument_or_delimiter() {
    let app = textstat();
    for (words, output) in [
        (&["completion", "bash"][..], "script\n"),
        (&["comp", "bash"][..], "script\n"),
        (&["a.txt"][..], "files:a.txt lines:false\n"),
        (
            &["a.txt", "completion"][..],
            "files:a.txt,completion lines:false\n",
        ),
        (&["--", "completion"][..], "files:completion lines:false\n"),
        (&["complete"][..], "files:complete lines:false\n"),
        (&["--lines", "a.txt"][..], "files:a.txt lines:true\n"),
        (&["a.txt", "--lines"][..], "files:a.txt lines:true\n"),
        (&[][..], "files: lines:false\n"),
    ] {
        assert_eq!(
            run(&app, words).await,
            Ran {
                status: 0,
                stdout: output.to_owned(),
                stderr: String::new(),
            },
            "{words:?}"
        );
    }
    assert_eq!(
        run(&app, &["completion", "notes.txt"]).await,
        usage("textstat: Unknown command \"notes.txt\". Use one of: bash.")
    );
    assert_eq!(
        run(&app, &["--lines", "completion", "bash"]).await,
        usage(
            "textstat: Unknown option \"--lines\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
}

#[tokio::test]
async fn a_group_can_suggest_escaping_only_the_word_from_its_parent() {
    for word in ["completion", "comp"] {
        assert_eq!(
            run(&textstat(), &[word]).await,
            usage(&format!(
                "textstat: Command \"completion\" requires a subcommand. Use one of: bash. To pass \"{word}\" as an argument, write -- before it."
            ))
        );
    }
    let bare = Application::new("kit").command(completion());
    let passing = Application::new("kit")
        .command(completion())
        .argument("files", Arg::string().variadic())
        .passthrough(Passthrough::new())
        .action(noop);
    let expected = usage("kit: Command \"completion\" requires a subcommand. Use one of: bash.");
    assert_eq!(run(&bare, &["completion"]).await, expected);
    assert_eq!(run(&passing, &["completion"]).await, expected);
    let nested = Application::new("textstat")
        .argument("files", Arg::string().variadic())
        .command(
            Command::new("cache")
                .command(Command::new("inner").command(Command::new("x").action(noop))),
        )
        .action(noop);
    assert_eq!(
        run(&nested, &["cache", "inner"]).await,
        usage("textstat: Command \"inner\" requires a subcommand. Use one of: x.")
    );
}

#[tokio::test]
async fn the_failure_exposes_the_escapable_word_only_for_argv() {
    let make =
        || NonCallableCommandError::new(vec!["completion".to_owned()], vec!["bash".to_owned()]);
    assert_eq!(make().argument("comp").argument_word(), Some("comp"));
    let unmarked = make();
    assert_eq!(unmarked.argument_word(), None);
    assert!(!unmarked.message().contains("--"));

    let outcome = textstat()
        .invoke(
            &["completion"],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    let InvocationOutcome::Failed {
        failure, messages, ..
    } = outcome
    else {
        panic!("expected failure");
    };
    assert_eq!(
        failure
            .downcast_failure::<NonCallableCommandError>()
            .unwrap()
            .argument_word(),
        None
    );
    assert!(!messages.contains("--"));
}

#[test]
fn locate_offers_the_first_argument_alongside_children() {
    let graph = textstat().inspect().unwrap();
    for words in [&["c"][..], &[""][..], &["--lines", "c"][..]] {
        assert!(
            matches!(locate(&graph, words), WordPosition::Command { argument: Some(argument), command, .. }
            if argument.name == "files" && command.path.is_empty())
        );
    }
    for words in [&["a.txt", "c"][..], &["--", "c"][..]] {
        assert!(
            matches!(locate(&graph, words), WordPosition::Argument { argument, .. } if argument.name == "files")
        );
    }
    let bare = Application::new("kit")
        .command(completion())
        .inspect()
        .unwrap();
    assert!(matches!(
        locate(&bare, &["c"]),
        WordPosition::Command { argument: None, .. }
    ));
}

#[test]
fn a_group_argument_fault_marks_the_first_argument_call() {
    let fault = std::panic::catch_unwind(|| {
        let _ = Application::new("app").command(
            Command::new("cache")
                .argument("key", Arg::string().description("k"))
                .command(Command::new("x").action(noop)),
        );
    })
    .expect_err("declaration should fault");
    let fault = fault.downcast::<String>().unwrap();
    assert!(
        fault.contains(
            "Command \"cache\" declares arguments but registers no action to receive them."
        )
    );
    assert!(fault.contains(".argument(\"key\", Arg::string().description(\"k\"))"));
    assert!(fault.contains("^^^^^ the first argument"));
}

#[tokio::test]
async fn derived_arguments_can_follow_children_including_plugin_commands() {
    #[derive(loomcli_core::Inputs)]
    struct Operands {
        #[argument]
        file: String,
    }
    let app = Application::new("kit")
        .plugins((loomcli_core::Plugin::new("test/read").commands([completion()]),))
        .command(Command::new("get").action(noop))
        .inputs::<Operands>()
        .action(|ctx: Context<Operands>| async move { ctx.out.print(&ctx.inputs.file).await });
    assert_eq!(run(&app, &["completion", "bash"]).await.stdout, "script\n");
    assert_eq!(run(&app, &["--", "get"]).await.stdout, "get\n");
}
