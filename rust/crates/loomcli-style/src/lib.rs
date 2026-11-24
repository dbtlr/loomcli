//! Marked strings, color resolution, glyphs, and text measurement for Loom CLI applications.
//!
//! This crate ports the style module of the TypeScript reference, `@loomcli/core`'s `style`
//! folder, and `loomcli-core` re-exports it. Its contract is the reference's
//! `docs/core/styles.md` and the wire form in `docs/maintaining/style-wire.md`.
//!
//! # Marked strings
//!
//! A style call returns an ordinary [`String`] holding private-use framing: `U+E000`, a compact
//! JSON header, `U+E001`, the body, and `U+E002`, with `U+E003` escaping a literal delimiter. The
//! framing is byte for byte the reference's, so strings compose by concatenation, `format!`, and
//! `join`, and nest. Nothing is resolved until a [`Renderer`] writes the string for a
//! destination, one string at a time, in a single pass with an explicit stack: a malformed frame
//! stays literal text, and a frame left open closes at the end of its string.
//!
//! ```
//! use loomcli_style::{Alignment, Glyph, pad, style};
//!
//! let ready = style().yellow().bold().apply("Ready");
//! let status = format!("{} {ready}", style().green().apply(&Glyph::Success.to_string()));
//! let cell = pad(&status, 24, Alignment::Left)?;
//! # Ok::<(), loomcli_style::StyleError>(())
//! ```
//!
//! # Rendering
//!
//! [`capabilities`] decides what one destination renders from facts the caller supplies, the
//! captured environment, the destination's TTY flag, and the merged [`RenderingPolicy`], and never
//! reads the process. A [`Renderer`] pairs those capabilities with the [`Palette`] a [`Theme`]
//! resolves to on the run's [`Background`], and offers what a view context offers: `resolve`,
//! `plain`, `width`, `wrap`, `expand_tabs`, and the rows a drawn frame takes. [`width`] measures
//! text a stream already received, and [`split_lines`] splits marked text into standalone lines.
//!
//! # Display width
//!
//! Width reproduces the reference, which pins `@rockorager/uucode` 2.2.1 with its Unicode 17 data:
//! grapheme clusters, ambiguous-width characters at one column, emoji presentation selectors,
//! skin-tone modifiers, regional-indicator flags, and ZWJ sequences as uucode measures them. No
//! Rust crate reproduces that exactly (`unicode-width` and `unicode-segmentation` carry other
//! Unicode versions and other emoji rules), so this crate carries uucode's own tables, decoded
//! from the reference's generated module into `src/tables` by `scripts/generate.py`, and a line
//! for line port of uucode's width iterator. The tables are under the Unicode License v3 and the
//! iterator under the MIT License; both notices are in this crate's `licenses` folder. The glyph
//! catalog in [`Glyph`] comes from the same script, from the pinned Inquirer figures inventory,
//! whose MIT notices are there as well.
//!
//! # Positions
//!
//! The reference indexes text by UTF-16 code unit; this crate indexes by `char`. A Rust string
//! holds no lone surrogate, so no position the reference reads can fall inside a character here,
//! and the two indexings choose the same boundaries.

mod ansi;
mod ascii;
mod background;
mod color;
mod controls;
mod environment;
mod glyph;
mod json;
mod layout;
mod lines;
mod renderer;
mod rendering;
mod resolve;
mod state;
mod style;
mod theme;
mod width;
mod wire;
mod wrap;

pub use background::{
    BACKGROUND_QUERY, Background, BackgroundSources, BackgroundStep, Replies,
    background_after_query, background_before_query, background_of_luminance, color_fg_bg,
    query_allowed, read_replies, settle_background,
};
pub use color::{Ansi16Color, Ansi256Fallbacks, Color, ColorDepth, ColorFallbacks};
pub use controls::escape_control_characters;
pub use environment::Environment;
pub use glyph::Glyph;
pub use lines::split_lines;
pub use renderer::Renderer;
pub use rendering::{
    BackgroundPolicy, Capabilities, ColorChoice, RenderingPolicy, Switch, TerminalControls,
    capabilities, ci_depth, color_depth, columns_variable, effective_columns, main_glyphs,
    under_ci,
};
pub use resolve::{next_column, width};
pub use style::{
    AdaptiveStyle, Alignment, CORE_TOKENS, Modifier, Operation, Style, StyleError, adaptive,
    escape, nowrap, pad, style,
};
pub use theme::{Palette, Theme, ThemeMapping, ThemeValue};
pub use width::graphemes;
pub use wrap::wrap_plain;

#[cfg(test)]
mod internal_tests;
