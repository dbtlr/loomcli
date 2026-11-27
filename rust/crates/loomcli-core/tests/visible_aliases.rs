//! Visible alias routing, parsing, inspection, and declaration faults from visible-aliases.test.ts.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use loomcli_core::{
    Application, Command, Context, Done, Inputs, NoInputs, NoResult, Opt, OptionSet, Outcome,
    Plugin, Polarity, StringOpt, WordPosition, locate,
};
use serde_json::json;
use support::faults::{panic_message, panic_rule};
use support::validators::Digits;
use support::{Ran, dispatched, report, run, usage, values};

#[tokio::test]
async fn visible_and_unadvertised_aliases_route_to_the_canonical_path() {
    let app = Application::new("store").command(
        Command::new("cache").command(
            Command::new("list")
                .alias("dir")
                .visible_alias("ls")
                .action(report),
        ),
    );
    for word in ["ls", "dir", "list"] {
        assert_eq!(
            dispatched(&app, &["cache", word]).await["command"],
            json!(["cache", "list"])
        );
    }
}

#[tokio::test]
async fn unknown_command_candidates_use_canonical_names() {
    let app = Application::new("store").command(
        Command::new("cache")
            .command(Command::new("clear").action(|_| async { Ok(()) }))
            .command(
                Command::new("list")
                    .visible_alias("ls")
                    .action(|_| async { Ok(()) }),
            ),
    );
    assert_eq!(
        run(&app, &["cache", "nope"]).await,
        usage("store: Unknown command \"nope\". Use one of: clear, list.")
    );
}

#[test]
fn inspection_keeps_all_command_aliases_and_the_visible_subset() {
    let graph = Application::new("store")
        .command(
            Command::new("cache").command(
                Command::new("list")
                    .alias("dir")
                    .visible_alias("ls")
                    .action(|_| async { Ok(()) }),
            ),
        )
        .inspect()
        .unwrap();
    for path in [&[][..], &["cache"][..]] {
        let node = graph.command(path).unwrap();
        assert!(node.aliases.is_empty());
        assert!(node.visible_aliases.is_empty());
    }
    let list = graph.command(&["cache", "list"]).unwrap();
    assert_eq!(list.aliases, ["dir", "ls"]);
    assert_eq!(list.visible_aliases, ["ls"]);
}

#[test]
fn a_command_alias_keeps_its_first_position_and_explicit_visibility() {
    let cases = [
        (
            Command::new("list")
                .visible_alias("ls")
                .visible_alias("list")
                .visible_alias("ls"),
            &["ls"][..],
            &["ls"][..],
        ),
        (
            Command::new("list")
                .alias("ls")
                .alias("dir")
                .visible_alias("ls"),
            &["ls", "dir"],
            &["ls"],
        ),
        (
            Command::new("list")
                .visible_alias("dir")
                .alias("ls")
                .alias("dir"),
            &["dir", "ls"],
            &["dir"],
        ),
        (
            Command::new("list")
                .alias("a")
                .alias("b")
                .visible_alias("c")
                .visible_alias("a"),
            &["a", "b", "c"],
            &["a", "c"],
        ),
    ];
    for (command, all, visible) in cases {
        let graph = Application::new("store")
            .command(command.action(|_| async { Ok(()) }))
            .inspect()
            .unwrap();
        let node = &graph.root.children[0];
        assert_eq!(node.aliases, all);
        assert_eq!(node.visible_aliases, visible);
    }
}

fn diagnostic(declare: impl FnOnce(), rule: &str, sentence: &str) -> String {
    let message = panic_message(declare);
    assert_eq!(panic_rule(&message), rule, "{message}");
    let actual = message
        .split("\n\n")
        .nth(1)
        .unwrap()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(actual, sentence, "{message}");
    message
}

