//! Compiles the Rust examples of the documentation.
//!
//! Each Markdown page below is included as the documentation of an item that exists only under
//! `cfg(doctest)`, so `cargo test --doc` compiles and runs every Rust block the page holds. The
//! README's application is also `examples/wordlen.rs`, which `tests/readme.rs` keeps identical to
//! the README's block.

/// README.md.
#[cfg(doctest)]
#[doc = include_str!("../../../README.md")]
pub struct Readme;

/// docs/guide/application.md.
#[cfg(doctest)]
#[doc = include_str!("../../guide/application.md")]
pub struct GuideApplication;

/// docs/guide/plugins.md.
#[cfg(doctest)]
#[doc = include_str!("../../guide/plugins.md")]
pub struct GuidePlugins;

/// docs/guide/writing-a-plugin.md.
#[cfg(doctest)]
#[doc = include_str!("../../guide/writing-a-plugin.md")]
pub struct GuideWritingAPlugin;

/// docs/guide/agents.md.
#[cfg(doctest)]
#[doc = include_str!("../../guide/agents.md")]
pub struct GuideAgents;

/// docs/guide/shipping.md.
#[cfg(doctest)]
#[doc = include_str!("../../guide/shipping.md")]
pub struct GuideShipping;

/// docs/guide/from-typescript.md.
#[cfg(doctest)]
#[doc = include_str!("../../guide/from-typescript.md")]
pub struct GuideFromTypescript;
