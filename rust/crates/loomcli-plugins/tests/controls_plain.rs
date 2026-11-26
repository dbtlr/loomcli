//! Ports the four cases of the reference's `plain.test.ts`.

#![cfg(feature = "plain")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_core::{Application, Context, Opt, RegionOptions, RunOptions};
use loomcli_plugins::plain::plain;
use loomcli_testing::{MockFields, MockTerminal, mock_process};

#[cfg(feature = "help")]
#[tokio::test]
async fn help_lists_plain_with_its_description() {
    let app = Application::new("kit")
        .plugins((loomcli_plugins::help::help(), plain()))
        .action(|_: Context| async { Ok(()) });
    let mock = mock_process(MockFields::new().argv(["--help"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    let help = mock.stdout_text();
    let (name, description) = help.split_once("--plain").unwrap();
    assert!(!name.is_empty());
    assert!(
        description
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .starts_with(
                "Never redraw: print progress as plain lines and ask questions line by line."
            ),
        "{help}"
    );
}

#[cfg(feature = "manifest")]
#[tokio::test]
async fn manifest_marks_plain_as_a_control() {
    let app = Application::new("kit")
        .plugins((loomcli_plugins::manifest::manifest(), plain()))
        .action(|_: Context| async { Ok(()) });
    let mock = mock_process(MockFields::new().argv(["--manifest"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    let document: serde_json::Value = serde_json::from_str(&mock.stdout_text()).unwrap();
    let option = document["globals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|option| option["name"] == "plain")
        .unwrap();
    assert_eq!(option["long"], "--plain");
    assert_eq!(option["control"], true);
    assert_eq!(option["plain"], true);
}

#[tokio::test]
async fn the_plain_plugin_turns_off_live_regions() {
    let app = Application::new("kit")
        .plugins([plain()])
        .action(|ctx: Context| async move {
            let live = ctx.out.region(RegionOptions::new()).live();
            ctx.out.print(&live.to_string()).await
        });
    for (argv, expected) in [(&[][..], "true\n"), (&["--plain"][..], "false\n")] {
        let mock = mock_process(
            MockFields::new()
                .argv(argv.iter().copied())
                .terminal(MockTerminal::new(40, 24)),
        );
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stdout_text(), expected);
    }
}

#[test]
fn a_mark_declared_beside_the_plugin_fails_with_the_two_marks_error() {
    let error = std::panic::catch_unwind(|| {
        Application::new("kit")
            .plugins([plain()])
            .global_option("accessible", Opt::boolean().plain())
    })
    .err()
    .expect("two plain marks fail");
    let message = error.downcast::<String>().unwrap();
    assert!(message.contains("@loomcli/core/plain-mark"), "{message}");
    assert!(message.contains("both declare plain"), "{message}");
}
