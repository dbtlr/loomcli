//! The value of `mcp --http`: a port, or `host:port` with an IPv6 host in brackets.

use std::net::Ipv6Addr;

use loomcli_core::{InputSchema, Issue, ValidationContext, Validator, with_schema_dialect};
use serde_json::{Map, json};

use super::messages;

/// Where the HTTP server listens, and the address as the operator wrote it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct HttpAddress {
    /// The host to bind, without brackets: 127.0.0.1 for a port alone.
    pub(super) host: String,
    pub(super) port: u16,
    /// The host as the URL line writes it, an IPv6 host in brackets.
    pub(super) url_host: String,
    pub(super) written: String,
}

/// The host a port alone binds, as the protocol advises for a server that runs locally.
const DEFAULT_HOST: &str = "127.0.0.1";

/// A decimal port of one to five digits, at most 65535.
fn port_of(text: &str) -> Option<u16> {
    if text.is_empty() || text.len() > 5 || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// A host name as the option reads one: ASCII letters, digits, `_`, `.`, and `-`.
fn is_name(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

/// The address a value names, or nothing when the option does not accept it.
pub(super) fn address_of(written: &str) -> Option<HttpAddress> {
    if written.contains(['\t', '\r', '\n']) {
        return None;
    }
    let address = |host: &str, url_host: String, port: u16| HttpAddress {
        host: host.to_owned(),
        port,
        url_host,
        written: written.to_owned(),
    };
    if let Some(bracketed) = written.strip_prefix('[') {
        let (host, port) = bracketed.split_once("]:")?;
        if host.contains(']') {
            return None;
        }
        let port = port_of(port)?;
        host.parse::<Ipv6Addr>().ok()?;
        return Some(address(host, format!("[{host}]"), port));
    }
    match written.rsplit_once(':') {
        None => Some(address(
            DEFAULT_HOST,
            DEFAULT_HOST.to_owned(),
            port_of(written)?,
        )),
        Some((host, port)) => {
            let port = port_of(port)?;
            is_name(host).then(|| address(host, host.to_owned(), port))
        }
    }
}

/// The `--http` value, read as the address it names, or the sentence that names the accepted
/// forms. It publishes a plain string schema.
pub(super) struct HttpAddressInput;

impl Validator for HttpAddressInput {
    type Output = HttpAddress;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<HttpAddress, Vec<Issue>> {
        address_of(input).ok_or_else(|| vec![Issue::new(messages::HTTP_ADDRESS_ISSUE)])
    }

    fn input_schema(&self) -> InputSchema {
        let mut schema = Map::new();
        schema.insert("type".to_owned(), json!("string"));
        Some(with_schema_dialect(schema))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::address_of;

    #[test]
    fn accepts_a_port_or_host_and_port() {
        for (written, host, port, url_host) in [
            ("0", "127.0.0.1", 0, "127.0.0.1"),
            ("8080", "127.0.0.1", 8080, "127.0.0.1"),
            ("localhost:65535", "localhost", 65_535, "localhost"),
            ("0.0.0.0:80", "0.0.0.0", 80, "0.0.0.0"),
            ("[::1]:8080", "::1", 8080, "[::1]"),
            ("[::]:0", "::", 0, "[::]"),
        ] {
            let address = address_of(written).unwrap();
            assert_eq!(
                (
                    address.host.as_str(),
                    address.port,
                    address.url_host.as_str(),
                    address.written.as_str()
                ),
                (host, port, url_host, written),
                "{written}"
            );
        }
    }

    #[test]
    fn refuses_every_other_form() {
        for written in [
            ":8080",
            "::1:8080",
            "[::1]",
            "65536",
            "[nope]:80",
            "a b:80",
            "x:-1",
            "[::\t1]:80",
            "[::\n1]:80",
            "[::\r1]:80",
        ] {
            assert_eq!(address_of(written), None, "{written:?}");
        }
    }
}
