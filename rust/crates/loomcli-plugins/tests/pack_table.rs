//! Ports `table.test.ts`, the table cases of `table-fit.test.ts`, and `pty-table.test.ts`'s table
//! renders: the table view through `out.render` and `out.results` on the mock process, and its fit
//! through the view's own function with core's measures.

#![cfg(feature = "table")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use loomcli_core::style::{Alignment, nowrap, pad, style};
use loomcli_core::{RowViews, View};
use loomcli_plugins::table::{Column, TableConfig, table};
use pack_support::{
    ViewRun, assert_fits, filler, indent_of, lines, lines_of, measured, on_one_line, plain,
    render_each, render_rows, width, words_of,
};
use serde_json::{Value, json};

/// A red style frame around `data`, written out as the reference's marker.
const MARKER: &str = "\u{E000}[\"style\",[[\"foreground\",\"red\"]]]\u{E001}data\u{E002}";

/// What a table prints for `rows` through `out.render` on a pipe.
async fn rendered(rows: Vec<Value>, view: View<[Value]>) -> String {
    render_each(&ViewRun::new(&[None]), move |out| {
        let rows = rows.clone();
        let view = view.clone();
        async move { out.render(&rows, &view).await }
    })
    .await
}

/// The lines a table shows for `rows` at `columns`, or piped for `None`.
fn shown(view: &View<[Value]>, rows: &[Value], columns: Option<u16>) -> Vec<String> {
    lines_of(&view.render(rows, &measured(columns)).unwrap())
}

// table.test.ts

#[tokio::test]
async fn explicit_columns_render_through_out_render() {
    let view = table(vec![
        Column::new("count").header("COUNT").align(Alignment::Right),
        "source".into(),
    ]);
    let rows = vec![
        json!({ "count": 6, "source": "one.txt" }),
        json!({ "count": 2, "source": "two words.txt" }),
    ];
    assert_eq!(
        rendered(rows, view).await,
        "COUNT  source\n    6  one.txt\n    2  two words.txt\n"
    );
}

#[tokio::test]
async fn own_keys_are_discovered_in_first_seen_order_when_columns_are_omitted() {
    let rows = vec![
        json!({ "source": "one.txt", "count": 6 }),
        json!({ "source": "two words.txt", "extra": "yes", "count": 2 }),
    ];
    assert_eq!(
        rendered(rows, table(TableConfig::new())).await,
        "source         count  extra\none.txt        6      \ntwo words.txt  2      yes\n"
    );
}

#[tokio::test]
async fn a_table_renders_as_a_declared_whole_view_through_out_results() {
    let rows = vec![json!({ "count": 3, "source": "declared.txt" })];
    let views = RowViews::new().view("table", table(vec!["source".into(), "count".into()]));
    assert_eq!(
        render_rows(&ViewRun::new(&[None]), rows, views).await,
        "source        count\ndeclared.txt  3\n"
    );
}

#[tokio::test]
async fn one_key_may_appear_twice_with_independent_formatting() {
    let view = table(vec![
        Column::new("count").header("COUNT"),
        Column::new("count")
            .header("TENS")
            .format(|value: &Value, _: &Value, _| (value.as_i64().unwrap() * 10).to_string()),
    ]);
    assert_eq!(
        rendered(vec![json!({ "count": 2 })], view).await,
        "COUNT  TENS\n2      20\n"
    );
}

#[tokio::test]
async fn null_and_undefined_print_as_empty_cells() {
    let view = table(vec!["nullish".into(), "missing".into(), "end".into()]);
    assert_eq!(
        rendered(vec![json!({ "end": "x", "nullish": null })], view).await,
        format!("nullish  missing  end\n{}x\n", " ".repeat(18))
    );
}

