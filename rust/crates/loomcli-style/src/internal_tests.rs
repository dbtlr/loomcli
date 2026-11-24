//! The reference's tests of the style module's internals: `unicode-width.test.ts`,
//! `wrap-fit.test.ts`, and `flat-text.test.ts`, with the generated corpus of `text-corpus.ts`.

use std::rc::Rc;

use crate::ansi::{is_control, scan_ansi};
use crate::color::ColorDepth;
use crate::glyph::Glyph;
use crate::layout::{block_width, is_flat, layout, rendered_units};
use crate::lines::{last_line_has_text, split_lines};
use crate::rendering::Capabilities;
use crate::resolve::{marked_width, resolve_text};
use crate::state::{Attributes, transition};
use crate::style::{Alignment, nowrap, pad, style};
use crate::theme::Palette;
use crate::width::grapheme_widths;
use crate::wire::{ParseOptions, parse_text};
use crate::wrap::{
    Breakable, Measurer, PadTracker, Span, breakable_marked, breakable_plain, lines_of, measure,
    runs_of, visible_of, wrap_marked, wrap_plain,
};

fn chars(text: &str) -> Vec<char> {
    text.chars().collect()
}

// --- unicode-width.test.ts ---

/// Each cluster as UTF-16 offsets, as the reference reports them.
fn utf16_segments(text: &str) -> Vec<[usize; 3]> {
    let characters = chars(text);
    let mut offsets = vec![0];
    for character in &characters {
        offsets.push(offsets.last().copied().unwrap_or(0) + character.len_utf16());
    }
    grapheme_widths(&characters)
        .into_iter()
        .map(|cluster| {
            [
                offsets.get(cluster.start).copied().unwrap_or(0),
                offsets.get(cluster.end).copied().unwrap_or(0),
                cluster.width,
            ]
        })
        .collect()
}

