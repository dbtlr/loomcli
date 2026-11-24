//! Ports `list-frames.test.ts`: the bytes the default view draws for select and multiselect frame
//! data. `drawn` strips styles and marks the cursor block `[` and `]`; `styled` keeps the styles,
//! with dim drawn faint and highlight drawn underlined, so a test reads which parts carry them.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use loomcli_core::{Application, Context, Plugin, ThemeMapping, style};
use loomcli_prompts::views::{
    ChoiceRow, ListFrame, ListKind, ListRow, QuestionFrame, question_frame,
};
use support::{App, run, stderr_terminal, strip};

/// What the default view writes for `frame` on a terminal of `columns`, with every style.
async fn styled(columns: u16, frame: ListFrame) -> String {
    let frame: QuestionFrame = frame.into();
    let app: App = Application::new("draw")
        .plugins([Plugin::new("fixture/theme").theme(
            ThemeMapping::new()
                .entry("dim", style().faint())
                .entry("highlight", style().underline()),
        )])
        .action(move |ctx: Context| {
            let frame = frame.clone();
            async move {
                ctx.out.draw(&frame, &question_frame()).await?;
                Ok(())
            }
        });
    let mock = stderr_terminal(columns, 24);
    assert_eq!(run(app, &mock).await, 0);
    mock.stderr_text()
}

/// The frame's text with styles stripped and the inverse cursor block marked `[` and `]`.
async fn drawn(columns: u16, frame: ListFrame) -> String {
    let text = styled(columns, frame).await;
    strip(&text.replace("\u{1b}[7m", "[").replace("\u{1b}[27m", "]"))
}

/// A select frame over `labels` with the highlight on `highlighted`, drawn in `rows`.
fn selecting(labels: &[&str], highlighted: Option<usize>, rows: u16, message: &str) -> ListFrame {
    let mut frame = ListFrame::new(
        ListKind::Select,
        message,
        labels
            .iter()
            .map(|label| ListRow::Choice(ChoiceRow::new(*label)))
            .collect(),
    )
    .rows(rows);
    frame.highlighted = highlighted;
    frame
}

#[tokio::test]
async fn a_one_row_frame_clips_each_part_it_shares() {
    for (columns, expected) in [
        (60, "❯ PostgreSQL · ? Storage backend · ↑↓ Enter · ↓ 1 more"),
        (30, "❯ P…eSQL · ? St…end · ↑↓ …more"),
    ] {
        assert_eq!(
            drawn(
                columns,
                selecting(&["PostgreSQL", "SQLite"], Some(0), 1, "Storage backend")
            )
            .await,
            expected
        );
    }
}

#[tokio::test]
async fn a_one_row_frame_drops_the_title_then_the_choice_before_it_clips_to_nothing() {
    for (columns, expected) in [(8, "❯…L · …e"), (4, "↑…re")] {
        assert_eq!(
            drawn(
                columns,
                selecting(&["PostgreSQL", "SQLite"], Some(0), 1, "Storage backend")
            )
            .await,
            expected
        );
    }
}

#[tokio::test]
async fn a_one_row_frame_shares_the_columns_the_abbreviated_key_help_leaves() {
    assert_eq!(
        drawn(
            40,
            selecting(
                &["A PostgreSQL server you run"],
                Some(0),
                1,
                "Storage backend"
            )
        )
        .await,
        "❯ A Po…ou run · ? Stora…ckend · ↑↓ Enter"
    );
}

#[tokio::test]
async fn a_compact_frame_draws_nothing_in_the_choice_row_while_its_first_call_is_loading() {
    assert_eq!(
        drawn(5, selecting(&[], None, 2, "Pick").loading().term("")).await,
        "? [ ]\nSe…g…"
    );
}

#[tokio::test]
async fn a_two_row_frame_shares_its_first_row_between_the_choice_and_the_title() {
    assert_eq!(
        drawn(
            30,
            selecting(
                &["A PostgreSQL server you run", "SQLite"],
                Some(0),
                2,
                "Storage backend"
            )
        )
        .await,
        "❯ A Po…you run · ? Stora…ckend\n↑↓ Enter · ↓ 1 more"
    );
}

#[tokio::test]
async fn a_one_row_frame_keeps_its_issue_in_the_key_helps_place() {
    assert_eq!(
        drawn(
            40,
            selecting(&["alpha", "beta"], Some(0), 1, "Pick").issue("Choose again.")
        )
        .await,
        "❯ alpha · ? Pick · ✘ Choose again."
    );
}

