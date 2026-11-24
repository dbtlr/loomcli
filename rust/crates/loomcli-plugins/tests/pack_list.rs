//! Ports `list.test.ts`: the list view through its own function with core's measures, and through
//! `out.render` and `out.results` on the mock process.

#![cfg(feature = "list")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use std::sync::{Arc, Mutex};

use loomcli_core::RowViews;
use loomcli_core::View;
use loomcli_core::style::Glyph;
use loomcli_plugins::list::{ListConfig, list};
use pack_support::{
    ViewRun, column_of, indent_of, lines_of, measured, plain, render_each, render_rows, width,
};
use serde::Serialize;

#[derive(Clone, Serialize)]
struct Service {
    name: &'static str,
    parts: Vec<Service>,
}

fn service(name: &'static str, parts: Vec<Service>) -> Service {
    Service { name, parts }
}

fn services() -> Vec<Service> {
    vec![
        service("api-gateway", vec![]),
        service(
            "billing",
            vec![service("invoices", vec![]), service("refunds", vec![])],
        ),
        service("search", vec![]),
    ]
}

/// A list of services by name, each with its parts nested under it.
fn named(ordered: bool) -> View<[Service]> {
    list(
        ListConfig::new()
            .children(|item: &Service| item.parts.as_slice())
            .format(|item: &Service, _, _| item.name.to_owned())
            .ordered(ordered),
    )
}

/// The bullet as a render shows it.
fn bullet() -> String {
    plain(&Glyph::Bullet.marked())
}

#[test]
fn bullets_each_item_with_its_nested_items_indented_past_their_parent_marker() {
    for columns in [Some(40), None] {
        let output = named(false)
            .render(&services(), &measured(columns))
            .unwrap();
        // Every marker is dim: one dim frame per item.
        assert_eq!(output.matches("\"dim\"").count(), 5);
        let shown = lines_of(&output);
        let trimmed: Vec<&str> = shown.iter().map(|line| line.trim()).collect();
        let expected: Vec<String> = ["api-gateway", "billing", "invoices", "refunds", "search"]
            .iter()
            .map(|name| format!("{} {name}", bullet()))
            .collect();
        assert_eq!(trimmed, expected);
        assert_eq!(
            [&shown[0], &shown[1], &shown[4]].map(|line| indent_of(line)),
            [0, 0, 0]
        );
        assert_eq!(indent_of(&shown[2]), column_of(&shown[1], "billing"));
        assert_eq!(indent_of(&shown[3]), indent_of(&shown[2]));
    }
}

#[tokio::test]
async fn a_list_renders_as_the_default_view_of_a_declared_rows_result() {
    let run = ViewRun::new(&[Some(40)]);
    let data = vec!["one".to_owned(), "two".to_owned()];
    let declared = render_rows(
        &run,
        data.clone(),
        RowViews::new().view("view", list(ListConfig::new())),
    )
    .await;
    let rendered = render_each(&run, move |out| {
        let data = data.clone();
        async move { out.render(&data, &list(ListConfig::<String>::new())).await }
    })
    .await;
    assert_eq!(declared, rendered);
    assert_eq!(declared, "● one\n● two\n");
}

#[test]
fn an_ordered_list_numbers_from_1_to_10_and_right_aligns_the_markers() {
    let items: Vec<String> = ('a'..='j').map(String::from).collect();
    let shown = lines_of(
        &list(ListConfig::new().ordered(true))
            .render(&items, &measured(Some(40)))
            .unwrap(),
    );
    let trimmed: Vec<&str> = shown.iter().map(|line| line.trim()).collect();
    let expected: Vec<String> = items
        .iter()
        .enumerate()
        .map(|(index, item)| format!("{}. {item}", index + 1))
        .collect();
    assert_eq!(trimmed, expected);
    assert!(
        shown
            .iter()
            .zip(&items)
            .all(|(line, item)| line.find(item.as_str()) == Some(4))
    );
    assert_eq!(shown[0], " 1. a");
}

#[test]
fn two_levels_of_children_nest_and_a_nested_ordered_list_counts_from_1() {
    let mut data: Vec<Service> = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]
        .into_iter()
        .map(|name| service(name, vec![]))
        .collect();
    data.push(service(
        "s10",
        vec![
            service("a", vec![]),
            service("b", vec![service("c", vec![])]),
        ],
    ));
    let shown: Vec<String> = lines_of(&named(true).render(&data, &measured(Some(40))).unwrap())
        .into_iter()
        .skip(9)
        .collect();
    let trimmed: Vec<&str> = shown.iter().map(|line| line.trim()).collect();
    assert_eq!(trimmed, ["10. s10", "1. a", "2. b", "1. c"]);
    let indents: Vec<usize> = shown.iter().map(|line| indent_of(line)).collect();
    assert_eq!(indents[0], 0);
    assert_eq!(indents[1], column_of(&shown[0], "s10"));
    assert_eq!(indents[2], indents[1]);
    assert_eq!(
        indents[3],
        shown[2][..shown[2].rfind('b').unwrap()].chars().count()
    );
}

#[test]
fn null_and_undefined_items_print_their_marker_alone() {
    for columns in [Some(40), None] {
        let data = [None, Some("x"), None];
        let bullets = lines_of(
            &list(ListConfig::new())
                .render(&data, &measured(columns))
                .unwrap(),
        );
        assert_eq!(bullets, [bullet(), format!("{} x", bullet()), bullet()]);
        let numbers = lines_of(
            &list(ListConfig::new().ordered(true))
                .render(&data, &measured(columns))
                .unwrap(),
        );
        assert_eq!(numbers, ["1.", "2. x", "3."]);
    }
}

