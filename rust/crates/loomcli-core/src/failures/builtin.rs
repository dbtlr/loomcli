//! Core's failure classes.
//!
//! | Class | Parent | Failure code | Exit code |
//! | --- | --- | --- | --- |
//! | `LoomError` | none | `failure` | 1 |
//! | `UsageError` | `LoomError` | `usage` | 2 |
//! | `InputError` | `UsageError` | `invalid-input` | 2 |
//! | `UnknownCommandError` | `UsageError` | `unknown-command` | 2 |
//! | `NonCallableCommandError` | `UsageError` | `missing-subcommand` | 2 |
//! | `UnexpectedArgumentError` | `UsageError` | `unexpected-argument` | 2 |
//! | `UnknownOptionError` | `UsageError` | `unknown-option` | 2 |
//! | `MissingValueError` | `UsageError` | `missing-value` | 2 |
//! | `UnexpectedValueError` | `UsageError` | `unexpected-value` | 2 |
//! | `RepeatedOptionError` | `UsageError` | `repeated-option` | 2 |
//! | `MisplacedOptionError` | `UsageError` | `misplaced-option` | 2 |
//! | `FatalError` | `LoomError` | `fatal` | 1 |
//! | `TerminalUnavailableError` | `FatalError` | `terminal-unavailable` | 1 |
//! | `WorkingDirectoryError` | `LoomError` | `working-directory-unreadable` | 1 |
//! | `DeclarationError` | `LoomError` | `internal` | 1 |
//! | `InternalError` | `LoomError` | `internal` | 1 |
//! | `ResultError` | `InternalError` | `internal`, inherited | 1 |

use std::any::Any;

use crate::Failure;
use crate::diagnostics::text::{Anatomy, Fallback, Layout, diagnostic_text};
use crate::diagnostics::{DiagnosticParts, DiagnosticRule, Finding, rules};
use crate::inputs::InputProblem;

use super::messages;
use super::{Error, FailureClass, FailureExitCode};

/// The root failure class: the message and the cause every failure carries. It is abstract: core
/// reports a value of a class that extends it, never a bare `LoomError`, so it converts into no
/// [`Error`].
#[derive(Debug)]
pub struct LoomError {
    pub(super) message: String,
    pub(super) cause: Option<Box<Error>>,
}

impl LoomError {
    /// The base of a failure with this message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            cause: None,
        }
    }

    /// The base of a failure with this message that replaced `cause`.
    pub fn with_cause(message: impl Into<String>, cause: impl Into<Error>) -> Self {
        Self {
            message: message.into(),
            cause: Some(Box::new(cause.into())),
        }
    }
}

impl Failure for LoomError {
    fn class(&self) -> &'static FailureClass {
        <Self as Failure>::failure_class()
    }

    fn failure_class() -> &'static FailureClass {
        static CLASS: FailureClass = FailureClass::new(
            "LoomError",
            Some("failure"),
            Some(FailureExitCode::new(1)),
            None,
        );
        &CLASS
    }

    fn base(&self) -> Option<&dyn Failure> {
        None
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// The abstract class of every invalid invocation: exit 2, and core's default view opens each line
/// with the application name.
#[derive(Debug, Failure)]
#[failure(abstract, code = "usage", exit_code = 2)]
pub struct UsageError {
    #[failure(base)]
    base: LoomError,
}

impl UsageError {
    /// The base of a usage failure with this message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            base: LoomError::new(message),
        }
    }

    /// The base of a usage failure with this message that replaced `cause`.
    pub fn with_cause(message: impl Into<String>, cause: impl Into<Error>) -> Self {
        Self {
            base: LoomError::with_cause(message, cause),
        }
    }
}

/// The class `out.fatal()` returns, and the usual parent of an application's own failure classes.
#[derive(Debug, Failure)]
#[failure(code = "fatal")]
pub struct FatalError {
    #[failure(base)]
    base: LoomError,
}

impl FatalError {
    /// A fatal failure with this message, which core's default view writes as authored marked
    /// text.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            base: LoomError::new(message),
        }
    }

    /// A fatal failure with this message that replaced `cause`.
    pub fn with_cause(message: impl Into<String>, cause: impl Into<Error>) -> Self {
        Self {
            base: LoomError::with_cause(message, cause),
        }
    }
}

/// An invocation of a Command that needs a terminal, without terminal stdin and stderr outside CI.
#[derive(Debug, Failure)]
#[failure(code = "terminal-unavailable")]
pub struct TerminalUnavailableError {
    #[failure(base)]
    base: FatalError,
    command: Vec<String>,
}

