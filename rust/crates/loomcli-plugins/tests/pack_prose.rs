//! Ports `prose.test.ts`: the prose view through its own function with core's measures, and
//! through `out.render` and `out.results` on the mock process.

#![cfg(feature = "prose")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use loomcli_core::style::{nowrap, style};
use loomcli_plugins::prose::prose;
use pack_support::{
    ViewRun, lines, lines_of, measured, render_each, render_result, width, words_of,
};

const SUMMARY: &str =
    "Three services rolled out to the staging cluster. One health check is still warming up.";

fn render(text: &str, columns: Option<u16>) -> String {
    prose::<str>().render(text, &measured(columns)).unwrap()
}

#[test]
fn prose_wraps_at_the_columns_on_a_terminal_and_prints_as_written_when_piped() {
    let wrapped = lines_of(&render(SUMMARY, Some(34)));
    assert!(wrapped.len() > 1);
    assert!(wrapped.iter().all(|line| width(line) <= 34));
    assert_eq!(wrapped.join(" "), SUMMARY);
    assert_eq!(render(SUMMARY, None), format!("{SUMMARY}\n"));
}

#[tokio::test]
async fn prose_renders_as_the_default_view_of_a_declared_string_result() {
    let run = ViewRun::new(&[Some(34)]);
    let declared = render_result(&run, SUMMARY, prose()).await;
    let rendered = render_each(
        &run,
        |out| async move { out.render(SUMMARY, &prose()).await },
    )
    .await;
    assert_eq!(declared, rendered);
}

#[test]
fn a_blank_line_separates_two_paragraphs() {
    let output = render("First paragraph here.\n\nSecond paragraph.", Some(12));
    let paragraphs: Vec<&str> = output.split("\n\n").collect();
    assert_eq!(paragraphs.len(), 2);
    assert_eq!(words_of(paragraphs[0]), ["First", "paragraph", "here."]);
    assert_eq!(words_of(paragraphs[1]), ["Second", "paragraph."]);
}

#[test]
fn a_leading_indent_stays_on_the_first_line_and_continuation_lines_are_not_indented() {
    let output = lines_of(&render("    Indented text wraps here", Some(14)));
    assert!(output[0].starts_with("    Indented"));
    assert!(output.len() > 1);
    for line in &output[1..] {
        assert_eq!(line, line.trim_start());
    }
}

#[test]
fn a_tab_expands_on_a_terminal_and_is_kept_when_piped() {
    assert_eq!(render("a\tb", Some(30)), "a       b\n");
    assert_eq!(render("a\tb", None), "a\tb\n");
}

#[test]
fn the_text_ends_in_exactly_one_line_break() {
    for data in ["Done.", "Done.\n"] {
        assert_eq!(render(data, Some(30)), "Done.\n");
        assert_eq!(render(data, None), "Done.\n");
    }
}

#[test]
fn prose_over_a_frame_around_nothing_prints_nothing() {
    for data in [style().red().apply(""), nowrap("")] {
        assert_eq!(render(&data, Some(30)), "");
        assert_eq!(render(&data, None), "");
    }
}

#[tokio::test]
async fn prose_adds_no_styling_and_keeps_its_author_styling() {
    let run = ViewRun::new(&[Some(40)]).color(true).theme();
    let output = render_each(&run, |out| async move {
        out.render(
            "\u{E000}[\"style\",[[\"foreground\",\"red\"]]]\u{E001}Hi\u{E002} there",
            &prose(),
        )
        .await
    })
    .await;
    assert_eq!(output, "\u{1b}[31mHi\u{1b}[39m there\n");
}

#[test]
fn the_empty_string_prints_nothing() {
    assert_eq!(render("", Some(30)), "");
    assert_eq!(render("", None), "");
}

#[tokio::test]
async fn an_osc_8_hyperlink_closes_at_the_end_of_each_wrapped_line() {
    let open = "\u{1b}]8;;https://example.com\u{1b}\\";
    let close = "\u{1b}]8;;\u{1b}\\";
    let output = render_each(
        &ViewRun::new(&[Some(14)]).hyperlinks(),
        move |out| async move {
            out.render(&format!("{open}see the release notes{close}"), &prose())
                .await
        },
    )
    .await;
    assert_eq!(
        output,
        lines(&[
            &format!("{open}see the{close}"),
            &format!("{open}release notes{close}")
        ])
    );
}
