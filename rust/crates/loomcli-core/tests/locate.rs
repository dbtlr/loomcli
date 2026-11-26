//! Ports `locate.test.ts`, and the `locate` cases of `counted-options.test.ts`,
//! `implied-values.test.ts`, and `option-aliases.test.ts`: where the last word of an unfinished
//! invocation sits, read with the parser's own grammar.
//!
//! Each position is reduced as the reference's fixture reduces it: every node to its path or name,
//! and `own` saying whether each node is the inspected graph's own `Arc`.

mod support;

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Command, CommandGraph, Done, FailureFacts, NoInputs, NoResult, Opt, Polarity,
    WordPosition, locate,
};
use serde_json::{Map, Value, json};
use support::report;

type App = Application<NoInputs, NoResult, Done>;

/// Globals cover a string with a short spelling, a Boolean with both polarities, and a Boolean
/// short. The root takes an action and one local option, so a hyphen token can commit it. Its
/// children cover an alias, a hidden child, a group, local options, and a variadic argument.
fn kit() -> App {
    let keys = Command::new("keys")
        .alias("ls")
        .option("sort", Opt::boolean().short('s'))
        .option("depth", Opt::string().short('d'))
        .option("field", Opt::string().multiple().short('F'))
        .action(report);
    let paths = Command::new("paths")
        .option("format", Opt::string())
        .option("all", Opt::boolean().short('a'))
        .argument("root", Arg::string().required())
        .argument("rest", Arg::string().variadic())
        .action(report);
    let debug = Command::new("debug").hidden().action(report);
    // A parent with an action and children that declares the root's -a under its own name.
    let mid = Command::new("mid")
        .option("any", Opt::boolean().short('a'))
        .command(Command::new("leaf").action(report))
        .action(report);
    let cache = Command::new("cache")
        .command(Command::new("clear").action(report))
        .command(Command::new("list").alias("l").action(report));
    Application::new("kit")
        .global_option("file", Opt::string().short('f'))
        .global_option("color", Opt::boolean().polarity(Polarity::Both))
        .global_option("quiet", Opt::boolean().short('q'))
        .option("all", Opt::boolean().short('a'))
        .command(keys)
        .command(paths)
        .command(debug)
        .command(cache)
        .command(mid)
        .action(report)
}

/// How a reduced position keeps the Booleans the earlier words gave: only the `booleans` mode
/// keeps them, and every mode drops the counts.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Own,
    Booleans,
    Counts,
}

/// One position with every node reduced to its path or name.
fn reduce(graph: &CommandGraph, position: &WordPosition, mode: Mode) -> Value {
    let mut reduced = Map::new();
    let (kind, command) = match position {
        WordPosition::None => return json!({ "kind": "none" }),
        WordPosition::Command {
            command, prefix, ..
        } => {
            reduced.insert("prefix".into(), json!(prefix));
            ("command", command)
        }
        WordPosition::Option {
            command,
            prefix,
            supplied,
            counts,
            booleans,
        } => {
            reduced.insert("prefix".into(), json!(prefix));
            reduced.insert("supplied".into(), json!(supplied));
            if mode == Mode::Booleans {
                let booleans: Map<String, Value> = booleans
                    .iter()
                    .map(|(name, value)| (name.clone(), json!(value)))
                    .collect();
                reduced.insert("booleans".into(), Value::Object(booleans));
            }
            if mode == Mode::Counts {
                let counts: Map<String, Value> = counts
                    .iter()
                    .map(|(name, count)| (name.clone(), json!(count)))
                    .collect();
                reduced.insert("counts".into(), Value::Object(counts));
            }
            ("option", command)
        }
        WordPosition::Value {
            command,
            option,
            lead,
            prefix,
        } => {
            reduced.insert("lead".into(), json!(lead));
            reduced.insert("prefix".into(), json!(prefix));
            reduced.insert("option".into(), json!(option.name()));
            ("value", command)
        }
        WordPosition::Argument {
            command,
            argument,
            prefix,
        } => {
            reduced.insert("prefix".into(), json!(prefix));
            reduced.insert("argument".into(), json!(argument.name));
            ("argument", command)
        }
        WordPosition::Passthrough { command, prefix } => {
            reduced.insert("prefix".into(), json!(prefix));
            ("passthrough", command)
        }
        _ => return json!({ "kind": "unknown" }),
    };
    let path: Vec<&str> = command.path.iter().map(String::as_str).collect();
    let node = graph.command(&path);
    let mut own = node.is_some_and(|node| Arc::ptr_eq(node, command));
    if let (WordPosition::Value { option, .. }, Some(node)) = (position, node) {
        own &= graph
            .globals
            .iter()
            .chain(&node.options)
            .any(|known| Arc::ptr_eq(known, option));
    }
    if let (WordPosition::Argument { argument, .. }, Some(node)) = (position, node) {
        own &= node
            .arguments
            .iter()
            .any(|known| Arc::ptr_eq(known, argument));
    }
    reduced.insert("kind".into(), json!(kind));
    reduced.insert("command".into(), json!(command.path));
    reduced.insert("own".into(), json!(own));
    Value::Object(reduced)
}

