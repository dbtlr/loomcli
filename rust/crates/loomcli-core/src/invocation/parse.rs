//! The parser: routing on the global options, the routed Command's one table, short groups, value
//! forms, the passthrough tail, and the first structural fault in word order, held to the dispatch
//! boundary.
//!
//! The grammar is the reference's `parse.ts`, read word by word. Routing reads the words before the
//! first bare `--` from the root against the global options, and, at a Command with an action and
//! children, against that Command's whole table, whose own options bind once routing ends. The
//! routed Command then reads its own words against the one table it holds, its own options beside
//! the global ones. Parsing continues past a fault, so every global option is found wherever it
//! sits, and only the first fault in word order is held. Only an unknown Command is raised at once.
//! `locate` reads the earlier words of an unfinished invocation through the same walk.

use std::sync::Arc;

use crate::commands::declaration::ErasedAction;
use crate::failures::{
    AttachedValueRefusal, Error, MisplacedOptionError, MissingValueError, MissingValueForm,
    RepeatedOptionError, UnexpectedArgumentError, UnexpectedValueError, UnknownCommandError,
    UnknownOptionError,
};
use crate::inputs::SuppliedValue;
use crate::inputs::table::{Form, Table};
use crate::inspection::{CommandNode, TypedInputs};

/// One entry of a spelling table: the option a spelling binds, whether that option is global, and
/// how the spelling reads its value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Entry {
    pub(crate) name: String,
    pub(crate) global: bool,
    pub(crate) form: Form,
    pub(crate) last_wins: bool,
    /// Which accepted form the spelling is, which an invocation by name reads.
    pub(crate) role: crate::inputs::table::Role,
}

impl Entry {
    /// Whether the option takes a string: a string or a content option.
    fn is_string(&self) -> bool {
        matches!(
            self.form,
            Form::Separate { .. } | Form::Implied { .. } | Form::Arity { .. }
        )
    }

    /// Whether the option collects every occurrence: a multiple string option.
    fn collects(&self) -> bool {
        matches!(
            self.form,
            Form::Separate { multiple: true }
                | Form::Implied { multiple: true, .. }
                | Form::Arity { multiple: true, .. }
        )
    }

    /// Whether a later occurrence can supply this option again.
    fn accepts_another(&self) -> bool {
        matches!(self.form, Form::Count) || self.collects() || self.last_wins
    }

    /// Whether two entries read their values alike: both take the next word, both imply a value,
    /// both are Boolean, or both count.
    fn same_class(&self, other: &Entry) -> bool {
        match (&self.form, &other.form) {
            (Form::Arity { words: one, .. }, Form::Arity { words: other, .. }) => one == other,
            (one, other) => std::mem::discriminant(one) == std::mem::discriminant(other),
        }
    }

    fn arity(&self) -> Option<usize> {
        match self.form {
            Form::Arity { words, .. } => Some(words),
            _ => None,
        }
    }

    /// How many words a bare spelling can take from those remaining.
    fn separate_words(&self, following: &[String]) -> usize {
        let count = match self.form {
            Form::Arity { words, .. } => words,
            Form::Separate { .. } => 1,
            _ => 0,
        };
        following
            .iter()
            .take(count)
            .take_while(|word| !refuses_value(word))
            .count()
    }

    fn attachment_refusal(&self) -> AttachedValueRefusal {
        match self.form {
            Form::Arity { .. } => AttachedValueRefusal::Arity,
            Form::Count => AttachedValueRefusal::Count,
            _ => AttachedValueRefusal::Boolean,
        }
    }
}

/// A spelling table: each accepted spelling and its entry, in the order the scopes declared them.
pub(crate) type SpellingTable = Vec<(String, Entry)>;

/// The entry for `spelling`.
fn lookup<'t>(table: &'t SpellingTable, spelling: &str) -> Option<&'t Entry> {
    table
        .iter()
        .find(|(known, _)| known == spelling)
        .map(|(_, entry)| entry)
}

/// One scope's compiled spellings as table entries, each marked with whether the scope is global.
pub(crate) fn table_entries(table: &Table, global: bool) -> SpellingTable {
    table
        .iter()
        .map(|(spelling, entry)| {
            (
                spelling.clone(),
                Entry {
                    name: entry.name.clone(),
                    global,
                    form: entry.form.clone(),
                    last_wins: entry.last_wins,
                    role: entry.role,
                },
            )
        })
        .collect()
}

/// One argument slot: the argument's name, and whether it takes every later positional.
#[derive(Clone, Debug)]
pub(crate) struct Slot {
    pub(crate) name: String,
    pub(crate) variadic: bool,
}

/// One Command as the parser reads it: its path, its one table, its children by canonical name and
/// the routes their names and aliases open, its argument slots, and what routing and binding read
/// about it.
pub(crate) struct GrammarCommand {
    pub(crate) table: SpellingTable,
    pub(crate) children: Vec<(String, Arc<GrammarCommand>)>,
    /// Each canonical name and alias, with the index of the child it routes to.
    pub(crate) routes: Vec<(String, usize)>,
    pub(crate) arguments: Vec<Slot>,
    pub(crate) action: Option<ErasedAction>,
    pub(crate) hidden: bool,
    pub(crate) deprecated: bool,
    /// The graph's own node of this Command, which a context and `locate` hand out.
    pub(crate) node: Arc<CommandNode>,
}

impl GrammarCommand {
    /// The child a word routes to, by canonical name or alias.
    pub(crate) fn route(&self, word: &str) -> Option<&(String, Arc<GrammarCommand>)> {
        self.routes
            .iter()
            .find(|(name, _)| name == word)
            .and_then(|(_, index)| self.children.get(*index))
    }
}

/// The grammar of one built graph: the global options' own table, and the root.
pub(crate) struct Grammar {
    pub(crate) globals: SpellingTable,
    pub(crate) root: Arc<GrammarCommand>,
}