#[test]
fn a_default_item_is_escaped_and_styled_primary_while_a_format_item_is_the_author_text() {
    let marker = "\u{E000}[\"style\",[[\"foreground\",\"red\"]]]\u{E001}data\u{E002}";
    let items = [marker.to_owned()];
    let default = list(ListConfig::new())
        .render(&items, &measured(None))
        .unwrap();
    // The default item is escaped, so the marker shows as written, inside a primary frame.
    assert!(default.contains("\"primary\""));
    assert!(lines_of(&default)[0].contains("[\"style\""));
    let formatted = list(ListConfig::new().format(|item: &String, _, _| item.clone()))
        .render(&items, &measured(None))
        .unwrap();
    assert_eq!(lines_of(&formatted), [format!("{} data", bullet())]);
    assert!(!formatted.contains("\"primary\""));
}

#[test]
fn format_receives_each_item_index_among_its_siblings() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let calls = Arc::clone(&seen);
    let view = list(
        ListConfig::new()
            .children(|item: &Service| item.parts.as_slice())
            .format(move |item: &Service, index, _| {
                calls.lock().unwrap().push(format!("{index}:{}", item.name));
                item.name.to_owned()
            }),
    );
    view.render(&services(), &measured(Some(40))).unwrap();
    assert_eq!(
        *seen.lock().unwrap(),
        [
            "0:api-gateway",
            "1:billing",
            "0:invoices",
            "1:refunds",
            "2:search"
        ]
    );
}

#[test]
fn a_wrapped_item_hangs_its_later_lines_under_its_text_and_every_line_fits() {
    let item = "refunds, whose retry policy lands with this deploy";
    let shown = lines_of(
        &list(ListConfig::new())
            .render(&[item], &measured(Some(30)))
            .unwrap(),
    );
    assert!(shown[0].starts_with(&format!("{} refunds,", bullet())));
    assert!(shown.len() > 1);
    for line in &shown {
        assert!(width(line) <= 30);
    }
    for line in &shown[1..] {
        assert_eq!(indent_of(line), column_of(&shown[0], "refunds"));
    }
    let mut words = vec![shown[0].chars().skip(2).collect::<String>()];
    words.extend(shown[1..].iter().map(|line| line.trim().to_owned()));
    assert_eq!(words.join(" "), item);
}

#[test]
fn a_nested_item_wraps_at_the_columns_left_after_its_own_text_column() {
    let data = [service(
        "billing",
        vec![service("refunds, whose retry policy lands", vec![])],
    )];
    let shown = lines_of(&named(true).render(&data, &measured(Some(24))).unwrap());
    assert!(shown.len() > 2);
    for line in &shown {
        assert!(width(line) <= 24);
    }
    let joined: Vec<&str> = shown[1..].iter().map(|line| line.trim()).collect();
    assert_eq!(joined.join(" "), "1. refunds, whose retry policy lands");
    assert_eq!(indent_of(&shown[2]), column_of(&shown[1], "refunds"));
}

#[test]
fn an_authored_line_break_hangs_under_its_text_when_piped() {
    let shown = lines_of(
        &list(ListConfig::new())
            .render(&["first line\nsecond line"], &measured(None))
            .unwrap(),
    );
    assert_eq!(shown.len(), 2);
    assert_eq!(shown[0], format!("{} first line", bullet()));
    assert_eq!(shown[1].trim(), "second line");
    assert_eq!(indent_of(&shown[1]), column_of(&shown[0], "first"));
}

#[test]
fn a_blank_line_inside_an_item_carries_no_indent() {
    for columns in [Some(30), None] {
        let shown = lines_of(
            &list(ListConfig::new())
                .render(&["above\n\nbelow"], &measured(columns))
                .unwrap(),
        );
        assert_eq!(shown.len(), 3);
        assert_eq!(shown[1], "");
    }
}

#[test]
fn a_tab_in_an_item_expands_on_a_terminal_and_is_kept_when_piped() {
    let view = list(ListConfig::new());
    assert_eq!(
        lines_of(&view.render(&["a\tb"], &measured(Some(30))).unwrap()),
        [format!("{} a       b", bullet())]
    );
    assert_eq!(
        lines_of(&view.render(&["a\tb"], &measured(None)).unwrap()),
        [format!("{} a\tb", bullet())]
    );
}

#[tokio::test]
async fn a_list_styles_its_markers_dim_and_a_default_item_primary() {
    let run = ViewRun::new(&[Some(40)]).color(true).theme();
    let bullets = render_each(&run, |out| async move {
        out.render(&vec![Some("a"), None], &list(ListConfig::new()))
            .await
    })
    .await;
    assert_eq!(
        bullets,
        "\u{1b}[90m●\u{1b}[39m \u{1b}[36ma\u{1b}[39m\n\u{1b}[90m●\u{1b}[39m\n"
    );
    let numbers = render_each(&run, |out| async move {
        out.render(&vec!["a"], &list(ListConfig::new().ordered(true)))
            .await
    })
    .await;
    assert_eq!(numbers, "\u{1b}[90m1.\u{1b}[39m \u{1b}[36ma\u{1b}[39m\n");
}

#[test]
fn an_empty_sequence_prints_nothing_on_a_terminal_and_piped() {
    let view = list(ListConfig::<String>::new());
    assert_eq!(view.render(&[], &measured(Some(30))).unwrap(), "");
    assert_eq!(view.render(&[], &measured(None)).unwrap(), "");
}
