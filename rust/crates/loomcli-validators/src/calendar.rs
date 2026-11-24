//! The fields the date and time validators read, shared by each default grammar and every layout.
//!
//! A grammar or a layout captures each field under one group name (`year`, `month`, `day`, `hour`,
//! `minute`, `second`, `fraction`, `meridiem`, and the offset's `zulu`, `sign`, `offsetHour`, and
//! `offsetMinute`), so one reading checks each field's range and turns the fields into a value.

use std::sync::LazyLock;

use regex::{Captures, Regex};

/// An offset as a pattern states it: `Z`, `z`, or a sign and `hh`, `hhmm`, or `hh:mm`, with no range.
pub(crate) const OFFSET_PATTERN: &str = r"[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?";

/// The same offset with each part captured under the group name the readers use.
pub(crate) const OFFSET_GROUPS: &str =
    r"(?<zulu>[Zz])|(?<sign>[+-])(?<offsetHour>[0-9]{2})(?::?(?<offsetMinute>[0-9]{2}))?";

/// The default grammar of `time()`: RFC 3339's partial time with the seconds optional.
pub(crate) const TIME_GRAMMAR: &str =
    r"^(?<hour>[0-9]{2}):(?<minute>[0-9]{2})(?::(?<second>[0-9]{2})(?:\.(?<fraction>[0-9]+))?)?$";

/// The published pattern of the default time grammar, with each field's range.
pub(crate) const TIME_PATTERN: &str =
    r"^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]+)?)?$";

/// Milliseconds in a second, a minute, an hour, and a day.
pub(crate) const SECOND: u64 = 1000;
pub(crate) const MINUTE: u64 = 60_000;
pub(crate) const HOUR: u64 = 3_600_000;
pub(crate) const DAY: u64 = 86_400_000;
pub(crate) const WEEK: u64 = 604_800_000;

/// What one match captured: each group's text, or `None` for a part the token left out.
#[derive(Clone, Copy, Default)]
pub(crate) struct Fields<'a> {
    year: Option<&'a str>,
    month: Option<&'a str>,
    day: Option<&'a str>,
    hour: Option<&'a str>,
    minute: Option<&'a str>,
    second: Option<&'a str>,
    fraction: Option<&'a str>,
    meridiem: Option<&'a str>,
    zulu: Option<&'a str>,
    sign: Option<&'a str>,
    offset_hour: Option<&'a str>,
    offset_minute: Option<&'a str>,
}

impl<'a> Fields<'a> {
    /// The fields of one match.
    pub(crate) fn of(captures: &Captures<'a>) -> Self {
        let group = |name: &str| captures.name(name).map(|found| found.as_str());
        Self {
            year: group("year"),
            month: group("month"),
            day: group("day"),
            hour: group("hour"),
            minute: group("minute"),
            second: group("second"),
            fraction: group("fraction"),
            meridiem: group("meridiem"),
            zulu: group("zulu"),
            sign: group("sign"),
            offset_hour: group("offsetHour"),
            offset_minute: group("offsetMinute"),
        }
    }
}

/// A group's digits as a number, zero for a group the token left out.
fn number_of(group: Option<&str>) -> u32 {
    group.and_then(|digits| digits.parse().ok()).unwrap_or(0)
}

/// Whether `year` is a leap year of the proleptic Gregorian calendar.
fn is_leap(year: u32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

/// Whether the parts name a real day of the proleptic Gregorian calendar.
pub(crate) fn is_real_day(year: u32, month: u32, day: u32) -> bool {
    let length = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=length).contains(&day)
}

/// The date the fields name as `YYYY-MM-DD`, or `None` when it is not a real day.
pub(crate) fn calendar_date(fields: &Fields<'_>) -> Option<String> {
    let (year, month, day) = (fields.year?, fields.month?, fields.day?);
    is_real_day(
        number_of(Some(year)),
        number_of(Some(month)),
        number_of(Some(day)),
    )
    .then(|| format!("{year}-{month:0>2}-{day:0>2}"))
}

/// The hour from 0 through 23, or `None` when it is out of range. With a `meridiem`, the hour is a
/// 12-hour clock's, 1 through 12, so `12AM` is midnight and `12PM` noon.
fn hour_of(fields: &Fields<'_>) -> Option<u32> {
    let value = number_of(fields.hour);
    match fields.meridiem {
        None => (value <= 23).then_some(value),
        Some(meridiem) => {
            if !(1..=12).contains(&value) {
                return None;
            }
            let afternoon = if meridiem.eq_ignore_ascii_case("pm") {
                12
            } else {
                0
            };
            Some(value % 12 + afternoon)
        }
    }
}

