//! Ports the parsing cases of `options.test.ts`, `counted-options.test.ts`,
//! `implied-values.test.ts`, `multiple.test.ts`, `optional-arguments.test.ts`, and
//! `option-aliases.test.ts`: each value form, short groups, polarity, short-only spellings, counts,
//! implied values, collected values, argument binding, and aliases, end to end through
//! `Application::run` on the mock process.
//!
//! The actions print what the words supplied (`ctx.supplied`); the values validation produces, an
//! omitted option's absent value, and a validator's output belong to a later stage.

mod support;

use loomcli_core::{
    Application, Arg, Command, Context, Done, NoInputs, NoResult, Opt, Outcome, Polarity,
};
use serde_json::{Value, json};
use support::{Ran, assert_matches, dispatched, record_json, report, run, usage};

type App = Application<NoInputs, NoResult, Done>;

/// Prints the arguments, the host's argv, the options, and the passthrough tail.
async fn report_argv(ctx: Context) -> Outcome {
    let line = json!({
        "args": record_json(&ctx.supplied.args),
        "argv": ctx.host.argv,
        "options": record_json(&ctx.supplied.options),
        "passthrough": ctx.passthrough,
    });
    ctx.out.print(&line.to_string()).await
}

fn options_app() -> App {
    Application::new("options")
        .argument("files", Arg::string().required().variadic())
        .option("metric", Opt::string().short('m'))
        .option("depth", Opt::string().short('d'))
        .option("pattern", Opt::string())
        .option("total", Opt::boolean().short('t'))
        .action(report_argv)
}

#[tokio::test]
async fn local_options_and_passthrough_stay_separate_from_positional_inputs_and_host_argv() {
    let argv = [
        "one.txt",
        "--metric=words",
        "--total",
        "two.txt",
        "--",
        "--metric",
        "two words",
    ];
    assert_eq!(
        run(&options_app(), &argv).await,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: format!(
                "{}\n",
                json!({
                    "args": { "files": ["one.txt", "two.txt"] },
                    "argv": argv,
                    "options": { "metric": "words", "total": true },
                    "passthrough": ["--metric", "two words"],
                })
            ),
        }
    );
}

#[tokio::test]
async fn binds_supported_option_forms() {
    let app = options_app();
    for (argv, options) in [
        (
            &["-tm", "words", "one.txt"][..],
            json!({ "metric": "words", "total": true }),
        ),
        (
            &["--metric", "words", "one.txt", "-t"],
            json!({ "metric": "words", "total": true }),
        ),
        (&["one.txt"], json!({})),
        (&["-m", "", "one.txt"], json!({ "metric": "" })),
        (&["--metric=", "one.txt"], json!({ "metric": "" })),
        (
            &["--metric=-value", "one.txt"],
            json!({ "metric": "-value" }),
        ),
        (&["-mwords", "one.txt"], json!({ "metric": "words" })),
        (&["-m=words", "one.txt"], json!({ "metric": "words" })),
        (
            &["-tmwords", "one.txt"],
            json!({ "metric": "words", "total": true }),
        ),
        (
            &["-tm=words", "one.txt"],
            json!({ "metric": "words", "total": true }),
        ),
        (&["-mt", "one.txt"], json!({ "metric": "t" })),
        (&["-m==x", "one.txt"], json!({ "metric": "=x" })),
        (&["-m=", "one.txt"], json!({ "metric": "" })),
        (&["-m-value", "one.txt"], json!({ "metric": "-value" })),
        (&["-m=-value", "one.txt"], json!({ "metric": "-value" })),
        (&["--metric", "-5", "one.txt"], json!({ "metric": "-5" })),
        (&["-m", "-", "one.txt"], json!({ "metric": "-" })),
    ] {
        assert_eq!(
            dispatched(&app, argv).await,
            json!({ "args": { "files": ["one.txt"] }, "argv": argv, "options": options, "passthrough": [] }),
            "{argv:?}"
        );
    }
}

fn polarity_app() -> App {
    Application::new("polarity")
        .option("total", Opt::boolean().polarity(Polarity::Both).short('t'))
        .option(
            "color",
            Opt::boolean().polarity(Polarity::Negative).short('c'),
        )
        .option(
            "silent",
            Opt::boolean()
                .polarity(Polarity::Negative)
                .short('s')
                .short_only(),
        )
        .option("metric", Opt::string().short('m').short_only())
        .action(report)
}

