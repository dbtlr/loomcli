//! The operator sentences of an invocation by name: the issue of a value no token spells.

pub(super) const TAKES_BOOLEAN: &str = "Use true or false.";
pub(super) const TAKES_COUNT: &str = "Use a whole number of 0 or more.";
pub(super) const TAKES_IMPLIED: &str = "Use a string, a number, or true.";
pub(super) const TAKES_LIST: &str = "Use a string, a number, or a list of them.";
pub(super) const TAKES_LIST_OR_IMPLIED: &str =
    "Use a string, a number, true, or a list of strings and numbers.";
pub(super) const TAKES_SCALAR: &str = "Use a string or a number.";
pub(super) const INVALID_TIME_ZONE: &str = "invoke() timeZone is not an IANA time zone name this runtime knows. Use a name such as \"Asia/Tokyo\".";
