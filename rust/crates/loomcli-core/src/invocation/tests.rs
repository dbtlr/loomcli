//! The facts a held parse fault carries, and the path routing reached, which the reference
//! reads through a failure view: `parse.test.ts`, `rebind-classes.test.ts`, `failures.test.ts`,
//! `hidden.test.ts`, `counted-options.test.ts`, and `implied-values.test.ts`. The bytes each fault
//! writes are asserted end to end in `tests/parse.rs` and `tests/routing.rs`.

use serde_json::{Map, Value, json};

use crate::{
    Application, Arg, Command, Context, Done, Error, FailureFacts, MisplacedOptionError,
    MissingValueError, NoInputs, NoResult, NonCallableCommandError, Opt, Outcome,
    RepeatedOptionError, UnexpectedArgumentError, UnexpectedValueError, UnknownCommandError,
    UnknownOptionError,
};

use super::parse::{candidates_of, parse_invocation};

type App = Application<NoInputs, NoResult, Done>;

async fn ok(_: Context) -> Outcome {
    Ok(())
}

/// The facts one failure carries, as the reference's fixtures serialize them: undefined fields
/// absent.
fn facts(path: &[String], error: &Error) -> Value {
    let Some(failure) = error.failure() else {
        return json!({ "foreign": error.foreign().map(ToString::to_string) });
    };
    let mut facts = Map::new();
    facts.insert("message".into(), json!(failure.message()));
    facts.insert("name".into(), json!(failure.class().name()));
    facts.insert("path".into(), json!(path));
    if let Some(misplaced) = failure.downcast_ref::<MisplacedOptionError>() {
        facts.insert("commands".into(), json!(misplaced.commands()));
        facts.insert("spelling".into(), json!(misplaced.spelling()));
    }
    if let Some(unknown) = failure.downcast_ref::<UnknownOptionError>() {
        facts.insert("spelling".into(), json!(unknown.spelling()));
    }
    if let Some(missing) = failure.downcast_ref::<MissingValueError>() {
        facts.insert("spelling".into(), json!(missing.spelling()));
    }
    if let Some(repeated) = failure.downcast_ref::<RepeatedOptionError>() {
        facts.insert("spelling".into(), json!(repeated.spelling()));
    }
    if let Some(unexpected) = failure.downcast_ref::<UnexpectedValueError>() {
        facts.insert("spelling".into(), json!(unexpected.spelling()));
        facts.insert("value".into(), json!(unexpected.value()));
    }
    if let Some(unknown) = failure.downcast_ref::<UnknownCommandError>() {
        facts.insert("token".into(), json!(unknown.token()));
        facts.insert("candidates".into(), json!(unknown.candidates()));
    }
    if let Some(group) = failure.downcast_ref::<NonCallableCommandError>() {
        facts.insert("command".into(), json!(group.command()));
        facts.insert("candidates".into(), json!(group.candidates()));
    }
    if let Some(extra) = failure.downcast_ref::<UnexpectedArgumentError>() {
        facts.insert("command".into(), json!(extra.command()));
        facts.insert("accepted".into(), json!(extra.accepted()));
        facts.insert("extra".into(), json!(extra.extra()));
    }
    Value::Object(facts)
}

/// The facts of the fault an invocation holds, with the path routing reached: an unknown
/// Command, else the first structural fault, else a group's missing
/// subcommand.
fn held(app: &App, argv: &[&str]) -> Value {
    let graph = app
        .inspect()
        .unwrap_or_else(|fault| panic!("{}", fault.message()));
    let argv: Vec<String> = argv.iter().map(|word| (*word).to_owned()).collect();
    match parse_invocation(&graph.link.grammar, &argv) {
        Err(failure) => facts(&failure.path, &failure.error()),
        Ok(parsed) => match parsed.fault {
            Some(fault) => facts(&parsed.path, &fault),
            None if parsed.command.action.is_none() => facts(
                &parsed.path,
                &NonCallableCommandError::new(parsed.path.clone(), candidates_of(parsed.command))
                    .into(),
            ),
            None => panic!("{argv:?} dispatched"),
        },
    }
}