/// Each word list's position, read against one graph.
fn locate_all_in(app: &App, cases: &[&[&str]], mode: Mode) -> Vec<Value> {
    let graph = app
        .inspect()
        .unwrap_or_else(|fault| panic!("{}", fault.message()));
    cases
        .iter()
        .map(|words| reduce(&graph, &locate(&graph, words), mode))
        .collect()
}

fn locate_all(cases: &[&[&str]]) -> Vec<Value> {
    locate_all_in(&kit(), cases, Mode::Own)
}

fn none() -> Value {
    json!({ "kind": "none" })
}

/// The value position of an option whose spelling ended the earlier words.
fn awaiting(command: &[&str], option: &str, prefix: &str) -> Value {
    json!({ "command": command, "kind": "value", "lead": "", "option": option, "own": true, "prefix": prefix })
}

fn option(command: &[&str], prefix: &str, supplied: &[&str]) -> Value {
    json!({ "command": command, "kind": "option", "own": true, "prefix": prefix, "supplied": supplied })
}

fn command(path: &[&str], prefix: &str) -> Value {
    json!({ "command": path, "kind": "command", "own": true, "prefix": prefix })
}

fn value(path: &[&str], lead: &str, option: &str, prefix: &str) -> Value {
    json!({ "command": path, "kind": "value", "lead": lead, "option": option, "own": true, "prefix": prefix })
}

#[test]
fn reads_the_contract_examples_reaching_a_command_through_its_alias() {
    assert_eq!(
        locate_all(&[&["k"], &["ls", "--"], &["paths", "--format=j"]]),
        vec![
            command(&[], "k"),
            option(&["keys"], "--", &[]),
            value(&["paths"], "--format=", "format", "j"),
        ]
    );
}

#[test]
fn an_option_position_holds_the_value_the_earlier_words_gave_each_boolean_option() {
    let booleans = |booleans: Value, command: &[&str], supplied: &[&str]| json!({ "booleans": booleans, "command": command, "kind": "option", "own": true, "prefix": "--", "supplied": supplied });
    assert_eq!(
        locate_all_in(
            &kit(),
            &[
                &["--no-color", "-q", "keys", "-s", "--"],
                &["keys", "--"],
                &["-a", "--"]
            ],
            Mode::Booleans
        ),
        vec![
            booleans(
                json!({ "color": false, "quiet": true, "sort": true }),
                &["keys"],
                &["color", "quiet", "sort"]
            ),
            booleans(json!({}), &["keys"], &[]),
            // Routing still holds the root's own -a unbound, which gives the root's entry true.
            booleans(json!({ "all": true }), &[], &["all"]),
        ]
    );
}

#[test]
fn reads_an_empty_list_as_one_empty_word_at_the_root() {
    assert_eq!(
        locate_all(&[&[], &[""]]),
        vec![command(&[], ""), command(&[], "")]
    );
}

#[test]
fn reads_delimiter_words_as_arguments_with_the_mode_off() {
    assert_eq!(
        locate_all(&[
            &["paths", "a", "--", "x"],
            &["--", "--"],
            &["--", "--file", ""],
            &["cache", "--", "-"],
        ]),
        vec![
            json!({ "argument": "rest", "command": ["paths"], "kind": "argument", "own": true, "prefix": "x" }),
            none(),
            none(),
            none(),
        ]
    );
}

