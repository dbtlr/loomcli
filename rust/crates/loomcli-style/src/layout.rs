//! Layout: lines of measured units, with deferred padding resolved inside outward. A rope keeps
//! each unit's advance at every tab-stop offset, so nested text composes without rescanning, and
//! padding around unchanged content reuses its analysis.

use std::cell::RefCell;
use std::rc::Rc;

use crate::ansi::{TextUnit, Unit, UnitKind, is_control};
use crate::state::Attributes;
use crate::width::cluster_columns;
use crate::wire::{Boundary, Padding, ParsedView};

/// The columns a rope advances when it starts at each offset modulo eight.
type Advance = [usize; 8];

const TAB_ADVANCE: Advance = [8, 7, 6, 5, 4, 3, 2, 1];

/// A unit, or a join of ropes, with its metrics.
#[derive(Debug)]
pub(crate) struct Rope {
    node: Node,
    advance: Advance,
    /// Whether a tab leaf lies inside.
    tabs: bool,
    /// Whether a nonempty text unit lies inside.
    pub(crate) text: bool,
}

#[derive(Debug)]
enum Node {
    Leaf { unit: TextUnit, tab: bool },
    Join(Vec<Rc<Rope>>),
}

impl Rope {
    fn is_empty_join(&self) -> bool {
        matches!(&self.node, Node::Join(children) if children.is_empty())
    }

    /// The columns the rope advances from a line start.
    pub(crate) fn width(&self) -> usize {
        self.advance[0]
    }
}

fn empty() -> Rc<Rope> {
    Rc::new(Rope {
        node: Node::Join(Vec::new()),
        advance: [0; 8],
        tabs: false,
        text: false,
    })
}

fn leaf(unit: TextUnit, width: usize, tab: bool) -> Rc<Rope> {
    let text = unit.kind == UnitKind::Text && !unit.text.is_empty();
    Rc::new(Rope {
        node: Node::Leaf { unit, tab },
        advance: if tab { TAB_ADVANCE } else { [width; 8] },
        tabs: tab,
        text,
    })
}

fn join(children: Vec<Rc<Rope>>) -> Rc<Rope> {
    let mut children: Vec<Rc<Rope>> = children
        .into_iter()
        .filter(|child| !child.is_empty_join())
        .collect();
    if children.is_empty() {
        return empty();
    }
    if children.len() == 1 {
        if let Some(only) = children.pop() {
            return only;
        }
    }
    let tabs = children.iter().any(|child| child.tabs);
    let advance = if tabs {
        let mut advance = [0; 8];
        for (offset, slot) in advance.iter_mut().enumerate() {
            let column = children
                .iter()
                .fold(offset, |column, child| column + child.advance[column % 8]);
            *slot = column - offset;
        }
        advance
    } else {
        // Without a tab, no child's advance depends on the column, so the join's does not either.
        [children.iter().map(|child| child.advance[0]).sum(); 8]
    };
    let text = children.iter().any(|child| child.text);
    Rc::new(Rope {
        node: Node::Join(children),
        advance,
        tabs,
        text,
    })
}

/// The leaves of a rope in order, walked with an explicit stack.
fn leaves(root: &Rc<Rope>) -> Vec<(&TextUnit, bool, &Advance)> {
    let mut found = Vec::new();
    let mut stack: Vec<(&Rope, usize)> = vec![(root, 0)];
    while let Some((node, index)) = stack.pop() {
        match &node.node {
            Node::Leaf { unit, tab } => found.push((unit, *tab, &node.advance)),
            Node::Join(children) => {
                if let Some(child) = children.get(index) {
                    stack.push((node, index + 1));
                    stack.push((child, 0));
                }
            }
        }
    }
    found
}

/// One line: its content and its line ending, if any.
#[derive(Debug, Clone)]
pub(crate) struct Line {
    pub(crate) content: Rc<Rope>,
    pub(crate) ending: Vec<TextUnit>,
}

/// Measured lines.
#[derive(Debug)]
pub(crate) struct Block {
    pub(crate) lines: Vec<Line>,
    minimum: usize,
    tabs: bool,
}

/// Lines of units, measured as grapheme clusters across attribute boundaries and terminal-control
/// envelopes.
fn text_block(units: &[TextUnit]) -> Block {
    let visible: Vec<char> = units
        .iter()
        .filter(|unit| unit.kind == UnitKind::Text)
        .flat_map(|unit| unit.text.iter().copied())
        .collect();
    let columns = cluster_columns(&visible);
    let column = |at: usize| columns.before.get(at).copied().unwrap_or(0);
    let mut lines = Vec::new();
    let mut parts = Vec::new();
    let mut offset = 0;
    for unit in units {
        if unit.kind != UnitKind::Text {
            parts.push(leaf(unit.clone(), 0, false));
            continue;
        }
        if *unit.text == ['\n'] || *unit.text == ['\r', '\n'] {
            lines.push(Line {
                content: join(std::mem::take(&mut parts)),
                ending: vec![unit.clone()],
            });
        } else {
            let width = column(offset + unit.text.len()).saturating_sub(column(offset));
            parts.push(leaf(unit.clone(), width, *unit.text == ['\t']));
        }
        offset += unit.text.len();
    }
    lines.push(Line {
        content: join(parts),
        ending: Vec::new(),
    });
    measured(lines)
}

