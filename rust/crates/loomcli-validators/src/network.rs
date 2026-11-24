//! `host`, `ip`, and `cidr`.

use std::net::IpAddr;

use loomcli_core::{InputSchema, Issue, ValidationContext, Validator};
use serde_json::{Map, Value, json};

use crate::address::{Address, read_address};
use crate::codes::{
    CIDR_HOST_BITS_ISSUE, CIDR_ISSUE, CIDR_V4_ISSUE, CIDR_V6_ISSUE, HOST_ISSUE, HOST_OR_IP_ISSUE,
    IP_ISSUE, IP_V4_ISSUE, IP_V6_ISSUE, NoParams,
};

/// The IP version an `ip` or `cidr` validator accepts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IpVersion {
    /// IPv4 alone.
    V4,
    /// IPv6 alone.
    V6,
}

fn string_schema(members: Vec<(&str, Value)>) -> InputSchema {
    let mut schema = Map::new();
    schema.insert("type".to_owned(), "string".into());
    for (key, value) in members {
        schema.insert(key.to_owned(), value);
    }
    Some(loomcli_core::with_schema_dialect(schema))
}

/// The longest host name in text form, with no trailing dot, that RFC 1035's 255-octet name holds.
const LONGEST_NAME: usize = 253;

/// A bracketed address as the published pattern admits it, hexadecimal digits, `:`, and `.`.
const BRACKETED_PATTERN: &str = r"^\[[0-9A-Fa-f:.]+\]$";

/// Whether `label` is one RFC 1123 label: letters, digits, and hyphens, 1 through 63, with a
/// hyphen at neither end.
fn is_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    (1..=63).contains(&bytes.len())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
        && bytes.first() != Some(&b'-')
        && bytes.last() != Some(&b'-')
}

/// A last label that the WHATWG URL standard's ends-in-a-number rule reads as a number: decimal
/// digits alone, or `0x` or `0X` followed by zero or more hexadecimal digits.
fn is_numeric_label(label: &str) -> bool {
    let decimal = !label.is_empty() && label.bytes().all(|byte| byte.is_ascii_digit());
    let hexadecimal = label
        .strip_prefix("0x")
        .or_else(|| label.strip_prefix("0X"))
        .is_some_and(|rest| rest.bytes().all(|byte| byte.is_ascii_hexdigit()));
    decimal || hexadecimal
}

/// Whether a token is an RFC 1123 host name whose last label is not a number.
fn is_host_name(raw: &str) -> bool {
    raw.len() <= LONGEST_NAME
        && raw.split('.').all(is_label)
        && !raw.rsplit('.').next().is_some_and(is_numeric_label)
}

/// The canonical address a token spells under `or_ip`: an IPv4 address bare and an IPv6 address in
/// brackets, as a URL writes each.
fn bare_or_bracketed(raw: &str) -> Option<String> {
    let bracketed = raw
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .filter(|inner| !inner.contains(['\n', '\r', '\u{2028}', '\u{2029}']));
    let address = read_address(bracketed.unwrap_or(raw))?;
    let wanted = if bracketed.is_some() {
        IpVersion::V6
    } else {
        IpVersion::V4
    };
    (address.version() == wanted).then_some(address.canonical)
}

/// A host name.
#[derive(Clone, Debug)]
#[must_use]
pub struct Host {
    or_ip: bool,
}

/// Validates an RFC 1123 host name with no trailing dot, output in lowercase.
pub fn host() -> Host {
    Host { or_ip: false }
}

impl Host {
    /// Accepts an IPv4 address and an IPv6 address in brackets too, output in the canonical form
    /// `ip()` writes, without brackets.
    pub fn or_ip(mut self) -> Self {
        self.or_ip = true;
        self
    }
}

impl Validator for Host {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        if is_host_name(input) {
            return Ok(input.to_ascii_lowercase());
        }
        let address = if self.or_ip {
            bare_or_bracketed(input)
        } else {
            None
        };
        address.ok_or_else(|| {
            vec![if self.or_ip {
                HOST_OR_IP_ISSUE.issue(NoParams {})
            } else {
                HOST_ISSUE.issue(NoParams {})
            }]
        })
    }

    fn input_schema(&self) -> InputSchema {
        if self.or_ip {
            string_schema(vec![(
                "anyOf",
                json!([
                    { "format": "hostname" },
                    { "format": "ipv4" },
                    { "pattern": BRACKETED_PATTERN },
                ]),
            )])
        } else {
            string_schema(vec![("format", json!("hostname"))])
        }
    }
}

