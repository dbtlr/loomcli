//! The error an action, a middleware, a hook, or a source returns.

use std::backtrace::{Backtrace, BacktraceStatus};
use std::fmt;

use super::{DeclarationError, Failure};

/// What author code returns when it does not complete: a failure, or a foreign error.
///
/// `?` converts both. A `std::error::Error` from a library becomes a foreign error, which core
/// offers to the translators before it would report a defect; a failure class converts through the
/// `From` impl `#[derive(Failure)]` writes. `Error` itself is not a `std::error::Error`, so it never
/// wraps itself.
///
/// A foreign error converted by `?` keeps its type's name and, when the process enables backtraces
/// (`RUST_BACKTRACE` or `RUST_LIB_BACKTRACE`), the backtrace captured at the conversion, which a
/// development build's Developer Diagnostic prints for a defect.
pub struct Error {
    repr: Repr,
}

enum Repr {
    Failure(Box<dyn Failure>),
    /// A declaration fault, kept as its own type so a graph build hands a hook's fault back whole.
    Declaration(Box<DeclarationError>),
    Foreign(Foreign),
}

/// A foreign error and what core learned about it where it was converted.
struct Foreign {
    error: Box<dyn std::error::Error + Send + Sync + 'static>,
    type_name: Option<&'static str>,
    backtrace: Option<Backtrace>,
    /// Whether this is the error a destination's failed write handed out, which a translator that
    /// answers it reports in place of the broken destination.
    written: bool,
}

/// The backtrace of the current call stack, when the process enables backtraces.
fn captured() -> Option<Backtrace> {
    let backtrace = Backtrace::capture();
    (backtrace.status() == BacktraceStatus::Captured).then_some(backtrace)
}

impl Error {
    /// A failure as an error. `#[derive(Failure)]` writes the `From` impl that calls it.
    pub fn from_failure<F: Failure>(failure: F) -> Self {
        let mut slot = Some(failure);
        let declaration = (&mut slot as &mut dyn std::any::Any)
            .downcast_mut::<Option<DeclarationError>>()
            .and_then(Option::take);
        let repr = match (declaration, slot) {
            (Some(fault), _) => Repr::Declaration(Box::new(fault)),
            (None, Some(failure)) => Repr::Failure(Box::new(failure)),
            // The slot is emptied only when it held a declaration fault, which the first arm took.
            (None, None) => Repr::Declaration(Box::new(DeclarationError::sentence_only(""))),
        };
        Self { repr }
    }

    /// A foreign error that `?` cannot convert: a boxed `dyn std::error::Error`, or, through
    /// `.into()`, an `anyhow::Error` or `eyre::Report`, which are not `std::error::Error`
    /// themselves: `.map_err(|e| Error::from_foreign(e.into()))`. Translators match the boxed
    /// error's concrete type, so a translation keyed on `E` still answers `Box::new(e: E)`.
    #[must_use]
    pub fn from_foreign(error: Box<dyn std::error::Error + Send + Sync + 'static>) -> Self {
        Self {
            repr: Repr::Foreign(Foreign {
                error,
                type_name: None,
                backtrace: captured(),
                written: false,
            }),
        }
    }

    /// A boxed failure as an error.
    #[must_use]
    pub fn from_boxed_failure(failure: Box<dyn Failure>) -> Self {
        Self {
            repr: Repr::Failure(failure),
        }
    }

    /// The failure, when this error is one.
    #[must_use]
    pub fn failure(&self) -> Option<&dyn Failure> {
        match &self.repr {
            Repr::Failure(failure) => Some(failure.as_ref()),
            Repr::Declaration(fault) => Some(fault.as_ref()),
            Repr::Foreign(_) => None,
        }
    }

    /// The foreign error, when this error is one.
    #[must_use]
    pub fn foreign(&self) -> Option<&(dyn std::error::Error + Send + Sync + 'static)> {
        match &self.repr {
            Repr::Failure(_) | Repr::Declaration(_) => None,
            Repr::Foreign(foreign) => Some(foreign.error.as_ref()),
        }
    }

    /// The failure read as class `F`, when this error is a failure of that class or a descendant.
    #[must_use]
    pub fn downcast_failure<F: Failure>(&self) -> Option<&F> {
        self.failure()?.downcast_ref::<F>()
    }