#[test]
fn a_bad_visible_command_alias_marks_the_name_at_its_setter() {
    let message = diagnostic(
        || {
            let _ = Command::new("keys")
                .alias("dir")
                .visible_alias("ls")
                .visible_alias("bad name");
        },
        "portable-name",
        r#"Command "keys" declares an alias named "bad name"."#,
    );
    assert!(
        message.contains(r#".visible_alias("bad name")"#),
        "{message}"
    );
    assert!(message.contains("^^^^^^^^^^"), "{message}");
}

#[test]
fn each_sibling_collision_marks_the_kind_of_alias_that_claimed_the_name() {
    type Case = (fn(), &'static str, [&'static str; 2]);
    let cases: [Case; 5] = [
        (
            || {
                let _ = Command::new("store")
                    .command(Command::new("get").action(|_| async { Ok(()) }))
                    .command(
                        Command::new("keys")
                            .alias("dir")
                            .visible_alias("get")
                            .action(|_| async { Ok(()) }),
                    );
            },
            r#"Command "store" attaches child "keys" with alias "get", which is also the name of child "get"."#,
            [
                r#".command(Command::new("get"))"#,
                r#".visible_alias("get")"#,
            ],
        ),
        (
            || {
                let _ = Command::new("store")
                    .command(
                        Command::new("select")
                            .alias("ls")
                            .visible_alias("sel")
                            .action(|_| async { Ok(()) }),
                    )
                    .command(
                        Command::new("keys")
                            .alias("dir")
                            .visible_alias("ls")
                            .action(|_| async { Ok(()) }),
                    );
            },
            r#"Command "store" attaches child "keys" with alias "ls", which is also an alias of child "select"."#,
            [r#".alias("ls")"#, r#".visible_alias("ls")"#],
        ),
        (
            || {
                let _ = Command::new("store")
                    .command(
                        Command::new("select")
                            .alias("sel")
                            .visible_alias("pick")
                            .visible_alias("ls")
                            .action(|_| async { Ok(()) }),
                    )
                    .command(
                        Command::new("keys")
                            .visible_alias("ls")
                            .action(|_| async { Ok(()) }),
                    );
            },
            r#"Command "store" attaches child "keys" with alias "ls", which is also an alias of child "select"."#,
            [r#".visible_alias("ls")"#, r#".visible_alias("ls")"#],
        ),
        (
            || {
                let _ = Command::new("store")
                    .command(
                        Command::new("select")
                            .alias("ls")
                            .action(|_| async { Ok(()) }),
                    )
                    .command(
                        Command::new("keys")
                            .alias("ls")
                            .alias("dir")
                            .visible_alias("ls")
                            .action(|_| async { Ok(()) }),
                    );
            },
            r#"Command "store" attaches child "keys" with alias "ls", which is also an alias of child "select"."#,
            [r#".alias("ls")"#, r#".visible_alias("ls")"#],
        ),
        (
            || {
                let _ = Command::new("store")
                    .command(
                        Command::new("keys")
                            .alias("dir")
                            .visible_alias("get")
                            .action(|_| async { Ok(()) }),
                    )
                    .command(Command::new("get").action(|_| async { Ok(()) }));
            },
            r#"Command "store" attaches child "keys" with alias "get", which is also the name of child "get"."#,
            [
                r#".visible_alias("get")"#,
                r#".command(Command::new("get"))"#,
            ],
        ),
    ];
    for (declare, sentence, calls) in cases {
        let message = diagnostic(declare, "sibling-name-taken", sentence);
        let (_, second) = message
            .split_once(calls[0])
            .unwrap_or_else(|| panic!("{message}"));
        assert!(second.contains(calls[1]), "{message}");
    }
}

async fn report_store(ctx: Context) -> Outcome {
    let mut options = json!({
        "color": ctx.option::<bool>("color")?,
        "quiet": ctx.option::<bool>("quiet")?,
    });
    if let Some(minimum) = ctx.option::<Option<String>>("min-bytes")? {
        options["min-bytes"] = json!(minimum);
    }
    ctx.out
        .print(&json!({"path": ctx.command.path, "options": options}).to_string())
        .await
}

fn store() -> Application<NoInputs, NoResult, Done> {
    Application::new("store")
        .command(
            Command::new("cache").command(
                Command::new("list")
                    .visible_alias("ls")
                    .option(
                        "min-bytes",
                        Opt::string()
                            .validate(Digits("Use a whole number."))
                            .visible_aliases(["minimum"]),
                    )
                    .option(
                        "color",
                        Opt::boolean()
                            .polarity(Polarity::Both)
                            .visible_aliases(["colour"]),
                    )
                    .option(
                        "quiet",
                        Opt::boolean()
                            .polarity(Polarity::Negative)
                            .visible_aliases(["silent"]),
                    )
                    .action(report_store),
            ),
        )
        .action(|_| async { Ok(()) })
}

#[tokio::test]
async fn a_visible_option_alias_binds_each_long_form_to_its_option() {
    let app = store();
    for (argv, expected) in [
        (
            &["--minimum", "5"][..],
            json!({"color": false, "quiet": true, "min-bytes": "5"}),
        ),
        (
            &["--minimum=5"][..],
            json!({"color": false, "quiet": true, "min-bytes": "5"}),
        ),
        (&["--colour"][..], json!({"color": true, "quiet": true})),
        (&["--no-colour"][..], json!({"color": false, "quiet": true})),
        (
            &["--no-silent"][..],
            json!({"color": false, "quiet": false}),
        ),
    ] {
        let argv = [&["cache", "ls"][..], argv].concat();
        assert_eq!(
            run(&app, &argv).await,
            Ran {
                status: 0,
                stdout: format!(
                    "{}\n",
                    json!({"path": ["cache", "list"], "options": expected})
                ),
                stderr: String::new(),
            },
            "{argv:?}",
        );
    }
}

#[tokio::test]
async fn a_negative_option_has_no_positive_alias_spelling() {
    assert_eq!(
        run(&store(), &["cache", "ls", "--silent"]).await,
        usage(
            "store: Unknown option \"--silent\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
}

#[tokio::test]
async fn a_validation_failure_reports_the_options_own_spelling() {
    assert_eq!(
        run(&store(), &["cache", "ls", "--minimum", "x"]).await,
        usage(r#"store: Option "--min-bytes": Use a whole number."#)
    );
}

#[test]
fn locate_follows_visible_command_and_option_aliases() {
    let graph = store().inspect().unwrap();
    let WordPosition::Value {
        command, option, ..
    } = locate(&graph, &["cache", "ls", "--minimum", ""])
    else {
        panic!("expected the value of --min-bytes");
    };
    assert_eq!(command.path, ["cache", "list"]);
    assert_eq!(option.name(), "min-bytes");
}

fn renamed(name: &str) -> StringOpt {
    Opt::string()
        .aliases([format!("{name}-old")])
        .visible_aliases([format!("{name}-short")])
}

#[test]
fn option_aliases_are_inspectable_in_each_declaration_scope() {
    let graph = Application::new("store")
        .plugins([
            Plugin::new("@test/hooked").on_command_attach(|command| {
                if command.name() == Some("list") {
                    command.option("hooked", renamed("hooked"))?;
                }
                Ok(())
            }),
            Plugin::new("@test/brought").option("brought", renamed("brought")),
        ])
        .global_option("global", renamed("global"))
        .command(
            Command::new("list")
                .option("local", renamed("local"))
                .options(&OptionSet::new().option("set", renamed("set")))
                .option(
                    "both",
                    Opt::string()
                        .aliases(["minimum", "min"])
                        .visible_aliases(["min"]),
                )
                .action(|_| async { Ok(()) }),
        )
        .inspect()
        .unwrap();
    let list = graph.command(&["list"]).unwrap();
    for (name, options) in [
        ("hooked", &list.options),
        ("local", &list.options),
        ("set", &list.options),
        ("global", &graph.globals),
        ("brought", &graph.globals),
    ] {
        let node = options.iter().find(|option| option.name() == name).unwrap();
        assert_eq!(
            node.aliases(),
            [format!("{name}-old"), format!("{name}-short")]
        );
        assert_eq!(node.visible_aliases(), [format!("{name}-short")]);
    }
    let both = list
        .options
        .iter()
        .find(|option| option.name() == "both")
        .unwrap();
    assert_eq!(both.aliases(), ["minimum", "min"]);
    assert_eq!(both.visible_aliases(), ["min"]);
    assert_eq!(list.options[0].long(), Some("--local"));
    assert_eq!(list.options[0].short(), None);
}

fn repeating(aliases: &[&str], visible: bool) -> Application<NoInputs, NoResult, Done> {
    let color = Opt::boolean().polarity(Polarity::Both);
    let color = if visible {
        color.visible_aliases(aliases.iter().copied())
    } else {
        color.aliases(aliases.iter().copied())
    };
    Application::new("store")
        .option("color", color)
        .action(values)
}

#[tokio::test]
async fn an_alias_whose_first_form_is_already_accepted_adds_no_spelling() {
    for visible in [false, true] {
        let app = repeating(&["no-color", "colour", "colour", "no-colour"], visible);
        let graph = app.inspect().unwrap();
        let color = &graph.root.options[0];
        assert_eq!(color.aliases(), ["colour"]);
        assert_eq!(
            color.visible_aliases(),
            if visible { &["colour"][..] } else { &[] }
        );
        assert_eq!(
            run(&app, &["--no-color"]).await,
            Ran {
                status: 0,
                stdout: "{\"args\":{},\"options\":{\"color\":false}}\n".to_owned(),
                stderr: String::new()
            },
        );
        for spelling in ["--no-no-color", "--no-no-colour"] {
            assert_eq!(
                run(&app, &[spelling]).await,
                usage(&format!(
                    "store: Unknown option \"{spelling}\". Supply a declared option; prefix a hyphenated path with \"./\"."
                )),
            );
        }
    }
}

#[tokio::test]
async fn an_alias_with_a_new_first_form_survives_even_if_its_negative_form_is_shared() {
    for visible in [false, true] {
        let app = repeating(&["no-colour", "colour"], visible);
        let graph = app.inspect().unwrap();
        let color = &graph.root.options[0];
        assert_eq!(color.aliases(), ["no-colour", "colour"]);
        assert_eq!(
            color.visible_aliases(),
            if visible {
                &["no-colour", "colour"][..]
            } else {
                &[]
            }
        );
        assert_eq!(
            run(&app, &["--colour"]).await,
            Ran {
                status: 0,
                stdout: "{\"args\":{},\"options\":{\"color\":true}}\n".to_owned(),
                stderr: String::new()
            },
        );
    }
}

fn assert_alias_mark(message: &str, setter: &str, name: &str) {
    let target = format!("{setter}([\"{name}\"");
    let lines: Vec<_> = message.lines().collect();
    assert!(
        lines.windows(2).any(|pair| {
            let Some(start) = pair[0].find(&target) else {
                return false;
            };
            let start = start + setter.len() + 2;
            pair[1].as_bytes().get(start..start + name.len() + 2)
                == Some(vec![b'^'; name.len() + 2].as_slice())
        }),
        "{message}"
    );
}

#[test]
fn the_first_bad_alias_is_marked_in_its_own_list() {
    for (hidden, visible, setter, bad) in [
        (&[][..], &["bad=name"][..], ".visible_aliases", "bad=name"),
        (
            &["bad hidden"][..],
            &["bad visible"][..],
            ".aliases",
            "bad hidden",
        ),
    ] {
        let message = diagnostic(
            || {
                let _ = Application::new("store").option(
                    "min-bytes",
                    Opt::string()
                        .aliases(hidden.iter().copied())
                        .visible_aliases(visible.iter().copied()),
                );
            },
            "declared-name",
            &format!("Option \"min-bytes\" declares an alias named \"{bad}\"."),
        );
        assert_alias_mark(&message, setter, bad);
    }
}

#[test]
fn a_spelling_collision_marks_the_visible_alias_even_when_both_lists_hold_it() {
    type Case = (fn(), &'static str, &'static str);
    let cases: [Case; 4] = [
        (
            || {
                let _ = Application::new("store")
                    .option("min-bytes", Opt::string().visible_aliases(["m"]))
                    .option("m", Opt::string());
            },
            r#"Option spelling "--m" is used by both "min-bytes" and "m"."#,
            "m",
        ),
        (
            || {
                let _ = Application::new("store")
                    .option(
                        "color",
                        Opt::boolean()
                            .polarity(Polarity::Both)
                            .visible_aliases(["colour"]),
                    )
                    .option("no-colour", Opt::boolean());
            },
            r#"Option spelling "--no-colour" is used by both "color" and "no-colour"."#,
            "colour",
        ),
        (
            || {
                let _ = Application::new("store")
                    .option(
                        "min-bytes",
                        Opt::string().aliases(["m"]).visible_aliases(["m"]),
                    )
                    .option("m", Opt::string());
            },
            r#"Option spelling "--m" is used by both "min-bytes" and "m"."#,
            "m",
        ),
        (
            || {
                let _ = Application::new("store")
                    .global_option("m", Opt::string())
                    .option("min-bytes", Opt::string().visible_aliases(["m"]));
            },
            r#"Option spelling "--m" is used by the global option "m" and the local option "min-bytes" on the root Command."#,
            "m",
        ),
    ];
    for (declare, sentence, name) in cases {
        assert_alias_mark(
            &diagnostic(declare, "spelling-taken", sentence),
            ".visible_aliases",
            name,
        );
    }
}

#[test]
fn a_short_only_builder_checks_both_alias_lists_and_accepts_empty_lists() {
    let empty: [&str; 0] = [];
    let graph = Application::new("store")
        .option(
            "small",
            Opt::count()
                .short('s')
                .short_only()
                .aliases(empty)
                .visible_aliases(empty),
        )
        .action(|_| async { Ok(()) })
        .inspect()
        .unwrap();
    assert!(graph.root.options[0].aliases().is_empty());
    assert!(graph.root.options[0].visible_aliases().is_empty());
    let message = diagnostic(
        || {
            let _ = Application::new("store").option(
                "small",
                Opt::count()
                    .short('s')
                    .short_only()
                    .visible_aliases(["little"]),
            );
        },
        "option-config",
        r#"Option "small" declares visible_aliases beside short_only, which removes every long spelling."#,
    );
    assert!(message.contains(".visible_aliases"), "{message}");
}

const SET_ALIASES: [&str; 1] = ["minimum"];

#[derive(Inputs)]
#[inputs(option_set)]
struct Limits {
    #[option(aliases = ["mb"], visible_aliases = SET_ALIASES)]
    min_bytes: Option<String>,
}

#[derive(Inputs)]
struct ListInputs {
    #[inputs(flatten)]
    limits: Limits,
    #[option(visible_aliases = ["colour"], polarity = "both")]
    color: bool,
}

#[tokio::test]
async fn the_derive_declares_visible_aliases_on_options_and_applied_sets() {
    let app = Application::new("store").inputs::<ListInputs>().action(
        |ctx: Context<ListInputs>| async move {
            ctx.out
                .print(&format!(
                    "{} {}",
                    ctx.inputs.limits.min_bytes.as_deref().unwrap_or("none"),
                    ctx.inputs.color
                ))
                .await
        },
    );
    let graph = app.inspect().unwrap();
    assert_eq!(graph.root.options[0].aliases(), ["mb", "minimum"]);
    assert_eq!(graph.root.options[0].visible_aliases(), ["minimum"]);
    assert_eq!(graph.root.options[1].visible_aliases(), ["colour"]);
    assert_eq!(
        run(&app, &["--minimum", "5", "--colour"]).await,
        Ran {
            status: 0,
            stdout: "5 true\n".to_owned(),
            stderr: String::new()
        },
    );
}
