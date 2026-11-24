//! The interrupt keys a raw-mode reader finds in what it read.

use super::{Host, InterruptKeys, InterruptRaised, InterruptSignal};

/// The signal an interrupt key raises at a terminal in its usual mode: Ctrl-C (0x03), Ctrl-\
/// (0x1c), and Ctrl-Z (0x1a). Raw mode delivers each as a byte.
fn interrupt_of(character: char) -> Option<InterruptSignal> {
    match character {
        '\u{3}' => Some(InterruptSignal::Int),
        '\u{1c}' => Some(InterruptSignal::Quit),
        '\u{1a}' => Some(InterruptSignal::Tstp),
        _ => None,
    }
}

/// Whether `text` holds an interrupt key, which ends a raw-mode wait at once.
pub(crate) fn has_interrupt_key(text: &str) -> bool {
    text.chars()
        .any(|character| interrupt_of(character).is_some())
}

/// Splits `text` into the signals its interrupt keys stand for, in arrival order, with several
/// Ctrl-Z keys counted once at the first one's place, and the text left without them.
fn split_interrupt_keys(text: &str) -> (Vec<InterruptSignal>, String) {
    let mut signals = Vec::new();
    let mut rest = String::new();
    for character in text.chars() {
        match interrupt_of(character) {
            None => rest.push(character),
            Some(InterruptSignal::Tstp) if signals.contains(&InterruptSignal::Tstp) => {}
            Some(signal) => signals.push(signal),
        }
    }
    (signals, rest)
}

/// Raises the signal each interrupt key in `text`, read in raw mode, stands for on the run's signal
/// source, in arrival order, as the key would at a cooked terminal: Ctrl-C starts the shutdown,
/// Ctrl-\ ends the process, and Ctrl-Z suspends it. Several Ctrl-Z keys raise one `SIGTSTP`, at
/// the first one's place.
///
/// Where [`Host::raise`] answers `false`, the process is not that terminal's: Ctrl-C and Ctrl-\
/// call `cancel` and Ctrl-Z does nothing. It answers which kind of signal was raised, which reaches
/// the run a moment later, and the text without its interrupt keys, or empty once a signal was
/// raised, as a cooked terminal discards the input still unread.
pub fn raise_interrupt_keys(host: &Host, cancel: &dyn Fn(), text: &str) -> InterruptKeys {
    raise_through(&|signal| host.raise(signal), cancel, text)
}

/// [`raise_interrupt_keys`] over any raise, which answers whether it delivered the signal.
pub(crate) fn raise_through(
    raise: &dyn Fn(InterruptSignal) -> bool,
    cancel: &dyn Fn(),
    text: &str,
) -> InterruptKeys {
    let (signals, rest) = split_interrupt_keys(text);
    let mut raised = None;
    for signal in signals {
        if raise(signal) {
            raised = if signal == InterruptSignal::Tstp && raised != Some(InterruptRaised::Ending) {
                Some(InterruptRaised::Suspending)
            } else {
                Some(InterruptRaised::Ending)
            };
        } else if signal != InterruptSignal::Tstp {
            cancel();
        }
    }
    InterruptKeys {
        raised,
        rest: if raised.is_none() {
            rest
        } else {
            String::new()
        },
    }
}

#[cfg(test)]
mod tests {
    //! The reference's `interrupt-keys.test.ts`, over a stand-in raise as the reference's stands
    //! in for the action's context.

    use std::cell::RefCell;

    use super::*;

    const CTRL_C: char = '\u{3}';
    const CTRL_BACKSLASH: char = '\u{1c}';
    const CTRL_Z: char = '\u{1a}';

    /// Runs one read against a raise that answers `answer`, recording raises and cancels.
    fn stand(answer: bool, text: &str) -> (InterruptKeys, Vec<InterruptSignal>, usize) {
        let raised = RefCell::new(Vec::new());
        let cancels = RefCell::new(0);
        let keys = raise_through(
            &|signal| {
                raised.borrow_mut().push(signal);
                answer
            },
            &|| *cancels.borrow_mut() += 1,
            text,
        );
        (keys, raised.into_inner(), cancels.into_inner())
    }

    #[test]
    fn raises_sigint_sigquit_and_sigtstp_in_arrival_order() {
        let (_, raised, _) = stand(true, &format!("a{CTRL_Z}b{CTRL_BACKSLASH}{CTRL_C}"));
        assert_eq!(
            raised,
            [
                InterruptSignal::Tstp,
                InterruptSignal::Quit,
                InterruptSignal::Int
            ]
        );
    }

    #[test]
    fn raises_one_sigtstp_for_several_ctrl_z_at_the_first_ones_place() {
        let (_, raised, _) = stand(true, &format!("{CTRL_Z}{CTRL_C}{CTRL_Z}"));
        assert_eq!(raised, [InterruptSignal::Tstp, InterruptSignal::Int]);
    }

    #[test]
    fn answers_suspending_for_ctrl_z_alone_and_ending_once_ctrl_c_or_ctrl_backslash_raised() {
        let kind = |text: String| stand(true, &text).0.raised;
        assert_eq!(kind(CTRL_Z.to_string()), Some(InterruptRaised::Suspending));
        assert_eq!(
            kind(format!("{CTRL_Z}{CTRL_C}")),
            Some(InterruptRaised::Ending)
        );
        assert_eq!(
            kind(format!("{CTRL_C}{CTRL_Z}")),
            Some(InterruptRaised::Ending)
        );
        assert_eq!(
            kind(CTRL_BACKSLASH.to_string()),
            Some(InterruptRaised::Ending)
        );
    }

    #[test]
    fn flushes_the_rest_once_a_signal_was_raised() {
        assert_eq!(stand(true, &format!("ab{CTRL_Z}cd")).0.rest, "");
    }

    #[test]
    fn cancels_for_ctrl_c_and_ctrl_backslash_and_not_for_ctrl_z_where_raise_answers_false() {
        let (keys, _, cancels) = stand(false, &format!("a{CTRL_Z}b"));
        assert_eq!(
            keys,
            InterruptKeys {
                raised: None,
                rest: "ab".to_owned()
            }
        );
        assert_eq!(cancels, 0);
        let (keys, _, cancels) = stand(false, &format!("a{CTRL_C}b"));
        assert_eq!(
            keys,
            InterruptKeys {
                raised: None,
                rest: "ab".to_owned()
            }
        );
        assert_eq!(cancels, 1);
        let (_, _, cancels) = stand(false, &format!("{CTRL_BACKSLASH}c"));
        assert_eq!(cancels, 1);
    }

    #[test]
    fn touches_nothing_when_the_text_holds_no_interrupt_key() {
        let (keys, raised, cancels) = stand(true, "plain\r\n");
        assert_eq!(
            keys,
            InterruptKeys {
                raised: None,
                rest: "plain\r\n".to_owned()
            }
        );
        assert!(raised.is_empty());
        assert_eq!(cancels, 0);
        assert!(!has_interrupt_key("plain\r\n"));
        assert!(has_interrupt_key("\u{1a}"));
    }
}
