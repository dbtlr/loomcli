//! Every first-party Loom CLI plugin and the pack views, one Cargo feature each.
//!
//! Depending on the crate installs nothing, and it has no default features: an application turns
//! on the features of the plugins it names and lists them in `Application::plugins`. A plugin that
//! defines extensions keeps their descriptors in its `extension` module behind its own feature
//! (`help-extension`, `manifest-extension`, ...), so a crate that supplies a value to a sibling's
//! extension compiles the descriptors without the sibling. A plugin that declares views keeps them
//! in its `views` module behind its `-views` feature.

/// The package part of every identity the pack declares: `@loomcli/plugins/<plugin>`.
pub const PACKAGE_NAME: &str = "@loomcli/plugins";

#[cfg(feature = "background")]
pub mod background;
#[cfg(feature = "box")]
pub mod boxed;
#[cfg(any(
    feature = "completion",
    feature = "help-views",
    feature = "suggestions"
))]
mod closed_set;
#[cfg(feature = "color")]
pub mod color;
#[cfg(feature = "completion")]
pub mod completion;
#[cfg(any(feature = "config", feature = "config-extension"))]
pub mod config;
#[cfg(feature = "dotenv")]
pub mod dotenv;
#[cfg(feature = "external-commands")]
pub mod external_commands;
#[cfg(any(feature = "format", feature = "format-views"))]
pub mod format;
// The JSON text the formatter's views and the manifest write: `JSON.stringify`'s bytes. The manifest
// writes no failures, so a build without the format views leaves the failure type unread.
#[cfg(any(feature = "format-views", feature = "manifest"))]
#[cfg_attr(not(feature = "format-views"), allow(dead_code))]
mod encode;
#[cfg(feature = "heading")]
pub mod heading;
#[cfg(any(feature = "help", feature = "help-extension", feature = "help-views"))]
pub mod help;
#[cfg(feature = "installation")]
mod installation;
#[cfg(feature = "installation")]
#[doc(hidden)]
pub use installation::test_support as installation_test_support;
#[cfg(feature = "interaction")]
pub mod interaction;
#[cfg(any(
    feature = "box",
    feature = "heading",
    feature = "list",
    feature = "prose",
    feature = "records",
    feature = "rule",
    feature = "step",
    feature = "table",
    feature = "version-views"
))]
// Each view reads the parts of the layout it draws with, so a build of fewer views leaves some unread.
#[cfg_attr(
    not(all(
        feature = "box",
        feature = "heading",
        feature = "list",
        feature = "prose",
        feature = "records",
        feature = "rule",
        feature = "table"
    )),
    allow(dead_code)
)]
mod layout;
#[cfg(feature = "list")]
pub mod list;
#[cfg(any(feature = "logging", feature = "logging-extension"))]
pub mod logging;
#[cfg(any(feature = "manifest", feature = "manifest-extension"))]
pub mod manifest;
#[cfg(feature = "manpage")]
pub mod manpage;
#[cfg(feature = "markdown")]
// The help page and the man page each read a different part of the tree, and a build of the
// internal feature alone reads none of it.
#[cfg_attr(
    not(all(feature = "help-views", feature = "manpage")),
    allow(dead_code)
)]
mod markdown;
#[cfg(any(feature = "mcp", feature = "mcp-extension"))]
pub mod mcp;
// The sentences of the files at the top of `src`; a build of fewer plugins leaves some unread.
#[cfg(any(feature = "format-views", feature = "manifest"))]
#[cfg_attr(not(feature = "format-views"), allow(dead_code))]
mod messages;
#[cfg(feature = "plain")]
pub mod plain;
#[cfg(feature = "prose")]
pub mod prose;
#[cfg(feature = "records")]
pub mod records;
#[cfg(feature = "rule")]
pub mod rule;
#[cfg(feature = "self-update")]
pub mod self_update;
#[cfg(feature = "service")]
pub mod service;
#[cfg(feature = "skills")]
pub mod skills;
#[cfg(feature = "step")]
pub mod step;
#[cfg(feature = "suggestions")]
pub mod suggestions;
#[cfg(feature = "table")]
pub mod table;
#[cfg(feature = "theme")]
pub mod theme;
#[cfg(feature = "verbose")]
pub mod verbose;
#[cfg(any(feature = "version", feature = "version-views"))]
pub mod version;
