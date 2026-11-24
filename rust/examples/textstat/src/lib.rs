//! textstat: count the bytes, words, or lines of files and piped text. The Rust port of the
//! reference example, declaration for declaration.
//!
//! [`textstat()`] is the declaration to read first. `count_files` is the action, `count_source`
//! counts one source, and `views` holds the failure view and the table's cell function.

pub mod application;
pub mod count_files;
pub mod count_source;
pub mod row;
pub mod views;

pub use application::textstat;