#[tokio::test]
async fn applies_polarity_and_short_only_options() {
    let app = polarity_app();
    for (argv, options) in [
        (&[][..], json!({})),
        (
            &["--total", "--no-color", "-s"],
            json!({ "color": false, "silent": false, "total": true }),
        ),
        (&["--no-total"], json!({ "total": false })),
        (
            &["-tcsm", "words"],
            json!({ "color": false, "metric": "words", "silent": false, "total": true }),
        ),
    ] {
        assert_matches(
            &dispatched(&app, argv).await,
            &json!({ "options": options, "passthrough": [] }),
        );
        assert_eq!(dispatched(&app, argv).await["options"], options, "{argv:?}");
    }
}

#[tokio::test]
async fn rejects_unavailable_or_repeated_polarity_forms() {
    let app = polarity_app();
    for (argv, reason) in [
        (&["--metric=words"][..], "Unknown option"),
        (&["--silent"], "Unknown option"),
        (&["--no-silent"], "Unknown option"),
        (&["--color"], "Unknown option"),
        (&["--total", "--no-total"], "only once"),
        (&["--no-total", "-t"], "only once"),
    ] {
        let ran = run(&app, argv).await;
        assert_eq!(ran.status, 2, "{argv:?}");
        assert_eq!(ran.stdout, "");
        assert!(ran.stderr.contains(reason), "{argv:?}: {}", ran.stderr);
    }
}

#[tokio::test]
async fn a_word_that_is_not_an_option_word_is_a_value_or_an_argument() {
    let app = options_app();
    assert_matches(
        &dispatched(&app, &["--depth", "-5", "-.5", "-5", "-", "-1e3"]).await,
        &json!({ "args": { "files": ["-.5", "-5", "-", "-1e3"] }, "options": { "depth": "-5" } }),
    );
    assert_matches(
        &dispatched(&app, &["-d", "-5", "one.txt"]).await,
        &json!({ "options": { "depth": "-5" } }),
    );
    assert_matches(
        &dispatched(&app, &["-td-.5", "one.txt"]).await,
        &json!({ "options": { "depth": "-.5", "total": true } }),
    );
}

