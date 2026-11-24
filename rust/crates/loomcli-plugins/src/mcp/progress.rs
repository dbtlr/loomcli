//! A tool call's progress events, sent as the protocol's progress notifications.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use loomcli_core::{ProgressEvent, ProgressState};
use loomcli_mcp::{ProgressSink, ProgressUpdate};

/// A number as JavaScript's `String` writes it: plain decimal for magnitudes from 1e-6 up to (not
/// including) 1e21, exponent form beyond, `0` for either zero, and `NaN`, `Infinity`, and
/// `-Infinity` by name.
fn js_number_text(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value < 0.0 { "-Infinity" } else { "Infinity" }.to_owned();
    }
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

/// The state's name as the message writes it.
fn state_name(state: ProgressState) -> &'static str {
    match state {
        ProgressState::Started => "started",
        ProgressState::Updated => "updated",
        ProgressState::Ended => "ended",
        ProgressState::Failed => "failed",
        ProgressState::Cancelled => "cancelled",
    }
}

/// The counts an event's message carries: `completed/total` with a total, `completed` alone
/// without one, and none for an event with no `completed`.
fn counts_of(event: &ProgressEvent) -> String {
    match (event.completed, event.total) {
        (None, _) => String::new(),
        (Some(completed), None) => js_number_text(completed),
        (Some(completed), Some(total)) => {
            format!("{}/{}", js_number_text(completed), js_number_text(total))
        }
    }
}

/// The message one progress event sends: its label when it is not empty, its counts, and its
/// state in parentheses, joined by single spaces, such as `Fetching packages 3/8 (updated)`.
pub(super) fn progress_message(event: &ProgressEvent) -> String {
    let state = format!("({})", state_name(event.state));
    [event.label.clone(), counts_of(event), state]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The observer one tool call passes to `invoke`, which sends each progress event of the call as
/// one notification. `progress` counts the events the call has delivered, this one included, so
/// every event is sent and `progress` always increases, and no `total` is sent: the counts travel
/// in the message.
pub(super) fn progress_relay(
    sink: ProgressSink,
) -> impl Fn(&ProgressEvent) + Send + Sync + 'static {
    let delivered = Arc::new(AtomicU64::new(0));
    move |event: &ProgressEvent| {
        let count = delivered.fetch_add(1, Ordering::SeqCst) + 1;
        // A count of events stays far below 2^53, where an f64 holds every integer exactly.
        #[allow(clippy::cast_precision_loss)]
        let progress = count as f64;
        sink.send(ProgressUpdate {
            progress,
            total: None,
            message: Some(progress_message(event)),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::js_number_text;

    #[test]
    fn numbers_read_as_javascript_string_writes_them() {
        for (value, text) in [
            (0.0, "0"),
            (-0.0, "0"),
            (3.0, "3"),
            (0.5, "0.5"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1e-7, "1e-7"),
            (0.000_001, "0.000001"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
        ] {
            assert_eq!(js_number_text(value), text, "{value}");
        }
    }
}