/// Whether a word is an option word: `--` and at least one more character, or `-` and an ASCII
/// letter. Every other word is a plain word, so `-`, `-5`, and `-.5` are values or arguments.
pub(crate) fn is_option_word(word: &str) -> bool {
    if let Some(rest) = word.strip_prefix("--") {
        return !rest.is_empty();
    }
    word.strip_prefix('-')
        .and_then(|rest| rest.chars().next())
        .is_some_and(|letter| letter.is_ascii_alphabetic())
}

/// A word the grammar never consumes as a separate value: an option word or the bare `--`.
pub(crate) fn refuses_value(word: &str) -> bool {
    word == "--" || is_option_word(word)
}

/// The value one occurrence supplies. A tuple holds a complete arity occurrence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Supplied {
    Text(String),
    Tuple(Vec<String>),
    Flag(bool),
    Count(u32),
}

/// One occurrence an option word holds, read against one table before it touches a value. `lead`
/// marks a value the word itself carries, after `=` or a short value letter, and holds the part of
/// the word before it.
#[derive(Clone, Debug)]
pub(crate) enum Occurrence<'g> {
    Value {
        option: &'g Entry,
        spelling: String,
        value: Supplied,
        lead: Option<String>,
        /// A bare spelling of a string option with an implied value, which supplied that value.
        implied: bool,
    },
    Unknown {
        spelling: String,
    },
    Misplaced {
        spelling: String,
    },
    Unexpected {
        option: &'g Entry,
        spelling: String,
        value: String,
    },
    Repeated {
        option: &'g Entry,
        spelling: String,
    },
    Missing {
        option: &'g Entry,
        spelling: String,
        received: usize,
        refused: Option<String>,
    },
    Awaiting {
        option: &'g Entry,
        spelling: String,
        words: Vec<String>,
    },
}

impl<'g> Occurrence<'g> {
    /// The spelling the occurrence read.
    fn spelling(&self) -> &str {
        match self {
            Occurrence::Value { spelling, .. }
            | Occurrence::Unknown { spelling }
            | Occurrence::Misplaced { spelling }
            | Occurrence::Unexpected { spelling, .. }
            | Occurrence::Repeated { spelling, .. }
            | Occurrence::Missing { spelling, .. }
            | Occurrence::Awaiting { spelling, .. } => spelling,
        }
    }

    /// The declared option the occurrence read, when it read one.
    fn option(&self) -> Option<&'g Entry> {
        match self {
            Occurrence::Value { option, .. }
            | Occurrence::Unexpected { option, .. }
            | Occurrence::Repeated { option, .. }
            | Occurrence::Missing { option, .. }
            | Occurrence::Awaiting { option, .. } => Some(option),
            Occurrence::Unknown { .. } | Occurrence::Misplaced { .. } => None,
        }
    }

    fn is_value(&self) -> bool {
        matches!(self, Occurrence::Value { .. })
    }
}

/// What one option word holds, in order, and how many following words it took.
pub(crate) struct WordReading<'g> {
    pub(crate) occurrences: Vec<Occurrence<'g>>,
    pub(crate) takes: usize,
}

/// One scope's parsed option values, each map in the order the words first supplied each name.
#[derive(Clone, Debug, Default)]
pub(crate) struct OptionValues {
    pub(crate) strings: Vec<(String, String)>,
    pub(crate) lists: Vec<(String, Vec<String>)>,
    pub(crate) tuples: Vec<(String, Vec<Vec<String>>)>,
    pub(crate) booleans: Vec<(String, bool)>,
    pub(crate) counts: Vec<(String, u32)>,
    /// The spelling of the token that last supplied each option.
    pub(crate) spellings: Vec<(String, String)>,
    /// For each string option a bare spelling supplied, the positions that hold its implied value:
    /// `0` for a scalar, and each such occurrence's index in a multiple option's list.
    pub(crate) implied: Vec<(String, Vec<usize>)>,
}

/// The entry of `name` in an ordered map.
fn entry_of<'m, T>(map: &'m mut [(String, T)], name: &str) -> Option<&'m mut T> {
    map.iter_mut()
        .find(|(known, _)| known == name)
        .map(|(_, value)| value)
}

/// Sets `name` in an ordered map, keeping its first place.
fn set<T>(map: &mut Vec<(String, T)>, name: &str, value: T) {
    match entry_of(map, name) {
        Some(slot) => *slot = value,
        None => map.push((name.to_owned(), value)),
    }
}

fn has<T>(map: &[(String, T)], name: &str) -> bool {
    map.iter().any(|(known, _)| known == name)
}

/// Reads the value of `name` in an ordered map.
fn get<'m, T>(map: &'m [(String, T)], name: &str) -> Option<&'m T> {
    map.iter()
        .find(|(known, _)| known == name)
        .map(|(_, value)| value)
}

/// One value an input source fills, in the shape its option keeps it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Fill {
    Text(String),
    List(Vec<String>),
    Tuples(Vec<Vec<String>>),
    Flag(bool),
    Count(u32),
}

impl OptionValues {
    /// Whether any value was supplied for `name`.
    pub(crate) fn is_supplied(&self, name: &str) -> bool {
        has(&self.strings, name)
            || has(&self.lists, name)
            || has(&self.tuples, name)
            || has(&self.booleans, name)
            || has(&self.counts, name)
    }

    /// The one string supplied for `name`.
    pub(crate) fn string(&self, name: &str) -> Option<&String> {
        get(&self.strings, name)
    }

    /// The strings a multiple option collected for `name`.
    pub(crate) fn list(&self, name: &str) -> Option<&Vec<String>> {
        get(&self.lists, name)
    }

    /// The groups of words, one per supplied arity occurrence.
    pub(crate) fn tuples(&self, name: &str) -> Option<&[Vec<String>]> {
        get(&self.tuples, name).map(Vec::as_slice)
    }

    /// The Boolean value supplied for `name`.
    pub(crate) fn boolean(&self, name: &str) -> Option<bool> {
        get(&self.booleans, name).copied()
    }

    /// The count supplied for `name`.
    pub(crate) fn count(&self, name: &str) -> Option<u32> {
        get(&self.counts, name).copied()
    }