/// Whether a line is a trailing line with no text, which padding leaves alone.
fn trailing_empty(index: usize, count: usize, line: &Line) -> bool {
    index > 0 && index + 1 == count && !line.content.text
}

fn measured(lines: Vec<Line>) -> Block {
    let count = lines.len();
    let minimum = lines
        .iter()
        .enumerate()
        .filter(|(index, line)| !trailing_empty(*index, count, line))
        .map(|(_, line)| line.content.width())
        .min()
        .unwrap_or(usize::MAX);
    let tabs = lines.iter().any(|line| line.content.tabs);
    Block {
        lines,
        minimum,
        tabs,
    }
}

fn expand_tabs(root: &Rc<Rope>) -> Rc<Rope> {
    if !root.tabs {
        return Rc::clone(root);
    }
    let mut parts = Vec::new();
    let mut column = 0;
    for (unit, tab, advance) in leaves(root) {
        let width = advance[column % 8];
        if tab {
            parts.push(leaf(
                TextUnit {
                    kind: unit.kind,
                    text: vec![' '; width].into(),
                    attributes: Rc::clone(&unit.attributes),
                },
                width,
                false,
            ));
        } else {
            parts.push(leaf(unit.clone(), width, false));
        }
        column += width;
    }
    join(parts)
}

fn spaces(count: usize, attributes: &Rc<Attributes>) -> TextUnit {
    TextUnit {
        kind: UnitKind::Text,
        text: vec![' '; count].into(),
        attributes: Rc::clone(attributes),
    }
}

/// The block padded to the frame's width, or `None` when it needs no change.
fn pad_block(block: &Block, padding: Padding, attributes: &Rc<Attributes>) -> Option<Block> {
    if !block.tabs && block.minimum >= padding.width {
        return None;
    }
    let count = block.lines.len();
    let lines = block
        .lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            // A terminal newline has no extra line to align; interior blank lines do.
            if trailing_empty(index, count, line) {
                return line.clone();
            }
            let content = expand_tabs(&line.content);
            let missing = padding.width.saturating_sub(content.width());
            if missing == 0 {
                return Line {
                    content,
                    ending: line.ending.clone(),
                };
            }
            let before = match padding.align {
                crate::style::Alignment::Left => 0,
                crate::style::Alignment::Right => missing,
                crate::style::Alignment::Center => missing / 2,
            };
            // Re-segment inserted spaces too: a trailing Prepend character can absorb one.
            let spaced = join(vec![
                leaf(spaces(before, attributes), before, false),
                content,
                leaf(
                    spaces(missing - before, attributes),
                    missing - before,
                    false,
                ),
            ]);
            let row = measured(vec![Line {
                content: spaced,
                ending: Vec::new(),
            }]);
            let mut padded = text_block(&rendered_units(&row));
            let shortfall = padding.width.saturating_sub(padded.minimum);
            if shortfall > 0 {
                let mut units = rendered_units(&padded);
                units.push(spaces(shortfall, attributes));
                padded = text_block(&units);
            }
            Line {
                content: padded
                    .lines
                    .into_iter()
                    .next()
                    .map_or_else(empty, |first| first.content),
                ending: line.ending.clone(),
            }
        })
        .collect();
    Some(measured(lines))
}

/// A deferred concatenation that keeps shared output and caches its complete analysis.
#[derive(Debug)]
struct TextRope {
    parts: Vec<Part>,
    tabs: bool,
    analysis: RefCell<Option<Rc<Block>>>,
}

#[derive(Debug)]
enum Part {
    Rope(Rc<TextRope>),
    Unit(TextUnit),
}

impl Drop for TextRope {
    // Nested padding nests ropes as deep as its input; dropping them one level at a time keeps
    // the stack flat whatever the depth.
    fn drop(&mut self) {
        fn take(parts: &mut Vec<Part>, pending: &mut Vec<Rc<TextRope>>) {
            for part in std::mem::take(parts) {
                if let Part::Rope(rope) = part {
                    pending.push(rope);
                }
            }
        }
        let mut pending: Vec<Rc<TextRope>> = Vec::new();
        take(&mut self.parts, &mut pending);
        while let Some(rope) = pending.pop() {
            if let Ok(mut inner) = Rc::try_unwrap(rope) {
                take(&mut inner.parts, &mut pending);
            }
        }
    }
}

