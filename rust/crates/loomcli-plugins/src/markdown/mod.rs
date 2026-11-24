//! The Markdown subset parser that help's Details and epilogs and the man page share.
//!
//! This is an internal module behind the internal `markdown` feature, which the `help` and
//! `manpage` features enable; it is not a plugin and the crate exports no parser. It parses and
//! nothing else: rendering, styling, and wrapping belong to the callers.
//!
//! # API
//!
//! Two functions, both pure and total (no input is an error):
//!
//! - [`parse_markdown`] takes the Details source exactly as authored, final terminator and any
//!   whitespace at either end included, and returns the block tree as `Vec<Block>`. It reads CRLF
//!   and each of LF, VT, FF, CR, NEL, LS, and PS as line breaks, expands tabs in leading
//!   indentation and after quote and list markers to the next multiple of four columns, and leaves
//!   tabs in text alone.
//! - [`parse_inline`] takes one authored line (no line terminator) and returns `Vec<Inline>`.
//!   [`parse_markdown`] already calls it on every paragraph, table-row, and heading line; a caller
//!   needs it only for text outside a block.
//!
//! ## Blocks
//!
//! A [`Block`] is a [`BlockKind`] plus `blank_before`, true when the author left at least one blank
//! line before it inside its container. Containers (quotes, list items) carry their own blocks, so
//! a renderer prints one blank line exactly where `blank_before` is true and something was already
//! printed. A renderer must also carry `blank_before` across a block that renders no lines.
//!
//! - `Paragraph { lines }` and `Table { lines }`: one trimmed `Vec<Inline>` per authored line. A
//!   table is only consecutive lines starting with `|`; it is never split into cells.
//! - `Heading { level, text }`: level 1 to 6, closing `#` run removed. A heading with no text is
//!   never in the tree, but its authored blank line is kept on the next block.
//! - `Code { lines }`: fenced or indented code, uninterpreted, opening indentation removed,
//!   interior empty lines kept, no trimming of trailing spaces.
//! - `Break { text }`: a thematic break as authored, trimmed.
//! - `Quote { blocks }`: the content after each `>` marker, parsed as blocks.
//! - `List { marker, items }`: consecutive items of one bullet character or one ordered
//!   delimiter, even across blank lines. [`ListMarker::Ordered`] carries the first item's number
//!   as `start`; later items count up from it. An [`Item`] has `blank_before` (never true for the
//!   first item) and its own blocks.
//!
//! ## Inline nodes
//!
//! [`Inline`] is `Text`, `Code { content, backtick_length }` (content without its delimiters),
//! `Address` (an autolink's text without angle brackets), `Link` and `Image` (`children` and
//! `destination`), and `Emphasis { children, strong }`. Unmatched markers stay literal text.
//! Inline syntax never spans authored lines.
//!
//! # Tests
//!
//! The unit tests in `tests.rs` use the `test_support` module, compiled only for tests. It holds
//! a plain-text renderer that follows help's off-terminal layout, so the reference's expected
//! page lines can be asserted. Nothing of it is exported from the crate.

mod blocks;
mod inline;
mod text;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

#[allow(unused_imports)]
pub(crate) use blocks::{Block, BlockKind, Item, ListMarker, parse_markdown};
#[allow(unused_imports)]
pub(crate) use inline::{Inline, parse_inline};