/// The FNV-1a digest of every 64-code-point run's clusters, as `scratch` computed it from the
/// reference build: `node width-oracle.mjs` over `packages/core/dist/style/width.js`, which the
/// reference's own test holds equal to uucode 2.2.1.
#[test]
fn every_code_point_measures_as_the_pinned_uucode_release_does() {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |text: &str| {
        for byte in text.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    let mut runs = 0;
    let mut first = 0_u32;
    while first <= 0x10_ffff {
        // A run of surrogates holds no character a Rust string can carry.
        if !(0xd800..0xe000).contains(&first) {
            let text: String = (first..(first + 64).min(0x11_0000))
                .filter_map(char::from_u32)
                .collect();
            for [start, end, width] in utf16_segments(&text) {
                feed(&format!("{start},{end},{width};"));
            }
            feed("|");
            runs += 1;
        }
        first += 64;
    }
    assert_eq!(runs, 17_376);
    assert_eq!(format!("{hash:x}"), "d961d30085d62e6f");
}

#[test]
fn named_sequences_measure_as_the_pinned_uucode_release_does() {
    let cases: [(&str, &[[usize; 3]]); 15] = [
        ("\u{1f469}\u{200d}\u{1f4bb}", &[[0, 5, 2]]),
        (
            "\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}",
            &[[0, 11, 2]],
        ),
        ("\u{1f1ef}\u{1f1f5}", &[[0, 4, 2]]),
        ("\u{1f1ef}\u{1f1f5}\u{1f1fa}", &[[0, 4, 2], [4, 6, 1]]),
        ("\u{1f44b}\u{1f3fd}", &[[0, 4, 2]]),
        ("\u{263a}\u{fe0f}", &[[0, 2, 2]]),
        ("\u{231a}\u{fe0e}", &[[0, 2, 1]]),
        ("e\u{301}\u{302}x", &[[0, 3, 1], [3, 4, 1]]),
        ("\u{915}\u{94d}\u{200d}\u{937}", &[[0, 4, 2]]),
        ("\u{1100}\u{1161}\u{11a8}", &[[0, 3, 2]]),
        (
            "a\r\nb\u{7}\u{7f}",
            &[[0, 1, 1], [1, 3, 0], [3, 4, 1], [4, 5, 0], [5, 6, 0]],
        ),
        ("a\u{200d}\u{1f4bb}", &[[0, 2, 1], [2, 4, 2]]),
        (
            "\u{1f469}\u{200d}\u{1f4bb}\u{65e5}\u{672c}",
            &[[0, 5, 2], [5, 6, 2], [6, 7, 2]],
        ),
        ("ab\u{301}", &[[0, 1, 1], [1, 3, 1]]),
        ("", &[]),
    ];
    for (text, expected) in cases {
        assert_eq!(utf16_segments(text), expected, "{text:?}");
    }
}

// --- text-corpus.ts ---

/// A seeded generator, so a failing text rebuilds from its seed.
struct Seeded(u32);

impl Seeded {
    fn next(&mut self, below: usize) -> usize {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        // The product is below `below`, so the conversion back is exact.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let value = ((f64::from(self.0) / 4_294_967_296.0) * below as f64).floor() as usize;
        value
    }
}

fn code_points(points: &[u32]) -> String {
    points
        .iter()
        .filter_map(|point| char::from_u32(*point))
        .collect()
}

const SPACE: u32 = 0x20;
const MARK: u32 = 0x301;
const JOINER: u32 = 0x200d;
const SELECTOR: u32 = 0xfe0f;
const ESCAPE: u32 = 0x1b;

/// Pieces of text that break a naive width sum, each for its own reason. The reference's two
/// lone surrogates are left out: a Rust string cannot hold one.
fn pieces() -> Vec<String> {
    let escape = code_points(&[ESCAPE]);
    let mut pieces: Vec<String> = [
        "a",
        "bb",
        "word",
        "hello",
        "abcdefghijklmnopqrstuvwxyz0123456789",
        " ",
        " ",
        " ",
        "  ",
        "   ",
        "\n",
        "\r\n",
        "\r",
        "\t",
        "\ta",
    ]
    .iter()
    .map(|piece| (*piece).to_owned())
    .collect();
    for points in [
        &[SPACE, MARK][..],
        &[SPACE, JOINER],
        &[SPACE, 0x903],
        &[0x65, MARK],
        &[MARK],
        &[JOINER],
        &[SELECTOR],
        &[0x1f468, JOINER, 0x1f469, JOINER, 0x1f467],
        &[0x1f3f3, SELECTOR, JOINER, 0x1f308],
        &[0x2764, SELECTOR],
        &[0x2764],
        &[0x1f44d, 0x1f3fd],
        &[0x1f1fa, 0x1f1f8],
        &[0x1f1fa],
        &[0x1f1fa, 0x1f1f8, 0x1f1ec],
        &[0x1f600],
        &[0x4f60, 0x597d],
        &[0x4e16, 0x754c],
        &[0xff21, 0xff22],
        &[0x1100, 0x1161, 0x11a8],
        &[0xd55c, 0xae00],
        &[0x30ab, 0x30ca],
        &[0x600],
        &[0x600, 0x61],
        &[0x600, SPACE],
        &[0xd4e],
        &[0x915, 0x94d, 0x937],
        &[0xe33],
        &[0x1fac8],
        &[0x1fadc],
        &[0x323b0],
        &[0x07],
        &[0x9b],
    ] {
        pieces.push(code_points(points));
    }
    for piece in [
        format!("{escape}[31m"),
        format!("{escape}[0m"),
        format!("{escape}]8;;http://a b{escape}\\"),
        format!("{escape}]0;t t\u{7}"),
        format!("{escape}["),
        format!("{escape}[3"),
        format!("{escape}(B"),
        format!("{escape}Pdata{escape}\\"),
        format!("{}31m", code_points(&[0x9b])),
        "\u{E002}".to_owned(),
        "\u{E000}".to_owned(),
        "\u{E000}[\"bad\"]\u{E001}".to_owned(),
    ] {
        pieces.push(piece);
    }
    pieces
}

const ALIGNMENTS: [Alignment; 3] = [Alignment::Left, Alignment::Right, Alignment::Center];

/// Marked text: pieces joined, some wrapped in a style, no-wrap, or padding frame, or a glyph.
fn marked(next: &mut Seeded, depth: usize, pieces: &[String]) -> String {
    let count = 1 + next.next(9);
    let parts: Vec<String> = (0..count)
        .map(|_| {
            let choice = next.next(if depth > 0 { 12 } else { 8 });
            if choice < 8 {
                return pieces
                    .get(next.next(pieces.len()))
                    .cloned()
                    .unwrap_or_default();
            }
            let inner = marked(next, depth.saturating_sub(1), pieces);
            match choice {
                8 => style().red().apply(&inner),
                9 => nowrap(&inner),
                10 => {
                    let width = next.next(14);
                    let align = ALIGNMENTS
                        .get(next.next(ALIGNMENTS.len()))
                        .copied()
                        .unwrap_or_default();
                    pad(&inner, width, align).unwrap_or_default()
                }
                _ => Glyph::ALL
                    .get(next.next(Glyph::ALL.len()))
                    .map(ToString::to_string)
                    .unwrap_or_default(),
            }
        })
        .collect();
    parts.join(if next.next(5) == 0 { " " } else { "" })
}

/// The pieces joined as raw text, with no frame to read.
fn raw(next: &mut Seeded, pieces: &[String]) -> String {
    let literal: Vec<&String> = pieces
        .iter()
        .filter(|piece| {
            !piece
                .chars()
                .any(|c| ('\u{E000}'..='\u{E003}').contains(&c))
        })
        .collect();
    let count = 1 + next.next(12);
    (0..count)
        .map(|_| {
            literal
                .get(next.next(literal.len()))
                .map(|piece| piece.as_str())
                .unwrap_or_default()
        })
        .collect()
}

/// Ordinary prose, where the one reading answers nearly every span.
fn prose(next: &mut Seeded, length: usize) -> String {
    let words = [
        "a", "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "wrapping",
    ];
    let mut text = String::new();
    while text.encode_utf16().count() < length {
        text.push_str(
            words
                .get(next.next(words.len()))
                .copied()
                .unwrap_or_default(),
        );
        text.push_str(if next.next(9) == 0 { "  " } else { " " });
    }
    text
}

// --- wrap-fit.test.ts ---

/// The destinations marked text wraps for: main and fallback glyph forms, controls and none.
const DESTINATIONS: [Capabilities; 2] = [
    Capabilities {
        color: true,
        depth: ColorDepth::Truecolor,
        hyperlinks: true,
        main_glyphs: true,
        modifiers: true,
        terminal_controls: true,
    },
    Capabilities {
        color: false,
        depth: ColorDepth::Ansi16,
        hyperlinks: false,
        main_glyphs: false,
        modifiers: false,
        terminal_controls: false,
    },
];

const COLUMNS_TO_TRY: [usize; 13] = [1, 2, 3, 4, 5, 6, 8, 9, 13, 21, 34, 55, 120];

static PALETTE: Palette = Palette::new();

/// The constructions that make a sum of word widths wrong, one text each.
fn constructions() -> Vec<String> {
    let escape = code_points(&[ESCAPE]);
    let padded =
        |text: &str, width: usize, align: Alignment| pad(text, width, align).unwrap_or_default();
    vec![
        format!("ab {}cd ef", code_points(&[MARK])),
        format!(
            "ab {}cd {}ef",
            code_points(&[SPACE, MARK]),
            code_points(&[SPACE, JOINER])
        ),
        format!(
            "ab{} cd {} ef",
            code_points(&[0x600]),
            code_points(&[0x600])
        ),
        "a\tb c\td e\tf g\th".to_owned(),
        "aaaa\tbbbb cccc\tdddd".to_owned(),
        format!(
            "ab {} de {} gh {}",
            padded("c", 6, Alignment::Left),
            padded("f g", 4, Alignment::Right),
            padded("i", 3, Alignment::Center)
        ),
        padded("aa bb cc dd", 5, Alignment::Left),
        format!("{} ee ff", padded("aa bb\ncc dd", 7, Alignment::Left)),
        format!(
            "{} ii jj",
            padded("aa bb\ncc dd\nee ff gg\nhh", 12, Alignment::Left)
        ),
        format!(
            "x {} y {} z {}",
            nowrap("a b c"),
            Glyph::Tick,
            Glyph::Bullet
        ),
        format!(
            "{} {escape}[1mcc dd{escape}[0m {}",
            style().red().apply("aa bb"),
            style()
                .blue()
                .apply(&format!("ee {}", style().bold().apply("ff gg")))
        ),
        format!("aa {escape}]8;;http://x y{escape}\\bb cc{escape}]8;;{escape}\\ dd"),
        "aa bb\r\ncc dd\nee ff\rgg hh\r\n".to_owned(),
        [
            code_points(&[0x1f468, JOINER, 0x1f469]),
            code_points(&[0x1f1fa, 0x1f1f8, 0x1f1ec]),
            code_points(&[0x1f44d, 0x1f3fd]),
            code_points(&[0x2764, SELECTOR]),
            code_points(&[0x2764]),
        ]
        .join(" "),
        [
            code_points(&[0x4f60, 0x597d]),
            code_points(&[0xff21, 0xff22]),
            code_points(&[0x1100, 0x1161, 0x11a8]),
            code_points(&[0x1fac8]),
            code_points(&[0x323b0]),
        ]
        .join(" "),
    ]
}

/// Each reading of a text that line breaking makes: marked for each destination, and plain.
fn readings(text: &[char]) -> Vec<Breakable<'static>> {
    let mut readings: Vec<Breakable<'static>> = DESTINATIONS
        .iter()
        .map(|caps| breakable_marked(text, caps, &PALETTE))
        .collect();
    readings.push(breakable_plain(text));
    readings
}