#[tokio::test]
async fn wide_and_styled_cells_are_measured_with_the_view_context() {
    let view = table(vec![
        Column::new("label")
            .header("N")
            .format(|value: &Value, _: &Value, context| {
                context.style.red().apply(value.as_str().unwrap())
            }),
        Column::new("count").align(Alignment::Right),
    ]);
    let rows = vec![
        json!({ "count": 1, "label": "猫猫" }),
        json!({ "count": 20, "label": "styled" }),
    ];
    assert_eq!(
        rendered(rows, view).await,
        "N       count\n猫猫        1\nstyled     20\n"
    );
}

#[tokio::test]
async fn formatted_text_stays_authored_and_default_data_cells_are_escaped() {
    let view = table(vec![
        "raw".into(),
        Column::new("authored")
            .format(|value: &Value, _: &Value, _| value.as_str().unwrap().to_owned()),
    ]);
    let rows = vec![json!({ "authored": MARKER, "raw": MARKER })];
    let output = rendered(rows, view).await;
    // The run's output resolves the authored frame; the escaped raw cell shows the marker itself.
    assert_eq!(output.matches(MARKER).count(), 1);
    assert!(output.ends_with("  data\n"));
}

#[tokio::test]
async fn a_discovered_key_is_escaped_before_its_header_is_styled() {
    let output = rendered(vec![json!({ MARKER: "value" })], table(TableConfig::new())).await;
    assert!(output.contains(MARKER));
}

#[tokio::test]
async fn a_large_finite_sequence_is_measured() {
    let rows: Vec<Value> = (0..150_000).map(|_| json!({ "value": "x" })).collect();
    let output = rendered(rows, table(TableConfig::new())).await;
    assert_eq!(output.len(), "value\n".len() + 150_000 * "x\n".len());
}

#[tokio::test]
async fn a_centered_last_column_carries_no_trailing_padding() {
    let view = table(vec![
        Column::new("value").header("ABCD").align(Alignment::Center),
    ]);
    assert_eq!(
        rendered(vec![json!({ "value": "x" })], view).await,
        "ABCD\n x\n"
    );
}

#[tokio::test]
async fn an_empty_sequence_prints_only_the_configured_headers() {
    let view = table(vec!["source".into(), "count".into()]);
    assert_eq!(rendered(vec![], view).await, "source  count\n");
}

#[tokio::test]
async fn an_empty_sequence_with_no_known_columns_prints_nothing() {
    assert_eq!(rendered(vec![], table(TableConfig::new())).await, "");
}

// table-fit.test.ts

fn note_rows() -> Vec<Value> {
    vec![
        json!({ "name": "build", "note": "compiles every package and bundles the examples" }),
        json!({ "name": "check", "note": "runs the formatter, the linter, and the type checker" }),
    ]
}

fn note_columns() -> View<[Value]> {
    table(vec![
        Column::new("name").header("NAME"),
        Column::new("note").header("NOTE"),
    ])
}

#[test]
fn a_table_that_fits_prints_its_natural_width_exactly_at_the_limit_under_it_or_piped() {
    let view = table(vec!["name".into(), "note".into()]);
    let rows = [json!({ "name": "build", "note": "compiles" })];
    let outputs: Vec<String> = [Some(15), Some(40), None]
        .into_iter()
        .map(|columns| view.render(&rows, &measured(columns)).unwrap())
        .collect();
    assert!(outputs.iter().all(|output| *output == outputs[0]));
    assert_eq!(plain(&outputs[0]), "name   note\nbuild  compiles\n");
}

#[test]
fn a_table_one_column_too_wide_shrinks_wraps_and_keeps_every_value_whole() {
    let output = shown(&note_columns(), &note_rows(), Some(30));
    assert_fits(&output, 30);
    assert_eq!(words_of(&output[0]), ["NAME", "NOTE"]);
    for row in note_rows() {
        assert!(!on_one_line(&output, row["note"].as_str().unwrap()));
    }
    let mut every: Vec<String> = ["NAME", "NOTE"].map(str::to_owned).to_vec();
    for row in note_rows() {
        every.extend(words_of(row["name"].as_str().unwrap()));
        every.extend(words_of(row["note"].as_str().unwrap()));
    }
    let mut words = words_of(&output.join("\n"));
    words.sort();
    every.sort();
    assert_eq!(words, every);
}

