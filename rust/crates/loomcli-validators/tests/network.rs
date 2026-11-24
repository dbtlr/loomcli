//! Ports `host.test.ts` and `ip-cidr.test.ts`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_validators::{IpVersion, cidr, host, ip};
use serde_json::json;
use support::{accepted, conforms, published, rejected_with, rejection, verdict};

const HOST_SENTENCE: &str = "Expected a host name, such as example.com.";
const HOST_OR_IP_SENTENCE: &str =
    "Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].";

fn longest() -> String {
    let label = "a".repeat(63);
    format!("{label}.{label}.{label}.{}", "b".repeat(61))
}

/// Host names and the lowercase output each gives, under either configuration.
fn names() -> Vec<(String, String)> {
    let label63 = "a".repeat(63);
    let mut names: Vec<(String, String)> = [
        ("example.com", "example.com"),
        ("EXAMPLE.COM", "example.com"),
        ("Db.Internal", "db.internal"),
        ("localhost", "localhost"),
        ("a", "a"),
        ("a-b.c", "a-b.c"),
        ("a--b.example", "a--b.example"),
        ("xn--bcher-kva.example", "xn--bcher-kva.example"),
        ("1example.com", "1example.com"),
        ("123.example", "123.example"),
        ("1.2.3.example", "1.2.3.example"),
        ("example.123a", "example.123a"),
        ("foo.0xg", "foo.0xg"),
        ("foo.x0", "foo.x0"),
        ("a.b.c.d.e", "a.b.c.d.e"),
    ]
    .iter()
    .map(|(token, name)| ((*token).to_owned(), (*name).to_owned()))
    .collect();
    names.push((label63.clone(), label63));
    names.push((longest(), longest()));
    names
}

/// Tokens that are not host names, under either configuration.
fn not_names() -> Vec<String> {
    let mut tokens: Vec<String> = [
        "",
        "example.org.",
        "\u{212A}.example",
        ".example.org",
        "example..org",
        "-example.org",
        "example-.org",
        "exa_mple.org",
        "_service.example.org",
        "b\u{fc}cher.example",
        "ex ample.org",
        " example.org",
        "example.org ",
        "example.org:80",
        "http://example.org",
        "0x7f000001",
        "0X7F000001",
        "127.0.0.0x1",
        "foo.0x",
        "foo.0X1F",
        "foo.0xff",
        "123",
        "example.123",
        "192.0.2.01",
        "1.2.3",
        "1.2.3.4.5",
        "[192.0.2.10]",
        "[example.org]",
        "[]",
        "[::1",
        "::2]",
        "[[::1]]",
        "[fe80::1%eth0]",
    ]
    .iter()
    .map(|token| (*token).to_owned())
    .collect();
    tokens.push("a".repeat(64));
    tokens.push(format!("{}c", longest()));
    tokens.push(format!("{}.c", longest()));
    tokens
}

#[test]
fn host_accepts_names_in_lowercase() {
    for (token, name) in names() {
        assert_eq!(accepted(&host(), &token), name, "{token}");
        assert!(conforms(&host(), &json!(token)), "{token}");
    }
}

#[test]
fn host_rejects_what_is_no_name() {
    let mut tokens = not_names();
    tokens.extend(["1.2.3.4", "192.0.2.10", "::1", "[::1]", "[2001:db8::2]"].map(str::to_owned));
    for token in tokens {
        assert_eq!(
            rejection(&host(), &token),
            rejected_with(HOST_SENTENCE),
            "{token:?}"
        );
    }
}

#[test]
fn host_publishes_the_hostname_format() {
    assert_eq!(
        published(&host()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"hostname"}"#
    );
}

#[test]
fn host_with_ip_accepts_names_and_addresses() {
    let with_ip = host().or_ip();
    for (token, name) in names() {
        assert_eq!(accepted(&with_ip, &token), name, "{token}");
        assert!(conforms(&with_ip, &json!(token)), "{token}");
    }
    for (token, value) in [
        ("192.0.2.1", "192.0.2.1"),
        ("0.0.0.0", "0.0.0.0"),
        ("1.2.3.4", "1.2.3.4"),
        ("[2001:DB8::1]", "2001:db8::1"),
        ("[2001:db8:0:0:0:0:0:1]", "2001:db8::1"),
        ("[::1]", "::1"),
        ("[::]", "::"),
        ("[::ffff:192.0.2.1]", "::ffff:192.0.2.1"),
        ("[::ffff:c000:201]", "::ffff:192.0.2.1"),
        ("[64:ff9b::192.0.2.33]", "64:ff9b::c000:221"),
    ] {
        assert_eq!(accepted(&with_ip, token), value, "{token}");
        assert!(conforms(&with_ip, &json!(token)), "{token}");
    }
}

