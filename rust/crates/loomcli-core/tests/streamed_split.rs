//! A split carries the style state of finished lines without changing later writes.

mod support;

use loomcli_core::{Alignment, RenderingPolicy, Switch, TerminalControls, nowrap, pad, style};
use support::streaming::{Destination, Lane, bytes};

fn texts() -> Vec<String> {
    [
        "a \x1b[31mred\x1b[0m b and more words\nnext line here\nlast",
        "a \x1b[31mred\nstill red line and on\n\x1b[1mbold too\nend\x1b[0m tail",
        "\x1b[5mblink\x1b[0m\nafter blink\nend",
        "\x1b[1mone \x1b[3mtwo \x1b[22mthree\n\x1b[1mfour\nfive \x1b[0m six\nseven",
        "\x1b[31ma\x1b[32mb\x1b[33mc\x1b[39md\n\x1b[44me\x1b[49mf\n\x1b[38;5;100mg\nh\x1b[0m",
        "see \x1b]8;;https://example.com\x1b\\link\nstill link\x1b]8;;\x1b\\ done\nend",
        "see \x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\ done\nnext\nend",
        "see \x1b]8;;https://example.com/a\nb\x1b\\link\nstill\x1b]8;;\x1b\\ done\nend",
        "abc\rdef and more\nghi jkl\nmno",
        "ab\x1b[2Kcd\x07ef\nnext line\nend",
        "\u{e000}[\"bogus\"]\u{e001}x\u{e002} y \u{e002} z\nnext\nend",
        "\u{e000}[\"style\",[[\"token\",\"nope\"]]]\u{e001}a\nb\u{e002}\nc\nd",
        "title \x1b]0;window\nmore\x1b\\ rest\nnext\nend",
        "a\tb \x1b[31mc\td\ne\tf\ng",
        "a \x1b[31mb\r\nc\r\nd",
        "\x1b[5mone two\x1b[25m\n\x1b[5mthree\x1b[25m four\n\x1b[11mfive\x1b[10m\nsix",
        "\x1b[38;5;196ma\x1b[38;5;160mb\nc\x1b[1md\ne\x1b[38;5;196mf\ng",
        "\x1b[38;2;255;0;0ma\nb\x1b[38;2;250;0;0mc\x1b[48;5;17m\nd\x1b[38;2;255;0;0me\nf",
    ]
    .into_iter()
    .map(str::to_owned)
    .chain([
        format!(
            "{}\nafter\nend",
            style().bold().apply("x \x1b[5mblink\nmore")
        ),
        format!(
            "{} plain\n\x1b[39mafter\nend",
            style().red().apply("red \x1b[1mbold\nstill")
        ),
        format!(
            "{} c\nnext\nend",
            pad("ab", 6, Alignment::Left).unwrap_or_default()
        ),
        format!(
            "x {} y\nlast",
            pad("ab\ncd ef\ngh", 8, Alignment::Right).unwrap_or_default()
        ),
        format!(
            "{}\nafter\nend",
            pad("\x1b[31mred\nx", 6, Alignment::Left).unwrap_or_default()
        ),
        format!(
            "{}\nend words here",
            nowrap("a b c\nd e f g h i j k l m n o p q r s")
        ),
    ])
    .collect()
}

fn chunkings(text: &str) -> Vec<Vec<String>> {
    let chars: Vec<char> = text.chars().collect();
    vec![
        text.split_inclusive('\n').map(str::to_owned).collect(),
        text.split_inclusive(' ').map(str::to_owned).collect(),
        chars
            .chunks(3)
            .map(|chars| chars.iter().collect())
            .collect(),
        chars
            .chunks(5)
            .map(|chars| chars.iter().collect())
            .collect(),
    ]
}

fn destinations() -> impl Iterator<Item = Destination> {
    [None, Some(30)].into_iter().flat_map(|columns| {
        ["xterm", "xterm-256color", "xterm-direct"]
            .into_iter()
            .flat_map(move |term| {
                [Switch::Always, Switch::Never]
                    .into_iter()
                    .map(move |color| Destination {
                        columns,
                        term,
                        policy: RenderingPolicy::new()
                            .color(color)
                            .modifiers(Switch::Always)
                            .hyperlinks(Switch::Always)
                            .terminal_controls(TerminalControls::Preserve),
                    })
            })
    })
}

#[tokio::test]
async fn piped_streams_keep_the_whole_messages_bytes_after_every_split() {
    for destination in destinations().filter(|destination| destination.columns.is_none()) {
        for lane in [Lane::Info, Lane::Print] {
            for text in texts() {
                let whole = destination
                    .writes(lane, vec![text.clone()], false, false)
                    .await;
                for chunks in chunkings(&text) {
                    let streamed = destination.writes(lane, chunks.clone(), true, false).await;
                    assert_eq!(
                        bytes(&streamed),
                        bytes(&whole),
                        "{lane:?} {} {chunks:?}",
                        destination.term
                    );
                }
            }
        }
    }
}

#[tokio::test]
async fn a_default_lane_writes_the_same_pieces_as_an_identical_override() {
    let mut cases = texts();
    cases.push(
        "\u{e000}[\"style\",\n[[\"modifier\",\"bold\"]]]\u{e001}bold\ntext\u{e002}\nend".to_owned(),
    );
    for destination in destinations() {
        for lane in [Lane::Info, Lane::Print] {
            for text in cases.iter() {
                for chunks in chunkings(text) {
                    let whole = destination.writes(lane, chunks.clone(), true, true).await;
                    let streamed = destination.writes(lane, chunks.clone(), true, false).await;
                    assert_eq!(
                        streamed, whole,
                        "{lane:?} {} {:?} {chunks:?}",
                        destination.term, destination.columns
                    );
                }
            }
        }
    }
}
