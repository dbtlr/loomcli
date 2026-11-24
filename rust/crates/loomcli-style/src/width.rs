//! Grapheme clusters and the terminal columns each occupies, ported from the grapheme width
//! iterator of `@rockorager/uucode` 2.2.1 (`src/width.ts`), with its Unicode 17 tables.
//!
//! Copyright (c) 2026 Tim Culverhouse. Licensed under the MIT License, in
//! `licenses/uucode-LICENSE.md` of this crate. The tables derive from the Unicode Character
//! Database, Copyright © 1991-2025 Unicode, Inc., licensed under the Unicode License v3, in
//! `licenses/unicode-LICENSE.txt`. `scripts/generate.py` writes them from the reference.

/// The grapheme break state machine, indexed by state and two break properties.
static BREAK_TABLE: &[u8] = include_bytes!("tables/break_table.bin");
/// The first lookup stage, 16-bit little-endian offsets into the second.
static STAGE1: &[u8] = include_bytes!("tables/stage1.bin");
/// The second lookup stage, indices into the third.
static STAGE2: &[u8] = include_bytes!("tables/stage2.bin");
/// The third lookup stage, 16-bit little-endian packed rows.
static STAGE3: &[u8] = include_bytes!("tables/stage3.bin");

const GRAPHEME_BREAK_PROPERTY_COUNT: usize = 20;
const STAGE1_SHIFT: u32 = 8;
const STAGE2_MASK: u32 = 255;
const WIDTH_MASK: u16 = 3;
const ZERO_WIDTH_FLAG: u16 = 4;
const EMOJI_VS_FLAG: u16 = 1;

/// The break state after a regional indicator, which pairs with the next one into a flag.
const REGIONAL_INDICATOR_STATE: u8 = 1;
/// The break state inside an extended pictographic sequence, which a ZWJ continues.
const PICTOGRAPHIC_STATE: u8 = 2;

/// The row an empty string starts from: the Other break property at width one.
const DEFAULT_ROW: u16 = 1 << 5;

fn u16_at(table: &[u8], index: usize) -> u16 {
    let low = table.get(index * 2).copied().unwrap_or(0);
    let high = table.get(index * 2 + 1).copied().unwrap_or(0);
    u16::from_le_bytes([low, high])
}

/// A code point's packed row: its grapheme break property, width, and emoji flags.
fn lookup(character: char) -> u16 {
    let code_point = u32::from(character);
    let offset = usize::from(u16_at(STAGE1, (code_point >> STAGE1_SHIFT) as usize));
    let index = STAGE2
        .get(offset + (code_point & STAGE2_MASK) as usize)
        .copied()
        .unwrap_or(0);
    u16_at(STAGE3, usize::from(index))
}

fn grapheme_break(row: u16) -> usize {
    usize::from(row & 0x1f)
}

fn row_width(row: u16) -> usize {
    usize::from((row >> 5) & WIDTH_MASK)
}

fn zero_in_grapheme(row: u16) -> bool {
    (row >> 5) & ZERO_WIDTH_FLAG != 0
}

fn emoji_selector_base(row: u16) -> bool {
    (row >> 8) & EMOJI_VS_FLAG != 0
}

/// The next break state shifted left once, with whether a cluster boundary falls between.
fn break_transition(before: usize, after: usize, state: u8) -> u8 {
    let count = GRAPHEME_BREAK_PROPERTY_COUNT;
    BREAK_TABLE
        .get((usize::from(state) * count + before) * count + after)
        .copied()
        .unwrap_or(0)
}

/// One grapheme cluster: where it starts and ends, in characters, and the columns it occupies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GraphemeWidth {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) width: usize,
}

/// The cursor over one text: the current character and row, and the lookahead after them.
struct Cursor<'a> {
    text: &'a [char],
    state: u8,
    index: usize,
    code_point: char,
    row: u16,
    is_break: bool,
    has_next: bool,
    next_index: usize,
    next_code_point: char,
    next_row: u16,
}