    /// Where a bare spelling supplied the implied value of `name`.
    pub(crate) fn implied_positions(&self, name: &str) -> Option<&Vec<usize>> {
        get(&self.implied, name)
    }

    /// Writes one value an input source filled, where its shape keeps it.
    pub(crate) fn fill(&mut self, name: &str, value: Fill) {
        match value {
            Fill::Text(text) => set(&mut self.strings, name, text),
            Fill::List(list) => set(&mut self.lists, name, list),
            Fill::Tuples(tuples) => set(&mut self.tuples, name, tuples),
            Fill::Flag(flag) => set(&mut self.booleans, name, flag),
            Fill::Count(count) => set(&mut self.counts, name, count),
        }
    }

    /// Removes every value of `name`, so the option reads as unfilled by every tier.
    pub(crate) fn withdraw(&mut self, name: &str) {
        self.strings.retain(|(known, _)| known != name);
        self.lists.retain(|(known, _)| known != name);
        self.tuples.retain(|(known, _)| known != name);
        self.booleans.retain(|(known, _)| known != name);
        self.counts.retain(|(known, _)| known != name);
    }

    /// The values of two scopes as one, whose names never overlap.
    pub(crate) fn merged(globals: &Self, locals: &Self) -> Self {
        fn both<T: Clone>(a: &[(String, T)], b: &[(String, T)]) -> Vec<(String, T)> {
            a.iter().chain(b).cloned().collect()
        }
        Self {
            strings: both(&globals.strings, &locals.strings),
            lists: both(&globals.lists, &locals.lists),
            tuples: both(&globals.tuples, &locals.tuples),
            booleans: both(&globals.booleans, &locals.booleans),
            counts: both(&globals.counts, &locals.counts),
            spellings: both(&globals.spellings, &locals.spellings),
            implied: both(&globals.implied, &locals.implied),
        }
    }

    /// Records one value an invocation by name lowered to, under the spelling a problem names its
    /// option by.
    pub(crate) fn supply(
        &mut self,
        option: &Entry,
        spelling: &str,
        value: &Supplied,
        implied: bool,
    ) {
        set(&mut self.spellings, &option.name, spelling.to_owned());
        self.write(option, value, implied);
    }

    /// Records one supplied value in the map its kind and its declaration decide.
    fn write(&mut self, option: &Entry, value: &Supplied, implied: bool) {
        let name = option.name.as_str();
        match value {
            Supplied::Flag(flag) => set(&mut self.booleans, name, *flag),
            Supplied::Count(count) => match entry_of(&mut self.counts, name) {
                Some(total) => *total = total.saturating_add(*count),
                None => self.counts.push((name.to_owned(), *count)),
            },
            Supplied::Tuple(words) => {
                if option.collects()
                    && let Some(tuples) = entry_of(&mut self.tuples, name)
                {
                    tuples.push(words.clone());
                } else {
                    set(&mut self.tuples, name, vec![words.clone()]);
                }
            }
            Supplied::Text(text) => {
                let position = self.write_string(option, text);
                if option.last_wins {
                    self.implied.retain(|(known, _)| known != name);
                }
                if implied {
                    match entry_of(&mut self.implied, name) {
                        Some(positions) => positions.push(position),
                        None => self.implied.push((name.to_owned(), vec![position])),
                    }
                }
            }
        }
    }

    /// Records one string value, and answers the position it took.
    fn write_string(&mut self, option: &Entry, value: &str) -> usize {
        let name = option.name.as_str();
        if !option.collects() {
            set(&mut self.strings, name, value.to_owned());
            return 0;
        }
        match entry_of(&mut self.lists, name) {
            Some(list) => {
                list.push(value.to_owned());
                list.len() - 1
            }
            None => {
                self.lists.push((name.to_owned(), vec![value.to_owned()]));
                0
            }
        }
    }
}

/// The parsed values of both scopes.
#[derive(Clone, Debug, Default)]
pub(crate) struct ScopeValues {
    pub(crate) globals: OptionValues,
    pub(crate) locals: OptionValues,
}

impl ScopeValues {
    fn of(&self, option: &Entry) -> &OptionValues {
        if option.global {
            &self.globals
        } else {
            &self.locals
        }
    }

    fn of_mut(&mut self, option: &Entry) -> &mut OptionValues {
        if option.global {
            &mut self.globals
        } else {
            &mut self.locals
        }
    }
}

/// What one option word is read against: a table, and the values earlier words supplied.
struct WordContext<'a, 'g> {
    table: &'g SpellingTable,
    values: &'a ScopeValues,
}

impl WordContext<'_, '_> {
    /// Whether an occurrence of `option` repeats one an earlier word supplied.
    fn repeats(&self, option: &Entry) -> bool {
        !option.accepts_another() && self.values.of(option).is_supplied(&option.name)
    }
}

/// What a spelling with nothing attached supplies: a Boolean's own value, one occurrence of a count,
/// or a string option's implied value. A string option that takes the next word has none.
fn bare_value<'g>(option: &'g Entry, spelling: &str) -> Option<Occurrence<'g>> {
    let (value, implied) = match &option.form {
        Form::Boolean { value } => (Supplied::Flag(*value), false),
        Form::Count => (Supplied::Count(1), false),
        Form::Implied { implied, .. } => (Supplied::Text(implied.clone()), true),
        Form::Separate { .. } | Form::Arity { .. } => return None,
    };
    Some(Occurrence::Value {
        option,
        spelling: spelling.to_owned(),
        value,
        lead: None,
        implied,
    })
}

/// Which spelling to name when a word stops an arity occurrence.
fn refused_spelling(word: &str) -> Option<String> {
    if word == "--" {
        None
    } else if word.starts_with("--") {
        Some(word.split('=').next().unwrap_or(word).to_owned())
    } else {
        Some(word.chars().take(2).collect())
    }
}

