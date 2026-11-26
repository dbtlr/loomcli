//! An invocation by name read into what the parser produces for argv words: routing by path, then
//! each value lowered to the tokens a command line would give, once, with no argv text built.
//!
//! This is the reference's `lower.ts`. A value no token spells supplies nothing and is the input's
//! problem, with the sentence that says what the input takes. The first held fault is the first in
//! the order `options` keys, then `exclude` names, then `args` keys arrive; only an unknown Command
//! is raised at once.

use serde_json::Value;

use crate::failures::{Error, UnexpectedArgumentError, UnknownCommandError, UnknownOptionError};
use crate::inputs::table::{Form, Role};
use crate::inputs::{InputIdentity, InputKind, SuppliedValue};
use crate::support::js_number_text;

use super::messages;
use super::parse::{
    Entry, Grammar, GrammarCommand, ParsedInvocation, ScopeValues, Slot, Supplied, candidates_of,
};

/// What an invocation by name names: the path from the root, the values keyed by declared name in
/// the caller's key order, the options the call leaves out of its run, and the passthrough tail.
pub(crate) struct NamedCall<'c> {
    pub(crate) path: &'c [String],
    pub(crate) args: &'c serde_json::Map<String, Value>,
    pub(crate) options: &'c serde_json::Map<String, Value>,
    pub(crate) exclude: &'c [String],
    pub(crate) passthrough: &'c [String],
}

/// The token one value gives: a string as it is, a finite number as `String` writes it, or none.
fn token_of(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        // JSON numbers are doubles in the reference, so a whole number past 2^53 reads rounded.
        Value::Number(number) => number
            .as_f64()
            .filter(|float| float.is_finite())
            .map(js_number_text),
        _ => None,
    }
}

/// The tokens one value of a collecting input gives, one per element, or none when one cannot be.
fn tokens_of(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::Array(elements) => elements.iter().map(token_of).collect(),
        other => token_of(other).map(|token| vec![token]),
    }
}

/// What one value lowers to: the occurrences argv would give, or the issue that says what it takes.
enum Lowering<T> {
    Occurrences(T),
    Issue(String),
}

/// One occurrence a value lowers to: the entry it reads as, the value it supplies, and whether it
/// is a bare spelling's implied value.
struct Lowered<'g> {
    option: &'g Entry,
    value: Supplied,
    implied: bool,
}

/// The entries of one declared option in the routed Command's table, its alias spellings left
/// out, and the spelling a problem names it by: its long form, else its negative or short form.
fn forms_of<'g>(command: &'g GrammarCommand, name: &str) -> Option<(Vec<&'g Entry>, String)> {
    let forms: Vec<(&'g String, &'g Entry)> = command
        .table
        .iter()
        .filter(|(_, entry)| entry.name == name && !matches!(entry.role, Role::Alias { .. }))
        .map(|(spelling, entry)| (spelling, entry))
        .collect();
    let role = |wanted: Role| forms.iter().find(|(_, entry)| entry.role == wanted);
    let reported = role(Role::Long)
        .or_else(|| role(Role::Negative))
        .or_else(|| role(Role::Short))?
        .0
        .clone();
    Some((
        forms.into_iter().map(|(_, entry)| entry).collect(),
        reported,
    ))
}