/// The three-column table whose natural widths are 40, 20, and 6, the last right-aligned.
fn levelled() -> View<[Value]> {
    table(vec![
        Column::new("wide").header("A"),
        Column::new("middle").header("B"),
        Column::new("narrow").header("C").align(Alignment::Right),
    ])
}

#[test]
fn levelling_from_the_top_fills_the_width() {
    let rows = [json!({ "middle": filler(20, 'b'), "narrow": "cccccc", "wide": filler(40, 'a') })];
    for (cells, widths) in [(46, [20, 20, 6]), (40, [17, 17, 6]), (39, [17, 16, 6])] {
        let output = shown(&levelled(), &rows, Some(cells + 4));
        assert_eq!(
            output.iter().map(|line| width(line)).max(),
            Some(usize::from(cells) + 4)
        );
        let a_words: Vec<String> = words_of(&output.join("\n"))
            .into_iter()
            .filter(|word| word.starts_with('a'))
            .collect();
        assert_eq!(a_words, words_of(&filler(40, 'a')));
        // The header line places each column at its fitted width and the two-space gap.
        let header = &output[0];
        assert_eq!(header.find('B'), Some(widths[0] + 2));
        assert_eq!(
            header.find('C'),
            Some(widths[0] + widths[1] + 4 + widths[2] - 1)
        );
    }
}

#[test]
fn a_column_held_at_its_floor_by_a_long_word_stays_whole_while_the_others_narrow() {
    let view = table(vec!["word".into(), "tail".into()]);
    let output = shown(
        &view,
        &[json!({ "tail": filler(40, 't'), "word": "abcdefghijklmnopqrst uv" })],
        Some(40),
    );
    assert_fits(&output, 40);
    assert!(on_one_line(&output, "abcdefghijklmnopqrst"));
    assert!(!on_one_line(&output, &filler(40, 't')));
}

#[test]
fn a_cell_whose_trailing_space_would_overflow_its_column_wraps() {
    let rows = [
        json!({ "name": "Ada Lovelace ", "role": "math" }),
        json!({ "name": "Bo", "role": "ops" }),
    ];
    let output = shown(&table(TableConfig::new()), &rows, Some(18));
    assert_fits(&output, 18);
    assert!(!on_one_line(&output, "Ada Lovelace"));
    let mut words = words_of(&output.join("\n"));
    words.sort();
    let mut expected = ["name", "role", "Ada", "Lovelace", "math", "Bo", "ops"].map(str::to_owned);
    expected.sort();
    assert_eq!(words, expected);
}

/// The row blocks of a records render, each as the labels its lines start with, after checking
/// that no line is a header line holding every label.
fn record_labels(output: &[String], labels: &[&str]) -> Vec<Vec<String>> {
    assert!(
        !output
            .iter()
            .any(|line| labels.iter().all(|label| line.contains(label)))
    );
    output
        .join("\n")
        .split("\n\n")
        .map(|block| {
            labels
                .iter()
                .filter(|label| block.split('\n').any(|line| line.starts_with(*label)))
                .map(|label| (*label).to_owned())
                .collect()
        })
        .collect()
}

#[test]
fn a_word_with_trailing_spaces_is_one_unit_so_its_floor_can_force_the_fallback() {
    let view = table(vec!["word".into(), "tail".into()]);
    let rows = [
        json!({ "tail": "efgh", "word": "abcd      " }),
        json!({ "tail": "kl", "word": "ij" }),
    ];
    assert_eq!(
        record_labels(&shown(&view, &rows, Some(12)), &["word", "tail"]),
        [["word", "tail"], ["word", "tail"]]
    );
}

#[test]
fn a_word_with_leading_spaces_is_one_unit_so_its_column_floor_counts_the_spaces() {
    let view = table(vec!["word".into(), "tail".into()]);
    let output = shown(
        &view,
        &[json!({ "tail": filler(40, 't'), "word": "    abcdef gh" })],
        Some(20),
    );
    assert_fits(&output, 20);
    assert!(output.iter().any(|line| line.starts_with("    abcdef")));
}

