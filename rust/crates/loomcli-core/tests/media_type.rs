//! The run's media type through middleware, dispatch, and encoded failures.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Activation, AnyPlugin, Application, Build, Command, Context, Group, NoInputs, NoResult, Plugin,
    ReleaseFacts, ResultViews, ValueResult, View, encode_failure,
};

type App = Application<NoInputs, NoResult, Group>;

fn views() -> ResultViews<String> {
    ResultViews::new()
        .view("plain", View::new(|value: &String, _| format!("{value}\n")))
        .view(
            "wire",
            View::new(|value: &String, _| format!("{value:?}\n")).media_type("application/json"),
        )
}

async fn emit(ctx: Context<NoInputs, ValueResult<String>>) -> loomcli_core::Outcome {
    ctx.out.results("a".to_owned()).await
}

fn app(plugins: Vec<AnyPlugin>) -> App {
    Application::new("notes")
        .plugins(plugins)
        .command(Command::new("list").result(views()).action(emit))
}

fn stating(view: Option<&'static str>, take_over: bool) -> Plugin {
    Plugin::new("@fixture/stating").middleware(Activation::Always, move |ctx, next| async move {
        ctx.set_media_type("application/json");
        if let Some(view) = view {
            ctx.select_view(view);
        }
        if !take_over {
            next.run().await?;
        }
        Ok(())
    })
}

fn distributed(stderr: &str, status: u8, stdout: &str) -> support::Ran {
    support::Ran {
        status,
        stdout: stdout.to_owned(),
        stderr: stderr.to_owned(),
    }
}

async fn developed<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    argv: &[&str],
) -> support::Ran {
    support::run_with(
        app,
        support::fields(argv, &[]).release(ReleaseFacts::new(Build::Development)),
    )
    .await
}

#[tokio::test]
async fn the_media_type_follows_the_selected_view() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let reader = Arc::clone(&observed);
    let reader = Plugin::new("@fixture/reader").middleware(Activation::Always, move |ctx, next| {
        let reader = Arc::clone(&reader);
        async move {
            reader.lock().unwrap().push(ctx.media_type());
            ctx.select_view("wire");
            reader.lock().unwrap().push(ctx.media_type());
            ctx.select_view("plain");
            reader.lock().unwrap().push(ctx.media_type());
            next.run().await?;
            Ok(())
        }
    });
    assert_eq!(
        support::run(&app(vec![reader.into()]), &["list"]).await,
        distributed("", 0, "a\n")
    );
    assert_eq!(
        *observed.lock().unwrap(),
        [None, Some("application/json".to_owned()), None]
    );
}

#[tokio::test]
async fn the_last_media_type_assigned_on_a_group_is_shared() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let first = Arc::clone(&observed);
    let second = Arc::clone(&observed);
    let first = Plugin::new("@fixture/first").middleware(Activation::Always, move |ctx, next| {
        let first = Arc::clone(&first);
        async move {
            first.lock().unwrap().push(ctx.media_type());
            ctx.set_media_type("application/x-first");
            ctx.set_media_type("application/json");
            next.run().await?;
            Ok(())
        }
    });
    let second = Plugin::new("@fixture/second").middleware(Activation::Always, move |ctx, _| {
        second.lock().unwrap().push(ctx.media_type());
        async { Ok(()) }
    });
    assert_eq!(
        support::run(&app(vec![first.into(), second.into()]), &[]).await,
        distributed("", 0, "")
    );
    assert_eq!(
        *observed.lock().unwrap(),
        [None, Some("application/json".to_owned())]
    );
}

#[tokio::test]
async fn a_failure_at_a_group_uses_the_assigned_media_type() {
    let encoder = Plugin::new("@fixture/encoder")
        .failure_encoders([encode_failure("application/json", |form| {
            format!("{}:{}\n", form.code, form.exit_code.get())
        })]);
    let app = app(vec![encoder.into(), stating(None, false).into()]);
    assert_eq!(
        support::run(&app, &[]).await,
        distributed("missing-subcommand:2\n", 2, "")
    );
}

#[tokio::test]
async fn assigning_a_media_type_on_a_result_is_a_dispatch_defect() {
    let app = app(vec![stating(None, false).into()]);
    let fields = support::fields(&["list"], &[]).release(ReleaseFacts::new(Build::Distributed));
    assert_eq!(
        support::run_with(&app, fields).await,
        distributed("notes: Something went wrong.\n", 1, "")
    );
    let ran = developed(&app, &["list"]).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (1, ""));
    assert!(ran.stderr.starts_with("-- INVALID VIEW SELECTION "));
    assert!(ran.stderr.contains("Plugin \"@fixture/stating\" assigned media type \"application/json\" on Command \"list\", which declares a result."));
    assert!(ran.stderr.contains("Assign mediaType only on a Command that declares no result; select a view by name on one that does."));
}

#[tokio::test]
async fn the_media_type_defect_names_the_root_and_ranks_after_an_invalid_view() {
    let root = Application::new("notes")
        .plugins([stating(None, false)])
        .result(views())
        .action(emit);
    let ran = developed(&root, &[]).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (1, ""));
    assert!(ran.stderr.contains("Plugin \"@fixture/stating\" assigned media type \"application/json\" on the root Command, which declares a result."));
    let ranked = developed(&app(vec![stating(Some("yaml"), false).into()]), &["list"]).await;
    assert_eq!((ranked.status, ranked.stdout.as_str()), (1, ""));
    assert!(
        ranked
            .stderr
            .contains("selected view \"yaml\", which Command \"list\" does not name.")
    );
    assert!(!ranked.stderr.contains("assigned media type"));
}

#[tokio::test]
async fn a_takeover_leaves_the_assignment_unobserved() {
    assert_eq!(
        support::run(&app(vec![stating(None, true).into()]), &["list"]).await,
        distributed("", 0, "")
    );
}