    /// The backtrace captured where a foreign error was converted, when the process enabled
    /// backtraces then. A failure carries none.
    #[must_use]
    pub fn backtrace(&self) -> Option<&Backtrace> {
        match &self.repr {
            Repr::Failure(_) | Repr::Declaration(_) => None,
            Repr::Foreign(foreign) => foreign.backtrace.as_ref(),
        }
    }

    /// The name of a foreign error's type, when `?` or `From` converted it from that type.
    pub(crate) fn foreign_type_name(&self) -> Option<&'static str> {
        match &self.repr {
            Repr::Failure(_) | Repr::Declaration(_) => None,
            Repr::Foreign(foreign) => foreign.type_name,
        }
    }

    /// This foreign error with `backtrace` in place of the one captured at its conversion, so a test
    /// reads evidence whatever the process's backtrace setting.
    #[cfg(test)]
    pub(crate) fn with_backtrace(mut self, backtrace: Backtrace) -> Self {
        if let Repr::Foreign(foreign) = &mut self.repr {
            foreign.backtrace = Some(backtrace);
        }
        self
    }

    /// The error a destination's failed write hands out: the write's `io::Error`, marked so the
    /// failure path knows a translator that answers it answered the destination's own failure.
    pub(crate) fn destination_write(error: std::io::Error) -> Self {
        let mut written = Self::from(error);
        if let Repr::Foreign(foreign) = &mut written.repr {
            foreign.written = true;
        }
        written
    }

    /// Whether this is the error a destination's failed write handed out.
    pub(crate) fn is_destination_write(&self) -> bool {
        matches!(&self.repr, Repr::Foreign(foreign) if foreign.written)
    }

    /// The failure this error is, boxed, or the error itself when it is foreign.
    pub(crate) fn into_failure(self) -> Result<Box<dyn Failure>, Error> {
        match self.repr {
            Repr::Failure(failure) => Ok(failure),
            Repr::Declaration(fault) => Ok(fault),
            Repr::Foreign(_) => Err(self),
        }
    }

    /// The declaration fault this error is, owned, or the error itself when it is another failure
    /// or a foreign error. A class that extends `DeclarationError` is another failure here.
    pub(crate) fn into_declaration(self) -> Result<DeclarationError, Error> {
        match self.repr {
            Repr::Declaration(fault) => Ok(*fault),
            repr => Err(Error { repr }),
        }
    }

    /// Hands a foreign error of type `E` to `answer` by value, which returns the error to report
    /// in its place or hands the foreign error back. Any other error, and a foreign error handed
    /// back, comes back as `Err` unchanged, its type name and backtrace kept.
    pub(crate) fn answer_foreign<E>(
        self,
        answer: impl FnOnce(E) -> Result<Error, E>,
    ) -> Result<Error, Error>
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        let Repr::Foreign(foreign) = self.repr else {
            return Err(self);
        };
        let Foreign {
            error,
            type_name,
            backtrace,
            written,
        } = foreign;
        match error.downcast::<E>() {
            Ok(typed) => answer(*typed).map_err(|handed| Error {
                repr: Repr::Foreign(Foreign {
                    error: Box::new(handed),
                    type_name,
                    backtrace,
                    written,
                }),
            }),
            Err(error) => Err(Error {
                repr: Repr::Foreign(Foreign {
                    error,
                    type_name,
                    backtrace,
                    written,
                }),
            }),
        }
    }
}

impl<E> From<E> for Error
where
    E: std::error::Error + Send + Sync + 'static,
{
    fn from(error: E) -> Self {
        Self {
            repr: Repr::Foreign(Foreign {
                error: Box::new(error),
                type_name: Some(std::any::type_name::<E>()),
                backtrace: captured(),
                written: false,
            }),
        }
    }
}

impl fmt::Debug for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.repr {
            Repr::Failure(failure) => fmt::Debug::fmt(failure, formatter),
            Repr::Declaration(fault) => fmt::Debug::fmt(fault, formatter),
            Repr::Foreign(foreign) => fmt::Debug::fmt(&foreign.error, formatter),
        }
    }
}