#[tokio::test]
async fn markers_that_join_the_key_help_keep_their_order() {
    assert_eq!(
        drawn(
            80,
            selecting(&["c1", "c2", "c3", "c4", "c5"], Some(2), 3, "Pick")
        )
        .await,
        "? Pick\n❯ c3\n↑↓ move · Enter select · ↑ 2 more · ↓ 2 more"
    );
}

#[tokio::test]
async fn the_key_help_abbreviates_when_the_markers_that_join_it_do_not_fit() {
    assert_eq!(
        drawn(24, selecting(&["c1", "c2", "c3"], Some(0), 3, "Pick")).await,
        "? Pick\n❯ c1\n↑↓ Enter · ↓ 2 more"
    );
}

#[tokio::test]
async fn a_multiselect_keeps_its_count_when_the_markers_that_join_its_key_help_abbreviate_it() {
    let mut frame = selecting(&["c1", "c2", "c3"], Some(0), 3, "Pick");
    frame.kind = ListKind::Multiselect {
        count: 1,
        min: 0,
        max: Some(3),
    };
    assert_eq!(
        drawn(55, frame).await,
        "? Pick\n❯ ◯ c1\n↑↓ Space Enter · 1/3 selected · ↓ 2 more"
    );
}

#[tokio::test]
async fn the_compact_title_clips_the_message_to_the_columns_the_mark_leaves() {
    assert_eq!(
        drawn(
            12,
            selecting(&["c1", "c2", "c3"], Some(0), 3, "abcdefghijklmnop")
        )
        .await,
        "? abcd…lmnop\n❯ c1\n↑↓ En…2 more"
    );
}

#[tokio::test]
async fn the_height_estimate_counts_a_line_as_wide_as_the_columns_as_two_rows() {
    assert_eq!(
        drawn(12, selecting(&["a", "b"], Some(0), 5, "abcdefghij")).await,
        "? abcdefghij\n❯ a\n↓ 1 more\n↑↓ Enter"
    );
}

#[tokio::test]
async fn a_search_with_no_rows_draws_no_matches_and_a_loading_one_draws_searching_alone() {
    let empty = selecting(&[], None, 24, "Pick").term("zz");
    assert_eq!(
        drawn(80, empty.clone()).await,
        "? Pick › zz[ ]\n  No matches\n↑↓ move · type to search · Enter select"
    );
    assert_eq!(
        drawn(80, empty.loading().term("")).await,
        "? Pick › [ ]\nSearching…"
    );
}

#[tokio::test]
async fn a_disabled_choice_without_a_reason_draws_disabled() {
    let mut frame = selecting(&["sqlite"], Some(0), 24, "Pick");
    frame.choices = vec![
        ChoiceRow::new("sqlite").into(),
        ChoiceRow::new("Neon").disabled("").into(),
    ];
    assert_eq!(
        drawn(80, frame).await,
        "? Pick\n❯ sqlite\n  Neon (disabled)\n↑↓ move · Enter select"
    );
}

#[tokio::test]
async fn a_choice_a_full_max_keeps_out_draws_its_mark_and_label_dim_and_its_pointer_highlighted() {
    let mut frame = selecting(&[], Some(1), 24, "Pick");
    frame.choices = vec![
        ChoiceRow::new("Backups").selected().into(),
        ChoiceRow::new("Telemetry").into(),
        ChoiceRow::new("Logs").into(),
    ];
    frame.kind = ListKind::Multiselect {
        count: 1,
        min: 0,
        max: Some(1),
    };
    assert_eq!(
        styled(80, frame.clone()).await,
        [
            "\u{1b}[1m?\u{1b}[22m \u{1b}[1mPick\u{1b}[22m",
            "  \u{1b}[4m◉\u{1b}[24m Backups",
            "\u{1b}[4m❯ \u{1b}[24;2m◯ Telemetry\u{1b}[22m",
            "  \u{1b}[2m◯ Logs\u{1b}[22m",
            "\u{1b}[2m↑↓ move · Space toggle · Enter submit · 1/1 selected\u{1b}[22m",
        ]
        .join("\n")
    );
    assert_eq!(
        styled(80, frame.rows(3)).await,
        [
            "\u{1b}[1m?\u{1b}[22m \u{1b}[1mPick\u{1b}[22m",
            "\u{1b}[4m❯\u{1b}[24;2m ◯ Telemetry\u{1b}[22m",
            "\u{1b}[2m↑↓ move · Space toggle · Enter submit · 1/1 selected · ↑ 1 more · ↓ 1 more\u{1b}[22m",
        ]
        .join("\n")
    );
}
