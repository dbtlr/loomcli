//! Small helpers with no concept of their own: lists, futures, names, and control-character escapes.

use std::future::Future;
use std::pin::Pin;

/// A boxed, sendable future: the shape every erased handler core stores returns.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A list an authoring call takes: an array or `Vec` of one type, or a tuple of up to 32 mixed
/// types, each element converting into `T`. A longer mixed list is a `Vec` of converted values:
/// `vec![help().into(), version().into(), …]`.
///
/// The order of the elements is the order core composes them in, so a `plugins` list is the
/// installation order. A tuple holds values of different types, such as plugin settings builders,
/// that an array cannot.
pub trait IntoList<T> {
    /// The elements, converted, in order.
    fn into_list(self) -> Vec<T>;
}

impl<T, U: Into<T>, const N: usize> IntoList<T> for [U; N] {
    fn into_list(self) -> Vec<T> {
        self.into_iter().map(Into::into).collect()
    }
}

impl<T, U: Into<T>> IntoList<T> for Vec<U> {
    fn into_list(self) -> Vec<T> {
        self.into_iter().map(Into::into).collect()
    }
}

macro_rules! tuple_list {
    ($($name:ident),+) => {
        impl<T, $($name: Into<T>),+> IntoList<T> for ($($name,)+) {
            #[allow(non_snake_case)]
            fn into_list(self) -> Vec<T> {
                let ($($name,)+) = self;
                vec![$($name.into()),+]
            }
        }
    };
}

tuple_list!(E1);
tuple_list!(E1, E2);
tuple_list!(E1, E2, E3);
tuple_list!(E1, E2, E3, E4);
tuple_list!(E1, E2, E3, E4, E5);
tuple_list!(E1, E2, E3, E4, E5, E6);
tuple_list!(E1, E2, E3, E4, E5, E6, E7);
tuple_list!(E1, E2, E3, E4, E5, E6, E7, E8);
tuple_list!(E1, E2, E3, E4, E5, E6, E7, E8, E9);
tuple_list!(E1, E2, E3, E4, E5, E6, E7, E8, E9, E10);
tuple_list!(E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11);
tuple_list!(E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12);
tuple_list!(E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13);
tuple_list!(E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24, E25
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24, E25, E26
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24, E25, E26, E27
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24, E25, E26, E27, E28
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24, E25, E26, E27, E28, E29
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24, E25, E26, E27, E28, E29, E30
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24, E25, E26, E27, E28, E29, E30, E31
);
tuple_list!(
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    E22, E23, E24, E25, E26, E27, E28, E29, E30, E31, E32
);

pub use crate::style::{escape_control_characters, split_lines};

/// Whether `name` is a portable name: `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, not starting with `-`
/// or `.`. Application names, Command names, and aliases are portable names.
#[must_use]
pub const fn is_portable_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes[0] == b'-' || bytes[0] == b'.' {
        return false;
    }
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if !(byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'-') {
            return false;
        }
        index += 1;
    }
    true
}

/// Whether `name` is a declared name: nonempty, with no leading hyphen, no whitespace, and no `=`.
/// Argument names, option names, and option aliases are declared names.
#[must_use]
pub fn is_declared_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.chars().any(|c| is_js_whitespace(c) || c == '=')
}

/// Whether a character is whitespace as a JavaScript regular expression's `\s` reads it: the
/// tab, the line feed, the line and form feeds, the carriage return, the space, the no-break space,
/// the byte order mark, every space separator, and the line and paragraph separators. Unlike
/// Unicode `White_Space`, it holds U+FEFF and not U+0085.
fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// Whether a character ends a line: LF, VT, FF, CR, NEL, LS, or PS.
fn is_line_terminator(character: char) -> bool {
    matches!(
        character,
        '\n' | '\u{b}' | '\u{c}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}'
    )
}

/// Whether `value` is one line of prose: it holds a character outside Unicode `White_Space` and no
/// line terminator (LF, VT, FF, CR, NEL, LS, PS). A format character such as the zero-width space is
/// prose. A plugin setting printed inside one line is judged against it.
#[must_use]
pub fn is_prose_line(value: &str) -> bool {
    value.chars().any(|character| !character.is_whitespace())
        && !value.chars().any(is_line_terminator)
}

/// A finite number as ECMAScript's `Number.prototype.toString` writes it, as `String(number)` does:
/// plain decimal for magnitudes from 1e-6 up to (not including) 1e21, exponent form beyond, and
/// `0` for either zero. The same digits `loomcli-mcp` writes a JSON number with.
pub(crate) fn js_number_text(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    // The shortest round-trip digits, as `d.ddde<exp>`.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .unwrap_or((scientific.as_str(), "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    // ECMAScript's `n`: the value is 0.digits * 10^n.
    let n = exponent + 1;
    let k = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let body = if k <= n && n <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(n - k).unwrap_or(0))
        )
    } else if 0 < n && n <= 21 {
        let (whole, fraction) = digits.split_at(usize::try_from(n).unwrap_or(0));
        format!("{whole}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat(usize::try_from(-n).unwrap_or(0)))
    } else {
        let power = n - 1;
        let sign_of_power = if power < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        let fraction = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        format!("{first}{fraction}e{sign_of_power}{}", power.abs())
    };
    format!("{sign}{body}")
}

/// Polls `future` once with a waker that does nothing, and answers its output when it was ready.
/// A write core makes on the process's way out, from a signal handler or a shutdown's end, cannot
/// wait, so a stream that is not ready at once drops it.
pub(crate) fn poll_once<F: Future>(future: F) -> Option<F::Output> {
    let mut future = std::pin::pin!(future);
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    match future.as_mut().poll(&mut context) {
        std::task::Poll::Ready(output) => Some(output),
        std::task::Poll::Pending => None,
    }
}
