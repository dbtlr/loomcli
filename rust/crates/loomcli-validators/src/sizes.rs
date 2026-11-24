//! `duration` and `bytes`.

use loomcli_core::{InputSchema, Issue, ValidationContext, Validator};
use serde_json::json;

use crate::bounds::{Bounds, Side, SpelledGrammar, set_spelled_bound};
use crate::codes::{
    BYTES_ISSUE, BYTES_MAX_ISSUE, BYTES_MIN_ISSUE, BYTES_RANGE_ISSUE, DURATION_CAPITAL_M_ISSUE,
    DURATION_ISSUE, DURATION_MAX_ISSUE, DURATION_MIN_ISSUE, DURATION_RANGE_ISSUE, Max, Min,
    NoParams, Range,
};
use crate::span::{
    BYTES_PATTERN, DURATION_PATTERN, as_duration, format_bytes, format_duration, read_bytes,
    read_duration, spells_minutes_as_capital_m,
};

const DURATION_BOUNDS: SpelledGrammar = SpelledGrammar {
    factory: "duration",
    read: read_duration,
    format: format_duration,
    noun: "a duration",
    examples: "\"30s\" or \"2h30m\"",
};

const BYTES_BOUNDS: SpelledGrammar = SpelledGrammar {
    factory: "bytes",
    read: |spelling| read_bytes(spelling).map(|value| value as f64),
    format: |value| format_bytes(value as u64),
    noun: "a size",
    examples: "\"1MB\" or \"10GiB\"",
};

/// A duration such as `1h30m`.
#[derive(Clone, Debug)]
#[must_use]
pub struct Duration {
    bounds: Bounds<f64>,
}

/// Validates a length of time in the operator's grammar: the span spellings of systemd.time(7)
/// without a sign, such as `90s`, `2h30m`, `1.5h`, and `1 hour 30 min`. A bare number counts
/// seconds. Output is a [`std::time::Duration`].
pub fn duration() -> Duration {
    Duration {
        bounds: Bounds::default(),
    }
}

impl Duration {
    /// The shortest accepted duration, spelled in the same grammar such as `"30"` or `"1 day"`,
    /// inclusive. A bound outside the grammar, or a `min` above `max`, is a fault at the call.
    #[track_caller]
    pub fn min(mut self, min: &str) -> Self {
        set_spelled_bound(&mut self.bounds, Side::Min, min, &DURATION_BOUNDS);
        self
    }

    /// The longest accepted duration, spelled in the same grammar, inclusive. A bound outside the
    /// grammar, or a `max` below `min`, is a fault at the call.
    #[track_caller]
    pub fn max(mut self, max: &str) -> Self {
        set_spelled_bound(&mut self.bounds, Side::Max, max, &DURATION_BOUNDS);
        self
    }
}

impl Validator for Duration {
    type Output = std::time::Duration;

    fn validate(
        &self,
        input: &str,
        _context: &ValidationContext,
    ) -> Result<std::time::Duration, Vec<Issue>> {
        let value = read_duration(input);
        if value.is_none() && spells_minutes_as_capital_m(input) {
            return Err(vec![DURATION_CAPITAL_M_ISSUE.issue(NoParams {})]);
        }
        match value {
            Some(milliseconds) if self.bounds.contains(milliseconds) => {
                Ok(as_duration(milliseconds))
            }
            _ => Err(vec![match (self.bounds.min, self.bounds.max) {
                (Some(min), Some(max)) => DURATION_RANGE_ISSUE.issue(Range { max, min }),
                (Some(min), None) => DURATION_MIN_ISSUE.issue(Min { min }),
                (None, Some(max)) => DURATION_MAX_ISSUE.issue(Max { max }),
                (None, None) => DURATION_ISSUE.issue(NoParams {}),
            }]),
        }
    }

    fn input_schema(&self) -> InputSchema {
        let mut schema = serde_json::Map::new();
        schema.insert("type".to_owned(), "string".into());
        schema.insert("pattern".to_owned(), json!(*DURATION_PATTERN));
        Some(loomcli_core::with_schema_dialect(schema))
    }
}

/// A byte size such as `10MB`.
#[derive(Clone, Debug)]
#[must_use]
pub struct Bytes {
    bounds: Bounds<f64>,
}

/// Validates a size in the operator's grammar, output as a whole number of bytes: a number and an
/// optional unit, where `kB` through `PB` are powers of 1000 and `KiB` through `PiB`, or `Ki`
/// through `Pi`, are powers of 1024. A bare number counts bytes.
pub fn bytes() -> Bytes {
    Bytes {
        bounds: Bounds::default(),
    }
}

impl Bytes {
    /// The smallest accepted size, spelled in the same grammar such as `"1MB"`, inclusive. A bound
    /// `bytes()` itself would reject, or a `min` above `max`, is a fault at the call.
    #[track_caller]
    pub fn min(mut self, min: &str) -> Self {
        set_spelled_bound(&mut self.bounds, Side::Min, min, &BYTES_BOUNDS);
        self
    }

    /// The largest accepted size, spelled in the same grammar such as `"10GiB"`, inclusive. A bound
    /// `bytes()` itself would reject, or a `max` below `min`, is a fault at the call.
    #[track_caller]
    pub fn max(mut self, max: &str) -> Self {
        set_spelled_bound(&mut self.bounds, Side::Max, max, &BYTES_BOUNDS);
        self
    }
}

impl Validator for Bytes {
    type Output = u64;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<u64, Vec<Issue>> {
        match read_bytes(input) {
            Some(value) if self.bounds.contains(value as f64) => Ok(value),
            _ => {
                let count = |value: f64| value as u64;
                Err(vec![match (self.bounds.min, self.bounds.max) {
                    (Some(min), Some(max)) => BYTES_RANGE_ISSUE.issue(Range {
                        max: count(max),
                        min: count(min),
                    }),
                    (Some(min), None) => BYTES_MIN_ISSUE.issue(Min { min: count(min) }),
                    (None, Some(max)) => BYTES_MAX_ISSUE.issue(Max { max: count(max) }),
                    (None, None) => BYTES_ISSUE.issue(NoParams {}),
                }])
            }
        }
    }

    fn input_schema(&self) -> InputSchema {
        let mut schema = serde_json::Map::new();
        schema.insert("type".to_owned(), "string".into());
        schema.insert("pattern".to_owned(), json!(*BYTES_PATTERN));
        Some(loomcli_core::with_schema_dialect(schema))
    }
}