/// Reads the separate words after a spelling. The next option word stays available to the parser.
fn separate_value<'g>(option: &'g Entry, spelling: &str, following: &[String]) -> WordReading<'g> {
    let takes = option.separate_words(following);
    let arity = option.arity();
    let spelling = spelling.to_owned();
    let occurrence = if takes == arity.unwrap_or(1) {
        let value = if arity.is_some() {
            Supplied::Tuple(following[..takes].to_vec())
        } else {
            Supplied::Text(following[0].clone())
        };
        Occurrence::Value {
            option,
            spelling,
            value,
            lead: None,
            implied: false,
        }
    } else if let Some(refused) = following.get(takes) {
        Occurrence::Missing {
            option,
            spelling,
            received: takes,
            refused: arity.and_then(|_| refused_spelling(refused)),
        }
    } else {
        Occurrence::Awaiting {
            option,
            spelling,
            words: following[..takes].to_vec(),
        }
    };
    WordReading {
        occurrences: vec![occurrence],
        takes,
    }
}

/// A word that starts with `--`, split at its first `=` into the spelling and the value it carries.
fn read_long<'g>(
    context: &WordContext<'_, 'g>,
    word: &str,
    following: &[String],
) -> WordReading<'g> {
    let (spelling, inline) = match word.split_once('=') {
        Some((spelling, inline)) => (spelling, Some(inline)),
        None => (word, None),
    };
    let Some(option) = lookup(context.table, spelling) else {
        return WordReading {
            occurrences: vec![Occurrence::Unknown {
                spelling: spelling.to_owned(),
            }],
            takes: 0,
        };
    };
    if context.repeats(option) {
        let takes = inline.map_or_else(|| option.separate_words(following), |_| 0);
        return WordReading {
            occurrences: vec![Occurrence::Repeated {
                option,
                spelling: spelling.to_owned(),
            }],
            takes,
        };
    }
    let Some(inline) = inline else {
        return match bare_value(option, spelling) {
            Some(bare) => WordReading {
                occurrences: vec![bare],
                takes: 0,
            },
            None => separate_value(option, spelling, following),
        };
    };
    let occurrence = if option.is_string() && option.arity().is_none() {
        Occurrence::Value {
            option,
            spelling: spelling.to_owned(),
            value: Supplied::Text(inline.to_owned()),
            lead: Some(format!("{spelling}=")),
            implied: false,
        }
    } else {
        Occurrence::Unexpected {
            option,
            spelling: spelling.to_owned(),
            value: inline.to_owned(),
        }
    };
    WordReading {
        occurrences: vec![occurrence],
        takes: 0,
    }
}

/// One short group being walked: its word, its letters by code point, the word after it, and the
/// options its earlier letters set, which a later letter repeats.
struct Group<'a, 'b, 'g> {
    context: &'b WordContext<'a, 'g>,
    letters: Vec<char>,
    following: &'b [String],
    set: Vec<String>,
    word: &'b str,
}

/// What one letter of a group holds, and whether it ends the walk.
struct LetterReading<'g> {
    reading: WordReading<'g>,
    ends: bool,
}

/// A Boolean letter is set and a counted letter adds one, and the walk continues; a `=` after either
/// is a value it cannot take.
fn valueless_letter<'g>(option: &'g Entry, spelling: String, rest: &str) -> LetterReading<'g> {
    let occurrence = match rest.strip_prefix('=') {
        Some(value) => Occurrence::Unexpected {
            option,
            spelling,
            value: value.to_owned(),
        },
        None => {
            let value = match option.form {
                Form::Boolean { value } => Supplied::Flag(value),
                _ => Supplied::Count(1),
            };
            Occurrence::Value {
                option,
                spelling,
                value,
                lead: None,
                implied: false,
            }
        }
    };
    LetterReading {
        ends: !occurrence.is_value(),
        reading: WordReading {
            occurrences: vec![occurrence],
            takes: 0,
        },
    }
}

/// A value letter ends the group: the rest of the word is its value, with one leading `=` stripped.
/// When nothing remains, a letter with an implied value supplies it, and any other takes the next
/// word as its value.
fn value_letter<'g>(
    group: &Group<'_, '_, 'g>,
    option: &'g Entry,
    spelling: String,
    rest: &str,
) -> LetterReading<'g> {
    if rest.is_empty() {
        let reading = match bare_value(option, &spelling) {
            Some(bare) => WordReading {
                occurrences: vec![bare],
                takes: 0,
            },
            None => separate_value(option, &spelling, group.following),
        };
        return LetterReading {
            reading,
            ends: true,
        };
    }
    let value = rest.strip_prefix('=').unwrap_or(rest);
    let occurrence = if option.arity().is_some() {
        Occurrence::Unexpected {
            option,
            spelling,
            value: value.to_owned(),
        }
    } else {
        let lead = group.word[..group.word.len() - value.len()].to_owned();
        Occurrence::Value {
            option,
            spelling,
            value: Supplied::Text(value.to_owned()),
            lead: Some(lead),
            implied: false,
        }
    };
    LetterReading {
        reading: WordReading {
            occurrences: vec![occurrence],
            takes: 0,
        },
        ends: true,
    }
}

/// The letter at one index of a group, read against the group's table.
fn read_letter<'g>(group: &mut Group<'_, '_, 'g>, index: usize) -> LetterReading<'g> {
    let spelling = format!("-{}", group.letters[index]);
    let rest: String = group.letters[index + 1..].iter().collect();
    let Some(option) = lookup(group.context.table, &spelling) else {
        return LetterReading {
            reading: WordReading {
                occurrences: vec![Occurrence::Unknown { spelling }],
                takes: 0,
            },
            ends: true,
        };
    };
    let in_group = group.set.contains(&option.name) && !option.accepts_another();
    if in_group || group.context.repeats(option) {
        let takes = if rest.is_empty() {
            option.separate_words(group.following)
        } else {
            0
        };
        return LetterReading {
            reading: WordReading {
                occurrences: vec![Occurrence::Repeated { option, spelling }],
                takes,
            },
            ends: true,
        };
    }
    group.set.push(option.name.clone());
    if option.is_string() {
        value_letter(group, option, spelling, &rest)
    } else {
        valueless_letter(option, spelling, &rest)
    }
}