/// Asserts that every key `expected` names holds the same value in `actual`.
#[track_caller]
fn assert_matches(actual: &Value, expected: &Value) {
    let (Value::Object(actual), Value::Object(expected)) = (actual, expected) else {
        panic!("{actual} is not {expected}");
    };
    for (key, value) in expected {
        assert_eq!(actual.get(key), Some(value), "{key} of {actual:?}");
    }
}

fn kit() -> App {
    Application::new("kit")
        .global_option("help", Opt::boolean().short('h'))
        .global_option("file", Opt::string().short('f'))
        .global_option("quiet", Opt::boolean().short('q'))
        .command(
            Command::new("get")
                .argument("path", Arg::string().required())
                .option("pretty", Opt::boolean().short('p'))
                .option("raw", Opt::boolean().short('r'))
                .option("depth", Opt::string().short('d'))
                .action(ok),
        )
        .command(
            Command::new("keys")
                .argument("path", Arg::string())
                .option("raw", Opt::boolean().short('r'))
                .action(ok),
        )
        .command(
            Command::new("cache")
                .command(
                    Command::new("clear")
                        .option("force", Opt::boolean())
                        .action(ok),
                )
                .command(Command::new("list").action(ok)),
        )
        .command(
            Command::new("debug")
                .hidden()
                .option("xray", Opt::boolean().short('x'))
                .action(ok),
        )
        .command(
            Command::new("fetch")
                .deprecated("Use get instead.")
                .option("yank", Opt::boolean().short('y'))
                .action(ok),
        )
        .command(
            Command::new("old")
                .deprecated("Use cache instead.")
                .command(
                    Command::new("sub")
                        .option("xenon", Opt::boolean().short('x'))
                        .action(ok),
                ),
        )
        .action(ok)
}

fn rooted() -> App {
    Application::new("rooted")
        .global_option("help", Opt::boolean().short('h'))
        .global_option("quiet", Opt::boolean().short('q'))
        .option("pretty", Opt::boolean().short('p'))
        .option("verbose", Opt::boolean())
        .option("name", Opt::string().short('n'))
        .option("level", Opt::boolean())
        .option("dry", Opt::string())
        .command(
            Command::new("get")
                .argument("path", Arg::string())
                .option("pretty", Opt::boolean().short('p'))
                .option("raw", Opt::boolean().short('r'))
                .option("numbered", Opt::boolean().short('n'))
                .option("level", Opt::string())
                .option("dry", Opt::boolean())
                .action(ok),
        )
        .command(
            Command::new("cache")
                .option("deep", Opt::boolean())
                .command(
                    Command::new("list")
                        .option("deep", Opt::boolean())
                        .option("plain", Opt::boolean().short('p'))
                        .action(ok),
                )
                .action(ok),
        )
        .action(ok)
}

const UNKNOWN: &str = "Supply a declared option; prefix a hyphenated path with \"./\".";

fn unknown(spelling: &str, path: &[&str]) -> Value {
    let correction = if path == ["get"] {
        "Supply a declared option, or pass it as an argument after \"--\"."
    } else {
        UNKNOWN
    };
    json!({
        "message": format!("Unknown option \"{spelling}\". {correction}"),
        "name": "UnknownOptionError",
        "path": path,
        "spelling": spelling,
    })
}

fn misplaced(spelling: &str, commands: Value, path: &[&str], message: &str) -> Value {
    json!({
        "commands": commands,
        "message": message,
        "name": "MisplacedOptionError",
        "path": path,
        "spelling": spelling,
    })
}

fn misplaced_on_get(spelling: &str) -> Value {
    misplaced(
        spelling,
        json!([["get"]]),
        &["get"],
        &format!("Option \"{spelling}\" belongs to command \"get\". Supply it after \"get\"."),
    )
}

#[test]
fn an_option_word_that_stops_routing_names_the_commands_below_that_declare_it() {
    let app = kit();
    assert_eq!(
        held(&app, &["-qp", "--file", "data.json", "get", "a.b"]),
        misplaced(
            "-p",
            json!([["get"]]),
            &[],
            "Option \"-p\" belongs to command \"get\". Supply it after \"get\"."
        )
    );
    assert_eq!(
        held(&app, &["-r", "get", "a.b"]),
        misplaced(
            "-r",
            json!([["get"], ["keys"]]),
            &[],
            "Option \"-r\" belongs to commands get, keys. Supply it after the command name."
        )
    );
    assert_eq!(
        held(&app, &["cache", "--force", "clear"]),
        misplaced(
            "--force",
            json!([["cache", "clear"]]),
            &["cache"],
            "Option \"--force\" belongs to command \"cache clear\". Supply it after \"cache clear\"."
        )
    );
}

