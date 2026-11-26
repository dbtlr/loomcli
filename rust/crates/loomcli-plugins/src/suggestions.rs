//! The suggestions plugin: offers nearby names and accepted values inside failures.
//!
//! The plugin's `on_failure` hook reads the graph and writes the suggestion sentence for the
//! failure it was handed. The views for unknown Commands, unknown options, and rejected inputs
//! render the hook's suggestion or core's own text, with any hint lines. The hook reads the graph
//! and any received input values. It adds no hint line.
//!
//! The hook and the view correlate through the failure's address: core boxes each reported
//! failure once and moves it no more until its report is written, so both receive the same object.

mod messages;
mod values;

use std::collections::HashMap;
use std::sync::Mutex;

use loomcli_core::{
    CommandGraph, CommandNode, Failure, FailureFacts, FailureHookContext, FailureView,
    FailureViewContext, InputError, InvokedBy, OptionNode, Plugin, UnknownCommandError,
    UnknownOptionError, failure, override_view,
};

use crate::PACKAGE_NAME;

/// What the typed word is: a Command name, an option spelling, whose leading hyphens fold away, or
/// an option's declared name, which an invocation by name writes. A declared name folds like a
/// spelling, normalized and lowercased, except that no leading hyphens are stripped.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Spelled {
    Command,
    Name,
    Option,
}

/// A typed token shorter than this, in code points after folding, matches nothing.
const SHORTEST_TOKEN: usize = 2;

/// At most this many names print.
const MOST_MATCHES: usize = 3;

/// The distance a token of `length` code points allows: 1 up to 4, 2 up to 8, and 3 beyond.
fn budget_of(length: usize) -> usize {
    match length {
        0..=4 => 1,
        5..=8 => 2,
        _ => 3,
    }
}

/// The code points one word is compared by: NFC, lowercased with the locale-independent default
/// conversion, and for an option spelling without its leading hyphens.
fn fold(word: &str, spelled: Spelled) -> Vec<char> {
    use unicode_normalization::UnicodeNormalization;
    let folded: String = word.nfc().collect::<String>().to_lowercase();
    let body = if spelled == Spelled::Option {
        folded.trim_start_matches('-')
    } else {
        folded.as_str()
    };
    body.chars().collect()
}

/// The restricted Damerau-Levenshtein distance, or optimal string alignment: each edit costs 1
/// (an insertion, a deletion, a substitution, or an adjacent transposition), and no substring is
/// edited more than once.
fn distance(typed: &[char], candidate: &[char]) -> usize {
    let width = candidate.len() + 1;
    // A transposition reaches two rows back. Retaining three rows keeps memory linear.
    let mut before = vec![0; width];
    let mut above: Vec<_> = (0..width).collect();
    let mut current = vec![0; width];
    for (row, &letter) in typed.iter().enumerate() {
        current[0] = row + 1;
        for (column, &other) in candidate.iter().enumerate() {
            let mut best = (above[column + 1] + 1)
                .min(current[column] + 1)
                .min(above[column] + usize::from(letter != other));
            if row > 0 && column > 0 && typed[row - 1] == other && candidate[column - 1] == letter {
                best = best.min(before[column - 1] + 1);
            }
            current[column + 1] = best;
        }
        std::mem::swap(&mut before, &mut above);
        std::mem::swap(&mut above, &mut current);
    }
    above[candidate.len()]
}

/// The declared spellings near the typed word, nearest first and in candidate order at one
/// distance, at most three. Each candidate is the spellings of one declared member, and a member
/// offers only its nearest spellings, so a Boolean option never offers its opposite beside the
/// spelling the operator meant. A spelling prints as declared, so the comparison folds a copy of
/// each side.
fn nearest(word: &str, candidates: &[Vec<String>], spelled: Spelled) -> Vec<String> {
    let typed = fold(word, spelled);
    if typed.len() < SHORTEST_TOKEN {
        return Vec::new();
    }
    let budget = budget_of(typed.len());
    let mut scored: Vec<(usize, &String)> = Vec::new();
    for spellings in candidates {
        let near: Vec<(usize, &String)> = spellings
            .iter()
            .filter_map(|name| {
                let folded = fold(name, spelled);
                // A length gap past the budget is at least that many edits.
                if folded.len().abs_diff(typed.len()) > budget {
                    return None;
                }
                let found = distance(&typed, &folded);
                (found <= budget).then_some((found, name))
            })
            .collect();
        let Some(closest) = near.iter().map(|(found, _)| *found).min() else {
            continue;
        };
        scored.extend(near.into_iter().filter(|(found, _)| *found == closest));
    }
    // Ascending distance; the sort is stable, so names at one distance keep candidate order.
    scored.sort_by_key(|(found, _)| *found);
    scored
        .into_iter()
        .take(MOST_MATCHES)
        .map(|(_, name)| name.clone())
        .collect()
}

