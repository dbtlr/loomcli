//! `date`, `date_time`, and `time`.

use std::sync::LazyLock;

use jiff::civil;
use jiff::tz::{self, TimeZone};
use loomcli_core::{Finding, InputSchema, Issue, Literal, ValidationContext, Validator};
use serde_json::{Map, Value, json};

use crate::bounds::{Bounds, Side, SpelledGrammar, set_spelled_bound};
use crate::calendar::{
    OFFSET_GROUPS, OFFSET_PATTERN, Offset, TIME_GRAMMAR, TIME_PATTERN, calendar_date,
    format_time_of_day, offset_of, read_time_of_day, time_of_day, wall_time,
};
use crate::codes::{
    DATE_ISSUE, DATE_LAYOUTS_ISSUE, DATE_TIME_ISSUE, DATE_TIME_LAYOUTS_ISSUE, Forms, Max, Min,
    NoParams, Range, TIME_ISSUE, TIME_LAYOUTS_ISSUE, TIME_MAX_ISSUE, TIME_MIN_ISSUE,
    TIME_RANGE_ISSUE,
};
use crate::fault;
use crate::grammar::constant;
use crate::layout::{
    DATE_RULES, DATE_TIME_RULES, DefaultGrammar, Reading, TIME_RULES, declare, reading_of,
};

fn schema_of(entries: &[(&str, Value)]) -> Map<String, Value> {
    entries
        .iter()
        .map(|(key, value)| ((*key).to_owned(), value.clone()))
        .collect()
}

static DATE_GRAMMAR: LazyLock<DefaultGrammar> = LazyLock::new(|| DefaultGrammar {
    expression: constant("^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})$"),
    schema: schema_of(&[("format", json!("date"))]),
    form: "YYYY-MM-DD",
});

static DATE_DEFAULT: LazyLock<Reading> =
    LazyLock::new(|| reading_of(&DATE_RULES, &[], &DATE_GRAMMAR));

/// A calendar date, as its ISO 8601 string.
#[derive(Clone, Debug)]
#[must_use]
pub struct Date {
    reading: Reading,
}

/// Validates a date: `YYYY-MM-DD` naming a real day of the proleptic Gregorian calendar, years 0000
/// through 9999, output as `YYYY-MM-DD` whichever form the token took.
pub fn date() -> Date {
    Date {
        reading: DATE_DEFAULT.clone(),
    }
}

impl Date {
    /// The layouts accepted beside `YYYY-MM-DD`, in order: POSIX strftime layouts of `%Y`, `%m`,
    /// and `%d` once each. A layout the factory cannot read, or an empty list, is a fault at the
    /// call.
    #[track_caller]
    pub fn layouts<const N: usize>(mut self, layouts: [&str; N]) -> Self {
        self.reading = declare(&DATE_RULES, &layouts, &DATE_GRAMMAR);
        self
    }
}

impl Validator for Date {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        self.reading.first(input, calendar_date).ok_or_else(|| {
            vec![match self.reading.forms() {
                None => DATE_ISSUE.issue(NoParams {}),
                Some(forms) => DATE_LAYOUTS_ISSUE.issue(Forms {
                    forms: forms.to_vec(),
                }),
            }]
        })
    }

    fn input_schema(&self) -> InputSchema {
        Some(loomcli_core::with_schema_dialect(
            self.reading.input_schema().clone(),
        ))
    }
}

/// The published pattern, which is looser than the validator: it admits both forms and every
/// offset spelling and states no range. A `format: "date-time"` would demand an offset the
/// validator does not.
fn date_time_pattern() -> String {
    format!(
        r"^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}[Tt ][0-9]{{2}}:[0-9]{{2}}(?::[0-9]{{2}}(?:\.[0-9]+)?)?(?:{OFFSET_PATTERN})?$"
    )
}