/// A fraction of a second as milliseconds, truncated rather than rounded.
fn milliseconds_of(fraction: Option<&str>) -> u32 {
    let digits: String = fraction.unwrap_or("").chars().take(3).collect();
    number_of(Some(&format!("{digits:0<3}")))
}

/// A time of day the fields name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ClockTime {
    pub(crate) hours: u32,
    pub(crate) minutes: u32,
    pub(crate) seconds: u32,
    pub(crate) milliseconds: u32,
}

impl ClockTime {
    /// The milliseconds since midnight.
    pub(crate) fn since_midnight(self) -> u64 {
        u64::from(self.hours) * HOUR
            + u64::from(self.minutes) * MINUTE
            + u64::from(self.seconds) * SECOND
            + u64::from(self.milliseconds)
    }
}

/// The time of day the fields name, or `None` when a field is out of range.
pub(crate) fn time_of_day(fields: &Fields<'_>) -> Option<ClockTime> {
    let hours = hour_of(fields)?;
    let minutes = number_of(fields.minute);
    let seconds = number_of(fields.second);
    (minutes <= 59 && seconds <= 59).then(|| ClockTime {
        hours,
        minutes,
        seconds,
        milliseconds: milliseconds_of(fields.fraction),
    })
}

/// The wall time the fields name, or `None` when a field is out of range.
pub(crate) fn wall_time(fields: &Fields<'_>) -> Option<jiff::civil::DateTime> {
    let (year, month, day) = (
        number_of(fields.year),
        number_of(fields.month),
        number_of(fields.day),
    );
    if !is_real_day(year, month, day) {
        return None;
    }
    let time = time_of_day(fields)?;
    jiff::civil::DateTime::new(
        i16::try_from(year).ok()?,
        i8::try_from(month).ok()?,
        i8::try_from(day).ok()?,
        i8::try_from(time.hours).ok()?,
        i8::try_from(time.minutes).ok()?,
        i8::try_from(time.seconds).ok()?,
        i32::try_from(time.milliseconds * 1_000_000).ok()?,
    )
    .ok()
}

/// The offset a token names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Offset {
    /// The token names no offset.
    Absent,
    /// An offset in seconds east of UTC; `Z` is zero.
    Seconds(i32),
    /// An offset whose hour or minute is out of range.
    Invalid,
}

/// The offset the fields name. A missing minute, as in `+05`, counts as zero.
pub(crate) fn offset_of(fields: &Fields<'_>) -> Offset {
    if fields.zulu.is_some() {
        return Offset::Seconds(0);
    }
    let Some(sign) = fields.sign else {
        return Offset::Absent;
    };
    let hours = number_of(fields.offset_hour);
    let minutes = number_of(fields.offset_minute);
    if hours > 23 || minutes > 59 {
        return Offset::Invalid;
    }
    let magnitude = i32::try_from(hours * 3600 + minutes * 60).unwrap_or(0);
    Offset::Seconds(if sign == "-" { -magnitude } else { magnitude })
}

/// The time of day a token in the default grammar names, in milliseconds since midnight.
pub(crate) fn read_time_of_day(raw: &str) -> Option<u64> {
    static GRAMMAR: LazyLock<Regex> = LazyLock::new(|| crate::grammar::constant(TIME_GRAMMAR));
    let captures = GRAMMAR.captures(raw)?;
    time_of_day(&Fields::of(&captures)).map(ClockTime::since_midnight)
}

/// A time of day as a message prints it: `hh:mm`, with `:ss` when the seconds or milliseconds are
/// not zero, and a fraction of the milliseconds with its trailing zeros dropped when they are not.
pub(crate) fn format_time_of_day(milliseconds: u64) -> String {
    let hours = milliseconds / HOUR;
    let minutes = milliseconds % HOUR / MINUTE;
    let seconds = milliseconds % MINUTE / SECOND;
    let fraction = milliseconds % SECOND;
    let clock = format!("{hours:02}:{minutes:02}");
    if seconds == 0 && fraction == 0 {
        return clock;
    }
    let with_seconds = format!("{clock}:{seconds:02}");
    if fraction == 0 {
        return with_seconds;
    }
    let digits = format!("{fraction:03}");
    format!("{with_seconds}.{}", digits.trim_end_matches('0'))
}