/// A short group under the `getopt` rule, one code point per letter. The walk stops at a value
/// letter or at the first letter that faults, a repeated one included, so the characters after it
/// are never read as letters.
fn read_group<'g>(
    context: &WordContext<'_, 'g>,
    word: &str,
    following: &[String],
) -> WordReading<'g> {
    let mut group = Group {
        context,
        letters: word.chars().skip(1).collect(),
        following,
        set: Vec::new(),
        word,
    };
    let mut occurrences = Vec::new();
    for index in 0..group.letters.len() {
        let letter = read_letter(&mut group, index);
        occurrences.extend(letter.reading.occurrences);
        if letter.ends {
            return WordReading {
                occurrences,
                takes: letter.reading.takes,
            };
        }
    }
    WordReading {
        occurrences,
        takes: 0,
    }
}

/// One option word read against one table, with its remaining words available as values.
fn read_option_word<'g>(
    table: &'g SpellingTable,
    values: &ScopeValues,
    word: &str,
    following: &[String],
) -> WordReading<'g> {
    let context = WordContext { table, values };
    if word.starts_with("--") {
        read_long(&context, word, following)
    } else {
        read_group(&context, word, following)
    }
}

/// The first structural fault in word order: a failure, or the position of the first positional no
/// slot accepts, which becomes a failure once every later positional is known. `at` is the order in
/// which the faulted occurrence was read, so a fault found later than it was read still ranks by it.
pub(crate) struct HeldFault {
    at: usize,
    kind: FaultKind,
}

enum FaultKind {
    Failure(Error),
    Extra(usize),
}

/// A string option the last word left waiting for its value.
#[derive(Clone, Debug)]
pub(crate) struct AwaitingValue {
    pub(crate) global: bool,
    pub(crate) name: String,
    pub(crate) spelling: String,
    pub(crate) arity: Option<usize>,
    pub(crate) words: Vec<String>,
}

/// The state one reading carries from word to word, through routing and the routed Command's words
/// alike. `read` counts every occurrence and positional read so far, and `at` is the order of the one
/// being applied. `supplied` holds each option name with the order in which it was first supplied.
struct ReadState<'g> {
    at: usize,
    awaiting: Option<AwaitingValue>,
    command: &'g GrammarCommand,
    escapable: Option<String>,
    fault: Option<HeldFault>,
    faulted: Vec<String>,
    global_fault: bool,
    held_booleans: Vec<(String, bool)>,
    path: Vec<String>,
    pending: Vec<(usize, Occurrence<'g>)>,
    positionals: Vec<String>,
    read: usize,
    routed: bool,
    supplied: Vec<(usize, String)>,
    values: ScopeValues,
}

impl<'g> ReadState<'g> {
    /// Stamps the next occurrence or positional with its order in the words.
    fn stamp(&mut self) {
        self.at = self.read;
        self.read += 1;
    }

    /// Holds a fault unless one read earlier is held already.
    fn keep(&mut self, fault: HeldFault) {
        if self.fault.as_ref().is_none_or(|held| fault.at < held.at) {
            self.fault = Some(fault);
        }
    }

    /// Holds a failure unless an earlier word already holds one, and notes a fault on a global
    /// option. Answers `false`, so the word's later occurrences are not read.
    fn hold(&mut self, failure: Error, global: bool) -> bool {
        self.keep(HeldFault {
            at: self.at,
            kind: FaultKind::Failure(failure),
        });
        self.global_fault |= global;
        false
    }

    /// Lists one supplied option name at the order it was read in.
    fn note(&mut self, at: usize, name: &str) {
        let later = self
            .supplied
            .iter()
            .position(|(read, _)| *read > at)
            .unwrap_or(self.supplied.len());
        self.supplied.insert(later, (at, name.to_owned()));
    }

    /// Lists the held-back options while routing is still open, each under the name the reached
    /// Command's own entry gives its spelling, and notes the value a Boolean spelling gives it.
    fn note_held(&mut self) {
        let pending = std::mem::take(&mut self.pending);
        for (at, occurrence) in &pending {
            let Some(entry) = lookup(&self.command.table, occurrence.spelling()) else {
                continue;
            };
            if self.supplied.iter().any(|(_, name)| *name == entry.name) {
                continue;
            }
            self.note(*at, &entry.name);
            let boolean = |form: &Form| matches!(form, Form::Boolean { .. });
            if let (Occurrence::Value { option, .. }, Form::Boolean { value }) =
                (occurrence, &entry.form)
                && boolean(&option.form)
            {
                set(&mut self.held_booleans, &entry.name, *value);
            }
        }
        self.pending = pending;
    }

    /// Writes one value an occurrence supplied.
    fn supply(&mut self, option: &Entry, spelling: &str, value: &Supplied, implied: bool) -> bool {
        if !has(&self.values.of(option).spellings, &option.name) {
            self.note(self.at, &option.name);
        }
        let values = self.values.of_mut(option);
        set(&mut values.spellings, &option.name, spelling.to_owned());
        values.write(option, value, implied);
        true
    }

    /// The failure a spelling the routed Command's table does not hold reports.
    fn unplaced(&self, spelling: &str) -> Error {
        let commands = declarers(self.command, &self.path, spelling);
        if !commands.is_empty() {
            return MisplacedOptionError::new(spelling, commands).into();
        }
        if self.command.node.passthrough.is_none() && !self.command.arguments.is_empty() {
            return UnknownOptionError::before_arguments(spelling).into();
        }
        UnknownOptionError::new(spelling).into()
    }

