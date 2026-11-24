//! Ports `box.test.ts` and `pty-pack-views.test.ts`: the box view through its own function with
//! core's measures, and through `out.render` and `out.results` on the mock process.

#![cfg(feature = "box")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use loomcli_core::style::{Glyph, nowrap, style};
use loomcli_core::{View, ViewContext};
use loomcli_plugins::boxed::{BoxConfig, boxed};
use pack_support::{
    ViewRun, lines, lines_of, measured, plain, render_each, render_result, width, words_of,
};

const PASSED: &str = "All three services passed their health checks.";

/// A box render's top border and its content lines, after checking that it is framed: rounded
/// corners, a side border on each content line, and every line one width.
fn frame_of(output: &str) -> (String, Vec<String>) {
    let shown = lines_of(output);
    let top = shown[0].clone();
    let bottom = shown.last().unwrap();
    assert!(top.starts_with(&plain(&Glyph::LineDownRightArc.marked())));
    assert!(top.ends_with(&plain(&Glyph::LineDownLeftArc.marked())));
    assert!(bottom.starts_with(&plain(&Glyph::LineUpRightArc.marked())));
    assert!(bottom.ends_with(&plain(&Glyph::LineUpLeftArc.marked())));
    let side = plain(&Glyph::LineVertical.marked());
    let inner = shown[1..shown.len() - 1]
        .iter()
        .map(|each| {
            assert!(each.starts_with(&format!("{side} ")));
            assert!(each.ends_with(&format!(" {side}")));
            let body: String = each.chars().skip(2).collect();
            let body: String = body.chars().take(body.chars().count() - 2).collect();
            body.trim_end().to_owned()
        })
        .collect();
    let widths: Vec<usize> = shown.iter().map(|each| width(each)).collect();
    assert!(widths.iter().all(|each| *each == widths[0]));
    (top, inner)
}

#[test]
fn a_text_box_with_a_title_frames_its_text_with_its_borders_dim_and_its_title_primary_and_bold() {
    for columns in [Some(60), None] {
        let output = boxed(BoxConfig::new().title("Totals"))
            .render(PASSED, &measured(columns))
            .unwrap();
        let (top, inner) = frame_of(&output);
        assert!(top.contains(" Totals "));
        assert_eq!(inner, [PASSED]);
        assert!(output.contains(&style().primary().bold().apply("Totals")));
        assert!(output.contains(&style().dim().apply(&Glyph::LineVertical.marked())));
    }
}

#[test]
fn a_text_box_without_a_title_frames_its_text() {
    for columns in [Some(60), None] {
        let (top, inner) = frame_of(
            &boxed(BoxConfig::new())
                .render(PASSED, &measured(columns))
                .unwrap(),
        );
        assert_eq!(words_of(&top).len(), 1);
        assert_eq!(inner, [PASSED]);
    }
}

#[tokio::test]
async fn a_box_renders_as_the_default_view_of_a_declared_string_result() {
    let run = ViewRun::new(&[Some(40)]);
    let data = "All checks passed.";
    let declared = render_result(
        &run,
        data,
        boxed(BoxConfig::<String>::text().title("Result")),
    )
    .await;
    let rendered = render_each(&run, move |out| async move {
        out.render(data, &boxed(BoxConfig::new().title("Result")))
            .await
    })
    .await;
    assert_eq!(declared, rendered);
}

#[test]
fn a_title_wider_than_the_text_widens_the_box_to_hold_the_title_and_a_line_after_it() {
    let output = boxed(BoxConfig::new().title("Result summary"))
        .render("ok", &measured(Some(40)))
        .unwrap();
    let (top, inner) = frame_of(&output);
    assert!(top.ends_with(" Result summary ─╮"));
    assert_eq!(inner, ["ok"]);
}

#[test]
fn a_text_box_wraps_its_text_at_columns_minus_4() {
    let (_, inner) = frame_of(
        &boxed(BoxConfig::new())
            .render(PASSED, &measured(Some(30)))
            .unwrap(),
    );
    assert!(inner.len() > 1);
    assert!(inner.iter().all(|line| line.chars().count() <= 26));
    assert_eq!(inner.join(" "), PASSED);
    assert_eq!(inner, ["All three services passed", "their health checks."]);
}

#[cfg(feature = "table")]
mod tables {
    use super::*;
    use std::sync::{Arc, Mutex};

    use loomcli_core::{override_view, view};
    /// A box's lines with no title around content lines already padded to one inner width.
    fn framed(content: &[&str]) -> Vec<String> {
        let inner = content[0].chars().count();
        let mut lines = vec![format!("╭{}╮", "─".repeat(inner + 2))];
        lines.extend(content.iter().map(|text| format!("│ {text} │")));
        lines.push(format!("╰{}╯", "─".repeat(inner + 2)));
        lines
    }

