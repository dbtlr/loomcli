//! The terminal controls a question writes, each defined once, and the bare view they draw
//! through, which nothing overrides.

use loomcli_core::View;

/// Hides the terminal cursor.
pub(crate) const HIDE_CURSOR: &str = "\u{1b}[?25l";
/// Shows the terminal cursor.
pub(crate) const SHOW_CURSOR: &str = "\u{1b}[?25h";
/// Turns bracketed paste on.
pub(crate) const PASTE_ON: &str = "\u{1b}[?2004h";
/// Turns bracketed paste off.
pub(crate) const PASTE_OFF: &str = "\u{1b}[?2004l";

/// The bare view the controls draw through with `out.draw`.
pub(crate) fn controls() -> View<str> {
    View::new(|text: &str, _| text.to_owned())
}

/// Polls `future` once with a waker that does nothing: a write a signal handler makes cannot wait.
pub(crate) fn poll_once<F: std::future::Future>(future: F) {
    let mut future = std::pin::pin!(future);
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    let _ = future.as_mut().poll(&mut context);
}
