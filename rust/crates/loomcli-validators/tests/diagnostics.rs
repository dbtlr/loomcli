//! Ports `catalog-diagnostics.test.ts`: each declaration fault panics from its call with its
//! rule's Developer Diagnostic, and a finding rebuilds the call and marks the argument at fault.
//! The reference's `context-outside-run`, `issue-code-name`, and `issue-parameters` scenarios
//! differ: a Rust validator always has its context, a bad code is a compile error in a constant,
//! and the catalog code's own check rejects parameters.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use std::collections::BTreeSet;

use loomcli_core::{Issue, ValidationContext};
use loomcli_validators::{
    bytes, create_validator, date, date_time, duration, integer, key_value, number, one_of, text,
    time, url,
};
use support::fault_of;

struct Expected {
    scenario: &'static str,
    call: fn(),
    rule: &'static str,
    sentence: &'static str,
    correction: &'static str,
}

const CASES: &[Expected] = &[
    Expected {
        scenario: "bound-value",
        call: || drop(number().min(f64::INFINITY)),
        rule: "bound-value",
        sentence: "number() min is not a finite number.",
        correction: "Supply a finite number.",
    },
    Expected {
        scenario: "bounds-order",
        call: || drop(integer().max(1).min(5)),
        rule: "bounds-order",
        sentence: "integer() min 5 is above max 1.",
        correction: "Supply a min at or below max.",
    },
    Expected {
        scenario: "bytes-bound-value",
        call: || drop(bytes().max("10M")),
        rule: "bound-value",
        sentence: "bytes() max is not a size.",
        correction: "Supply a size such as \"1MB\" or \"10GiB\".",
    },
    Expected {
        scenario: "bytes-bounds-order",
        call: || drop(bytes().max("1MB").min("10GiB")),
        rule: "bounds-order",
        sentence: "bytes() min 10GiB is above max 1MB.",
        correction: "Supply a min at or below max.",
    },
    Expected {
        scenario: "bytes-min-bound-value",
        call: || drop(bytes().min("1.5B")),
        rule: "bound-value",
        sentence: "bytes() min is not a size.",
        correction: "Supply a size such as \"1MB\" or \"10GiB\".",
    },
    Expected {
        scenario: "duration-bound-value",
        call: || drop(duration().min("abc")),
        rule: "bound-value",
        sentence: "duration() min is not a duration.",
        correction: "Supply a duration such as \"30s\" or \"2h30m\".",
    },
    Expected {
        scenario: "duration-bounds-order",
        call: || drop(duration().max("30s").min("1h")),
        rule: "bounds-order",
        sentence: "duration() min 1h is above max 30s.",
        correction: "Supply a min at or below max.",
    },
    Expected {
        scenario: "input-schema",
        call: || {
            let mut schema = serde_json::Map::new();
            schema.insert("$schema".into(), "x".into());
            schema.insert("type".into(), "string".into());
            drop(
                create_validator(|raw: &str, _context: &ValidationContext| {
                    Ok::<String, Vec<Issue>>(raw.to_owned())
                })
                .input_schema(schema),
            );
        },
        rule: "input-schema",
        sentence: "create_validator() input_schema declares its own $schema.",
        correction: "Leave out $schema, which the validator publishes itself.",
    },
    Expected {
        scenario: "issue-parameters",
        call: || {
            drop(
                loomcli_validators::codes::TIME_MIN_ISSUE
                    .issue(loomcli_validators::codes::Min { min: 86_400_000 }),
            )
        },
        rule: "issue-parameters",
        sentence: "Issue code \"@loomcli/validators/time-min\" rejects the parameters passed to issue().",
        correction: "Supply parameters its code accepts.",
    },
    Expected {
        scenario: "key-value-separator",
        call: || drop(key_value().separator(" ")),
        rule: "key-value-separator",
        sentence: "key_value() separator holds whitespace.",
        correction: "Supply one character or more with no whitespace, such as \"=\" or \":\".",
    },
    Expected {
        scenario: "key-value-separator-empty",
        call: || drop(key_value().separator("")),
        rule: "key-value-separator",
        sentence: "key_value() separator is empty.",
        correction: "Supply one character or more with no whitespace, such as \"=\" or \":\".",
    },
    Expected {
        scenario: "layout-empty",
        call: || drop(date().layouts([""])),
        rule: "layout",
        sentence: "date() layouts lists an empty layout.",
        correction: "Supply a layout such as \"%d/%m/%Y\".",
    },
    Expected {
        scenario: "layout-literal-zone",
        call: || drop(date_time().layouts(["%d/%m/%Y %H:%M", "%Y%m%dT%H%M%SZ"])),
        rule: "layout",
        sentence: "date_time() layout \"%Y%m%dT%H%M%SZ\" holds a literal Z, which would read a UTC time as local time.",
        correction: "Write %z, which reads Z as UTC and every other offset as that offset.",
    },
    Expected {
        scenario: "layout-lone-percent",
        call: || drop(time().layouts(["%H:%M%"])),
        rule: "layout",
        sentence: "time() layout \"%H:%M%\" ends with a lone %.",
        correction: "Write %% for a percent sign.",
    },
    Expected {
        scenario: "layout-meridiem-alone",
        call: || drop(time().layouts(["%H:%M%p"])),
        rule: "layout",
        sentence: "time() layout \"%H:%M%p\" holds %p without %I.",
        correction: "Write %I for an hour from 1 through 12, or leave out %p.",
    },
    Expected {
        scenario: "layout-missing-field",
        call: || drop(date().layouts(["%d/%m"])),
        rule: "layout",
        sentence: "date() layout \"%d/%m\" holds no year.",
        correction: "Add %Y.",
    },
    Expected {
        scenario: "layout-twelve-hour-alone",
        call: || drop(time().layouts(["%I:%M"])),
        rule: "layout",
        sentence: "time() layout \"%I:%M\" holds %I without %p.",
        correction: "Add %p, or write %H for an hour from 0 through 23.",
    },
    Expected {
        scenario: "layout-twice",
        call: || drop(date().layouts(["%d/%m/%Y/%d"])),
        rule: "layout",
        sentence: "date() layout \"%d/%m/%Y/%d\" holds the day twice.",
        correction: "Write each field once.",
    },
    Expected {
        scenario: "layout-unknown-directive",
        call: || drop(date().layouts(["%d/%m/%Y", "%d %b %Y"])),
        rule: "layout",
        sentence: "date() layout \"%d %b %Y\" holds %b, which no layout reads.",
        correction: "Use only %Y, %m, and %d, with %% for a percent sign.",
    },
    Expected {
        scenario: "layout-unread-directive",
        call: || drop(time().layouts(["%d %H:%M"])),
        rule: "layout",
        sentence: "time() layout \"%d %H:%M\" holds %d, which time() does not read.",
        correction: "Use only %H, %I, %M, %S, and %p, with %% for a percent sign.",
    },
    Expected {
        scenario: "one-of-twice",
        call: || drop(one_of(["dev", "prod", "dev"])),
        rule: "one-of-values",
        sentence: "one_of() lists \"dev\" twice.",
        correction: "List each value once.",
    },
    Expected {
        scenario: "text-bounds-order",
        call: || drop(text().max_length(0)),
        rule: "bounds-order",
        sentence: "text() min_length 1 is above max_length 0.",
        correction: "Supply a min_length at or below max_length.",
    },
    Expected {
        scenario: "text-pattern",
        call: || drop(text().pattern("(?=a)a", "Expected an a.")),
        rule: "invalid-pattern",
        sentence: "text() pattern does not compile with the regex crate.",
        correction: "Supply a pattern the regex crate compiles, with no lookaround and no backreference.",
    },
    Expected {
        scenario: "time-bound-value",
        call: || drop(time().max("24:00")),
        rule: "bound-value",
        sentence: "time() max is not a time of day.",
        correction: "Supply a time of day such as \"09:00\" or \"17:30\".",
    },
    Expected {
        scenario: "time-bounds-order",
        call: || drop(time().max("09:00").min("17:00")),
        rule: "bounds-order",
        sentence: "time() min 17:00 is above max 09:00.",
        correction: "Supply a min at or below max.",
    },
    Expected {
        scenario: "time-zone",
        call: || drop(date_time().time_zone("Mars/Olympus")),
        rule: "time-zone",
        sentence: "date_time() time_zone is not an IANA time zone name.",
        correction: "Supply a name such as America/New_York.",
    },
    Expected {
        scenario: "url-protocols",
        call: || drop(url().protocols(["https", "https:"])),
        rule: "url-protocols",
        sentence: "url() protocols lists \"https:\", which is not a scheme name.",
        correction: "List a letter followed by letters, digits, +, -, or ., with no trailing colon.",
    },
];