#[tokio::test]
async fn a_value_option_before_an_option_word_or_delimiter_names_the_attached_form() {
    let app = options_app();
    for (argv, spelling) in [
        (&["--pattern", "-x", "one.txt"][..], "--pattern"),
        (&["--metric", "--total", "one.txt"], "--metric"),
        (&["-m", "-v", "one.txt"], "-m"),
        (&["-m", "--", "one.txt"], "-m"),
        (&["one.txt", "-tm", "--total"], "-m"),
    ] {
        assert_eq!(
            run(&app, argv).await,
            usage(&format!(
                "options: Option \"{spelling}\" requires a value. Supply a value after \"{spelling}\", or attach one that starts with a hyphen as \"{spelling}=<value>\"."
            )),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_short_group_fails_at_its_first_fault() {
    let app = options_app();
    for (argv, sentence) in [
        (&["-tx", "one.txt"][..], "Unknown option \"-x\""),
        (&["-t5", "one.txt"], "Unknown option \"-5\""),
        (&["-té", "one.txt"], "Unknown option \"-é\""),
        (
            &["-t=false", "one.txt"],
            "Boolean option \"-t\" does not accept a value",
        ),
        (
            &["-tt", "one.txt"],
            "Option \"-t\" can be supplied only once",
        ),
        (
            &["-tmx", "-tm", "y", "one.txt"],
            "Option \"-t\" can be supplied only once",
        ),
    ] {
        let ran = run(&app, argv).await;
        assert_eq!(ran.status, 2, "{argv:?}");
        assert_eq!(ran.stdout, "");
        assert!(
            ran.stderr.contains(&format!("options: {sentence}")),
            "{argv:?}: {}",
            ran.stderr
        );
    }
}

#[tokio::test]
async fn rejects_each_structural_fault_without_dispatch() {
    let app = options_app();
    for (argv, option, reason) in [
        (&["--metric"][..], "\"--metric\"", "requires a value"),
        (
            &["--metric", "words", "-m", "bytes", "one.txt"],
            "\"-m\"",
            "only once",
        ),
        (&["--total", "-t", "one.txt"], "\"-t\"", "only once"),
        (&["-tt", "one.txt"], "\"-t\"", "only once"),
        (
            &["--total=false", "one.txt"],
            "\"--total\"",
            "does not accept a value",
        ),
        (
            &["-t=false", "one.txt"],
            "\"-t\"",
            "does not accept a value",
        ),
        (&["--unknown", "one.txt"], "\"--unknown\"", "Unknown option"),
        (&["-tx", "one.txt"], "\"-x\"", "Unknown option"),
        (
            &["--no-total", "one.txt"],
            "\"--no-total\"",
            "Unknown option",
        ),
    ] {
        let ran = run(&app, argv).await;
        assert_eq!(ran.status, 2, "{argv:?}");
        assert_eq!(ran.stdout, "");
        assert!(ran.stderr.contains(option), "{argv:?}: {}", ran.stderr);
        assert!(ran.stderr.contains(reason), "{argv:?}: {}", ran.stderr);
    }
}

/// `counted-options.test.ts`' graph: a Boolean `-t`, a counted `-v` with the alias `chatty`, and
/// a string `-b` that implies `simple`, beside a variadic argument.
fn copyit() -> App {
    Application::new("copyit")
        .argument("files", Arg::string().variadic())
        .option("total", Opt::boolean().short('t'))
        .option("verbose", Opt::count().aliases(["chatty"]).short('v'))
        .option("backup", Opt::string().implied("simple").short('b'))
        .option("suffix", Opt::string().default("~").implied(".bak"))
        .option("tag", Opt::string().implied("all").multiple().short('g'))
        .action(report)
}

#[tokio::test]
async fn a_counted_option_counts_every_occurrence_across_its_spellings() {
    let app = copyit();
    for (argv, count) in [
        (&["-vvv"][..], json!(3)),
        (&["-v", "-v", "-v"], json!(3)),
        (&["--verbose", "-vv"], json!(3)),
        (&["-vv", "--verbose"], json!(3)),
        (&["--chatty", "-v", "--verbose"], json!(3)),
        (&["-tvv"], json!(2)),
        (&[], Value::Null),
    ] {
        assert_eq!(
            dispatched(&app, argv).await["options"]["verbose"],
            count,
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_counted_letter_continues_the_walk_and_a_following_plain_word_stays_positional() {
    let app = copyit();
    assert_matches(
        &dispatched(&app, &["-vtv"]).await,
        &json!({ "options": { "total": true, "verbose": 2 } }),
    );
    assert_eq!(
        dispatched(&app, &["-v", "3"]).await["args"],
        json!({ "files": ["3"] })
    );
}

#[tokio::test]
async fn a_counted_option_accepts_no_attached_value() {
    let app = copyit();
    for (argv, spelling) in [
        (&["--verbose=3"][..], "--verbose"),
        (&["-v=3"], "-v"),
        (&["--chatty=3"], "--chatty"),
        (&["-tv=3"], "-v"),
        (&["-vv=1"], "-v"),
    ] {
        assert_eq!(
            run(&app, argv).await,
            usage(&format!(
                "copyit: Counted option \"{spelling}\" does not accept a value. Repeat \"{spelling}\" to raise its count."
            )),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_character_after_a_counted_letter_is_read_as_a_letter() {
    let ran = run(&copyit(), &["-v3"]).await;
    assert!(
        ran.stderr.contains("copyit: Unknown option \"-3\"."),
        "{}",
        ran.stderr
    );
}

#[tokio::test]
async fn a_global_counted_option_adds_its_occurrences_before_and_after_the_command_name() {
    let app = Application::new("fetchit")
        .global_option("verbose", Opt::count().short('v'))
        .command(
            Command::new("get")
                .argument("path", Arg::string())
                .action(report),
        )
        .action(report);
    for (argv, count) in [
        (&["-v", "get", "a.b", "-vv"][..], json!(3)),
        (&["-vv", "get", "-v", "a.b"], json!(3)),
        (&["get", "a.b"], Value::Null),
        (&["-v"], json!(1)),
    ] {
        assert_eq!(
            dispatched(&app, argv).await["options"]["verbose"],
            count,
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_plugins_counted_option_and_one_a_hook_declares_count_as_any_counted_option_does() {
    let quiet = loomcli_core::Plugin::new("@fixture/quiet")
        .option("quiet", Opt::count().short('q'))
        .on_command_attach(|command| {
            if command.name() == Some("get") {
                command.option("depth", Opt::count().short('d'))?;
            }
            Ok(())
        });
    let app = Application::new("fetchit")
        .plugins([quiet])
        .global_option("verbose", Opt::count().short('v'))
        .command(
            Command::new("get")
                .argument("path", Arg::string())
                .action(support::values),
        )
        .action(support::values);
    assert_eq!(
        dispatched(&app, &["-qq", "get", "-dqd", "a.b"]).await["options"],
        json!({ "depth": 2, "quiet": 3, "verbose": 0 })
    );
}

#[tokio::test]
async fn a_parents_own_counted_option_rebinds_and_adds_to_the_routed_commands_count() {
    let app = Application::new("rebind")
        .option("count", Opt::count().short('c'))
        .command(
            Command::new("count")
                .argument("path", Arg::string())
                .option("count", Opt::count().short('c'))
                .action(report),
        )
        .action(report);
    assert_eq!(
        dispatched(&app, &["-c", "count", "a", "-c"]).await["options"]["count"],
        json!(2)
    );
    assert_eq!(
        dispatched(&app, &["-cc", "count", "a", "--count"]).await["options"]["count"],
        json!(3)
    );
}

#[tokio::test]
async fn an_implied_value_fills_a_bare_spelling_and_the_next_word_stays_positional() {
    let app = copyit();
    for (argv, backup, files) in [
        // The supplied record holds an omitted variadic argument as an empty list.
        (&["--backup"][..], json!("simple"), json!([])),
        (&["-b"], json!("simple"), json!([])),
        (&["--backup", "--total"], json!("simple"), json!([])),
        (&["--backup=numbered"], json!("numbered"), json!([])),
        (&["-bnumbered"], json!("numbered"), json!([])),
        (&["-b=numbered"], json!("numbered"), json!([])),
        (
            &["--backup", "numbered"],
            json!("simple"),
            json!(["numbered"]),
        ),
        (&["-b", "numbered"], json!("simple"), json!(["numbered"])),
        (&["a.txt"], Value::Null, json!(["a.txt"])),
        // A bare spelling at the end of the words supplies the implied value, never the
        // missing-value error.
        (&["a.txt", "-b"], json!("simple"), json!(["a.txt"])),
        (&["a.txt", "--backup"], json!("simple"), json!(["a.txt"])),
    ] {
        let received = dispatched(&app, argv).await;
        assert_eq!(received["options"]["backup"], backup, "{argv:?}");
        assert_eq!(received["args"]["files"], files, "{argv:?}");
    }
}

#[tokio::test]
async fn an_empty_attached_value_supplies_the_empty_string() {
    let app = copyit();
    assert_eq!(
        dispatched(&app, &["--suffix="]).await["options"]["suffix"],
        json!("")
    );
    assert_eq!(
        dispatched(&app, &["-b="]).await["options"]["backup"],
        json!("")
    );
}

#[tokio::test]
async fn in_a_short_group_the_implied_letter_takes_the_rest_of_the_word() {
    let app = copyit();
    assert_matches(
        &dispatched(&app, &["-tb"]).await,
        &json!({ "options": { "backup": "simple", "total": true } }),
    );
    assert_eq!(
        dispatched(&app, &["-bt"]).await["options"]["backup"],
        json!("t")
    );
    assert_eq!(
        dispatched(&app, &["--suffix"]).await["options"]["suffix"],
        json!(".bak")
    );
    assert_eq!(
        dispatched(&app, &["--suffix=.orig"]).await["options"]["suffix"],
        json!(".orig")
    );
}

#[tokio::test]
async fn a_multiple_option_collects_each_bare_occurrence_as_the_implied_value_in_its_place() {
    let app = copyit();
    assert_eq!(
        dispatched(&app, &["--tag", "-g=x", "-g"]).await["options"]["tag"],
        json!(["all", "x", "all"])
    );
    assert_eq!(
        dispatched(&app, &["-gy", "--tag=", "--tag"]).await["options"]["tag"],
        json!(["y", "", "all"])
    );
}

#[tokio::test]
async fn an_option_with_an_implied_value_occurs_once_whichever_spelling_supplied_it() {
    assert_eq!(
        run(&copyit(), &["--backup", "-b=numbered"]).await,
        usage("copyit: Option \"-b\" can be supplied only once. Remove the repeated option.")
    );
}

fn multiple_app() -> App {
    Application::new("multiple")
        .option("field", Opt::string().multiple().short('F'))
        .option("total", Opt::boolean().short('t'))
        .action(report)
}

#[tokio::test]
async fn a_multiple_option_collects_every_occurrence_across_its_spellings_in_supplied_order() {
    let app = multiple_app();
    assert_eq!(
        dispatched(&app, &["--field", "a", "-F", "b", "--field=c"]).await["options"],
        json!({ "field": ["a", "b", "c"] })
    );
    let tail = dispatched(&app, &["-tF", "b", "--", "tail"]).await;
    assert_eq!(tail["options"], json!({ "field": ["b"], "total": true }));
    assert_eq!(tail["passthrough"], json!(["tail"]));
}

#[tokio::test]
async fn a_multiple_global_is_collected_at_every_placement_whichever_layer_reads_it() {
    let show = Command::new("show")
        .option("local", Opt::boolean())
        .action(report);
    let app = Application::new("multiple")
        .global_option("field", Opt::string().multiple().short('F'))
        .command(show)
        .action(report);
    assert_eq!(
        run(&app, &["--field", "a", "show", "-F", "b", "--local", "--field=c"]).await,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: "{\"args\":{},\"command\":[\"show\"],\"options\":{\"field\":[\"a\",\"b\",\"c\"],\"local\":true},\"passthrough\":[]}\n".to_owned(),
        }
    );
    assert_eq!(
        run(&app, &["-F", "a", "--field", "b"]).await,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: "{\"args\":{},\"command\":[],\"options\":{\"field\":[\"a\",\"b\"]},\"passthrough\":[]}\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn an_argument_and_an_option_can_share_a_key_without_losing_either_value() {
    let app = Application::new("shared-input-key")
        .argument("files", Arg::string().required().variadic())
        .option("files", Opt::boolean())
        .action(report);
    assert_eq!(
        run(&app, &["one.txt", "--files"]).await,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: "{\"args\":{\"files\":[\"one.txt\"]},\"command\":[],\"options\":{\"files\":true},\"passthrough\":[]}\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn option_declarations_and_invocation_values_stay_isolated_across_branches_and_repeated_runs()
{
    let base = Application::new("state")
        .option(
            "enabled",
            Opt::boolean().polarity(Polarity::Negative).short('n'),
        )
        .option("__proto__", Opt::string())
        .option("dryRun", Opt::boolean());
    let left = base.clone().option("left", Opt::boolean().short('l'));
    let right = base.option("right", Opt::boolean().short('l'));
    let first = left.action(report);
    let second = right.action(report);
    let words = [
        "-nl",
        "--__proto__=safe",
        "--dryRun",
        "--",
        "--",
        "",
        "two words",
    ];
    let line = |options: &str, passthrough: &str| Ran {
        status: 0,
        stderr: String::new(),
        stdout: format!(
            "{{\"args\":{{}},\"command\":[],\"options\":{options},\"passthrough\":{passthrough}}}\n"
        ),
    };
    assert_eq!(
        run(&first, &words).await,
        line(
            "{\"__proto__\":\"safe\",\"dryRun\":true,\"enabled\":false,\"left\":true}",
            "[\"--\",\"\",\"two words\"]"
        )
    );
    assert_eq!(run(&first, &[]).await, line("{}", "[]"));
    assert_eq!(run(&second, &["-l"]).await, line("{\"right\":true}", "[]"));
}

#[tokio::test]
async fn a_multiple_string_alias_ends_its_short_group_taking_the_rest_of_the_word_as_its_value() {
    assert_eq!(
        dispatched(&multiple_app(), &["-Ft", "-F=b", "-tFc"]).await["options"],
        json!({ "field": ["t", "b", "c"], "total": true })
    );
}

#[tokio::test]
async fn arguments_bind_in_order_and_an_omitted_one_binds_nothing() {
    let optional = Application::new("optional")
        .argument("path", Arg::string())
        .action(report);
    assert_eq!(dispatched(&optional, &[]).await["args"], json!({}));
    assert_eq!(
        dispatched(&optional, &["one.txt"]).await["args"],
        json!({ "path": "one.txt" })
    );
    let pair = Application::new("optional")
        .argument("name", Arg::string().required())
        .argument("path", Arg::string())
        .action(report);
    assert_eq!(
        dispatched(&pair, &["one"]).await["args"],
        json!({ "name": "one" })
    );
    assert_eq!(
        dispatched(&pair, &["one", "two"]).await["args"],
        json!({ "name": "one", "path": "two" })
    );
    assert_eq!(
        run(&pair, &["one", "two", "three"]).await,
        usage("optional: The root Command accepts 2 arguments. Remove the extra values.")
    );
    let two = Application::new("optional")
        .argument("path", Arg::string())
        .argument("extra", Arg::string())
        .action(report);
    assert_eq!(dispatched(&two, &[]).await["args"], json!({}));
    assert_eq!(
        dispatched(&two, &["one"]).await["args"],
        json!({ "path": "one" })
    );
    assert_eq!(
        dispatched(&two, &["one", "two"]).await["args"],
        json!({ "path": "one", "extra": "two" })
    );
    let tail = Application::new("optional")
        .argument("files", Arg::string().variadic())
        .action(report);
    // The supplied record holds an omitted variadic argument as an empty list.
    assert_eq!(dispatched(&tail, &[]).await["args"], json!({ "files": [] }));
    assert_eq!(
        dispatched(&tail, &["one", "two"]).await["args"],
        json!({ "files": ["one", "two"] })
    );
}

/// `option-aliases.test.ts`' graph, with a plugin whose global option keeps an old spelling.
fn sizes() -> App {
    Application::new("sizes")
        .plugins([loomcli_core::Plugin::new("@fixture/trace")
            .option("trace", Opt::boolean().aliases(["debug"]))])
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
        .action(report)
}

#[tokio::test]
async fn an_alias_supplies_its_option_by_the_declared_name() {
    let app = sizes();
    // The supplied record holds the omitted multiple option as an empty list.
    for (argv, options) in [
        (
            &["--minimum", "5"][..],
            json!({ "min-bytes": "5", "field": [] }),
        ),
        (&["--minimum=5"], json!({ "min-bytes": "5", "field": [] })),
        (&["--min", "5"], json!({ "min-bytes": "5", "field": [] })),
        (&["--colour"], json!({ "color": true, "field": [] })),
        (&["--no-colour"], json!({ "color": false, "field": [] })),
        (&["--no-silent"], json!({ "quiet": false, "field": [] })),
        (
            &["--field", "a", "--column", "b", "--field=c"],
            json!({ "field": ["a", "b", "c"] }),
        ),
        (
            &["--input", "doc.json"],
            json!({ "file": "doc.json", "field": [] }),
        ),
        (&["--debug"], json!({ "trace": true, "field": [] })),
    ] {
        assert_eq!(dispatched(&app, argv).await["options"], options, "{argv:?}");
    }
}

#[tokio::test]
async fn an_alias_fails_as_its_own_spelling() {
    let app = sizes();
    for (argv, sentence) in [
        (
            &["--min-bytes", "1", "--minimum", "2"][..],
            "Option \"--minimum\" can be supplied only once.",
        ),
        (&["--minimum"], "Option \"--minimum\" requires a value."),
        (
            &["--colour=yes"],
            "Boolean option \"--colour\" does not accept a value.",
        ),
        (&["--silent"], "Unknown option \"--silent\"."),
    ] {
        let ran = run(&app, argv).await;
        assert_eq!(ran.status, 2, "{argv:?}");
        assert!(
            ran.stderr.contains(&format!("sizes: {sentence}")),
            "{argv:?}: {}",
            ran.stderr
        );
    }
}

// counted-options.test.ts and implied-values.test.ts: the configuration answer through a
// plugin's source.

/// The fixture source's binding: the key an option reads in the settings the source holds.
const SETTING_KEY: loomcli_core::Extension<loomcli_core::OptionTarget, String> =
    loomcli_core::Extension::new("@fixture/settings/key");

/// A configuration source that answers each requested option its settings hold, under its key,
/// labeled `<key> in settings`.
fn settings(held: Vec<(&'static str, loomcli_core::SourceValue)>) -> loomcli_core::Plugin {
    let held = std::sync::Arc::new(held);
    loomcli_core::Plugin::new("@fixture/settings")
        .extensions([loomcli_core::AnyExtension::from(SETTING_KEY)])
        .source(loomcli_core::ConfigurationSource::new(
            &SETTING_KEY,
            move |context: loomcli_core::SourceContext<loomcli_core::NoInputs>| {
                let held = std::sync::Arc::clone(&held);
                async move {
                    let mut answers = std::collections::BTreeMap::new();
                    for request in &context.requests {
                        let Ok(Some(key)) = loomcli_core::read_extension(request, &SETTING_KEY)
                        else {
                            continue;
                        };
                        if let Some((_, value)) = held.iter().find(|(known, _)| *known == key) {
                            answers.insert(
                                request.name().to_owned(),
                                loomcli_core::SourceAnswer::new(
                                    value.clone(),
                                    format!("{key} in settings"),
                                ),
                            );
                        }
                    }
                    Ok(answers)
                }
            },
        ))
}

/// `copyit` under the settings source: `verbose` and `backup` carry its binding, and `backup`
/// reads its validator's upper-case output.
fn configured_copyit(held: Vec<(&'static str, loomcli_core::SourceValue)>) -> App {
    Application::new("copyit")
        .plugins([settings(held)])
        .argument("files", Arg::string().variadic())
        .option(
            "verbose",
            Opt::count()
                .aliases(["chatty"])
                .short('v')
                .env(["VERBOSE"])
                .extend([SETTING_KEY.value("verbose".to_owned())]),
        )
        .option(
            "backup",
            Opt::string()
                .implied("simple")
                .short('b')
                .env(["BACKUP"])
                .extend([SETTING_KEY.value("backup".to_owned())])
                .validate(support::validators::OneOfUpper(
                    &["none", "simple", "numbered"],
                    "Use none, simple, or numbered.",
                )),
        )
        .action(support::values)
}

#[tokio::test]
async fn a_configuration_answer_of_a_whole_number_fills_the_count_when_nothing_else_supplied_it() {
    use loomcli_core::SourceValue;
    let three = || vec![("verbose", SourceValue::Number(3.0))];
    assert_eq!(
        dispatched(&configured_copyit(three()), &[]).await["options"]["verbose"],
        json!(3)
    );
    assert_eq!(
        dispatched(&configured_copyit(three()), &["-v"]).await["options"]["verbose"],
        json!(1)
    );
    assert_eq!(
        dispatched(
            &configured_copyit(vec![("verbose", SourceValue::Number(0.0))]),
            &[]
        )
        .await["options"]["verbose"],
        json!(0)
    );
}

#[tokio::test]
async fn a_configuration_answer_that_is_not_a_whole_number_of_0_or_more_is_the_source_fault() {
    use loomcli_core::SourceValue;
    for value in [
        SourceValue::String("3".to_owned()),
        SourceValue::Number(-1.0),
        SourceValue::Number(1.5),
        SourceValue::Bool(true),
    ] {
        let app = configured_copyit(vec![("verbose", value.clone())]);
        let ran = support::run_with(
            &app,
            support::fields(&[], &[]).release(loomcli_core::ReleaseFacts::new(
                loomcli_core::Build::Development,
            )),
        )
        .await;
        assert_eq!(ran.status, 1, "{value:?}");
        assert!(
            ran.stderr.contains(
                "Plugin \"@fixture/settings\" answered option \"verbose\" with a value that is not a whole number of 0 or more."
            ),
            "{value:?}: {}",
            ran.stderr
        );
    }
}

#[tokio::test]
async fn an_input_source_supplies_explicit_values_alone_never_the_implied_value() {
    use loomcli_core::SourceValue;
    let backup = |held: Vec<(&'static str, SourceValue)>,
                  argv: &'static [&'static str],
                  env: &'static [(&'static str, &'static str)]| async move {
        let ran = support::run_with(&configured_copyit(held), support::fields(argv, env)).await;
        assert_eq!(
            (ran.status, ran.stderr.as_str()),
            (0, ""),
            "{argv:?} {env:?}"
        );
        serde_json::from_str::<Value>(ran.stdout.trim()).unwrap_or(Value::Null)["options"]["backup"]
            .clone()
    };
    assert_eq!(
        backup(vec![], &[], &[("BACKUP", "numbered")]).await,
        json!("NUMBERED")
    );
    assert_eq!(backup(vec![], &[], &[("BACKUP", "")]).await, Value::Null);
    assert_eq!(
        backup(
            vec![("backup", SourceValue::String("none".to_owned()))],
            &[],
            &[]
        )
        .await,
        json!("NONE")
    );
    assert_eq!(
        backup(vec![], &["-b"], &[("BACKUP", "numbered")]).await,
        json!("SIMPLE")
    );
}