/// An IP address.
#[derive(Clone, Debug)]
#[must_use]
pub struct Ip {
    version: Option<IpVersion>,
}

/// Validates an IPv4 address in dotted decimal with no leading zero, or an IPv6 address in a text
/// form of RFC 4291 with no zone. Output is the address; its `Display` is the canonical form, so
/// two spellings of one address print alike.
pub fn ip() -> Ip {
    Ip { version: None }
}

impl Ip {
    /// Accepts one version alone.
    pub fn version(mut self, version: IpVersion) -> Self {
        self.version = Some(version);
        self
    }
}

impl Validator for Ip {
    type Output = IpAddr;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<IpAddr, Vec<Issue>> {
        match read_address(input) {
            Some(address)
                if self
                    .version
                    .is_none_or(|version| address.version() == version) =>
            {
                Ok(address.ip)
            }
            _ => Err(vec![match self.version {
                None => IP_ISSUE.issue(NoParams {}),
                Some(IpVersion::V4) => IP_V4_ISSUE.issue(NoParams {}),
                Some(IpVersion::V6) => IP_V6_ISSUE.issue(NoParams {}),
            }]),
        }
    }

    fn input_schema(&self) -> InputSchema {
        match self.version {
            None => string_schema(vec![(
                "anyOf",
                json!([{ "format": "ipv4" }, { "format": "ipv6" }]),
            )]),
            Some(IpVersion::V4) => string_schema(vec![("format", json!("ipv4"))]),
            Some(IpVersion::V6) => string_schema(vec![("format", json!("ipv6"))]),
        }
    }
}

/// A CIDR block: its address and prefix length.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct CidrBlock {
    /// The network address.
    pub address: IpAddr,
    /// The prefix length.
    pub prefix: u8,
}

/// A CIDR block.
#[derive(Clone, Debug)]
#[must_use]
pub struct Cidr {
    version: Option<IpVersion>,
}

/// Validates a CIDR block: an address as `ip()` reads it, a `/`, and a decimal prefix with no
/// leading zero, from 0 through 32 for IPv4 and through 128 for IPv6. The address is the network
/// itself: a bit set below the prefix is rejected with its own sentence.
pub fn cidr() -> Cidr {
    Cidr { version: None }
}

impl Cidr {
    /// Accepts one version alone.
    pub fn version(mut self, version: IpVersion) -> Self {
        self.version = Some(version);
        self
    }
}

/// The published pattern: an address of hexadecimal digits, `:`, and `.`, then a prefix from 0
/// through 128. It states neither the family nor the host bits.
const CIDR_PATTERN: &str = "^[0-9A-Fa-f:.]+/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$";

/// The address and prefix a block token spells, the prefix within its family's bits.
fn read_block(raw: &str) -> Option<(Address, u8)> {
    let (address, prefix) = raw.split_once('/')?;
    let valid = prefix == "0"
        || (prefix.len() <= 3
            && prefix.starts_with(|first: char| ('1'..='9').contains(&first))
            && prefix.bytes().all(|byte| byte.is_ascii_digit()));
    if !valid || address.contains('/') {
        return None;
    }
    let prefix: u8 = prefix.parse().ok()?;
    let address = read_address(address)?;
    (prefix <= address.bits().1).then_some((address, prefix))
}

impl Validator for Cidr {
    type Output = CidrBlock;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<CidrBlock, Vec<Issue>> {
        let rejection = || {
            vec![match self.version {
                None => CIDR_ISSUE.issue(NoParams {}),
                Some(IpVersion::V4) => CIDR_V4_ISSUE.issue(NoParams {}),
                Some(IpVersion::V6) => CIDR_V6_ISSUE.issue(NoParams {}),
            }]
        };
        let (address, prefix) = read_block(input).ok_or_else(rejection)?;
        if self
            .version
            .is_some_and(|version| address.version() != version)
        {
            return Err(rejection());
        }
        if address.has_no_host_bits(prefix) {
            Ok(CidrBlock {
                address: address.ip,
                prefix,
            })
        } else {
            Err(vec![CIDR_HOST_BITS_ISSUE.issue(NoParams {})])
        }
    }

    fn input_schema(&self) -> InputSchema {
        string_schema(vec![("pattern", json!(CIDR_PATTERN))])
    }
}
