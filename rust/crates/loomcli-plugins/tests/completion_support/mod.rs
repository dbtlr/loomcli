//! The fixtures the completion tests share: the reference's `kit` application
//! (`fixtures/completion-app.ts`), which the answer and the printed scripts are read from, and a
//! runner over the mock process.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod install;

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Command, Context, Group, InputSchema, Issue, NoInputs, NoResult, Opt,
    Outcome, Polarity, ProcessHandle, RunOptions, ValidationContext, Validator,
};
use loomcli_plugins::completion::completion;
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Value, json};

/// A validator that accepts any value and publishes exactly the given input-side JSON Schema.
pub struct Shaped(pub Value);

impl Validator for Shaped {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_owned())
    }

    fn input_schema(&self) -> InputSchema {
        self.0.as_object().cloned()
    }
}

/// A validator that publishes `{ "enum": values }`.
pub fn shaped<const N: usize>(values: [&str; N]) -> Shaped {
    Shaped(json!({ "enum": values.to_vec() }))
}

pub async fn nothing(_context: Context) -> Outcome {
    Ok(())
}

/// Closed-set values a shell must insert as text, and values completion leaves out: a newline, a
/// tab, the ActiveHelp marker, a C1 control, a line separator, and the empty string. `plain`
/// repeats, so the answer shows it once. (The reference also lists a lone surrogate, which a Rust
/// string cannot hold.)
pub fn modes() -> Vec<String> {
    [
        "plain",
        "$(touch sentinel)",
        "`touch sentinel`",
        ";touch sentinel",
        "a\nb",
        "c\td",
        "_activeHelp_ x",
        "f\u{9b}",
        "g\u{2028}",
        "",
        "plain",
    ]
    .iter()
    .map(|mode| (*mode).to_owned())
    .collect()
}

/// The reference's completion fixture application `kit`, with `--help` declared by hand because
/// the help plugin is not part of this feature set.
pub fn kit() -> Application<NoInputs, NoResult, Group> {
    let paths = Command::new("paths")
        .description("Walk\tall paths.")
        .option(
            "format",
            Opt::string()
                .description("The view.")
                .short('f')
                .validate(shaped(["json", "jsonl", "table"])),
        )
        .option("field", Opt::string().description("A field.").multiple())
        .option("quiet", Opt::boolean().description("Say less.").short('q'))
        .option("secret", Opt::boolean().description("Secret.").hidden())
        .option(
            "legacy",
            Opt::boolean()
                .description("Legacy.")
                .deprecated("Use --format."),
        )
        .action(nothing);
    let mode_values = modes();
    let keys = Command::new("keys")
        .description("List keys.")
        .alias("ls")
        .argument(
            "mode",
            Arg::string()
                .description("The mode.")
                .validate(Shaped(json!({ "enum": mode_values }))),
        )
        .action(nothing);
    let fetch = Command::new("fetch")
        .description("Fetch.")
        .deprecated("Use keys instead.")
        .option("deep", Opt::boolean().description("Deep."))
        .action(nothing);
    let debug = Command::new("debug")
        .description("Debug.")
        .hidden()
        .option("dump", Opt::boolean().description("Dump."))
        .action(nothing);
    let odd = Command::new("odd")
        .description("Odd.")
        .hidden()
        .command(
            Command::new("values")
                .description("Values.")
                .argument(
                    "value",
                    Arg::string().description("The value.").validate(shaped([
                        "$(touch sentinel)a",
                        "$(touch sentinel)b",
                        "a b1",
                        "a b2",
                        "p\\q",
                        "r\\:s",
                        "a=~root",
                        "x:~root",
                        "b=~root1",
                        "b=~root2",
                    ])),
                )
                .action(nothing),
        )
        .command(
            Command::new("colon")
                .description("One: two \\ three.")
                .action(nothing),
        );
    let backups = Command::new("backups")
        .description("Backups.")
        .hidden()
        .argument(
            "target",
            Arg::string()
                .description("The target.")
                .validate(shaped(["disk", "tape"])),
        )
        .option(
            "backup",
            Opt::string()
                .description("How to back up.")
                .implied("simple")
                .short('b')
                .validate(shaped(["none", "simple", "numbered"])),
        )
        .option("verbose", Opt::count().description("Say more.").short('v'))
        .action(nothing);
    let quotes = Command::new("quotes")
        .description("Quotes.")
        .hidden()
        .argument(
            "value",
            Arg::string()
                .description("The value.")
                .validate(shaped(["$(New-Item sentinel)", "it\u{2019}s"])),
        )
        .action(nothing);
    let cache = Command::new("cache")
        .description("\u{1}")
        .command(Command::new("clear").description("Clear.").action(nothing))
        .command(
            Command::new("list")
                .description("List entries.")
                .action(nothing),
        );
    let stats = Command::new("stats")
        .description("Stats.")
        .hidden()
        .command(
            Command::new("depth")
                .description("Depth.")
                .command(Command::new("max").description("Max.").action(nothing)),
        );
    Application::new("kit")
        .description("Completion fixture.")
        .plugins((completion(),))
        .global_option("file", Opt::string().description("The document."))
        .global_option(
            "color",
            Opt::boolean()
                .description("Color output.")
                .polarity(Polarity::Both),
        )
        .global_option(
            "old",
            Opt::string().description("Old.").deprecated("Use --file."),
        )
        .global_option("trace", Opt::boolean().description("Trace.").hidden())
        .global_option(
            "help",
            Opt::boolean().description("Show this help.").short('h'),
        )
        .command(paths)
        .command(keys)
        .command(fetch)
        .command(debug)
        .command(cache)
        .command(odd)
        .command(quotes)
        .command(backups)
        .command(stats)
}

/// What a run on the mock process left.
#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

/// Runs `kit ...argv` on a mock process with the facts it is given.
pub async fn run_on<I, R, S>(
    application: &Application<I, R, S>,
    argv: &[&str],
    fields: MockFields,
) -> Ran
where
    I: 'static,
    R: 'static,
    S: loomcli_core::State,
{
    let process = mock_process(fields.argv(argv.iter().map(|word| (*word).to_owned())));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// Runs `kit ...argv`.
pub async fn run_kit(argv: &[&str]) -> Ran {
    run_on(&kit(), argv, MockFields::new()).await
}

/// The answer `__complete` writes for the words after the application name.
pub async fn complete(words: &[&str]) -> String {
    let mut argv = vec!["completion", "__complete", "--"];
    argv.extend_from_slice(words);
    let ran = run_kit(&argv).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""), "{ran:?}");
    ran.stdout
}

/// Lines joined as the answer frames them: each ends with a newline, the directive last.
pub fn framed(lines: &[&str], directive: u8) -> String {
    let mut text: String = lines.iter().map(|line| format!("{line}\n")).collect();
    text.push_str(&format!(":{directive}\n"));
    text
}

/// A temporary folder under the system's temporary folder, made writable again and removed when it
/// drops, so a case that took write access away cleans up.
pub struct TempDir {
    pub path: std::path::PathBuf,
}

impl TempDir {
    pub fn new(prefix: &str) -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "{prefix}-{}-{}-{nanos}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

/// Makes every folder under a root writable and readable again.
pub fn chmod_tree(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return;
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644));
        return;
    }
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            chmod_tree(&entry.path());
        }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        chmod_tree(&self.path);
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
