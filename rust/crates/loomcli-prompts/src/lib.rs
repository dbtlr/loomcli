//! Questions and progress for Loom CLI actions: the port of `@loomcli/prompts`.
//!
//! A question asks the operator through an input region when the run is interactive. It links at
//! most one input of the routed Command: a supplied input prefills it, `skip_if_supplied` answers it
//! from the input, and with interaction off a linked question answers from its input or fails with
//! the input's missing-input error, exit 2, while an unlinked one fails with
//! [`InteractionUnavailableError`], exit 1. Each kind reads keys in raw mode through one reader the
//! run's questions share, draws its frames through the [`views`] an application overrides, and
//! leaves one answered or cancelled line in scrollback.
//!
//! A progress line shows work under way in a live region, as a spinner or a bar, reports progress
//! events, and writes plain lines off a terminal.

mod controls;
mod editor;
mod line;
mod lines;
mod link;
mod list;
mod messages;
mod progress;
mod question;
mod questions;
mod reader;
pub mod views;

pub use editor::EditorError;
pub use link::InteractionUnavailableError;
pub use progress::{
    Progress, ProgressContext, ProgressParts, ProgressSettings, ProgressStyleSettings,
    ProgressUpdate, Spinner, TrackMessages, progress, progress_style,
};
pub use questions::{
    Choice, ChoiceEntry, ChoiceSource, ConfirmSettings, EditorSettings, Listed,
    MultiselectSettings, SecretSettings, SelectSettings, Sourced, TextSettings, Verbatim, confirm,
    editor, multiselect, multiselect_as, secret, select, select_as, text,
};
