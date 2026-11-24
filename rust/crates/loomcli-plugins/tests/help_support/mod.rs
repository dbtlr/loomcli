//! What the help tests share: running an application on the mock process, a page written by hand
//! as its lines, the rendering policies, and the themes the reference's styled pages run under.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::style::{Ansi16Color, ColorFallbacks, ThemeValue, adaptive, style};
use loomcli_core::{
    Application, Plugin, ProcessHandle, RenderingPolicy, RunOptions, State, Switch, ThemeMapping,
    View,
};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, StreamName, mock_process};

/// What one run recorded: its exit code, stdout, and stderr.
#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

/// A page written by hand, as its lines, with the one newline the view ends it with.
pub fn page(lines: &[&str]) -> Outcome {
    Outcome {
        status: 0,
        stdout: text(lines),
        stderr: String::new(),
    }
}

/// Lines joined with a line feed after each.
pub fn text(lines: &[&str]) -> String {
    let mut joined = lines.join("\n");
    joined.push('\n');
    joined
}

/// Color, modifiers, and hyperlinks off.
pub fn plain() -> RenderingPolicy {
    RenderingPolicy::new()
        .color(Switch::Never)
        .modifiers(Switch::Never)
        .hyperlinks(Switch::Never)
}

/// Color and modifiers on.
pub fn styled() -> RenderingPolicy {
    RenderingPolicy::new()
        .color(Switch::Always)
        .modifiers(Switch::Always)
}

/// Runs `application` on a mock process built from `fields`, under `policy` when one is given.
pub async fn run_with<I, R, S: State>(
    application: &Application<I, R, S>,
    fields: MockFields,
    policy: Option<RenderingPolicy>,
) -> (Outcome, Arc<MockProcess>) {
    let process = mock_process(fields);
    let options = RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>);
    let options = match policy {
        Some(policy) => options.rendering(policy),
        None => options,
    };
    let code = application.run(options).await;
    let outcome = Outcome {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    };
    (outcome, process)
}

/// Runs `application` with `argv` on a fresh mock process, off a terminal.
pub async fn run<I, R, S: State>(application: &Application<I, R, S>, argv: &[&str]) -> Outcome {
    run_with(
        application,
        MockFields::new().argv(argv.iter().copied()),
        None,
    )
    .await
    .0
}

/// Runs `application` with `argv` on a stdout terminal `columns` wide, or a pipe for `None`, with
/// color, modifiers, and hyperlinks off unless `policy` says otherwise, and returns stdout after
/// asserting a clean exit.
pub async fn render_at<I, R, S: State>(
    application: &Application<I, R, S>,
    argv: &[&str],
    columns: Option<u16>,
    policy: Option<RenderingPolicy>,
) -> String {
    let fields = MockFields::new()
        .argv(argv.iter().copied())
        .platform("linux");
    let fields = match columns {
        Some(columns) => {
            fields.terminal(MockTerminal::new(columns, 24).streams([StreamName::Stdout]))
        }
        None => fields,
    };
    let (outcome, _) = run_with(application, fields, Some(policy.unwrap_or_else(plain))).await;
    assert_eq!(outcome.stderr, "", "stderr of {argv:?}");
    assert_eq!(outcome.status, 0, "status of {argv:?}");
    outcome.stdout
}

/// The page's blocks, each as its lines.
pub fn blocks(stdout: &str) -> Vec<Vec<String>> {
    stdout
        .strip_suffix('\n')
        .unwrap_or(stdout)
        .split("\n\n")
        .map(|block| block.split('\n').map(str::to_owned).collect())
        .collect()
}

/// The block whose first line is `title`.
pub fn block(stdout: &str, title: &str) -> Vec<String> {
    blocks(stdout)
        .into_iter()
        .find(|lines| lines.first().map(String::as_str) == Some(title))
        .unwrap_or_default()
}

/// One side of a Loom palette entry: a hex color with its 256-color and 16-color fallbacks.
fn side(hex: &str, ansi256: u8, ansi16: Ansi16Color) -> loomcli_core::Style {
    style()
        .hex_with(hex, ColorFallbacks::new().ansi256(ansi256).ansi16(ansi16))
        .unwrap()
}