    /// Applies one occurrence, and answers whether the word's next occurrence is read.
    fn apply_occurrence(&mut self, occurrence: &Occurrence<'g>) -> bool {
        match occurrence {
            Occurrence::Value {
                option,
                spelling,
                value,
                implied,
                ..
            } => self.supply(option, spelling, value, *implied),
            Occurrence::Unknown { spelling } => {
                let failure = self.unplaced(spelling);
                self.hold(failure, false)
            }
            Occurrence::Misplaced { spelling } => {
                let failure = MisplacedOptionError::new(spelling, vec![self.path.clone()]).into();
                self.hold(failure, false)
            }
            Occurrence::Awaiting {
                option,
                spelling,
                words,
            } => {
                self.awaiting = Some(AwaitingValue {
                    global: option.global,
                    name: option.name.clone(),
                    spelling: spelling.clone(),
                    arity: option.arity(),
                    words: words.clone(),
                });
                false
            }
            Occurrence::Unexpected {
                option,
                spelling,
                value,
            } => {
                self.note_faulted(option);
                let failure =
                    UnexpectedValueError::new(spelling, value, option.attachment_refusal()).into();
                self.hold(failure, option.global)
            }
            Occurrence::Repeated { option, spelling } => {
                self.note_faulted(option);
                self.hold(RepeatedOptionError::new(spelling).into(), option.global)
            }
            Occurrence::Missing {
                option,
                spelling,
                received,
                refused,
            } => {
                self.note_faulted(option);
                let failure = option.arity().map_or_else(
                    || MissingValueError::new(spelling, MissingValueForm::Attached),
                    |arity| {
                        MissingValueError::for_arity(spelling, arity, *received, refused.as_deref())
                    },
                );
                self.hold(failure.into(), option.global)
            }
        }
    }

    fn note_faulted(&mut self, option: &Entry) {
        if !self.faulted.contains(&option.name) {
            self.faulted.push(option.name.clone());
        }
    }

    /// Applies a word's occurrences in order, up to the first that faults. While routing is open,
    /// an occurrence of a Command's own option is held back, to bind where routing ends.
    fn apply(&mut self, reading: WordReading<'g>) {
        for occurrence in reading.occurrences {
            self.stamp();
            let held = !self.routed
                && !matches!(occurrence, Occurrence::Awaiting { .. })
                && occurrence.option().is_some_and(|option| !option.global);
            if held {
                let value = occurrence.is_value();
                self.pending.push((self.at, occurrence));
                if !value {
                    return;
                }
            } else if !self.apply_occurrence(&occurrence) {
                return;
            }
        }
    }

    /// The occurrence routing read against a parent's own option, bound to the routed Command's
    /// declaration of the same spelling. A Command without it reports the spelling as it reports any
    /// its table lacks, and a declaration of another value class is misplaced, because the parent's
    /// declaration already decided whether the next word was the value.
    fn rebound(
        command: &'g GrammarCommand,
        values: &ScopeValues,
        pending: &Occurrence<'g>,
    ) -> Occurrence<'g> {
        let spelling = pending.spelling().to_owned();
        let Some(option) = lookup(&command.table, &spelling) else {
            return Occurrence::Unknown { spelling };
        };
        let Some(held) = pending.option() else {
            return pending.clone();
        };
        if !option.same_class(held) {
            return Occurrence::Misplaced { spelling };
        }
        match pending {
            Occurrence::Value {
                value,
                lead,
                implied,
                ..
            } => {
                let context = WordContext {
                    table: &command.table,
                    values,
                };
                if context.repeats(option) {
                    return Occurrence::Repeated { option, spelling };
                }
                // The bound declaration decides what a spelling with nothing attached supplies; a
                // value in the next word or attached is the word the parent's declaration read.
                let bare = if lead.is_none() {
                    bare_value(option, &spelling)
                } else {
                    None
                };
                let value = match bare {
                    Some(Occurrence::Value { value, .. }) => value,
                    _ => value.clone(),
                };
                Occurrence::Value {
                    option,
                    spelling,
                    value,
                    lead: lead.clone(),
                    implied: *implied,
                }
            }
            Occurrence::Unexpected { value, .. } => {
                if option.is_string() && option.arity().is_none() {
                    Occurrence::Misplaced { spelling }
                } else {
                    Occurrence::Unexpected {
                        option,
                        spelling,
                        value: value.clone(),
                    }
                }
            }
            Occurrence::Repeated { .. } => Occurrence::Repeated { option, spelling },
            Occurrence::Missing {
                received, refused, ..
            } => Occurrence::Missing {
                option,
                spelling,
                received: *received,
                refused: refused.clone(),
            },
            other => other.clone(),
        }
    }

    /// Binds each occurrence routing read against a parent's own option to the Command it reached.
    fn bind_pending(&mut self) {
        let pending = std::mem::take(&mut self.pending);
        for (at, occurrence) in &pending {
            self.at = *at;
            let bound = Self::rebound(self.command, &self.values, occurrence);
            self.apply_occurrence(&bound);
        }
    }

    /// One plain word after routing: the routed Command's next positional.
    fn positional(&mut self, word: &str) {
        self.stamp();
        self.positionals.push(word.to_owned());
        let position = self.positionals.len() - 1;
        if argument_slot(&self.command.arguments, position).is_none() {
            self.keep(HeldFault {
                at: self.at,
                kind: FaultKind::Extra(position),
            });
        }
    }

    /// One word of the routed Command, read against its table. Answers how many later words it took.
    fn read_command_word(&mut self, word: &str, following: &[String]) -> usize {
        if !is_option_word(word) {
            self.positional(word);
            return 0;
        }
        let reading = read_option_word(&self.command.table, &self.values, word, following);
        let takes = reading.takes;
        self.apply(reading);
        takes
    }
}

/// The visible Commands below one Command that declare a spelling, as paths from the root in
/// authoring order. A hidden or deprecated Command, and every Command below it, is left out.
fn declarers(command: &GrammarCommand, path: &[String], spelling: &str) -> Vec<Vec<String>> {
    let mut found = Vec::new();
    for (name, child) in &command.children {
        if child.hidden || child.deprecated {
            continue;
        }
        let mut below = path.to_vec();
        below.push(name.clone());
        if lookup(&child.table, spelling).is_some() {
            found.push(below.clone());
        }
        found.extend(declarers(child, &below, spelling));
    }
    found
}