impl TerminalUnavailableError {
    /// Builds the failure for the application and routed path, empty for the root.
    #[must_use]
    pub fn new(application: &str, command: Vec<String>) -> Self {
        Self {
            base: FatalError::new(messages::terminal_unavailable(application, &command)),
            command,
        }
    }

    /// The routed path from the root.
    #[must_use]
    pub fn command(&self) -> &[String] {
        &self.command
    }
}

/// One or more input problems found in the validation phase, in authoring order, with the broken
/// option groups after them.
#[derive(Debug, Failure)]
#[failure(code = "invalid-input")]
pub struct InputError {
    #[failure(base)]
    base: UsageError,
    problems: Vec<InputProblem>,
}

impl InputError {
    /// An input failure with its sentence and problems.
    pub fn new(message: impl Into<String>, problems: Vec<InputProblem>) -> Self {
        Self {
            base: UsageError::new(message),
            problems,
        }
    }

    /// The problems.
    #[must_use]
    pub fn problems(&self) -> &[InputProblem] {
        &self.problems
    }
}

/// A plain word that names no child of a Command with children. The one fault core raises before
/// the chain.
#[derive(Debug, Failure)]
#[failure(code = "unknown-command")]
pub struct UnknownCommandError {
    #[failure(base)]
    base: UsageError,
    token: String,
    candidates: Vec<String>,
}

impl UnknownCommandError {
    /// The unknown word and the canonical names of the visible children.
    pub fn new(token: impl Into<String>, candidates: Vec<String>) -> Self {
        let token = token.into();
        Self {
            base: UsageError::new(messages::unknown_command(&token, &candidates)),
            token,
            candidates,
        }
    }

    /// The word.
    #[must_use]
    pub fn token(&self) -> &str {
        &self.token
    }

    /// The visible children's canonical names, in authoring order.
    #[must_use]
    pub fn candidates(&self) -> &[String] {
        &self.candidates
    }
}

/// An invocation that routed to a group and named no subcommand.
#[derive(Debug, Failure)]
#[failure(code = "missing-subcommand")]
pub struct NonCallableCommandError {
    #[failure(base)]
    base: UsageError,
    command: Vec<String>,
    candidates: Vec<String>,
    argument: Option<String>,
}

impl NonCallableCommandError {
    /// The group's path and the canonical names of its visible children.
    #[must_use]
    pub fn new(command: Vec<String>, candidates: Vec<String>) -> Self {
        Self {
            base: UsageError::new(messages::missing_subcommand(&command, &candidates)),
            command,
            candidates,
            argument: None,
        }
    }

    /// Adds the argv word that the parent could have read as an argument.
    #[must_use]
    pub fn argument(mut self, word: impl Into<String>) -> Self {
        let word = word.into();
        let sentence = messages::missing_subcommand(&self.command, &self.candidates);
        self.base = UsageError::new(messages::pass_as_argument(&sentence, &word));
        self.argument = Some(word);
        self
    }

    /// The escapable argv word, when routing reached the group through a parent with arguments.
    #[must_use]
    pub fn argument_word(&self) -> Option<&str> {
        self.argument.as_deref()
    }

    /// The group's path.
    #[must_use]
    pub fn command(&self) -> &[String] {
        &self.command
    }

    /// The visible children's canonical names, in authoring order.
    #[must_use]
    pub fn candidates(&self) -> &[String] {
        &self.candidates
    }
}

/// More plain words than the routed Command accepts.
#[derive(Debug, Failure)]
#[failure(code = "unexpected-argument")]
pub struct UnexpectedArgumentError {
    #[failure(base)]
    base: UsageError,
    command: Vec<String>,
    accepted: usize,
    extra: Vec<String>,
}

impl UnexpectedArgumentError {
    /// The routed path, how many arguments it accepts, and the extra words.
    #[must_use]
    pub fn new(command: Vec<String>, accepted: usize, extra: Vec<String>) -> Self {
        Self {
            base: UsageError::new(messages::unexpected_arguments(&command, accepted)),
            command,
            accepted,
            extra,
        }
    }

    /// An `args` key the routed Command does not declare, in an invocation by name: `extra` holds
    /// the key alone, `accepted` the number of arguments the Command declares, and the sentence
    /// names the key.
    pub(crate) fn undeclared(command: Vec<String>, accepted: usize, name: &str) -> Self {
        Self {
            base: UsageError::new(messages::undeclared_argument(&command, name)),
            command,
            accepted,
            extra: vec![name.to_owned()],
        }
    }

