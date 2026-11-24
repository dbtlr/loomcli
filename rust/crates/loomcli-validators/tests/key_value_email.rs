//! Ports `key-value-email.test.ts`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_validators::{email, key_value};
use serde_json::json;
use support::{accepted, conforms, fault_text, published, rejected_with, rejection};

#[test]
fn key_value_splits_at_the_first_separator() {
    let line_separator = "\u{2028}";
    for (token, key, value) in [
        ("env=prod", "env", "prod"),
        ("a=b=c", "a", "b=c"),
        ("a==", "a", "="),
        ("a=", "a", ""),
        ("a b=c d", "a b", "c d"),
        (" a = b ", " a ", " b "),
        ("multi\nline=x\ny", "multi\nline", "x\ny"),
        ("\n=x", "\n", "x"),
        ("\u{2028}=x", line_separator, "x"),
        (
            "\u{43a}\u{43b}\u{44e}\u{447}=\u{437}\u{43d}\u{430}\u{447}\u{435}\u{43d}\u{438}\u{435}",
            "\u{43a}\u{43b}\u{44e}\u{447}",
            "\u{437}\u{43d}\u{430}\u{447}\u{435}\u{43d}\u{438}\u{435}",
        ),
        ("\u{1F600}=1", "\u{1F600}", "1"),
    ] {
        let pair = accepted(&key_value(), token);
        assert_eq!(
            (pair.key.as_str(), pair.value.as_str()),
            (key, value),
            "{token:?}"
        );
        assert!(conforms(&key_value(), &json!(token)), "{token:?}");
    }
}

#[test]
fn key_value_splits_at_any_separator() {
    for (separator, token, key, value) in [
        (":", "host:port", "host", "port"),
        (":", "a::b", "a", ":b"),
        ("::", "a::b::c", "a", "b::c"),
        ("=>", "a=>b", "a", "b"),
        ("-", "a-b", "a", "b"),
        ("+", "a+b", "a", "b"),
        (".", "a.b", "a", "b"),
        (".*", "a.*b", "a", "b"),
        ("|", "a|b", "a", "b"),
        ("$", "a$b", "a", "b"),
        ("^", "a^b", "a", "b"),
        ("\\", r"a\b", "a", "b"),
        ("?", "a?b", "a", "b"),
        ("(", "a(b", "a", "b"),
        (")", "a)b", "a", "b"),
        ("[", "a[b", "a", "b"),
        ("]", "a]b", "a", "b"),
        ("{", "a{b", "a", "b"),
        ("}", "a}b", "a", "b"),
        ("/", "a/b", "a", "b"),
        (",", "a,b", "a", "b"),
        ("#", "a#b", "a", "b"),
        ("\u{2192}", "a\u{2192}b", "a", "b"),
    ] {
        let validator = key_value().separator(separator);
        let pair = accepted(&validator, token);
        assert_eq!(
            (pair.key.as_str(), pair.value.as_str()),
            (key, value),
            "{separator}"
        );
        assert!(conforms(&validator, &json!(token)), "{separator}");
    }
}

#[test]
fn key_value_rejects_a_token_with_no_key_or_no_separator() {
    for token in ["env", "", "=prod", "==", "\t", "a:b", "="] {
        assert_eq!(
            rejection(&key_value(), token).0,
            vec!["Expected a key and a value as key=value.".to_owned()],
            "{token:?}"
        );
    }
    assert_eq!(
        rejection(&key_value().separator(":"), "a=b"),
        rejected_with("Expected a key and a value as key:value.")
    );
    assert_eq!(
        rejection(&key_value().separator("::"), ":x"),
        rejected_with("Expected a key and a value as key::value.")
    );
}

