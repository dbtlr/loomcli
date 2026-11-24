//! Ports `records.test.ts`, the records cases of `records-fit.test.ts`, and `pty-table.test.ts`'s
//! streamed records: the records view through `out.render` and `out.results` on the mock process,
//! and its wrapping through the view's own functions with core's measures.

#![cfg(feature = "records")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use loomcli_core::{RowView, RowViews, ViewContext};
use loomcli_plugins::records::{Field, RecordsConfig, records};
use pack_support::{
    ViewRun, assert_fits, indent_of, lines, lines_of, measured, render_each, render_rows,
    render_stream, words_of,
};
use serde_json::{Value, json};

/// A red style frame around `data`, written out as the reference's marker.
const MARKER: &str = "\u{E000}[\"style\",[[\"foreground\",\"red\"]]]\u{E001}data\u{E002}";

/// What a records view prints for `rows` through `out.render` on a pipe.
async fn rendered(rows: Vec<Value>, view: RowView<Value>) -> String {
    render_each(&ViewRun::new(&[None]), move |out| {
        let rows = rows.clone();
        let view = view.clone();
        async move { out.render(rows, &view).await }
    })
    .await
}

/// What a row view prints for `rows` and their counted tail, on one context.
fn rendered_on(view: &RowView<Value>, rows: &[Value], context: &ViewContext) -> String {
    let mut output = String::new();
    for (index, row) in rows.iter().enumerate() {
        output.push_str(&view.render_row(row, index, context).unwrap());
    }
    output.push_str(&view.render_tail(rows.len(), context).unwrap());
    output
}

/// The lines a row view shows for `rows` at `columns`, or piped for `None`, with its tail.
fn shown(view: &RowView<Value>, rows: &[Value], columns: Option<u16>) -> Vec<String> {
    lines_of(&rendered_on(view, rows, &measured(columns)))
}

// records.test.ts

#[tokio::test]
async fn rows_and_a_counted_tail_render_through_out_render() {
    let rows = vec![
        json!({ "key": "user", "kind": "object with 3 keys" }),
        json!({ "key": "tags", "kind": "array with 2 items" }),
    ];
    assert_eq!(
        rendered(rows, records(RecordsConfig::new("key"))).await,
        lines(&[
            "key   user",
            "kind  object with 3 keys",
            "",
            "key   tags",
            "kind  array with 2 items",
            "",
            "2 records"
        ])
    );
}

#[tokio::test]
async fn records_render_as_a_declared_row_view_through_out_results() {
    let rows = vec![json!({ "key": "user", "kind": "object" })];
    let views = RowViews::new().view("records", records(RecordsConfig::new("key")));
    assert_eq!(
        render_rows(&ViewRun::new(&[None]), rows, views).await,
        "key   user\nkind  object\n\n1 record\n"
    );
}

#[tokio::test]
async fn declared_fields_share_one_key_width_and_keep_their_order_across_rows() {
    let rows = vec![
        json!({ "key": "user", "kind": "object" }),
        json!({ "key": "tags", "kind": "array" }),
    ];
    let view = records(RecordsConfig::new("key").fields(&["kind", "key"]));
    assert_eq!(
        rendered(rows, view).await,
        lines(&[
            "kind  object",
            "key   user",
            "",
            "kind  array",
            "key   tags",
            "",
            "2 records"
        ])
    );
}

#[tokio::test]
async fn own_fields_are_discovered_with_a_width_local_to_each_row() {
    let rows = vec![
        json!({ "longest": "b", "short": "a" }),
        json!({ "xx": "c", "yy": "d" }),
    ];
    assert_eq!(
        rendered(rows, records(RecordsConfig::new("short"))).await,
        lines(&[
            "longest  b",
            "short    a",
            "",
            "xx  c",
            "yy  d",
            "",
            "2 records"
        ])
    );
}

#[tokio::test]
async fn null_and_undefined_print_as_empty_values() {
    let view = records(RecordsConfig::new("key").fields(&["nullish", "missing", "key"]));
    assert_eq!(
        rendered(vec![json!({ "key": "one", "nullish": null })], view).await,
        "nullish  \nmissing  \nkey      one\n\n1 record\n"
    );
}

#[tokio::test]
async fn formatted_text_stays_authored_and_default_data_values_are_escaped() {
    let view = records(RecordsConfig::new("key").field_list(vec![
            "raw".into(),
            Field::new("authored")
                .format(|value: &Value, _: &Value, _| value.as_str().unwrap().to_owned()),
        ]));
    let output = rendered(
        vec![json!({ "authored": MARKER, "key": "one", "raw": MARKER })],
        view,
    )
    .await;
    assert_eq!(output.matches(MARKER).count(), 1);
    assert!(output.contains("authored  data\n"));
}