/// Every span greedy fitting could ask the measurer about, where it and `measure` disagree.
fn measurer_failures(text: &str) -> Vec<String> {
    let mut failures = Vec::new();
    for breakable in readings(&chars(text)) {
        let visible = visible_of(&breakable);
        let mut pads = PadTracker::new();
        for line in lines_of(&breakable) {
            let runs = runs_of(&breakable, line);
            if runs.is_empty() {
                continue;
            }
            let enclosing = pads.at(&breakable.parsed.boundaries, line.start);
            let measurer = Measurer::new(&breakable, line, &visible);
            let mut starts = vec![line.start];
            starts.extend(runs.iter().map(|run| run.end));
            for (index, run) in runs.iter().enumerate() {
                let end = runs.get(index + 1).map_or(line.end, |next| next.start);
                for start in starts.iter().copied().filter(|start| *start <= run.start) {
                    let span = Span {
                        start,
                        end,
                        enclosing: if start == line.start {
                            enclosing.clone()
                        } else {
                            Vec::new()
                        },
                    };
                    let fast = measurer.width(&breakable, &span);
                    let exact = measure(&breakable, &span);
                    if fast != exact {
                        failures.push(format!("{text:?} {start}..{end}: {fast}, not {exact}"));
                    }
                }
            }
        }
    }
    failures
}

