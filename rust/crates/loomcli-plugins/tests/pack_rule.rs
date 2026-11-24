//! Ports `rule.test.ts` and the rule cases of `builders.test.ts`: the rule view through its own
//! function with core's measures, and through `out.render`, `out.results`, and an invocation by
//! name on the mock process.

#![cfg(feature = "rule")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use loomcli_core::style::{Glyph, nowrap, style};
use loomcli_plugins::rule::rule;
use pack_support::{
    ViewRun, column_of, indent_of, lines, lines_of, measured, plain, render_each, render_result,
    width, words_of,
};

/// The line glyph as a render shows it.
fn line() -> String {
    plain(&Glyph::Line.marked())
}

/// Whether a shown line is line glyphs and nothing else.
fn is_bare(shown: Option<&str>) -> bool {
    shown.is_some_and(|shown| !shown.is_empty() && shown.replace(&line(), "").is_empty())
}

fn shown(text: &str, columns: Option<u16>) -> Vec<String> {
    lines_of(&rule::<str>().render(text, &measured(columns)).unwrap())
}

#[test]
fn a_labelled_rule_spans_the_columns_with_its_label_after_the_lead() {
    for (columns, spans) in [(Some(60), 60), (None, 80)] {
        let output = shown("Checks", columns);
        assert_eq!(output.len(), 1);
        assert!(output[0].starts_with(&format!("{0}{0} Checks {0}", line())));
        assert_eq!(width(&output[0]), spans);
    }
}

#[test]
fn a_bare_rule_spans_the_columns_and_styles_its_line_dim() {
    for (columns, spans) in [(Some(60), 60), (None, 80)] {
        let output = rule::<str>().render("", &measured(columns)).unwrap();
        assert_eq!(
            output,
            format!(
                "{}\n",
                style().dim().apply(&Glyph::Line.marked().repeat(spans))
            )
        );
        let shown = lines_of(&output);
        assert_eq!(shown.len(), 1);
        assert!(is_bare(Some(&shown[0])));
        assert_eq!(width(&shown[0]), spans);
    }
}

#[tokio::test]
async fn a_rule_renders_as_the_default_view_of_a_declared_string_result() {
    let run = ViewRun::new(&[Some(60)]);
    let declared = render_result(&run, "Checks", rule()).await;
    let rendered = render_each(
        &run,
        |out| async move { out.render("Checks", &rule()).await },
    )
    .await;
    assert_eq!(declared, rendered);
}

#[test]
fn a_label_wrapped_at_a_narrow_width_hangs_its_later_lines_and_only_its_last_line_carries_the_line()
{
    let label = "Checks for the staging cluster";
    let output = shown(label, Some(20));
    assert!(output.len() > 1);
    let words: Vec<String> = words_of(&output.join("\n"))
        .into_iter()
        .filter(|word| !is_bare(Some(word)))
        .collect();
    assert_eq!(words, label.split(' ').collect::<Vec<_>>());
    assert!(output[0].starts_with(&format!("{0}{0} Checks", line())));
    assert!(output.iter().all(|each| width(each) <= 20));
    let ends: Vec<bool> = output.iter().map(|each| each.ends_with(&line())).collect();
    let expected: Vec<bool> = (0..output.len())
        .map(|index| index == output.len() - 1)
        .collect();
    assert_eq!(ends, expected);
    let column = column_of(&output[0], "Checks");
    assert!(output[1..].iter().all(|each| indent_of(each) == column));
}

#[test]
fn a_label_word_too_wide_to_fit_overflows_with_one_line_glyph_after_it() {
    let output = shown("Extraordinary", Some(12));
    assert_eq!(output.len(), 1);
    assert!(output[0].ends_with(&format!("Extraordinary {}", line())));
    assert!(!output[0].ends_with(&format!("{0}{0}", line())));
}

#[test]
fn an_authored_line_break_in_a_piped_label_takes_the_wrapped_layout_the_last_line_spanning_80() {
    let output = shown("Checks\nstaging", None);
    assert_eq!(output.len(), 2);
    assert_eq!(output[0], format!("{0}{0} Checks", line()));
    assert!(output[1].trim_start().starts_with("staging"));
    assert_eq!(
        column_of(&output[1], "staging"),
        column_of(&output[0], "Checks")
    );
    assert_eq!(width(&output[1]), 80);
}

#[test]
fn a_blank_line_inside_a_label_carries_no_indent_and_stays_empty() {
    for columns in [Some(30), None] {
        let output = shown("Checks\n\nstaging", columns);
        assert_eq!(output.len(), 3);
        assert_eq!(output[1], "");
    }
}

#[test]
fn a_rule_over_a_frame_around_nothing_draws_a_bare_line() {
    for data in [style().red().apply(""), nowrap("")] {
        for (columns, spans) in [(Some(30), 30), (None, 80)] {
            let output = shown(&data, columns);
            assert_eq!(output.len(), 1);
            assert!(is_bare(Some(&output[0])));
            assert_eq!(width(&output[0]), spans);
        }
    }
}

#[test]
fn a_blank_last_label_line_carries_the_line_after_it() {
    let output = shown("a\n\n", Some(20));
    assert_eq!(output.len(), 2);
    assert_eq!(output[0], format!("{0}{0} a", line()));
    assert!(is_bare(Some(output[1].trim_start())));
}

#[tokio::test]
async fn a_rule_styles_its_lines_dim_and_adds_no_style_to_its_label() {
    let run = ViewRun::new(&[Some(12)]).color(true).theme();
    let output = render_each(&run, |out| async move { out.render("Hi", &rule()).await }).await;
    assert_eq!(
        output,
        "\u{1b}[90m── \u{1b}[39mHi\u{1b}[90m ──────\u{1b}[39m\n"
    );
}

#[tokio::test]
async fn an_invocation_by_name_has_no_width_so_the_rule_draws_80() {
    let output = render_each(&ViewRun::new(&[None]).invoke(), |out| async move {
        out.render("Checks", &rule()).await
    })
    .await;
    assert_eq!(output, lines(&[&format!("── Checks {}", "─".repeat(70))]));
}

#[test]
fn a_tab_in_a_label_expands_on_a_terminal() {
    let output = shown("a\tb", Some(30));
    assert!(output[0].contains("a       b"));
    assert!(!output[0].contains('\t'));
}

// builders.test.ts: the rule view through a view context.

#[test]
fn draws_a_bare_line_across_the_stated_columns_for_a_blank_text() {
    assert_eq!(
        plain(&rule::<str>().render("", &measured(Some(10))).unwrap()),
        format!("{}\n", "─".repeat(10))
    );
}

#[test]
fn draws_a_label_between_a_lead_and_a_tail_at_the_stated_width() {
    assert_eq!(
        plain(&rule::<str>().render("Notes", &measured(Some(20))).unwrap()),
        format!("── Notes {}\n", "─".repeat(20 - 9))
    );
}