/// One adaptive Loom palette entry.
fn pair(dark: (&str, u8), light: (&str, u8), ansi16: Ansi16Color) -> ThemeValue {
    ThemeValue::Adaptive(
        adaptive(
            &side(dark.0, dark.1, ansi16),
            &side(light.0, light.1, ansi16),
        )
        .unwrap(),
    )
}

/// The Loom theme's palette, as the reference's `loomTheme()` maps it, installed through core's
/// theme slot so the help tests need no theme feature.
pub fn loom_theme() -> Plugin {
    let mapping = ThemeMapping::new()
        .entry(
            "dim",
            pair(("#8B93A3", 245), ("#5F6B7A", 243), Ansi16Color::BrightBlack),
        )
        .entry(
            "error",
            pair(("#C04532", 131), ("#C04532", 131), Ansi16Color::Red),
        )
        .entry(
            "highlight",
            pair(("#C97B36", 172), ("#9C5A1E", 130), Ansi16Color::Yellow),
        )
        .entry(
            "info",
            pair(("#5B7DA3", 67), ("#4A6B91", 60), Ansi16Color::Blue),
        )
        .entry("primary", ThemeValue::Plain(style().reset_foreground()))
        .entry(
            "success",
            pair(("#7A8F7B", 108), ("#4E6B50", 65), Ansi16Color::Green),
        )
        .entry(
            "warning",
            pair(("#E2B93D", 178), ("#8A6D0E", 94), Ansi16Color::BrightYellow),
        );
    Plugin::new("@fixture/theme").theme(mapping)
}

/// A theme of four plain colors: dim magenta, highlight cyan, primary green, warning red.
pub fn custom_theme() -> Plugin {
    let mapping = ThemeMapping::new()
        .entry("dim", ThemeValue::Plain(style().magenta()))
        .entry("highlight", ThemeValue::Plain(style().cyan()))
        .entry("primary", ThemeValue::Plain(style().green()))
        .entry("warning", ThemeValue::Plain(style().red()));
    Plugin::new("@fixture/theme").theme(mapping)
}

/// A theme of three plain colors: dim magenta, highlight cyan, primary green.
pub fn markdown_theme() -> Plugin {
    let mapping = ThemeMapping::new()
        .entry("dim", ThemeValue::Plain(style().magenta()))
        .entry("highlight", ThemeValue::Plain(style().cyan()))
        .entry("primary", ThemeValue::Plain(style().green()));
    Plugin::new("@fixture/theme").theme(mapping)
}

/// A view that prints the text it is given, so a test can name its own override.
pub fn text_view<D: 'static>(render: fn(&D) -> String) -> View<D> {
    View::new(move |data: &D, _context| render(data))
}

/// A stand-in for the version plugin's option, so a page lists `-V, --version` as the reference's
/// fixtures, which install `version()` after `help()`, do.
pub fn version_stand_in() -> Plugin {
    Plugin::new("@loomcli/plugins/version")
        .option(
            "version",
            loomcli_core::Opt::boolean()
                .short('V')
                .control()
                .description("Print the version."),
        )
        .middleware(
            loomcli_core::Activation::options(["version"]),
            |context: loomcli_core::MiddlewareContext<loomcli_core::NoOptions>, _next| async move {
                let line = format!("{} v{}", context.graph.name, context.graph.version);
                context.out.print(&line).await
            },
        )
}

/// A stand-in for the verbose plugin's options: the verbose and quiet marks on counted options.
pub fn verbose_stand_in() -> Plugin {
    Plugin::new("@loomcli/plugins/verbose")
        .option(
            "verbose",
            loomcli_core::Opt::count()
                .short('v')
                .verbose()
                .description("Show more detail. Repeat it for more."),
        )
        .option(
            "quiet",
            loomcli_core::Opt::count()
                .short('q')
                .quiet()
                .description("Hide info and success messages."),
        )
}

/// An action that prints `dispatched`.
pub async fn dispatch(context: loomcli_core::Context) -> loomcli_core::Outcome {
    context.out.print("dispatched").await
}

/// An action that does nothing.
pub async fn noop(_context: loomcli_core::Context) -> loomcli_core::Outcome {
    Ok(())
}

/// The message a panicking declaration raised, or `None` when it raised none.
pub fn panic_message(build: impl FnOnce()) -> Option<String> {
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(build));
    caught.err().map(|payload| {
        payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| {
                payload
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
            })
            .unwrap_or_default()
    })
}