/// The names a routing failure offers: the canonical names of the visible, current children, in
/// authoring order. A deprecated child typed in full still routes.
pub(crate) fn candidates_of(command: &GrammarCommand) -> Vec<String> {
    command
        .children
        .iter()
        .filter(|(_, child)| !child.hidden && !child.deprecated)
        .map(|(name, _)| name.clone())
        .collect()
}

/// The next positional slot for an unfinished invocation. A variadic takes every word from its
/// position onward until complete binding has enough information to reserve the suffix.
pub(crate) fn argument_slot(slots: &[Slot], position: usize) -> Option<(usize, &Slot)> {
    if let Some((index, slot)) = slots
        .iter()
        .take(position.saturating_add(1))
        .enumerate()
        .find(|(_, slot)| slot.variadic)
    {
        return Some((index, slot));
    }
    slots.get(position).map(|slot| (position, slot))
}

/// An unknown Command, raised as routing reads it, with the path routing walked to it.
pub(crate) struct RoutingFailure {
    pub(crate) path: Vec<String>,
    pub(crate) error: Error,
}

/// Every word the reading of one word list found, which may stop short of a complete invocation.
pub(crate) struct WordsRead<'g> {
    pub(crate) awaiting: Option<AwaitingValue>,
    pub(crate) command: &'g GrammarCommand,
    pending: Vec<(usize, Occurrence<'g>)>,
    /// Whether the routed Command read a word, so no later plain word names a child.
    pub(crate) committed: bool,
    pub(crate) delimited: bool,
    pub(crate) escapable: Option<String>,
    pub(crate) fault: Option<HeldFault>,
    pub(crate) faulted: Vec<String>,
    pub(crate) global_fault: bool,
    pub(crate) held_booleans: Vec<(String, bool)>,
    pub(crate) passthrough: Vec<String>,
    pub(crate) path: Vec<String>,
    pub(crate) positionals: Vec<String>,
    pub(crate) read: usize,
    pub(crate) supplied: Vec<String>,
    pub(crate) values: ScopeValues,
}

impl WordsRead<'_> {
    /// Reads the earlier words for completion, including a parent's still-unbound occurrences.
    pub(crate) fn typed_inputs(&self) -> TypedInputs {
        let mut held = ScopeValues::default();
        for (_, occurrence) in &self.pending {
            if let Occurrence::Value {
                option,
                value,
                implied,
                ..
            } = ReadState::rebound(self.command, &held, occurrence)
            {
                held.locals.write(option, &value, implied);
            }
        }
        let locals = if self.pending.is_empty() {
            &self.values.locals
        } else {
            &held.locals
        };

        let mut typed = TypedInputs::default();
        for values in [&self.values.globals, locals] {
            for (name, value) in &values.strings {
                if values.implied_positions(name).is_none_or(Vec::is_empty) {
                    typed.options.insert(name.clone(), vec![value.clone()]);
                }
            }
            for (name, words) in &values.lists {
                let implied = values.implied_positions(name);
                let words: Vec<_> = words
                    .iter()
                    .enumerate()
                    .filter(|(index, _)| implied.is_none_or(|positions| !positions.contains(index)))
                    .map(|(_, word)| word.clone())
                    .collect();
                if !words.is_empty() {
                    typed.options.insert(name.clone(), words);
                }
            }
            for (name, tuples) in &values.tuples {
                typed
                    .options
                    .insert(name.clone(), tuples.iter().flatten().cloned().collect());
            }
        }
        if let Some(awaiting) = &self.awaiting
            && !awaiting.words.is_empty()
        {
            typed
                .options
                .entry(awaiting.name.clone())
                .or_default()
                .extend_from_slice(&awaiting.words);
        }
        for (index, word) in self.positionals.iter().enumerate() {
            if let Some((_, slot)) = argument_slot(&self.command.arguments, index) {
                typed
                    .arguments
                    .entry(slot.name.clone())
                    .or_default()
                    .push(word.clone());
            }
        }
        typed
    }
}

/// Reads a word list through routing, the routed Command's own words, and the delimiter tail.
/// `partial` reads the earlier words of an unfinished invocation, as `locate` does: a word after
/// them may continue routing, so routing has not ended where they run out at a Command with
/// children, and a parent's own option stays unbound.
pub(crate) fn read_words<'g>(
    grammar: &'g Grammar,
    words: &[String],
    partial: bool,
) -> Result<WordsRead<'g>, RoutingFailure> {
    let mut state = ReadState {
        at: 0,
        awaiting: None,
        command: &grammar.root,
        escapable: None,
        fault: None,
        faulted: Vec::new(),
        global_fault: false,
        held_booleans: Vec::new(),
        path: Vec::new(),
        pending: Vec::new(),
        positionals: Vec::new(),
        read: 0,
        routed: false,
        supplied: Vec::new(),
        values: ScopeValues::default(),
    };
    let start = route(grammar, &mut state, words)?;
    let ended = start < words.len()
        || !partial
        || state.command.children.is_empty()
        || state
            .pending
            .iter()
            .any(|(_, occurrence)| !occurrence.is_value());
    if ended {
        state.routed = true;
        state.bind_pending();
    } else {
        state.note_held();
    }
    let mut delimited = false;
    let mut passthrough = Vec::new();
    let mut index = start;
    while index < words.len() {
        let word = &words[index];
        if word == "--" {
            delimited = true;
            let tail = &words[index + 1..];
            if state.command.node.passthrough.is_some() {
                passthrough = tail.to_vec();
            } else {
                for word in tail {
                    state.positional(word);
                }
            }
            break;
        }
        index += state.read_command_word(word, &words[index + 1..]) + 1;
    }
    Ok(WordsRead {
        pending: state.pending,
        awaiting: state.awaiting,
        command: state.command,
        committed: start < words.len() && words[start] != "--",
        delimited,
        escapable: state.escapable,
        fault: state.fault,
        faulted: state.faulted,
        global_fault: state.global_fault,
        held_booleans: state.held_booleans,
        passthrough,
        path: state.path,
        positionals: state.positionals,
        read: state.read,
        supplied: state.supplied.into_iter().map(|(_, name)| name).collect(),
        values: state.values,
    })
}