#[test]
fn an_option_no_visible_command_below_declares_is_unknown_where_routing_stopped() {
    let app = kit();
    for (argv, spelling, path) in [
        (&["-x", "debug"][..], "-x", &[][..]),
        (&["-y", "fetch"], "-y", &[]),
        (&["-z", "get", "a.b"], "-z", &[]),
        (&["cache", "--verbose"], "--verbose", &["cache"]),
        (&["get", "a.b", "-pz"], "-z", &["get"]),
        (&["get", "a.b", "-pé"], "-é", &["get"]),
    ] {
        assert_eq!(held(&app, argv), unknown(spelling, path), "{argv:?}");
    }
}

#[test]
fn a_parents_own_option_faults_where_routing_reached() {
    let app = rooted();
    assert_eq!(
        held(&app, &["--verbose", "get", "a.b"]),
        unknown("--verbose", &["get"])
    );
    assert_matches(
        &held(&app, &["--verbose", "--quiet=1", "get", "a.b"]),
        &json!({ "spelling": "--verbose" }),
    );
    assert_eq!(
        held(&app, &["-n", "x", "get", "a.b"]),
        misplaced_on_get("-n")
    );
    assert_eq!(
        held(&app, &["--level=3", "get", "a.b"]),
        misplaced_on_get("--level")
    );
    assert_eq!(
        held(&app, &["--dry", "-q", "get", "a.b"]),
        misplaced_on_get("--dry")
    );
    assert_eq!(
        held(&app, &["--dry", "-q", "--quiet=1", "get", "a.b"]),
        misplaced_on_get("--dry")
    );
    assert_matches(
        &held(&app, &["--pretty=1", "get", "a.b"]),
        &json!({ "name": "UnexpectedValueError", "path": ["get"], "spelling": "--pretty" }),
    );
    assert_matches(
        &held(&app, &["--verbose=1", "get", "a.b"]),
        &json!({ "name": "UnknownOptionError", "spelling": "--verbose" }),
    );
    assert_eq!(
        held(&app, &["-p", "nope"]),
        json!({
            "candidates": ["get", "cache"],
            "message": "Unknown command \"nope\". Use one of: get, cache.",
            "name": "UnknownCommandError",
            "path": [],
            "token": "nope",
        })
    );
    assert_eq!(
        held(&app, &["-p", "-r", "get"]),
        misplaced(
            "-r",
            json!([["get"]]),
            &[],
            "Option \"-r\" belongs to command \"get\". Supply it after \"get\"."
        )
    );
}

#[test]
fn a_deprecated_group_hides_the_letters_below_it_until_routing_reaches_it() {
    let app = kit();
    assert_eq!(held(&app, &["-x", "old", "sub"]), unknown("-x", &[]));
    assert_eq!(
        held(&app, &["old", "-x", "sub"]),
        misplaced(
            "-x",
            json!([["old", "sub"]]),
            &["old"],
            "Option \"-x\" belongs to command \"old sub\". Supply it after \"old sub\"."
        )
    );
}

