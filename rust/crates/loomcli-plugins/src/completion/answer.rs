//! The answer the hidden `completion __complete` Command writes, in Cobra's line protocol: one line
//! per offered word in graph order with repeats removed, then `:` and the directive.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use loomcli_core::{
    ArgumentNode, CommandGraph, CommandNode, OptionGroupKind, OptionNode, Polarity, WordPosition,
};

use crate::closed_set::{Schema, closed_set};

/// Cobra's directive numbers, of which the answer writes three: `0` leaves the shell its default,
/// file names included, `1` reports an error, and `4` turns file completion off.
const SHELL_DEFAULT: u8 = 0;
const ERROR_DIRECTIVE: u8 = 1;
const FILES_OFF: u8 = 4;

/// One offered word and the display text shown beside it, if any.
struct Offer {
    word: String,
    description: Option<String>,
}

/// The offered words of one position and the directive the answer ends with.
struct Offers {
    offers: Vec<Offer>,
    directive: u8,
}

/// The marker Cobra's scripts read as help text rather than as a word.
const ACTIVE_HELP_MARKER: &str = "_activeHelp_ ";

/// Every control character and line separator: U+0000-U+001F, U+007F-U+009F, U+2028, U+2029.
fn is_control(character: char) -> bool {
    character.is_control() || character == '\u{2028}' || character == '\u{2029}'
}

/// Whether a shell inserts the word exactly as the graph holds it. A control character or line
/// separator would be cut or reinterpreted, a word starting with the ActiveHelp marker would print
/// as help, and a word starting with `~` inserts unescaped in Bash 3.2 and Fish and would expand
/// when the line runs, so each is left out. (A Rust string holds no lone surrogate.)
fn is_exact(word: &str) -> bool {
    !word.is_empty()
        && !word.starts_with('~')
        && !word.chars().any(is_control)
        && !word.starts_with(ACTIVE_HELP_MARKER)
}

/// A text with each line break turned into one space: CRLF or one of LF, VT, FF, CR, NEL, LS, PS.
fn single_line(text: &str) -> String {
    let mut reduced = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\r' => {
                if characters.peek() == Some(&'\n') {
                    characters.next();
                }
                reduced.push(' ');
            }
            '\n' | '\u{b}' | '\u{c}' | '\u{85}' | '\u{2028}' | '\u{2029}' => reduced.push(' '),
            other => reduced.push(other),
        }
    }
    reduced
}

/// A description as display text: each line break read as a space, as help reads it, then every
/// control character removed.
fn display_text(description: Option<&str>) -> String {
    single_line(description.unwrap_or_default())
        .chars()
        .filter(|character| !is_control(*character))
        .collect()
}

/// Whether a member is offered: hidden and deprecated members route but are never listed.
fn is_listed(hidden: bool, deprecated: Option<&str>) -> bool {
    !hidden && deprecated.is_none()
}

/// The canonical names of a Command's listed children.
fn child_offers(command: &CommandNode) -> Vec<Offer> {
    command
        .children
        .iter()
        .filter(|child| is_listed(child.hidden, child.deprecated.as_deref()))
        .filter_map(|child| {
            child.name.as_ref().map(|name| Offer {
                word: name.clone(),
                description: child.description.clone(),
            })
        })
        .collect()
}

/// Whether another occurrence of an option adds anything. A counted option adds one, until a
/// verbose-marked count reaches 2 or a quiet-marked count reaches 1. A multiple string option
/// collects another value. Any other option adds only its first occurrence.
fn adds_occurrence(option: &OptionNode, given: u32) -> bool {
    match option {
        OptionNode::Count(count) => {
            if count.verbose {
                given < 2
            } else if count.quiet {
                given < 1
            } else {
                true
            }
        }
        OptionNode::String(string) => string.multiple || given == 0,
        OptionNode::Content(content) => content.multiple || given == 0,
        OptionNode::Boolean(_) => given == 0,
        _ => given == 0,
    }
}

/// The earlier words' view of the options, which `optionOffers` judges repeats against.
struct Given<'a> {
    supplied: &'a [String],
    counts: &'a [(String, u32)],
    booleans: &'a [(String, bool)],
}

impl Given<'_> {
    /// How many times the earlier words gave an option: a counted option's count, and for any other
    /// option 1 when they supplied it, which is all a repeat is judged against.
    fn times(&self, option: &OptionNode) -> u32 {
        if matches!(option, OptionNode::Count(_)) {
            return self
                .counts
                .iter()
                .find(|(name, _)| name == option.name())
                .map_or(0, |(_, count)| *count);
        }
        u32::from(self.supplied.iter().any(|name| name == option.name()))
    }
}

