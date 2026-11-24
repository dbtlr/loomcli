//! The screen model of one run's live regions: the stack of open regions at the bottom of stderr,
//! as the terminal shows it. Each method answers the bytes that move the terminal from what it
//! shows to what it should show, and updates the model to match, so a caller writes those bytes in
//! the order it asked for them. Region handles decide what happens in call order; the screen
//! decides the bytes when each write reaches stderr, so what it erases is always what that stream
//! last showed.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

const ESCAPE: char = '\u{1b}';
const BELL: char = '\u{7}';

/// The length in characters of the terminal control sequence that starts at `chars[0]`, an escape,
/// or `None` when no sequence starts there: a CSI sequence, an OSC string ended by a bell or a
/// string terminator, or a two-character escape.
fn control_length(chars: &[char]) -> Option<usize> {
    let next = *chars.get(1)?;
    if next == '[' {
        let mut index = 2;
        while chars.get(index).is_some_and(|c| ('0'..='?').contains(c)) {
            index += 1;
        }
        while chars.get(index).is_some_and(|c| (' '..='/').contains(c)) {
            index += 1;
        }
        if chars.get(index).is_some_and(|c| ('@'..='~').contains(c)) {
            return Some(index + 1);
        }
        return None;
    }
    if next == ']' {
        let mut index = 2;
        while let Some(&c) = chars.get(index) {
            if c == BELL {
                return Some(index + 1);
            }
            if c == ESCAPE {
                if chars.get(index + 1) == Some(&'\\') {
                    return Some(index + 2);
                }
                break;
            }
            index += 1;
        }
    }
    (('@'..='Z').contains(&next) || ('\\'..='_').contains(&next)).then_some(2)
}

/// The text a terminal shows, without its control sequences.
pub(crate) fn visible(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut shown = String::with_capacity(text.len());
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == ESCAPE
            && let Some(length) = control_length(&chars[index..])
        {
            index += length;
            continue;
        }
        shown.push(chars[index]);
        index += 1;
    }
    shown
}

/// Numbers frames, so the screen tells one frame from another that holds the same text.
static FRAMES: AtomicU64 = AtomicU64::new(0);

/// One rendered frame: the marked text core counts rows in, and the resolved text it writes.
#[derive(Clone, Debug)]
pub(crate) struct Frame {
    pub(crate) marked: Arc<str>,
    pub(crate) text: Arc<str>,
    serial: u64,
}

impl Frame {
    pub(crate) fn new(marked: impl Into<Arc<str>>, text: impl Into<Arc<str>>) -> Self {
        Self {
            marked: marked.into(),
            text: text.into(),
            serial: FRAMES.fetch_add(1, Ordering::Relaxed),
        }
    }
}

/// Whether two optional frames are the same frame.
fn same(left: Option<&Frame>, right: Option<&Frame>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => left.serial == right.serial,
        _ => false,
    }
}

/// Whether a frame takes no rows: none drawn, or an empty one.
fn blank(frame: Option<&Frame>) -> bool {
    frame.is_none_or(|frame| frame.text.is_empty())
}

/// Whether text ends with a line break of its own.
fn ends_line(text: &str) -> bool {
    visible(text).ends_with('\n')
}

/// The text a closed region leaves in scrollback: its last frame, ending with a line break.
fn scrollback(frame: Option<&Frame>) -> String {
    match frame {
        Some(frame) if !frame.text.is_empty() => {
            if ends_line(&frame.text) {
                frame.text.to_string()
            } else {
                format!("{}\n", frame.text)
            }
        }
        _ => String::new(),
    }
}

/// How the screen measures text at the terminal's current width.
pub(crate) trait Measure {
    /// The rows a marked text moves the cursor down.
    fn rows(&self, marked: &str) -> usize;
    /// The column the next character lands on after visible text written from `column`.
    fn column(&self, shown: &str, column: usize) -> usize;
}

/// What one region shows on the screen and the frame it last drew.
struct Slot {
    id: u64,
    input: bool,
    shown: Option<Frame>,
    latest: Option<Frame>,
    closed: bool,
}

/// The frames the terminal shows, top to bottom, joined with the line breaks that start each on a
/// row of its own.
struct Stack {
    marked: String,
    text: String,
}