#[test]
fn the_measurer_gives_the_width_measure_gives_for_generated_texts() {
    let pieces = pieces();
    let mut next = Seeded(95);
    let found: Vec<String> = (0..400)
        .flat_map(|_| measurer_failures(&marked(&mut next, 3, &pieces)))
        .collect();
    assert_eq!(found, Vec::<String>::new());
}

#[test]
fn the_measurer_gives_the_width_measure_gives_for_plain_texts_and_prose() {
    let pieces = pieces();
    let mut next = Seeded(96);
    let mut found: Vec<String> = (0..400)
        .flat_map(|_| measurer_failures(&raw(&mut next, &pieces)))
        .collect();
    found.extend((0..4).flat_map(|_| measurer_failures(&prose(&mut next, 400))));
    assert_eq!(found, Vec::<String>::new());
}

#[test]
fn the_measurer_gives_the_width_measure_gives_for_the_constructions() {
    let found: Vec<String> = constructions()
        .iter()
        .flat_map(|text| measurer_failures(text))
        .collect();
    assert_eq!(found, Vec::<String>::new());
}

/// Each line of wrapped output wider than `columns` that holds a break opportunity.
fn wide_lines(breakable: &Breakable<'_>, columns: usize) -> Vec<String> {
    let block = layout(scan_ansi(breakable.parsed.view(), &breakable.caps));
    lines_of(breakable)
        .into_iter()
        .enumerate()
        .filter_map(|(index, line)| {
            let width = block
                .lines
                .get(index)
                .map_or(0, |line| line.content.width());
            (width > columns && !runs_of(breakable, line).is_empty())
                .then(|| format!("line {index} is {width} wide"))
        })
        .collect()
}