#[test]
fn held_faults_name_their_spelling_and_the_path_routing_reached() {
    let app = kit();
    let repeated = json!({
        "message": "Option \"-q\" can be supplied only once. Remove the repeated option.",
        "name": "RepeatedOptionError",
        "path": ["get"],
        "spelling": "-q",
    });
    assert_eq!(held(&app, &["-q", "-qp", "get", "a.b"]), repeated);
    assert_eq!(held(&app, &["-qqp", "get", "a.b"]), repeated);
    assert_matches(
        &held(&app, &["get", "a.b", "-p", "-ph"]),
        &json!({ "name": "RepeatedOptionError", "spelling": "-p" }),
    );
    assert_matches(&held(&app, &["nope", "--help"]), &json!({ "path": [] }));
    assert_matches(
        &held(&app, &["cache", "nope", "-h"]),
        &json!({ "path": ["cache"] }),
    );
    assert_matches(
        &held(&app, &["--file"]),
        &json!({ "name": "MissingValueError", "path": [], "spelling": "--file" }),
    );
    assert_matches(
        &held(&app, &["--file", "-q", "get", "a.b"]),
        &json!({ "name": "MissingValueError", "path": ["get"], "spelling": "--file" }),
    );
    assert_matches(
        &held(&app, &["get", "a.b", "-f", "--"]),
        &json!({ "spelling": "-f" }),
    );
    assert_matches(
        &held(&app, &["--quiet=1", "get", "a.b"]),
        &json!({ "name": "UnexpectedValueError", "path": ["get"], "spelling": "--quiet" }),
    );
    assert_matches(
        &held(
            &app,
            &["--file", "one.json", "get", "a.b", "-f", "two.json"],
        ),
        &json!({ "name": "RepeatedOptionError", "path": ["get"], "spelling": "-f" }),
    );
    assert_matches(
        &held(&app, &["--help=x"]),
        &json!({ "name": "UnexpectedValueError", "spelling": "--help" }),
    );
    assert_matches(
        &held(&app, &["-xh"]),
        &json!({ "name": "UnknownOptionError", "spelling": "-x" }),
    );
    assert_matches(
        &held(&app, &["get", "a.b", "-ph=1"]),
        &json!({ "name": "UnexpectedValueError", "spelling": "-h" }),
    );
    assert_matches(
        &held(&app, &["get", "a.b", "extra", "--nope"]),
        &json!({ "name": "UnexpectedArgumentError", "path": ["get"] }),
    );
    assert_matches(
        &held(&app, &["get", "a.b", "--nope", "extra"]),
        &json!({ "name": "UnknownOptionError", "spelling": "--nope" }),
    );
    assert_matches(
        &held(&app, &["cache"]),
        &json!({
            "message": "Command \"cache\" requires a subcommand. Use one of: clear, list.",
            "name": "NonCallableCommandError",
            "path": ["cache"],
        }),
    );
    assert_matches(
        &held(&app, &["cache", "--verbose"]),
        &json!({ "name": "UnknownOptionError" }),
    );
}

#[test]
fn a_parents_own_option_is_misplaced_before_a_child_of_another_value_class() {
    let classes = ["boolean", "count", "implied", "separate"];
    let declare = |kind: &str, name: &str, implied: &str| -> crate::OptionDecl {
        let short = name.chars().next().unwrap_or('x');
        match kind {
            "boolean" => Opt::boolean().short(short).into(),
            "count" => Opt::count().short(short).into(),
            "implied" => Opt::string().implied(implied).short(short).into(),
            _ => Opt::string().short(short).into(),
        }
    };
    let child = |kind: &str| {
        classes
            .iter()
            .fold(
                Command::new(kind).argument("path", Arg::string()),
                |child, name| child.option(name, declare(kind, name, "child")),
            )
            .action(ok)
    };
    let app = Application::new("rebind")
        .option("boolean", declare("boolean", "boolean", "parent"))
        .option("count", declare("count", "count", "parent"))
        .option("implied", declare("implied", "implied", "parent"))
        .option("separate", declare("separate", "separate", "parent"))
        .command(child("boolean"))
        .command(child("count"))
        .command(child("implied"))
        .command(child("separate"))
        .action(ok);
    for parent in classes {
        for kind in classes.into_iter().filter(|kind| *kind != parent) {
            let mut argv = vec![format!("--{parent}")];
            if parent == "separate" {
                argv.push("x".to_owned());
            }
            argv.extend([kind.to_owned(), "a".to_owned()]);
            let argv: Vec<&str> = argv.iter().map(String::as_str).collect();
            assert_eq!(
                held(&app, &argv),
                misplaced(
                    &format!("--{parent}"),
                    json!([[kind]]),
                    &[kind],
                    &format!(
                        "Option \"--{parent}\" belongs to command \"{kind}\". Supply it after \"{kind}\"."
                    )
                ),
                "{argv:?}"
            );
        }
    }
}

