//! The operator's duration grammar (systemd.time(7) spans without a sign) and size grammar (IEC
//! 80000-13), with the readers and printers the validators and their issue codes share.

use std::sync::LazyLock;

use regex::Regex;

use crate::calendar::{DAY, HOUR, MINUTE, SECOND, WEEK};
use crate::grammar::constant;
use crate::js::{JS_SPACE_CLASS, is_js_whitespace, js_number};

/// One decimal number: digits with an optional fraction, which `bytes` reads as well.
const DECIMAL: &str = r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)";

/// Each unit's spelling and length in milliseconds. A spelling comes after any longer spelling it
/// begins, so the pattern built from this order matches greedily.
const UNIT_LENGTHS: [(&str, u64); 20] = [
    ("minutes", MINUTE),
    ("seconds", SECOND),
    ("minute", MINUTE),
    ("second", SECOND),
    ("hours", HOUR),
    ("weeks", WEEK),
    ("days", DAY),
    ("hour", HOUR),
    ("msec", 1),
    ("week", WEEK),
    ("day", DAY),
    ("min", MINUTE),
    ("sec", SECOND),
    ("hr", HOUR),
    ("ms", 1),
    ("d", DAY),
    ("h", HOUR),
    ("m", MINUTE),
    ("s", SECOND),
    ("w", WEEK),
];

/// The units a message prints a whole number of milliseconds in, longest first.
const PRINTED_UNITS: [(&str, u64); 5] = [
    ("d", DAY),
    ("h", HOUR),
    ("m", MINUTE),
    ("s", SECOND),
    ("ms", 1),
];

fn unit_alternatives() -> String {
    UNIT_LENGTHS
        .iter()
        .map(|(spelling, _)| *spelling)
        .collect::<Vec<_>>()
        .join("|")
}

/// The grammar as one pattern whose units are the given alternatives and whose whitespace is `space`.
fn grammar_of(units: &str, space: &str) -> String {
    let part = format!("{DECIMAL}{space}{units}");
    format!("^{space}{DECIMAL}(?:{space}{units}(?:{space}{part})*)?{space}$")
}

/// The pattern the validator publishes, which is the grammar whole.
pub(crate) static DURATION_PATTERN: LazyLock<String> =
    LazyLock::new(|| grammar_of(&format!("(?:{})", unit_alternatives()), r"\s*"));

static SPACE: LazyLock<String> = LazyLock::new(|| format!("{JS_SPACE_CLASS}*"));
static GRAMMAR: LazyLock<Regex> =
    LazyLock::new(|| constant(&grammar_of(&format!("(?:{})", unit_alternatives()), &SPACE)));
static GRAMMAR_WITH_CAPITAL_M: LazyLock<Regex> = LazyLock::new(|| {
    constant(&grammar_of(
        &format!("(?:M|{})", unit_alternatives()),
        &SPACE,
    ))
});
static COMPONENT: LazyLock<Regex> = LazyLock::new(|| {
    constant(&format!(
        "{}(?<number>{DECIMAL}){}(?<unit>(?:{}))",
        *SPACE,
        *SPACE,
        unit_alternatives()
    ))
});
static BARE_NUMBER: LazyLock<Regex> =
    LazyLock::new(|| constant(&format!("^{}{DECIMAL}{}$", *SPACE, *SPACE)));

const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

/// The milliseconds one decimal number spells in a unit of `length` milliseconds. The digits are
/// scaled to a whole number first, so `1.1s` is 1100 and not 1100.0000000000002.
fn scaled(spelled: &str, length: u64) -> f64 {
    let (integral, fraction) = spelled.split_once('.').unwrap_or((spelled, ""));
    let digits = format!("{integral}{fraction}");
    let number: f64 = digits.parse().unwrap_or(0.0);
    let places = i32::try_from(fraction.len()).unwrap_or(i32::MAX);
    #[allow(clippy::cast_precision_loss)]
    let length = length as f64;
    number * length / 10f64.powi(places)
}

/// The milliseconds a duration token spells, or `None` when it is outside the grammar or too long
/// to count in safe integers.
pub(crate) fn read_duration(raw: &str) -> Option<f64> {
    if !GRAMMAR.is_match(raw) {
        return None;
    }
    let total = if BARE_NUMBER.is_match(raw) {
        scaled(trim(raw), SECOND)
    } else {
        COMPONENT
            .captures_iter(raw)
            .map(|found| {
                let unit = found.name("unit").map_or("", |each| each.as_str());
                let length = UNIT_LENGTHS
                    .iter()
                    .find(|(spelling, _)| *spelling == unit)
                    .map_or(0, |(_, length)| *length);
                scaled(
                    found.name("number").map_or("", |each| each.as_str()),
                    length,
                )
            })
            .sum()
    };
    (total.is_finite() && total <= MAX_SAFE).then_some(total)
}

