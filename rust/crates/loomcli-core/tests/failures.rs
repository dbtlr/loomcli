//! Failure classes, failure codes, exit codes, the error type, translators, and encoders through
//! the public API. Ported from the reference's `failure-codes.test.ts`, `exit-codes.test.ts`,
//! `failure-code-grammar.test.ts`, `failures.test.ts`, and `errors.test.ts`, the cases that need
//! no run.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_core::{
    AttachedValueRefusal, DeclarationError, DiagnosticParts, EX_CANTCREAT, EX_CONFIG, EX_DATAERR,
    EX_IOERR, EX_NOHOST, EX_NOINPUT, EX_NOPERM, EX_NOUSER, EX_OSERR, EX_OSFILE, EX_PROTOCOL,
    EX_SOFTWARE, EX_TEMPFAIL, EX_UNAVAILABLE, EX_USAGE, Error, ExitCode, Failure, FailureClass,
    FailureExitCode, FailureFacts, FatalError, InputError, InternalError, LoomError,
    MisplacedOptionError, MissingValueError, MissingValueForm, NonCallableCommandError,
    RepeatedOptionError, ResultError, ResultFault, TerminalUnavailableError,
    UnexpectedArgumentError, UnexpectedValueError, UnknownCommandError, UnknownOptionError,
    UsageError, WorkingDirectoryError, diagnostic_rule, encode_failure, is_failure_code,
};

/// jsonkit's `PathNotFoundError`, which declares a failure code and an exit code.
#[derive(Debug, Failure)]
#[failure(code = "path-not-found", exit_code = EX_DATAERR)]
struct PathNotFoundError {
    #[failure(base)]
    base: FatalError,
}

/// A subclass of `PathNotFoundError` that declares nothing itself.
#[derive(Debug, Failure)]
struct NestedPathError {
    #[failure(base)]
    base: PathNotFoundError,
}

/// A `FatalError` subclass that declares nothing.
#[derive(Debug, Failure)]
struct BareError {
    #[failure(base)]
    base: FatalError,
}

/// A direct `LoomError` subclass that declares nothing.
#[derive(Debug, Failure)]
struct DirectError {
    #[failure(base)]
    base: LoomError,
}

/// The documentation's `RegistryUnavailableError`, which declares `EX_UNAVAILABLE`.
#[derive(Debug, Failure)]
#[failure(exit_code = EX_UNAVAILABLE)]
struct RegistryUnavailableError {
    #[failure(base)]
    base: FatalError,
    status: u16,
}

impl RegistryUnavailableError {
    fn new(status: u16) -> Self {
        Self {
            base: FatalError::new(format!("The registry answered {status}.")),
            status,
        }
    }
}

/// A subclass of it that declares nothing.
#[derive(Debug, Failure)]
struct RegistryTimeoutError {
    #[failure(base)]
    base: RegistryUnavailableError,
}

/// A `FatalError` subclass that declares no code.
#[derive(Debug, Failure)]
struct ConfigError {
    #[failure(base)]
    base: FatalError,
}

/// A class that declares 2 without extending `UsageError`.
#[derive(Debug, Failure)]
#[failure(exit_code = 2)]
struct StrictError {
    #[failure(base)]
    base: FatalError,
}

/// An author's `InternalError` subclass that declares a code of its own.
#[derive(Debug, Failure)]
#[failure(code = "oops")]
struct OopsError {
    #[failure(base)]
    base: InternalError,
}

fn codes() -> Vec<(&'static str, &'static str)> {
    fn of<F: Failure>() -> (&'static str, &'static str) {
        let class = F::failure_class();
        (class.name(), class.code())
    }
    vec![
        of::<BareError>(),
        of::<DeclarationError>(),
        of::<DirectError>(),
        of::<FatalError>(),
        of::<InputError>(),
        of::<InternalError>(),
        of::<LoomError>(),
        of::<MisplacedOptionError>(),
        of::<MissingValueError>(),
        of::<NestedPathError>(),
        of::<NonCallableCommandError>(),
        of::<RepeatedOptionError>(),
        of::<ResultError>(),
        of::<TerminalUnavailableError>(),
        of::<UnexpectedArgumentError>(),
        of::<UnexpectedValueError>(),
        of::<UnknownCommandError>(),
        of::<UnknownOptionError>(),
        of::<UsageError>(),
        of::<WorkingDirectoryError>(),
    ]
}