/// One option's value lowered by the value class its table entries read words by.
fn option_occurrences<'g>(entries: &[&'g Entry], value: &Value) -> Lowering<Vec<Lowered<'g>>> {
    let Some(option) = entries.first().copied() else {
        return Lowering::Occurrences(Vec::new());
    };
    match &option.form {
        Form::Boolean { .. } => {
            // A Boolean lowers to the spelling that reads its value, or to absence where none does.
            let Value::Bool(flag) = value else {
                return Lowering::Issue(messages::TAKES_BOOLEAN.to_owned());
            };
            let reading = entries
                .iter()
                .find(|entry| entry.form == Form::Boolean { value: *flag });
            Lowering::Occurrences(
                reading
                    .map(|entry| Lowered {
                        option: entry,
                        value: Supplied::Flag(*flag),
                        implied: false,
                    })
                    .into_iter()
                    .collect(),
            )
        }
        Form::Count => {
            // A whole number of 0 or more is that many occurrences, so 0 is absence.
            let count = match value {
                Value::Number(number) => number
                    .as_f64()
                    .filter(|float| float.is_finite() && float.fract() == 0.0 && *float >= 0.0)
                    // A count beyond the largest the run holds reads as that largest count.
                    .map(|float| {
                        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                        let count = float.min(f64::from(u32::MAX)) as u32;
                        count
                    }),
                _ => None,
            };
            let Some(count) = count else {
                return Lowering::Issue(messages::TAKES_COUNT.to_owned());
            };
            Lowering::Occurrences(if count > 0 {
                vec![Lowered {
                    option,
                    value: Supplied::Count(count),
                    implied: false,
                }]
            } else {
                Vec::new()
            })
        }
        Form::Arity { words, multiple } => arity_occurrences(option, value, *words, *multiple),
        Form::Separate { multiple } | Form::Implied { multiple, .. } => {
            let implied = match &option.form {
                Form::Implied { implied, .. } => Some(implied),
                _ => None,
            };
            if let (Value::Bool(true), Some(implied)) = (value, implied) {
                return Lowering::Occurrences(vec![Lowered {
                    option,
                    value: Supplied::Text(implied.clone()),
                    implied: true,
                }]);
            }
            let tokens = if *multiple {
                tokens_of(value)
            } else {
                token_of(value).map(|token| vec![token])
            };
            match tokens {
                Some(tokens) => Lowering::Occurrences(
                    tokens
                        .into_iter()
                        .map(|token| Lowered {
                            option,
                            value: Supplied::Text(token),
                            implied: false,
                        })
                        .collect(),
                ),
                None => Lowering::Issue(
                    match (multiple, implied.is_some()) {
                        (true, true) => messages::TAKES_LIST_OR_IMPLIED,
                        (true, false) => messages::TAKES_LIST,
                        (false, true) => messages::TAKES_IMPLIED,
                        (false, false) => messages::TAKES_SCALAR,
                    }
                    .to_owned(),
                ),
            }
        }
    }
}

fn arity_occurrences<'g>(
    option: &'g Entry,
    value: &Value,
    arity: usize,
    multiple: bool,
) -> Lowering<Vec<Lowered<'g>>> {
    let tuple = |value: &Value| {
        let elements = value.as_array().filter(|items| items.len() == arity)?;
        elements.iter().map(token_of).collect::<Option<Vec<_>>>()
    };
    let groups = tuple(value).map(|words| vec![words]).or_else(|| {
        if multiple {
            value.as_array()?.iter().map(tuple).collect()
        } else {
            None
        }
    });
    match groups {
        Some(groups) => Lowering::Occurrences(
            groups
                .into_iter()
                .map(|words| Lowered {
                    option,
                    value: Supplied::Tuple(words),
                    implied: false,
                })
                .collect(),
        ),
        None => Lowering::Issue(messages::takes_arity(arity, multiple)),
    }
}

/// One argument's value bound to its slot: one token, or one per element on a variadic.
fn argument_tokens(slot: &Slot, value: &Value) -> Lowering<SuppliedValue> {
    if slot.variadic {
        tokens_of(value).map_or(Lowering::Issue(messages::TAKES_LIST.to_owned()), |tokens| {
            Lowering::Occurrences(SuppliedValue::Many(tokens))
        })
    } else {
        token_of(value).map_or(
            Lowering::Issue(messages::TAKES_SCALAR.to_owned()),
            |token| Lowering::Occurrences(SuppliedValue::One(token)),
        )
    }
}

/// Routing by name: each element reads as a plain word reads during routing, a canonical name or
/// an alias descending and a hidden Command routing. An element no child holds is the unknown
/// Command, and so is one after a Command with no children, which offers no candidates.
fn route_by_name<'g>(
    grammar: &'g Grammar,
    path: &[String],
) -> Result<(&'g GrammarCommand, Vec<String>), Error> {
    let mut command: &'g GrammarCommand = &grammar.root;
    let mut routed = Vec::new();
    for name in path {
        let Some((canonical, child)) = command.route(name) else {
            let candidates = if command.children.is_empty() {
                Vec::new()
            } else {
                candidates_of(command)
            };
            return Err(UnknownCommandError::new(name.clone(), candidates).into());
        };
        routed.push(canonical.clone());
        command = child.as_ref();
    }
    Ok((command, routed))
}

