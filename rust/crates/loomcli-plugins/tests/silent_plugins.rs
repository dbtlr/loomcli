//! The remaining first-party plugins and pack views add no verbose lines.

#![cfg(all(
    feature = "background",
    feature = "box",
    feature = "color",
    feature = "format",
    feature = "heading",
    feature = "help",
    feature = "interaction",
    feature = "list",
    feature = "manifest",
    feature = "plain",
    feature = "prose",
    feature = "records",
    feature = "rule",
    feature = "step",
    feature = "suggestions",
    feature = "table",
    feature = "theme",
    feature = "verbose",
    feature = "version",
))]

use loomcli_core::{
    AnyPlugin, Application, Command, Context, Message, RunOptions, ThemeMapping, style,
};
use loomcli_plugins::{
    background::background,
    boxed::{BoxConfig, boxed},
    color::color,
    format::format,
    heading::{HeadingConfig, heading},
    help::help,
    interaction::interaction,
    list::{ListConfig, list},
    manifest::manifest,
    plain::plain,
    prose::prose,
    records::{RecordsConfig, records},
    rule::rule,
    step::step,
    suggestions::suggestions,
    table::{TableConfig, table},
    theme::theme,
    verbose::verbose,
    version::version,
};
use loomcli_testing::{MockFields, mock_process};
use serde::Serialize;

#[derive(Serialize)]
struct Row {
    name: &'static str,
    size: u8,
}

async fn run<'a>(argv: impl IntoIterator<Item = &'a str>) -> (u8, String, String) {
    let plugins: Vec<AnyPlugin> = vec![
        help().into(),
        format().into(),
        color().into(),
        theme(ThemeMapping::new().entry("accent", style().cyan())).into(),
        verbose().into(),
        interaction().into(),
        suggestions().into(),
        manifest().into(),
        version().into(),
        background().into(),
        plain().into(),
    ];
    let app = Application::new("notes")
        .description("Keep notes in sync.")
        .version("1.5.0")
        .plugins(plugins)
        .command(Command::new("show").description("Show the notes.").action(
            |ctx: Context| async move {
                let rows = [
                    Row {
                        name: "notes.md",
                        size: 12,
                    },
                    Row {
                        name: "todo.md",
                        size: 3,
                    },
                ];
                ctx.out
                    .render("Notes", &heading(HeadingConfig::new()))
                    .await?;
                ctx.out.render("", &rule()).await?;
                ctx.out.render("Two notes are kept.", &prose()).await?;
                ctx.out
                    .render("Synced.", &boxed(BoxConfig::new().title("Status")))
                    .await?;
                ctx.out
                    .render(["notes.md", "todo.md"].as_slice(), &list(ListConfig::new()))
                    .await?;
                ctx.out
                    .render(rows.as_slice(), &table(TableConfig::new()))
                    .await?;
                ctx.out
                    .render(rows, &records(RecordsConfig::new("name")))
                    .await?;
                ctx.out
                    .info(Message::new("Checked the notes.").view(&step()))
                    .await
            },
        ));
    let mock = mock_process(MockFields::new().argv(argv));
    let status = app.run(RunOptions::new().process(mock.clone())).await.get();
    (status, mock.stdout_text(), mock.stderr_text())
}

#[tokio::test]
async fn each_command_writes_the_same_bytes_at_every_verbosity() {
    for argv in ["show", "--help", "--version", "--manifest", "shwo"] {
        let normal = run([argv]).await;
        assert!(!normal.1.is_empty() || !normal.2.is_empty(), "{argv}");
        for flag in ["-v", "-vv"] {
            assert_eq!(run([flag, argv]).await, normal, "{flag} {argv}");
        }
    }
}

#[tokio::test]
async fn the_actions_step_is_the_only_stderr_line_at_trace() {
    let (status, _, stderr) = run(["-vv", "show"]).await;
    assert_eq!(status, 0);
    assert_eq!(stderr, "❯ Checked the notes.\n");
}
