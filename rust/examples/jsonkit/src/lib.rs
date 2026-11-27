//! jsonkit: read and reshape one JSON document. The Rust port of the reference example,
//! declaration for declaration.
//!
//! [`jsonkit()`] is the declaration to read first. The root summarizes a document; `get`, `keys`,
//! `select`, and `stats depth max` read or reshape it; `fetch` is the deprecated spelling of `get`;
//! `debug` and `paths` are hidden. The private `doctor` plugin attaches `doctor`, and the private
//! `explain` plugin contributes `--explain`. Each Command is a module under `commands`, and each
//! action a module under `actions`.

pub mod actions;
pub mod application;
pub mod commands;
pub mod document_input;
pub mod entries;
pub mod failures;
pub mod json;
pub mod json_layout;
pub mod kinds;
pub mod member;
pub mod read_json;
pub mod resolve_path;
pub mod translators;
pub mod views;

pub use application::jsonkit;