impl<'a> Cursor<'a> {
    /// A cursor at the start of a run, with the run's first character read ahead.
    fn new(text: &'a [char], start: usize) -> Cursor<'a> {
        let first = text.get(start).copied();
        Cursor {
            text,
            state: 0,
            index: start,
            code_point: '\0',
            row: DEFAULT_ROW,
            is_break: false,
            has_next: first.is_some(),
            next_index: if first.is_some() { start + 1 } else { start },
            next_code_point: first.unwrap_or('\0'),
            next_row: first.map_or(DEFAULT_ROW, lookup),
        }
    }

    /// Moves to the next character and reads whether a cluster boundary follows it.
    fn advance(&mut self) -> bool {
        if !self.has_next {
            return false;
        }
        self.code_point = self.next_code_point;
        self.row = self.next_row;
        let index = self.next_index;
        self.index = index;
        let Some(&character) = self.text.get(index) else {
            self.has_next = false;
            self.is_break = true;
            return true;
        };
        let row = lookup(character);
        let packed = break_transition(grapheme_break(self.row), grapheme_break(row), self.state);
        self.state = packed >> 1;
        self.next_code_point = character;
        self.next_index = index + 1;
        self.next_row = row;
        self.is_break = packed & 1 != 0;
        true
    }

    /// The width of the next grapheme cluster, leaving the cursor at its end.
    fn cluster_width(&mut self) -> usize {
        if !self.advance() {
            return 0;
        }
        let standalone = row_width(self.row);
        if self.is_break {
            return standalone;
        }
        let mut width = if zero_in_grapheme(self.row) {
            0
        } else {
            standalone
        };
        let mut previous_row = self.row;
        let mut previous_state = self.state;
        loop {
            if !self.advance() {
                break;
            }
            match u32::from(self.code_point) {
                0xfe0f => {
                    if emoji_selector_base(previous_row) {
                        width = 2;
                    }
                }
                0xfe0e => {
                    if emoji_selector_base(previous_row) {
                        width = 1;
                    }
                }
                0x200d => {
                    if previous_state == PICTOGRAPHIC_STATE && !self.is_break {
                        if !self.advance() || self.is_break {
                            return width;
                        }
                        previous_row = self.row;
                        previous_state = self.state;
                        continue;
                    }
                }
                0x1f3fb..=0x1f3ff => width = 2,
                _ => {
                    if previous_state == REGIONAL_INDICATOR_STATE {
                        width = 2;
                    } else if !zero_in_grapheme(self.row) {
                        width += row_width(self.row);
                    }
                }
            }
            if self.is_break {
                break;
            }
            previous_row = self.row;
            previous_state = self.state;
        }
        width
    }
}

/// Whether the character at an index is printable ASCII that no non-ASCII character follows.
fn ascii_alone(text: &[char], index: usize) -> bool {
    let Some(&character) = text.get(index) else {
        return false;
    };
    (' '..'\u{7f}').contains(&character)
        && text
            .get(index + 1)
            .is_none_or(|next| u32::from(*next) < 0x80)
}

/// Each grapheme cluster of a text with the terminal columns it occupies. Printable ASCII that no
/// non-ASCII character follows is its own one-column cluster; any other run of clusters is read by
/// one cursor, which carries the break state from cluster to cluster.
pub(crate) fn grapheme_widths(text: &[char]) -> Vec<GraphemeWidth> {
    let mut clusters = Vec::new();
    let mut start = 0;
    while start < text.len() {
        if ascii_alone(text, start) {
            clusters.push(GraphemeWidth {
                start,
                end: start + 1,
                width: 1,
            });
            start += 1;
            continue;
        }
        let mut cursor = Cursor::new(text, start);
        loop {
            let width = cursor.cluster_width();
            clusters.push(GraphemeWidth {
                start,
                end: cursor.index,
                width,
            });
            // A cursor that made no progress would loop forever; it cannot, but stop if it did.
            if cursor.index <= start {
                return clusters;
            }
            start = cursor.index;
            if start >= text.len() || ascii_alone(text, start) {
                break;
            }
        }
    }
    clusters
}

/// The cumulative columns of a text's clusters, read once.
pub(crate) struct ClusterColumns {
    /// At each offset, and one past the last, the columns of the clusters that start before it.
    /// An offset inside a cluster counts that cluster.
    pub(crate) before: Vec<usize>,
    /// Whether each offset, and one past the last, is where a cluster starts or the text ends.
    pub(crate) boundary: Vec<bool>,
}

/// The cumulative columns of a text's clusters: the columns between two offsets are the
/// difference of `before` there.
pub(crate) fn cluster_columns(text: &[char]) -> ClusterColumns {
    let mut before = vec![0; text.len() + 1];
    let mut boundary = vec![false; text.len() + 1];
    let mut total = 0;
    for cluster in grapheme_widths(text) {
        if let Some(slot) = before.get_mut(cluster.start) {
            *slot = total;
        }
        if let Some(slot) = boundary.get_mut(cluster.start) {
            *slot = true;
        }
        total += cluster.width;
        for slot in before
            .iter_mut()
            .take(cluster.end + 1)
            .skip(cluster.start + 1)
        {
            *slot = total;
        }
    }
    if let Some(slot) = boundary.last_mut() {
        *slot = true;
    }
    ClusterColumns { before, boundary }
}

/// The extended grapheme clusters of `text`, in order: the clusters the width tables measure, which
/// a terminal draws as one unit, so an editor moves and deletes them whole and a view never splits
/// one. Joined, they are `text`.
#[must_use]
pub fn graphemes(text: &str) -> Vec<&str> {
    let characters: Vec<char> = text.chars().collect();
    let mut offsets = Vec::with_capacity(characters.len() + 1);
    let mut offset = 0;
    for character in &characters {
        offsets.push(offset);
        offset += character.len_utf8();
    }
    offsets.push(offset);
    grapheme_widths(&characters)
        .iter()
        .filter_map(|cluster| {
            let start = *offsets.get(cluster.start)?;
            let end = *offsets.get(cluster.end)?;
            text.get(start..end)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segments(text: &str) -> Vec<[usize; 3]> {
        let chars: Vec<char> = text.chars().collect();
        grapheme_widths(&chars)
            .into_iter()
            .map(|cluster| [cluster.start, cluster.end, cluster.width])
            .collect()
    }

    #[test]
    fn after_other_the_break_table_carries_no_state() {
        let count = GRAPHEME_BREAK_PROPERTY_COUNT;
        for state in 0..5 {
            for after in 0..count {
                let packed = BREAK_TABLE
                    .get((state * count) * count + after)
                    .copied()
                    .unwrap_or(0);
                assert_eq!(packed >> 1, 0, "state {state} then property {after}");
            }
        }
    }

    #[test]
    fn the_tables_have_the_reference_sizes() {
        assert_eq!(BREAK_TABLE.len(), 5 * 20 * 20);
        assert_eq!(STAGE1.len(), 2 * (0x11_0000 >> 8));
    }

    #[test]
    fn clusters_and_widths() {
        assert_eq!(segments(""), Vec::<[usize; 3]>::new());
        assert_eq!(segments("ab"), vec![[0, 1, 1], [1, 2, 1]]);
        assert_eq!(segments("\u{1f469}\u{200d}\u{1f4bb}"), vec![[0, 3, 2]]);
        assert_eq!(segments("\u{1f1ef}\u{1f1f5}"), vec![[0, 2, 2]]);
        assert_eq!(segments("e\u{301}"), vec![[0, 2, 1]]);
        assert_eq!(segments("日本"), vec![[0, 1, 2], [1, 2, 2]]);
    }
}