#[test]
fn reads_the_word_after_a_string_option_that_waits_for_its_next_token_as_its_value() {
    assert_eq!(
        locate_all(&[
            &["--file", ""],
            &["keys", "-f", "da"],
            &["keys", "--depth", "2"],
            &["keys", "-d", ""],
            &["keys", "-sd", ""],
            &["-qf", "x"],
            &["keys", "-F", "a", "--field", "b"],
        ]),
        vec![
            awaiting(&[], "file", ""),
            awaiting(&["keys"], "file", "da"),
            awaiting(&["keys"], "depth", "2"),
            awaiting(&["keys"], "depth", ""),
            awaiting(&["keys"], "depth", ""),
            awaiting(&[], "file", "x"),
            awaiting(&["keys"], "field", "b"),
        ]
    );
}

#[test]
fn reads_an_option_word_or_delimiter_after_a_waiting_option_as_no_position() {
    assert_eq!(
        locate_all(&[
            &["--file", "--x"],
            &["keys", "-d", "-s"],
            &["--file", "--"],
            &["--file", "-"],
            &["keys", "-d", "-5"],
        ]),
        vec![
            none(),
            none(),
            none(),
            awaiting(&[], "file", "-"),
            awaiting(&["keys"], "depth", "-5"),
        ]
    );
}

#[test]
fn reads_a_short_group_whose_walk_reaches_a_value_letter_with_characters_after_it_as_that_value() {
    assert_eq!(
        locate_all(&[
            &["keys", "-sdfoo"],
            &["keys", "-sd=fo"],
            &["-qf=da"],
            &["-f=x"],
            &["ls", "-qsF", ""],
        ]),
        vec![
            value(&["keys"], "-sd", "depth", "foo"),
            value(&["keys"], "-sd=", "depth", "fo"),
            value(&[], "-qf=", "file", "da"),
            value(&[], "-f=", "file", "x"),
            awaiting(&["keys"], "field", ""),
        ]
    );
}

#[test]
fn reads_a_short_group_the_walk_cannot_read_as_no_position_and_any_other_as_an_option_spelling() {
    assert_eq!(
        locate_all(&[
            &["keys", "-sx"],
            &["keys", "-s=1"],
            &["-s"],
            &["keys", "-qs"],
            &["keys", "-sd"],
        ]),
        vec![
            none(),
            none(),
            none(),
            option(&["keys"], "-qs", &[]),
            option(&["keys"], "-sd", &[]),
        ]
    );
}

#[test]
fn reads_a_long_spelling_with_an_equals_sign_as_the_value_of_a_string_option_in_scope() {
    assert_eq!(
        locate_all(&[
            &["--file=da"],
            &["keys", "--file="],
            &["paths", "--format=a=b"]
        ]),
        vec![
            value(&[], "--file=", "file", "da"),
            value(&["keys"], "--file=", "file", ""),
            value(&["paths"], "--format=", "format", "a=b"),
        ]
    );
}

#[test]
fn reads_an_equals_sign_after_a_boolean_unknown_or_out_of_scope_spelling_as_no_position() {
    assert_eq!(
        locate_all(&[
            &["--color=x"],
            &["--no-color="],
            &["--nope=x"],
            &["--format=j"],
            &["keys", "--sort="],
            &["--="],
        ]),
        vec![none(); 6]
    );
}

#[test]
fn reads_any_other_hyphen_word_as_an_option_spelling_of_the_routed_command() {
    assert_eq!(
        locate_all(&[
            &["-"],
            &["--"],
            &["---"],
            &["keys", "-s"],
            &["--nop"],
            &["debug", "--"]
        ]),
        vec![
            option(&[], "-", &[]),
            option(&[], "--", &[]),
            option(&[], "---", &[]),
            option(&["keys"], "-s", &[]),
            option(&[], "--nop", &[]),
            option(&["debug"], "--", &[]),
        ]
    );
}

