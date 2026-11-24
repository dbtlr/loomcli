//! The color plugin, ported from the reference's `color.test.ts`: `--no-color` prints no color on
//! a capable terminal, even under `FORCE_COLOR`, and `--color` prints it piped. The reference
//! page is help's; the fixture here prints a themed token, since help is another package. The
//! plugin's `control` mark is the `color` row of `control-marks.test.ts`, in `controls_marks.rs`.

#![cfg(all(feature = "color", feature = "theme"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{Application, Context, ProcessHandle, RunOptions, ThemeMapping};
use loomcli_plugins::color::color;
use loomcli_plugins::theme::loom_theme;
use loomcli_testing::{MockFields, MockTerminal, mock_process};

/// Whether some SGR sequence in the text sets a foreground color.
fn has_color(text: &str) -> bool {
    let mut rest = text;
    while let Some(start) = rest.find("\u{1b}[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find('m') else {
            return false;
        };
        let parameters = &after[..end];
        let digits_only = parameters.chars().all(|c| c.is_ascii_digit() || c == ';');
        if digits_only
            && parameters
                .split(';')
                .any(|parameter| matches!(parameter.parse::<u8>(), Ok(30..=38 | 90..=97)))
        {
            return true;
        }
        rest = &after[end..];
    }
    false
}

/// The fixture's output for an argv, on a capable terminal or piped, under the variables given.
async fn page(argv: &[&str], terminal: bool, env: &[(&str, &str)]) -> (u8, String) {
    let application = Application::new("kit")
        .description("A fixture application.")
        .plugins((loom_theme(ThemeMapping::new()), color()))
        .action(|ctx: Context| async move {
            ctx.out.print(&ctx.style.highlight().apply("Saved")).await
        });
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .env("TERM", "xterm");
    for (name, value) in env {
        fields = fields.env(name, value);
    }
    if terminal {
        fields = fields.terminal(MockTerminal::new(100, 24));
    }
    let process = mock_process(fields);
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(process.stderr_text(), "");
    (code.get(), process.stdout_text())
}

#[tokio::test]
async fn forced_color_on_a_terminal_prints_color() {
    let (status, stdout) = page(&[], true, &[("FORCE_COLOR", "1")]).await;
    assert_eq!(status, 0);
    assert!(has_color(&stdout), "{stdout:?}");
}

#[tokio::test]
async fn no_color_prints_no_color_on_a_capable_terminal_even_under_force_color() {
    let (status, stdout) = page(&["--no-color"], true, &[("FORCE_COLOR", "1")]).await;
    assert_eq!((status, stdout.as_str()), (0, "Saved\n"));
}

#[tokio::test]
async fn piped_output_has_no_color() {
    let (status, stdout) = page(&[], false, &[]).await;
    assert_eq!((status, stdout.as_str()), (0, "Saved\n"));
}

#[tokio::test]
async fn color_prints_color_piped() {
    let (status, stdout) = page(&["--color"], false, &[]).await;
    assert_eq!(status, 0);
    assert!(has_color(&stdout), "{stdout:?}");
}

#[tokio::test]
async fn no_color_overrides_no_color_variable_and_color_overrides_it_back() {
    let (_, off) = page(&["--no-color"], true, &[("NO_COLOR", "1")]).await;
    assert_eq!(off, "Saved\n");
    let (_, on) = page(&["--color"], true, &[("NO_COLOR", "1")]).await;
    assert!(has_color(&on), "{on:?}");
}