#[test]
fn each_fault_panics_with_its_rules_diagnostic() {
    for case in CASES {
        let fault =
            fault_of(case.call).unwrap_or_else(|| panic!("{} raised no fault", case.scenario));
        assert_eq!(
            fault.identity,
            format!("@loomcli/validators/{}", case.rule),
            "{}",
            case.scenario
        );
        assert_eq!(fault.sentence, case.sentence, "{}", case.scenario);
        assert_eq!(fault.correction, case.correction, "{}", case.scenario);
    }
}

#[test]
fn every_rule_of_the_catalog_has_a_pinned_diagnostic() {
    let pinned: BTreeSet<&str> = CASES.iter().map(|case| case.rule).collect();
    let declared: BTreeSet<&str> = [
        "bound-value",
        "bounds-order",
        "input-schema",
        "invalid-pattern",
        "issue-parameters",
        "key-value-separator",
        "layout",
        "one-of-values",
        "time-zone",
        "url-protocols",
    ]
    .into_iter()
    .collect();
    assert_eq!(pinned, declared);
}

/// The finding a diagnostic prints for `code`, with carets under the first `under` it holds.
fn finding(code: &str, under: &str, note: &str) -> String {
    let at = code.find(under).unwrap();
    format!(
        "    {code}\n    {}{}{note}",
        " ".repeat(at),
        "^".repeat(under.chars().count())
    )
}

