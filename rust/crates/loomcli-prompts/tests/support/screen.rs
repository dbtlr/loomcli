//! A small headless terminal that replays what a run wrote, so a test asserts what an operator sees
//! rather than the bytes that drew it: the reference's `test-screen.ts` over xterm.js, for the
//! sequences core writes around live regions.
//!
//! It holds every row it has written, scrollback first, `columns` wide. A line feed is a carriage
//! return and a line feed, as a terminal's line discipline makes it. A character written in the
//! last column leaves a pending wrap that the next printable character takes. `ESC [ n A` moves up,
//! `ESC [ n G` moves to a column, `ESC [ J` erases to the end of the screen, and every other
//! control sequence moves nothing.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_testing::Write;

/// What the terminal shows once it has taken every write.
#[derive(Debug, PartialEq, Eq)]
pub struct Shown {
    /// Every row, scrollback first, each trimmed on the right, with trailing blank rows dropped.
    pub lines: Vec<String>,
    /// The cursor's column and its row counted from the first row of `lines`.
    pub cursor: (usize, usize),
}

struct Terminal {
    columns: usize,
    rows: Vec<Vec<char>>,
    row: usize,
    column: usize,
    pending_wrap: bool,
}

impl Terminal {
    fn new(columns: usize) -> Self {
        Self {
            columns,
            rows: vec![Vec::new()],
            row: 0,
            column: 0,
            pending_wrap: false,
        }
    }

    fn line(&mut self) -> &mut Vec<char> {
        while self.rows.len() <= self.row {
            self.rows.push(Vec::new());
        }
        &mut self.rows[self.row]
    }

    fn print(&mut self, c: char) {
        if self.pending_wrap {
            self.pending_wrap = false;
            self.row += 1;
            self.column = 0;
        }
        let column = self.column;
        let line = self.line();
        while line.len() <= column {
            line.push(' ');
        }
        line[column] = c;
        if self.column + 1 >= self.columns {
            self.pending_wrap = true;
        } else {
            self.column += 1;
        }
    }

    fn feed(&mut self, text: &str) {
        let chars: Vec<char> = text.chars().collect();
        let mut index = 0;
        while index < chars.len() {
            let c = chars[index];
            index += 1;
            match c {
                '\n' => {
                    self.pending_wrap = false;
                    self.row += 1;
                    self.column = 0;
                    self.line();
                }
                '\r' => {
                    self.pending_wrap = false;
                    self.column = 0;
                }
                '\u{1b}' => index = self.escape(&chars, index),
                '\u{7}' => {}
                c => self.print(c),
            }
        }
    }

    /// Reads one escape sequence starting after the escape, acts on it, and answers where the text
    /// continues.
    fn escape(&mut self, chars: &[char], start: usize) -> usize {
        match chars.get(start) {
            Some('[') => {
                let mut index = start + 1;
                let mut parameters = String::new();
                while let Some(&c) = chars.get(index) {
                    if ('0'..='?').contains(&c) {
                        parameters.push(c);
                        index += 1;
                    } else {
                        break;
                    }
                }
                while chars.get(index).is_some_and(|c| (' '..='/').contains(c)) {
                    index += 1;
                }
                let Some(&last) = chars.get(index) else {
                    return index;
                };
                let count = parameters.parse::<usize>().unwrap_or(1).max(1);
                match last {
                    'A' => {
                        self.pending_wrap = false;
                        self.row = self.row.saturating_sub(count);
                    }
                    'G' => {
                        self.pending_wrap = false;
                        self.column = (count - 1).min(self.columns - 1);
                    }
                    'J' if parameters.is_empty() || parameters == "0" => {
                        let column = self.column;
                        let row = self.row;
                        self.line().truncate(column);
                        self.rows.truncate(row + 1);
                    }
                    _ => {}
                }
                index + 1
            }
            Some(']') => {
                let mut index = start + 1;
                while let Some(&c) = chars.get(index) {
                    index += 1;
                    if c == '\u{7}' {
                        break;
                    }
                    if c == '\u{1b}' && chars.get(index) == Some(&'\\') {
                        index += 1;
                        break;
                    }
                }
                index
            }
            Some(_) => start + 1,
            None => start,
        }
    }

    fn shown(&self) -> Shown {
        let mut lines: Vec<String> = self
            .rows
            .iter()
            .map(|row| row.iter().collect::<String>().trim_end().to_owned())
            .collect();
        while lines.last().is_some_and(String::is_empty) {
            lines.pop();
        }
        Shown {
            lines,
            cursor: (self.column, self.row),
        }
    }
}

/// What a terminal `columns` wide shows after the writes, stdout's included when `stdout` is on
/// the same terminal.
pub fn replay(writes: &[Write], columns: usize, stdout: bool) -> Shown {
    let mut terminal = Terminal::new(columns);
    for write in writes {
        match write {
            Write::Stderr(text) => terminal.feed(text),
            Write::Stdout(text) if stdout => terminal.feed(text),
            _ => {}
        }
    }
    terminal.shown()
}

/// Every byte written to stderr, and to stdout when `stdout` is on the same terminal, in order.
pub fn written(writes: &[Write], stdout: bool) -> String {
    writes
        .iter()
        .filter_map(|write| match write {
            Write::Stderr(text) => Some(text.as_str()),
            Write::Stdout(text) if stdout => Some(text.as_str()),
            _ => None,
        })
        .collect()
}
