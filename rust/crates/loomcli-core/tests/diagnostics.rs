//! Developer Diagnostics, diagnostic rules, findings, and the name predicates through the public
//! API. Ported from the reference's `developer-diagnostics.test.ts` (rendering),
//! `rule-identity.test.ts`, and `name-predicates.test.ts` (the predicates).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_core::{
    DeclarationError, DiagnosticParts, DiagnosticRule, Failure, FailureFacts, Finding, Literal,
    diagnostic_rule, is_declared_name, is_portable_name, is_prose_line, is_rule_identity,
};

/// The fixture plugin's rule from core's reference.
const RETRY_LIMIT: DiagnosticRule = diagnostic_rule(
    "@acme/retry/retry-limit",
    "Retry limit out of range",
    "Each retry repeats the request against the service, so a large limit can hold the terminal for minutes. The plugin accepts from 0 through 10 retries.",
);

/// A rule with a docs link.
const COLLISION: DiagnosticRule = diagnostic_rule(
    "@acme/trace/option-collision",
    "Option declared twice",
    "One key names one option, so two declarations of it leave a run unable to tell them apart.",
)
.docs("https://example.com/rules/option-collision");

/// The fixture plugin factory core's reference shows, which checks its own argument.
fn retry(limit: u32) -> Result<u32, DeclarationError> {
    if limit > 10 {
        return Err(DeclarationError::new(
            RETRY_LIMIT,
            DiagnosticParts::new(format!("retry() received {limit} retries."))
                .finding(
                    Finding::new("retry", vec![Literal::from(limit)])
                        .mark("0")
                        .note("from 0 through 10"),
                )
                .correction("Pass a whole number from 0 through 10."),
        ));
    }
    Ok(limit)
}

fn retry_fault() -> DeclarationError {
    retry(50).expect_err("50 retries is out of range")
}

#[test]
fn a_third_party_rules_fault_carries_its_whole_diagnostic_in_its_message() {
    assert_eq!(
        retry_fault().message(),
        [
            "-- RETRY LIMIT OUT OF RANGE ---------------------------- @acme/retry/retry-limit",
            "",
            "retry() received 50 retries.",
            "",
            "    retry(50)",
            "          ^^ from 0 through 10",
            "",
            "Each retry repeats the request against the service, so a large limit can hold",
            "the terminal for minutes. The plugin accepts from 0 through 10 retries.",
            "",
            "Pass a whole number from 0 through 10.",
        ]
        .join("\n")
    );
    assert_eq!(retry_fault().diagnostic(None), retry_fault().message());
}

#[test]
fn a_structured_fault_keeps_its_parts_on_fields_of_their_own() {
    let fault = retry_fault();
    assert_eq!(
        fault.correction(),
        ["Pass a whole number from 0 through 10."]
    );
    assert_eq!(fault.exit_code().get(), 1);
    assert_eq!(fault.class().name(), "DeclarationError");
    assert_eq!(fault.rule(), Some(&RETRY_LIMIT));
    assert_eq!(fault.sentence(), "retry() received 50 retries.");
    let [finding] = fault.findings() else {
        panic!("one finding");
    };
    assert_eq!(finding.call_name(), "retry");
    assert_eq!(finding.arguments(), [Literal::Number(50.0)]);
    assert_eq!(finding.marked(), Some("0"));
    assert_eq!(finding.noted(), Some("from 0 through 10"));
    assert_eq!(finding.command_path(), None);
}

#[test]
fn a_sentence_only_fault_renders_the_generic_banner_and_its_sentence_alone() {
    let fault = DeclarationError::sentence_only(
        "Plugin \"@acme/trace\" received a level of 9. Pass a level from 0 through 3.",
    );
    assert_eq!(
        fault.message(),
        [
            "-- INVALID DECLARATION ---------------------------------------------------------",
            "",
            "Plugin \"@acme/trace\" received a level of 9. Pass a level from 0 through 3.",
        ]
        .join("\n")
    );
    let fields = DeclarationError::sentence_only("One sentence.")
        .with_cause("x".parse::<u8>().expect_err("an invalid digit"));
    assert!(fields.cause().is_some());
    assert!(fields.correction().is_empty());
    assert!(fields.findings().is_empty());
    assert!(fields.rule().is_none());
    assert_eq!(fields.sentence(), "One sentence.");
}