/// Each width at which wrapping a text leaves a line wider than the width with a place to break.
fn fit_failures(text: &str) -> Vec<String> {
    let mut failures = Vec::new();
    for columns in COLUMNS_TO_TRY {
        for caps in &DESTINATIONS {
            let wrapped = wrap_marked(text, Some(columns), caps, &PALETTE).unwrap_or_default();
            let breakable = breakable_marked(&chars(&wrapped), caps, &PALETTE);
            failures.extend(
                wide_lines(&breakable, columns)
                    .into_iter()
                    .map(|detail| format!("{text:?} {columns}: {detail}")),
            );
        }
        let wrapped = wrap_plain(text, columns).unwrap_or_default();
        failures.extend(
            wide_lines(&breakable_plain(&chars(&wrapped)), columns)
                .into_iter()
                .map(|detail| format!("{text:?} {columns}: {detail}")),
        );
    }
    failures
}

#[test]
fn no_wrapped_line_is_wider_than_the_width_unless_it_is_one_unit() {
    let pieces = pieces();
    let mut next = Seeded(97);
    let mut texts: Vec<String> = (0..300).map(|_| marked(&mut next, 3, &pieces)).collect();
    texts.extend((0..300).map(|_| raw(&mut next, &pieces)));
    texts.extend((0..4).map(|_| prose(&mut next, 400)));
    texts.extend(constructions());
    let found: Vec<String> = texts.iter().flat_map(|text| fit_failures(text)).collect();
    assert_eq!(found, Vec::<String>::new());
}

#[test]
fn a_wrapped_line_could_not_take_the_first_word_of_the_next() {
    let words: Vec<String> = pieces()
        .into_iter()
        .filter(|piece| {
            !piece
                .chars()
                .any(|c| c == ' ' || is_control(c) || ('\u{E000}'..='\u{E003}').contains(&c))
        })
        .collect();
    let width_of = |text: &str| {
        let breakable = breakable_plain(&chars(text));
        block_width(&layout(scan_ansi(
            breakable.parsed.view(),
            &Capabilities::PLAIN,
        )))
    };
    let mut next = Seeded(98);
    let mut found = Vec::new();
    for _ in 0..400 {
        let count = 2 + next.next(14);
        let chosen: Vec<String> = (0..count)
            .map(|_| {
                words
                    .get(next.next(words.len()))
                    .cloned()
                    .unwrap_or_default()
            })
            .collect();
        let text = chosen.join(if next.next(4) == 0 { "" } else { " " });
        for columns in COLUMNS_TO_TRY {
            let wrapped = wrap_plain(&text, columns).unwrap_or_default();
            let lines: Vec<&str> = wrapped.split('\n').collect();
            for (index, line) in lines.iter().enumerate().take(lines.len().saturating_sub(1)) {
                let word = lines
                    .get(index + 1)
                    .and_then(|next| next.split(' ').next())
                    .unwrap_or_default();
                if width_of(&format!("{line} {word}")) <= columns {
                    found.push(format!("{text:?} {columns}: line {index} fits {word}"));
                }
            }
        }
    }
    assert_eq!(found, Vec::<String>::new());
}

