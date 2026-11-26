//! Result transforms at the middleware and emission boundaries.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Activation, AnyPlugin, Application, Command, Context, Error, Group, InputError,
    MiddlewareContext, NoInputs, NoOptions, NoResult, Plugin, ResultTransform, ResultViews,
    RowView, RowViews, RowsResult, ValueResult, View,
};
use support::Ran;

type App = Application<NoInputs, NoResult, Group>;
type Events = Arc<Mutex<Vec<String>>>;

fn bracketed(value: String) -> Result<String, Error> {
    Ok(format!("[{value}]"))
}

fn assigning(transforms: impl Fn() -> Vec<ResultTransform> + Send + Sync + 'static) -> Plugin {
    Plugin::new("@fixture/transform").middleware(Activation::Always, move |ctx, next| {
        for transform in transforms() {
            ctx.set_transform(transform);
        }
        async move {
            next.run().await?;
            Ok(())
        }
    })
}

fn line() -> View<String> {
    View::new(|value: &String, _| format!("{value:?}\n"))
}

async fn emit(ctx: Context<NoInputs, ValueResult<String>>) -> loomcli_core::Outcome {
    ctx.out.results("a".to_owned()).await
}

fn app(plugins: Vec<AnyPlugin>, events: Events) -> App {
    Application::new("notes")
        .plugins(plugins)
        .command(
            Command::new("get")
                .result(ResultViews::new().view("line", line()))
                .action(emit),
        )
        .command(
            Command::new("list")
                .rows(
                    RowViews::new()
                        .view(
                            "rows",
                            RowView::new(|row: &String, _, _| format!("{row:?}\n"))
                                .head(|_| "head\n".to_owned())
                                .tail(|count, _| format!("tail:{count}\n")),
                        )
                        .view(
                            "whole",
                            View::new(|rows: &[String], _| {
                                format!("{}\n", serde_json::json!(rows))
                            }),
                        ),
                )
                .action(move |ctx: Context<NoInputs, RowsResult<String>>| {
                    let events = Arc::clone(&events);
                    async move {
                        ctx.out
                            .results(["a", "b"].into_iter().map(move |row| {
                                events.lock().unwrap().push(format!("yield:{row}"));
                                row.to_owned()
                            }))
                            .await
                    }
                }),
        )
}

fn observed_transform(events: Events) -> Plugin {
    assigning(move || {
        let events = Arc::clone(&events);
        vec![ResultTransform::new(move |value: String| {
            events.lock().unwrap().push(format!("transform:{value}"));
            bracketed(value)
        })]
    })
}

fn ran(status: u8, stdout: &str, stderr: &str) -> Ran {
    Ran {
        status,
        stdout: stdout.to_owned(),
        stderr: stderr.to_owned(),
    }
}

#[tokio::test]
async fn a_value_is_transformed_once_before_its_view() {
    let events = Events::default();
    let app = app(
        vec![observed_transform(Arc::clone(&events)).into()],
        Arc::clone(&events),
    );
    assert_eq!(support::run(&app, &["get"]).await, ran(0, "\"[a]\"\n", ""));
    assert_eq!(*events.lock().unwrap(), ["transform:a"]);
}

#[tokio::test]
async fn a_row_view_receives_each_transformed_row_before_the_next_pull() {
    let events = Events::default();
    let app = app(
        vec![observed_transform(Arc::clone(&events)).into()],
        Arc::clone(&events),
    );
    assert_eq!(
        support::run(&app, &["list"]).await,
        ran(0, "head\n\"[a]\"\n\"[b]\"\ntail:2\n", "")
    );
    assert_eq!(
        *events.lock().unwrap(),
        ["yield:a", "transform:a", "yield:b", "transform:b"]
    );
}

#[tokio::test]
async fn a_whole_view_collects_the_rows_before_transforming_each() {
    let events = Events::default();
    let whole =
        Plugin::new("@fixture/view").middleware(Activation::Always, |ctx, next| async move {
            ctx.select_view("whole");
            next.run().await?;
            Ok(())
        });
    let app = app(
        vec![observed_transform(Arc::clone(&events)).into(), whole.into()],
        Arc::clone(&events),
    );
    assert_eq!(
        support::run(&app, &["list"]).await,
        ran(0, "[\"[a]\",\"[b]\"]\n", "")
    );
    assert_eq!(
        *events.lock().unwrap(),
        ["yield:a", "yield:b", "transform:a", "transform:b"]
    );
}