#[test]
fn a_fault_between_two_declarations_carries_a_finding_for_each_and_a_correction_list_prints_one_fix_per_line()
 {
    let fault = DeclarationError::new(
        COLLISION,
        DiagnosticParts::new(
            "Option \"verbose\" is declared by plugin \"@acme/trace\" and as a local option on Command \"get\".",
        )
        .finding(
            Finding::new(
                "trace",
                vec![
                    Literal::builder("TraceSettings::new()")
                        .call("option", vec!["verbose".into(), Literal::builder("Opt::boolean()")]),
                ],
            )
            .mark("0.option")
            .note("the plugin's global option"),
        )
        .finding(
            Finding::new(
                "option",
                vec![
                    "verbose".into(),
                    Literal::builder("Opt::string()").call("validate", vec![Literal::Opaque]),
                ],
            )
            .mark("0")
            .note("the local option")
            .path(vec!["get".to_owned()]),
        )
        .correction("Rename the local option.")
        .correction("Install the plugin without its verbose option."),
    );
    assert_eq!(
        fault.message(),
        [
            "-- OPTION DECLARED TWICE -------------------------- @acme/trace/option-collision",
            "",
            "Option \"verbose\" is declared by plugin \"@acme/trace\" and as a local option on Command \"get\".",
            "",
            "    trace(TraceSettings::new().option(\"verbose\", Opt::boolean()))",
            "                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ the plugin's global option",
            "",
            "    // get",
            "    Command::new(\"get\")",
            "      .option(\"verbose\", Opt::string().validate(…))",
            "              ^^^^^^^^^ the local option",
            "",
            "One key names one option, so two declarations of it leave a run unable to tell",
            "them apart.",
            "",
            "- Rename the local option.",
            "- Install the plugin without its verbose option.",
            "",
            "See https://example.com/rules/option-collision",
        ]
        .join("\n")
    );
}

#[test]
fn a_finding_on_the_root_names_the_application_receiver() {
    let fault = DeclarationError::new(
        RETRY_LIMIT,
        DiagnosticParts::new("One sentence.").finding(
            Finding::new(
                "argument",
                vec!["path".into(), Literal::builder("Arg::string()")],
            )
            .mark("1")
            .path(Vec::new()),
        ),
    );
    assert!(fault.message().contains(
        "\n\n    Application::new(…)\n      .argument(\"path\", Arg::string())\n                        ^^^^^^^^^^^^^\n\n"
    ));
}

#[test]
fn a_finding_prints_each_literal_as_the_rust_an_author_wrote() {
    let printed = [
        Literal::from("say \"hi\" \\ there"),
        Literal::from('\''),
        Literal::from(-0.0),
        Literal::from(0.5),
        Literal::from(true),
        Literal::from(vec!["a", "b"]),
        Literal::from(Vec::<Literal>::new()),
        Literal::builder("Opt::string()")
            .call("short", vec!['F'.into()])
            .call("multiple", Vec::new()),
        Literal::Opaque,
    ]
    .map(|literal| literal.to_string());
    assert_eq!(
        printed,
        [
            "\"say \\\"hi\\\" \\\\ there\"",
            "'\\''",
            "-0",
            "0.5",
            "true",
            "[\"a\", \"b\"]",
            "[]",
            "Opt::string().short('F').multiple()",
            "…",
        ]
    );
}

#[test]
fn a_finding_prints_a_value_nested_past_four_containers_as_an_ellipsis() {
    let nested = Literal::List(vec![Literal::List(vec![Literal::List(vec![
        Literal::List(vec![Literal::List(vec![Literal::from(1)])]),
    ])])]);
    assert_eq!(nested.to_string(), "[[[[…]]]]");
}

#[test]
fn a_mark_underlines_a_list_member_or_a_setters_argument() {
    let fault = DeclarationError::new(
        RETRY_LIMIT,
        DiagnosticParts::new("One sentence.")
            .finding(
                Finding::new("aliases", vec![Literal::from(vec!["one", "two"])])
                    .mark("0.1")
                    .note("the second"),
            )
            .finding(
                Finding::new(
                    "option",
                    vec![
                        "x".into(),
                        Literal::builder("Opt::string()").call("short", vec!['F'.into()]),
                    ],
                )
                .mark("1.short.0"),
            ),
    );
    let message = fault.message();
    assert!(
        message.contains("    aliases([\"one\", \"two\"])\n                    ^^^^^ the second\n")
    );
    assert!(message.contains(
        "    option(\"x\", Opt::string().short('F'))\n                                    ^^^\n"
    ));
}

