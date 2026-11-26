//! Group-local option routing and validation through the mock process.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Activation, Application, Command, Context, Group, NoInputs, NoResult, Opt, Plugin,
};
use support::validators::OneOfUpper;

fn store(clear_force: bool) -> Application<NoInputs, NoResult, Group> {
    let clear = Command::new("clear");
    let clear = if clear_force {
        clear
            .option("force", Opt::boolean())
            .action(|ctx: Context| async move {
                let force = ctx.option::<bool>("force")?;
                ctx.out.print(&format!("force:{force}")).await
            })
    } else {
        clear.action(|_: Context| async { Ok(()) })
    };
    Application::new("store").command(
        Command::new("cache")
            .option("force", Opt::boolean())
            .command(clear),
    )
}

#[tokio::test]
async fn a_group_option_binds_to_the_child_declaring_the_spelling() {
    let ran = support::run(&store(true), &["cache", "--force", "clear"]).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (0, "force:true\n", "")
    );
}

#[tokio::test]
async fn a_group_option_is_unknown_on_a_child_lacking_the_spelling() {
    let ran = support::run(&store(false), &["cache", "--force", "clear"]).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (
            2,
            "",
            "store: Unknown option \"--force\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
        )
    );
}

#[tokio::test]
async fn a_group_option_stays_on_the_group_when_routing_ends_there() {
    let ran = support::run(&store(true), &["cache", "--force"]).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (
            2,
            "",
            "store: Command \"cache\" requires a subcommand. Use one of: clear.\n"
        )
    );
}

#[tokio::test]
async fn the_declaring_middleware_reads_its_validated_group_option_under_the_held_fault() {
    let observed = Arc::new(Mutex::new(None));
    let reader = Arc::clone(&observed);
    let tagging = Plugin::new("@fixture/tag")
        .on_command_attach(|command| {
            if !command.has_action() {
                command.option(
                    "tag",
                    Opt::string()
                        .hidden()
                        .validate(OneOfUpper(&["x"], "Use x.")),
                )?;
            }
            Ok(())
        })
        .middleware(Activation::Always, move |context, next| {
            let reader = Arc::clone(&reader);
            async move {
                *reader.lock().unwrap() = context.own_options.option::<Option<String>>("tag")?;
                next.run().await?;
                Ok(())
            }
        });
    let app = Application::new("notes")
        .plugins([tagging])
        .command(Command::new("list").action(|_: Context| async { Ok(()) }));
    let ran = support::run(&app, &["--tag", "x"]).await;
    assert_eq!(observed.lock().unwrap().as_deref(), Some("X"));
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (2, "", "notes: A command is required. Use one of: list.\n")
    );
}