    /// An explicit named tail on a Command that leaves the mode off.
    pub(crate) fn declared_no_passthrough(
        command: Vec<String>,
        accepted: usize,
        extra: Vec<String>,
    ) -> Self {
        Self {
            base: UsageError::new(messages::declared_no_passthrough(&command)),
            command,
            accepted,
            extra,
        }
    }

    /// The routed path.
    #[must_use]
    pub fn command(&self) -> &[String] {
        &self.command
    }

    /// How many arguments the Command accepts.
    #[must_use]
    pub fn accepted(&self) -> usize {
        self.accepted
    }

    /// The words beyond them.
    #[must_use]
    pub fn extra(&self) -> &[String] {
        &self.extra
    }
}

/// An option word no table holds.
#[derive(Debug, Failure)]
#[failure(code = "unknown-option")]
pub struct UnknownOptionError {
    #[failure(base)]
    base: UsageError,
    spelling: String,
}

impl UnknownOptionError {
    /// The spelling as supplied.
    pub fn new(spelling: impl Into<String>) -> Self {
        let spelling = spelling.into();
        Self {
            base: UsageError::new(messages::unknown_option(&spelling)),
            spelling,
        }
    }

    /// A spelling on a Command that reads bare words as arguments.
    pub(crate) fn before_arguments(spelling: &str) -> Self {
        Self {
            base: UsageError::new(messages::unknown_option_before_arguments(spelling)),
            spelling: spelling.to_owned(),
        }
    }

    /// The unknown option of an invocation by name: `spelling` holds the key the caller wrote, and
    /// the sentence asks for a declared name, because the caller typed no spelling.
    pub(crate) fn by_name(name: impl Into<String>) -> Self {
        let spelling = name.into();
        Self {
            base: UsageError::new(messages::unknown_option_name(&spelling)),
            spelling,
        }
    }

    /// The spelling as supplied.
    #[must_use]
    pub fn spelling(&self) -> &str {
        &self.spelling
    }
}

/// Where a missing value should have been. `--name=` is not a missing value: it supplies the
/// empty string.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MissingValueForm {
    /// The next word was an option word or the bare `--`, which is never a separate value, so the
    /// sentence names the attached form too: `-f --quiet` or `-f --`.
    Attached,
    /// The words ran out after the spelling: `-f` as the last word.
    Separate,
}

/// A string option with no value.
#[derive(Debug, Failure)]
#[failure(code = "missing-value")]
pub struct MissingValueError {
    #[failure(base)]
    base: UsageError,
    spelling: String,
}

impl MissingValueError {
    /// The spelling, and how the value was missing.
    pub fn new(spelling: impl Into<String>, form: MissingValueForm) -> Self {
        let spelling = spelling.into();
        let message = match form {
            MissingValueForm::Attached => messages::missing_attached_value(&spelling),
            MissingValueForm::Separate => messages::missing_value(&spelling),
        };
        Self {
            base: UsageError::new(message),
            spelling,
        }
    }

    /// The spelling as supplied.
    #[must_use]
    pub fn spelling(&self) -> &str {
        &self.spelling
    }
}

/// The kind of option that takes no value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValuelessKind {
    /// A Boolean option.
    Boolean,
    /// A counted option.
    Count,
}

/// A value attached to a spelling that takes none.
#[derive(Debug, Failure)]
#[failure(code = "unexpected-value")]
pub struct UnexpectedValueError {
    #[failure(base)]
    base: UsageError,
    spelling: String,
    value: String,
}

impl UnexpectedValueError {
    /// The spelling, the attached value, and the option's kind.
    pub fn new(spelling: impl Into<String>, value: impl Into<String>, kind: ValuelessKind) -> Self {
        let spelling = spelling.into();
        let message = match kind {
            ValuelessKind::Count => messages::counted_value(&spelling),
            ValuelessKind::Boolean => messages::boolean_value(&spelling),
        };
        Self {
            base: UsageError::new(message),
            spelling,
            value: value.into(),
        }
    }

    /// The spelling as supplied.
    #[must_use]
    pub fn spelling(&self) -> &str {
        &self.spelling
    }

    /// The attached value. Core's sentence never repeats it.
    #[must_use]
    pub fn value(&self) -> &str {
        &self.value
    }
}

/// An option that is neither multiple nor counted, supplied twice.
#[derive(Debug, Failure)]
#[failure(code = "repeated-option")]
pub struct RepeatedOptionError {
    #[failure(base)]
    base: UsageError,
    spelling: String,
}

