//! The RFC 3986 `URI` production, built from the RFC's own rule names:
//! `scheme ":" hier-part [ "?" query ] [ "#" fragment ]`. Letters are spelled in both cases, so the
//! expression needs no case-insensitive flag.

use std::sync::LazyLock;

use regex::Regex;

use crate::grammar::constant;

const HEX: &str = "[0-9A-Fa-f]";
const UNRESERVED: &str = r"A-Za-z0-9\-._~";
const SUB_DELIMS: &str = "!$&'()*+,;=";
const SCHEME: &str = r"[A-Za-z][A-Za-z0-9+\-.]*";

fn uri_source() -> String {
    let pct_encoded = format!("%{HEX}{{2}}");
    let pchar = format!("(?:[{UNRESERVED}{SUB_DELIMS}:@]|{pct_encoded})");
    let userinfo = format!("(?:[{UNRESERVED}{SUB_DELIMS}:]|{pct_encoded})*");
    let dec_octet = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
    let ipv4 = format!(r"{dec_octet}(?:\.{dec_octet}){{3}}");
    let h16 = format!("{HEX}{{1,4}}");
    let ls32 = format!("(?:{h16}:{h16}|{ipv4})");
    let ipv6 = format!(
        "(?:{})",
        [
            format!("(?:{h16}:){{6}}{ls32}"),
            format!("::(?:{h16}:){{5}}{ls32}"),
            format!("(?:{h16})?::(?:{h16}:){{4}}{ls32}"),
            format!("(?:(?:{h16}:){{0,1}}{h16})?::(?:{h16}:){{3}}{ls32}"),
            format!("(?:(?:{h16}:){{0,2}}{h16})?::(?:{h16}:){{2}}{ls32}"),
            format!("(?:(?:{h16}:){{0,3}}{h16})?::{h16}:{ls32}"),
            format!("(?:(?:{h16}:){{0,4}}{h16})?::{ls32}"),
            format!("(?:(?:{h16}:){{0,5}}{h16})?::{h16}"),
            format!("(?:(?:{h16}:){{0,6}}{h16})?::"),
        ]
        .join("|")
    );
    let ipv_future = format!(r"[vV]{HEX}+\.[{UNRESERVED}{SUB_DELIMS}:]+");
    let ip_literal = format!(r"\[(?:{ipv6}|{ipv_future})\]");
    let reg_name = format!("(?:[{UNRESERVED}{SUB_DELIMS}]|{pct_encoded})*");
    let host = format!("(?:{ip_literal}|{ipv4}|{reg_name})");
    let authority = format!("(?:{userinfo}@)?{host}(?::[0-9]*)?");
    let path_abempty = format!("(?:/{pchar}*)*");
    let path_absolute = format!("/(?:{pchar}+(?:/{pchar}*)*)?");
    let path_rootless = format!("{pchar}+(?:/{pchar}*)*");
    // RFC 3986 also allows an empty path, which the published `uri` format refuses, so soundness
    // drops it.
    let hier_part = format!("(?://{authority}{path_abempty}|{path_absolute}|{path_rootless})");
    let query_or_fragment = format!("(?:{pchar}|[/?])*");
    format!(r"^{SCHEME}:{hier_part}(?:\?{query_or_fragment})?(?:#{query_or_fragment})?$")
}

static URI: LazyLock<Regex> = LazyLock::new(|| constant(&uri_source()));
static SCHEME_NAME: LazyLock<Regex> = LazyLock::new(|| constant(&format!("^{SCHEME}$")));

/// Whether `raw` matches the RFC 3986 `URI` production with a nonempty path or authority.
pub(crate) fn is_uri(raw: &str) -> bool {
    URI.is_match(raw)
}

/// Whether `raw` is an RFC 3986 scheme name.
pub(crate) fn is_scheme(raw: &str) -> bool {
    SCHEME_NAME.is_match(raw)
}