/// The stack of open regions at the bottom of stderr, as the terminal shows it.
#[derive(Default)]
pub(crate) struct Screen {
    slots: Vec<Slot>,
    /// The regions that closed while an input region or a lend held them, in the order they closed.
    closed_meanwhile: Vec<u64>,
    /// The column the last write above the stack left the cursor at, 0 when it ended a row.
    column: usize,
    /// The column the row above the stack ended at, when the stack opened on the next row because
    /// that write ended partway along it. Text written above the stack continues that row.
    opened: Option<usize>,
    /// Whether a suspend erased the stack, which shows nothing until the resume draws it again.
    suspended: bool,
    /// How many lends are open; while any is, no frame draws and a suspend writes nothing.
    depth: usize,
    /// Whether the outermost lend started with a stack drawn, which its end moves below the child.
    lent_drawn: bool,
}

impl Screen {
    /// How many lends are open.
    pub(crate) fn lending(&self) -> usize {
        self.depth
    }

    /// Whether any region is open on the screen.
    pub(crate) fn holding(&self) -> bool {
        !self.slots.is_empty()
    }

    /// Whether an input region is open, which holds every other region's frame still.
    fn frozen(&self) -> bool {
        self.slots.iter().any(|slot| slot.input && !slot.closed)
    }

    fn slot(&mut self, id: u64) -> Option<&mut Slot> {
        self.slots.iter_mut().find(|slot| slot.id == id)
    }

    fn remove(&mut self, id: u64) -> Option<Slot> {
        let index = self.slots.iter().position(|slot| slot.id == id)?;
        Some(self.slots.remove(index))
    }

    /// Starts a lend without erasing the stack that the child may write below.
    pub(crate) fn lend(&mut self) -> String {
        let stack = self.stack();
        self.depth += 1;
        if self.depth > 1 {
            return String::new();
        }
        self.lent_drawn = stack.is_some();
        match stack {
            Some(stack) if !ends_line(&stack.text) => "\n".to_owned(),
            _ => String::new(),
        }
    }

    /// Ends a lend. A fresh stack starts below the child's output; none of its rows are ours to
    /// erase. When the outermost lend started with nothing drawn and holds nothing, it writes
    /// nothing, so the row the next stack starts on is the one the writes during the lend left.
    /// Otherwise the line break comes first whatever was drawn at the start, because the child may
    /// have left the cursor partway along a row.
    pub(crate) fn reclaim(&mut self, measure: &dyn Measure) -> String {
        if self.depth == 0 {
            return String::new();
        }
        self.depth -= 1;
        if self.depth > 0 {
            return String::new();
        }
        let closed: Vec<Slot> = std::mem::take(&mut self.closed_meanwhile)
            .into_iter()
            .filter_map(|id| self.remove(id))
            .collect();
        for slot in &mut self.slots {
            slot.shown.clone_from(&slot.latest);
        }
        let held: String = closed
            .iter()
            .map(|slot| scrollback(slot.latest.as_ref()))
            .collect();
        if !self.lent_drawn && held.is_empty() && self.stack().is_none() {
            return String::new();
        }
        self.opened = None;
        self.column = 0;
        format!("\n{held}{}", self.draw_stack(measure))
    }

    /// Ends every open lend at once, as a shutdown that cannot wait for author work does.
    pub(crate) fn finish_lends(&mut self, measure: &dyn Measure) -> String {
        if self.depth == 0 {
            return String::new();
        }
        self.depth = 1;
        self.reclaim(measure)
    }

    /// The frames the terminal shows, each starting on a row of its own.
    fn stack(&self) -> Option<Stack> {
        if self.depth > 0 || self.suspended {
            return None;
        }
        let frames: Vec<&Frame> = self
            .slots
            .iter()
            .filter_map(|slot| slot.shown.as_ref().filter(|frame| !frame.text.is_empty()))
            .collect();
        if frames.is_empty() {
            return None;
        }
        let mut marked = String::new();
        let mut text = String::new();
        for (index, frame) in frames.iter().enumerate() {
            if index > 0 && !ends_line(&frames[index - 1].text) {
                marked.push('\n');
                text.push('\n');
            }
            marked.push_str(&frame.marked);
            text.push_str(&frame.text);
        }
        Some(Stack { marked, text })
    }

