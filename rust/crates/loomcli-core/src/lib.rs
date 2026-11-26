//! Loom CLI core: declare one command graph and serve people, agents, and automation from it.
//!
//! An author declares an [`Application`] and its [`Command`]s with fluent builders, carries typed
//! inputs with `#[derive(Inputs)]`, and installs [`Plugin`]s in one ordered list. Core parses an
//! invocation, resolves its inputs, runs the middleware chain and the action, renders output through
//! one view registry, and reports failures by class. The behavioral contract is the TypeScript
//! reference Loom CLI; [`derive@Inputs`] states the typed-input attribute grammar.
//!
//! The crate root re-exports every public name, as the reference's one barrel does. The modules
//! group them by concept.

extern crate self as loomcli_core;

pub mod application;
pub mod commands;
pub mod diagnostics;
pub mod failures;
pub mod host;
pub mod inputs;
pub mod inspection;
pub mod invocation;
pub mod marks;
mod messages;
pub mod output;
pub mod plugins;
pub mod shipping;
pub mod signals;
pub mod style;
pub mod support;

#[doc(hidden)]
pub mod __private;

/// The asynchronous sequence a rows result reads through [`RowSource::stream`], re-exported so an
/// author who streams rows needs no `futures-core` dependency of their own.
pub use futures_core::Stream;
pub use loomcli_derive::{Failure, Inputs};

pub use application::{Application, GroupApplication, RunOptions};
pub use commands::{
    AnyCommand, CarriesResult, Command, Configuring, Done, Fresh, Group, GroupCommand, NoResultYet,
    Open, Passthrough, State, TakesGlobals,
};
pub use diagnostics::{
    DiagnosticParts, DiagnosticRule, Finding, Literal, diagnostic_rule, is_rule_identity,
};
pub use failures::{
    DeclarationError, EX_CANTCREAT, EX_CONFIG, EX_DATAERR, EX_IOERR, EX_NOHOST, EX_NOINPUT,
    EX_NOPERM, EX_NOUSER, EX_OSERR, EX_OSFILE, EX_PROTOCOL, EX_SOFTWARE, EX_TEMPFAIL,
    EX_UNAVAILABLE, EX_USAGE, Error, ExitCode, Failure, FailureClass, FailureEncoder,
    FailureEncoding, FailureExitCode, FailureFacts, FailureForm, FailureKey, FailureView,
    FailureViewContext, FatalError, InputError, InternalError, LoomError, MisplacedOptionError,
    MissingValueError, NonCallableCommandError, RepeatedOptionError, ResultError, ResultFault,
    TerminalUnavailableError, Translation, UnexpectedArgumentError, UnexpectedValueError,
    UnknownCommandError, UnknownOptionError, UsageError, WorkingDirectoryError, encode_failure,
    failure, is_failure_code, translate,
};
pub use failures::{MissingValueForm, ValuelessKind};
pub use host::{
    Child, ChildExit, ChildOutput, ChildProcess, ChildStream, DetachedSpawnOptions, Env, Host,
    HostTerminal, InputStream, InputTerminal, InterruptKeys, InterruptRaised, InterruptSignal,
    KillSignal, Libc, OutputStream, OutputTerminal, ProcessFields, ProcessHandle, ProcessSignal,
    ProcessTerminal, ReadSource, SignalEvent, SignalListener, SignalSource, SpawnOptions,
    SpawnRequest, process_handle, raise_interrupt_keys,
};
pub use inputs::{
    Arg, ArgumentDecl, BooleanOpt, Content, ContentArg, ContentKind, ContentOpt, CountOpt,
    Declarations, DefaultValue, FromInputValue, GlobalInputs, GlobalOptionDecl, InputIdentity,
    InputKind, InputProblem, InputValues, Inputs, IntoInputValue, IsType, Issue, NoInputs,
    OmissionValidator, Opt, OptionDecl, PathSegment, Polarity, Required, Stdin, StringArg,
    StringOpt, SuppliedInputs, SuppliedValue, ValidationContext, ValidationFacts, ValidationPhase,
    Validator, ValueLink, assert_string_input, assert_validator_output, issue_path,
    missing_input_error, question_validation_context, validate_linked_value, validation_context,
};
pub use inspection::{
    ArgumentNode, BooleanOptionNode, CommandGraph, CommandNode, ConfigurationNode,
    ContentOptionNode, ContentType, CountOptionNode, DeclaredDefault, InputSchema, OptionGroup,
    OptionGroupKind, OptionNode, PassthroughNode, ResultKindName, ResultNode, StdinNode,
    StringOptionNode, WordPosition, locate, reported_spelling,
};
pub use inspection::{JSON_SCHEMA_DIALECT, with_schema_dialect};
pub use invocation::{
    Context, IntoOutcome, InvocationOutcome, InvocationValues, InvokeFailure, InvokeOptions,
    InvokedBy, Outcome,
};
pub use marks::{Background, RequiredWhen};
pub use output::{
    AnyDeclaredView, Declare, DeclaredRowView, DeclaredView, EndState, IncompleteResult,
    IntoRendered, Log, LogApplication, LogDefect, LogDestination, LogEvent, LogFields, LogLevel,
    Message, NoResult, Out, OverrideKey, ProgressEvent, ProgressReport, ProgressState, Region,
    RegionCloser, RegionOptions, Render, ResultKind, ResultTransform, ResultView, ResultViews,
    RowSource, RowView, RowViewEntry, RowViews, RowsResult, ValueResult, View, ViewContext,
    ViewContribution, ViewOverride, WholeView, incomplete_result, lanes, override_view, view,
};
pub use plugins::{
    Activation, AnyExtension, AnyPlugin, AnyProvider, ArgumentTarget, AttachedCommand,
    AttachedViews, ChainOutcome, Collect, Collecting, CommandTarget, ConfigurationSource,
    EnvironmentAdditions, EnvironmentContext, Ephemeral, Extension, ExtensionCarrier,
    ExtensionTarget, ExtensionValue, FailureHookContext, Hints, IntoHints, Lifetime,
    MiddlewareContext, Next, NoOptions, OptionTarget, OwnOptions, Persistent, PersistentProvider,
    Plugin, Provider, ProviderContext, Request, Single, SourceAnswer, SourceContext, SourceValue,
    Spellings, read_extension,
};
pub use shipping::{
    ApplicationDirectory, Build, DirectoryFacts, DirectoryLookup, Installation, Release,
    ReleaseFacts, application_directory,
};
pub use signals::{
    CancellationReason, CancellationSource, EndingSignal, Registration, RunSignal, ShutdownCause,
    ShutdownEvent, on_resume, on_shutdown, on_suspend,
};
pub use style::{
    AdaptiveStyle, Alignment, BackgroundPolicy, ColorChoice, ContextualStyle, Glyph, Palette,
    RenderingPolicy, Style, StyleError, Switch, TerminalControls, Theme, ThemeMapping, ThemeValue,
    adaptive, escape, nowrap, pad, style, width,
};
pub use support::{
    BoxFuture, IntoList, escape_control_characters, is_declared_name, is_portable_name,
    is_prose_line, split_lines,
};
