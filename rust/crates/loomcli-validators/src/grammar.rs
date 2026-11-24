//! Compiled grammars: the crate's own constant expressions.

use regex::Regex;

/// The regular expression for a constant `source` of this crate.
///
/// Every source passed here is a literal or built from literals, and the crate's tests compile
/// each one, so a failure here is a defect in the crate and not something an operator can reach.
#[allow(clippy::expect_used)]
pub(crate) fn constant(source: &str) -> Regex {
    Regex::new(source).expect("A constant grammar of this crate compiles.")
}
