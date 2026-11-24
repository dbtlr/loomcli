//! Ports `fitting.test.ts`: the asking line of a text, secret, or confirm frame at the widths and
//! with the lines the contract's rules and examples name, and the list frames' exact rows. Each
//! case draws the frame through `out.draw` and compares the row with the cursor block marked `[`
//! and `]`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use loomcli_core::Context;
use loomcli_prompts::views::{
    ChoiceRow, ListFrame, ListKind, ListRow, QuestionFrame, QuestionKind, TypedFrame,
    question_frame,
};
use support::{marked, run_action, stderr_terminal};

/// The row a frame draws at `columns`, with the inverse cursor block marked `[` and `]`.
async fn row(columns: u16, frame: QuestionFrame) -> String {
    let mock = stderr_terminal(columns, 24);
    let code = run_action(&mock, move |ctx: Context| {
        let frame = frame.clone();
        async move {
            ctx.out.draw(&frame, &question_frame()).await?;
            Ok(())
        }
    })
    .await;
    assert_eq!(code, 0);
    marked(&mock.stderr_text())
}

/// A text frame with `typed` and the cursor at `cursor`, or at its end when omitted.
fn typed(text: &str, cursor: Option<usize>, message: &str) -> QuestionFrame {
    let mut frame = TypedFrame::new(QuestionKind::Text, message, text);
    frame.cursor = cursor;
    frame.into()
}

/// A text frame showing the question hint `hint` over an empty line.
fn hinted(hint: &str) -> QuestionFrame {
    TypedFrame::new(QuestionKind::Text, "Name", "")
        .hint(hint)
        .into()
}

/// An empty confirm frame with the legend for a yes prefill.
fn confirming(message: &str) -> QuestionFrame {
    TypedFrame::new(QuestionKind::Confirm, message, "")
        .hint("[Y/n]")
        .into()
}

const URL: &str = "postgres://db.local:5432/app";
const WIDE: &str = "日本語のテキスト";

#[tokio::test]
async fn a_typed_line_draws_the_head_the_middle_and_the_tail() {
    let cases: Vec<(u16, QuestionFrame, &str)> = vec![
        (16, typed(URL, Some(0), "Name"), "? › [p]ostgres://…"),
        (16, typed(URL, Some(14), "Name"), "? › …/db.[l]ocal:…"),
        (16, typed(URL, None, "Name"), "? › …l:5432/app[ ]"),
        (13, typed(WIDE, Some(3), "Name"), "? › …語[の]テ …"),
        (12, typed(WIDE, Some(0), "Name"), "? › [日]本語 …"),
        (8, typed(&format!("a{WIDE}"), Some(8), "Name"), "? › … [ト]"),
        (
            40,
            typed("a\u{200b}b", Some(1), "Name"),
            "? Name › a[\u{200b} ]b",
        ),
        (
            40,
            typed("a\u{200b}b", None, "Name"),
            "? Name › a\u{200b} b[ ]",
        ),
    ];
    for (columns, frame, expected) in cases {
        assert_eq!(row(columns, frame).await, expected, "at {columns} columns");
    }
}

#[tokio::test]
async fn a_field_narrower_than_the_window_draws_the_cursor_cell() {
    assert_eq!(row(5, typed("abcdef", Some(3), "Name")).await, "? …[d]…");
    assert_eq!(row(4, typed("abcdef", Some(3), "Name")).await, "? [d]");
    assert_eq!(row(3, typed("日本", Some(0), "Name")).await, "? […]");
}

#[tokio::test]
async fn a_long_hint_keeps_its_leading_run_and_a_hint_that_does_not_fit_drops() {
    assert_eq!(
        row(16, hinted("localhost.example")).await,
        "? › [l]ocalhost.e…"
    );
    assert_eq!(row(16, hinted(WIDE)).await, "? › [日]本語のテ …");
    assert_eq!(row(4, hinted("日本")).await, "? [ ]");
}