static DATE_TIME_GRAMMAR: LazyLock<DefaultGrammar> = LazyLock::new(|| DefaultGrammar {
    expression: constant(&format!(
        r"^(?<year>[0-9]{{4}})-(?<month>[0-9]{{2}})-(?<day>[0-9]{{2}})[Tt ](?<hour>[0-9]{{2}}):(?<minute>[0-9]{{2}})(?::(?<second>[0-9]{{2}})(?:\.(?<fraction>[0-9]+))?)?(?:{OFFSET_GROUPS})?$"
    )),
    schema: schema_of(&[("pattern", json!(date_time_pattern()))]),
    form: "YYYY-MM-DDThh:mm",
});

static DATE_TIME_DEFAULT: LazyLock<Reading> =
    LazyLock::new(|| reading_of(&DATE_TIME_RULES, &[], &DATE_TIME_GRAMMAR));

/// A date and time, read in the run's time zone or the configured one.
#[derive(Clone, Debug)]
#[must_use]
pub struct DateTime {
    reading: Reading,
    zone: Option<TimeZone>,
}

/// Validates an ISO 8601 or RFC 3339 date and time, or a token one of the layouts reads, output as
/// the instant it names, to the millisecond. A token with an offset or `Z` names that instant. A
/// token with neither is read in the configured time zone, else in the host's; a time a clock
/// change skips moves forward by the length of the gap, and one it repeats takes the earlier
/// instant. A fraction beyond milliseconds is truncated.
pub fn date_time() -> DateTime {
    DateTime {
        reading: DATE_TIME_DEFAULT.clone(),
        zone: None,
    }
}

impl DateTime {
    /// The layouts accepted beside the ISO forms, in order: POSIX strftime layouts of `%Y`, `%m`,
    /// `%d`, `%H`, and `%M` once each, and optionally `%S` and `%z`. A layout the factory cannot
    /// read, or an empty list, is a fault at the call.
    #[track_caller]
    pub fn layouts<const N: usize>(mut self, layouts: [&str; N]) -> Self {
        self.reading = declare(&DATE_TIME_RULES, &layouts, &DATE_TIME_GRAMMAR);
        self
    }

    /// The IANA time zone a value without an offset is read in. A name the time zone database does
    /// not know is a fault at the call.
    #[track_caller]
    pub fn time_zone(mut self, zone: &str) -> Self {
        match TimeZone::get(zone) {
            Ok(known) => self.zone = Some(known),
            Err(_) => fault::raise(
                fault::TIME_ZONE,
                "date_time() time_zone is not an IANA time zone name.",
                "Supply a name such as America/New_York.",
                vec![Finding::new("date_time().time_zone", vec![Literal::from(zone)]).mark("0")],
            ),
        }
        self
    }
}

impl Validator for DateTime {
    type Output = jiff::Timestamp;

    fn validate(
        &self,
        input: &str,
        context: &ValidationContext,
    ) -> Result<jiff::Timestamp, Vec<Issue>> {
        let instant = self.reading.first(input, |fields| {
            let wall = wall_time(fields)?;
            match offset_of(fields) {
                Offset::Invalid => None,
                Offset::Seconds(seconds) => tz::Offset::from_seconds(seconds)
                    .ok()?
                    .to_timestamp(wall)
                    .ok(),
                Offset::Absent => {
                    let zone = self.zone.clone().unwrap_or_else(|| {
                        TimeZone::get(&context.host.time_zone).unwrap_or(TimeZone::UTC)
                    });
                    zone.to_ambiguous_timestamp(wall).compatible().ok()
                }
            }
        });
        instant.ok_or_else(|| {
            vec![match self.reading.forms() {
                None => DATE_TIME_ISSUE.issue(NoParams {}),
                Some(forms) => DATE_TIME_LAYOUTS_ISSUE.issue(Forms {
                    forms: forms.to_vec(),
                }),
            }]
        })
    }

    fn input_schema(&self) -> InputSchema {
        Some(loomcli_core::with_schema_dialect(
            self.reading.input_schema().clone(),
        ))
    }
}

static TIME_DEFAULT_GRAMMAR: LazyLock<DefaultGrammar> = LazyLock::new(|| DefaultGrammar {
    expression: constant(TIME_GRAMMAR),
    schema: schema_of(&[("pattern", json!(TIME_PATTERN))]),
    form: "hh:mm",
});