#[test]
fn a_unit_wrap_keeps_whole_sets_its_column_floor() {
    for path in [
        nowrap("a b c d e f"),
        pad("a b c d e f", 11, Alignment::Left).unwrap(),
    ] {
        let view = table(vec![
            Column::new("path")
                .header("P")
                .format(|value: &Value, _: &Value, _| value.as_str().unwrap().to_owned()),
            "note".into(),
        ]);
        let output = shown(
            &view,
            &[json!({ "note": filler(40, 'n'), "path": path })],
            Some(20),
        );
        assert_fits(&output, 20);
        assert!(output.iter().any(|line| line.starts_with("a b c d e f")));
        assert!(!on_one_line(&output, &filler(40, 'n')));
    }
}

#[test]
fn each_line_of_a_wrapped_aligned_cell_keeps_the_column_alignment() {
    for align in [Alignment::Right, Alignment::Center] {
        let view = table(vec![
            Column::new("text").header("N").align(align),
            "note".into(),
        ]);
        let output = shown(
            &view,
            &[json!({ "note": "x", "text": "aaa b cc dddd" })],
            Some(12),
        );
        assert_fits(&output, 12);
        let placed: Vec<usize> = ["N", "aaa b", "cc", "dddd"]
            .iter()
            .map(|fragment| {
                let line = output.iter().find(|line| line.contains(fragment)).unwrap();
                let start = line.find(fragment).unwrap();
                if align == Alignment::Right {
                    start + fragment.len()
                } else {
                    2 * start + fragment.len()
                }
            })
            .collect();
        let spread = placed.iter().max().unwrap() - placed.iter().min().unwrap();
        assert!(spread <= if align == Alignment::Right { 0 } else { 2 });
    }
}

#[test]
fn a_line_ends_at_its_rightmost_cell_with_text_and_an_earlier_shorter_cell_pads_blank_lines() {
    let rows = [json!({ "long": "one two three", "short": "x" })];
    let long = || Column::new("long").header("L");
    let short = || Column::new("short").header("S");
    let after = shown(&table(vec![long(), short()]), &rows, Some(10));
    let before = shown(&table(vec![short(), long()]), &rows, Some(10));
    for line in after.iter().chain(&before) {
        assert_eq!(line, line.trim_end());
    }
    assert!(
        !after
            .iter()
            .find(|line| line.contains("three"))
            .unwrap()
            .contains('x')
    );
    let continued = before.iter().find(|line| line.contains("three")).unwrap();
    assert!(continued.starts_with(' '));
    assert_eq!(continued.trim(), "three");
    assert_eq!(after, ["L        S", "one two  x", "three"]);
    assert_eq!(before, ["S  L", "x  one two", "   three"]);
}

#[test]
fn a_middle_cell_taller_than_the_last_ends_its_extra_lines_at_its_own_text() {
    let view = table(vec![
        Column::new("first").header("a"),
        Column::new("middle").header("b"),
        Column::new("last").header("c"),
    ]);
    let output = shown(
        &view,
        &[json!({ "first": "x", "last": "z", "middle": "one two three" })],
        Some(14),
    );
    for line in &output {
        assert_eq!(line, line.trim_end());
    }
    assert_eq!(
        output
            .iter()
            .find(|line| line.contains("three"))
            .unwrap()
            .trim(),
        "three"
    );
}

#[test]
fn a_header_wider_than_its_cells_sets_the_natural_width_and_wraps_like_a_cell() {
    let view = table(vec![
        Column::new("small").header("ENORMOUS HEADER"),
        "text".into(),
    ]);
    let rows = [json!({ "small": "x", "text": filler(30, 'b') })];
    let piped = shown(&view, &rows, None);
    assert!(piped[0].contains("ENORMOUS HEADER"));
    assert_eq!(piped[1].find(&filler(30, 'b')), piped[0].find("text"));
    let narrow = shown(&view, &rows, Some(30));
    assert_fits(&narrow, 30);
    assert!(!on_one_line(&narrow, "ENORMOUS HEADER"));
    assert!(on_one_line(&narrow, "HEADER"));
}

