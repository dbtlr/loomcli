//! Escape sequences in streamed messages, including cuts inside marked frames.

mod support;

use loomcli_core::{RenderingPolicy, Switch, TerminalControls, style};
use loomcli_testing::Write;
use support::screen::replay;
use support::streaming::{Destination, Lane, bytes};

const ANSI: &[&str] = &[
    "Working \x1b]8;;https://example.com\x1b\\still on it\x1b]8;;\x1b\\ x",
    "a \x1b[31mred\x1b[0m b",
    "see \x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\ x",
    "title \x1b]0;never closed",
];

const CONTROLS: &[&str] = &[
    "a \x1bP1;2|data\x1b\\ b",
    "a \x1bXhidden\x1b\\ b",
    "a \x1b^private\x1b\\ b",
    "a \x1b_app\x1b\\ b",
    "a \x1b[?25l b",
    "a \u{90}a\u{9c} b",
    "a \u{98}a\u{9c} b",
    "a \u{9e}a\u{9c} b",
    "a \u{9f}a\u{9c} b",
];

fn kept() -> RenderingPolicy {
    RenderingPolicy::new()
        .color(Switch::Always)
        .modifiers(Switch::Always)
        .hyperlinks(Switch::Always)
        .terminal_controls(TerminalControls::Preserve)
}

fn cuts(text: &str) -> impl Iterator<Item = Vec<String>> + '_ {
    text.char_indices()
        .skip(1)
        .map(|(at, _)| vec![text[..at].to_owned(), text[at..].to_owned()])
}

fn assert_complete_writes(writes: &[Write], parts: &[String]) {
    for write in writes {
        let text = match write {
            Write::Stdout(text) | Write::Stderr(text) => text,
            _ => continue,
        };
        assert_eq!(
            loomcli_style::unfinished_sequence(text),
            None,
            "{parts:?}: {text:?}"
        );
    }
}

#[tokio::test]
async fn every_ansi_cut_has_the_joined_bytes_off_a_terminal_and_the_joined_screen_on_it() {
    for lane in [Lane::Info, Lane::Print] {
        for columns in [None, Some(16)] {
            let destination = Destination {
                columns,
                term: "xterm-256color",
                policy: kept(),
            };
            for text in ANSI {
                let whole = destination
                    .writes(lane, vec![(*text).to_owned()], false, false)
                    .await;
                for parts in cuts(text) {
                    let streamed = destination.writes(lane, parts.clone(), true, false).await;
                    if columns.is_some() {
                        assert_complete_writes(&streamed, &parts);
                        assert_eq!(
                            replay(&streamed, 16, true).lines,
                            replay(&whole, 16, true).lines,
                            "{lane:?} {parts:?}"
                        );
                    } else {
                        assert_eq!(bytes(&streamed), bytes(&whole), "{lane:?} {parts:?}");
                    }
                }
            }
        }
    }
}

#[tokio::test]
async fn preserved_device_controls_reach_the_terminal_with_their_payload_and_terminator() {
    let destination = Destination {
        columns: Some(16),
        term: "xterm-256color",
        policy: kept(),
    };
    for text in CONTROLS {
        let whole = destination
            .writes(Lane::Print, vec![(*text).to_owned()], false, false)
            .await;
        for parts in cuts(text) {
            let streamed = destination
                .writes(Lane::Print, parts.clone(), true, false)
                .await;
            assert_complete_writes(&streamed, &parts);
            assert_eq!(bytes(&streamed), bytes(&whole), "{parts:?}");
        }
    }
}

#[tokio::test]
async fn markup_between_a_sequences_bytes_does_not_part_the_sequence() {
    let destination = Destination {
        columns: Some(16),
        term: "xterm-256color",
        policy: kept(),
    };
    let parts = [
        vec![
            style().bold().apply("one\ntwo \x1b[3"),
            "1mred\x1b[0m x".to_owned(),
        ],
        vec![
            style().bold().apply("a \x1b]0;Build"),
            style().italic().apply(" done\x07 b"),
        ],
        vec![
            style().bold().apply("a \x1bP1;2|"),
            style().italic().apply("data\x1b\\ b"),
        ],
        vec![
            style().bold().apply("a \x1b"),
            style().italic().apply("[31mred\x1b[0m b"),
        ],
    ];
    for lane in [Lane::Info, Lane::Print] {
        for parts in &parts {
            let streamed = destination.writes(lane, parts.clone(), true, false).await;
            let whole = destination.writes(lane, parts.clone(), false, false).await;
            assert_complete_writes(&streamed, parts);
            assert_eq!(
                replay(&streamed, 16, true).lines,
                replay(&whole, 16, true).lines,
                "{lane:?} {parts:?}"
            );
        }
    }
}

#[tokio::test]
async fn controls_after_a_completed_print_line_do_not_make_a_row() {
    let destination = Destination {
        columns: Some(16),
        term: "xterm-256color",
        policy: kept(),
    };
    for parts in [
        ["ready\n", "\x1b]0;Build\x07", ""],
        ["ready\n", "\x1b]0;Build\nOK\x07", ""],
        ["ready\n", "\x1b]0;Build\nOK\x07", "done"],
        ["ready\n", "\x07", ""],
    ] {
        let parts = parts.map(str::to_owned).to_vec();
        let streamed = destination
            .writes(Lane::Print, parts.clone(), true, false)
            .await;
        let whole = destination
            .writes(Lane::Print, parts.clone(), false, false)
            .await;
        assert_eq!(bytes(&streamed), bytes(&whole), "{parts:?}");
    }
}
