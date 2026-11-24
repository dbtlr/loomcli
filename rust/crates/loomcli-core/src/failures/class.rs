//! The failure trait, a class's static facts, and exit codes.

use std::any::Any;
use std::fmt;

use super::{Error, LoomError};

/// An exit code a failure class declares: 1 through 125.
///
/// 0 is success, 126 and 127 belong to the shell, and 128 plus a signal number reports a signal, so
/// [`FailureExitCode::new`] rejects them. In a constant, as `#[derive(Failure)]` writes it, an
/// out-of-range code is a compile error.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize)]
#[serde(transparent)]
pub struct FailureExitCode(u8);

impl FailureExitCode {
    /// The code `n`. Panics, at compile time in a constant, outside 1 through 125.
    #[must_use]
    pub const fn new(n: u8) -> Self {
        assert!(
            n >= 1 && n <= 125,
            "A failure class declares an exit code from 1 through 125."
        );
        Self(n)
    }

    /// The number.
    #[must_use]
    pub const fn get(self) -> u8 {
        self.0
    }
}

/// `EX_USAGE` from `sysexits.h`: the command was used incorrectly.
pub const EX_USAGE: FailureExitCode = FailureExitCode::new(64);
/// `EX_DATAERR`: the input data was incorrect.
pub const EX_DATAERR: FailureExitCode = FailureExitCode::new(65);
/// `EX_NOINPUT`: an input file did not exist or could not be read.
pub const EX_NOINPUT: FailureExitCode = FailureExitCode::new(66);
/// `EX_NOUSER`: an addressee is unknown.
pub const EX_NOUSER: FailureExitCode = FailureExitCode::new(67);
/// `EX_NOHOST`: a host name is unknown.
pub const EX_NOHOST: FailureExitCode = FailureExitCode::new(68);
/// `EX_UNAVAILABLE`: a service is unavailable.
pub const EX_UNAVAILABLE: FailureExitCode = FailureExitCode::new(69);
/// `EX_SOFTWARE`: an internal software error.
pub const EX_SOFTWARE: FailureExitCode = FailureExitCode::new(70);
/// `EX_OSERR`: an operating system error.
pub const EX_OSERR: FailureExitCode = FailureExitCode::new(71);
/// `EX_OSFILE`: a system file is missing or malformed.
pub const EX_OSFILE: FailureExitCode = FailureExitCode::new(72);
/// `EX_CANTCREAT`: an output file cannot be created.
pub const EX_CANTCREAT: FailureExitCode = FailureExitCode::new(73);
/// `EX_IOERR`: an input or output error.
pub const EX_IOERR: FailureExitCode = FailureExitCode::new(74);
/// `EX_TEMPFAIL`: a temporary failure; a retry may succeed.
pub const EX_TEMPFAIL: FailureExitCode = FailureExitCode::new(75);
/// `EX_PROTOCOL`: a remote system broke the protocol.
pub const EX_PROTOCOL: FailureExitCode = FailureExitCode::new(76);
/// `EX_NOPERM`: permission is insufficient.
pub const EX_NOPERM: FailureExitCode = FailureExitCode::new(77);
/// `EX_CONFIG`: the configuration is wrong.
pub const EX_CONFIG: FailureExitCode = FailureExitCode::new(78);

/// The exit code a run resolves: 0, a failure's code, or a signal's (129, 130, 131, 141, 143).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ExitCode(u8);

impl ExitCode {
    /// Success.
    pub const SUCCESS: ExitCode = ExitCode(0);
    /// `SIGHUP` ended the run.
    pub const HANGUP: ExitCode = ExitCode(129);
    /// `SIGINT` ended the run.
    pub const INTERRUPT: ExitCode = ExitCode(130);
    /// `SIGQUIT` ended the run.
    pub const QUIT: ExitCode = ExitCode(131);
    /// The reader of stdout closed the pipe.
    pub const CLOSED_PIPE: ExitCode = ExitCode(141);
    /// `SIGTERM` ended the run.
    pub const TERMINATE: ExitCode = ExitCode(143);

    /// The number.
    #[must_use]
    pub const fn get(self) -> u8 {
        self.0
    }
}

impl FailureExitCode {
    /// The failure code an exit code is, or `None` for success and the cancellation codes.
    pub(crate) fn of(code: ExitCode) -> Option<FailureExitCode> {
        (1..=125)
            .contains(&code.0)
            .then_some(FailureExitCode(code.0))
    }
}

impl From<FailureExitCode> for ExitCode {
    fn from(code: FailureExitCode) -> Self {
        ExitCode(code.0)
    }
}

impl From<ExitCode> for std::process::ExitCode {
    fn from(code: ExitCode) -> Self {
        std::process::ExitCode::from(code.0)
    }
}

/// The static facts of one failure class: its name, the failure code and exit code it declares,
/// and its parent. A projection such as the manifest reads them without constructing a failure.
///
/// Core compares classes by address, so each class has exactly one `static` value, which
/// `#[derive(Failure)]` writes.
#[derive(Debug)]
pub struct FailureClass {
    name: &'static str,
    code: Option<&'static str>,
    exit_code: Option<FailureExitCode>,
    parent: Option<fn() -> &'static FailureClass>,
}

impl FailureClass {
    /// A class's facts. A code outside the failure-code grammar panics, at compile time in the
    /// `static` the derive writes.
    #[must_use]
    pub const fn new(
        name: &'static str,
        code: Option<&'static str>,
        exit_code: Option<FailureExitCode>,
        parent: Option<fn() -> &'static FailureClass>,
    ) -> Self {
        if let Some(code) = code {
            assert!(
                is_failure_code(code),
                "A failure code is lowercase letters and digits in words joined by single hyphens."
            );
        }
        Self {
            name,
            code,
            exit_code,
            parent,
        }
    }