    /// Returns the cursor to the stack's first row and erases to the end of the screen.
    fn erase(&self, measure: &dyn Measure) -> String {
        let Some(stack) = self.stack() else {
            return String::new();
        };
        let rows = measure.rows(&stack.marked);
        let up = if rows > 0 {
            format!("{ESCAPE}[{rows}A")
        } else {
            String::new()
        };
        format!("\r{up}{ESCAPE}[J")
    }

    /// Erases the stack, which leaves the cursor on the stack's first row, and returns the cursor to
    /// the end of the partial row above it when the stack opened below one. Text written next then
    /// continues that row. A row filled exactly counts as wrapped, because no control sequence
    /// restores a terminal's pending wrap.
    fn uncover(&mut self, measure: &dyn Measure) -> String {
        let erase = self.erase(measure);
        let Some(column) = self.opened.take() else {
            return erase;
        };
        self.column = column;
        format!("{erase}{ESCAPE}[1A{ESCAPE}[{}G", column + 1)
    }

    /// Draws the stack below whatever is above it, on the next row when that ended partway along
    /// one.
    fn draw_stack(&mut self, _measure: &dyn Measure) -> String {
        let Some(stack) = self.stack() else {
            return String::new();
        };
        if self.column == 0 {
            return stack.text;
        }
        self.opened = Some(self.column);
        self.column = 0;
        format!("\n{}", stack.text)
    }

    /// A suspend: the bytes that erase the stack, which then shows nothing until `resume`. The
    /// cursor is left at the start of the stack's first row, where a write queued before the resume
    /// lands and where the shell writes while the process stops.
    pub(crate) fn suspend(&mut self, measure: &dyn Measure) -> String {
        if self.depth > 0 || self.suspended {
            return String::new();
        }
        let erase = self.erase(measure);
        self.suspended = true;
        self.opened = None;
        self.column = 0;
        erase
    }

    /// A resume: the bytes that draw the stack again, below whatever was written since the suspend.
    pub(crate) fn resume(&mut self, measure: &dyn Measure) -> String {
        if self.depth > 0 || !self.suspended {
            return String::new();
        }
        self.suspended = false;
        self.draw_stack(measure)
    }

    /// Text written to the terminal above the stack: what to write before it and after it.
    pub(crate) fn around(&mut self, measure: &dyn Measure, text: &str) -> (String, String) {
        if self.depth > 0 {
            self.note(measure, text);
            return (String::new(), String::new());
        }
        let before = self.uncover(measure);
        self.note(measure, text);
        (before, self.draw_stack(measure))
    }

    /// Text written to the terminal while no region is open, which moves the row the stack starts
    /// on.
    pub(crate) fn note(&mut self, measure: &dyn Measure, text: &str) {
        self.column = measure.column(&visible(text), self.column);
    }

    /// Whether a closing region's last frame is already the whole stack, so it can stay where it
    /// is: it shows its latest frame, no other region shows one, and no region closed while it held
    /// them.
    fn settled(&self, slot: &Slot) -> bool {
        same(slot.shown.as_ref(), slot.latest.as_ref())
            && self.closed_meanwhile.is_empty()
            && self.slots.iter().all(|other| {
                other.id == slot.id
                    || (blank(other.shown.as_ref())
                        && same(other.latest.as_ref(), other.shown.as_ref()))
            })
    }

    /// A region that opened, which takes no rows until it draws.
    pub(crate) fn open(&mut self, id: u64, input: bool) {
        self.slots.push(Slot {
            id,
            input,
            shown: None,
            latest: None,
            closed: false,
        });
    }

    /// A region's new frame, which a frozen region keeps without drawing.
    pub(crate) fn draw(&mut self, measure: &dyn Measure, id: u64, frame: Frame) -> String {
        let lending = self.depth > 0;
        let frozen = self.frozen();
        let Some(slot) = self.slot(id) else {
            return String::new();
        };
        slot.latest = Some(frame.clone());
        if lending || (frozen && !slot.input) {
            return String::new();
        }
        let before = self.erase(measure);
        if let Some(slot) = self.slot(id) {
            slot.shown = Some(frame);
        }
        before + &self.draw_stack(measure)
    }