#[test]
fn each_core_class_reads_its_failure_code_without_an_instance_and_an_authors_class_inherits_its_parents()
 {
    assert_eq!(
        codes(),
        vec![
            ("BareError", "fatal"),
            ("DeclarationError", "internal"),
            ("DirectError", "failure"),
            ("FatalError", "fatal"),
            ("InputError", "invalid-input"),
            ("InternalError", "internal"),
            ("LoomError", "failure"),
            ("MisplacedOptionError", "misplaced-option"),
            ("MissingValueError", "missing-value"),
            ("NestedPathError", "path-not-found"),
            ("NonCallableCommandError", "missing-subcommand"),
            ("RepeatedOptionError", "repeated-option"),
            ("ResultError", "internal"),
            ("TerminalUnavailableError", "terminal-unavailable"),
            ("UnexpectedArgumentError", "unexpected-argument"),
            ("UnexpectedValueError", "unexpected-value"),
            ("UnknownCommandError", "unknown-command"),
            ("UnknownOptionError", "unknown-option"),
            ("UsageError", "usage"),
            ("WorkingDirectoryError", "working-directory-unreadable"),
        ]
    );
}

#[test]
fn a_failure_reads_the_code_its_class_declares_or_inherits() {
    let bare = BareError {
        base: FatalError::new("Bare."),
    };
    let direct = DirectError {
        base: LoomError::new("Direct."),
    };
    let nested = NestedPathError {
        base: PathNotFoundError {
            base: FatalError::new("Nested."),
        },
    };
    assert_eq!(
        [bare.code(), direct.code(), nested.code()],
        ["fatal", "failure", "path-not-found"]
    );
    assert_eq!(nested.exit_code(), EX_DATAERR);
}

#[test]
fn an_authors_internal_error_subclass_keeps_its_declared_code_on_the_class() {
    // The failure form reads `internal` for every author fault; the class still declares its own.
    assert_eq!(OopsError::failure_class().code(), "oops");
    assert!(OopsError::failure_class().extends(InternalError::failure_class()));
}

#[test]
fn a_class_reads_its_exit_code_without_an_instance() {
    fn exit<F: Failure>() -> u8 {
        F::failure_class().exit_code().get()
    }
    assert_eq!(
        [
            exit::<ConfigError>(),
            exit::<InputError>(),
            exit::<LoomError>(),
            exit::<RegistryTimeoutError>(),
            exit::<RegistryUnavailableError>(),
            exit::<UsageError>(),
        ],
        [1, 2, 1, 69, 69, 2]
    );
}

#[test]
fn a_declared_code_is_read_on_the_instance_and_a_subclass_exits_with_the_nearest_declared_code() {
    let declared = RegistryUnavailableError::new(503);
    assert_eq!(declared.exit_code().get(), 69);
    assert_eq!(declared.status, 503);
    assert_eq!(declared.message(), "The registry answered 503.");
    let inherited = RegistryTimeoutError {
        base: RegistryUnavailableError::new(504),
    };
    assert_eq!(inherited.exit_code().get(), 69);
    let undeclared = ConfigError {
        base: FatalError::new("Config is unreadable."),
    };
    assert_eq!(undeclared.exit_code().get(), 1);
}

#[test]
fn a_class_that_declares_2_outside_usage_error_is_no_usage_error() {
    let strict: Box<dyn Failure> = Box::new(StrictError {
        base: FatalError::new("Strict mode refused the value."),
    });
    assert_eq!(strict.exit_code().get(), 2);
    assert!(!strict.is::<UsageError>());
    assert!(strict.is::<FatalError>());
}

#[test]
fn core_exports_the_fifteen_sysexits_names_with_their_values() {
    let values = [
        EX_USAGE,
        EX_DATAERR,
        EX_NOINPUT,
        EX_NOUSER,
        EX_NOHOST,
        EX_UNAVAILABLE,
        EX_SOFTWARE,
        EX_OSERR,
        EX_OSFILE,
        EX_CANTCREAT,
        EX_IOERR,
        EX_TEMPFAIL,
        EX_PROTOCOL,
        EX_NOPERM,
        EX_CONFIG,
    ]
    .map(FailureExitCode::get);
    assert_eq!(
        values,
        [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78]
    );
}

