//! Held unknown commands through argv and named invocations, from unknown-command-held.test.ts.

#![allow(clippy::unwrap_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Activation, AnyPlugin, ChainOutcome, Command, ExitCode, GroupApplication, InvocationOutcome,
    InvocationValues, InvokeOptions, InvokedBy, NoInputs, NoResult, Opt, Outcome, Plugin, Provider,
    UnknownCommandError,
};

use loomcli_testing::{MockFields, mock_process};
use support::validators::{Echo, calls, seen};

type App = GroupApplication<NoInputs, NoResult>;

async fn noop(_: loomcli_core::Context) -> Outcome {
    Ok(())
}

fn notes(plugins: Vec<AnyPlugin>) -> App {
    loomcli_core::Application::new("notes")
        .plugins(plugins)
        .command(Command::new("add").action(noop))
        .command(Command::new("secret").hidden().action(noop))
        .command(Command::new("cache").command(Command::new("clear").action(noop)))
}

const UNKNOWN_NOPE: &str = r#"notes: Unknown command "nope". Use one of: add, cache."#;

#[tokio::test]
async fn the_boundary_raises_the_unknown_command_after_always_middleware() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let fixture = Plugin::new("@fixture/reader").middleware(Activation::Always, {
        let seen = Arc::clone(&seen);
        move |ctx, next| {
            let seen = Arc::clone(&seen);
            async move {
                let held = ctx.unknown_command.as_deref().unwrap();
                assert_eq!(held.word, "nope");
                assert_eq!(held.rest, ["a", "--b", "--", "c"]);
                assert_eq!(ctx.invoked_by, InvokedBy::Argv);
                assert!(ctx.command.path.is_empty());
                assert!(ctx.options.is_none());
                assert!(ctx.request.is_none());
                assert_eq!(ctx.spellings.iter().count(), 0);
                assert_eq!(ctx.view(), None);
                let error = next.run().await.unwrap_err();
                let failure = error.downcast_failure::<UnknownCommandError>().unwrap();
                seen.lock().unwrap().push(failure.token().to_owned());
                Err(error)
            }
        }
    });
    let ran = support::run(
        &notes(vec![fixture.into()]),
        &["nope", "a", "--b", "--", "c"],
    )
    .await;
    assert_eq!(ran, support::usage(UNKNOWN_NOPE));
    assert_eq!(*seen.lock().unwrap(), ["nope"]);
}

#[tokio::test]
async fn without_a_takeover_the_unknown_command_still_exits_two() {
    assert_eq!(
        support::run(&notes(vec![]), &["nope", "--bad"]).await,
        support::usage(UNKNOWN_NOPE)
    );
}

