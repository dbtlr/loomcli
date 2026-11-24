//! Key sequences a mock terminal types into an input region: the bytes a terminal sends for the keys
//! a question reads, so an entry of a keyboard's keys reads as the keys it presses. Members join
//! with `+` or `format!` into one read.

/// The up arrow, CSI as a terminal in normal cursor mode sends it.
pub const UP: &str = "\u{1b}[A";
/// The down arrow.
pub const DOWN: &str = "\u{1b}[B";
/// The left arrow.
pub const LEFT: &str = "\u{1b}[D";
/// The right arrow.
pub const RIGHT: &str = "\u{1b}[C";
/// Home.
pub const HOME: &str = "\u{1b}[H";
/// End.
pub const END: &str = "\u{1b}[F";
/// Space.
pub const SPACE: &str = " ";
/// Tab.
pub const TAB: &str = "\t";
/// Enter, the byte a terminal in raw mode sends for it.
pub const ENTER: &str = "\r";
/// Backspace: DEL, as xterm-compatible terminals send it.
pub const BACKSPACE: &str = "\u{7f}";
/// Delete.
pub const DELETE: &str = "\u{1b}[3~";
/// Escape: a lone ESC, which is the Escape key only when it ends a read.
pub const ESCAPE: &str = "\u{1b}";

/// Ctrl and a letter, `a` through `z`, such as Ctrl-C: the letter's code with its upper three bits
/// cleared, `\u{1}` for `a` through `\u{1a}` for `z`.
///
/// # Panics
///
/// For a character that is not a lowercase ASCII letter, which the reference's type rejects.
#[must_use]
#[track_caller]
pub fn ctrl(letter: char) -> String {
    assert!(
        letter.is_ascii_lowercase(),
        "key::ctrl takes a lowercase letter, a through z."
    );
    char::from(letter as u8 & 0x1f).to_string()
}

/// Alt and a letter, `a` through `z`: ESC followed by the letter, as a terminal that sends Meta as
/// ESC writes it.
///
/// # Panics
///
/// For a character that is not a lowercase ASCII letter, which the reference's type rejects.
#[must_use]
#[track_caller]
pub fn alt(letter: char) -> String {
    assert!(
        letter.is_ascii_lowercase(),
        "key::alt takes a lowercase letter, a through z."
    );
    format!("{ESCAPE}{letter}")
}
