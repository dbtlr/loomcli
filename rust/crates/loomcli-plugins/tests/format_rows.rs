//! The formatter's JSON Lines row view and its whole-view counterpart.

#![cfg(feature = "format")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod format_support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Build, Command, Context, Error, Group, NoInputs, NoResult, ReleaseFacts,
    RowSource, RowViews, RowsResult, RunOptions, View,
};
use loomcli_plugins::format::{format, jsonl, jsonl_rows_mapped};
use loomcli_testing::{MockFields, mock_process};
use serde::{Serialize, Serializer};
use serde_json::{Value, json};

use format_support::{ran, run};

const ARGV: &[&str] = &["list", "--format", "jsonl"];
const INTERNAL: &str = "{\"error\":{\"code\":\"internal\",\"exitCode\":1,\"message\":\"Something went wrong.\",\"hints\":[]}}\n";

fn app<R: Serialize + Send + Sync + 'static>(
    views: RowViews<R>,
    source: impl Fn() -> RowSource<R> + Send + Sync + 'static,
) -> Application<NoInputs, NoResult, Group> {
    Application::new("rows")
        .plugins([format()])
        .command(Command::new("list").rows(views).action(
            move |ctx: Context<NoInputs, RowsResult<R>>| {
                let source = source();
                async move { ctx.out.results(source).await }
            },
        ))
}

fn views<R: Serialize + 'static>(whole: bool) -> RowViews<R> {
    let views = RowViews::new().view("table", View::new(|_: &[R], _| String::new()));
    if whole {
        views.view("jsonl", jsonl::<[R]>())
    } else {
        views
    }
}

fn with_rows<R: Clone + Serialize + Send + Sync + 'static>(
    rows: Vec<R>,
    whole: bool,
) -> Application<NoInputs, NoResult, Group> {
    app(views(whole), move || rows.clone().into())
}

#[tokio::test]
async fn the_first_line_is_written_before_the_source_pulls_its_second_row() {
    let process = mock_process(
        MockFields::new()
            .argv(ARGV.iter().copied())
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let observed = Arc::new(Mutex::new(Vec::new()));
    let app = app(views(false), {
        let process = Arc::clone(&process);
        let observed = Arc::clone(&observed);
        move || {
            let process = Arc::clone(&process);
            let observed = Arc::clone(&observed);
            RowSource::iter((1..=2).map(move |count| {
                observed.lock().unwrap().push(process.stdout_text());
                json!({"count":count})
            }))
        }
    });
    let status = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(status.get(), 0);
    assert_eq!(process.stdout_text(), "{\"count\":1}\n{\"count\":2}\n");
    assert_eq!(process.stderr_text(), "");
    assert_eq!(*observed.lock().unwrap(), ["", "{\"count\":1}\n"]);
}

#[derive(Clone)]
struct Wrapped(u8);

impl Serialize for Wrapped {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        json!({"wrapped":self.0}).serialize(serializer)
    }
}

#[tokio::test]
async fn rows_and_whole_views_write_identical_json_lines_for_objects() {
    for whole in [false, true] {
        assert_eq!(
            run(
                &with_rows(vec![json!({"count":1}), json!({"count":2})], whole),
                ARGV
            )
            .await,
            ran(0, "{\"count\":1}\n{\"count\":2}\n", "")
        );
    }
}

#[tokio::test]
async fn rows_and_whole_views_honor_serialization_escape_controls_and_handle_no_rows() {
    for whole in [false, true] {
        assert_eq!(
            run(&with_rows(vec![Wrapped(1), Wrapped(2)], whole), ARGV).await,
            ran(0, "{\"wrapped\":1}\n{\"wrapped\":2}\n", "")
        );
        assert_eq!(
            run(&with_rows(vec!["a\u{1b}b\u{9b}c\u{7f}d"], whole), ARGV).await,
            ran(0, "\"a\\u001bb\\u009bc\\u007fd\"\n", "")
        );
        assert_eq!(
            run(&with_rows(Vec::<Value>::new(), whole), ARGV).await,
            ran(0, "", "")
        );
    }
}

#[tokio::test]
async fn mapping_applies_to_each_row_including_rows_that_map_to_arrays() {
    let numbers = app(
        views(false).view(
            "jsonl",
            jsonl_rows_mapped(|row: &Value| row["count"].clone()),
        ),
        || vec![json!({"count":1}), json!({"count":2})].into(),
    );
    assert_eq!(run(&numbers, ARGV).await, ran(0, "1\n2\n", ""));
    let arrays = app(
        views(false).view("jsonl", jsonl_rows_mapped(|&row: &u8| [row, row])),
        || vec![1_u8, 2].into(),
    );
    assert_eq!(run(&arrays, ARGV).await, ran(0, "[1,1]\n[2,2]\n", ""));
}

#[tokio::test]
async fn a_source_failure_keeps_streamed_lines_and_has_one_encoded_failure_line() {
    let app = app(views(false), || {
        RowSource::try_iter([
            Ok(json!({"count":1})),
            Ok(json!({"count":2})),
            Err(Error::from_foreign("source failed".into())),
        ])
    });
    assert_eq!(
        run(&app, ARGV).await,
        ran(1, "{\"count\":1}\n{\"count\":2}\n", INTERNAL)
    );
}

#[derive(Clone)]
enum EncodableRow {
    Data,
    Invalid,
}

impl Serialize for EncodableRow {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Data => json!({"a":1}).serialize(serializer),
            Self::Invalid => Err(serde::ser::Error::custom("cannot serialize fixture row")),
        }
    }
}

#[tokio::test]
async fn an_unencodable_row_keeps_only_lines_the_view_already_wrote() {
    for whole in [false, true] {
        let app = with_rows(vec![EncodableRow::Data, EncodableRow::Invalid], whole);
        let stdout = if whole { "" } else { "{\"a\":1}\n" };
        assert_eq!(run(&app, ARGV).await, ran(1, stdout, INTERNAL));
    }
}

#[tokio::test]
async fn a_hook_added_view_reports_the_encode_failure_for_an_integer_beyond_json_data() {
    assert_eq!(
        run(&with_rows(vec![u128::MAX], false), ARGV).await,
        ran(1, "", INTERNAL)
    );
}

#[test]
fn the_graph_publishes_the_media_type_for_streaming_and_whole_jsonl() {
    for whole in [false, true] {
        let app = with_rows(Vec::<Value>::new(), whole);
        let graph = app.inspect().unwrap();
        let result = graph.command(&["list"]).unwrap().result.as_ref().unwrap();
        assert_eq!(result.media_types["jsonl"], json!("application/jsonl"));
    }
}