#[test]
fn a_failure_exit_code_holds_1_through_125() {
    assert_eq!(FailureExitCode::new(1).get(), 1);
    assert_eq!(FailureExitCode::new(125).get(), 125);
    assert_eq!(ExitCode::from(EX_CONFIG).get(), 78);
    assert_eq!(
        [
            ExitCode::SUCCESS,
            ExitCode::HANGUP,
            ExitCode::INTERRUPT,
            ExitCode::QUIT,
            ExitCode::CLOSED_PIPE,
            ExitCode::TERMINATE,
        ]
        .map(ExitCode::get),
        [0, 129, 130, 131, 141, 143]
    );
}

/// A code read at run time, so the range check runs as a panic rather than at compile time.
fn runtime(code: u8) -> u8 {
    std::hint::black_box(code)
}

#[test]
#[should_panic(expected = "A failure class declares an exit code from 1 through 125.")]
fn a_failure_exit_code_rejects_0() {
    let _ = FailureExitCode::new(runtime(0));
}

#[test]
#[should_panic(expected = "A failure class declares an exit code from 1 through 125.")]
fn a_failure_exit_code_rejects_126() {
    let _ = FailureExitCode::new(runtime(126));
}

#[test]
fn is_failure_code_accepts_the_grammar() {
    for code in ["path-not-found", "http-503", "fatal"] {
        assert!(is_failure_code(code), "{code}");
    }
}

#[test]
fn is_failure_code_rejects_everything_else() {
    for code in ["Path_Not_Found", "", "-x", "a--b", "path not found", "x-"] {
        assert!(!is_failure_code(code), "{code:?}");
    }
}

#[test]
#[should_panic(
    expected = "A failure code is lowercase letters and digits in words joined by single hyphens."
)]
fn a_failure_class_with_a_code_outside_the_grammar_panics_where_it_is_built() {
    let _ = FailureClass::new(
        "RegistryDownError",
        Some(std::hint::black_box("Registry_Down")),
        None,
        None,
    );
}

#[test]
fn each_token_fault_states_what_went_wrong_and_what_to_do() {
    let path = |words: &[&str]| {
        words
            .iter()
            .map(|word| (*word).to_owned())
            .collect::<Vec<_>>()
    };
    let cases: Vec<(Box<dyn Failure>, &str)> = vec![
        (
            Box::new(UnknownCommandError::new("nope", path(&["get", "cache"]))),
            "Unknown command \"nope\". Use one of: get, cache.",
        ),
        (
            Box::new(UnknownCommandError::new("nope", Vec::new())),
            "Unknown command \"nope\". Supply the name of a declared command.",
        ),
        (
            Box::new(NonCallableCommandError::new(
                path(&["cache"]),
                path(&["keys"]),
            )),
            "Command \"cache\" requires a subcommand. Use one of: keys.",
        ),
        (
            Box::new(NonCallableCommandError::new(path(&["cache"]), Vec::new())),
            "Command \"cache\" requires a subcommand. Supply the name of a declared subcommand.",
        ),
        (
            Box::new(NonCallableCommandError::new(Vec::new(), path(&["get"]))),
            "A command is required. Use one of: get.",
        ),
        (
            Box::new(UnexpectedArgumentError::new(
                path(&["get"]),
                1,
                path(&["b"]),
            )),
            "Command \"get\" accepts 1 argument. Remove the extra values.",
        ),
        (
            Box::new(UnexpectedArgumentError::new(
                path(&["get"]),
                2,
                path(&["c"]),
            )),
            "Command \"get\" accepts 2 arguments. Remove the extra values.",
        ),
        (
            Box::new(UnexpectedArgumentError::new(Vec::new(), 0, path(&["x"]))),
            "The root Command accepts no arguments. Remove the supplied values.",
        ),
        (
            Box::new(UnknownOptionError::new("--nope")),
            "Unknown option \"--nope\". Supply a declared option; prefix a hyphenated path with \"./\".",
        ),
        (
            Box::new(MissingValueError::new("-f", MissingValueForm::Separate)),
            "Option \"-f\" requires a value. Supply a value after \"-f\".",
        ),
        (
            Box::new(MissingValueError::new("-f", MissingValueForm::Attached)),
            "Option \"-f\" requires a value. Supply a value after \"-f\", or attach one that starts with a hyphen as \"-f=<value>\".",
        ),
        (
            Box::new(UnexpectedValueError::new(
                "--quiet",
                "1",
                AttachedValueRefusal::Boolean,
            )),
            "Boolean option \"--quiet\" does not accept a value. Supply the flag alone.",
        ),
        (
            Box::new(UnexpectedValueError::new(
                "-v",
                "2",
                AttachedValueRefusal::Count,
            )),
            "Counted option \"-v\" does not accept a value. Repeat \"-v\" to raise its count.",
        ),
        (
            Box::new(RepeatedOptionError::new("-f")),
            "Option \"-f\" can be supplied only once. Remove the repeated option.",
        ),
        (
            Box::new(MisplacedOptionError::new("-m", vec![path(&["get"])])),
            "Option \"-m\" belongs to command \"get\". Supply it after \"get\".",
        ),
        (
            Box::new(MisplacedOptionError::new(
                "-p",
                vec![path(&["get"]), path(&["keys"])],
            )),
            "Option \"-p\" belongs to commands get, keys. Supply it after the command name.",
        ),
        (
            Box::new(MisplacedOptionError::new(
                "-p",
                vec![path(&["cache", "clear"])],
            )),
            "Option \"-p\" belongs to command \"cache clear\". Supply it after \"cache clear\".",
        ),
    ];
    for (failure, message) in cases {
        assert_eq!(failure.message(), message);
        assert_eq!(failure.exit_code().get(), 2);
        assert!(failure.is::<UsageError>());
    }
}

