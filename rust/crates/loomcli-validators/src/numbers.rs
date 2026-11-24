//! `integer`, `number`, and `port`.

use loomcli_core::{InputSchema, Issue, Literal, ValidationContext, Validator};
use serde_json::{Map, Value};

use crate::bounds::{Bounds, Side, bad_bound, set_bound};
use crate::codes::{
    INTEGER_ISSUE, INTEGER_MAX_ISSUE, INTEGER_MIN_ISSUE, INTEGER_RANGE_ISSUE, Max, Min,
    NUMBER_ISSUE, NUMBER_MAX_ISSUE, NUMBER_MIN_ISSUE, NUMBER_RANGE_ISSUE, NoParams, PORT_ISSUE,
    Range,
};
use crate::js::{js_number, json_number};

/// The largest safe integer, `2^53 - 1`.
const MAX_SAFE: u64 = 9_007_199_254_740_991;

/// The safe integer a token spells in decimal digits, `-0` as `0`, or `None` when none.
fn read_integer(raw: &str) -> Option<i64> {
    let (negative, digits) = match raw.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, raw),
    };
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let significant = digits.trim_start_matches('0');
    if significant.len() > 16 {
        return None;
    }
    let magnitude: u64 = if significant.is_empty() {
        0
    } else {
        significant.parse().ok()?
    };
    if magnitude > MAX_SAFE {
        return None;
    }
    let value = i64::try_from(magnitude).ok()?;
    Some(if negative { -value } else { value })
}

/// The published schema for a numeric type, with each declared bound.
fn bounds_schema(kind: &str, minimum: Option<Value>, maximum: Option<Value>) -> InputSchema {
    let mut schema = Map::new();
    schema.insert("type".to_owned(), kind.into());
    if let Some(minimum) = minimum {
        schema.insert("minimum".to_owned(), minimum);
    }
    if let Some(maximum) = maximum {
        schema.insert("maximum".to_owned(), maximum);
    }
    Some(loomcli_core::with_schema_dialect(schema))
}

/// A whole number, within optional bounds.
#[derive(Clone, Debug)]
#[must_use]
pub struct Integer {
    bounds: Bounds<i64>,
}

/// Validates a whole number: an optional `-` and decimal digits, a safe integer within `min` and
/// `max`, both inclusive. Leading zeros are accepted, so `007` is 7.
pub fn integer() -> Integer {
    Integer {
        bounds: Bounds::default(),
    }
}

impl Integer {
    /// The smallest accepted value. A `min` above `max` is a fault at the call.
    #[track_caller]
    pub fn min(mut self, min: i64) -> Self {
        set_bound(
            &mut self.bounds,
            Side::Min,
            min,
            "integer",
            Literal::from(min as f64),
            |v| v.to_string(),
        );
        self
    }

    /// The largest accepted value. A `max` below `min` is a fault at the call.
    #[track_caller]
    pub fn max(mut self, max: i64) -> Self {
        set_bound(
            &mut self.bounds,
            Side::Max,
            max,
            "integer",
            Literal::from(max as f64),
            |v| v.to_string(),
        );
        self
    }
}

impl Validator for Integer {
    type Output = i64;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<i64, Vec<Issue>> {
        match read_integer(input) {
            Some(value) if self.bounds.contains(value) => Ok(value),
            _ => Err(vec![match (self.bounds.min, self.bounds.max) {
                (Some(min), Some(max)) => INTEGER_RANGE_ISSUE.issue(Range { max, min }),
                (Some(min), None) => INTEGER_MIN_ISSUE.issue(Min { min }),
                (None, Some(max)) => INTEGER_MAX_ISSUE.issue(Max { max }),
                (None, None) => INTEGER_ISSUE.issue(NoParams {}),
            }]),
        }
    }

    fn input_schema(&self) -> InputSchema {
        bounds_schema(
            "integer",
            self.bounds.min.map(Value::from),
            self.bounds.max.map(Value::from),
        )
    }
}

/// A decimal number, within optional bounds.
#[derive(Clone, Debug)]
#[must_use]
pub struct Number {
    bounds: Bounds<f64>,
}

/// Validates a decimal number: an optional `-`, digits, an optional fraction and exponent, finite
/// and within `min` and `max`, both inclusive.
pub fn number() -> Number {
    Number {
        bounds: Bounds::default(),
    }
}

impl Number {
    /// The smallest accepted value. A bound that is not finite, or a `min` above `max`, is a fault
    /// at the call.
    #[track_caller]
    pub fn min(self, min: f64) -> Self {
        self.bound(Side::Min, min)
    }

    /// The largest accepted value. A bound that is not finite, or a `max` below `min`, is a fault
    /// at the call.
    #[track_caller]
    pub fn max(self, max: f64) -> Self {
        self.bound(Side::Max, max)
    }

    #[track_caller]
    fn bound(mut self, side: Side, value: f64) -> Self {
        if !value.is_finite() {
            bad_bound(
                "number",
                side,
                "a finite number",
                "Supply a finite number.",
                Literal::from(value),
            );
        }
        set_bound(
            &mut self.bounds,
            side,
            value,
            "number",
            Literal::from(value),
            js_number,
        );
        self
    }
}

/// Reads a decimal number token: `-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?`.
fn read_number(raw: &str) -> Option<f64> {
    let rest = raw.strip_prefix('-').unwrap_or(raw);
    let (mantissa, exponent) = match rest.find(['e', 'E']) {
        Some(at) => (&rest[..at], Some(&rest[at + 1..])),
        None => (rest, None),
    };
    let (whole, fraction) = match mantissa.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (mantissa, None),
    };
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(whole) || fraction.is_some_and(|text| !digits(text)) {
        return None;
    }
    if let Some(exponent) = exponent
        && !digits(exponent.strip_prefix(['+', '-']).unwrap_or(exponent))
    {
        return None;
    }
    let value: f64 = raw.parse().ok()?;
    // `-0` reads as `0`.
    value
        .is_finite()
        .then_some(if value == 0.0 { 0.0 } else { value })
}

impl Validator for Number {
    type Output = f64;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<f64, Vec<Issue>> {
        match read_number(input) {
            Some(value) if self.bounds.contains(value) => Ok(value),
            _ => Err(vec![match (self.bounds.min, self.bounds.max) {
                (Some(min), Some(max)) => NUMBER_RANGE_ISSUE.issue(Range { max, min }),
                (Some(min), None) => NUMBER_MIN_ISSUE.issue(Min { min }),
                (None, Some(max)) => NUMBER_MAX_ISSUE.issue(Max { max }),
                (None, None) => NUMBER_ISSUE.issue(NoParams {}),
            }]),
        }
    }

    fn input_schema(&self) -> InputSchema {
        bounds_schema(
            "number",
            self.bounds.min.map(json_number),
            self.bounds.max.map(json_number),
        )
    }
}

/// A TCP or UDP port, 1 through 65535.
#[derive(Clone, Debug)]
#[must_use]
pub struct Port {}

/// Validates a port the operator names, 1 through 65535; port 0 is left to `integer()`.
pub fn port() -> Port {
    Port {}
}

impl Validator for Port {
    type Output = u16;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<u16, Vec<Issue>> {
        read_integer(input)
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value >= 1)
            .ok_or_else(|| vec![PORT_ISSUE.issue(NoParams {})])
    }

    fn input_schema(&self) -> InputSchema {
        bounds_schema("integer", Some(1.into()), Some(65_535.into()))
    }
}