    use loomcli_core::RowViews;
    use loomcli_plugins::table::{Column, TableConfig, table};
    use pack_support::render_rows;
    use serde_json::{Value, json};

    fn pools() -> Vec<Value> {
        vec![
            json!({ "pool": "blue", "instances": 4, "status": "ready" }),
            json!({ "pool": "green", "instances": 4, "status": "warming" }),
        ]
    }

    fn tasks() -> Vec<Value> {
        vec![
            json!({ "name": "build", "note": "compiles everything" }),
            json!({ "name": "lint", "note": "checks style" }),
        ]
    }

    fn task_table() -> View<[Value]> {
        table(vec![
            Column::new("name").header("NAME"),
            Column::new("note").header("NOTE"),
        ])
    }

    #[test]
    fn a_box_frames_a_table() {
        for columns in [Some(60), None] {
            let view = boxed(
                BoxConfig::new()
                    .title("Pools")
                    .content(table(TableConfig::new())),
            );
            let (top, inner) = frame_of(&view.render(&pools(), &measured(columns)).unwrap());
            assert!(top.contains(" Pools "));
            let words: Vec<Vec<String>> = inner.iter().map(|line| words_of(line)).collect();
            assert_eq!(
                words,
                [
                    vec!["pool", "instances", "status"],
                    vec!["blue", "4", "ready"],
                    vec!["green", "4", "warming"],
                ]
            );
        }
    }

    #[tokio::test]
    async fn a_boxed_table_renders_as_the_default_view_of_a_declared_rows_result() {
        let run = ViewRun::new(&[Some(60)]);
        let framed = || {
            boxed(
                BoxConfig::new()
                    .title("Pools")
                    .content(table(TableConfig::new())),
            )
        };
        let declared = render_rows(&run, pools(), RowViews::new().view("view", framed())).await;
        let rendered = render_each(&run, move |out| async move {
            out.render(&pools(), &framed()).await
        })
        .await;
        assert_eq!(declared, rendered);
    }

    #[test]
    fn a_framed_table_renders_at_the_columns_the_box_leaves_it_and_shrinks_to_fit_them() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let watched = Arc::clone(&seen);
        let content = task_table();
        let watching = View::new(move |rows: &[Value], context: &ViewContext| {
            watched.lock().unwrap().push(context.columns);
            content.render(rows, context)
        });
        let view = boxed(BoxConfig::new().title("Tasks").content(watching));
        let output = view.render(&tasks(), &measured(Some(26))).unwrap();
        let (_, inner) = frame_of(&output);
        assert_eq!(*seen.lock().unwrap(), [Some(22)]);
        assert!(lines_of(&output).iter().all(|line| width(line) <= 26));
        assert!(
            !inner
                .iter()
                .any(|line| line.contains("compiles everything"))
        );
        let words = words_of(&inner.join("\n"));
        for word in [
            "NAME",
            "NOTE",
            "build",
            "compiles",
            "everything",
            "lint",
            "checks",
            "style",
        ] {
            assert!(words.iter().any(|each| each == word), "{word} is missing");
        }
    }

    #[test]
    fn a_framed_table_falls_back_to_records_when_its_floors_do_not_fit_inside_the_box() {
        let view = boxed(BoxConfig::new().content(task_table()));
        let (_, inner) = frame_of(&view.render(&tasks(), &measured(Some(20))).unwrap());
        assert!(
            !inner
                .iter()
                .any(|line| line.contains("NAME") && line.contains("NOTE"))
        );
        assert_eq!(
            inner.iter().filter(|line| line.starts_with("NAME")).count(),
            2
        );
        assert_eq!(
            inner.iter().filter(|line| line.starts_with("NOTE")).count(),
            2
        );
        let words = words_of(&inner.join("\n"));
        for word in ["build", "compiles", "everything", "lint", "checks", "style"] {
            assert!(words.iter().any(|each| each == word), "{word} is missing");
        }
    }

    #[tokio::test]
    async fn a_declared_view_override_does_not_apply_inside_a_box() {
        let declared = view(
            "@fixture/pack-views/table",
            table::<Value>(TableConfig::new()),
        );
        let replacement: View<[Value]> =
            View::new(|_: &[Value], _: &ViewContext| "override\n".to_owned());
        let run =
            ViewRun::new(&[None]).overrides(vec![override_view(declared.clone(), replacement)]);
        let output = render_each(&run, move |out| {
            let declared = declared.clone();
            async move {
                let data = vec![json!({ "pool": "blue" })];
                out.render(&data, &declared).await?;
                out.render(&data, &boxed(BoxConfig::new().content(declared.clone())))
                    .await
            }
        })
        .await;
        let mut expected = vec!["override".to_owned()];
        expected.extend(framed(&["pool", "blue"]));
        let expected: Vec<&str> = expected.iter().map(String::as_str).collect();
        assert_eq!(output, lines(&expected));
    }

    #[test]
    fn a_text_box_over_the_empty_string_and_a_box_whose_content_renders_nothing_print_nothing() {
        for columns in [Some(30), None] {
            assert_eq!(
                boxed(BoxConfig::new())
                    .render("", &measured(columns))
                    .unwrap(),
                ""
            );
            let rows = boxed(BoxConfig::new().content(table::<Value>(TableConfig::new())));
            assert_eq!(rows.render(&[], &measured(columns)).unwrap(), "");
        }
    }
}