#[tokio::test]
async fn a_data_key_is_escaped_before_its_label_is_styled() {
    let output = rendered(
        vec![json!({ MARKER: "value" })],
        records(RecordsConfig::new(MARKER)),
    )
    .await;
    assert!(output.contains(MARKER));
}

#[tokio::test]
async fn fields_that_omit_the_identifier_add_no_line_for_it() {
    let view = records(RecordsConfig::new("key").fields(&["kind"]));
    assert_eq!(
        rendered(vec![json!({ "key": "user", "kind": "object" })], view).await,
        "kind  object\n\n1 record\n"
    );
}

#[tokio::test]
async fn an_empty_sequence_prints_a_zero_record_tail() {
    assert_eq!(
        rendered(vec![], records(RecordsConfig::new("key"))).await,
        "0 records\n"
    );
}

// records-fit.test.ts

const TAGS: &str = "array of 12 strings, none empty or longer than 40 characters";

fn tag_rows() -> Vec<Value> {
    vec![json!({ "key": "tags", "kind": TAGS })]
}

#[test]
fn a_value_wraps_at_the_width_left_after_the_key_column_and_its_gap() {
    let output = shown(&records(RecordsConfig::new("key")), &tag_rows(), Some(30));
    assert_fits(&output, 30);
    let end = output.iter().position(String::is_empty).unwrap();
    let value = &output[1..end];
    assert!(value.len() > 1);
    let column = value[0].find("array").unwrap();
    for line in &value[1..] {
        assert_eq!(indent_of(line), column);
    }
    let joined: Vec<String> = value
        .iter()
        .enumerate()
        .map(|(index, line)| {
            if index == 0 {
                line["kind".len()..].trim()
            } else {
                line.trim()
            }
            .to_owned()
        })
        .collect();
    assert_eq!(joined.join(" "), TAGS);
    assert_eq!(output.last().unwrap(), "1 record");
}

#[test]
fn a_value_whose_trailing_space_would_overflow_the_width_wraps() {
    let output = shown(
        &records(RecordsConfig::new("key")),
        &[json!({ "key": "a", "note": "compile the core package " })],
        Some(18),
    );
    assert_fits(&output, 18);
    assert!(!output.iter().any(|line| line.contains("core package")));
}