#[test]
fn host_with_ip_rejects_the_rest_with_its_own_sentence() {
    let mut tokens = not_names();
    tokens.extend(
        [
            "2001:db8::2",
            "::2",
            "::ffff:192.0.2.10",
            "[::1]:80",
            "x[::1]",
        ]
        .map(str::to_owned),
    );
    for token in tokens {
        assert_eq!(
            rejection(&host().or_ip(), &token),
            rejected_with(HOST_OR_IP_SENTENCE),
            "{token:?}"
        );
    }
}

#[test]
fn host_with_ip_publishes_hostname_and_ipv4_beside_a_bracketed_pattern() {
    let with_ip = host().or_ip();
    assert_eq!(
        published(&with_ip),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"format":"hostname"},{"format":"ipv4"},{"pattern":"^\\[[0-9A-Fa-f:.]+\\]$"}]}"#
    );
    for token in ["[]", "[g::]", "2001:db8::1", "[::1", "exa_mple.org"] {
        assert!(
            !conforms(&with_ip, &json!(token)),
            "the schema refuses {token:?}"
        );
    }
}

const IP_SENTENCE: &str = "Expected an IP address, such as 192.0.2.1 or 2001:db8::1.";
const IPV4_SENTENCE: &str = "Expected an IPv4 address, such as 192.0.2.1.";
const IPV6_SENTENCE: &str = "Expected an IPv6 address, such as 2001:db8::1.";
const CIDR_SENTENCE: &str = "Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.";
const CIDR_V4_SENTENCE: &str = "Expected an IPv4 CIDR block, such as 192.0.2.0/24.";
const CIDR_V6_SENTENCE: &str = "Expected an IPv6 CIDR block, such as 2001:db8::/32.";
const HOST_BITS_SENTENCE: &str = "Expected a network address with no bits set below the prefix.";

const IPV6_TOKENS: [(&str, &str); 29] = [
    ("2001:db8::1", "2001:db8::1"),
    ("2001:DB8::1", "2001:db8::1"),
    ("2001:DB8:0:0:0:0:0:1", "2001:db8::1"),
    ("2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::1"),
    ("2001:db8::0:1", "2001:db8::1"),
    ("::", "::"),
    ("0:0:0:0:0:0:0:0", "::"),
    ("::1", "::1"),
    ("1::", "1::"),
    ("fe80::1", "fe80::1"),
    ("1:0:0:2:0:0:0:3", "1:0:0:2::3"),
    ("1:0:0:2:0:0:3:4", "1::2:0:0:3:4"),
    ("1:0:2:3:4:5:6:7", "1:0:2:3:4:5:6:7"),
    ("1:2:3:4:5:6:7::", "1:2:3:4:5:6:7:0"),
    ("::2:3:4:5:6:7:8", "0:2:3:4:5:6:7:8"),
    ("2001:db8:0:1:1:1:1:1", "2001:db8:0:1:1:1:1:1"),
    (
        "ABCD:EF01:2345:6789:ABCD:EF01:2345:6789",
        "abcd:ef01:2345:6789:abcd:ef01:2345:6789",
    ),
    ("::ffff:192.0.2.1", "::ffff:192.0.2.1"),
    ("::ffff:c000:201", "::ffff:192.0.2.1"),
    ("::FFFF:C000:0201", "::ffff:192.0.2.1"),
    ("0:0:0:0:0:ffff:192.0.2.1", "::ffff:192.0.2.1"),
    ("::ffff:192.0.2.200", "::ffff:192.0.2.200"),
    ("1::ffff:192.0.2.1", "1::ffff:c000:201"),
    ("::ffff:0.0.0.0", "::ffff:0.0.0.0"),
    ("::192.0.2.1", "::c000:201"),
    ("64:ff9b::192.0.2.33", "64:ff9b::c000:221"),
    ("1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6:102:304"),
    ("1::5:6:255.255.255.255", "1::5:6:ffff:ffff"),
    ("::1:ffff:192.0.2.1", "::1:ffff:c000:201"),
];

