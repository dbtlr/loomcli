//! Ports `viewport.test.ts`: the select frame fits the terminal's rows and columns, clips at the
//! view context's columns, and reads the rows at each frame so its window follows a resize.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{Application, Context, View, ViewContext, override_view};
use loomcli_prompts::views::{ChoiceRow, ListFrame, ListKind, QuestionFrame, question_frame};
use loomcli_prompts::{Choice, SelectSettings, select};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, StreamName, mock_process};
use support::{App, entry, run};

/// A mock whose stderr is a terminal of `columns` and `rows`; 0 columns is a terminal that reports
/// none. `variable` is the run's `COLUMNS`.
fn terminal(columns: u16, rows: u16, keys: &[&str], variable: Option<&str>) -> Arc<MockProcess> {
    let mut fields = MockFields::new();
    if let Some(variable) = variable {
        fields = fields.env("COLUMNS", variable);
    }
    mock_process(
        fields.terminal(
            MockTerminal::new(columns, rows)
                .streams([StreamName::Stderr])
                .keys(keys.iter().map(|keys| entry(keys))),
        ),
    )
}

fn ten() -> Vec<Choice<String>> {
    (0..10)
        .map(|index| Choice::text(format!("choice-{index}")))
        .collect()
}

/// A select over ten choices, `choice-3` its default; answers the answer, the code, and the most
/// rows any frame it drew moves down, counted by drawing each frame once more after it answered.
async fn flow(columns: u16, rows: u16, message: &'static str) -> (String, u8, usize) {
    let mock = terminal(columns, rows, &["\r"], None);
    let frames = Arc::new(Mutex::new(Vec::<QuestionFrame>::new()));
    let recorded = Arc::clone(&frames);
    let result = Arc::new(Mutex::new((String::new(), 0_usize)));
    let kept = Arc::clone(&result);
    let app: App = Application::new("viewport")
        .description("Render a bounded select frame.")
        .overrides([override_view(
            question_frame(),
            View::new(move |data: &QuestionFrame, context: &ViewContext| {
                recorded.lock().unwrap().push(data.clone());
                question_frame().render(data, context)
            }),
        )])
        .action(move |ctx: Context| {
            let frames = Arc::clone(&frames);
            let kept = Arc::clone(&kept);
            async move {
                let answer = select(
                    &ctx,
                    SelectSettings::new(message, ten()).default("choice-3".to_owned()),
                )
                .await?;
                let drawn: Vec<QuestionFrame> = frames.lock().unwrap().clone();
                let mut advanced = 0;
                for frame in drawn {
                    let count = ctx.out.draw(&frame, &question_frame()).await?;
                    advanced = advanced.max(count);
                    let erase = format!("\r\u{1b}[{count}A\u{1b}[J");
                    ctx.out
                        .draw(
                            erase.as_str(),
                            &View::new(|value: &str, _| value.to_owned()),
                        )
                        .await?;
                }
                *kept.lock().unwrap() = (answer, advanced);
                Ok(())
            }
        });
    let code = run(app, &mock).await;
    let (answer, advanced) = result.lock().unwrap().clone();
    (answer, code, advanced)
}

#[tokio::test]
async fn the_default_select_frame_fits_its_columns_and_rows_including_its_cursor_row() {
    for (columns, rows) in [(80, 5), (8, 10), (40, 5), (8, 5), (80, 3), (80, 1)] {
        let (answer, code, advanced) = flow(
            columns,
            rows,
            "Which database should store this workspace’s tasks?",
        )
        .await;
        assert_eq!((answer.as_str(), code), ("choice-3", 0), "{columns}x{rows}");
        assert!(advanced < usize::from(rows), "{columns}x{rows}: {advanced}");
    }
}

/// The lines of the frame a one-shot draw wrote, with terminal controls removed.
fn frame_lines(drawn: &str) -> Vec<String> {
    support::strip(drawn)
        .replace('\r', "")
        .split('\n')
        .map(str::to_owned)
        .collect()
}

const LONG_MESSAGE: &str =
    "Which database should store this workspace’s tasks, now and for every project in the future?";