#[test]
fn a_mark_that_names_no_part_prints_no_caret_line() {
    let fault = DeclarationError::new(
        RETRY_LIMIT,
        DiagnosticParts::new("One sentence.")
            .finding(Finding::new("retry", vec![Literal::from(50)]).mark("3")),
    );
    assert!(fault.message().contains("\n\n    retry(50)\n\nEach retry"));
}

#[test]
fn a_diagnostic_escapes_every_control_line_separator_and_bidirectional_control_it_repeats() {
    let fault = DeclarationError::new(
        RETRY_LIMIT,
        DiagnosticParts::new("retry() received \"a\u{202e}b\nc\".")
            .finding(Finding::new("retry", vec!["a\u{202e}b\nc".into()])),
    );
    let text = fault.message();
    // The author's own line break in a sentence stays a break; every other control is escaped.
    assert!(text.contains("retry() received \"a\\u202eb\nc\"."));
    assert!(text.contains("    retry(\"a\\u{202e}b\\nc\")"));
    assert!(!text.contains('\u{202e}'));
}

#[test]
fn diagnostic_rule_returns_its_parts() {
    assert_eq!(
        (
            COLLISION.docs_url(),
            COLLISION.headline(),
            COLLISION.identity(),
            RETRY_LIMIT.docs_url(),
        ),
        (
            Some("https://example.com/rules/option-collision"),
            "Option declared twice",
            "@acme/trace/option-collision",
            None,
        )
    );
    assert_eq!(
        COLLISION.explanation(),
        "One key names one option, so two declarations of it leave a run unable to tell them apart."
    );
}

#[test]
fn diagnostic_rule_accepts_subpath_segments_between_the_package_and_the_rule_name() {
    const BACKOFF: DiagnosticRule = diagnostic_rule("@acme/retry/backoff/retry-limit", "H", "E.");
    assert_eq!(BACKOFF.identity(), "@acme/retry/backoff/retry-limit");
}

#[test]
fn diagnostic_rule_rejects_an_identity_outside_the_grammar() {
    for identity in [
        "Retry Limit",
        "@acme/retry/Retry-Limit",
        "retry-limit",
        "@acme/retry//retry-limit",
        "@acme/retry/Backoff/retry-limit",
        "@acme/retry/backoff/",
    ] {
        assert!(!is_rule_identity(identity), "{identity}");
    }
}

#[test]
#[should_panic(
    expected = "A rule identity is a package name, optional subpath segments, and a kebab-case rule name."
)]
fn diagnostic_rule_panics_for_an_identity_outside_the_grammar_at_run_time() {
    let _ = diagnostic_rule(std::hint::black_box("Retry Limit"), "H", "E.");
}

#[test]
fn is_rule_identity_accepts_an_identity_followed_by_a_kebab_case_rule_name() {
    assert!(is_rule_identity("@a/b/c-d"));
    assert!(is_rule_identity("pkg/rule"));
}

#[test]
fn is_rule_identity_rejects_a_value_with_no_rule_name_a_rule_name_outside_kebab_case_and_an_empty_segment()
 {
    for value in ["pkg", "@a/b", "pkg/Rule", "pkg//r"] {
        assert!(!is_rule_identity(value), "{value}");
    }
}

#[test]
fn a_rule_identity_rejects_a_tilde_in_its_package_name_as_npm_does() {
    assert!(!is_rule_identity("~x/rule"));
    assert!(!is_rule_identity("a~b/rule"));
}

#[test]
fn a_rule_identitys_package_name_holds_at_most_214_characters_and_its_segments_do_not_count() {
    let named = |length: usize| "a".repeat(length);
    let scoped = |length: usize| format!("@{}/{}", "s".repeat(9), "n".repeat(length - 11));
    let segments = format!("/{}/{}", "p".repeat(100), "q".repeat(100));
    assert!(is_rule_identity(&format!("{}/rule", named(214))));
    assert!(!is_rule_identity(&format!("{}/rule", named(215))));
    assert!(is_rule_identity(&format!("{}{segments}", scoped(214))));
    assert!(!is_rule_identity(&format!("{}/rule", scoped(215))));
}

