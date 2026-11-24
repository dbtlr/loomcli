//! Ports `url.test.ts` and `uuid-date.test.ts`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_validators::{Url, date, url, uuid};
use serde_json::json;
use support::{accepted, conforms, fault_text, published, rejected_with, rejection};

#[test]
fn accepted_tokens_read_as_a_parsed_url() {
    let cases: Vec<(&str, Url, &str, &str)> = vec![
        (
            "a host",
            url(),
            "https://example.com",
            "https://example.com/",
        ),
        (
            "every component",
            url(),
            "http://user:pass@example.com:8080/path?q=1#frag",
            "http://user:pass@example.com:8080/path?q=1#frag",
        ),
        (
            "a mailto URI",
            url(),
            "mailto:someone@example.com",
            "mailto:someone@example.com",
        ),
        ("a URN", url(), "urn:isbn:0451450523", "urn:isbn:0451450523"),
        (
            "an empty authority",
            url(),
            "file:///etc/hosts",
            "file:///etc/hosts",
        ),
        (
            "an IPv6 host",
            url(),
            "http://[::1]:3000/",
            "http://[::1]:3000/",
        ),
        (
            "an IPv4 host",
            url(),
            "http://192.168.0.1/",
            "http://192.168.0.1/",
        ),
        (
            "an uppercase scheme and host",
            url(),
            "HTTPS://EXAMPLE.COM",
            "https://example.com/",
        ),
        (
            "a percent-encoded path",
            url(),
            "https://example.com/a%20b",
            "https://example.com/a%20b",
        ),
        (
            "a scheme with a plus",
            url(),
            "svn+ssh://host/repo",
            "svn+ssh://host/repo",
        ),
        (
            "a scheme with a hyphen and a dot",
            url(),
            "x-y.z:opaque",
            "x-y.z:opaque",
        ),
        (
            "a slash and a question mark in the query",
            url(),
            "http://example.com/?a=b/c?d",
            "http://example.com/?a=b/c?d",
        ),
        (
            "a listed scheme",
            url().protocols(["https"]),
            "https://example.com",
            "https://example.com/",
        ),
        (
            "a listed scheme in another case",
            url().protocols(["https"]),
            "HtTpS://example.com",
            "https://example.com/",
        ),
        (
            "a listed scheme declared in uppercase",
            url().protocols(["HTTPS"]),
            "https://example.com",
            "https://example.com/",
        ),
        (
            "a listed scheme with a plus",
            url().protocols(["svn+ssh", "git-lfs", "a.b"]),
            "SVN+SSH://host/repo",
            "svn+ssh://host/repo",
        ),
        (
            "a listed scheme with a hyphen",
            url().protocols(["svn+ssh", "git-lfs", "a.b"]),
            "Git-Lfs://host/x",
            "git-lfs://host/x",
        ),
        (
            "a listed scheme with a dot",
            url().protocols(["svn+ssh", "git-lfs", "a.b"]),
            "A.b:opaque",
            "a.b:opaque",
        ),
    ];
    for (name, validator, token, href) in cases {
        assert_eq!(accepted(&validator, token).as_str(), href, "{name}");
        assert!(conforms(&validator, &json!(token)), "{name}");
    }
}

#[test]
fn rejected_tokens_read_the_one_sentence_for_the_configuration() {
    let plain = "Expected an absolute URL, such as https://example.com.";
    let cases: Vec<(&str, Url, String, &str)> = vec![
        ("no scheme", url(), "example.org".into(), plain),
        ("a relative path", url(), "/relative/path".into(), plain),
        ("the empty string", url(), String::new(), plain),
        (
            "a scheme with nothing after it",
            url(),
            "mailto:".into(),
            plain,
        ),
        ("a scheme and a query only", url(), "x:?q=1".into(), plain),
        (
            "a scheme and a fragment only",
            url(),
            "x:#top".into(),
            plain,
        ),
        (
            "an empty path under protocols",
            url().protocols(["h+x.y-z"]),
            "h+x.y-z:#".into(),
            "Expected an absolute URL with the scheme h+x.y-z.",
        ),
        (
            "a space the WHATWG parser would encode",
            url(),
            "https://example.org/a b".into(),
            plain,
        ),
        (
            "a backslash the WHATWG parser would turn",
            url(),
            r"https://example.org\path".into(),
            plain,
        ),
        (
            "a leading space the WHATWG parser would trim",
            url(),
            " https://example.org".into(),
            plain,
        ),
        (
            "a malformed percent escape",
            url(),
            "https://example.org/%zz".into(),
            plain,
        ),
        (
            "a non-ASCII path",
            url(),
            "https://example.org/\u{e4}".into(),
            plain,
        ),
        (
            "a scheme that starts with a digit",
            url(),
            "1http://example.org".into(),
            plain,
        ),
        (
            "a port that is not a number",
            url(),
            "https://example.org:port".into(),
            plain,
        ),
        (
            "an IPvFuture host the WHATWG parser refuses",
            url(),
            "http://[v1.x]/".into(),
            plain,
        ),
        (
            "a special scheme with no host",
            url(),
            "http://".into(),
            plain,
        ),
        (
            "an unlisted scheme",
            url().protocols(["https"]),
            "http://example.org".into(),
            "Expected an absolute URL with the scheme https.",
        ),
        (
            "a token that is no URL at all under protocols",
            url().protocols(["https"]),
            "not a url".into(),
            "Expected an absolute URL with the scheme https.",
        ),
        (
            "an unlisted scheme of two",
            url().protocols(["https", "http"]),
            "ftp://example.org".into(),
            "Expected an absolute URL with the scheme https or http.",
        ),
        (
            "an unlisted scheme of three",
            url().protocols(["https", "http", "ftp"]),
            "ws://example.org".into(),
            "Expected an absolute URL with the scheme https, http, or ftp.",
        ),
    ];
    for (name, validator, token, message) in cases {
        assert_eq!(
            rejection(&validator, &token),
            rejected_with(message),
            "{name}"
        );
    }
}