/// Whether an operator may be pointed at the member: neither hidden nor deprecated.
fn offered_command(command: &CommandNode) -> bool {
    !command.hidden && command.deprecated.is_none()
}

fn offered_option(option: &OptionNode) -> bool {
    !option.hidden() && option.deprecated().is_none()
}

/// The canonical name of each child of the Command routing reached, in authoring order. A node
/// carries its aliases apart from its name, so no alias is ever a candidate.
fn command_names(command: &CommandNode) -> Vec<Vec<String>> {
    command
        .children
        .iter()
        .filter(|child| offered_command(child))
        .filter_map(|child| child.name.clone().map(|name| vec![name]))
        .collect()
}

/// Every option a Command accepts: the globals, then the routed Command's own.
fn options_of<'a>(
    graph: &'a CommandGraph,
    command: &'a CommandNode,
) -> impl Iterator<Item = &'a OptionNode> {
    graph
        .globals
        .iter()
        .chain(command.options.iter())
        .map(|option| &**option)
        .filter(|option| offered_option(option))
}

/// The spellings of each option: the long spelling, and a Boolean's negative spelling after it. A
/// short spelling is never offered.
fn option_spellings(graph: &CommandGraph, command: &CommandNode) -> Vec<Vec<String>> {
    options_of(graph, command)
        .map(|option| {
            let mut spellings: Vec<String> = option.long().map(str::to_owned).into_iter().collect();
            if let OptionNode::Boolean(boolean) = option {
                spellings.extend(boolean.negative.clone());
            }
            spellings
        })
        .collect()
}

/// The declared name of each option, which an invocation by name writes in place of a spelling.
fn option_names(graph: &CommandGraph, command: &CommandNode) -> Vec<Vec<String>> {
    options_of(graph, command)
        .map(|option| vec![option.name().to_owned()])
        .collect()
}

/// The address that identifies one reported failure to both the hook and the view.
fn address_of<F>(failure: &F) -> usize {
    std::ptr::from_ref(failure) as usize
}

/// The sentences the hook wrote, by failure address and a key the view can read back.
static SENTENCES: Mutex<Option<HashMap<usize, (String, String)>>> = Mutex::new(None);

/// A map this large holds only entries no view took; it is dropped whole.
const MOST_PENDING: usize = 64;

fn with_sentences<T>(work: impl FnOnce(&mut HashMap<usize, (String, String)>) -> T) -> T {
    let mut guard = SENTENCES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    work(guard.get_or_insert_with(HashMap::new))
}

/// Replaces any record left at this address by an earlier report whose view was skipped.
fn remember<F>(failure: &F, key: &str, written: Option<String>) {
    let address = address_of(failure);
    with_sentences(|map| {
        if let Some(written) = written {
            if map.len() >= MOST_PENDING {
                map.clear();
            }
            map.insert(address, (key.to_owned(), written));
        } else {
            map.remove(&address);
        }
    });
}

fn suggest(failure: &dyn Failure, context: &FailureHookContext) {
    if let Some(unknown) = failure.downcast_ref::<UnknownCommandError>() {
        let names = nearest(
            unknown.token(),
            &command_names(&context.command),
            Spelled::Command,
        );
        let written = messages::unknown_with_suggestion("command", unknown.token(), &names);
        remember(unknown, unknown.token(), written);
    } else if let Some(unknown) = failure.downcast_ref::<UnknownOptionError>() {
        let (candidates, spelled) = if context.invoked_by == InvokedBy::Name {
            (
                option_names(&context.graph, &context.command),
                Spelled::Name,
            )
        } else {
            (
                option_spellings(&context.graph, &context.command),
                Spelled::Option,
            )
        };
        let names = nearest(unknown.spelling(), &candidates, spelled);
        let written = messages::unknown_with_suggestion("option", unknown.spelling(), &names);
        remember(unknown, unknown.spelling(), written);
    } else if let Some(input) = failure.downcast_ref::<InputError>() {
        remember(
            input,
            input.message(),
            values::input_suggestion(input, context),
        );
    }
}