/// The width of the compact frame's title at `columns` under `variable`.
async fn title_width(columns: u16, variable: Option<&str>) -> usize {
    let mock = terminal(columns, 3, &[], variable);
    let app: App = Application::new("viewport")
        .description("Render a bounded select frame.")
        .action(|ctx: Context| async move {
            let frame: QuestionFrame = ListFrame::new(
                ListKind::Select,
                LONG_MESSAGE,
                ["choice-3", "choice-4", "choice-5", "choice-6", "choice-7"]
                    .iter()
                    .map(|label| ChoiceRow::new(*label).into())
                    .collect(),
            )
            .highlighted(0)
            .hidden(3, 2)
            .rows(3)
            .into();
            ctx.out.draw(&frame, &question_frame()).await?;
            Ok(())
        });
    assert_eq!(run(app, &mock).await, 0);
    frame_lines(&mock.stderr_text())[0].chars().count()
}

#[tokio::test]
async fn the_compact_select_frame_clips_at_the_context_columns_narrowed_by_columns() {
    assert_eq!(
        title_width(100, None).await,
        format!("? {LONG_MESSAGE}").chars().count()
    );
    let narrowed = title_width(100, Some("60")).await;
    assert!(narrowed <= 60 && narrowed > 40, "{narrowed}");
}

#[tokio::test]
async fn the_compact_select_frame_clips_at_80_columns_when_the_terminal_reports_none() {
    let width = title_width(0, None).await;
    assert!(width <= 80 && width > 60, "{width}");
}

/// One step of a resize plan: the key to press, and the rows to set once the frame before it drew.
#[derive(Clone, Copy)]
struct Step {
    down: bool,
    rows: Option<u16>,
}

/// What each select frame showed: the rows above, the visible choices, and stderr's rows.
type Shown = (usize, usize, Option<u16>);

/// A select over ten choices whose stderr height is read live, resized as the plan says.
async fn resized(rows: u16, steps: Vec<Step>) -> (u8, Vec<Shown>) {
    let keys: String = steps
        .iter()
        .map(|step| if step.down { "\u{1b}[B" } else { "\u{1b}[A" })
        .collect::<String>()
        + "\r";
    let mock = mock_process(
        MockFields::new().terminal(
            MockTerminal::new(80, rows)
                .streams([StreamName::Stderr])
                .keys([entry(&keys)]),
        ),
    );
    let shown = Arc::new(Mutex::new(Vec::<Shown>::new()));
    let recorded = Arc::clone(&shown);
    let plan = Arc::new(Mutex::new(steps));
    let resizing = Arc::clone(&mock);
    let app: App = Application::new("resize")
        .description("Ask a select across resizes.")
        .overrides([override_view(
            question_frame(),
            View::new(move |data: &QuestionFrame, context: &ViewContext| {
                if let QuestionFrame::List(list) = data
                    && list.kind == ListKind::Select
                {
                    recorded
                        .lock()
                        .unwrap()
                        .push((list.above, list.choices.len(), list.rows));
                    let mut plan = plan.lock().unwrap();
                    if !plan.is_empty() {
                        let next = plan.remove(0);
                        if let Some(rows) = next.rows {
                            resizing.resize(80, rows);
                        }
                    }
                }
                question_frame().render(data, context)
            }),
        )])
        .action(|ctx: Context| async move {
            select(&ctx, SelectSettings::new("Backend", ten())).await?;
            Ok(())
        });
    let code = run(app, &mock).await;
    let shown = shown.lock().unwrap().clone();
    (code, shown)
}

#[tokio::test]
async fn the_select_window_reads_the_rows_at_each_frame_so_its_count_follows_a_resize() {
    let (code, shown) = resized(
        30,
        vec![
            Step {
                down: true,
                rows: Some(6),
            },
            Step {
                down: true,
                rows: Some(30),
            },
        ],
    )
    .await;
    assert_eq!(code, 0);
    assert_eq!(shown, [(0, 7, Some(30)), (0, 2, Some(6)), (0, 7, Some(30))]);
}

#[tokio::test]
async fn a_window_that_grows_after_scrolling_shows_as_many_choices_as_fit_ending_at_the_last() {
    let mut steps = vec![
        Step {
            down: true,
            rows: None
        };
        8
    ];
    steps.push(Step {
        down: false,
        rows: Some(30),
    });
    let (code, shown) = resized(6, steps).await;
    assert_eq!(code, 0);
    assert_eq!(shown[shown.len() - 2], (7, 2, Some(6)));
    assert_eq!(shown[shown.len() - 1], (3, 7, Some(30)));
}