#[test]
fn key_value_publishes_a_pattern_with_the_separator_escaped() {
    for (separator, pattern) in [
        ("=", r"^[\s\S]+="),
        (":", r"^[\s\S]+:"),
        ("-", r"^[\s\S]+-"),
        ("+", r"^[\s\S]+\+"),
        (".*", r"^[\s\S]+\.\*"),
        ("a|b", r"^[\s\S]+a\|b"),
        ("\\", r"^[\s\S]+\\"),
        ("[]", r"^[\s\S]+\[\]"),
        ("(?)", r"^[\s\S]+\(\?\)"),
        ("{$^}", r"^[\s\S]+\{\$\^\}"),
        ("/", r"^[\s\S]+/"),
    ] {
        assert_eq!(
            published(&key_value().separator(separator)),
            serde_json::to_string(&json!({ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "string", "pattern": pattern })).unwrap(),
            "{separator}"
        );
    }
    assert_eq!(
        published(&key_value()),
        published(&key_value().separator("="))
    );
    for token in ["", "env", "=prod"] {
        assert!(!conforms(&key_value(), &json!(token)), "refuses {token:?}");
    }
}

#[test]
fn a_separator_that_is_empty_or_holds_whitespace_panics_at_the_call() {
    assert_eq!(
        fault_text(|| key_value().separator("")),
        "key_value() separator is empty. Supply one character or more with no whitespace, such as \"=\" or \":\"."
    );
    for separator in [" ", "a b", "\t", "=\n", "\u{a0}", "\u{2028}", ": "] {
        assert_eq!(
            fault_text(|| key_value().separator(separator)),
            "key_value() separator holds whitespace. Supply one character or more with no whitespace, such as \"=\" or \":\".",
            "{separator:?}"
        );
    }
    let fault = support::fault_of(|| key_value().separator(" ")).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/key-value-separator");
}

#[test]
fn email_accepts_what_whatwg_accepts_as_written() {
    let long_label = "a".repeat(63);
    let mut tokens: Vec<String> = [
        "name@example.com",
        "ops@localhost",
        "A.Name@Example.COM",
        "a..b@example.com",
        ".a@example.com",
        "a.@example.com",
        "o'brien+tag@example.co.uk",
        "#!$%&'*+/=?^_`{|}~-@example.com",
        "x@a-b.c",
        "x@a--b.c",
        "x@1.2.3.4",
    ]
    .iter()
    .map(|token| (*token).to_owned())
    .collect();
    tokens.push(format!("x@{long_label}.example"));
    for token in tokens {
        assert_eq!(accepted(&email(), &token), token);
        assert!(conforms(&email(), &json!(token)), "{token}");
    }
}

#[test]
fn email_rejects_the_rest_with_one_sentence() {
    let long_label = "a".repeat(63);
    let mut tokens: Vec<String> = [
        "",
        "ops",
        "@example.org",
        "ops@",
        "ops@-example.org",
        "ops@example-.org",
        "ops@example..org",
        "ops@.example.org",
        "ops@example.org.",
        "ops@exa_mple.org",
        "ops@example.org:25",
        "\"john doe\"@example.org",
        "john doe@example.org",
        "ops(comment)@example.org",
        "ops@[192.0.2.1]",
        "ops@example.org\nx",
        "ops@\u{17f}.example",
        "\u{212a}@example.org",
        "ops@[IPv6:2001:db8::1]",
        "\u{fc}@example.org",
        "ops@b\u{fc}cher.example",
        "a@b@example.org",
        " ops@example.org",
        "ops@example.org ",
    ]
    .iter()
    .map(|token| (*token).to_owned())
    .collect();
    tokens.push(format!("ops@{long_label}a.example"));
    for token in tokens {
        assert_eq!(
            rejection(&email(), &token),
            rejected_with("Expected an email address, such as name@example.com."),
            "{token:?}"
        );
    }
}

#[test]
fn email_publishes_the_whatwg_production_as_a_pattern() {
    let label = "[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?";
    let pattern = format!(r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{{|}}~-]+@{label}(?:\.{label})*$");
    assert_eq!(
        published(&email()),
        serde_json::to_string(&json!({ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "string", "pattern": pattern })).unwrap()
    );
    for token in ["ops", "\"john doe\"@example.org", "ops@example.org."] {
        assert!(!conforms(&email(), &json!(token)), "refuses {token:?}");
    }
}
