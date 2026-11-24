//! Ports `text.test.ts`. `text()` rejects the empty string, and the reference's
//! `text({ minLength: 0 })` is `text().min_length(0)`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_validators::{Text, text};
use serde_json::json;
use support::{accepted, conforms, fault_text, published, rejected_with, rejection, verdict};

#[test]
fn accepted_tokens_pass_unchanged_and_satisfy_the_published_schema() {
    let cases: Vec<(&str, Text, &str)> = vec![
        ("text() a letter", text(), "a"),
        ("text() a phrase", text(), "hello world"),
        ("text() one astral code point", text(), "\u{1F600}"),
        ("text() the last code point", text(), "\u{10FFFF}"),
        ("minLength 0 the empty string", text().min_length(0), ""),
        (
            "exactly 0 characters the empty string",
            text().length(0),
            "",
        ),
        (
            "maxLength 2 two astral code points",
            text().max_length(2),
            "\u{1F600}\u{1F600}",
        ),
        (
            "minLength 3 three astral code points",
            text().min_length(3),
            "\u{1F600}\u{1F600}\u{1F600}",
        ),
        (
            "exactly 2 astral code points",
            text().min_length(2).max_length(2),
            "\u{1D49C}\u{1D49C}",
        ),
        (
            "an anchored pattern",
            text().pattern("^[a-z]+$", "Expected letters."),
            "abc",
        ),
        (
            "a pattern that needs the u flag",
            text().pattern(r"^\p{L}+$", "Expected letters."),
            "\u{e9}\u{df}",
        ),
        (
            "a dot matches one astral code point",
            text().pattern("^.$", "Expected one character."),
            "\u{1F600}",
        ),
        (
            "an unanchored pattern matches anywhere",
            text().pattern("b", "Expected a b."),
            "abc",
        ),
    ];
    for (name, validator, token) in cases {
        assert_eq!(accepted(&validator, token), token, "{name}");
        assert!(conforms(&validator, &json!(token)), "{name}");
    }
}

#[test]
fn rejected_tokens_read_the_one_sentence_for_the_configuration() {
    let lower = "^[a-z]+$";
    let long = "x".repeat(33);
    let cases: Vec<(&str, Text, &str, &str)> = vec![
        (
            "text() the empty string",
            text(),
            "",
            "Expected a nonempty value.",
        ),
        (
            "minLength 2 one letter",
            text().min_length(2),
            "z",
            "Expected at least 2 characters.",
        ),
        (
            "minLength 2 one astral code point",
            text().min_length(2),
            "\u{1F600}",
            "Expected at least 2 characters.",
        ),
        (
            "minLength 0, maxLength 3, four letters",
            text().min_length(0).max_length(3),
            "abcd",
            "Expected at most 3 characters.",
        ),
        (
            "minLength 0, maxLength 3, four astral code points",
            text().min_length(0).max_length(3),
            "\u{1F600}\u{1F600}\u{1F600}\u{1F600}",
            "Expected at most 3 characters.",
        ),
        (
            "minLength 0, maxLength 1",
            text().min_length(0).max_length(1),
            "ab",
            "Expected at most 1 character.",
        ),
        (
            "minLength equal to maxLength",
            text().length(8),
            "short",
            "Expected exactly 8 characters.",
        ),
        (
            "minLength equal to maxLength of 1",
            text().length(1),
            "ab",
            "Expected exactly 1 character.",
        ),
        (
            "maxLength 32 the empty string",
            text().max_length(32),
            "",
            "Expected from 1 through 32 characters.",
        ),
        (
            "maxLength 32 thirty-three letters",
            text().max_length(32),
            &long,
            "Expected from 1 through 32 characters.",
        ),
        (
            "a pattern with a message",
            text().pattern(lower, "Expected lowercase letters."),
            "ABC",
            "Expected lowercase letters.",
        ),
        (
            "a token that fails length and pattern reads the length sentence",
            text()
                .max_length(3)
                .pattern(lower, "Expected lowercase letters."),
            "ABCDE",
            "Expected from 1 through 3 characters.",
        ),
        (
            "the empty string under a pattern reads the length sentence",
            text().pattern(lower, "Expected lowercase letters."),
            "",
            "Expected a nonempty value.",
        ),
        (
            "a dot",
            text().pattern("^.$", "Expected one character."),
            "ab",
            "Expected one character.",
        ),
    ];
    for (name, validator, token, message) in cases {
        assert_eq!(
            rejection(&validator, token),
            rejected_with(message),
            "{name}"
        );
    }
}

#[test]
fn text_publishes_minlength_1_and_nothing_else() {
    assert_eq!(
        published(&text()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1}"#
    );
}

