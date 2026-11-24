//! The IP address grammar `ip()`, `cidr()`, and `host()` share. IPv4 is four decimal parts with no
//! leading zero; IPv6 is a text form of RFC 4291 with no zone and no brackets. Each reads into its
//! parts, and the canonical text is the form RFC 5952 recommends.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::IpVersion;

/// One address: its family, its bits, and its canonical text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Address {
    pub(crate) ip: IpAddr,
    pub(crate) canonical: String,
}

impl Address {
    /// The family.
    pub(crate) fn version(&self) -> IpVersion {
        match self.ip {
            IpAddr::V4(_) => IpVersion::V4,
            IpAddr::V6(_) => IpVersion::V6,
        }
    }

    /// The address as a number, with the width of its family in bits.
    pub(crate) fn bits(&self) -> (u128, u8) {
        match self.ip {
            IpAddr::V4(address) => (u128::from(u32::from(address)), 32),
            IpAddr::V6(address) => (u128::from(address), 128),
        }
    }

    /// Whether every bit of the address below the first `prefix` bits is zero.
    pub(crate) fn has_no_host_bits(&self, prefix: u8) -> bool {
        let (value, width) = self.bits();
        let host_bits = u32::from(width.saturating_sub(prefix));
        host_bits == 0 || value.trailing_zeros() >= host_bits
    }
}

/// One decimal part: `0`, or a digit from 1 through 9 and up to two more, from 0 through 255.
fn decimal_part(piece: &str) -> Option<u8> {
    let valid = match piece.as_bytes() {
        [b'0'] => true,
        [first, rest @ ..] => {
            (b'1'..=b'9').contains(first) && rest.len() <= 2 && rest.iter().all(u8::is_ascii_digit)
        }
        [] => false,
    };
    if valid { piece.parse().ok() } else { None }
}

/// The four parts of an IPv4 address, each from 0 through 255 with no leading zero.
fn ipv4_of(text: &str) -> Option<[u8; 4]> {
    let mut parts = [0u8; 4];
    let mut pieces = text.split('.');
    for part in &mut parts {
        *part = decimal_part(pieces.next()?)?;
    }
    pieces.next().is_none().then_some(parts)
}

/// The two groups an IPv4 address fills as the last 32 bits of an IPv6 address.
fn embedded_of(text: &str) -> Option<[u16; 2]> {
    let [first, second, third, fourth] = ipv4_of(text)?;
    Some([
        u16::from(first) << 8 | u16::from(second),
        u16::from(third) << 8 | u16::from(fourth),
    ])
}

/// The groups hexadecimal pieces spell, each of one to four digits.
fn hex_groups(pieces: &[&str]) -> Option<Vec<u16>> {
    pieces
        .iter()
        .map(|piece| {
            let valid = (1..=4).contains(&piece.len())
                && piece.bytes().all(|each| each.is_ascii_hexdigit());
            if valid {
                u16::from_str_radix(piece, 16).ok()
            } else {
                None
            }
        })
        .collect()
}

/// The groups one side of `::` spells: hexadecimal groups joined by `:`, the last of which may be
/// an IPv4 address when the side ends the address. An empty side spells none.
fn groups_of(side: &str, ends_address: bool) -> Option<Vec<u16>> {
    if side.is_empty() {
        return Some(Vec::new());
    }
    let pieces: Vec<&str> = side.split(':').collect();
    let (tail, head) = pieces.split_last()?;
    if !ends_address || !tail.contains('.') {
        return hex_groups(&pieces);
    }
    let mut groups = hex_groups(head)?;
    groups.extend(embedded_of(tail)?);
    Some(groups)
}

/// The eight groups of an IPv6 address in a text form of RFC 4291.
fn ipv6_of(text: &str) -> Option<[u16; 8]> {
    let halves: Vec<&str> = text.split("::").collect();
    let groups = match halves.as_slice() {
        [whole] => groups_of(whole, true)?,
        [before, after] => {
            let before = groups_of(before, false)?;
            let after = groups_of(after, true)?;
            let missing = 8usize
                .checked_sub(before.len() + after.len())
                .filter(|each| *each > 0)?;
            let mut groups = before;
            groups.extend(std::iter::repeat_n(0, missing));
            groups.extend(after);
            groups
        }
        _ => return None,
    };
    groups.try_into().ok()
}

/// The first longest run of two or more zero groups, as its start and length.
fn longest_zero_run(groups: &[u16; 8]) -> Option<(usize, usize)> {
    let mut best = (0, 0);
    let mut start = 0;
    for (index, group) in groups.iter().chain(std::iter::once(&1)).enumerate() {
        if *group != 0 {
            if index - start > best.1 {
                best = (start, index - start);
            }
            start = index + 1;
        }
    }
    (best.1 >= 2).then_some(best)
}

/// Eight groups as hexadecimal, lowercase with no leading zeros, the first longest zero run as `::`.
fn hex_text(groups: &[u16; 8]) -> String {
    let hex: Vec<String> = groups.iter().map(|group| format!("{group:x}")).collect();
    match longest_zero_run(groups) {
        None => hex.join(":"),
        Some((start, length)) => {
            format!(
                "{}::{}",
                hex[..start].join(":"),
                hex[start + length..].join(":")
            )
        }
    }
}

/// Eight groups in the form RFC 5952 recommends, an IPv4-mapped address with its last 32 bits dotted.
fn ipv6_text(groups: &[u16; 8]) -> String {
    let mapped = groups[..5].iter().all(|group| *group == 0) && groups[5] == 0xffff;
    if !mapped {
        return hex_text(groups);
    }
    let [a, b] = groups[6].to_be_bytes();
    let [c, d] = groups[7].to_be_bytes();
    format!("::ffff:{a}.{b}.{c}.{d}")
}

/// An IPv4 or IPv6 address as `ip()` reads it.
pub(crate) fn read_address(text: &str) -> Option<Address> {
    if let Some([a, b, c, d]) = ipv4_of(text) {
        return Some(Address {
            ip: IpAddr::V4(Ipv4Addr::new(a, b, c, d)),
            canonical: text.to_owned(),
        });
    }
    let groups = ipv6_of(text)?;
    Some(Address {
        ip: IpAddr::V6(Ipv6Addr::from(groups)),
        canonical: ipv6_text(&groups),
    })
}