fn text_rope(mut parts: Vec<Part>) -> Rc<TextRope> {
    if parts.len() == 1 {
        if let Some(Part::Rope(rope)) = parts.first() {
            let rope = Rc::clone(rope);
            parts.clear();
            return rope;
        }
    }
    let tabs = parts.iter().any(|part| match part {
        Part::Rope(rope) => rope.tabs,
        Part::Unit(unit) => unit.kind == UnitKind::Text && unit.text.contains(&'\t'),
    });
    Rc::new(TextRope {
        parts,
        tabs,
        analysis: RefCell::new(None),
    })
}

/// The units of a text rope in order, walked with an explicit stack.
fn text_units(root: &Rc<TextRope>) -> Vec<TextUnit> {
    let mut units = Vec::new();
    let mut stack: Vec<(&TextRope, usize)> = vec![(root, 0)];
    while let Some((rope, index)) = stack.pop() {
        let Some(part) = rope.parts.get(index) else {
            continue;
        };
        stack.push((rope, index + 1));
        match part {
            Part::Rope(inner) => stack.push((inner, 0)),
            Part::Unit(unit) => units.push(unit.clone()),
        }
    }
    units
}

fn analyze(rope: &Rc<TextRope>) -> Rc<Block> {
    if let Some(analysis) = rope.analysis.borrow().as_ref() {
        return Rc::clone(analysis);
    }
    let analysis = Rc::new(text_block(&text_units(rope)));
    *rope.analysis.borrow_mut() = Some(Rc::clone(&analysis));
    analysis
}

struct Pending {
    parts: Vec<Part>,
    padding: Option<(Padding, Rc<Attributes>)>,
}

/// The block a scanned stream lays out to. Nested padding resolves inside outward, and unchanged
/// content keeps its rope and analysis.
pub(crate) fn layout(units: Vec<Unit>) -> Rc<Block> {
    let mut current = Pending {
        parts: Vec::new(),
        padding: None,
    };
    let mut stack: Vec<Pending> = Vec::new();
    for unit in units {
        match unit {
            Unit::Boundary(Boundary::Open {
                padding,
                attributes,
                ..
            }) => {
                let opened = Pending {
                    parts: Vec::new(),
                    padding: Some((padding, attributes)),
                };
                stack.push(std::mem::replace(&mut current, opened));
            }
            Unit::Boundary(Boundary::Close) => {
                let mut rope = text_rope(std::mem::take(&mut current.parts));
                if let Some((padding, attributes)) = &current.padding {
                    if padding.width > 0 || rope.tabs {
                        let original = analyze(&rope);
                        if let Some(padded) = pad_block(&original, *padding, attributes) {
                            let parts = rendered_units(&padded)
                                .into_iter()
                                .map(Part::Unit)
                                .collect();
                            rope = Rc::new(TextRope {
                                parts,
                                tabs: false,
                                analysis: RefCell::new(Some(Rc::new(padded))),
                            });
                        }
                    }
                }
                current = stack.pop().unwrap_or(Pending {
                    parts: Vec::new(),
                    padding: None,
                });
                current.parts.push(Part::Rope(rope));
            }
            Unit::Text(unit) => current.parts.push(Part::Unit(unit)),
        }
    }
    analyze(&text_rope(current.parts))
}

/// The units of a block in output order, each line's content followed by its ending.
pub(crate) fn rendered_units(block: &Block) -> Vec<TextUnit> {
    let mut units = Vec::new();
    for line in &block.lines {
        units.extend(
            leaves(&line.content)
                .into_iter()
                .map(|(unit, _, _)| unit.clone()),
        );
        units.extend(line.ending.iter().cloned());
    }
    units
}

/// The columns each tab leaf advances, in text order, with each line laid out from column zero. A
/// tab inside a padding frame is no leaf here, because the frame has already expanded it.
pub(crate) fn tab_advances(block: &Block) -> Vec<usize> {
    let mut advances = Vec::new();
    for line in &block.lines {
        if !line.content.tabs {
            continue;
        }
        let mut column = 0;
        for (_, tab, advance) in leaves(&line.content) {
            let width = advance[column % 8];
            if tab {
                advances.push(width);
            }
            column += width;
        }
    }
    advances
}

/// Whether decoded text is flat: no padding frame, and nothing but characters and line endings,
/// LF and CRLF, so no command, lone CR, or tab. A flat text measures as the sum of its clusters.
pub(crate) fn is_flat(view: &ParsedView<'_>) -> bool {
    if !view.boundaries.is_empty() {
        return false;
    }
    let text = view.text;
    text.iter().enumerate().all(|(index, &character)| {
        let line_ending =
            character == '\n' || (character == '\r' && text.get(index + 1) == Some(&'\n'));
        !is_control(character) || line_ending
    })
}

/// The widest line of a block.
pub(crate) fn block_width(block: &Block) -> usize {
    block
        .lines
        .iter()
        .map(|line| line.content.width())
        .max()
        .unwrap_or(0)
}