#[test]
fn a_header_word_longer_than_every_cell_word_sets_the_floor() {
    let view = table(vec![
        Column::new("small").header("SUPERCALIFRAGILISTIC"),
        Column::new("text").header("TEXT OF ROW"),
    ]);
    let output = shown(
        &view,
        &[json!({ "small": "x y", "text": filler(40, 'b') })],
        Some(30),
    );
    assert_fits(&output, 30);
    assert!(on_one_line(&output, "SUPERCALIFRAGILISTIC"));
}

#[test]
fn an_empty_sequence_prints_its_header_line_at_the_fitted_widths() {
    let view = table(vec![
        Column::new("first").header("FIRST NAME"),
        Column::new("last").header("LAST NAME"),
    ]);
    let narrow = shown(&view, &[], Some(12));
    assert_fits(&narrow, 12);
    assert!(narrow.len() > 1);
    let mut words = words_of(&narrow.join("\n"));
    words.sort();
    assert_eq!(words, ["FIRST", "LAST", "NAME", "NAME"]);
    let wide = shown(&view, &[], Some(40));
    assert_eq!(wide.len(), 1);
    assert!(wide[0].contains("FIRST NAME") && wide[0].contains("LAST NAME"));
}

#[test]
fn an_empty_sequence_overflows_at_its_floors_rather_than_taking_the_records_fallback() {
    let view = table(vec!["ALPHA".into(), "BETA".into()]);
    let output = shown(&view, &[], Some(5));
    assert_eq!(output, ["ALPHA  BETA"]);
}

#[test]
fn an_empty_sequence_with_no_columns_list_prints_nothing() {
    assert_eq!(
        table::<Value>(TableConfig::new())
            .render(&[], &measured(Some(30)))
            .unwrap(),
        ""
    );
}

#[test]
fn a_table_whose_floors_do_not_fit_renders_as_records_blocks_with_every_value() {
    let rows = [
        json!({ "name": "abcdefghijkl", "note": "one two three four five" }),
        json!({ "name": "second", "note": "tail" }),
    ];
    let output = shown(&note_columns(), &rows, Some(15));
    assert_eq!(
        record_labels(&output, &["NAME", "NOTE"]),
        [["NAME", "NOTE"], ["NAME", "NOTE"]]
    );
    assert!(!on_one_line(&output, "one two three four five"));
    assert_eq!(
        output,
        [
            "NAME  abcdefghijkl",
            "NOTE  one two",
            "      three",
            "      four five",
            "",
            "NAME  second",
            "NOTE  tail",
        ]
    );
}

#[test]
fn the_records_fallback_aligns_a_value_within_its_own_widest_wrapped_line() {
    for align in [Alignment::Right, Alignment::Center] {
        let view = table(vec![Column::new("text").align(align), "wide".into()]);
        let output = shown(
            &view,
            &[json!({ "text": "aaa b cc dddd", "wide": "zzzzzzzzzzzzzzz" })],
            Some(12),
        );
        assert_eq!(
            record_labels(&output, &["text", "wide"]),
            [["text", "wide"]]
        );
        let placed: Vec<usize> = ["aaa b", "cc", "dddd"]
            .iter()
            .map(|fragment| {
                let line = output.iter().find(|line| line.contains(fragment)).unwrap();
                let start = line.find(fragment).unwrap();
                if align == Alignment::Right {
                    start + fragment.len()
                } else {
                    2 * start + fragment.len()
                }
            })
            .collect();
        let spread = placed.iter().max().unwrap() - placed.iter().min().unwrap();
        assert!(spread <= if align == Alignment::Right { 0 } else { 2 });
        for line in &output {
            assert_eq!(line, line.trim_end());
        }
    }
}