impl RepeatedOptionError {
    /// The repeated spelling.
    pub fn new(spelling: impl Into<String>) -> Self {
        let spelling = spelling.into();
        Self {
            base: UsageError::new(messages::repeated_option(&spelling)),
            spelling,
        }
    }

    /// The repeated spelling.
    #[must_use]
    pub fn spelling(&self) -> &str {
        &self.spelling
    }
}

/// An option word a visible Command below the one routing reached declares.
#[derive(Debug, Failure)]
#[failure(code = "misplaced-option")]
pub struct MisplacedOptionError {
    #[failure(base)]
    base: UsageError,
    spelling: String,
    commands: Vec<Vec<String>>,
}

impl MisplacedOptionError {
    /// The spelling and the paths of the Commands that declare it.
    pub fn new(spelling: impl Into<String>, commands: Vec<Vec<String>>) -> Self {
        let spelling = spelling.into();
        Self {
            base: UsageError::new(messages::misplaced_option(&spelling, &commands)),
            spelling,
            commands,
        }
    }

    /// The spelling as supplied.
    #[must_use]
    pub fn spelling(&self) -> &str {
        &self.spelling
    }

    /// The paths from the root of the Commands that declare it, in authoring order.
    #[must_use]
    pub fn commands(&self) -> &[Vec<String>] {
        &self.commands
    }
}

/// The working directory could not be read when core captured the host.
#[derive(Debug, Failure)]
#[failure(code = "working-directory-unreadable")]
pub struct WorkingDirectoryError {
    #[failure(base)]
    base: LoomError,
}

impl WorkingDirectoryError {
    /// The failure, with the error capture raised as its cause.
    #[must_use]
    pub fn new(cause: std::io::Error) -> Self {
        Self {
            base: LoomError::with_cause(messages::WORKING_DIRECTORY_UNREADABLE, cause),
        }
    }
}

/// A mistake in how an author declared an Application, a Command, an option, or a plugin.
///
/// At an authoring call or an attach, core panics with [`DeclarationError::diagnostic`] as the
/// message, at the caller's line. At build, `inspect()` returns it, `check()` collects it, and
/// `run()` renders it by build.
#[derive(Debug, Failure)]
#[failure(code = "internal")]
pub struct DeclarationError {
    #[failure(base)]
    base: LoomError,
    details: Box<DeclarationDetails>,
}

/// A declaration fault's parts, boxed so the error stays small in a `Result`.
#[derive(Debug)]
struct DeclarationDetails {
    rule: Option<DiagnosticRule>,
    sentence: String,
    findings: Vec<Finding>,
    correction: Vec<String>,
}

impl DeclarationError {
    /// A fault under `rule`, with its sentence, findings, and correction.
    #[must_use]
    pub fn new(rule: DiagnosticRule, parts: DiagnosticParts) -> Self {
        Self::from_details(DeclarationDetails {
            rule: Some(rule),
            sentence: parts.sentence,
            findings: parts.findings,
            correction: parts.correction,
        })
    }

    /// A fault with a sentence alone, for a plugin that declares no rule. Its diagnostic holds the
    /// banner `-- INVALID DECLARATION --` and the sentence.
    pub fn sentence_only(sentence: impl Into<String>) -> Self {
        Self::from_details(DeclarationDetails {
            rule: None,
            sentence: sentence.into(),
            findings: Vec::new(),
            correction: Vec::new(),
        })
    }

    /// This fault, keeping `cause` as the error it replaced, as a fault raised for a validator's
    /// error does. Core reads the cause for nothing but a defect's evidence.
    #[must_use]
    pub fn with_cause(self, cause: impl Into<Error>) -> Self {
        let message = self.base.message;
        Self {
            base: LoomError::with_cause(message, cause),
            details: self.details,
        }
    }

    /// The fault whose message holds its whole diagnostic at 80 columns.
    fn from_details(details: DeclarationDetails) -> Self {
        let message = diagnostic_text(&details.anatomy(), Layout::MESSAGE);
        Self {
            base: LoomError::new(message),
            details: Box::new(details),
        }
    }