#[test]
fn a_content_view_that_ignores_columns_widens_the_box_past_them() {
    let wide: View<str> = View::new(|_: &str, _: &ViewContext| format!("{}\n", "w".repeat(50)));
    let output = boxed(BoxConfig::new().content(wide))
        .render("", &measured(Some(30)))
        .unwrap();
    let (_, inner) = frame_of(&output);
    assert_eq!(inner, ["w".repeat(50)]);
    assert!(width(&lines_of(&output)[0]) > 30);
}

#[test]
fn a_tab_in_piped_content_is_left_to_each_lines_padding() {
    let output = boxed(BoxConfig::new())
        .render("a\tb\nabcdefghij", &measured(None))
        .unwrap();
    // Off a terminal the pad frame expands the tab from the line's start, so the border holds.
    let (_, inner) = frame_of(&output);
    assert_eq!(inner, ["a       b", "abcdefghij"]);
    assert!(output.contains("a\tb"));
}

#[test]
fn a_tab_in_text_content_expands_on_a_terminal_before_the_box_measures_it() {
    let output = boxed(BoxConfig::new())
        .render("a\tb", &measured(Some(30)))
        .unwrap();
    let (_, inner) = frame_of(&output);
    assert_eq!(inner, ["a       b"]);
    assert!(!output.contains('\t'));
}

#[test]
fn a_text_box_over_a_frame_around_nothing_prints_nothing() {
    for data in [style().red().apply(""), nowrap("")] {
        assert_eq!(
            boxed(BoxConfig::new())
                .render(&data, &measured(Some(30)))
                .unwrap(),
            ""
        );
        assert_eq!(
            boxed(BoxConfig::new())
                .render(&data, &measured(None))
                .unwrap(),
            ""
        );
    }
}

#[cfg(feature = "prose")]
#[test]
fn a_box_whose_content_renders_a_text_that_resolves_to_no_character_prints_nothing() {
    use loomcli_plugins::prose::prose;
    for config in [BoxConfig::new(), BoxConfig::new().title("Result")] {
        let view = boxed(config.content(prose::<str>()));
        assert_eq!(
            view.render(&style().red().apply(""), &measured(Some(30)))
                .unwrap(),
            ""
        );
        assert_eq!(
            view.render(&style().red().apply(""), &measured(None))
                .unwrap(),
            ""
        );
    }
}

#[tokio::test]
async fn a_box_styles_its_borders_dim_and_its_title_primary_and_bold() {
    let run = ViewRun::new(&[Some(40)]).color(true).theme();
    let output = render_each(&run, |out| async move {
        out.render("Hi", &boxed(BoxConfig::new().title("T"))).await
    })
    .await;
    assert_eq!(
        output,
        lines(&[
            "\u{1b}[90m╭─ \u{1b}[36;1mT\u{1b}[90;22m ─╮\u{1b}[39m",
            "\u{1b}[90m│\u{1b}[39m Hi  \u{1b}[90m│\u{1b}[39m",
            "\u{1b}[90m╰─────╯\u{1b}[39m",
        ])
    );
}

// pty-pack-views.test.ts: a rule and a box either side of a resize, on the mock terminal.

#[cfg(feature = "rule")]
#[tokio::test]
async fn a_rule_and_a_box_fit_100_columns_then_60_after_a_resize() {
    use loomcli_plugins::rule::rule;
    let summary = "All three services passed their health checks, and the deploy can continue.";
    let wrapped = "All three services passed their health checks, and the";
    let output = render_each(
        &ViewRun::new(&[Some(100), Some(60)]),
        move |out| async move {
            out.render("Checks", &rule()).await?;
            out.render(summary, &boxed(BoxConfig::new().title("Result")))
                .await
        },
    )
    .await;
    let line = "─";
    let len = summary.chars().count();
    let short = wrapped.chars().count();
    assert_eq!(
        output,
        lines(&[
            &format!("── Checks {}", line.repeat(90)),
            &format!("╭─ Result {}╮", line.repeat(len - 7)),
            &format!("│ {summary} │"),
            &format!("╰{}╯", line.repeat(len + 2)),
            "--",
            &format!("── Checks {}", line.repeat(50)),
            &format!("╭─ Result {}╮", line.repeat(short - 7)),
            &format!("│ {wrapped} │"),
            &format!("│ {:<short$} │", "deploy can continue."),
            &format!("╰{}╯", line.repeat(short + 2)),
        ])
    );
}