const NOT_ADDRESSES: [&str; 38] = [
    "",
    "abc",
    "192.0.2.01",
    "192.0.2.256",
    "192.0.3",
    "192.0.2.1.5",
    "01.2.3.4",
    "1.2.3.-4",
    "1.2.3.+4",
    " 192.0.2.10",
    "192.0.2.10 ",
    "0x7f.0.0.1",
    "0x7f000001",
    "3232235777",
    "\u{ff11}.\u{ff12}.\u{ff13}.\u{ff14}",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8::",
    "::1:2:3:4:5:6:7:8",
    "1::2::3",
    ":::",
    "1:::2",
    ":1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:",
    "12345::",
    "g::",
    "fe80::1%eth0",
    "fe80::1%25eth0",
    "[::1]",
    "::ffff:192.0.2.01",
    "::ffff:192.0.2",
    "::ffff:192.0.2.256",
    "1.2.3.4::",
    "1.2.3.4:1::",
    "::1.2.3.4:5",
    "1:2:3:4:5:6:7:1.2.3.4",
    "1:2:3:4:5:6:7::1.2.3.4",
    "::1.2.3",
];

#[test]
fn ip_accepts_ipv4_as_written_and_ipv6_in_canonical_form() {
    for token in [
        "192.0.2.1",
        "0.0.0.0",
        "255.255.255.255",
        "10.0.0.1",
        "1.2.3.4",
    ] {
        for validator in [ip(), ip().version(IpVersion::V4)] {
            assert_eq!(accepted(&validator, token).to_string(), token);
            assert!(conforms(&validator, &json!(token)));
        }
    }
    for (token, canonical) in IPV6_TOKENS {
        for validator in [ip(), ip().version(IpVersion::V6)] {
            assert_eq!(
                accepted(&validator, token).to_string(),
                canonical,
                "{token}"
            );
            assert!(conforms(&validator, &json!(token)), "{token}");
        }
    }
}

#[test]
fn ip_rejects_what_is_no_address_with_the_sentence_of_each_configuration() {
    for token in NOT_ADDRESSES {
        assert_eq!(
            rejection(&ip(), token),
            rejected_with(IP_SENTENCE),
            "{token:?}"
        );
        assert_eq!(
            rejection(&ip().version(IpVersion::V4), token),
            rejected_with(IPV4_SENTENCE),
            "{token:?}"
        );
        assert_eq!(
            rejection(&ip().version(IpVersion::V6), token),
            rejected_with(IPV6_SENTENCE),
            "{token:?}"
        );
    }
}

#[test]
fn ip_accepts_one_family_alone_under_version() {
    assert_eq!(
        rejection(&ip().version(IpVersion::V4), "2001:db8::2"),
        rejected_with(IPV4_SENTENCE)
    );
    assert_eq!(
        rejection(&ip().version(IpVersion::V4), "::ffff:192.0.2.10"),
        rejected_with(IPV4_SENTENCE)
    );
    assert_eq!(
        rejection(&ip().version(IpVersion::V6), "192.0.2.10"),
        rejected_with(IPV6_SENTENCE)
    );
}

#[test]
fn one_spelling_of_an_address_gives_one_output() {
    for token in [
        "2001:DB8::1",
        "2001:db8:0:0:0:0:0:1",
        "2001:0db8::0001",
        "2001:db8:0::0:1",
    ] {
        assert_eq!(accepted(&ip(), token).to_string(), "2001:db8::1", "{token}");
    }
}

#[test]
fn ip_publishes_the_format_of_each_family() {
    assert_eq!(
        published(&ip()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"format":"ipv4"},{"format":"ipv6"}]}"#
    );
    assert_eq!(
        published(&ip().version(IpVersion::V4)),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"ipv4"}"#
    );
    assert_eq!(
        published(&ip().version(IpVersion::V6)),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"ipv6"}"#
    );
}

