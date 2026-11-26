//! Failure classes, exit codes, the plain-data failure form, failure encoders, and translators.
//!
//! A failure class is a type that implements [`Failure`], usually through `#[derive(Failure)]`. It
//! declares its failure code, its exit code, and its parent class once; core reads them from the
//! class, walking to the nearest ancestor that declares each. Every failure takes one ordinary
//! path: a foreign error is offered to the translators, each `on_failure` hook adds hints, the
//! failure view or a failure encoder writes the report, and the run resolves the exit code.

mod builtin;
mod class;
mod error;
pub(crate) mod form;
pub(crate) mod messages;
pub(crate) mod translators;

#[cfg(test)]
mod tests;

pub use builtin::{
    DeclarationError, FatalError, InputError, InternalError, LoomError, MisplacedOptionError,
    MissingValueError, MissingValueForm, NonCallableCommandError, RepeatedOptionError, ResultError,
    ResultFault, UnexpectedArgumentError, UnexpectedValueError, UnknownCommandError,
    UnknownOptionError, UsageError, ValuelessKind, WorkingDirectoryError,
};
pub use class::{
    EX_CANTCREAT, EX_CONFIG, EX_DATAERR, EX_IOERR, EX_NOHOST, EX_NOINPUT, EX_NOPERM, EX_NOUSER,
    EX_OSERR, EX_OSFILE, EX_PROTOCOL, EX_SOFTWARE, EX_TEMPFAIL, EX_UNAVAILABLE, EX_USAGE, ExitCode,
    Failure, FailureClass, FailureExitCode, FailureFacts, is_failure_code,
};
pub use error::Error;
pub use form::{FailureForm, FailureKey, FailureView, FailureViewContext, failure};
pub use translators::{FailureEncoder, FailureEncoding, Translation, encode_failure, translate};