#[test]
fn a_max_length_alone_keeps_the_default_floor_in_its_issue() {
    // The reference's boundedIssue reads `min` after its default, so a token outside a bare
    // `maxLength` reads the range sentence and parameters, the empty string included.
    let validator = text().max_length(4);
    for token in ["", "abcde"] {
        let issues = verdict(&validator, token).unwrap_err();
        assert_eq!(issues.len(), 1);
        assert_eq!(
            issues[0].code.as_deref(),
            Some("@loomcli/validators/text-length-range")
        );
        assert_eq!(issues[0].params, Some(json!({"max": 4, "min": 1})));
        assert_eq!(issues[0].message, "Expected from 1 through 4 characters.");
    }
}

#[test]
fn text_publishes_each_bound_and_the_pattern_source() {
    let validator = text()
        .min_length(0)
        .max_length(32)
        .pattern("^[a-z]+$", "Expected lowercase letters.");
    assert_eq!(
        published(&validator),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":0,"maxLength":32,"pattern":"^[a-z]+$"}"#
    );
    let anchored = text().max_length(8).pattern("^a", "Expected a leading a.");
    assert_eq!(
        published(&anchored),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1,"maxLength":8,"pattern":"^a"}"#
    );
}

#[test]
fn an_option_that_can_never_work_panics_at_the_call() {
    let cases: Vec<(&str, Box<dyn Fn() -> Text>, &str)> = vec![
        (
            "min_length above max_length",
            Box::new(|| text().max_length(2).min_length(5)),
            "text() min_length 5 is above max_length 2. Supply a min_length at or below max_length.",
        ),
        (
            "max_length below min_length",
            Box::new(|| text().min_length(5).max_length(2)),
            "text() min_length 5 is above max_length 2. Supply a min_length at or below max_length.",
        ),
        (
            "the default min_length above max_length",
            Box::new(|| text().max_length(0)),
            "text() min_length 1 is above max_length 0. Supply a min_length at or below max_length.",
        ),
        (
            "a pattern the regex crate cannot compile (lookahead)",
            Box::new(|| text().pattern("^(?=a)a$", "Expected a.")),
            "text() pattern does not compile with the regex crate. Supply a pattern the regex crate compiles, with no lookaround and no backreference.",
        ),
        (
            "a pattern with a backreference",
            Box::new(|| text().pattern(r"(a)\1", "Expected a pair.")),
            "text() pattern does not compile with the regex crate. Supply a pattern the regex crate compiles, with no lookaround and no backreference.",
        ),
        (
            "an inline flag",
            Box::new(|| text().pattern("(?i)^abc$", "Expected abc.")),
            "text() pattern is not ECMAScript syntax. Supply a pattern a JavaScript u-flag RegExp accepts, with no inline flags, no \\A or \\z, and no POSIX classes.",
        ),
        (
            "a pattern with an empty message",
            Box::new(|| text().pattern("a", "")),
            "text() pattern message is empty. Supply the one sentence that says what the pattern accepts.",
        ),
    ];
    for (name, call, message) in cases {
        assert_eq!(fault_text(call), message, "{name}");
    }
}

#[test]
fn a_text_fault_names_its_rule_and_marks_the_argument() {
    let fault = support::fault_of(|| text().max_length(0)).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/bounds-order");
    assert!(
        fault.message.contains("text().max_length(0)\n"),
        "{}",
        fault.message
    );
    let fault = support::fault_of(|| text().pattern("(", "Expected x.")).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/invalid-pattern");
}

#[test]
fn the_reference_pattern_flags_have_no_counterpart_but_the_pattern_is_unicode() {
    // `\p{L}` and a dot over an astral code point read as the reference's `u` flag reads them.
    let letters = text().pattern(r"^\p{L}+$", "Expected letters.");
    assert!(verdict(&letters, "\u{e9}\u{df}").is_ok());
    assert!(verdict(&letters, "1").is_err());
}

#[test]
fn a_pattern_matches_as_the_published_ecmascript_pattern_does() {
    let digits = text().pattern(r"^\d+$", "Expected digits.");
    assert!(verdict(&digits, "123").is_ok());
    assert!(verdict(&digits, "\u{663}\u{664}").is_err());
    let word = text().pattern(r"^\w+$", "Expected a word.");
    assert!(verdict(&word, "caf\u{e9}").is_err());
    let any = text().pattern("^.$", "Expected one character.");
    assert!(verdict(&any, "\u{2028}").is_err());
    assert_eq!(
        published(&digits),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1,"pattern":"^\\d+$"}"#
    );
}
