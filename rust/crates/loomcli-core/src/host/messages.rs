//! The text of the errors the host reports for a child program that could not start.

pub(super) const WORKING_DIRECTORY_UNREADABLE: &str =
    "The current working directory cannot be read.";

pub(super) const RUNTIME_SHUT_DOWN: &str = "The runtime that ran the child program shut down.";

pub(super) const NO_RUNTIME: &str = "A child program starts only inside a tokio runtime.";