// --- flat-text.test.ts ---

/// Resolving as the layout does it, for any text.
fn laid_out(text: &str, caps: &Capabilities) -> String {
    let input = chars(text);
    let parsed = parse_text(
        &input,
        &PALETTE,
        ParseOptions {
            any_token: false,
            main_glyphs: caps.main_glyphs,
            trace: None,
        },
    );
    let empty = Rc::new(Attributes::default());
    let mut previous = Rc::clone(&empty);
    let mut result = String::new();
    for unit in rendered_units(&layout(scan_ansi(parsed.view(), caps))) {
        result.push_str(&transition(&previous, &unit.attributes, caps));
        result.extend(unit.text.iter());
        previous = Rc::clone(&unit.attributes);
    }
    result.push_str(&transition(&previous, &empty, caps));
    result
}

/// Generated texts: marked ones, with every frame, and raw ones, with every control character.
fn flat_texts() -> Vec<String> {
    let pieces = pieces();
    let mut next = Seeded(98);
    let mut texts: Vec<String> = (0..1500).map(|_| marked(&mut next, 3, &pieces)).collect();
    texts.extend((0..1500).map(|_| raw(&mut next, &pieces)));
    texts
}

#[test]
fn a_flat_text_measures_as_the_layout_measures_it() {
    let found: Vec<String> = flat_texts()
        .into_iter()
        .filter(|text| {
            let input = chars(text);
            DESTINATIONS.iter().any(|caps| {
                let parsed = parse_text(
                    &input,
                    &PALETTE,
                    ParseOptions {
                        any_token: false,
                        main_glyphs: caps.main_glyphs,
                        trace: None,
                    },
                );
                marked_width(&input, &PALETTE, caps)
                    != block_width(&layout(scan_ansi(parsed.view(), caps)))
            })
        })
        .collect();
    assert_eq!(found, Vec::<String>::new());
}

#[test]
fn a_flat_text_ends_in_a_line_with_text_as_the_layout_finds_it() {
    let found: Vec<String> = flat_texts()
        .into_iter()
        .filter(|text| {
            let input = chars(text);
            let parsed = parse_text(
                &input,
                &PALETTE,
                ParseOptions {
                    any_token: false,
                    main_glyphs: false,
                    trace: None,
                },
            );
            let laid = layout(scan_ansi(parsed.view(), &Capabilities::PLAIN))
                .lines
                .last()
                .is_some_and(|line| line.content.text);
            last_line_has_text(&parsed) != laid
        })
        .collect();
    assert_eq!(found, Vec::<String>::new());
}

#[test]
fn a_flat_text_resolves_as_the_layout_resolves_it() {
    let found: Vec<String> = flat_texts()
        .into_iter()
        .filter(|text| {
            DESTINATIONS
                .iter()
                .any(|caps| resolve_text(&chars(text), &PALETTE, caps) != laid_out(text, caps))
        })
        .collect();
    assert_eq!(found, Vec::<String>::new());
}

#[test]
fn the_generated_texts_hold_flat_and_other_texts_both() {
    let flat = flat_texts()
        .iter()
        .filter(|text| {
            let input = chars(text);
            let parsed = parse_text(
                &input,
                &PALETTE,
                ParseOptions {
                    any_token: false,
                    main_glyphs: true,
                    trace: None,
                },
            );
            is_flat(&parsed.view())
        })
        .count();
    assert!(flat > 300, "{flat}");
    assert!(flat < 2700, "{flat}");
}

#[test]
fn split_lines_reads_every_generated_text_without_failing() {
    for text in flat_texts() {
        let lines = split_lines(&text);
        assert!(!lines.is_empty());
    }
}

#[test]
fn graphemes_split_text_into_its_extended_clusters() {
    assert_eq!(
        crate::graphemes("aé👨‍👩‍👧‍👦日\u{200b}"),
        ["a", "é", "👨‍👩‍👧‍👦", "日", "\u{200b}"]
    );
    assert!(crate::graphemes("").is_empty());
}
