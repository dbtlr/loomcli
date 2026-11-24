//! The background plugin, ported from the reference's `background-plugin.test.ts`. The
//! reference's process case answers core's background query on a scripted terminal; here a
//! process handle whose stdin holds the scripted reply answers it.

#![cfg(all(feature = "background", feature = "theme"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Background, BoxFuture, Child, Context, DirectoryFacts, Done, Env, ExitCode,
    InputStream, InputTerminal, Libc, NoInputs, NoResult, OutputStream, OutputTerminal,
    ProcessHandle, ProcessTerminal, ReleaseFacts, RenderingPolicy, RunOptions, SignalSource,
    SpawnRequest, Switch, ThemeMapping,
};
use loomcli_plugins::background::background;
use loomcli_plugins::theme::loom_theme;
use loomcli_testing::{MockFields, MockProcess, MockTerminal, mock_process};

/// An application that installs the Loom theme and the background plugin, beside a `tag` option.
/// Its action prints the highlight token and the settled background.
fn notes()
-> loomcli_core::Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Done> {
    Application::new("notes")
        .description("Keep notes.")
        .version("1.0.0")
        .plugins((loom_theme(ThemeMapping::new()), background()))
        .global_option(
            "tag",
            loomcli_core::Opt::string().description("Tag the note."),
        )
        .action(|ctx: Context| async move {
            let settled = ctx
                .host
                .terminal
                .background
                .map_or("undefined", Background::name);
            ctx.out
                .print(&format!(
                    "{} {settled}",
                    ctx.style.highlight().apply("Saved")
                ))
                .await
        })
}

/// A run on a 200-column terminal whose keyboard has nothing typed and answers no query.
async fn run(argv: &[&str]) -> (u8, String, String) {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .env("COLORTERM", "truecolor")
            .env("TERM", "xterm-256color")
            .terminal(MockTerminal::new(200, 24).keys(Vec::<&str>::new())),
    );
    let policy = RenderingPolicy::new().color(Switch::Always);
    let code = notes()
        .run(
            RunOptions::new()
                .process(Arc::clone(&process) as Arc<dyn ProcessHandle>)
                .rendering(policy),
        )
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

const DARK: &str = "\u{1b}[38;2;201;123;54mSaved\u{1b}[39m dark\n";
const LIGHT: &str = "\u{1b}[38;2;156;90;30mSaved\u{1b}[39m light\n";

#[tokio::test]
async fn background_dark_prints_the_dark_side_and_writes_no_query() {
    assert_eq!(
        run(&["--background=dark"]).await,
        (0, DARK.to_owned(), String::new())
    );
}

#[tokio::test]
async fn background_light_prints_the_light_side() {
    assert_eq!(
        run(&["--background=light"]).await,
        (0, LIGHT.to_owned(), String::new())
    );
    assert_eq!(
        run(&["--background", "light"]).await,
        (0, LIGHT.to_owned(), String::new())
    );
}

#[tokio::test]
async fn background_blue_fails_validation_with_exit_2_and_the_plugin_issue() {
    let (status, stdout, stderr) = run(&["--background=blue"]).await;
    assert_eq!((status, stdout.as_str()), (2, ""));
    assert!(stderr.contains("Supply dark or light."), "{stderr:?}");
}

#[tokio::test]
async fn the_option_is_marked_control_and_background_with_the_enum_schema() {
    let graph = notes().inspect().unwrap();
    let globals: std::collections::BTreeMap<_, _> = graph
        .globals
        .iter()
        .map(|option| {
            (
                option.name().to_owned(),
                serde_json::to_value(&**option).unwrap(),
            )
        })
        .collect();
    let option = &globals["background"];
    assert_eq!(option["background"], serde_json::json!(true));
    assert_eq!(option["control"], serde_json::json!(true));
    assert_eq!(option["type"], serde_json::json!("string"));
    assert_eq!(
        serde_json::to_string(&option["schema"]).unwrap(),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["dark","light"]}"#
    );
    assert_eq!(
        option["description"],
        serde_json::json!("Pick colors for this terminal background instead of detecting it.")
    );
    assert_eq!(globals["tag"]["background"], serde_json::json!(false));
}

#[tokio::test]
async fn with_no_choice_and_an_unanswered_query_the_background_stays_unknown() {
    // The keyboard answers the query with the device attributes reply alone, so the background is
    // unknown, the dark side prints, and the action sees no background.
    let (status, stdout, stderr) = run(&[]).await;
    assert_eq!(
        (status, stdout.as_str()),
        (0, "\u{1b}[38;2;201;123;54mSaved\u{1b}[39m undefined\n")
    );
    assert_eq!(stderr, "\u{1b}]11;?\u{1b}\\\u{1b}[?996n\u{1b}[c");
}