#[test]
fn url_publishes_the_uri_format_and_an_anchored_scheme_pattern() {
    assert_eq!(
        published(&url()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"uri"}"#
    );
    assert_eq!(
        published(&url().protocols(["https"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"uri","pattern":"^(?:[hH][tT][tT][pP][sS]):"}"#
    );
    let schema = support::published_value(&url().protocols(["https", "svn+ssh"]));
    assert_eq!(
        schema["pattern"],
        r"^(?:[hH][tT][tT][pP][sS]|[sS][vV][nN]\+[sS][sS][hH]):"
    );
    let hyphen = support::published_value(&url().protocols(["git-lfs", "a.b", "x2"]));
    assert_eq!(
        hyphen["pattern"],
        r"^(?:[gG][iI][tT]-[lL][fF][sS]|[aA]\.[bB]|[xX]2):"
    );
}

#[test]
fn a_protocols_list_that_can_never_work_panics_at_the_call() {
    let scheme = "List a letter followed by letters, digits, +, -, or ., with no trailing colon.";
    assert_eq!(
        fault_text(|| url().protocols(["https:"])),
        format!("url() protocols lists \"https:\", which is not a scheme name. {scheme}")
    );
    assert_eq!(
        fault_text(|| url().protocols(["2x"])),
        format!("url() protocols lists \"2x\", which is not a scheme name. {scheme}")
    );
    let fault = support::fault_of(|| url().protocols(["https", "https:"])).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/url-protocols");
    assert!(
        fault
            .message
            .contains("url().protocols([\"https\", \"https:\"])"),
        "{}",
        fault.message
    );
}

#[test]
fn uuid_reads_any_case_as_lowercase() {
    for (token, value) in [
        (
            "123e4567-e89b-12d3-a456-426614174000",
            "123e4567-e89b-12d3-a456-426614174000",
        ),
        (
            "123E4567-E89B-12D3-A456-426614174000",
            "123e4567-e89b-12d3-a456-426614174000",
        ),
        (
            "AbCdEf01-2345-6789-aBcD-eF0123456789",
            "abcdef01-2345-6789-abcd-ef0123456789",
        ),
        (
            "00000000-0000-0000-0000-000000000000",
            "00000000-0000-0000-0000-000000000000",
        ),
        (
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
        ),
        (
            "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
        ),
        (
            "01890a5d-ac96-774b-bcce-b302099a8057",
            "01890a5d-ac96-774b-bcce-b302099a8057",
        ),
    ] {
        assert_eq!(accepted(&uuid(), token), value);
        assert!(conforms(&uuid(), &json!(token)));
    }
    for token in [
        "",
        "9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f",
        "urn:uuid:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
        "{9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f}",
        "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5g",
        "9f1c2d3e-4a5b-6c7d-8e9f0-a1b2c3d4e5f",
        " 9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
        "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f0",
    ] {
        assert_eq!(
            rejection(&uuid(), token),
            rejected_with("Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000."),
            "{token:?}"
        );
    }
    assert_eq!(
        published(&uuid()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"uuid"}"#
    );
}

#[test]
fn date_accepts_a_real_day_unchanged() {
    for token in [
        "2024-02-29",
        "0000-02-29",
        "2000-02-29",
        "0400-02-29",
        "0001-01-01",
        "9999-12-31",
        "1900-02-28",
        "2026-04-30",
    ] {
        assert_eq!(accepted(&date(), token), token);
        assert!(conforms(&date(), &json!(token)), "{token}");
    }
}

#[test]
fn date_rejects_everything_else() {
    for token in [
        "2026-02-29",
        "2026-13-01",
        "0100-02-29",
        "1900-02-29",
        "2026-00-10",
        "2026-01-00",
        "2026-04-31",
        "2026-01-32",
        "26-01-01",
        "2026-1-01",
        "20260101",
        "",
        "2026-01-01T00:00",
        "+2026-01-01",
        "12026-01-01",
        "\u{661}\u{662}\u{663}\u{664}-01-01",
        "2026/01/01",
    ] {
        assert_eq!(
            rejection(&date(), token),
            rejected_with("Expected a date as YYYY-MM-DD, such as 2026-09-25."),
            "{token:?}"
        );
    }
    assert_eq!(
        published(&date()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"date"}"#
    );
}