#[tokio::test]
async fn the_records_fallback_keeps_a_format_cell_and_its_color_with_every_indent_bare() {
    let view = table(vec![
        Column::new("name").header("NAME"),
        Column::new("note")
            .header("NOTE")
            .format(|value: &Value, _: &Value, context| {
                context.style.red().apply(value.as_str().unwrap())
            }),
    ]);
    let run = ViewRun::new(&[Some(15)]).color(false);
    let output = render_each(&run, move |out| {
        let view = view.clone();
        async move {
            let rows = vec![json!({ "name": "abcdefghijkl", "note": "one two three four five" })];
            out.render(&rows, &view).await
        }
    })
    .await;
    assert_eq!(
        output,
        lines(&[
            "NAME  abcdefghijkl",
            "NOTE  \u{1b}[31mone two\u{1b}[39m",
            "      \u{1b}[31mthree\u{1b}[39m",
            "      \u{1b}[31mfour five\u{1b}[39m",
        ])
    );
}

#[test]
fn a_format_cell_is_measured_and_wrapped_by_its_output() {
    let view = table(vec![
        "first".into(),
        Column::new("second")
            .format(|value: &Value, _: &Value, _| format!("<{}>", value.as_str().unwrap())),
    ]);
    let output = shown(
        &view,
        &[json!({ "first": "x", "second": "hello world" })],
        Some(16),
    );
    assert_fits(&output, 16);
    assert!(on_one_line(&output, "<hello"));
    assert!(on_one_line(&output, "world>"));
    assert!(!on_one_line(&output, "<hello world>"));
}

/// A run on a terminal `columns` wide with color always and modifiers never.
async fn colored_render(
    columns: u16,
    view: View<[Value]>,
    rows: Vec<Value>,
    hyperlinks: bool,
) -> String {
    let run = if hyperlinks {
        ViewRun::new(&[Some(columns)]).hyperlinks()
    } else {
        ViewRun::new(&[Some(columns)]).color(false)
    };
    render_each(&run, move |out| {
        let view = view.clone();
        let rows = rows.clone();
        async move { out.render(&rows, &view).await }
    })
    .await
}

#[tokio::test]
async fn a_styled_cell_that_wraps_closes_its_style_on_each_line() {
    let view = table(vec![
        Column::new("first").header("a"),
        Column::new("second").format(|value: &Value, _: &Value, context| {
            context.style.red().apply(value.as_str().unwrap())
        }),
    ]);
    let output = colored_render(
        10,
        view,
        vec![json!({ "first": "x", "second": "hello world" })],
        false,
    )
    .await;
    let shown: Vec<&str> = output.split('\n').skip(1).collect();
    assert_eq!(
        shown,
        [
            "x  \u{1b}[31mhello\u{1b}[39m",
            "   \u{1b}[31mworld\u{1b}[39m",
            ""
        ]
    );
}

const LINK: &str = "\u{1b}]8;;https://example.com\u{1b}\\";
const UNLINK: &str = "\u{1b}]8;;\u{1b}\\";

#[tokio::test]
async fn a_hyperlink_in_a_wrapped_cell_closes_on_each_line() {
    let view = table(vec![
        Column::new("doc").format(|value: &Value, _: &Value, _| {
            format!("{LINK}{}{UNLINK}", value.as_str().unwrap())
        }),
        "owner".into(),
    ]);
    let output = colored_render(
        20,
        view,
        vec![json!({ "doc": "see the release notes", "owner": "drew" })],
        true,
    )
    .await;
    let shown: Vec<&str> = output.split('\n').skip(1).take(2).collect();
    assert_eq!(
        shown,
        [
            format!("{LINK}see the{UNLINK}{}  drew", " ".repeat(6)),
            format!("{LINK}release notes{UNLINK}"),
        ]
    );
}

