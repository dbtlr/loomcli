//! Styles and rendering policy: the `loomcli-style` crate, re-exported.
//!
//! `loomcli-style` owns marked strings, ANSI resolution, color depth, glyphs, width, wrap, and pad.
//! Core re-exports it here, as the reference's one barrel exports `style`, `width`, `pad`,
//! `nowrap`, `glyph`, and the theme types, so an author names one crate.

pub use loomcli_style::*;

/// The style a context hands to an action, a view, or a hook: the style chain, whose tokens are
/// core's and the installed theme's names, resolved at the destination the text is written to.
///
/// The reference types the chain with the theme's names; a Rust chain takes any token name, and a
/// name no theme declares leaves its frame literal when it resolves, as the reference's does at
/// run time.
pub type ContextualStyle = Style;