#[test]
fn reads_a_bare_word_as_a_child_name_until_routing_commits() {
    assert_eq!(
        locate_all(&[
            &["--file", "keys", "k"],
            &["-q", "c"],
            &["cache", "l"],
            &["--all", "k"],
            &["cache", "list", ""],
        ]),
        vec![
            command(&[], "k"),
            command(&[], "c"),
            command(&["cache"], "l"),
            command(&[], "k"),
            none(),
        ]
    );
}

#[test]
fn leaves_a_parents_own_option_unbound_while_routing_is_still_open() {
    assert_eq!(
        locate_all(&[
            &["-a", "cache", ""],
            &["-a", "cache", "l"],
            &["-a", ""],
            &["-a", "cache", "list", ""],
            &["-a", "cache", "-"],
            &["-a", "cache", "--h"],
            &["-a", "cache", "-qf=x"],
            &["-a", "-"],
        ]),
        vec![
            command(&["cache"], ""),
            command(&["cache"], "l"),
            command(&[], ""),
            none(),
            option(&["cache"], "-", &[]),
            option(&["cache"], "--h", &[]),
            value(&["cache"], "-qf=", "file", "x"),
            option(&[], "-", &["all"]),
        ]
    );
    // An unbound option of a parent lists the name the reached Command's own entry gives its
    // spelling.
    assert_eq!(
        locate_all(&[&["-qa", "mid", "-"], &["-a", "mid", ""]]),
        vec![
            option(&["mid"], "-", &["quiet", "any"]),
            command(&["mid"], ""),
        ]
    );
}

#[test]
fn reads_a_parents_own_option_and_carries_routing_on_to_the_child_that_receives_it() {
    assert_eq!(
        locate_all(&[
            &["--all", "paths", "--"],
            &["-a", "keys", ""],
            &["-aq", "paths", "-"]
        ]),
        vec![
            option(&["paths"], "--", &["all"]),
            none(),
            option(&["paths"], "-", &["all", "quiet"]),
        ]
    );
}

#[test]
fn reads_a_bare_word_on_a_leaf_as_the_argument_the_next_positional_fills() {
    let argument = |name: &str, prefix: &str| json!({ "argument": name, "command": ["paths"], "kind": "argument", "own": true, "prefix": prefix });
    assert_eq!(
        locate_all(&[
            &["paths", ""],
            &["paths", "a", ""],
            &["paths", "a", "b", "c"],
            &["paths", "--format", "json", "a", "b"],
            &["keys", ""],
        ]),
        vec![
            argument("root", ""),
            argument("rest", ""),
            argument("rest", "c"),
            argument("rest", "b"),
            none(),
        ]
    );
}

#[test]
fn reads_every_structural_fault_among_the_earlier_words_as_no_position() {
    assert_eq!(
        locate_all(&[
            &["nope", ""],
            &["keys", "--nope", ""],
            &["keys", "--depth", "1", "--depth", "2", ""],
            &["--file", "a", "keys", "-f", "b", ""],
            &["keys", "--depth", "-s", ""],
            &["keys", "--sort=x", ""],
            &["keys", "-sx", ""],
            &["-qs", "keys", ""],
            &["-s", "keys", ""],
            &["keys", "extra", ""],
            &["---", ""],
            &["-f", "x", "-f", ""],
            &["keys", "-d", "1", "-d", ""],
            &["keys", "-s", "-sd", ""],
        ]),
        vec![none(); 14]
    );
    // A multiple option repeats, so its next occurrence still waits for a value.
    assert_eq!(
        locate_all(&[&["keys", "-F", "a", "-F", ""]]),
        vec![awaiting(&["keys"], "field", "")]
    );
}

#[test]
fn reads_a_last_word_that_repeats_an_option_that_is_not_multiple_as_nothing_to_complete() {
    assert_eq!(
        locate_all(&[
            &["keys", "-d", "1", "--depth=x"],
            &["keys", "-d", "1", "-dx"],
            &["keys", "-ss"],
        ]),
        vec![none(); 3]
    );
    // A long spelling with no "=" may still grow into another spelling, so it stays an option.
    assert_eq!(
        locate_all(&[&["keys", "-s", "--sort"]]),
        vec![option(&["keys"], "--sort", &["sort"])]
    );
}