/// The sentence recorded for this failure and key, taken out of the record.
fn take_sentence(address: usize, key: &str) -> Option<String> {
    with_sentences(|map| match map.remove(&address) {
        Some((recorded, written)) if recorded == key => Some(written),
        _ => None,
    })
}

/// The failure's lines as core's default text writes a usage error, each opened by the application
/// name and the whole escaped, then each hint on its own line. With no recorded sentence the lines
/// are the failure's own message, so the bytes are core's.
fn render(written: Option<String>, message: &str, context: &FailureViewContext) -> String {
    let text = written.as_deref().unwrap_or(message);
    let lines: String = text
        .split('\n')
        .map(|line| format!("{}: {line}\n", context.application))
        .collect();
    let mut out = context.view_context.style.escape(&lines);
    for hint in &context.hints {
        out.push_str(hint);
        out.push('\n');
    }
    out
}

/// Offers nearby names and accepted values inside the failure's sentence. The hook reads the
/// graph and records a suggestion for its failure view. Other hints and issues keep their place.
pub fn suggestions() -> Plugin {
    Plugin::new(format!("{PACKAGE_NAME}/suggestions"))
        .on_failure(suggest)
        .views([
            override_view(
                failure::<InputError>(),
                FailureView::new(|input: &InputError, context| {
                    let written = take_sentence(address_of(input), input.message());
                    render(written, input.message(), context)
                }),
            ),
            override_view(
                failure::<UnknownCommandError>(),
                FailureView::new(|unknown: &UnknownCommandError, context| {
                    let written = take_sentence(address_of(unknown), unknown.token());
                    render(written, unknown.message(), context)
                }),
            ),
            override_view(
                failure::<UnknownOptionError>(),
                FailureView::new(|unknown: &UnknownOptionError, context| {
                    let written = take_sentence(address_of(unknown), unknown.spelling());
                    render(written, unknown.message(), context)
                }),
            ),
        ])
}

#[cfg(test)]
mod tests {
    use super::{Spelled, distance, fold, nearest};

    fn chars(text: &str) -> Vec<char> {
        text.chars().collect()
    }

    #[test]
    fn each_edit_kind_costs_one_and_a_distant_transposition_costs_two() {
        assert_eq!(distance(&chars("gt"), &chars("get")), 1);
        assert_eq!(distance(&chars("gett"), &chars("get")), 1);
        assert_eq!(distance(&chars("gat"), &chars("get")), 1);
        assert_eq!(distance(&chars("gte"), &chars("get")), 1);
        assert_eq!(distance(&chars("nale"), &chars("lane")), 2);
        assert_eq!(distance(&chars(""), &chars("abc")), 3);
    }

    #[test]
    fn folding_normalizes_lowercases_and_drops_option_hyphens() {
        assert_eq!(fold("E\u{301}", Spelled::Command), vec!['\u{e9}']);
        assert_eq!(fold("---Field", Spelled::Option), chars("field"));
        assert_eq!(fold("--x", Spelled::Name), chars("--x"));
    }

    #[test]
    fn the_budget_grows_with_the_token_and_the_cap_is_three() {
        let tips = |names: &[&str]| -> Vec<Vec<String>> {
            names.iter().map(|name| vec![(*name).to_owned()]).collect()
        };
        assert_eq!(
            nearest(
                "tep",
                &tips(&["tap", "tip", "top", "tup"]),
                Spelled::Command
            ),
            vec!["tap", "tip", "top"]
        );
        assert!(nearest("x", &tips(&["x"]), Spelled::Command).is_empty());
        assert!(nearest("fxxr", &tips(&["four"]), Spelled::Command).is_empty());
        assert_eq!(
            nearest("fuor", &tips(&["four"]), Spelled::Command),
            vec!["four"]
        );
    }
}