const LIGHT_REPLY: &str = "\u{1b}]11;rgb:ffff/ffff/f0f0\u{1b}\\\u{1b}[?62;22c";
const QUERY: &str = "\u{1b}]11;?\u{1b}\\\u{1b}[?996n\u{1b}[c";

/// A terminal stdin that answers its scripted reply once and then waits.
struct Reply(Mutex<Option<Vec<u8>>>);

impl InputStream for Reply {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            let chunk = self.0.lock().unwrap().take();
            match chunk {
                Some(chunk) => {
                    buffer[..chunk.len()].copy_from_slice(&chunk);
                    Ok(chunk.len())
                }
                None => std::future::pending().await,
            }
        })
    }
    fn set_raw_mode(&self, _on: bool) -> io::Result<()> {
        Ok(())
    }
}

/// Terminal facts that state stdin, stdout, and stderr as terminals.
struct Terminals;

impl ProcessTerminal for Terminals {
    fn stdin(&self) -> InputTerminal {
        InputTerminal::new(true)
    }
    fn stdout(&self) -> OutputTerminal {
        OutputTerminal::new(true, Some(80), Some(24))
    }
    fn stderr(&self) -> OutputTerminal {
        OutputTerminal::new(true, Some(80), Some(24))
    }
}

/// The mock process with a scripted terminal stdin and terminal facts.
struct Scripted {
    mock: Arc<MockProcess>,
    stdin: Arc<Reply>,
}

impl ProcessHandle for Scripted {
    fn argv(&self) -> Vec<String> {
        self.mock.argv()
    }
    fn program(&self) -> Vec<String> {
        self.mock.program()
    }
    fn env(&self) -> Env {
        self.mock.env()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.mock.cwd()
    }
    fn home(&self) -> PathBuf {
        self.mock.home()
    }
    fn tmpdir(&self) -> PathBuf {
        self.mock.tmpdir()
    }
    fn platform(&self) -> String {
        self.mock.platform()
    }
    fn arch(&self) -> String {
        self.mock.arch()
    }
    fn libc(&self) -> Option<Libc> {
        self.mock.libc()
    }
    fn uid(&self) -> Option<u32> {
        self.mock.uid()
    }
    fn time_zone(&self) -> String {
        self.mock.time_zone()
    }
    fn release(&self) -> ReleaseFacts {
        self.mock.release()
    }
    fn release_for(&self, application: &str, directories: &DirectoryFacts) -> ReleaseFacts {
        self.mock.release_for(application, directories)
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        Arc::clone(&self.stdin) as Arc<dyn InputStream>
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        self.mock.stdout()
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        self.mock.stderr()
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        Arc::new(Terminals)
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        self.mock.signals()
    }
    fn spawn(&self, request: SpawnRequest) -> Child {
        self.mock.spawn(request)
    }
    fn set_exit_code(&self, code: ExitCode) {
        self.mock.set_exit_code(code);
    }
}

type App = Application<NoInputs, NoResult, Done>;

/// Runs `application` on a terminal whose keyboard answers `reply`.
async fn run_scripted(application: App, reply: &str) -> (u8, String, String) {
    let mock = mock_process(
        MockFields::new()
            .env("COLORTERM", "truecolor")
            .env("TERM", "xterm-256color"),
    );
    let handle = Scripted {
        mock: Arc::clone(&mock),
        stdin: Arc::new(Reply(Mutex::new(Some(reply.as_bytes().to_vec())))),
    };
    let policy = RenderingPolicy::new().color(Switch::Always);
    let code = application
        .run(
            RunOptions::new()
                .process(Arc::new(handle))
                .rendering(policy),
        )
        .await;
    (code.get(), mock.stdout_text(), mock.stderr_text())
}

/// What the action of a theme-less application prints: the background it sees.
async fn show_background(ctx: Context) -> loomcli_core::Outcome {
    let settled = ctx
        .host
        .terminal
        .background
        .map_or("undefined", Background::name);
    ctx.out.print(settled).await
}

/// An application with no theme and the background plugin.
fn reader_with_plugin() -> App {
    Application::new("reader")
        .plugins((background(),))
        .action(show_background)
}

/// The same application without the plugin.
fn reader_without_plugin() -> App {
    Application::new("reader").action(show_background)
}

#[tokio::test]
async fn a_scripted_light_terminal_answers_the_query_and_the_loom_theme_prints_its_light_side() {
    assert_eq!(
        run_scripted(notes(), LIGHT_REPLY).await,
        (0, LIGHT.to_owned(), QUERY.to_owned())
    );
}

#[tokio::test]
async fn the_plugins_mark_alone_makes_core_detect_the_background() {
    assert_eq!(
        run_scripted(reader_with_plugin(), LIGHT_REPLY).await,
        (0, "light\n".to_owned(), QUERY.to_owned())
    );
    assert_eq!(
        run_scripted(reader_without_plugin(), LIGHT_REPLY).await,
        (0, "undefined\n".to_owned(), String::new())
    );
}