#[test]
fn the_banner_fills_the_width_and_the_explanation_wraps_at_it() {
    let at_100 = retry_fault().diagnostic(Some(100));
    assert_eq!(
        at_100.split('\n').next(),
        Some(
            format!(
                "-- RETRY LIMIT OUT OF RANGE {} @acme/retry/retry-limit",
                "-".repeat(48)
            )
            .as_str()
        )
    );
    assert!(at_100.contains(
        "\n\nEach retry repeats the request against the service, so a large limit can hold the terminal for\nminutes. The plugin accepts from 0 through 10 retries.\n\n"
    ));

    let at_60 = retry_fault().diagnostic(Some(60));
    assert_eq!(
        at_60.split('\n').next(),
        Some(
            format!(
                "-- RETRY LIMIT OUT OF RANGE {} @acme/retry/retry-limit",
                "-".repeat(8)
            )
            .as_str()
        )
    );
    assert!(at_60.contains(
        "\nEach retry repeats the request against the service, so a\nlarge limit can hold the terminal for minutes. The plugin\naccepts from 0 through 10 retries.\n"
    ));

    let at_80 = retry_fault().diagnostic(None);
    assert_eq!(
        at_80.split('\n').next().map(|line| line.chars().count()),
        Some(80)
    );
    assert!(at_80.starts_with(&format!(
        "-- RETRY LIMIT OUT OF RANGE {} @acme/retry/retry-limit",
        "-".repeat(28)
    )));
}

#[test]
fn a_banner_keeps_two_hyphens_when_the_width_is_too_narrow() {
    let narrow = retry_fault().diagnostic(Some(20));
    assert_eq!(
        narrow.split('\n').next(),
        Some("-- RETRY LIMIT OUT OF RANGE -- @acme/retry/retry-limit")
    );
}

#[test]
fn the_explanation_wraps_by_display_width_so_wide_characters_fill_two_columns() {
    const WIDE: DiagnosticRule = diagnostic_rule(
        "@acme/wide/wide-words",
        "Wide words",
        "界界界界界 界界界界界 界界界界界",
    );
    let fault = DeclarationError::new(WIDE, DiagnosticParts::new("The words are wide."));
    assert!(
        fault
            .diagnostic(Some(25))
            .contains("\n界界界界界 界界界界界\n界界界界界")
    );
}

#[test]
fn is_portable_name_accepts_the_posix_portable_filename_set_and_rejects_a_leading_hyphen_or_dot() {
    assert_eq!(
        ["build", "Build_2", "a.b-c", "_x"].map(is_portable_name),
        [true; 4]
    );
    assert_eq!(
        ["", "-x", ".x", "a b", "a/b", "é"].map(is_portable_name),
        [false; 6]
    );
}

#[test]
fn is_declared_name_accepts_a_bare_token_and_rejects_an_empty_name_a_leading_hyphen_whitespace_and_equals()
 {
    assert_eq!(
        ["verbose", "dry-run", "a.b", "é", "1"].map(is_declared_name),
        [true; 5]
    );
    assert_eq!(
        ["", "-v", "a b", "a=b", "a\tb", "a\u{3000}b", "a\u{feff}b"].map(is_declared_name),
        [false; 7]
    );
    // JavaScript's `\s` holds no NEL, so a name with one is declared.
    assert!(is_declared_name("a\u{85}b"));
}

#[test]
fn is_prose_line_holds_a_character_other_than_whitespace_and_no_line_terminator() {
    assert_eq!(
        ["One line.", " x ", "\u{200b}", "a\u{a0}b"].map(is_prose_line),
        [true; 4]
    );
    assert_eq!(
        [
            "",
            "   ",
            "\u{a0}",
            "a\nb",
            "a\rb",
            "a\u{b}b",
            "a\u{c}b",
            "a\u{85}b",
            "a\u{2028}b",
            "a\u{2029}b"
        ]
        .map(is_prose_line),
        [false; 10]
    );
}