/// An invocation by name read into the result the parser produces for argv words. Only an
/// unknown Command is an `Err`; every other fault is held in the result.
pub(crate) fn lower_invocation<'g>(
    grammar: &'g Grammar,
    call: &NamedCall<'_>,
) -> Result<ParsedInvocation<'g>, Error> {
    let (command, path) = route_by_name(grammar, call.path)?;
    let mut fault: Option<Error> = None;
    let mut values = ScopeValues::default();
    let mut unlowered: Vec<(InputIdentity, String)> = Vec::new();
    let mut args: Vec<(String, SuppliedValue)> = Vec::new();
    // Each `options` key against the routed Command's table by declared name.
    for (name, value) in call.options {
        let forms = forms_of(command, name);
        let Some((entries, reported)) = forms.filter(|_| !call.exclude.contains(name)) else {
            fault.get_or_insert_with(|| UnknownOptionError::by_name(name.clone()).into());
            continue;
        };
        match option_occurrences(&entries, value) {
            Lowering::Occurrences(occurrences) => {
                for occurrence in occurrences {
                    let scope = if occurrence.option.global {
                        &mut values.globals
                    } else {
                        &mut values.locals
                    };
                    scope.supply(
                        occurrence.option,
                        &reported,
                        &occurrence.value,
                        occurrence.implied,
                    );
                }
            }
            Lowering::Issue(issue) => {
                if let Some(entry) = entries.first() {
                    unlowered.push((
                        InputIdentity {
                            global: entry.global,
                            kind: InputKind::Option,
                            name: name.clone(),
                        },
                        issue,
                    ));
                }
            }
        }
    }
    // Each `exclude` name the routed Command's table does not hold is the unknown option.
    for name in call.exclude {
        if forms_of(command, name).is_none() {
            fault.get_or_insert_with(|| UnknownOptionError::by_name(name.clone()).into());
        }
    }
    // Each `args` key bound to the slot its name declares, so no value shifts into another slot.
    for (name, value) in call.args {
        let Some(slot) = command.arguments.iter().find(|slot| slot.name == *name) else {
            fault.get_or_insert_with(|| {
                UnexpectedArgumentError::undeclared(path.clone(), command.arguments.len(), name)
                    .into()
            });
            continue;
        };
        match argument_tokens(slot, value) {
            Lowering::Occurrences(SuppliedValue::Many(tokens)) if tokens.is_empty() => {}
            Lowering::Occurrences(tokens) => args.push((name.clone(), tokens)),
            Lowering::Issue(issue) => unlowered.push((
                InputIdentity {
                    global: false,
                    kind: InputKind::Argument,
                    name: name.clone(),
                },
                issue,
            )),
        }
    }
    let passthrough = if command.node.passthrough.is_some() {
        call.passthrough.to_vec()
    } else {
        if !call.passthrough.is_empty() && fault.is_none() {
            fault = Some(
                UnexpectedArgumentError::declared_no_passthrough(
                    path.clone(),
                    command.arguments.len(),
                    call.passthrough.to_vec(),
                )
                .into(),
            );
        }
        Vec::new()
    };
    Ok(ParsedInvocation {
        args,
        command,
        escapable: None,
        fault,
        // A value no token spells is an input problem, never a faulted occurrence.
        faulted: Vec::new(),
        global_fault: false,
        passthrough,
        path,
        values,
        unlowered,
        excluded: call.exclude.to_vec(),
    })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    //! The lowering part of `invoke-exclude.test.ts` and of the lowering table `invoke` uses:
    //! each value read into the tokens argv would give, the issue a value no token spells reports,
    //! and the order of the held faults. The runs that dispatch them belong to `invoke`.

    use serde_json::{Map, Value, json};

    use super::{NamedCall, lower_invocation};
    use crate::failures::FailureFacts;
    use crate::inputs::SuppliedValue;
    use crate::{
        Application, Arg, Command, Context, Done, NoInputs, NoResult, Opt, Outcome, Polarity,
    };

    async fn ok(_: Context) -> Outcome {
        Ok(())
    }

    fn application() -> Application<NoInputs, NoResult, Done> {
        let show = Command::new("show")
            .alias("s")
            .argument("name", Arg::string())
            .argument("files", Arg::string().variadic())
            .option("mode", Opt::string().default("default-mode"))
            .option("flag", Opt::boolean())
            .option("color", Opt::boolean().polarity(Polarity::Both))
            .option("quiet", Opt::boolean().polarity(Polarity::Negative))
            .option("level", Opt::count().short('l'))
            .option("tag", Opt::string().multiple())
            .option("backup", Opt::string().implied("simple"))
            .option("label", Opt::string().implied("all").multiple())
            .action(ok);
        Application::new("app")
            .global_option("zone", Opt::string())
            .command(show)
            .action(ok)
    }

    /// What one call lowered to: the values each scope holds, the bound arguments, the unlowered
    /// inputs with their issues, and the held fault's message.
    fn lowered(path: &[&str], args: Value, options: Value, exclude: &[&str]) -> Value {
        let graph = application().inspect().expect("the graph builds");
        let path: Vec<String> = path.iter().map(|word| (*word).to_owned()).collect();
        let exclude: Vec<String> = exclude.iter().map(|word| (*word).to_owned()).collect();
        let empty = Map::new();
        let args = args.as_object().unwrap_or(&empty);
        let options = options.as_object().unwrap_or(&empty);
        let call = NamedCall {
            path: &path,
            args,
            options,
            exclude: &exclude,
            passthrough: &[],
        };
        match lower_invocation(&graph.link.grammar, &call) {
            Err(error) => {
                json!({ "raised": error.failure().map(|failure| failure.message().to_owned()) })
            }
            Ok(parsed) => {
                let scope = |values: &crate::invocation::parse::OptionValues| {
                    json!({
                        "strings": values.strings,
                        "lists": values.lists,
                        "booleans": values.booleans,
                        "counts": values.counts,
                        "implied": values.implied,
                    })
                };
                json!({
                    "path": parsed.path,
                    "globals": scope(&parsed.values.globals),
                    "locals": scope(&parsed.values.locals),
                    "args": parsed.args.iter().map(|(name, value)| {
                        let value = match value {
                            SuppliedValue::One(one) => json!(one),
                            SuppliedValue::Many(many) => json!(many),
                            _ => Value::Null,
                        };
                        (name.clone(), value)
                    }).collect::<Map<String, Value>>(),
                    "unlowered": parsed.unlowered.iter().map(|(identity, issue)| {
                        json!([identity.name, issue])
                    }).collect::<Vec<_>>(),
                    "fault": parsed.fault.as_ref().and_then(|fault| fault.failure().map(|failure| failure.message().to_owned())),
                    "excluded": parsed.excluded,
                })
            }
        }
    }

    #[test]
    fn a_number_lowers_to_the_token_javascripts_string_writes() {
        let read = lowered(
            &["show"],
            json!({}),
            json!({ "mode": 5, "tag": [0.5, 1e21, -0.0, 1e-7] }),
            &[],
        );
        assert_eq!(read["locals"]["strings"], json!([["mode", "5"]]));
        assert_eq!(
            read["locals"]["lists"],
            json!([["tag", ["0.5", "1e+21", "0", "1e-7"]]])
        );
    }

    #[test]
    fn a_boolean_lowers_to_the_spelling_that_reads_its_value_or_to_absence() {
        let read = lowered(
            &["show"],
            json!({}),
            json!({ "flag": false, "color": false, "quiet": true }),
            &[],
        );
        // A positive option has no spelling for false, and a negative one none for true.
        assert_eq!(read["locals"]["booleans"], json!([["color", false]]));
        let read = lowered(
            &["show"],
            json!({}),
            json!({ "flag": true, "quiet": false }),
            &[],
        );
        assert_eq!(
            read["locals"]["booleans"],
            json!([["flag", true], ["quiet", false]])
        );
    }

    #[test]
    fn a_whole_number_is_that_many_occurrences_of_a_counted_option() {
        assert_eq!(
            lowered(&["show"], json!({}), json!({ "level": 3 }), &[])["locals"]["counts"],
            json!([["level", 3]])
        );
        assert_eq!(
            lowered(&["show"], json!({}), json!({ "level": 0 }), &[])["locals"]["counts"],
            json!([])
        );
        for value in [json!(-1), json!(1.5), json!("3"), json!(true)] {
            assert_eq!(
                lowered(&["show"], json!({}), json!({ "level": value }), &[])["unlowered"],
                json!([["level", "Use a whole number of 0 or more."]]),
                "{value}"
            );
        }
    }

    #[test]
    fn true_on_an_option_with_an_implied_value_is_its_bare_spelling() {
        let read = lowered(
            &["show"],
            json!({}),
            json!({ "backup": true, "label": true }),
            &[],
        );
        assert_eq!(read["locals"]["strings"], json!([["backup", "simple"]]));
        assert_eq!(read["locals"]["lists"], json!([["label", ["all"]]]));
        assert_eq!(
            read["locals"]["implied"],
            json!([["backup", [0]], ["label", [0]]])
        );
    }

    #[test]
    fn a_value_no_token_spells_supplies_nothing_and_names_what_the_input_takes() {
        let read = lowered(
            &["show"],
            json!({ "name": true, "files": [["nested"]] }),
            json!({
                "mode": null,
                "tag": { "object": 1 },
                "backup": false,
                "label": [true],
                "flag": "yes",
                "zone": ["a"],
            }),
            &[],
        );
        assert_eq!(
            read["unlowered"],
            json!([
                ["mode", "Use a string or a number."],
                ["tag", "Use a string, a number, or a list of them."],
                ["backup", "Use a string, a number, or true."],
                [
                    "label",
                    "Use a string, a number, true, or a list of strings and numbers."
                ],
                ["flag", "Use true or false."],
                ["zone", "Use a string or a number."],
                ["name", "Use a string or a number."],
                ["files", "Use a string, a number, or a list of them."],
            ])
        );
        assert_eq!(read["fault"], Value::Null);
    }

    #[test]
    fn each_argument_binds_its_own_slot_and_an_empty_list_binds_nothing() {
        let read = lowered(
            &["s"],
            json!({ "files": ["a", 2], "name": "n" }),
            json!({}),
            &[],
        );
        assert_eq!(read["path"], json!(["show"]));
        assert_eq!(read["args"], json!({ "files": ["a", "2"], "name": "n" }));
        let read = lowered(&["show"], json!({ "files": [] }), json!({}), &[]);
        assert_eq!(read["args"], json!({}));
    }

    #[test]
    fn a_global_option_lowers_into_the_globals() {
        let read = lowered(&["show"], json!({}), json!({ "zone": "eu" }), &[]);
        assert_eq!(read["globals"]["strings"], json!([["zone", "eu"]]));
    }

    #[test]
    fn an_excluded_or_unknown_name_is_the_unknown_option_and_the_first_held_fault_wins() {
        let unknown = "Unknown option \"nope\". Supply the name of a declared option.";
        assert_eq!(
            lowered(&["show"], json!({}), json!({ "nope": 1 }), &[])["fault"],
            json!(unknown)
        );
        assert_eq!(
            lowered(&["show"], json!({}), json!({ "mode": "x" }), &["mode"])["fault"],
            json!("Unknown option \"mode\". Supply the name of a declared option.")
        );
        assert_eq!(
            lowered(&["show"], json!({}), json!({}), &["nope"])["fault"],
            json!(unknown)
        );
        // Options keys first, then exclude names, then args keys.
        assert_eq!(
            lowered(
                &["show"],
                json!({ "extra": "x" }),
                json!({ "first": 1 }),
                &["second"]
            )["fault"],
            json!("Unknown option \"first\". Supply the name of a declared option.")
        );
        assert_eq!(
            lowered(&["show"], json!({ "extra": "x" }), json!({}), &["second"])["fault"],
            json!("Unknown option \"second\". Supply the name of a declared option.")
        );
        assert_eq!(
            lowered(&["show"], json!({ "extra": "x" }), json!({}), &[])["fault"],
            json!(
                "Command \"show\" declares no argument \"extra\". Supply the name of a declared argument."
            )
        );
        // An excluded option the table holds is out of the call's scope, and no fault.
        let read = lowered(&["show"], json!({}), json!({}), &["mode"]);
        assert_eq!(read["fault"], Value::Null);
        assert_eq!(read["excluded"], json!(["mode"]));
    }

    #[test]
    fn an_unknown_command_is_raised_at_once() {
        assert_eq!(
            lowered(&["nope"], json!({}), json!({}), &[])["raised"],
            json!("Unknown command \"nope\". Use one of: show.")
        );
        assert_eq!(
            lowered(&["show", "deeper"], json!({}), json!({}), &[])["raised"],
            json!("Unknown command \"deeper\". Supply the name of a declared command.")
        );
    }
}
