//! The suggestions plugin: an unknown Command or option suggests the closest declared name.
//!
//! The plugin's `on_failure` hook reads the graph and writes the suggestion sentence for the
//! failure it was handed; the plugin's two failure views write that sentence in place of core's.
//! A failure view's context carries no graph, so the hook is where the graph is read. The hook
//! adds no hint line. When nothing is near, or the failure is none of the two classes, the views
//! write core's own text, hints included.
//!
//! The hook and the view correlate through the failure's address: core boxes each reported
//! failure once and moves it no more until its report is written, so both receive the same object.

mod messages;

use std::collections::HashMap;
use std::sync::Mutex;

use loomcli_core::{
    CommandGraph, CommandNode, Failure, FailureFacts, FailureHookContext, FailureView,
    FailureViewContext, InvokedBy, OptionNode, Plugin, UnknownCommandError, UnknownOptionError,
    failure, override_view,
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
    let mut table = vec![0_usize; (typed.len() + 1) * width];
    for (column, cell) in table.iter_mut().enumerate().take(width) {
        *cell = column;
    }
    for row in 1..=typed.len() {
        table[row * width] = row;
        for column in 1..width {
            let letter = typed[row - 1];
            let other = candidate[column - 1];
            let mut best = (table[(row - 1) * width + column] + 1)
                .min(table[row * width + column - 1] + 1)
                .min(table[(row - 1) * width + column - 1] + usize::from(letter != other));
            if row > 1 && column > 1 && typed[row - 2] == other && candidate[column - 2] == letter {
                best = best.min(table[(row - 2) * width + column - 2] + 1);
            }
            table[row * width + column] = best;
        }
    }
    table[typed.len() * width + candidate.len()]
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

/// The word the failure holds and the sentence that offers its nearest names, if any is near.
fn suggestion(
    failure: &dyn Failure,
    context: &FailureHookContext,
) -> Option<(usize, String, String)> {
    let command = &*context.command;
    if let Some(unknown) = failure.downcast_ref::<UnknownCommandError>() {
        let names = nearest(unknown.token(), &command_names(command), Spelled::Command);
        return messages::unknown_with_suggestion("command", unknown.token(), &names)
            .map(|written| (address_of(unknown), unknown.token().to_owned(), written));
    }
    if let Some(unknown) = failure.downcast_ref::<UnknownOptionError>() {
        let graph = &*context.graph;
        // An invocation by name names an option by its declared name, so it is offered names alone.
        let names = if context.invoked_by == InvokedBy::Name {
            nearest(
                unknown.spelling(),
                &option_names(graph, command),
                Spelled::Name,
            )
        } else {
            nearest(
                unknown.spelling(),
                &option_spellings(graph, command),
                Spelled::Option,
            )
        };
        return messages::unknown_with_suggestion("option", unknown.spelling(), &names)
            .map(|written| (address_of(unknown), unknown.spelling().to_owned(), written));
    }
    None
}

/// The address that identifies one reported failure to both the hook and the view.
fn address_of<F>(failure: &F) -> usize {
    std::ptr::from_ref(failure) as usize
}

/// The sentences the hook wrote, by failure address, each with the typed word it was written for.
/// The view takes its entry out, and only when the word matches, so an entry a skipped view left
/// behind never reaches a later failure that reuses its address.
static SENTENCES: Mutex<Option<HashMap<usize, (String, String)>>> = Mutex::new(None);

/// A map this large holds only entries no view took; it is dropped whole.
const MOST_PENDING: usize = 64;

fn with_sentences<T>(work: impl FnOnce(&mut HashMap<usize, (String, String)>) -> T) -> T {
    let mut guard = SENTENCES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    work(guard.get_or_insert_with(HashMap::new))
}

/// Records the sentence for this report. It first forgets any an earlier report recorded at the
/// same address, so a failure with nothing near never prints another's suggestion.
fn suggest(failure: &dyn Failure, context: &FailureHookContext) {
    let found = suggestion(failure, context);
    with_sentences(|map| {
        if map.len() >= MOST_PENDING {
            map.clear();
        }
        let address = match &found {
            Some((address, _, _)) => Some(*address),
            None => failure
                .downcast_ref::<UnknownCommandError>()
                .map(address_of)
                .or_else(|| failure.downcast_ref::<UnknownOptionError>().map(address_of)),
        };
        if let Some(address) = address {
            map.remove(&address);
        }
        if let Some((address, typed, written)) = found {
            map.insert(address, (typed, written));
        }
    });
}

/// The sentence recorded for this failure and word, taken out of the record.
fn take_sentence(address: usize, typed: &str) -> Option<String> {
    with_sentences(|map| match map.remove(&address) {
        Some((word, written)) if word == typed => Some(written),
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

/// The suggestions plugin: offers the declared name nearest a mistyped Command or option as the
/// fix inside the failure's sentence. Its hook reads the graph and adds no hint; its two views
/// write the sentence, and write core's text when no name is near.
pub fn suggestions() -> Plugin {
    Plugin::new(format!("{PACKAGE_NAME}/suggestions"))
        .on_failure(suggest)
        .views([
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