/// What `String.prototype.trim` leaves of `text`.
pub(crate) fn trim(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

/// Whether a token is a duration except that it spells minutes with a capital `M`.
pub(crate) fn spells_minutes_as_capital_m(raw: &str) -> bool {
    raw.contains('M') && GRAMMAR_WITH_CAPITAL_M.is_match(raw)
}

/// A count of milliseconds as the grammar spells it, such as `1h30m` for 5400000. A count that is
/// not a whole number of milliseconds prints as milliseconds alone.
pub(crate) fn format_duration(milliseconds: f64) -> String {
    if milliseconds == 0.0 {
        return "0s".to_owned();
    }
    if milliseconds.fract() != 0.0 || !(0.0..=MAX_SAFE).contains(&milliseconds) {
        return format!("{}ms", js_number(milliseconds));
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let mut rest = milliseconds as u64;
    let mut printed = String::new();
    for (name, length) in PRINTED_UNITS {
        let count = rest / length;
        if count > 0 {
            printed.push_str(&format!("{count}{name}"));
            rest -= count * length;
        }
    }
    printed
}

/// The duration a count of milliseconds stands for, to nanosecond precision.
pub(crate) fn as_duration(milliseconds: f64) -> std::time::Duration {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let whole = milliseconds.floor() as u64;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let nanoseconds = ((milliseconds - milliseconds.floor()) * 1e6).round() as u64;
    std::time::Duration::from_millis(whole) + std::time::Duration::from_nanos(nanoseconds)
}

// ---- sizes ----

const KILO: u64 = 1000;
const KIBI: u64 = 1024;

/// Each unit a message prints, with its length in bytes: the byte, the decimal, then the binary units.
const PRINTED_SIZES: [(&str, u64); 11] = [
    ("B", 1),
    ("kB", KILO),
    ("MB", KILO.pow(2)),
    ("GB", KILO.pow(3)),
    ("TB", KILO.pow(4)),
    ("PB", KILO.pow(5)),
    ("KiB", KIBI),
    ("MiB", KIBI.pow(2)),
    ("GiB", KIBI.pow(3)),
    ("TiB", KIBI.pow(4)),
    ("PiB", KIBI.pow(5)),
];

/// The extra spellings the grammar reads beside the printed ones.
const EXTRA_SIZES: [(&str, u64); 6] = [
    ("KB", KILO),
    ("Ki", KIBI),
    ("Mi", KIBI.pow(2)),
    ("Gi", KIBI.pow(3)),
    ("Ti", KIBI.pow(4)),
    ("Pi", KIBI.pow(5)),
];

/// The units as alternatives, a binary prefix with its `B` before the same prefix alone, and the
/// kilo prefix as one class for its two cases.
const SIZE_UNIT: &str = "(?:KiB|MiB|GiB|TiB|PiB|Ki|Mi|Gi|Ti|Pi|[kK]B|MB|GB|TB|PB|B)";

/// The pattern the validator publishes, which is the grammar whole.
pub(crate) static BYTES_PATTERN: LazyLock<String> =
    LazyLock::new(|| format!(r"^\s*{DECIMAL}\s*{SIZE_UNIT}?\s*$"));

static SIZE_GRAMMAR: LazyLock<Regex> = LazyLock::new(|| {
    constant(&format!(
        "^{}(?<number>{DECIMAL}){}(?<unit>{SIZE_UNIT})?{}$",
        *SPACE, *SPACE, *SPACE
    ))
});

const LARGEST: u128 = 9_007_199_254_740_991;

/// The whole bytes a decimal number spells in a unit of `length` bytes, or `None` for a fraction of
/// a byte. The digits are read as an exact decimal, so `2.01kB` is 2010.
fn whole_bytes(spelled: &str, length: u64) -> Option<u128> {
    let (integral, fraction) = spelled.split_once('.').unwrap_or((spelled, ""));
    // Trailing zeros of a fraction change no value, and dropping them keeps the digits few.
    let fraction = fraction.trim_end_matches('0');
    let digits = format!("{integral}{fraction}");
    let digits = digits.trim_start_matches('0');
    let number: u128 = if digits.is_empty() {
        0
    } else {
        digits.parse().ok()?
    };
    let scaled = number.checked_mul(u128::from(length))?;
    let divisor = 10u128.checked_pow(u32::try_from(fraction.len()).ok()?)?;
    (scaled % divisor == 0).then_some(scaled / divisor)
}

/// The bytes a size token spells, or `None` when it is outside the grammar, spells a fraction of a
/// byte, or is beyond the safe integers.
pub(crate) fn read_bytes(raw: &str) -> Option<u64> {
    let found = SIZE_GRAMMAR.captures(raw)?;
    let unit = found.name("unit").map_or("B", |each| each.as_str());
    let length = PRINTED_SIZES
        .iter()
        .chain(EXTRA_SIZES.iter())
        .find(|(spelling, _)| *spelling == unit)
        .map_or(1, |(_, length)| *length);
    let bytes = whole_bytes(
        found.name("number").map_or("", |each| each.as_str()),
        length,
    )?;
    if bytes <= LARGEST {
        u64::try_from(bytes).ok()
    } else {
        None
    }
}

/// A byte count as the grammar spells it in a message: the whole-number spelling with the fewest
/// digits, a decimal unit on a tie, and `0B` for 0, so 1048576 is `1MiB` and 1500 is `1500B`.
pub(crate) fn format_bytes(bytes: u64) -> String {
    let mut best = format!("{bytes}B");
    let mut digits = bytes.to_string().len();
    for (name, length) in PRINTED_SIZES {
        if bytes % length == 0 {
            let count = (bytes / length).to_string();
            if count.len() < digits {
                digits = count.len();
                best = format!("{count}{name}");
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_constant_grammar_compiles() {
        let _ = (
            &*GRAMMAR,
            &*GRAMMAR_WITH_CAPITAL_M,
            &*COMPONENT,
            &*BARE_NUMBER,
            &*SIZE_GRAMMAR,
        );
        assert_eq!(read_duration("1h30m"), Some(5_400_000.0));
        assert_eq!(read_bytes("2.01kB"), Some(2010));
    }
}