fn failures() -> App {
    Application::new("failures")
        .global_option("file", Opt::string().short('f'))
        .global_option("quiet", Opt::boolean().short('q'))
        .command(
            Command::new("get")
                .argument("path", Arg::string())
                .option("mode", Opt::string().short('m'))
                .action(ok),
        )
        .command(Command::new("cache").command(Command::new("keys").action(ok)))
        .action(ok)
}

#[test]
fn a_routing_or_token_fault_carries_the_facts_its_sentence_names() {
    let app = failures();
    assert_matches(
        &held(&app, &["-f", "x", "nope"]),
        &json!({ "candidates": ["get", "cache"], "name": "UnknownCommandError", "token": "nope" }),
    );
    assert_matches(
        &held(&app, &["-f", "x", "cache"]),
        &json!({ "candidates": ["keys"], "command": ["cache"], "name": "NonCallableCommandError" }),
    );
    assert_matches(
        &held(&app, &["-f", "x", "get", "a", "b"]),
        &json!({ "accepted": 1, "command": ["get"], "extra": ["b"], "name": "UnexpectedArgumentError" }),
    );
    assert_matches(
        &held(&app, &["-f", "x", "--quiet=1"]),
        &json!({ "name": "UnexpectedValueError", "spelling": "--quiet", "value": "1" }),
    );
    assert_matches(
        &held(&app, &["-qZ", "-f", "x"]),
        &json!({ "name": "UnknownOptionError", "spelling": "-Z" }),
    );
    assert_matches(
        &held(&app, &["-qmhunter2", "-f", "x"]),
        &json!({ "commands": [["get"]], "name": "MisplacedOptionError", "spelling": "-m" }),
    );
    // A failure keeps the raw token while its sentence escapes it.
    assert_matches(
        &held(&app, &["a\u{202e}b"]),
        &json!({
            "message": "Unknown command \"a\\u202eb\". Use one of: get, cache.",
            "token": "a\u{202e}b",
        }),
    );
    assert_matches(
        &held(&app, &["-q\u{202e}"]),
        &json!({ "spelling": "-\u{202e}" }),
    );
    assert_matches(
        &held(&app, &["get", "x", "--a\u{202e}"]),
        &json!({ "spelling": "--a\u{202e}" }),
    );
}

#[test]
fn a_routing_failure_offers_the_visible_current_children_alone() {
    let app = Application::new("hidden")
        .command(
            Command::new("cache")
                .command(Command::new("clear").action(ok))
                .command(Command::new("trace").hidden().action(ok))
                .command(
                    Command::new("purge")
                        .deprecated("Use clear instead.")
                        .action(ok),
                ),
        )
        .command(
            Command::new("legacy")
                .deprecated("Use cache instead.")
                .action(ok),
        )
        .command(
            Command::new("secrets")
                .command(Command::new("dump").hidden().action(ok))
                .command(
                    Command::new("leak")
                        .deprecated("Use dump instead.")
                        .action(ok),
                ),
        )
        .command(Command::new("debug").hidden().action(ok))
        .action(ok);
    assert_matches(
        &held(&app, &["nope"]),
        &json!({ "candidates": ["cache", "secrets"], "token": "nope" }),
    );
    assert_matches(
        &held(&app, &["cache"]),
        &json!({ "candidates": ["clear"], "command": ["cache"] }),
    );
    assert_matches(
        &held(&app, &["secrets"]),
        &json!({ "candidates": [], "command": ["secrets"] }),
    );
    assert_matches(
        &held(&app, &["secrets", "nope"]),
        &json!({ "candidates": [], "token": "nope" }),
    );
}

#[test]
fn a_counted_or_implied_fault_names_its_spelling() {
    let app = Application::new("copyit")
        .argument("files", Arg::string().variadic())
        .option("verbose", Opt::count().short('v'))
        .option("backup", Opt::string().implied("simple").short('b'))
        .action(ok);
    assert_matches(
        &held(&app, &["-vv=1"]),
        &json!({ "name": "UnexpectedValueError", "spelling": "-v" }),
    );
    assert_matches(
        &held(&app, &["--backup", "-b=numbered"]),
        &json!({ "name": "RepeatedOptionError", "spelling": "-b" }),
    );
}