    /// The class name, as diagnostics print it.
    #[must_use]
    pub fn name(&self) -> &'static str {
        self.name
    }

    /// The failure code: this class's, or the nearest ancestor's that declares one.
    #[must_use]
    pub fn code(&self) -> &'static str {
        let mut class = self;
        loop {
            if let Some(code) = class.code {
                return code;
            }
            match class.parent() {
                Some(parent) => class = parent,
                // `LoomError` declares `failure`, so only a hand-written root reaches here.
                None => return "failure",
            }
        }
    }

    /// The exit code: this class's, or the nearest ancestor's that declares one.
    #[must_use]
    pub fn exit_code(&self) -> FailureExitCode {
        let mut class = self;
        loop {
            if let Some(exit_code) = class.exit_code {
                return exit_code;
            }
            match class.parent() {
                Some(parent) => class = parent,
                // `LoomError` declares 1, so only a hand-written root reaches here.
                None => return FailureExitCode::new(1),
            }
        }
    }

    /// The failure code this class declares itself, or `None` when it inherits one.
    #[must_use]
    pub fn declared_code(&self) -> Option<&'static str> {
        self.code
    }

    /// The exit code this class declares itself, or `None` when it inherits one.
    #[must_use]
    pub fn declared_exit_code(&self) -> Option<FailureExitCode> {
        self.exit_code
    }

    /// The parent class, or `None` for `LoomError`.
    #[must_use]
    pub fn parent(&self) -> Option<&'static FailureClass> {
        self.parent.map(|parent| parent())
    }

    /// Whether this class is `ancestor` or descends from it.
    #[must_use]
    pub fn extends(&self, ancestor: &FailureClass) -> bool {
        let mut class = self;
        loop {
            if std::ptr::eq(class, ancestor) {
                return true;
            }
            match class.parent() {
                Some(parent) => class = parent,
                None => return false,
            }
        }
    }
}

/// A failure class: a value core reports as a failure, with its class's facts.
///
/// Implement it with `#[derive(Failure)]`, which names the class's code, exit code, and the field
/// holding its parent class's value. A failure is not a `std::error::Error`: a foreign error is
/// what a translator turns into a failure, and the two stay apart in [`Error`].
///
/// The trait holds only what identifies the class and its chain. The facts a reader reads, the
/// message, the cause, the failure code, and the exit code, are [`FailureFacts`] methods that no
/// impl can override: core reads the codes from [`Failure::class`] alone, so one class never exits
/// with two codes.
pub trait Failure: fmt::Debug + Send + Sync + 'static {
    /// The class of this value.
    fn class(&self) -> &'static FailureClass;

    /// The class of this type, for a projection that reads it without a value.
    fn failure_class() -> &'static FailureClass
    where
        Self: Sized;

    /// The part of this value that is its parent class's value, or `None` for `LoomError`.
    fn base(&self) -> Option<&dyn Failure>;

    /// This value, for a typed read by a view or a hook.
    fn as_any(&self) -> &dyn Any;
}

/// The facts every failure reads the same way: implemented once, for every [`Failure`], so no
/// class can override them.
pub trait FailureFacts {
    /// The sentence without the application-name prefix, which the root `LoomError` holds.
    fn message(&self) -> &str;

    /// The error this failure replaced, when its constructor kept one.
    fn cause(&self) -> Option<&Error>;

    /// The failure code the class declares, or the nearest ancestor's.
    fn code(&self) -> &'static str;

    /// The exit code the class declares, or the nearest ancestor's.
    fn exit_code(&self) -> FailureExitCode;
}

impl<F: Failure + ?Sized> FailureFacts for F {
    fn message(&self) -> &str {
        root(self).map_or("", |root| root.message.as_str())
    }

    fn cause(&self) -> Option<&Error> {
        root(self).and_then(|root| root.cause.as_deref())
    }

    fn code(&self) -> &'static str {
        self.class().code()
    }

    fn exit_code(&self) -> FailureExitCode {
        self.class().exit_code()
    }
}

impl dyn Failure {
    /// This failure read as class `F`: itself or the base it extends, as `instanceof` reads a class.
    pub fn downcast_ref<F: Failure>(&self) -> Option<&F> {
        let mut link: &dyn Failure = self;
        loop {
            if let Some(found) = link.as_any().downcast_ref::<F>() {
                return Some(found);
            }
            link = link.base()?;
        }
    }

    /// Whether this failure is of class `F` or descends from it.
    pub fn is<F: Failure>(&self) -> bool {
        self.downcast_ref::<F>().is_some()
    }
}

/// The root `LoomError` value a failure's chain of bases ends at, which holds its message and
/// cause. A hand-written `Failure` impl whose chain ends elsewhere has none.
fn root<F: Failure + ?Sized>(failure: &F) -> Option<&LoomError> {
    if failure.base().is_none() {
        return failure.as_any().downcast_ref::<LoomError>();
    }
    let mut link: &dyn Failure = failure.base()?;
    loop {
        match link.base() {
            Some(base) => link = base,
            None => return link.as_any().downcast_ref::<LoomError>(),
        }
    }
}

/// Whether `value` is a failure code: one or more words of lowercase ASCII letters and digits joined
/// by single hyphens, such as `path-not-found` or `http-503`.
#[must_use]
pub const fn is_failure_code(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes[0] == b'-' || bytes[bytes.len() - 1] == b'-' {
        return false;
    }
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        let word = byte.is_ascii_lowercase() || byte.is_ascii_digit();
        if !(word || (byte == b'-' && bytes[index - 1] != b'-')) {
            return false;
        }
        index += 1;
    }
    true
}