#[tokio::test]
async fn a_text_frame_gives_way_in_order_as_the_row_narrows() {
    for (columns, expected) in [
        (31, "? abcdefghij › [ ]"),
        (27, "? ab…hij › [ ]"),
        (22, "? … › [ ]"),
        (21, "? › [ ]"),
        (8, "? › [ ]"),
        (7, "? [ ]"),
        (3, "? [ ]"),
        (2, "?[ ]"),
        (1, "[ ]"),
    ] {
        assert_eq!(
            row(columns, typed("", None, "abcdefghij")).await,
            expected,
            "at {columns} columns"
        );
    }
}

#[tokio::test]
async fn a_long_line_keeps_the_cursor_in_the_field() {
    for (columns, text, expected) in [
        (8, "abcdef", "? › …ef[ ]"),
        (7, "abcdef", "? …def[ ]"),
        (3, "abc", "? [ ]"),
        (2, "abc", "?[ ]"),
        (1, "abc", "[ ]"),
    ] {
        assert_eq!(
            row(columns, typed(text, None, "Name")).await,
            expected,
            "at {columns} columns"
        );
    }
}

#[tokio::test]
async fn a_confirm_frame_gives_way_with_its_legend() {
    for (columns, expected) in [
        (32, "? Install [Y/n] [ ]"),
        (26, "? … [Y/n] [ ]"),
        (25, "? [Y/n] [ ]"),
        (12, "? [Y/n] [ ]"),
        (11, "? [ ]"),
    ] {
        assert_eq!(
            row(columns, confirming("Install")).await,
            expected,
            "at {columns} columns"
        );
    }
}

#[tokio::test]
async fn a_secret_field_is_the_cursor_block_over_one_space_at_every_width() {
    let secret: QuestionFrame = TypedFrame::new(QuestionKind::Secret, "Password", "").into();
    assert_eq!(row(8, secret.clone()).await, "? › [ ]");
    assert_eq!(row(40, secret).await, "? Password › [ ]");
}

fn features() -> ListFrame {
    ListFrame::new(
        ListKind::Multiselect {
            count: 1,
            min: 0,
            max: Some(2),
        },
        "Features",
        vec![
            ChoiceRow::new("Alpha")
                .description("Details")
                .selected()
                .into(),
            ListRow::Separator("Group".to_owned()),
            ChoiceRow::new("Beta").disabled("Unavailable").into(),
        ],
    )
    .highlighted(0)
    .rows(24)
}

#[tokio::test]
async fn list_frames_render_labels_separators_descriptions_search_and_compact_issues_exactly() {
    assert_eq!(
        row(80, features().into()).await,
        "? Features\n❯ ◉ Alpha\n  Group\n  ◯ Beta (Unavailable)\n  Details\n↑↓ move · Space toggle · Enter submit · 1/2 selected"
    );
    assert_eq!(
        row(
            40,
            features().issue("Choose again.").rows(1).term("a").into()
        )
        .await,
        "  ✘ Choose again."
    );
    assert_eq!(
        row(40, features().rows(1).term("a").into()).await,
        "? Features › a[ ]"
    );
}

fn alpha(kind: ListKind, message: &str) -> ListFrame {
    ListFrame::new(kind, message, vec![ChoiceRow::new("Alpha").into()]).highlighted(0)
}

#[tokio::test]
async fn a_compact_three_row_list_retains_its_issue_within_the_terminal_height() {
    assert_eq!(
        row(
            30,
            alpha(ListKind::Select, "Pick")
                .issue("Choose again.")
                .rows(3)
                .into()
        )
        .await,
        "? Pick\n❯ Alpha\n  ✘ Choose again."
    );
}

#[tokio::test]
async fn a_searching_select_advertises_typing_in_its_full_key_help() {
    assert_eq!(
        row(80, alpha(ListKind::Select, "Pick").rows(24).term("").into()).await,
        "? Pick › [ ]\n❯ Alpha\n↑↓ move · type to search · Enter select"
    );
}