    /// A region that closed: its last frame moves into scrollback and the regions below close the
    /// gap. A region that closes while an input region holds it stays as it was shown until the
    /// input region closes, when each such last frame moves into scrollback in the order the
    /// regions closed, above the input region's own, and every open region draws its latest frame
    /// once.
    pub(crate) fn close(&mut self, measure: &dyn Measure, id: u64) -> String {
        let lending = self.depth > 0;
        let frozen = self.frozen();
        let Some(slot) = self.slot(id) else {
            return String::new();
        };
        let input = slot.input;
        if lending || (frozen && !input) {
            slot.closed = true;
            self.closed_meanwhile.push(id);
            return String::new();
        }
        let settled = self
            .slots
            .iter()
            .find(|slot| slot.id == id)
            .is_some_and(|slot| self.settled(slot));
        if settled {
            let Some(slot) = self.remove(id) else {
                return String::new();
            };
            return match slot.shown {
                // Nothing is drawn, so the cursor returns to where the text above ended.
                Some(shown) if !shown.text.is_empty() => {
                    // The last frame is already the bottom of the screen, so it stays where it is.
                    self.opened = None;
                    if ends_line(&shown.text) {
                        String::new()
                    } else {
                        "\n".to_owned()
                    }
                }
                _ => self.uncover(measure),
            };
        }
        let before = self.uncover(measure);
        let mut leaving: Vec<u64> = Vec::new();
        if input {
            leaving.append(&mut self.closed_meanwhile);
        }
        leaving.push(id);
        let left: Vec<Slot> = leaving
            .into_iter()
            .filter_map(|left| self.remove(left))
            .collect();
        if input {
            for open in &mut self.slots {
                open.shown.clone_from(&open.latest);
            }
        }
        let mut text: String = left
            .iter()
            .map(|slot| scrollback(slot.latest.as_ref()))
            .collect();
        if !text.is_empty() {
            if self.column != 0 {
                text.insert(0, '\n');
            }
            self.column = 0;
        }
        before + &text + &self.draw_stack(measure)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;

    /// Measures as a terminal `columns` wide whose characters each take one column.
    struct Fixed(usize);

    impl Measure for Fixed {
        fn rows(&self, marked: &str) -> usize {
            let lines: Vec<&str> = marked.split('\n').collect();
            let last = lines.len() - 1;
            lines
                .iter()
                .enumerate()
                .map(|(index, line)| {
                    let width = visible(line).chars().count();
                    let wraps = if width == 0 { 0 } else { (width - 1) / self.0 };
                    wraps + usize::from(index < last)
                })
                .sum()
        }

        fn column(&self, shown: &str, column: usize) -> usize {
            let mut column = column;
            for c in shown.chars() {
                match c {
                    '\n' | '\r' => column = 0,
                    _ => {
                        column += 1;
                        if column == self.0 {
                            column = 0;
                        }
                    }
                }
            }
            column
        }
    }

    fn frame(text: &str) -> Frame {
        Frame::new(text, text)
    }

    #[test]
    fn visible_text_drops_csi_osc_and_two_character_escapes() {
        assert_eq!(visible("\u{1b}[1Aup"), "up");
        assert_eq!(
            visible("\u{1b}]8;;https://x\u{7}docs\u{1b}]8;;\u{1b}\\"),
            "docs"
        );
        assert_eq!(visible("a\u{1b}Mb"), "ab");
        assert_eq!(visible("\u{1b}[?25h"), "");
        assert_eq!(visible("tail\u{1b}"), "tail\u{1b}");
    }

    #[test]
    fn a_frame_replaces_the_one_before_it_in_place() {
        let measure = Fixed(40);
        let mut screen = Screen::default();
        screen.open(1, false);
        assert_eq!(screen.draw(&measure, 1, frame("one")), "one");
        assert_eq!(
            screen.draw(&measure, 1, frame("two\nrows")),
            "\r\u{1b}[Jtwo\nrows"
        );
        assert_eq!(
            screen.draw(&measure, 1, frame("three")),
            "\r\u{1b}[1A\u{1b}[Jthree"
        );
    }

    #[test]
    fn a_write_above_the_stack_erases_it_and_draws_it_again_below() {
        let measure = Fixed(40);
        let mut screen = Screen::default();
        screen.open(1, false);
        screen.draw(&measure, 1, frame("frame"));
        let (before, after) = screen.around(&measure, "line\n");
        assert_eq!((before.as_str(), after.as_str()), ("\r\u{1b}[J", "frame"));
    }

    #[test]
    fn a_stack_below_a_partial_row_opens_on_the_next_row_and_returns_to_it() {
        let measure = Fixed(40);
        let mut screen = Screen::default();
        screen.note(&measure, "partial");
        screen.open(1, false);
        assert_eq!(screen.draw(&measure, 1, frame("frame")), "\nframe");
        let (before, after) = screen.around(&measure, " more\n");
        assert_eq!(before, "\r\u{1b}[J\u{1b}[1A\u{1b}[8G");
        assert_eq!(after, "frame");
    }

    #[test]
    fn a_closing_region_alone_on_the_screen_stays_where_it_is() {
        let measure = Fixed(40);
        let mut screen = Screen::default();
        screen.open(1, false);
        screen.draw(&measure, 1, frame("done"));
        assert_eq!(screen.close(&measure, 1), "\n");
        assert!(!screen.holding());
    }

    #[test]
    fn closing_the_top_region_moves_its_last_frame_above_the_others() {
        let measure = Fixed(40);
        let mut screen = Screen::default();
        screen.open(1, false);
        screen.open(2, false);
        screen.draw(&measure, 1, frame("first"));
        screen.draw(&measure, 2, frame("second"));
        assert_eq!(
            screen.close(&measure, 1),
            "\r\u{1b}[1A\u{1b}[Jfirst\nsecond"
        );
    }

    #[test]
    fn an_input_region_holds_the_others_until_it_closes() {
        let measure = Fixed(40);
        let mut screen = Screen::default();
        screen.open(1, false);
        screen.open(2, false);
        screen.draw(&measure, 1, frame("tick 0"));
        screen.draw(&measure, 2, frame("closing"));
        screen.open(3, true);
        screen.draw(&measure, 3, frame("question"));
        assert_eq!(screen.draw(&measure, 1, frame("tick 1")), "");
        assert_eq!(screen.close(&measure, 2), "");
        screen.draw(&measure, 3, frame("answered"));
        assert_eq!(
            screen.close(&measure, 3),
            "\r\u{1b}[2A\u{1b}[Jclosing\nanswered\ntick 1"
        );
    }

    #[test]
    fn a_lend_ends_the_row_holds_frames_and_draws_a_fresh_stack_after() {
        let measure = Fixed(80);
        let mut screen = Screen::default();
        screen.open(1, false);
        screen.draw(&measure, 1, frame("before"));
        assert_eq!(screen.lend(), "\n");
        assert_eq!(screen.lending(), 1);
        assert_eq!(screen.draw(&measure, 1, frame("after")), "");
        assert_eq!(
            screen.around(&measure, "child"),
            (String::new(), String::new())
        );
        assert_eq!(screen.reclaim(&measure), "\nafter");
    }

    #[test]
    fn a_shutdown_ends_nested_lends_at_once() {
        let measure = Fixed(80);
        let mut screen = Screen::default();
        screen.open(1, false);
        screen.draw(&measure, 1, frame("held"));
        screen.lend();
        screen.lend();
        assert_eq!(screen.finish_lends(&measure), "\nheld");
        assert_eq!(screen.lending(), 0);
    }

    #[test]
    fn a_suspend_erases_the_stack_and_the_resume_draws_it_again() {
        let measure = Fixed(40);
        let mut screen = Screen::default();
        screen.open(1, false);
        screen.draw(&measure, 1, frame("frame"));
        assert_eq!(screen.suspend(&measure), "\r\u{1b}[J");
        assert_eq!(screen.suspend(&measure), "");
        assert_eq!(screen.around(&measure, "while stopped\n").1, "");
        assert_eq!(screen.resume(&measure), "frame");
        assert_eq!(screen.resume(&measure), "");
    }

    #[test]
    fn a_suspend_and_a_resume_during_a_lend_write_nothing() {
        let measure = Fixed(40);
        let mut screen = Screen::default();
        screen.open(1, false);
        screen.draw(&measure, 1, frame("frame"));
        screen.lend();
        assert_eq!(screen.suspend(&measure), "");
        assert_eq!(screen.resume(&measure), "");
    }
}
