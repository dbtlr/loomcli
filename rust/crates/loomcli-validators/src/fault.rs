//! The catalog's declaration faults: the rules they break and the panic that reports one at the
//! author's call.

use loomcli_core::{
    DeclarationError, DiagnosticParts, DiagnosticRule, FailureFacts, Finding, diagnostic_rule,
};

/// A `one_of` list that is empty or holds one value twice.
pub(crate) const ONE_OF_VALUES: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/one-of-values",
    "Invalid one_of values",
    "one_of() accepts a token equal to one of its values, and help, completion, and the published schema offer each value as a choice, and a JSON Schema enum lists each value once, so the list holds at least one value and each value is distinct.",
);

/// A bound that is not a value of the kind its validator reads.
pub(crate) const BOUND_VALUE: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/bound-value",
    "Invalid bound",
    "A bound limits the values or the length a validator accepts, so it is a value of the kind the validator reads: a finite number for number(), a duration in the operator's grammar for duration(), a size in the operator's grammar for bytes(), and a time of day in its default grammar, such as 09:00, for time().",
);

/// A lower bound above its upper bound.
pub(crate) const BOUNDS_ORDER: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/bounds-order",
    "Bounds out of order",
    "A validator accepts what lies between its lower and its upper bound, both inclusive, so a lower bound above the upper one would reject every token.",
);

/// A `date_time` time zone that is not an IANA time zone name the time zone database knows.
pub(crate) const TIME_ZONE: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/time-zone",
    "Invalid time zone",
    "date_time() reads a token with no offset in the time zone it names, so the name is an IANA time zone the time zone database knows, such as America/New_York.",
);

/// A `date`, `date_time`, or `time` layout the factory cannot read.
pub(crate) const LAYOUT: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/layout",
    "Invalid layout",
    "date(), date_time(), and time() read each layout as a POSIX strftime layout, so it is nonempty, holds only the directives its factory reads and no % that ends it, holds each field at most once and every field its factory needs, pairs %I with %p, and, in date_time(), holds no literal Z or z, because only %z reads Z as UTC.",
);

/// A `url` protocols list that is not a list of scheme names.
pub(crate) const URL_PROTOCOLS: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/url-protocols",
    "Invalid url protocols",
    "url() accepts a URL whose scheme the list names and publishes the list as a pattern, so it holds at least one scheme name: a letter followed by letters, digits, +, -, or ., with no trailing colon.",
);

/// A `key_value` separator that is empty or holds whitespace.
pub(crate) const KEY_VALUE_SEPARATOR: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/key-value-separator",
    "Invalid key_value separator",
    "key_value() splits a token at the first occurrence of its separator, so the separator holds one character or more, because an empty one leaves every key empty, and it holds no whitespace, because a shell splits an unquoted word at a space, a tab, or a newline, and whitespace an operator cannot see is a separator no one can type.",
);

/// A `text` pattern the `regex` crate cannot compile, or one with no sentence.
pub(crate) const INVALID_PATTERN: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/invalid-pattern",
    "Invalid pattern",
    "text() publishes its pattern in the JSON Schema it serves, which reads a pattern as an ECMAScript expression, and matches it with the regex crate, so the pattern is a regular expression that crate compiles, with no lookaround and no backreference, and it comes with the one sentence that says what it accepts.",
);

/// A `create_validator` input schema that declares its own dialect.
pub(crate) const INPUT_SCHEMA: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/input-schema",
    "Invalid input schema",
    "create_validator() publishes its input schema as draft 2020-12 JSON Schema and adds the $schema dialect itself, so the input schema holds no $schema of its own.",
);

/// Parameters an issue code's check rejects.
pub(crate) const ISSUE_PARAMETERS: DiagnosticRule = diagnostic_rule(
    "@loomcli/validators/issue-parameters",
    "Issue parameters rejected",
    "An issue carries parameters its code accepts, so every view that reads them through read() gets the shape the code declares.",
);

/// One call as a finding rebuilds it: the call's name and the arguments it received.
pub(crate) fn call(name: &str, arguments: Vec<loomcli_core::Literal>, mark: &str) -> Finding {
    Finding::new(name, arguments).mark(mark)
}

/// Reports a factory argument that can never work, at the author's call: a panic carrying the
/// whole Developer Diagnostic, the Rust form of the reference's throw. The findings rebuild the
/// call and mark the argument at fault.
#[track_caller]
pub(crate) fn raise(
    rule: DiagnosticRule,
    sentence: impl Into<String>,
    correction: &str,
    findings: Vec<Finding>,
) -> ! {
    let mut parts = DiagnosticParts::new(sentence);
    for finding in findings {
        parts = parts.finding(finding);
    }
    let fault = DeclarationError::new(rule, parts.correction(correction));
    panic!("{}", fault.message())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [DiagnosticRule; 10] = [
        ONE_OF_VALUES,
        BOUND_VALUE,
        BOUNDS_ORDER,
        TIME_ZONE,
        LAYOUT,
        URL_PROTOCOLS,
        KEY_VALUE_SEPARATOR,
        INVALID_PATTERN,
        INPUT_SCHEMA,
        ISSUE_PARAMETERS,
    ];

    #[test]
    fn every_rule_has_a_one_line_headline_and_an_explanation_of_whole_sentences() {
        let mut identities: Vec<&str> = ALL.iter().map(DiagnosticRule::identity).collect();
        identities.sort_unstable();
        identities.dedup();
        assert_eq!(identities.len(), ALL.len());
        for rule in ALL {
            assert!(
                rule.identity().starts_with("@loomcli/validators/"),
                "{}",
                rule.identity()
            );
            assert!(!rule.headline().contains('\n') && !rule.headline().ends_with('.'));
            assert!(rule.explanation().ends_with('.') && !rule.explanation().contains('\n'));
        }
    }
}