#[test]
fn lists_the_options_earlier_words_supplied_globals_and_locals_in_supplied_order() {
    assert_eq!(
        locate_all(&[
            &[
                "keys", "-s", "--file", "x", "-q", "-F", "a", "-F", "b", "--"
            ],
            &["--color", "ls", "--depth", "1", "-"],
            &["--no-color", "keys", "-sF", "a", "--"],
            &["-qf", "x", "paths", "--format=j", "-"],
            &["-aq", "--"],
        ]),
        vec![
            option(&["keys"], "--", &["sort", "file", "quiet", "field"]),
            option(&["keys"], "-", &["color", "depth"]),
            option(&["keys"], "--", &["color", "sort", "field"]),
            option(&["paths"], "-", &["quiet", "file", "format"]),
            option(&[], "--", &["all", "quiet"]),
        ]
    );
}

#[test]
fn answers_and_panics_for_no_hostile_word_list() {
    let hostile: [&[&str]; 8] = [
        &["--", "--"],
        &["-"],
        &["--="],
        &["---"],
        &[""],
        &[],
        &["-", ""],
        &["--=", "--="],
    ];
    assert_eq!(locate_all(&hostile).len(), hostile.len());
}

#[test]
fn reads_200000_words_without_exhausting_the_call_stack() {
    let graph = kit()
        .inspect()
        .unwrap_or_else(|fault| panic!("{}", fault.message()));
    let mut delimited = vec!["--"];
    delimited.extend(std::iter::repeat_n("x", 200_000));
    delimited.push("");
    let mut paths = vec!["paths"];
    paths.extend(std::iter::repeat_n("x", 200_000));
    paths.push("");
    let forwarding = Application::new("kit")
        .passthrough(loomcli_core::Passthrough::new())
        .action(report)
        .inspect()
        .unwrap_or_else(|fault| panic!("{}", fault.message()));
    assert_eq!(
        reduce(&forwarding, &locate(&forwarding, &delimited), Mode::Own),
        json!({ "command": [], "kind": "passthrough", "own": true, "prefix": "" })
    );
    assert_eq!(
        reduce(&graph, &locate(&graph, &paths), Mode::Own),
        json!({ "argument": "rest", "command": ["paths"], "kind": "argument", "own": true, "prefix": "" })
    );
}

#[test]
fn a_cloned_graph_shares_the_parsers_tables() {
    // The reference rejects a graph core did not produce; a Rust graph only `inspect()` builds,
    // and its clone locates as the original does.
    let graph = kit()
        .inspect()
        .unwrap_or_else(|fault| panic!("{}", fault.message()));
    let copy = graph.clone();
    assert_eq!(
        reduce(&copy, &locate(&copy, &["k"]), Mode::Own),
        command(&[], "k")
    );
}

/// `counted-options.test.ts`' graph: a counted `--verbose`, `-v` with the alias `chatty`, beside a
/// Boolean `-t` and a variadic argument.
fn copyit() -> App {
    Application::new("copyit")
        .argument("files", Arg::string().variadic())
        .option("total", Opt::boolean().short('t'))
        .option("verbose", Opt::count().aliases(["chatty"]).short('v'))
        .option("backup", Opt::string().implied("simple").short('b'))
        .action(report)
}

fn located(words: &[&str]) -> Value {
    locate_all_in(&copyit(), &[words], Mode::Counts).remove(0)
}

#[test]
fn locate_reads_a_counted_spelling_as_an_option_word_never_awaiting_a_value() {
    support::assert_matches(
        &located(&["-v", "--"]),
        &json!({ "kind": "option", "supplied": ["verbose"] }),
    );
    support::assert_matches(&located(&["-vv", ""]), &json!({ "kind": "argument" }));
    assert_eq!(located(&["--verbose="]), none());
    support::assert_matches(
        &located(&["-v", "-v", "-t"]),
        &json!({ "kind": "option", "prefix": "-t" }),
    );
}

#[test]
fn an_option_position_counts_each_counted_options_earlier_occurrences_across_every_spelling() {
    support::assert_matches(
        &located(&["-v", "-vv", "--chatty", "-t", "--"]),
        &json!({ "counts": { "verbose": 4 }, "kind": "option", "supplied": ["verbose", "total"] }),
    );
    support::assert_matches(
        &located(&["--"]),
        &json!({ "counts": {}, "kind": "option" }),
    );
}

