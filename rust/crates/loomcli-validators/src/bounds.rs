//! Inclusive bounds on a factory, either or both absent, and the faults a bad bound raises.

use loomcli_core::{Finding, Literal};

use crate::fault;

/// Inclusive bounds, either or both absent.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Bounds<T> {
    pub(crate) min: Option<T>,
    pub(crate) max: Option<T>,
}

impl<T> Default for Bounds<T> {
    fn default() -> Self {
        Self {
            min: None,
            max: None,
        }
    }
}

impl<T: Copy + PartialOrd> Bounds<T> {
    /// Whether `value` lies within the bounds.
    pub(crate) fn contains(&self, value: T) -> bool {
        self.min.is_none_or(|min| value >= min) && self.max.is_none_or(|max| value <= max)
    }
}

/// Which bound a setter declares.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Side {
    Min,
    Max,
}

impl Side {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Side::Min => "min",
            Side::Max => "max",
        }
    }
}

/// Sets one bound of `bounds` and faults when `min` is then above `max`. `print` writes a bound as
/// the sentence does; `argument` is the setter's argument as the finding rebuilds it.
#[track_caller]
pub(crate) fn set_bound<T: Copy + PartialOrd>(
    bounds: &mut Bounds<T>,
    side: Side,
    value: T,
    factory: &str,
    argument: Literal,
    print: impl Fn(T) -> String,
) {
    match side {
        Side::Min => bounds.min = Some(value),
        Side::Max => bounds.max = Some(value),
    }
    if let (Some(min), Some(max)) = (bounds.min, bounds.max)
        && min > max
    {
        fault::raise(
            fault::BOUNDS_ORDER,
            format!(
                "{factory}() min {} is above max {}.",
                print(min),
                print(max)
            ),
            "Supply a min at or below max.",
            vec![Finding::new(format!("{factory}().{}", side.name()), vec![argument]).mark("0")],
        );
    }
}

/// Faults on a bound that is not a value of the kind the factory reads.
#[track_caller]
pub(crate) fn bad_bound(
    factory: &str,
    side: Side,
    sentence_noun: &str,
    correction: &str,
    argument: Literal,
) -> ! {
    fault::raise(
        fault::BOUND_VALUE,
        format!("{factory}() {} is not {sentence_noun}.", side.name()),
        correction,
        vec![Finding::new(format!("{factory}().{}", side.name()), vec![argument]).mark("0")],
    )
}

/// How a factory whose bounds are spelled in its own grammar reads them, prints them, and names one.
pub(crate) struct SpelledGrammar {
    pub(crate) factory: &'static str,
    /// The value a spelling stands for, or `None` for one the factory itself would reject.
    pub(crate) read: fn(&str) -> Option<f64>,
    /// The spelling a value prints as in a fault's sentence.
    pub(crate) format: fn(f64) -> String,
    /// The value's kind with its article, such as `a duration`.
    pub(crate) noun: &'static str,
    /// Two quoted examples for the correction, such as `"30s" or "2h30m"`.
    pub(crate) examples: &'static str,
}

/// Sets one bound of a factory whose bounds are spelled in its own grammar.
#[track_caller]
pub(crate) fn set_spelled_bound(
    bounds: &mut Bounds<f64>,
    side: Side,
    spelling: &str,
    grammar: &SpelledGrammar,
) {
    let Some(value) = (grammar.read)(spelling) else {
        bad_bound(
            grammar.factory,
            side,
            grammar.noun,
            &format!("Supply {} such as {}.", grammar.noun, grammar.examples),
            Literal::from(spelling),
        );
    };
    set_bound(
        bounds,
        side,
        value,
        grammar.factory,
        Literal::from(spelling),
        grammar.format,
    );
}