#[test]
fn a_token_fault_keeps_its_facts() {
    let command = UnknownCommandError::new("nope", vec!["get".to_owned(), "cache".to_owned()]);
    assert_eq!(command.token(), "nope");
    assert_eq!(command.candidates(), ["get", "cache"]);
    let group = NonCallableCommandError::new(vec!["cache".to_owned()], vec!["keys".to_owned()]);
    assert_eq!(
        (group.command(), group.candidates()),
        (&["cache".to_owned()][..], &["keys".to_owned()][..])
    );
    let extra = UnexpectedArgumentError::new(vec!["get".to_owned()], 1, vec!["b".to_owned()]);
    assert_eq!(
        (extra.command(), extra.accepted(), extra.extra()),
        (&["get".to_owned()][..], 1, &["b".to_owned()][..])
    );
    let value = UnexpectedValueError::new("--quiet", "1", AttachedValueRefusal::Boolean);
    assert_eq!((value.spelling(), value.value()), ("--quiet", "1"));
    let misplaced = MisplacedOptionError::new("-m", vec![vec!["get".to_owned()]]);
    assert_eq!(misplaced.commands(), [vec!["get".to_owned()]]);
}

/// A right-to-left override, which would reorder the rest of a line on a terminal.
const RIGHT_TO_LEFT: &str = "\u{202e}";

#[test]
fn a_failure_keeps_the_raw_token_while_its_sentence_escapes_it() {
    let command = UnknownCommandError::new(
        format!("a{RIGHT_TO_LEFT}b"),
        vec!["get".to_owned(), "cache".to_owned()],
    );
    assert_eq!(
        command.message(),
        "Unknown command \"a\\u202eb\". Use one of: get, cache."
    );
    assert_eq!(command.token(), format!("a{RIGHT_TO_LEFT}b"));
    let option = UnknownOptionError::new(format!("-{RIGHT_TO_LEFT}"));
    assert_eq!(
        option.message(),
        "Unknown option \"-\\u202e\". Supply a declared option; prefix a hyphenated path with \"./\"."
    );
    assert_eq!(option.spelling(), format!("-{RIGHT_TO_LEFT}"));
}

#[test]
fn a_zero_width_joiner_inside_an_emoji_stays_as_it_is() {
    let developer = "\u{1f469}\u{200d}\u{1f4bb}";
    let command = UnknownCommandError::new(developer, vec!["get".to_owned()]);
    assert_eq!(
        command.message(),
        format!("Unknown command \"{developer}\". Use one of: get.")
    );
}

#[test]
fn the_working_directory_failure_keeps_the_capture_error_as_its_cause() {
    let failure = WorkingDirectoryError::new(std::io::Error::from(std::io::ErrorKind::NotFound));
    assert_eq!(
        failure.message(),
        "The current working directory cannot be read. Change to a directory that exists and run the command again."
    );
    assert_eq!(failure.code(), "working-directory-unreadable");
    assert_eq!(failure.exit_code().get(), 1);
    let cause = failure
        .cause()
        .and_then(Error::foreign)
        .map(ToString::to_string);
    assert_eq!(cause.as_deref(), Some("entity not found"));
}