#[tokio::test]
async fn a_raw_sgr_color_in_a_wrapped_cell_ends_on_each_line() {
    let view = table(vec![
        Column::new("note").format(|value: &Value, _: &Value, _| {
            format!("\u{1b}[31m{}\u{1b}[39m", value.as_str().unwrap())
        }),
        "owner".into(),
    ]);
    let output = colored_render(
        12,
        view,
        vec![json!({ "note": "one two three", "owner": "drew" })],
        false,
    )
    .await;
    let shown: Vec<&str> = output.split('\n').collect();
    assert_eq!(shown[1], "\u{1b}[31mone\u{1b}[39m    drew");
    assert_eq!(shown[2].trim_end(), "\u{1b}[31mtwo\u{1b}[39m");
    assert_eq!(shown[3].trim_end(), "\u{1b}[31mthree\u{1b}[39m");
}

fn left_right() -> (Vec<Value>, View<[Value]>) {
    (
        vec![json!({ "left": filler(70, 'a'), "right": "short" })],
        table(vec!["left".into(), "right".into()]),
    )
}

#[tokio::test]
async fn two_renders_either_side_of_a_resize_fit_100_and_then_60() {
    let (rows, view) = left_right();
    let output = render_each(&ViewRun::new(&[Some(100), Some(60)]), move |out| {
        let (rows, view) = (rows.clone(), view.clone());
        async move { out.render(&rows, &view).await }
    })
    .await;
    let (wide, narrow) = output.split_once("--\n").unwrap();
    assert!(wide.contains(&filler(70, 'a')));
    let fitted: Vec<&str> = narrow.split('\n').collect();
    assert_eq!(
        fitted.iter().map(|line| line.chars().count()).max(),
        Some(60)
    );
    assert!(narrow.contains("short"));
}

#[tokio::test]
async fn columns_narrows_a_terminal_never_widens_it_fits_a_terminal_with_no_width_and_spares_a_pipe()
 {
    async fn widest(width: Option<u16>, columns: &str) -> usize {
        let (rows, view) = left_right();
        let output = render_each(
            &ViewRun::new(&[width]).env("COLUMNS", columns),
            move |out| {
                let (rows, view) = (rows.clone(), view.clone());
                async move { out.render(&rows, &view).await }
            },
        )
        .await;
        output
            .split('\n')
            .map(|line| line.chars().count())
            .max()
            .unwrap()
    }
    assert_eq!(widest(Some(100), "60").await, 60);
    assert_eq!(widest(Some(100), "150").await, 70 + 2 + 5);
    // A terminal that reports a width of 0 reports none.
    assert_eq!(widest(Some(0), "60").await, 60);
    assert_eq!(widest(None, "60").await, 70 + 2 + 5);
}

#[tokio::test]
async fn a_table_piped_or_invoked_by_name_is_byte_for_byte_the_natural_width() {
    for invoke in [false, true] {
        let view = table(vec![
            Column::new("left").header("A"),
            Column::new("right")
                .align(Alignment::Right)
                .format(|value: &Value, _: &Value, _| {
                    format!("{}\nsecond line", value.as_str().unwrap())
                }),
        ]);
        let rows = vec![
            json!({ "left": "x y z", "right": "hello world" }),
            json!({ "left": "q", "right": "zz" }),
        ];
        let mut run = ViewRun::new(&[None]).env("COLUMNS", "10");
        if invoke {
            run = run.invoke();
        }
        let output = render_each(&run, move |out| {
            let (rows, view) = (rows.clone(), view.clone());
            async move { out.render(&rows, &view).await }
        })
        .await;
        assert_eq!(
            output,
            lines(&[
                &format!("A{}right", " ".repeat(12)),
                "x y z  hello world",
                "second line",
                "q               zz",
                "second line",
            ])
        );
    }
}

#[test]
fn a_tab_in_a_cell_expands_from_the_start_of_the_cell_before_it_fits() {
    let output = shown(
        &table(TableConfig::new()),
        &[json!({ "first": "abcde", "last": "b\tc d" })],
        Some(16),
    );
    assert_fits(&output, 16);
    assert!(!output.join("\n").contains('\t'));
    assert_eq!(output, ["first  last", "abcde  b       c", "       d"]);
}