static TIME_DEFAULT: LazyLock<Reading> =
    LazyLock::new(|| reading_of(&TIME_RULES, &[], &TIME_DEFAULT_GRAMMAR));

/// How `time()` reads and prints its spelled bounds.
const TIME_BOUNDS: SpelledGrammar = SpelledGrammar {
    factory: "time",
    read: |spelling| read_time_of_day(spelling).map(|value| value as f64),
    format: |value| format_time_of_day(value as u64),
    noun: "a time of day",
    examples: "\"09:00\" or \"17:30\"",
};

/// A time of day.
#[derive(Clone, Debug)]
#[must_use]
pub struct Time {
    reading: Reading,
    bounds: Bounds<f64>,
}

/// Validates a time of day: `hh:mm`, with optional seconds and fraction, output as a `civil::Time`
/// to the millisecond. A fraction beyond milliseconds is truncated.
pub fn time() -> Time {
    Time {
        reading: TIME_DEFAULT.clone(),
        bounds: Bounds::default(),
    }
}

impl Time {
    /// The layouts accepted beside `hh:mm`, in order: POSIX strftime layouts of `%M` once and
    /// either `%H`, or `%I` with `%p`, once each, and optionally `%S`. A layout the factory cannot
    /// read, or an empty list, is a fault at the call.
    #[track_caller]
    pub fn layouts<const N: usize>(mut self, layouts: [&str; N]) -> Self {
        self.reading = declare(&TIME_RULES, &layouts, &TIME_DEFAULT_GRAMMAR);
        self
    }

    /// The earliest accepted time, a time of day in the default grammar such as `"09:00"`,
    /// inclusive. A bound outside the grammar, or a `min` above `max`, is a fault at the call.
    #[track_caller]
    pub fn min(mut self, min: &str) -> Self {
        set_spelled_bound(&mut self.bounds, Side::Min, min, &TIME_BOUNDS);
        self
    }

    /// The latest accepted time, inclusive. A bound outside the grammar, or a `max` below `min`, is
    /// a fault at the call.
    #[track_caller]
    pub fn max(mut self, max: &str) -> Self {
        set_spelled_bound(&mut self.bounds, Side::Max, max, &TIME_BOUNDS);
        self
    }

    /// The one issue a rejection earns. A bounded time answers its bounds sentence alone, whatever
    /// its layouts.
    fn issue(&self) -> Issue {
        let bound = |value: f64| value as u64;
        match (self.bounds.min, self.bounds.max) {
            (Some(min), Some(max)) => TIME_RANGE_ISSUE.issue(Range {
                max: bound(max),
                min: bound(min),
            }),
            (Some(min), None) => TIME_MIN_ISSUE.issue(Min { min: bound(min) }),
            (None, Some(max)) => TIME_MAX_ISSUE.issue(Max { max: bound(max) }),
            (None, None) => match self.reading.forms() {
                None => TIME_ISSUE.issue(NoParams {}),
                Some(forms) => TIME_LAYOUTS_ISSUE.issue(Forms {
                    forms: forms.to_vec(),
                }),
            },
        }
    }
}

impl Validator for Time {
    type Output = civil::Time;

    fn validate(
        &self,
        input: &str,
        _context: &ValidationContext,
    ) -> Result<civil::Time, Vec<Issue>> {
        let read = self.reading.first(input, time_of_day);
        let value = read.filter(|clock| self.bounds.contains(clock.since_midnight() as f64));
        value
            .and_then(|clock| {
                civil::Time::new(
                    i8::try_from(clock.hours).ok()?,
                    i8::try_from(clock.minutes).ok()?,
                    i8::try_from(clock.seconds).ok()?,
                    i32::try_from(clock.milliseconds * 1_000_000).ok()?,
                )
                .ok()
            })
            .ok_or_else(|| vec![self.issue()])
    }

    fn input_schema(&self) -> InputSchema {
        Some(loomcli_core::with_schema_dialect(
            self.reading.input_schema().clone(),
        ))
    }
}