#[test]
fn cidr_accepts_a_network_address_and_prefix() {
    let cases = [
        ("10.0.0.0/8", "10.0.0.0", 8),
        ("192.0.2.0/24", "192.0.2.0", 24),
        ("0.0.0.0/0", "0.0.0.0", 0),
        ("192.0.2.1/32", "192.0.2.1", 32),
        ("10.128.0.0/9", "10.128.0.0", 9),
        ("2001:db8::/32", "2001:db8::", 32),
        ("2001:DB8:0:0::/64", "2001:db8::", 64),
        ("::/0", "::", 0),
        ("::1/128", "::1", 128),
        ("fe80::/10", "fe80::", 10),
        ("2001:db8:1234::/48", "2001:db8:1234::", 48),
        ("2001:db8::8000/113", "2001:db8::8000", 113),
        ("::ffff:192.0.2.0/120", "::ffff:192.0.2.0", 120),
        ("::ffff:c000:200/120", "::ffff:192.0.2.0", 120),
    ];
    for (token, address, prefix) in cases {
        let family = if address.contains(':') {
            IpVersion::V6
        } else {
            IpVersion::V4
        };
        for validator in [cidr(), cidr().version(family)] {
            let block = accepted(&validator, token);
            assert_eq!(
                (block.address.to_string().as_str(), block.prefix),
                (address, prefix),
                "{token}"
            );
            assert!(conforms(&validator, &json!(token)), "{token}");
        }
    }
}

#[test]
fn cidr_rejects_what_is_no_block_with_the_sentence_of_each_configuration() {
    for token in [
        "",
        "10.0.0.0",
        "10.0.0.0/",
        "10.0.0.0/33",
        "10.0.0.0/08",
        "x/10.0.0.0/8",
        "10.0.0.0/00",
        "10.0.0.0/-1",
        "10.0.0.0/+8",
        "10.0.0.0/ 8",
        "10.0.0.0 /8",
        "10.0.0.0/8 ",
        "10.0.0.0/1000",
        "10.0.0.0/8/8",
        "010.0.0.0/8",
        "10.0.0/8",
        "/8",
        "abc/8",
        "2001:db8::/129",
        "2001:db8::/0128",
        "fe80::%eth0/64",
        "[2001:db8::]/32",
        "2001:db8::/1e2",
    ] {
        assert_eq!(
            rejection(&cidr(), token),
            rejected_with(CIDR_SENTENCE),
            "{token:?}"
        );
        assert_eq!(
            rejection(&cidr().version(IpVersion::V4), token),
            rejected_with(CIDR_V4_SENTENCE),
            "{token:?}"
        );
        assert_eq!(
            rejection(&cidr().version(IpVersion::V6), token),
            rejected_with(CIDR_V6_SENTENCE),
            "{token:?}"
        );
    }
}

#[test]
fn cidr_rejects_host_bits_with_its_own_sentence() {
    for token in [
        "10.0.0.1/8",
        "192.0.2.1/24",
        "0.0.0.1/0",
        "10.0.0.0/6",
        "2001:db8::1/32",
        "::1/127",
        "2001:db8::8000/112",
        "::ffff:192.0.2.1/120",
    ] {
        assert_eq!(
            rejection(&cidr(), token),
            rejected_with(HOST_BITS_SENTENCE),
            "{token:?}"
        );
        let family = if token.contains(':') {
            IpVersion::V6
        } else {
            IpVersion::V4
        };
        assert_eq!(
            rejection(&cidr().version(family), token),
            rejected_with(HOST_BITS_SENTENCE),
            "{token:?}"
        );
    }
}

#[test]
fn cidr_rejects_a_block_of_the_other_family_with_the_family_sentence() {
    for token in ["2001:db8::/32", "2001:db8::1/32", "::ffff:192.0.2.0/120"] {
        assert_eq!(
            rejection(&cidr().version(IpVersion::V4), token),
            rejected_with(CIDR_V4_SENTENCE),
            "{token:?}"
        );
    }
    for token in ["10.0.0.0/8", "10.0.0.1/8"] {
        assert_eq!(
            rejection(&cidr().version(IpVersion::V6), token),
            rejected_with(CIDR_V6_SENTENCE),
            "{token:?}"
        );
    }
}

#[test]
fn cidr_publishes_a_pattern_for_each_version() {
    let schema = r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^[0-9A-Fa-f:.]+/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$"}"#;
    assert_eq!(published(&cidr()), schema);
    assert_eq!(published(&cidr().version(IpVersion::V4)), schema);
    assert_eq!(published(&cidr().version(IpVersion::V6)), schema);
    for token in [
        "10.0.0.0/129",
        "10.0.0.0/08",
        "x/8",
        "10.0.0.0",
        "[::]/0",
        "10.0.0.0/8 ",
    ] {
        assert!(
            !conforms(&cidr(), &json!(token)),
            "the pattern refuses {token:?}"
        );
    }
    assert!(verdict(&cidr(), "10.0.0.0/8").is_ok());
}