#[tokio::test]
async fn a_tab_in_a_styled_cell_expands_inside_its_style() {
    let view = table(vec![
        Column::new("first").header("f"),
        Column::new("last").format(|value: &Value, _: &Value, context| {
            context.style.red().apply(value.as_str().unwrap())
        }),
    ]);
    let output = colored_render(
        16,
        view,
        vec![json!({ "first": "abcde", "last": "b\tc d" })],
        false,
    )
    .await;
    let shown: Vec<&str> = output.split('\n').skip(1).collect();
    assert_eq!(
        shown,
        [
            "abcde  \u{1b}[31mb       c\u{1b}[39m",
            "       \u{1b}[31md\u{1b}[39m",
            ""
        ]
    );
}

#[test]
fn a_tab_in_a_nowrap_cell_expands_while_the_cell_stays_whole() {
    let view = table(vec![
        "first".into(),
        Column::new("last").format(|value: &Value, _: &Value, _| nowrap(value.as_str().unwrap())),
    ]);
    let output = shown(
        &view,
        &[json!({ "first": "abcde", "last": "b\tc d" })],
        Some(16),
    );
    assert!(!output.join("\n").contains('\t'));
    assert!(on_one_line(&output, "b       c d"));
}

#[test]
fn a_tab_in_a_format_cells_output_expands_as_a_default_cells_does() {
    let view = table(vec![
        "first".into(),
        Column::new("last")
            .format(|value: &Value, _: &Value, _| value.as_str().unwrap().to_uppercase()),
    ]);
    let output = shown(
        &view,
        &[json!({ "first": "abcde", "last": "b\tc d" })],
        Some(18),
    );
    assert!(!output.join("\n").contains('\t'));
    assert!(on_one_line(&output, "B       C"));
}

#[test]
fn a_tab_in_a_header_expands_as_a_cell_does() {
    let view = table(vec!["first".into(), Column::new("last").header("b\tc")]);
    let output = shown(&view, &[json!({ "first": "abcde", "last": "x" })], Some(16));
    assert_fits(&output, 16);
    assert!(output[0].contains("b       c"));
}

#[test]
fn a_tab_stays_a_tab_in_a_piped_table() {
    let output = shown(
        &table(TableConfig::new()),
        &[json!({ "first": "abcde", "last": "b\tc d" })],
        None,
    );
    assert!(output[1].contains("b\tc d"));
}

#[test]
fn a_line_with_a_red_cell_wraps_by_its_shown_width() {
    let view = table(vec![
        Column::new("a"),
        Column::new("b")
            .format(|value: &Value, _: &Value, _| style().red().apply(value.as_str().unwrap())),
    ]);
    let output = shown(&view, &[json!({ "a": "x", "b": "one two" })], Some(8));
    assert_eq!(output, ["a  b", "x  one", "   two"]);
    assert_eq!(indent_of(&output[2]), 3);
}

// pty-table.test.ts: the table renders either side of a resize, on the mock terminal.

#[tokio::test]
async fn a_table_fits_100_columns_then_60_after_a_resize() {
    let view = table(vec![
        Column::new("count").header("COUNT").align(Alignment::Right),
        Column::new("source").header("SOURCE"),
    ]);
    let rows = vec![
        json!({ "count": 6, "source": "docs/guides/getting started with the loom command line framework.md" }),
        json!({ "count": 2, "source": "notes.md" }),
    ];
    let output = render_each(&ViewRun::new(&[Some(100), Some(60)]), move |out| {
        let (rows, view) = (rows.clone(), view.clone());
        async move { out.render(&rows, &view).await }
    })
    .await;
    assert_eq!(
        output,
        lines(&[
            "COUNT  SOURCE",
            "    6  docs/guides/getting started with the loom command line framework.md",
            "    2  notes.md",
            "--",
            "COUNT  SOURCE",
            "    6  docs/guides/getting started with the loom command",
            "       line framework.md",
            "    2  notes.md",
        ])
    );
}
