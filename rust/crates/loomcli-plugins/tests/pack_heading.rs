//! Ports `heading.test.ts`: the heading view through its own function with core's measures, and
//! through `out.render` and `out.results` on the mock process.

#![cfg(feature = "heading")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use loomcli_core::style::{Glyph, nowrap, style};
use loomcli_plugins::heading::{HeadingConfig, HeadingLevel, heading};
use pack_support::{ViewRun, lines_of, measured, plain, render_each, render_result, width};

/// The line glyph as a render shows it.
fn line() -> String {
    plain(&Glyph::Line.marked())
}

/// Whether a shown line is an underline: line glyphs and nothing else.
fn is_underline(shown: Option<&String>) -> bool {
    shown.is_some_and(|shown| !shown.is_empty() && shown.replace(&line(), "").is_empty())
}

fn level_one() -> loomcli_core::View<str> {
    heading(HeadingConfig::new())
}

#[test]
fn a_level_1_heading_prints_its_text_dim_with_a_dim_underline_as_wide_as_the_text() {
    for columns in [Some(40), None] {
        let output = level_one()
            .render("Deployment summary", &measured(columns))
            .unwrap();
        let shown = lines_of(&output);
        assert_eq!(shown.len(), 2);
        assert_eq!(shown[0], "Deployment summary");
        assert!(is_underline(shown.get(1)));
        assert_eq!(width(&shown[1]), width("Deployment summary"));
        // The text and the underline each sit in a dim frame.
        assert_eq!(output.matches("\"dim\"").count(), 2);
        assert!(output.contains(&style().dim().apply(&Glyph::Line.marked().repeat(18))));
    }
}

#[test]
fn a_level_2_heading_is_its_text_alone() {
    for columns in [Some(40), None] {
        let view = heading(HeadingConfig::new().level(HeadingLevel::Two));
        assert_eq!(
            lines_of(&view.render("Services", &measured(columns)).unwrap()),
            ["Services"]
        );
    }
}

#[tokio::test]
async fn a_heading_renders_as_the_default_view_of_a_declared_string_result() {
    let run = ViewRun::new(&[Some(40)]);
    let declared = render_result(&run, "Services", heading(HeadingConfig::new())).await;
    let rendered = render_each(&run, |out| async move {
        out.render("Services", &level_one()).await
    })
    .await;
    assert_eq!(declared, rendered);
    assert_eq!(declared, "Services\n────────\n");
}

#[test]
fn a_level_1_underline_is_as_wide_as_the_context_measures_a_cjk_text_and_a_styled_text() {
    let cjk = lines_of(&level_one().render("猫の手", &measured(Some(40))).unwrap());
    assert!(is_underline(cjk.get(1)));
    assert_eq!(cjk[1].chars().count(), 6);
    let styled = lines_of(
        &level_one()
            .render(&style().red().apply("data"), &measured(Some(40)))
            .unwrap(),
    );
    assert_eq!(styled[0], "data");
    assert_eq!(styled[1].chars().count(), 4);
}

#[test]
fn a_level_1_heading_wraps_at_columns_and_its_underline_matches_its_widest_wrapped_line() {
    let data = "Quarterly deployment summary for staging";
    let wrapped = lines_of(&level_one().render(data, &measured(Some(20))).unwrap());
    let text = &wrapped[..wrapped.len() - 1];
    assert!(text.len() > 1);
    assert_eq!(text.join(" "), data);
    assert!(is_underline(wrapped.last()));
    assert_eq!(
        width(wrapped.last().unwrap()),
        text.iter().map(|line| width(line)).max().unwrap()
    );
    let piped = lines_of(&level_one().render(data, &measured(None)).unwrap());
    assert_eq!(piped[0], data);
    assert_eq!(width(&piped[1]), width(data));
}

#[test]
fn a_word_wider_than_columns_keeps_its_line_whole_and_widens_the_underline_past_columns() {
    let output = lines_of(
        &level_one()
            .render("Configuration overview", &measured(Some(10)))
            .unwrap(),
    );
    assert_eq!(output[..2], ["Configuration", "overview"]);
    assert_eq!(width(output.last().unwrap()), width("Configuration"));
}

#[test]
fn a_heading_that_ends_in_a_line_break_gains_no_empty_line_and_the_empty_string_prints_nothing() {
    for columns in [Some(40), None] {
        let output = lines_of(
            &level_one()
                .render("Services\n", &measured(columns))
                .unwrap(),
        );
        assert_eq!(output[0], "Services");
        assert!(is_underline(output.get(1)));
        assert_eq!(output.len(), 2);
        assert_eq!(level_one().render("", &measured(columns)).unwrap(), "");
    }
}

#[test]
fn a_heading_over_a_frame_around_nothing_prints_nothing() {
    for data in [style().red().apply(""), nowrap("")] {
        assert_eq!(level_one().render(&data, &measured(Some(30))).unwrap(), "");
        assert_eq!(level_one().render(&data, &measured(None)).unwrap(), "");
    }
}

#[tokio::test]
async fn a_heading_styles_its_text_and_underline_dim_and_keeps_its_author_styling() {
    let run = ViewRun::new(&[Some(40)]).color(true).theme();
    let output = render_each(&run, |out| async move {
        let data = "Hi \u{E000}[\"style\",[[\"foreground\",\"red\"]]]\u{E001}there\u{E002}";
        out.render(data, &level_one()).await
    })
    .await;
    assert_eq!(
        output,
        "\u{1b}[90mHi \u{1b}[31mthere\u{1b}[39m\n\u{1b}[90m────────\u{1b}[39m\n"
    );
}