#[tokio::test]
async fn an_unknown_word_under_a_group_keeps_the_routed_node() {
    let reader =
        Plugin::new("@fixture/reader").middleware(Activation::Always, |ctx, next| async move {
            assert_eq!(ctx.command.path, ["cache"]);
            let held = ctx.unknown_command.as_deref().unwrap();
            assert_eq!(held.word, "nope");
            assert!(held.rest.is_empty());
            next.run().await?;
            Ok(())
        });
    assert_eq!(
        support::run(&notes(vec![reader.into()]), &["cache", "nope"]).await,
        support::usage(r#"notes: Unknown command "nope". Use one of: clear."#)
    );
}

#[tokio::test]
async fn options_before_the_unknown_word_activate_nothing_and_never_validate() {
    let validated = calls();
    let flagged = Plugin::new("@fixture/flagged")
        .option("flag", Opt::boolean())
        .middleware(Activation::options(["flag"]), |_, _| async {
            panic!("an option activated middleware on an unknown command");
            #[allow(unreachable_code)]
            Ok(())
        });
    let always = Plugin::new("@fixture/always")
        .option(
            "level",
            Opt::string().validate(Echo {
                calls: Arc::clone(&validated),
                label: "level",
            }),
        )
        .middleware(Activation::Always, |ctx, next| async move {
            assert!(ctx.options.is_none());
            assert!(!ctx.own_options.validated("level"));
            assert_eq!(ctx.own_options.option::<Option<String>>("level")?, None);
            assert_eq!(ctx.spellings.iter().count(), 0);
            next.run().await?;
            Ok(())
        });
    assert_eq!(
        support::run(
            &notes(vec![flagged.into(), always.into()]),
            &["--flag", "--level", "x", "nope"],
        )
        .await,
        support::usage(UNKNOWN_NOPE)
    );
    assert!(seen(&validated).is_empty());
}

#[tokio::test]
async fn a_routed_run_has_no_held_unknown_or_stated_code() {
    let reader =
        Plugin::new("@fixture/reader").middleware(Activation::Always, |ctx, next| async move {
            assert!(ctx.unknown_command.is_none());
            assert_eq!(ctx.invoked_by, InvokedBy::Argv);
            assert_eq!(ctx.exit_code(), None);
            assert_eq!(next.run().await?, ChainOutcome::Dispatched);
            Ok(())
        });
    assert_eq!(
        support::run(&notes(vec![reader.into()]), &["add"])
            .await
            .status,
        0
    );
}

fn silent(code: u8) -> support::Ran {
    support::Ran {
        status: code,
        stdout: String::new(),
        stderr: String::new(),
    }
}

fn taker(code: u8) -> Plugin {
    Plugin::new("@fixture/taker").middleware(Activation::Always, move |ctx, _| async move {
        ctx.set_exit_code(ExitCode::new(code));
        Ok(())
    })
}

#[tokio::test]
async fn a_takeover_exits_with_its_stated_code_and_prints_nothing() {
    for code in [3, 255] {
        assert_eq!(
            support::run(&notes(vec![taker(code).into()]), &["nope"]).await,
            silent(code)
        );
    }
}

#[tokio::test]
async fn a_takeover_with_no_assignment_exits_zero() {
    let taker =
        Plugin::new("@fixture/taker").middleware(Activation::Always, |_, _| async { Ok(()) });
    assert_eq!(
        support::run(&notes(vec![taker.into()]), &["nope"]).await,
        silent(0)
    );
}

#[tokio::test]
async fn the_last_assignment_wins_after_catching_the_held_fault() {
    let outer =
        Plugin::new("@fixture/outer").middleware(Activation::Always, |ctx, next| async move {
            assert!(
                next.run()
                    .await
                    .unwrap_err()
                    .downcast_failure::<UnknownCommandError>()
                    .is_some()
            );
            assert_eq!(ctx.exit_code(), Some(ExitCode::new(3)));
            ctx.set_exit_code(ExitCode::new(4));
            Ok(())
        });
    let inner =
        Plugin::new("@fixture/inner").middleware(Activation::Always, |ctx, next| async move {
            ctx.set_exit_code(ExitCode::new(3));
            next.run().await?;
            Ok(())
        });
    assert_eq!(
        support::run(&notes(vec![outer.into(), inner.into()]), &["nope"]).await,
        silent(4)
    );
}

#[tokio::test]
async fn catching_a_provider_failure_takes_over_before_dispatch() {
    let broken = Provider::new("broken", |_| async {
        Err::<String, _>(std::io::Error::other("provider unavailable").into())
    });
    let outer =
        Plugin::new("@fixture/outer").middleware(Activation::Always, |_, next| async move {
            assert_eq!(next.run().await?, ChainOutcome::TakenOver);
            Ok(())
        });
    let catcher =
        Plugin::new("@fixture/catcher").middleware(Activation::Always, |ctx, next| async move {
            assert_eq!(
                next.run().await.unwrap_err().foreign().unwrap().to_string(),
                "provider unavailable"
            );
            ctx.set_exit_code(ExitCode::new(75));
            Ok(())
        });
    let app = loomcli_core::Application::new("notes")
        .plugins((outer, catcher))
        .command(Command::new("add").uses([&broken]).action(|_| async {
            panic!("the provider failed");
            #[allow(unreachable_code)]
            Ok(())
        }));
    assert_eq!(support::run(&app, &["add"]).await, silent(75));
}

#[tokio::test]
async fn dispatch_ignores_the_stated_exit_code() {
    let stater =
        Plugin::new("@fixture/stater").middleware(Activation::Always, |ctx, next| async move {
            ctx.set_exit_code(ExitCode::new(5));
            assert_eq!(next.run().await?, ChainOutcome::Dispatched);
            Ok(())
        });
    assert_eq!(
        support::run(&notes(vec![stater.into()]), &["add"]).await,
        silent(0)
    );
}

#[tokio::test]
async fn a_failure_wins_over_the_stated_exit_code() {
    let stater =
        Plugin::new("@fixture/stater").middleware(Activation::Always, |ctx, _| async move {
            ctx.set_exit_code(ExitCode::new(6));
            Err(ctx.out.fatal("Run failed."))
        });
    assert_eq!(
        support::run(&notes(vec![stater.into()]), &["nope"]).await,
        support::Ran {
            status: 1,
            stdout: String::new(),
            stderr: "Run failed.\n".to_owned()
        }
    );
}

#[tokio::test]
async fn a_named_invocation_holds_the_unmatched_path_and_leaves_named_values_unread() {
    let reader =
        Plugin::new("@fixture/reader").middleware(Activation::Always, |ctx, next| async move {
            assert_eq!(ctx.invoked_by, InvokedBy::Name);
            assert_eq!(ctx.command.path, ["cache"]);
            let held = ctx.unknown_command.as_deref().unwrap();
            assert_eq!(held.word, "nope");
            assert_eq!(held.rest, ["x"]);
            next.run().await?;
            Ok(())
        });
    let outcome = notes(vec![reader.into()])
        .invoke(
            &["cache", "nope", "x"],
            InvocationValues::new()
                .arg("bad", "a")
                .option("bad", "b")
                .passthrough(["c"]),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    let InvocationOutcome::Failed {
        exit_code,
        messages,
        ..
    } = outcome
    else {
        panic!("expected held failure: {outcome:?}");
    };
    assert_eq!(exit_code.get(), 2);
    assert_eq!(
        messages,
        "notes: Unknown command \"nope\". Use one of: clear.\n"
    );
}

#[tokio::test]
async fn a_named_invocation_reports_the_completed_code() {
    for (app, path, code) in [
        (notes(vec![taker(7).into()]), "nope", 7),
        (notes(vec![]), "add", 0),
    ] {
        let outcome = app
            .invoke(
                &[path],
                InvocationValues::new(),
                InvokeOptions::new(),
                Some(mock_process(MockFields::new())),
            )
            .await;
        let InvocationOutcome::Completed {
            exit_code,
            output,
            messages,
        } = outcome
        else {
            panic!("expected completed outcome: {outcome:?}");
        };
        assert_eq!(exit_code.get(), code);
        assert_eq!(output, "");
        assert_eq!(messages, "");
    }
}
