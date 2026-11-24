//! A number as the reference's runtime writes it.

/// A finite number as ECMAScript's `Number.prototype.toString` writes it, as `JSON.stringify` does
/// for a finite number: plain decimal for magnitudes from 1e-6 up to (not including) 1e21, exponent
/// form beyond, and `0` for either zero. Core keeps the same function private.
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

#[cfg(test)]
mod tests {
    use super::js_number_text;

    #[test]
    fn numbers_print_as_json_stringify_prints_them() {
        for (value, text) in [
            (0.0, "0"),
            (-0.0, "0"),
            (5.0, "5"),
            (1.5, "1.5"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1.2345678901234568e17, "123456789012345680"),
            (9_007_199_254_740_991.0, "9007199254740991"),
            (1e-7, "1e-7"),
            (0.000_001, "0.000001"),
        ] {
            assert_eq!(js_number_text(value), text, "{value}");
        }
    }
}