#[test]
fn a_result_error_names_its_command_and_extends_internal_error() {
    let missing = ResultError::new(ResultFault::Missing, vec!["stats".to_owned()]);
    assert_eq!(
        missing.message(),
        "Command \"stats\" declares a result and its action returned without emitting one. Call out.results() once."
    );
    let repeated = ResultError::new(ResultFault::Repeated, Vec::new());
    assert_eq!(
        repeated.message(),
        "The root Command emitted its result twice. Call out.results() once."
    );
    assert_eq!(
        (repeated.kind(), repeated.path()),
        (ResultFault::Repeated, &[][..])
    );
    let failure: &dyn Failure = &missing;
    let defect = failure
        .downcast_ref::<InternalError>()
        .map(InternalError::rule);
    assert_eq!(
        defect.flatten().map(|rule| rule.identity()),
        Some("@loomcli/core/result-contract")
    );
    assert!(failure.cause().is_none());
    assert_eq!((failure.code(), failure.exit_code().get()), ("internal", 1));
}

#[test]
fn an_input_error_holds_its_problems_and_its_sentence() {
    let failure = InputError::new("Option \"--depth\": Use decimal digits.", Vec::new());
    assert_eq!(failure.message(), "Option \"--depth\": Use decimal digits.");
    assert!(failure.problems().is_empty());
    assert_eq!(
        (failure.code(), failure.exit_code().get()),
        ("invalid-input", 2)
    );
}

#[test]
fn an_error_holds_a_failure_or_a_foreign_error_and_reads_a_failure_by_class() {
    let failure = Error::from(PathNotFoundError {
        base: FatalError::new("Path not found."),
    });
    assert!(failure.foreign().is_none());
    assert!(failure.downcast_failure::<PathNotFoundError>().is_some());
    assert_eq!(
        failure
            .downcast_failure::<FatalError>()
            .map(FailureFacts::message),
        Some("Path not found.")
    );
    assert!(failure.downcast_failure::<UsageError>().is_none());

    let parsed: Result<u8, Error> = "x".parse::<u8>().map_err(Error::from);
    let foreign = parsed.expect_err("an invalid digit");
    assert!(foreign.failure().is_none());
    assert_eq!(
        foreign.foreign().map(ToString::to_string).as_deref(),
        Some("invalid digit found in string")
    );
}

#[test]
fn a_fatal_error_keeps_the_error_it_replaced_as_its_cause() {
    let source = "x".parse::<u8>().expect_err("an invalid digit");
    let failure = FatalError::with_cause("The count is not a number.", source);
    assert!(failure.cause().and_then(Error::foreign).is_some());
    assert!(FatalError::new("Plain.").cause().is_none());
}

#[test]
fn an_internal_error_takes_a_rule_and_keeps_its_sentence_as_its_message() {
    const RETRY_LIMIT: loomcli_core::DiagnosticRule = diagnostic_rule(
        "@acme/retry/retry-limit",
        "Retry limit out of range",
        "Each retry repeats the request against the service.",
    );
    let cause = "x".parse::<u8>().expect_err("an invalid digit");
    let defect = InternalError::new(
        RETRY_LIMIT,
        DiagnosticParts::new("The retry loop broke.").correction("Fix the loop."),
        cause,
    );
    assert_eq!(defect.message(), "The retry loop broke.");
    assert_eq!(defect.sentence(), "The retry loop broke.");
    assert_eq!(defect.correction(), ["Fix the loop."]);
    assert_eq!(
        defect.rule().map(|rule| rule.identity()),
        Some("@acme/retry/retry-limit")
    );
    assert!(defect.cause().is_some());

    let plain = InternalError::message_only("Plain.", "x".parse::<u8>().expect_err("a digit"));
    assert_eq!((plain.message(), plain.sentence()), ("Plain.", "Plain."));
    assert!(plain.rule().is_none());
}

#[test]
fn an_encoding_registers_its_media_type() {
    let encoding = encode_failure("application/json", |form| {
        format!("{{\"error\":\"{}\"}}\n", form.code)
    });
    assert_eq!(encoding.media_type(), "application/json");
}
