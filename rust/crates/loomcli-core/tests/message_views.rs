//! Ports the message view cases through an application and a mock process.

mod support;

use loomcli_core::{
    Application, Context, EnvironmentAdditions, Message, Opt, Plugin, ResultViews, Style, View,
    lanes, nowrap, override_view,
};
use loomcli_testing::MockFields;
use support::{Ran, run, run_with};

#[tokio::test]
async fn default_lanes_keep_the_messages_own_final_line_breaks() {
    let app = Application::new("print").action(|ctx: Context| async move {
        ctx.out.print("done\n").await?;
        ctx.out.print(&Style::new().dim().apply("dim\n")).await?;
        ctx.out.print("spaced\n\n").await?;
        ctx.out.info("note\n").await
    });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: "done\ndim\nspaced\n\n".to_owned(),
            stderr: "ℹ note\n".to_owned(),
        }
    );
}

fn bracketed() -> View<str> {
    View::new(|text: &str, _| format!("[{text}]\n"))
}

fn bare() -> View<str> {
    View::new(|text: &str, _| format!("> {text}"))
}

#[tokio::test]
async fn a_passed_view_replaces_the_lanes_whole_layout_on_its_destination() {
    let app = Application::new("look").action(|ctx: Context| async move {
        ctx.out
            .info(Message::new("Building").view(&bracketed()))
            .await?;
        ctx.out.print(Message::new("data").view(&bare())).await
    });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: "> data\n".to_owned(),
            stderr: "[Building]\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn print_with_a_view_moves_to_stderr_on_a_command_with_a_result() {
    let app = Application::new("result")
        .result(
            ResultViews::new().view("text", View::new(|value: &String, _| format!("{value}\n"))),
        )
        .action(async |ctx| {
            ctx.out.print(Message::new("note").view(&bare())).await?;
            ctx.out.results("value".to_owned()).await
        });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: "value\n".to_owned(),
            stderr: "> note\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_hidden_message_calls_no_view() {
    let app = Application::new("hidden")
        .global_option("quiet", Opt::count().short('q').quiet())
        .action(|ctx: Context| async move {
            let broken = View::new(|_: &str, _| {
                Err::<String, _>(std::io::Error::other("A hidden call called its view."))
            });
            ctx.out.info(Message::new("Building").view(&broken)).await?;
            ctx.out.success(Message::new("Built").view(&broken)).await?;
            ctx.out.warn(Message::new("Kept").view(&bracketed())).await
        });
    assert_eq!(
        run(&app, &["-q"]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "[Kept]\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn an_info_message_with_a_warnings_view_stays_hidden_under_quiet() {
    let app = Application::new("level")
        .global_option("quiet", Opt::count().short('q').quiet())
        .action(|ctx: Context| async move {
            ctx.out
                .info(Message::new("The cache is stale.").view(&lanes::warn()))
                .await
        });
    for (argv, stderr) in [(&["-q"][..], ""), (&[][..], "⚠ The cache is stale.\n")] {
        assert_eq!(
            run(&app, argv).await,
            Ran {
                status: 0,
                stdout: String::new(),
                stderr: stderr.to_owned()
            }
        );
    }
}

#[tokio::test]
async fn a_passed_declared_view_resolves_through_the_registry() {
    let app = Application::new("declared")
        .overrides([override_view(
            lanes::warn(),
            View::new(|text: &str, _| format!("WARN {text}")),
        )])
        .action(|ctx: Context| async move {
            ctx.out
                .info(Message::new("Careful").view(&lanes::warn()))
                .await
        });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "WARN Careful\n".to_owned()
        }
    );
}

#[tokio::test]
async fn a_passed_view_takes_the_place_of_a_lane_override() {
    let app = Application::new("own")
        .overrides([override_view(
            lanes::info(),
            View::new(|text: &str, _| format!("INFO {text}")),
        )])
        .action(|ctx: Context| async move {
            ctx.out.info("Plain").await?;
            ctx.out
                .info(Message::new("Framed").view(&bracketed()))
                .await
        });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "INFO Plain\n[Framed]\n".to_owned()
        }
    );
}

#[tokio::test]
async fn a_passed_view_ends_in_a_line_break_and_preserves_authored_breaks() {
    for (text, stderr) in [
        ("done", "done\n"),
        ("done\n", "done\n"),
        ("done\r\n", "done\r\n"),
        ("done\n\n", "done\n\n"),
        ("", "\n"),
    ] {
        let app = Application::new("breaks").action(move |ctx: Context| async move {
            let view = View::new(move |_: &str, _| text.to_owned());
            ctx.out.warn(Message::new("ignored").view(&view)).await
        });
        assert_eq!(
            run(&app, &[]).await,
            Ran {
                status: 0,
                stdout: String::new(),
                stderr: stderr.to_owned()
            }
        );
    }
}

#[tokio::test]
async fn a_line_break_inside_a_colored_style_frame_ends_the_message() {
    let app = Application::new("styled").action(|ctx: Context| async move {
        let view = View::new(|text: &str, context| {
            context.style.red().apply(&nowrap(&format!("{text}\n")))
        });
        ctx.out.warn(Message::new("done").view(&view)).await
    });
    assert_eq!(
        run_with(&app, MockFields::new().env("FORCE_COLOR", "1")).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "\u{1b}[31mdone\n\u{1b}[39m".to_owned()
        }
    );
}

#[tokio::test]
async fn an_environment_hooks_warning_draws_through_a_passed_view() {
    let app = Application::new("environment")
        .plugins((
            Plugin::new("fixture/environment").on_environment(|ctx| async move {
                ctx.warn(Message::new("Using defaults").view(&bracketed()))
                    .await?;
                Ok(EnvironmentAdditions::new())
            }),
        ))
        .action(|_: Context| async { Ok(()) });
    assert_eq!(
        run(&app, &[]).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: "[Using defaults]\n".to_owned()
        }
    );
}

#[tokio::test]
async fn a_control_string_after_the_last_line_break_adds_no_line() {
    use loomcli_core::{RenderingPolicy, RunOptions, TerminalControls};
    use loomcli_testing::mock_process;
    use std::sync::Arc;

    let app = Application::new("controls").action(|ctx: Context| async move {
        let view = View::new(|_: &str, _| "done\n\u{1b}Ppayload\u{1b}\\".to_owned());
        ctx.out.print(Message::new("done").view(&view)).await
    });
    let mock = mock_process(MockFields::new());
    let options = RunOptions::new()
        .process(Arc::clone(&mock) as _)
        .rendering(RenderingPolicy::new().terminal_controls(TerminalControls::Preserve));
    assert_eq!(app.run(options).await.get(), 0);
    assert_eq!(mock.stdout_text(), "done\n\u{1b}Ppayload\u{1b}\\");
    assert_eq!(mock.stderr_text(), "");
}