#[test]
fn locate_reads_a_bare_implied_spelling_as_complete_and_an_attached_value_as_the_value_position() {
    support::assert_matches(
        &located(&["--backup", ""]),
        &json!({ "kind": "argument", "prefix": "" }),
    );
    support::assert_matches(
        &located(&["-b", "n"]),
        &json!({ "kind": "argument", "prefix": "n" }),
    );
    support::assert_matches(
        &located(&["--backup="]),
        &json!({ "kind": "value", "lead": "--backup=", "option": "backup", "prefix": "" }),
    );
    support::assert_matches(
        &located(&["--backup=n"]),
        &json!({ "kind": "value", "lead": "--backup=", "prefix": "n" }),
    );
    support::assert_matches(
        &located(&["-bn"]),
        &json!({ "kind": "value", "lead": "-b", "option": "backup" }),
    );
    support::assert_matches(
        &located(&["-tb="]),
        &json!({ "kind": "value", "lead": "-tb=", "prefix": "" }),
    );
    support::assert_matches(
        &located(&["-b"]),
        &json!({ "kind": "option", "prefix": "-b" }),
    );
    support::assert_matches(
        &located(&["-b", "-"]),
        &json!({ "kind": "option", "supplied": ["backup"] }),
    );
}

/// `option-aliases.test.ts`' graph: aliases on a global, a string, a Boolean of both polarities, a
/// negative Boolean, and a multiple option.
fn sizes() -> App {
    Application::new("sizes")
        .global_option("file", Opt::string().aliases(["input"]))
        .option("min-bytes", Opt::string().aliases(["minimum", "min"]))
        .option(
            "color",
            Opt::boolean().aliases(["colour"]).polarity(Polarity::Both),
        )
        .option(
            "quiet",
            Opt::boolean()
                .aliases(["silent"])
                .polarity(Polarity::Negative),
        )
        .option("field", Opt::string().aliases(["column"]).multiple())
        .command(Command::new("list").action(report))
        .action(report)
}

#[test]
fn locate_reads_through_an_alias() {
    let app = sizes();
    for (words, expected) in [
        (
            &["--minimum", ""][..],
            json!({ "kind": "value", "lead": "", "option": "min-bytes", "prefix": "" }),
        ),
        (
            &["--minimum=4"],
            json!({ "kind": "value", "lead": "--minimum=", "option": "min-bytes", "prefix": "4" }),
        ),
        (
            &["--input", "doc.json", "li"],
            json!({ "kind": "command", "prefix": "li" }),
        ),
    ] {
        support::assert_matches(
            &locate_all_in(&app, &[words], Mode::Own).remove(0),
            &expected,
        );
    }
}

/// `reported-spelling.test.ts`: each option named by the spelling a reported problem names it by.
#[test]
fn reported_spelling_names_each_option_by_the_spelling_a_problem_names_it_by() {
    let app = Application::new("reported")
        .global_option("file", Opt::string().short('f'))
        .option("quiet", Opt::boolean().polarity(Polarity::Negative))
        .option("color", Opt::boolean().polarity(Polarity::Both))
        .option("exact", Opt::string().short('x').short_only())
        .option(
            "keep",
            Opt::boolean()
                .polarity(Polarity::Negative)
                .short('k')
                .short_only(),
        )
        .option("min-bytes", Opt::string().aliases(["minimum", "min"]))
        .option("verbose", Opt::count().short('v'))
        .action(report);
    let graph = app
        .inspect()
        .unwrap_or_else(|fault| panic!("{}", fault.message()));
    let spellings: Map<String, Value> = graph
        .globals
        .iter()
        .chain(&graph.root.options)
        .map(|option| {
            (
                option.name().to_owned(),
                json!(loomcli_core::reported_spelling(option)),
            )
        })
        .collect();
    assert_eq!(
        Value::Object(spellings),
        json!({
            "color": "--color",
            "exact": "-x",
            "file": "--file",
            "keep": "-k",
            "min-bytes": "--min-bytes",
            "quiet": "--no-quiet",
            "verbose": "--verbose",
        })
    );
}