/// The spellings of the options in scope that the word may still name: each long spelling, a
/// Boolean's negative spelling, and the short spelling when the word is exactly `-`. An option the
/// earlier words gave is left out unless another occurrence still adds anything.
fn option_offers(
    graph: &CommandGraph,
    command: &Arc<CommandNode>,
    prefix: &str,
    given: &Given<'_>,
) -> Vec<Offer> {
    let scope: Vec<&Arc<OptionNode>> = graph.globals.iter().chain(command.options.iter()).collect();
    // A Boolean an earlier word gave its absent value claims no exclusive group, so it hides no sibling.
    let absent: HashMap<&str, bool> = command
        .options
        .iter()
        .filter_map(|option| match option.as_ref() {
            OptionNode::Boolean(boolean) => Some((
                boolean.name.as_str(),
                boolean.polarity == Polarity::Negative,
            )),
            _ => None,
        })
        .collect();
    let supplied = |name: &str| given.supplied.iter().any(|supplied| supplied == name);
    let claimed = |name: &str| {
        let value = given
            .booleans
            .iter()
            .find(|(each, _)| each == name)
            .map(|(_, value)| *value);
        supplied(name) && (value.is_none() || value != absent.get(name).copied())
    };
    let excluded: HashSet<&str> = command
        .option_groups
        .iter()
        .filter(|group| {
            group.kind == OptionGroupKind::Exclusive
                && group.options.iter().any(|name| claimed(name))
        })
        .flat_map(|group| group.options.iter())
        .filter(|name| !supplied(name))
        .map(String::as_str)
        .collect();
    scope
        .into_iter()
        .filter(|option| {
            is_listed(option.hidden(), option.deprecated())
                && !excluded.contains(option.name())
                && adds_occurrence(option, given.times(option))
        })
        .flat_map(|option| {
            let mut spellings: Vec<&str> = Vec::new();
            spellings.extend(option.long());
            if let OptionNode::Boolean(boolean) = option.as_ref() {
                spellings.extend(boolean.negative.as_deref());
            }
            if prefix == "-" {
                spellings.extend(option.short());
            }
            let description = description_of(option);
            spellings
                .into_iter()
                .map(|word| Offer {
                    word: word.to_owned(),
                    description: description.clone(),
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn description_of(option: &OptionNode) -> Option<String> {
    match option {
        OptionNode::String(node) => node.description.clone(),
        OptionNode::Content(node) => node.description.clone(),
        OptionNode::Boolean(node) => node.description.clone(),
        OptionNode::Count(node) => node.description.clone(),
        _ => None,
    }
}

fn schema_of(option: &OptionNode) -> Option<&Schema> {
    match option {
        OptionNode::String(node) => node.schema.as_ref(),
        OptionNode::Content(node) => node.schema.as_ref(),
        OptionNode::Boolean(node) => node.schema.as_ref(),
        OptionNode::Count(node) => node.schema.as_ref(),
        _ => None,
    }
}

/// The values of an input's closed set as offered words, or the shell's default with none.
fn value_offers(schema: Option<&Schema>, lead: &str, prefix: &str) -> Offers {
    let Some(values) = closed_set(schema) else {
        return Offers {
            directive: SHELL_DEFAULT,
            offers: Vec::new(),
        };
    };
    let offers = values
        .into_iter()
        .filter(|value| !value.is_empty() && value.starts_with(prefix))
        .map(|value| Offer {
            word: format!("{lead}{value}"),
            description: None,
        })
        .collect();
    Offers {
        directive: FILES_OFF,
        offers,
    }
}

/// What one position offers before the prefix filter and the exactness rule apply.
fn offers_at(graph: &CommandGraph, position: &WordPosition) -> Offers {
    match position {
        WordPosition::Command {
            command,
            argument,
            prefix,
        } => {
            let mut children = child_offers(command);
            let Some(argument) = argument else {
                return Offers {
                    directive: FILES_OFF,
                    offers: children,
                };
            };
            let values = value_offers(argument_schema(argument), "", prefix);
            children.extend(values.offers);
            Offers {
                directive: values.directive,
                offers: children,
            }
        }
        WordPosition::Option {
            command,
            prefix,
            supplied,
            counts,
            booleans,
        } => Offers {
            directive: FILES_OFF,
            offers: option_offers(
                graph,
                command,
                prefix,
                &Given {
                    supplied,
                    counts,
                    booleans,
                },
            ),
        },
        WordPosition::Value {
            option,
            lead,
            prefix,
            ..
        } => value_offers(schema_of(option), lead, prefix),
        WordPosition::Argument {
            argument, prefix, ..
        } => value_offers(argument_schema(argument), "", prefix),
        WordPosition::Passthrough { .. } => Offers {
            directive: SHELL_DEFAULT,
            offers: Vec::new(),
        },
        // The word sits nowhere the grammar reads, so the answer reports an error.
        _ => Offers {
            directive: ERROR_DIRECTIVE,
            offers: Vec::new(),
        },
    }
}

fn argument_schema(argument: &ArgumentNode) -> Option<&Schema> {
    argument.schema.as_ref()
}

/// The part of the word being completed, which every offered word must start with.
fn typed_prefix(position: &WordPosition) -> String {
    match position {
        WordPosition::Value { lead, prefix, .. } => format!("{lead}{prefix}"),
        WordPosition::Command { prefix, .. }
        | WordPosition::Option { prefix, .. }
        | WordPosition::Argument { prefix, .. }
        | WordPosition::Passthrough { prefix, .. } => prefix.clone(),
        _ => String::new(),
    }
}

/// One answer line: the word, then a tab and the description when display text is left.
fn line(offer: &Offer) -> String {
    let text = display_text(offer.description.as_deref());
    if text.is_empty() {
        format!("{}\n", offer.word)
    } else {
        format!("{}\t{text}\n", offer.word)
    }
}

/// The answer `__complete` writes for one located word, in Cobra's line protocol: one line per
/// offered word in graph order with repeats removed, then `:` and the directive. Only exact words
/// that start with the typed prefix are offered.
#[must_use]
pub fn answer(graph: &CommandGraph, position: &WordPosition) -> String {
    let Offers { directive, offers } = offers_at(graph, position);
    let prefix = typed_prefix(position);
    let mut seen: HashSet<String> = HashSet::new();
    let mut text = String::new();
    for offer in &offers {
        if !offer.word.starts_with(&prefix)
            || !is_exact(&offer.word)
            || !seen.insert(offer.word.clone())
        {
            continue;
        }
        text.push_str(&line(offer));
    }
    format!("{text}:{directive}\n")
}