#[test]
fn a_fault_rebuilds_the_call_and_marks_the_argument_at_fault() {
    let cases: [(fn(), String); 7] = [
        (
            || drop(bytes().max("10M")),
            finding("bytes().max(\"10M\")", "\"10M\"", ""),
        ),
        (
            || drop(bytes().min("1.5B")),
            finding("bytes().min(\"1.5B\")", "\"1.5B\"", ""),
        ),
        (
            || drop(key_value().separator(" ")),
            finding("key_value().separator(\" \")", "\" \"", ""),
        ),
        (
            || drop(date().layouts([""])),
            finding("date().layouts([\"\"])", "\"\"", ""),
        ),
        (
            || drop(date_time().layouts(["%d/%m/%Y %H:%M", "%Y%m%dT%H%M%SZ"])),
            finding(
                "date_time().layouts([\"%d/%m/%Y %H:%M\", \"%Y%m%dT%H%M%SZ\"])",
                "\"%Y%m%dT%H%M%SZ\"",
                "",
            ),
        ),
        (
            || drop(date().layouts(["%d/%m/%Y", "%d %b %Y"])),
            finding(
                "date().layouts([\"%d/%m/%Y\", \"%d %b %Y\"])",
                "\"%d %b %Y\"",
                "",
            ),
        ),
        (
            || drop(time().max("24:00")),
            finding("time().max(\"24:00\")", "\"24:00\"", ""),
        ),
    ];
    for (call, expected) in cases {
        let message = fault_of(call).unwrap().message;
        assert!(
            message.contains(&expected),
            "{expected}\n not in\n{message}"
        );
    }
}

#[test]
fn a_value_listed_twice_marks_both_entries() {
    let message = fault_of(|| drop(one_of(["dev", "prod", "dev"])))
        .unwrap()
        .message;
    let call = "one_of([\"dev\", \"prod\", \"dev\"])";
    assert!(
        message.contains(&finding(call, "\"dev\"", " the first")),
        "{message}"
    );
    let second = call.rfind("\"dev\"").unwrap();
    let expected = format!(
        "    {call}\n    {}{} the second",
        " ".repeat(second),
        "^".repeat(5)
    );
    assert!(message.contains(&expected), "{message}");
}

#[test]
fn a_diagnostic_carries_the_rules_headline_and_explanation_in_whole_sentences() {
    let message = fault_of(|| drop(integer().max(1).min(5))).unwrap().message;
    assert!(
        message.starts_with("-- BOUNDS OUT OF ORDER ")
            && message.contains("@loomcli/validators/bounds-order"),
        "{message}"
    );
    assert!(message.contains("a lower bound above the upper one would reject every token."));
}

#[test]
fn the_default_floor_above_a_max_length_of_zero_marks_the_max_length_argument() {
    let fault = fault_of(|| text().max_length(0)).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/bounds-order");
    assert!(
        fault
            .message
            .contains(&finding("text().max_length(0)", "0", "")),
        "{}",
        fault.message
    );
}