#[tokio::test]
async fn the_last_assignment_before_dispatch_wins_across_middleware() {
    let first = assigning(|| {
        vec![
            ResultTransform::new(|_: String| Ok("first".to_owned())),
            ResultTransform::new(|_: String| Ok("second".to_owned())),
        ]
    });
    let last =
        Plugin::new("@fixture/later").middleware(Activation::Always, |ctx, next| async move {
            ctx.set_transform(ResultTransform::new(bracketed));
            next.run().await?;
            Ok(())
        });
    let app = app(vec![first.into(), last.into()], Events::default());
    assert_eq!(support::run(&app, &["get"]).await, ran(0, "\"[a]\"\n", ""));
}

#[tokio::test]
async fn an_assignment_after_the_boundary_cannot_change_the_result() {
    let saved = Arc::new(Mutex::new(None::<MiddlewareContext<NoOptions>>));
    let keeper = Arc::clone(&saved);
    let plugin = Plugin::new("@fixture/keeper").middleware(Activation::Always, move |ctx, next| {
        ctx.set_transform(ResultTransform::new(bracketed));
        *keeper.lock().unwrap() = Some(ctx);
        async move {
            next.run().await?;
            Ok(())
        }
    });
    let app = Application::new("notes")
        .plugins([plugin])
        .result(ResultViews::new().view("line", line()))
        .action(move |ctx: Context<NoInputs, ValueResult<String>>| {
            let saved = Arc::clone(&saved);
            async move {
                if let Some(held) = saved.lock().unwrap().take() {
                    held.set_transform(ResultTransform::new(|_: String| Ok("late".to_owned())));
                }
                emit(ctx).await
            }
        });
    assert_eq!(support::run(&app, &[]).await, ran(0, "\"[a]\"\n", ""));
}

#[tokio::test]
async fn an_unassigned_transform_reads_as_absent_and_the_view_gets_the_original_data() {
    let reader =
        Plugin::new("@fixture/reader").middleware(Activation::Always, |ctx, next| async move {
            assert!(ctx.transform().is_none());
            next.run().await?;
            Ok(())
        });
    let app = app(vec![reader.into()], Events::default());
    assert_eq!(support::run(&app, &["get"]).await, ran(0, "\"a\"\n", ""));
    assert_eq!(
        support::run(&app, &["list"]).await,
        ran(0, "head\n\"a\"\n\"b\"\ntail:2\n", "")
    );
}

#[tokio::test]
async fn a_transform_failure_keeps_its_class_and_previously_written_rows() {
    let broken = assigning(|| {
        vec![ResultTransform::new(|value: String| {
            if value == "b" {
                Err(InputError::new(
                    "Row \"b\" has no such field. Supply another field.",
                    Vec::new(),
                )
                .into())
            } else {
                Ok(value)
            }
        })]
    });
    let app = app(vec![broken.into()], Events::default());
    assert_eq!(
        support::run(&app, &["list"]).await,
        ran(
            2,
            "head\n\"a\"\n",
            "Output is incomplete: Command \"list\" stopped after 2 rows, 1 written.\nnotes: Row \"b\" has no such field. Supply another field.\n"
        )
    );
}

#[tokio::test]
async fn a_json_transform_on_a_typed_view_identifies_the_plugin_and_command() {
    let broken = assigning(|| vec![ResultTransform::json(Ok)]);
    let app = app(vec![broken.into()], Events::default());
    let argv = &["get"];
    let dev = support::fields(argv, &[]).release(loomcli_core::ReleaseFacts::new(
        loomcli_core::Build::Development,
    ));
    let result = support::run_with(&app, dev).await;
    assert_eq!((result.status, result.stdout.as_str()), (1, ""));
    assert!(result.stderr.contains("Plugin \"@fixture/transform\" assigned a result transform incompatible with the selected view on Command \"get\"."));
    let distributed = support::fields(argv, &[]).release(loomcli_core::ReleaseFacts::new(
        loomcli_core::Build::Distributed,
    ));
    assert_eq!(
        support::run_with(&app, distributed).await,
        ran(1, "", "notes: Something went wrong.\n")
    );
}