/// One run-policy case: the formatter, the run, and the two value lines it prints.
type PolicyCase = (fn(&str) -> String, ViewRun, [&'static str; 2]);

#[tokio::test]
async fn a_hyperlink_or_sgr_value_that_wraps_leaves_its_continuation_indent_bare() {
    let cases: [PolicyCase; 2] = [
        (
            |value| format!("\u{1b}]8;;https://example.com\u{1b}\\{value}\u{1b}]8;;\u{1b}\\"),
            ViewRun::new(&[Some(20)]).hyperlinks(),
            [
                "note  \u{1b}]8;;https://example.com\u{1b}\\see the\u{1b}]8;;\u{1b}\\",
                "      \u{1b}]8;;https://example.com\u{1b}\\release notes\u{1b}]8;;\u{1b}\\",
            ],
        ),
        (
            |value| format!("\u{1b}[31m{value}\u{1b}[39m"),
            ViewRun::new(&[Some(20)]).color(false),
            [
                "note  \u{1b}[31msee the\u{1b}[39m",
                "      \u{1b}[31mrelease notes\u{1b}[39m",
            ],
        ),
    ];
    for (format, run, expected) in cases {
        let view = records(RecordsConfig::new("key").field_list(vec![
                "key".into(),
                Field::new("note")
                    .format(move |value: &Value, _: &Value, _| format(value.as_str().unwrap())),
            ]));
        let output = render_each(&run, move |out| {
            let view = view.clone();
            async move {
                out.render(
                    vec![json!({ "key": "a", "note": "see the release notes" })],
                    &view,
                )
                .await
            }
        })
        .await;
        let shown: Vec<&str> = output.split('\n').skip(1).take(2).collect();
        assert_eq!(shown, expected);
    }
}

#[test]
fn an_authored_line_break_in_a_value_continues_under_the_value_on_a_terminal() {
    let output = shown(
        &records(RecordsConfig::new("key")),
        &[json!({ "key": "one", "kind": "first\nsecond" })],
        Some(80),
    );
    assert!(output[1].ends_with("first"));
    assert_eq!(output[2].trim(), "second");
    assert_eq!(indent_of(&output[2]), output[1].find("first").unwrap());
}

#[test]
fn a_blank_line_in_a_styled_default_value_carries_no_indent() {
    let output = shown(
        &records(RecordsConfig::new("key")),
        &[json!({ "key": "one", "kind": "first\n\nthird" })],
        Some(80),
    );
    let words: Vec<Vec<String>> = output[1..4].iter().map(|line| words_of(line)).collect();
    assert_eq!(words, [vec!["kind", "first"], vec![], vec!["third"]]);
    assert_eq!(output[2], "");
    // The blank line is bare in the bytes too: a primary frame around nothing.
    let raw = rendered_on(
        &records(RecordsConfig::new("key")),
        &[json!({ "key": "one", "kind": "first\n\nthird" })],
        &measured(Some(80)),
    );
    assert!(!raw.split('\n').nth(2).unwrap().starts_with(' '));
}

#[test]
fn a_blank_line_in_a_plain_format_value_carries_no_indent() {
    let view = records(RecordsConfig::new("key").field_list(vec![
            "key".into(),
            Field::new("kind").format(|value: &Value, _: &Value, _| {
                format!("{}\n\nafter", value.as_str().unwrap())
            }),
        ]));
    let output = shown(&view, &[json!({ "key": "one", "kind": "first" })], Some(80));
    let words: Vec<Vec<String>> = output[1..4].iter().map(|line| words_of(line)).collect();
    assert_eq!(words, [vec!["kind", "first"], vec![], vec!["after"]]);
    assert_eq!(output[2], "");
}

#[test]
fn a_value_with_no_column_left_after_the_label_stays_unwrapped() {
    let output = shown(
        &records(RecordsConfig::new("key")),
        &[json!({ "key": "one", "kind": "two words" })],
        Some(6),
    );
    assert!(output.iter().any(|line| line.ends_with("two words")));
}

#[tokio::test]
async fn a_streamed_row_after_a_resize_wraps_at_the_new_width_and_the_rows_before_keep_theirs() {
    let rows = vec![
        json!({ "key": "before", "kind": TAGS }),
        json!({ "key": "after", "kind": TAGS }),
    ];
    let streamed = render_stream(
        &ViewRun::new(&[Some(100), Some(30)]),
        rows,
        records(RecordsConfig::new("key")),
    )
    .await;
    let output: Vec<&str> = streamed.split('\n').collect();
    assert!(output.contains(&format!("kind  {TAGS}").as_str()));
    let start = output
        .iter()
        .position(|line| *line == "key   after")
        .unwrap();
    let end = start
        + output[start..]
            .iter()
            .position(|line| line.is_empty())
            .unwrap();
    let block = &output[start..end];
    for line in block {
        assert!(line.chars().count() <= 30);
    }
    let value: Vec<&str> = block[1..]
        .iter()
        .map(|line| &line["kind  ".len()..])
        .collect();
    assert_eq!(value.join(" "), TAGS);
}

#[tokio::test]
async fn records_piped_or_invoked_by_name_are_byte_for_byte_the_natural_layout() {
    for invoke in [false, true] {
        let mut run = ViewRun::new(&[None]).env("COLUMNS", "10");
        if invoke {
            run = run.invoke();
        }
        let output = render_each(&run, |out| async move {
            out.render(
                vec![json!({ "key": "one", "kind": "first\nsecond words here" })],
                &records(RecordsConfig::new("key")),
            )
            .await
        })
        .await;
        assert_eq!(
            output,
            lines(&[
                "key   one",
                "kind  first",
                "second words here",
                "",
                "1 record"
            ])
        );
    }
}

#[tokio::test]
async fn columns_narrows_records_on_a_terminal_and_spares_a_pipe() {
    async fn at(run: ViewRun) -> String {
        render_each(&run, |out| async move {
            out.render(tag_rows(), &records(RecordsConfig::new("key")))
                .await
        })
        .await
    }
    let wrapped = at(ViewRun::new(&[Some(30)])).await;
    assert_eq!(
        at(ViewRun::new(&[Some(100)]).env("COLUMNS", "30")).await,
        wrapped
    );
    assert_eq!(
        at(ViewRun::new(&[Some(0)]).env("COLUMNS", "30")).await,
        wrapped
    );
    assert!(
        at(ViewRun::new(&[None]).env("COLUMNS", "30"))
            .await
            .contains(&format!("kind  {TAGS}\n"))
    );
}

#[cfg(feature = "table")]
#[test]
fn the_table_fallback_prints_the_same_blocks_as_the_records_view_for_the_same_labels() {
    use loomcli_plugins::table::{TableConfig, table};
    let rows = [
        json!({ "name": "abcdefghijkl", "note": "one two three four five" }),
        json!({ "name": "second", "note": "tail" }),
    ];
    let fallback = table::<Value>(TableConfig::new());
    let viewed = records(RecordsConfig::new("name"));
    let context = measured(Some(15));
    let blocks: String = rows
        .iter()
        .enumerate()
        .map(|(index, row)| viewed.render_row(row, index, &context).unwrap())
        .collect();
    // Color off, so the identifier's highlight and the fallback's primary resolve alike.
    assert_eq!(
        context.plain(&fallback.render(&rows, &measured(Some(15))).unwrap()),
        context.plain(&blocks)
    );
}

#[cfg(feature = "table")]
#[test]
fn a_blank_line_in_a_right_aligned_fallback_value_carries_no_indent_and_no_alignment() {
    use loomcli_core::style::Alignment;
    use loomcli_plugins::table::{Column, table};
    let view = table(vec![
        "name".into(),
        Column::new("note")
            .align(Alignment::Right)
            .format(|value: &Value, _: &Value, _| format!("{}\n\nafter", value.as_str().unwrap())),
    ]);
    let output = lines_of(
        &view
            .render(
                &[json!({ "name": "abcdefghijkl", "note": "one" })],
                &measured(Some(12)),
            )
            .unwrap(),
    );
    let words: Vec<Vec<String>> = output.iter().map(|line| words_of(line)).collect();
    assert_eq!(
        words,
        [
            vec!["name", "abcdefghijkl"],
            vec!["note", "one"],
            vec![],
            vec!["after"]
        ]
    );
    assert_eq!(output[2], "");
}

#[cfg(feature = "table")]
#[test]
fn a_fallback_line_with_an_empty_header_and_an_empty_value_is_an_empty_line() {
    use loomcli_plugins::table::{Column, table};
    let view = table(vec!["name".into(), Column::new("note").header("")]);
    let output = lines_of(
        &view
            .render(
                &[json!({ "name": "abcdefghijkl", "note": null })],
                &measured(Some(12)),
            )
            .unwrap(),
    );
    assert_eq!(output, ["name  abcdefghijkl", ""]);
}

#[test]
fn a_tab_in_a_value_expands_from_the_start_of_the_value_before_it_wraps() {
    let output = shown(
        &records(RecordsConfig::new("first")),
        &[json!({ "first": "b\tc" })],
        Some(16),
    );
    assert_fits(&output, 16);
    assert_eq!(output[0], "first  b       c");
}

#[test]
fn a_tab_after_a_wrapped_break_expands_from_the_start_of_the_value() {
    let output = shown(
        &records(RecordsConfig::new("first")),
        &[json!({ "first": "aaa bbbbbb\tc" })],
        Some(16),
    );
    assert!(!output.join("\n").contains('\t'));
    assert_fits(&output, 16);
    assert_eq!(output[..3], ["first  aaa", "       bbbbbb", "       c"]);
}

#[test]
fn a_tab_stays_a_tab_in_piped_records() {
    let output = shown(
        &records(RecordsConfig::new("first")),
        &[json!({ "first": "b\tc" })],
        None,
    );
    assert!(output[0].contains("b\tc"));
}

#[test]
fn a_label_line_with_an_empty_value_ends_at_its_label_on_a_terminal() {
    for (identifier, row) in [
        ("id", json!({ "id": "one", "to": null })),
        ("key", json!({ "key": "one", "to": null })),
    ] {
        let output = shown(&records(RecordsConfig::new(identifier)), &[row], Some(40));
        assert!(output.contains(&"to".to_owned()));
    }
}

#[test]
fn an_empty_value_keeps_its_label_padding_and_gap_on_a_pipe() {
    let output = shown(
        &records(RecordsConfig::new("key")),
        &[json!({ "key": "one", "to": null })],
        None,
    );
    let label = output.iter().find(|line| line.starts_with("to")).unwrap();
    assert_eq!(label.trim(), "to");
    assert_eq!(label, "to   ");
}

// pty-table.test.ts: the streamed records around a resize, on the mock terminal.

#[tokio::test]
async fn a_streamed_records_row_wraps_at_the_width_it_is_yielded_at() {
    let rows = vec![
        json!({ "key": "before", "kind": TAGS }),
        json!({ "key": "after", "kind": TAGS }),
    ];
    let output = render_stream(
        &ViewRun::new(&[Some(100), Some(60)]),
        rows,
        records(RecordsConfig::new("key")),
    )
    .await;
    assert_eq!(
        output,
        lines(&[
            "key   before",
            &format!("kind  {TAGS}"),
            "",
            "key   after",
            "kind  array of 12 strings, none empty or longer than 40",
            "      characters",
            "",
            "2 records",
        ])
    );
}