/// Routing: the words before the first bare `--`, read from the root against the global options,
/// and at a Command with children against its whole table. Answers the index of the
/// first word it did not read; an unknown Command is the one fault raised here.
fn route<'g>(
    grammar: &'g Grammar,
    state: &mut ReadState<'g>,
    words: &[String],
) -> Result<usize, RoutingFailure> {
    let mut index = 0;
    while let Some(word) = words.get(index) {
        if word == "--" {
            break;
        }
        let read = if is_option_word(word) {
            let command = state.command;
            let table = if command.children.is_empty() {
                &grammar.globals
            } else {
                &command.table
            };
            let reading = read_option_word(table, &state.values, word, &words[index + 1..]);
            if reading
                .occurrences
                .iter()
                .any(|occurrence| matches!(occurrence, Occurrence::Unknown { .. }))
            {
                break;
            }
            let read = reading.takes + 1;
            state.apply(reading);
            read
        } else {
            let command = state.command;
            if command.children.is_empty() {
                break;
            }
            let Some((name, child)) = command.route(word) else {
                if !command.arguments.is_empty() {
                    break;
                }
                return Err(RoutingFailure {
                    path: state.path.clone(),
                    error: UnknownCommandError::new(word, candidates_of(command)).into(),
                });
            };
            // An alias routes like the canonical name, and the path reports that name alone.
            state.escapable = (!command.arguments.is_empty() && command.node.passthrough.is_none())
                .then(|| word.clone());
            state.command = child;
            state.path.push(name.clone());
            1
        };
        index += read;
    }
    Ok(index)
}

/// One complete invocation, read through routing and the routed Command's table.
pub(crate) struct ParsedInvocation<'g> {
    /// What each argument slot received, by argument name; an omitted argument binds nothing.
    pub(crate) args: Vec<(String, SuppliedValue)>,
    pub(crate) command: &'g GrammarCommand,
    pub(crate) escapable: Option<String>,
    /// The first structural fault in word order, which core holds to the dispatch boundary.
    pub(crate) fault: Option<Error>,
    /// Every option with an occurrence that faulted, whether or not its fault is the one held.
    pub(crate) faulted: Vec<String>,
    /// Whether a global option faulted.
    pub(crate) global_fault: bool,
    pub(crate) passthrough: Vec<String>,
    pub(crate) path: Vec<String>,
    pub(crate) values: ScopeValues,
    /// Under an invocation by name, each input whose value no token spells, with the issue that
    /// says what the input takes.
    pub(crate) unlowered: Vec<(crate::inputs::InputIdentity, String)>,
    /// Under an invocation by name, the options the call leaves out of its run.
    pub(crate) excluded: Vec<String>,
}

/// The words each positional slot received: a variadic slot collects them, any other holds one.
fn bind_arguments(
    command: &GrammarCommand,
    positionals: &[String],
) -> Vec<(String, SuppliedValue)> {
    let mut bound: Vec<(String, SuppliedValue)> = Vec::new();
    let mut prefix = positionals;
    if let Some(variadic) = command.arguments.iter().position(|slot| slot.variadic) {
        for slot in command.arguments[variadic + 1..].iter().rev() {
            let Some((word, remaining)) = prefix.split_last() else {
                break;
            };
            bound.push((slot.name.clone(), SuppliedValue::One(word.clone())));
            prefix = remaining;
        }
    }
    for (position, word) in prefix.iter().enumerate() {
        let Some((_, slot)) = argument_slot(&command.arguments, position) else {
            continue;
        };
        if !slot.variadic {
            set(&mut bound, &slot.name, SuppliedValue::One(word.clone()));
        } else if let Some(SuppliedValue::Many(words)) = entry_of(&mut bound, &slot.name) {
            words.push(word.clone());
        } else {
            set(
                &mut bound,
                &slot.name,
                SuppliedValue::Many(vec![word.clone()]),
            );
        }
    }
    bound
}

/// Parses a complete invocation, where a string option still waiting for its value at the end of
/// the words is a missing value.
pub(crate) fn parse_invocation<'g>(
    grammar: &'g Grammar,
    argv: &[String],
) -> Result<ParsedInvocation<'g>, RoutingFailure> {
    let read = read_words(grammar, argv, false)?;
    let missing = read.awaiting.as_ref().map(|awaiting| HeldFault {
        at: read.read,
        kind: FaultKind::Failure(
            awaiting
                .arity
                .map_or_else(
                    || MissingValueError::new(&awaiting.spelling, MissingValueForm::Separate),
                    |arity| {
                        MissingValueError::for_arity(
                            &awaiting.spelling,
                            arity,
                            awaiting.words.len(),
                            None,
                        )
                    },
                )
                .into(),
        ),
    });
    let fault = read.fault.or(missing).map(|fault| match fault.kind {
        FaultKind::Failure(error) => error,
        FaultKind::Extra(position) => UnexpectedArgumentError::new(
            read.path.clone(),
            read.command.arguments.len(),
            read.positionals[position..].to_vec(),
        )
        .into(),
    });
    let mut faulted = read.faulted;
    if let Some(awaiting) = &read.awaiting
        && !faulted.contains(&awaiting.name)
    {
        faulted.push(awaiting.name.clone());
    }
    Ok(ParsedInvocation {
        args: bind_arguments(read.command, &read.positionals),
        command: read.command,
        escapable: read.escapable,
        fault,
        faulted,
        global_fault: read.global_fault || read.awaiting.as_ref().is_some_and(|a| a.global),
        passthrough: read.passthrough,
        path: read.path,
        values: read.values,
        unlowered: Vec::new(),
        excluded: Vec::new(),
    })
}

/// What locate reads of one option word: the occurrences it holds against the routed Command's
/// table and the earlier words' values, with no next word.
pub(crate) fn read_last_word<'g>(read: &WordsRead<'g>, word: &str) -> Vec<Occurrence<'g>> {
    read_option_word(&read.command.table, &read.values, word, &[]).occurrences
}