    /// The parts of this fault's diagnostic.
    pub(crate) fn anatomy(&self) -> Anatomy<'_> {
        self.details.anatomy()
    }

    /// The rule, when the fault carries one.
    #[must_use]
    pub fn rule(&self) -> Option<&DiagnosticRule> {
        self.details.rule.as_ref()
    }

    /// What is wrong, in one sentence.
    #[must_use]
    pub fn sentence(&self) -> &str {
        &self.details.sentence
    }

    /// The declarations at fault.
    #[must_use]
    pub fn findings(&self) -> &[Finding] {
        &self.details.findings
    }

    /// What to do instead: one imperative sentence, or several when several fixes fit.
    #[must_use]
    pub fn correction(&self) -> &[String] {
        &self.details.correction
    }

    /// The whole Developer Diagnostic as plain text at `columns` (80 when `None`).
    #[must_use]
    pub fn diagnostic(&self, columns: Option<u16>) -> String {
        let width = columns.map_or(crate::diagnostics::text::MESSAGE_WIDTH, usize::from);
        diagnostic_text(
            &self.anatomy(),
            Layout {
                width,
                application: None,
            },
        )
    }
}

impl DeclarationDetails {
    fn anatomy(&self) -> Anatomy<'_> {
        Anatomy {
            rule: self.rule.as_ref(),
            fallback: Fallback::InvalidDeclaration,
            sentence: &self.sentence,
            findings: &self.findings,
            evidence: Vec::new(),
            correction: &self.correction,
        }
    }
}

/// A defect: a throw no translator answered, or a broken contract core owns.
#[derive(Debug, Failure)]
#[failure(code = "internal")]
pub struct InternalError {
    #[failure(base)]
    base: LoomError,
    rule: Option<DiagnosticRule>,
    sentence: String,
    findings: Vec<Finding>,
    correction: Vec<String>,
}

impl InternalError {
    /// A defect under `rule`, wrapping `cause`. Its message is the sentence; a development
    /// build's Developer Diagnostic prints the parts and the cause chain.
    pub fn new(rule: DiagnosticRule, parts: DiagnosticParts, cause: impl Into<Error>) -> Self {
        let base = LoomError::with_cause(parts.sentence.clone(), cause);
        Self::from_parts(base, Some(rule), parts)
    }

    /// A defect under `rule` that wraps no error, such as a broken contract core found itself.
    #[must_use]
    pub fn without_cause(rule: DiagnosticRule, parts: DiagnosticParts) -> Self {
        let base = LoomError::new(parts.sentence.clone());
        Self::from_parts(base, Some(rule), parts)
    }

    /// A defect with a message alone, wrapping `cause`. Its diagnostic's banner reads `DEFECT`.
    pub fn message_only(message: impl Into<String>, cause: impl Into<Error>) -> Self {
        let message = message.into();
        let base = LoomError::with_cause(message.clone(), cause);
        Self::from_parts(base, None, DiagnosticParts::new(message))
    }

    fn from_parts(base: LoomError, rule: Option<DiagnosticRule>, parts: DiagnosticParts) -> Self {
        Self {
            base,
            rule,
            sentence: parts.sentence,
            findings: parts.findings,
            correction: parts.correction,
        }
    }

    /// The parts of this defect's diagnostic, with its evidence already rendered.
    pub(crate) fn anatomy(&self, evidence: Vec<String>) -> Anatomy<'_> {
        Anatomy {
            rule: self.rule.as_ref(),
            fallback: Fallback::Defect,
            sentence: &self.sentence,
            findings: &self.findings,
            evidence,
            correction: &self.correction,
        }
    }

    /// The rule, when the defect carries one.
    #[must_use]
    pub fn rule(&self) -> Option<&DiagnosticRule> {
        self.rule.as_ref()
    }

    /// What broke, in one sentence.
    #[must_use]
    pub fn sentence(&self) -> &str {
        &self.sentence
    }

    /// What to do instead.
    #[must_use]
    pub fn correction(&self) -> &[String] {
        &self.correction
    }
}

/// How an action broke the result contract.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResultFault {
    /// The action settled without emitting its declared result.
    Missing,
    /// The action emitted its result twice.
    Repeated,
}

/// An action that broke its Command's result contract.
#[derive(Debug, Failure)]
pub struct ResultError {
    #[failure(base)]
    base: InternalError,
    kind: ResultFault,
    path: Vec<String>,
}

impl ResultError {
    /// The fault and the routed path.
    #[must_use]
    pub fn new(kind: ResultFault, path: Vec<String>) -> Self {
        let sentence = match kind {
            ResultFault::Missing => messages::result_missing(&path),
            ResultFault::Repeated => messages::result_repeated(&path),
        };
        Self {
            base: InternalError::without_cause(
                rules::RESULT_CONTRACT,
                DiagnosticParts::new(sentence),
            ),
            kind,
            path,
        }
    }

    /// How the contract broke.
    #[must_use]
    pub fn kind(&self) -> ResultFault {
        self.kind
    }

    /// The routed path.
    #[must_use]
    pub fn path(&self) -> &[String] {
        &self.path
    }
}
