//! The dotenv plugin, ported from the reference's `dotenv.test.ts`: the layered files and their
//! precedence, the mode, the file format, references, warnings, and the allow and deny lists, end
//! to end through `Application::run` on the mock process with a temporary working directory.

#![cfg(feature = "dotenv")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Child, Context, Done, Env, ExitCode, InputStream, InvocationOutcome,
    InvocationValues, InvokeOptions, Libc, NoInputs, NoResult, Opt, OutputStream, ProcessHandle,
    ProcessTerminal, ReleaseFacts, RunOptions, SignalSource, SpawnRequest,
};
use loomcli_plugins::dotenv::{Dotenv, dotenv};
use loomcli_testing::{MockFields, MockProcess, mock_process};
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Done>;

/// A list of file names and their text.
type Files = Vec<(&'static str, &'static str)>;

/// A fresh working directory, removed when the case ends.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let number = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let root = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("loomcli-dotenv-{}-{number}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// The settings most cases install: an allow list, so an unlisted name shows what it leaves out.
const LISTED: [&str; 6] = ["TOKEN", "ALT", "EMPTY", "SET", "NEXT", "ENABLED"];

/// How a case's plugin is configured.
#[derive(Clone)]
enum Settings {
    Only(Vec<&'static str>),
    Except(Vec<&'static str>),
    None,
}

impl Settings {
    fn listed() -> Self {
        Settings::Only(LISTED.to_vec())
    }
}

/// What a case states beyond its files.
struct Case {
    files: Vec<(&'static str, &'static str)>,
    env: Vec<(&'static str, &'static str)>,
    names: Vec<&'static str>,
    settings: Settings,
    directory: Option<&'static str>,
    unreadable: Option<&'static str>,
}

impl Case {
    fn files(files: &[(&'static str, &'static str)]) -> Self {
        Case {
            files: files.to_vec(),
            env: Vec::new(),
            names: vec![
                "TOKEN", "ALT", "EMPTY", "SET", "NEXT", "ENABLED", "UNLISTED",
            ],
            settings: Settings::listed(),
            directory: None,
            unreadable: None,
        }
    }

    fn env(mut self, env: &[(&'static str, &'static str)]) -> Self {
        self.env = env.to_vec();
        self
    }

    fn names(mut self, names: &[&'static str]) -> Self {
        self.names = names.to_vec();
        self
    }

    fn settings(mut self, settings: Settings) -> Self {
        self.settings = settings;
        self
    }
}

/// The application: it prints the names of `names` that its environment holds, and the three
/// env-bound options it reads.
fn application(names: Vec<&'static str>, settings: Settings) -> App {
    let plugin: Dotenv<_> = dotenv();
    let plugins = match settings {
        Settings::None => vec![plugin.plugin()],
        Settings::Only(list) => vec![dotenv().only(list).plugin()],
        Settings::Except(list) => vec![dotenv().except(list).plugin()],
    };
    Application::new("app")
        .description("Read a dotenv file.")
        .plugins(plugins)
        .option(
            "token",
            Opt::string()
                .default("fallback")
                .description("The token.")
                .env(["TOKEN", "ALT"]),
        )
        .option(
            "prefix",
            Opt::string()
                .default("fallback")
                .description("The prefix.")
                .env(["PREFIX"])
                .env_allow_empty(),
        )
        .option(
            "enabled",
            Opt::boolean()
                .description("Enable the feature.")
                .env(["ENABLED"]),
        )
        .action(move |ctx: Context| {
            let names = names.clone();
            async move {
                let env: BTreeMap<&str, &String> = names
                    .iter()
                    .filter_map(|name| ctx.host.env.get(*name).map(|value| (*name, value)))
                    .collect();
                let token: Option<String> = ctx.option("token")?;
                let prefix: Option<String> = ctx.option("prefix")?;
                let report = json!({
                    "env": env,
                    "options": { "token": token, "prefix": prefix },
                });
                ctx.out.print(&report.to_string()).await
            }
        })
}

/// What one run wrote.
struct Ran {
    code: u8,
    stdout: String,
    stderr: String,
}

impl Ran {
    fn env(&self) -> Value {
        match self.stdout.as_str() {
            "" => json!({}),
            text => serde_json::from_str::<Value>(text).unwrap()["env"].clone(),
        }
    }

    fn option(&self, name: &str) -> Value {
        serde_json::from_str::<Value>(&self.stdout).unwrap()["options"][name].clone()
    }
}

fn prepare(case: &Case) -> (Scratch, MockFields) {
    let scratch = Scratch::new();
    for (name, text) in &case.files {
        fs::write(scratch.0.join(name), text).unwrap();
    }
    if let Some(directory) = case.directory {
        fs::create_dir(scratch.0.join(directory)).unwrap();
    }
    #[cfg(unix)]
    if let Some(name) = case.unreadable {
        // A symbolic link to itself cannot be opened.
        std::os::unix::fs::symlink(name, scratch.0.join(name)).unwrap();
    }
    let mut fields = MockFields::new().cwd(scratch.0.clone());
    for (name, value) in &case.env {
        fields = fields.env(name, value);
    }
    (scratch, fields)
}

async fn run_case(case: Case) -> Ran {
    let (_scratch, fields) = prepare(&case);
    let process = mock_process(fields);
    let code = application(case.names.clone(), case.settings.clone())
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        code: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// The `.env` file alone.
async fn run_text(text: &'static str) -> Ran {
    run_case(Case::files(&[(".env", text)])).await
}

fn warning(name: &str, line: usize, file: &str) -> String {
    format!(
        "\u{26a0} Skipped {name} on line {line} of {file}: the line is not a valid assignment. Correct the line, or remove it.\n"
    )
}

fn env_warning(name: &str, line: usize) -> String {
    warning(name, line, ".env")
}

// Settings

#[tokio::test]
async fn dotenv_with_no_settings_imports_every_variable_the_file_defines_that_the_process_has_not_set()
 {
    let ran = run_case(
        Case::files(&[(".env", "TOKEN=file\nUNLISTED=also\nSET=replace\n")])
            .env(&[("SET", "shell")])
            .names(&["TOKEN", "UNLISTED", "SET"])
            .settings(Settings::None),
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        ran.env(),
        json!({"SET": "shell", "TOKEN": "file", "UNLISTED": "also"})
    );
    assert_eq!(ran.option("token"), "file");
}

#[tokio::test]
async fn an_except_list_imports_every_variable_but_the_ones_it_lists() {
    let ran = run_case(
        Case::files(&[(".env", "TOKEN=file\nUNLISTED=hidden\n")])
            .settings(Settings::Except(vec!["UNLISTED"])),
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(ran.env(), json!({"TOKEN": "file"}));
}

#[tokio::test]
async fn a_malformed_assignment_warns_only_when_the_plugin_would_import_its_name() {
    let cases = [
        ("no settings", Settings::None, env_warning("OTHER", 1)),
        (
            "an only list that leaves the name out",
            Settings::Only(vec!["NEXT"]),
            String::new(),
        ),
        (
            "an except list that names it",
            Settings::Except(vec!["OTHER"]),
            String::new(),
        ),
        (
            "an except list that leaves it out",
            Settings::Except(vec!["TOKEN"]),
            env_warning("OTHER", 1),
        ),
    ];
    for (name, settings, stderr) in cases {
        let ran =
            run_case(Case::files(&[(".env", "OTHER no-equals\nNEXT=ok\n")]).settings(settings))
                .await;
        assert_eq!((ran.code, ran.stderr.clone()), (0, stderr), "{name}");
        assert_eq!(ran.env(), json!({"NEXT": "ok"}), "{name}");
    }
}

#[tokio::test]
async fn an_only_list_imports_only_the_variables_it_lists_and_supplies_an_env_bound_option() {
    let ran = run_text("TOKEN=from-file\nUNLISTED=ignored\n").await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(ran.env(), json!({"TOKEN": "from-file"}));
    assert_eq!(ran.option("token"), "from-file");
}

#[tokio::test]
async fn existing_empty_values_block_dotenv_while_ordered_environment_bindings_can_fall_through() {
    let ran = run_case(
        Case::files(&[(
            ".env",
            "TOKEN=file\nALT=alternate\nEMPTY=refill\nSET=replace\n",
        )])
        .env(&[("EMPTY", ""), ("SET", "shell"), ("TOKEN", "")]),
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        ran.env(),
        json!({"ALT": "alternate", "EMPTY": "", "SET": "shell", "TOKEN": ""})
    );
    assert_eq!(ran.option("token"), "alternate");
    let blocked = run_case(Case::files(&[(".env", "TOKEN=file\n")]).env(&[("TOKEN", "")])).await;
    assert_eq!(blocked.option("token"), "fallback");
}

#[tokio::test]
async fn a_files_empty_assignment_supplies_an_option_whose_binding_allows_an_empty_value() {
    let case = |text, env: &[(&'static str, &'static str)]| {
        Case::files(&[(".env", text)])
            .env(env)
            .names(&["PREFIX"])
            .settings(Settings::Only(vec!["PREFIX"]))
    };
    let from_file = run_case(case("PREFIX=\n", &[])).await;
    assert_eq!((from_file.code, from_file.stderr.as_str()), (0, ""));
    assert_eq!(from_file.env(), json!({"PREFIX": ""}));
    assert_eq!(from_file.option("prefix"), "");
    // A process's own empty variable wins over the file and supplies the empty string too.
    let from_process = run_case(case("PREFIX=file\n", &[("PREFIX", "")])).await;
    assert_eq!(from_process.option("prefix"), "");
    // Without the assignment the default applies.
    let absent = run_case(case("OTHER=1\n", &[])).await;
    assert_eq!(absent.option("prefix"), "fallback");
}

#[tokio::test]
async fn an_invalid_imported_option_value_reports_the_environment_variable_without_dotenv_provenance()
 {
    let ran = run_text("ENABLED=secret-value\n").await;
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("(from ENABLED)"), "{}", ran.stderr);
    assert!(!ran.stderr.contains(".env"), "{}", ran.stderr);
    assert!(!ran.stderr.contains("secret-value"), "{}", ran.stderr);
}

#[tokio::test]
async fn warnings_use_physical_starting_lines_and_occur_once_per_malformed_assignment() {
    let ran =
        run_text("# comment\r\nOTHER=\"a\r\nb\"\r\nTOKEN no-equals\r\nNEXT=\"bad\" trailing\r\n")
            .await;
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stderr,
        env_warning("TOKEN", 4) + &env_warning("NEXT", 5)
    );
}

#[tokio::test]
async fn a_named_run_captures_warnings_and_writes_to_neither_stream() {
    let (_scratch, fields) = prepare(&Case::files(&[(".env", "TOKEN=file\nNEXT bad\n")]));
    let process = mock_process(fields);
    let outcome = application(
        vec![
            "TOKEN", "ALT", "EMPTY", "SET", "NEXT", "ENABLED", "UNLISTED",
        ],
        Settings::listed(),
    )
    .invoke(
        &[],
        InvocationValues::new(),
        InvokeOptions::new(),
        Some(Arc::clone(&process) as Arc<dyn ProcessHandle>),
    )
    .await;
    assert_eq!(
        (process.stdout_text(), process.stderr_text()),
        (String::new(), String::new())
    );
    assert_eq!(process.exit_code(), None);
    let InvocationOutcome::Completed {
        output, messages, ..
    } = outcome
    else {
        panic!("the named run completed");
    };
    assert_eq!(
        messages,
        "\u{26a0} Skipped NEXT on line 2 of .env: the line is not a valid assignment. Correct the line, or remove it.\n"
    );
    let report: Value = serde_json::from_str(&output).unwrap();
    assert_eq!(report["options"]["token"], "file");
}

// Malformed assignments

#[tokio::test]
async fn dotenv_warns_without_values_and_recovers_from_each_malformed_form() {
    let cases: [(&str, &'static str, Value); 6] = [
        (
            "missing equals",
            "TOKEN secret-value\nNEXT=ok\n",
            json!({"NEXT": "ok"}),
        ),
        (
            "bare export",
            "export TOKEN\nNEXT=ok\n",
            json!({"NEXT": "ok"}),
        ),
        (
            "unterminated single quote",
            "TOKEN='secret-value\nNEXT=hidden\n",
            json!({}),
        ),
        (
            "unterminated double quote",
            "TOKEN=\"secret-value\nNEXT=hidden\n",
            json!({}),
        ),
        (
            "trailing text",
            "TOKEN=\"value\" secret-value\nNEXT=ok\n",
            json!({"NEXT": "ok"}),
        ),
        (
            "NUL",
            "TOKEN=secret-value\0\nNEXT=ok\n",
            json!({"NEXT": "ok"}),
        ),
    ];
    for (name, content, env) in cases {
        let ran = run_text(content).await;
        assert_eq!(
            (ran.code, ran.stderr.as_str()),
            (0, env_warning("TOKEN", 1).as_str()),
            "{name}"
        );
        assert_eq!(ran.env(), env, "{name}");
        assert!(!ran.stderr.contains("secret-value"), "{name}");
    }
}

#[tokio::test]
async fn a_malformed_duplicate_does_not_erase_a_valid_value_and_warns_even_when_the_environment_holds_the_name()
 {
    let ran = run_case(
        Case::files(&[(".env", "TOKEN=first\nTOKEN=\"secret-value\" trailing\n")])
            .env(&[("TOKEN", "shell")]),
    )
    .await;
    assert_eq!((ran.code, ran.stderr.clone()), (0, env_warning("TOKEN", 2)));
    assert_eq!(ran.env(), json!({"TOKEN": "shell"}));
    assert_eq!(ran.option("token"), "shell");
    let duplicate = run_text("TOKEN=first\nTOKEN=bad\0\n").await;
    assert_eq!(duplicate.stderr, env_warning("TOKEN", 2));
    assert_eq!(duplicate.env(), json!({"TOKEN": "first"}));
}

#[tokio::test]
async fn unlisted_malformed_lines_and_names_that_only_resemble_an_allowlisted_name_stay_silent() {
    let ran = run_text(
        "OTHER no-equals\nTOKEN-TYPO=secret-value\nTOKEN_OTHER\n# TOKEN invalid\nNEXT=ok\n",
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(ran.env(), json!({"NEXT": "ok"}));
    let unclosed = run_text("OTHER=\"secret-value\nTOKEN=hidden\n").await;
    assert_eq!((unclosed.code, unclosed.stderr.as_str()), (0, ""));
    assert_eq!(unclosed.env(), json!({}));
}

#[tokio::test]
async fn missing_files_and_env_directories_are_silent() {
    let missing = run_case(Case::files(&[])).await;
    assert_eq!((missing.code, missing.stderr.as_str()), (0, ""));
    assert_eq!(missing.option("token"), "fallback");
    let mut directory = Case::files(&[]);
    directory.directory = Some(".env");
    let directory = run_case(directory).await;
    assert_eq!((directory.code, directory.stderr.as_str()), (0, ""));
}

#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_file_warns_once() {
    let mut case = Case::files(&[]);
    case.unreadable = Some(".env");
    let ran = run_case(case).await;
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stderr,
        "\u{26a0} Skipped .env: the file could not be read. Make it readable, or remove it.\n"
    );
    assert_eq!(ran.env(), json!({}));
}

// The file format

#[tokio::test]
async fn dotenv_parses_each_form_of_a_value() {
    let cases: [(&str, &'static str, &str); 13] = [
        (
            "BOM, export, whitespace, and CRLF",
            "\u{feff} \texport\t TOKEN \t= \t value \t # comment\r\n",
            "value",
        ),
        ("empty assignment", "TOKEN=\n", ""),
        (
            "single quotes are literal",
            "TOKEN='  a\\n${HOME}#b  '\n",
            "  a\\n${HOME}#b  ",
        ),
        (
            "multiline single quotes",
            "TOKEN='a\r\n\\n \"b\"\r\nc' # comment\r\n",
            "a\n\\n \"b\"\nc",
        ),
        (
            "double quote escapes",
            "TOKEN=\"a\\nb\\rc\\td\\\"e\\\\f\"\n",
            "a\nb\rc\td\"e\\f",
        ),
        (
            "multiline double quotes",
            "TOKEN=\"a\r\nb\r\nc\" # comment\r\n",
            "a\nb\nc",
        ),
        (
            "unknown escapes stay literal and \\$ is a dollar",
            "TOKEN=\"a\\qb\\$c\"\n",
            "a\\qb$c",
        ),
        (
            "backslash before a physical newline",
            "TOKEN=\"a\\\nb\"\n",
            "a\\\nb",
        ),
        (
            "an embedded hash ends an unquoted value",
            "TOKEN=a#b # comment\n",
            "a",
        ),
        ("a quoted hash stays", "TOKEN=\"a#b\" # comment\n", "a#b"),
        ("comment as the value", "TOKEN=# comment\n", ""),
        ("quotes within unquoted text", "TOKEN=a\"b'c\n", "a\"b'c"),
        (
            "last valid assignment wins",
            "TOKEN=first\nTOKEN=last\n",
            "last",
        ),
    ];
    for (name, content, value) in cases {
        let ran = run_text(content).await;
        assert_eq!((ran.code, ran.stderr.as_str()), (0, ""), "{name}");
        assert_eq!(ran.env(), json!({"TOKEN": value}), "{name}");
    }
}

#[tokio::test]
async fn a_single_quoted_private_key_spans_its_lines_as_one_value_and_no_line_of_it_becomes_a_name()
{
    let key = [
        "-----BEGIN PRIVATE KEY-----",
        "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7xyzSECRETabc",
        "AbcDefGhiJklMnoPqrStuVwxYz0123456789secretPartTwo==",
        "-----END PRIVATE KEY-----",
    ]
    .join("\n");
    let text: &'static str =
        Box::leak(format!("PRIVATE_KEY='{key}'\nDB_URL=postgres://x\n").into_boxed_str());
    let ran = run_case(
        Case::files(&[(".env", text)])
            .names(&[
                "PRIVATE_KEY",
                "DB_URL",
                "AbcDefGhiJklMnoPqrStuVwxYz0123456789secretPartTwo",
            ])
            .settings(Settings::None),
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        ran.env(),
        json!({"DB_URL": "postgres://x", "PRIVATE_KEY": key})
    );
}

#[tokio::test]
async fn an_unterminated_single_quote_consumes_the_rest_of_the_file_and_warns_once_for_its_line() {
    let ran = run_case(
        Case::files(&[(".env", "TOKEN='secret-value\nNEXT=hidden\nMIIsecret==\n")])
            .settings(Settings::None),
    )
    .await;
    assert_eq!((ran.code, ran.stderr.clone()), (0, env_warning("TOKEN", 1)));
    assert_eq!(ran.env(), json!({}));
    assert!(!ran.stderr.contains("secret"));
}

#[tokio::test]
async fn unlisted_multiline_assignments_cannot_introduce_allowlisted_assignments_from_their_contents()
 {
    let ran = run_text("UNLISTED=\"first\nTOKEN=hidden\nlast\"\nNEXT=visible\n").await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(ran.env(), json!({"NEXT": "visible"}));
}

#[tokio::test]
async fn non_lf_characters_remain_inside_quoted_values_and_comments() {
    for separator in ["\u{2028}", "\u{2029}", "\r"] {
        let text: &'static str = Box::leak(
            format!(
                "OTHER=\"hello{separator}world\nTOKEN=hidden\nend\"\nNEXT=\"visible{separator}text\" # comment{separator}tail\n"
            )
            .into_boxed_str(),
        );
        let ran = run_text(text).await;
        assert_eq!((ran.code, ran.stderr.as_str()), (0, ""), "{separator:?}");
        assert_eq!(
            ran.env(),
            json!({"NEXT": format!("visible{separator}text")}),
            "{separator:?}"
        );
    }
}

// Layers

const PRODUCTION: [(&str, &str); 1] = [("NODE_ENV", "production")];

/// The names every file defines, read with every name imported.
async fn read_layers(
    files: &[(&'static str, &'static str)],
    env: &[(&'static str, &'static str)],
) -> Ran {
    run_case(
        Case::files(files)
            .env(env)
            .names(&["TOKEN", "ALT", "NEXT"])
            .settings(Settings::None),
    )
    .await
}

#[tokio::test]
async fn the_more_specific_file_wins() {
    let cases: [(&str, Files, &str); 5] = [
        (
            ".env.<mode> over .env",
            vec![(".env", "TOKEN=base"), (".env.production", "TOKEN=mode")],
            "mode",
        ),
        (
            ".env.local over .env.<mode>",
            vec![
                (".env.local", "TOKEN=local"),
                (".env.production", "TOKEN=mode"),
            ],
            "local",
        ),
        (
            ".env.<mode>.local over .env.local",
            vec![
                (".env.local", "TOKEN=local"),
                (".env.production.local", "TOKEN=both"),
            ],
            "both",
        ),
        (
            ".env.local over .env",
            vec![(".env", "TOKEN=base"), (".env.local", "TOKEN=local")],
            "local",
        ),
        (
            "the most specific of all four",
            vec![
                (".env", "TOKEN=base"),
                (".env.local", "TOKEN=local"),
                (".env.production", "TOKEN=mode"),
                (".env.production.local", "TOKEN=both"),
            ],
            "both",
        ),
    ];
    for (name, files, value) in cases {
        let ran = read_layers(&files, &PRODUCTION).await;
        assert_eq!((ran.code, ran.stderr.as_str()), (0, ""), "{name}");
        assert_eq!(ran.env(), json!({"TOKEN": value}), "{name}");
    }
}

#[tokio::test]
async fn each_layered_file_contributes_the_names_the_others_leave_unset() {
    let ran = read_layers(
        &[
            (".env", "TOKEN=base\nALT=base\nNEXT=base"),
            (".env.local", "ALT=local"),
            (".env.production", "NEXT=mode"),
        ],
        &PRODUCTION,
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        ran.env(),
        json!({"ALT": "local", "NEXT": "mode", "TOKEN": "base"})
    );
}

#[tokio::test]
async fn a_variable_the_environment_holds_beats_every_file_empty_included() {
    let files = [
        (".env", "TOKEN=base"),
        (".env.production.local", "TOKEN=both\nALT=both"),
    ];
    let shell = read_layers(&files, &[("NODE_ENV", "production"), ("TOKEN", "shell")]).await;
    assert_eq!(shell.env(), json!({"ALT": "both", "TOKEN": "shell"}));
    let empty = read_layers(&files, &[("NODE_ENV", "production"), ("TOKEN", "")]).await;
    assert_eq!(empty.env(), json!({"ALT": "both", "TOKEN": ""}));
}

#[tokio::test]
async fn with_no_mode_the_plugin_reads_env_and_env_local_alone() {
    let files = [
        (".env", "TOKEN=base\nALT=base\nNEXT=base"),
        (".env.", "ALT=dot"),
        (".env.development", "NEXT=development"),
        (".env.local", "TOKEN=local"),
        (".env.local.local", "NEXT=twice"),
    ];
    for (name, env) in [("unset", vec![]), ("empty", vec![("NODE_ENV", "")])] {
        let ran = read_layers(&files, &env).await;
        assert_eq!((ran.code, ran.stderr.as_str()), (0, ""), "{name}");
        assert_eq!(
            ran.env(),
            json!({"ALT": "base", "NEXT": "base", "TOKEN": "local"}),
            "{name}"
        );
    }
}

#[tokio::test]
async fn the_mode_is_read_as_written_and_a_file_for_another_mode_is_not_read() {
    // The test creates the files in one case only, so a case-insensitive file system cannot
    // change a result: the two modes name different files.
    let files = [
        (".env", "TOKEN=base"),
        (".env.Production", "TOKEN=cased"),
        (".env.staging", "ALT=x"),
    ];
    let cased = read_layers(&files, &[("NODE_ENV", "Production")]).await;
    assert_eq!(cased.env(), json!({"TOKEN": "cased"}));
    let other = read_layers(&files, &[("NODE_ENV", "qa")]).await;
    assert_eq!(other.env(), json!({"TOKEN": "base"}));
}

#[tokio::test]
async fn under_the_test_mode_the_plugin_skips_env_local_and_reads_the_other_three() {
    let ran = read_layers(
        &[
            (".env", "TOKEN=base\nALT=base\nNEXT=base"),
            (".env.local", "TOKEN=local\nALT=local\nNEXT=local"),
            (".env.test", "ALT=mode\nNEXT=mode"),
            (".env.test.local", "NEXT=both"),
        ],
        &[("NODE_ENV", "test")],
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        ran.env(),
        json!({"ALT": "mode", "NEXT": "both", "TOKEN": "base"})
    );
}

#[tokio::test]
async fn a_file_the_mode_names_twice_is_read_once_at_its_more_specific_place() {
    let ran = read_layers(
        &[
            (".env", "TOKEN=base"),
            (".env.local", "TOKEN=local\nBAD no-equals"),
            (".env.local.local", "ALT=deep"),
        ],
        &[("NODE_ENV", "local")],
    )
    .await;
    assert_eq!(ran.code, 0);
    assert_eq!(ran.stderr, warning("BAD", 2, ".env.local"));
    assert_eq!(ran.env(), json!({"ALT": "deep", "TOKEN": "local"}));
}

#[tokio::test]
async fn a_variable_a_file_defines_never_chooses_the_mode_the_plugin_reads() {
    let ran = run_case(
        Case::files(&[
            (".env", "NODE_ENV=production\nTOKEN=base"),
            (".env.production", "TOKEN=mode"),
        ])
        .names(&["NODE_ENV", "TOKEN"])
        .settings(Settings::None),
    )
    .await;
    assert_eq!(
        ran.env(),
        json!({"NODE_ENV": "production", "TOKEN": "base"})
    );
}

#[tokio::test]
async fn a_malformed_assignment_in_one_file_never_erases_a_valid_one_in_another() {
    let ran = read_layers(
        &[
            (".env", "TOKEN=base"),
            (".env.production", "TOKEN no-equals\nALT=mode"),
        ],
        &PRODUCTION,
    )
    .await;
    assert_eq!(ran.code, 0);
    assert_eq!(ran.stderr, warning("TOKEN", 1, ".env.production"));
    assert_eq!(ran.env(), json!({"ALT": "mode", "TOKEN": "base"}));
}

#[tokio::test]
async fn warnings_name_their_file_and_come_in_the_order_the_plugin_reads_the_files() {
    let ran = read_layers(
        &[
            (".env", "TOKEN no-equals"),
            (".env.local", "ALT no-equals"),
            (".env.production", "NEXT no-equals"),
            (".env.production.local", "TOKEN=\"a\" trailing"),
        ],
        &PRODUCTION,
    )
    .await;
    assert_eq!(
        ran.stderr,
        warning("TOKEN", 1, ".env.production.local")
            + &warning("ALT", 1, ".env.local")
            + &warning("NEXT", 1, ".env.production")
            + &warning("TOKEN", 1, ".env")
    );
}

#[tokio::test]
async fn a_layered_file_that_is_missing_is_silent() {
    let ran = run_case(
        Case::files(&[(".env", "TOKEN=base")])
            .env(&PRODUCTION)
            .settings(Settings::None),
    )
    .await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(ran.env(), json!({"TOKEN": "base"}));
}

#[tokio::test]
async fn a_directory_at_a_layered_name_is_silent_while_the_other_files_contribute() {
    let mut case = Case::files(&[(".env", "TOKEN=base"), (".env.production", "ALT=mode")])
        .env(&PRODUCTION)
        .settings(Settings::None);
    case.directory = Some(".env.local");
    let ran = run_case(case).await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    assert_eq!(ran.env(), json!({"ALT": "mode", "TOKEN": "base"}));
}

#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_layered_file_warns_once_with_its_name_while_the_other_files_contribute() {
    let mut case = Case::files(&[(".env", "TOKEN=base"), (".env.production", "ALT=mode")])
        .env(&PRODUCTION)
        .names(&["TOKEN", "ALT", "NEXT"])
        .settings(Settings::None);
    case.unreadable = Some(".env.local");
    let ran = run_case(case).await;
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stderr,
        "\u{26a0} Skipped .env.local: the file could not be read. Make it readable, or remove it.\n"
    );
    assert_eq!(ran.env(), json!({"ALT": "mode", "TOKEN": "base"}));
}

#[tokio::test]
async fn an_allow_list_and_a_deny_list_apply_to_every_layered_file() {
    let files = [
        (".env", "TOKEN=base\nNEXT=base"),
        (".env.production", "TOKEN=mode\nNEXT=mode"),
    ];
    let only = run_case(
        Case::files(&files)
            .env(&PRODUCTION)
            .settings(Settings::Only(vec!["TOKEN"])),
    )
    .await;
    assert_eq!(only.env(), json!({"TOKEN": "mode"}));
    let except = run_case(
        Case::files(&files)
            .env(&PRODUCTION)
            .settings(Settings::Except(vec!["TOKEN"])),
    )
    .await;
    assert_eq!(except.env(), json!({"NEXT": "mode"}));
}

// References

#[tokio::test]
async fn a_value_expands_its_references() {
    let cases: [(&str, &'static str, &str); 31] = [
        ("$NAME", "ALT=x\nTOKEN=a-$ALT-b", "a-x-b"),
        ("${NAME}", "ALT=x\nTOKEN=a${ALT}b", "axb"),
        (
            "a name that ends at a non-name character",
            "ALT=x\nTOKEN=$ALT.$ALT/",
            "x.x/",
        ),
        (
            "an unset name reads empty",
            "TOKEN=a${MISSING}b$MISSING",
            "ab",
        ),
        (
            "${NAME:-default} for an unset name",
            "TOKEN=${MISSING:-fallback}",
            "fallback",
        ),
        (
            "${NAME:-default} for a set name",
            "ALT=x\nTOKEN=${ALT:-fallback}",
            "x",
        ),
        (
            "an empty value is a value",
            "ALT=\nTOKEN=${ALT:-fallback}",
            "",
        ),
        (
            "a default holding a reference",
            "ALT=x\nTOKEN=${MISSING:-<${ALT}>}",
            "<x>",
        ),
        (
            "a default holding a nested default",
            "TOKEN=${A:-${B:-deep}}end",
            "deepend",
        ),
        (
            "an escaped dollar inside a default",
            "TOKEN=${MISSING:-\\${}",
            "${",
        ),
        (
            "a double-quoted value",
            "ALT=x\nTOKEN=\"a $ALT ${ALT}\\n\"",
            "a x x\n",
        ),
        (
            "a multiline double-quoted value",
            "ALT=x\nTOKEN=\"$ALT\n${ALT}\"",
            "x\nx",
        ),
        (
            "single quotes stay literal",
            "ALT=x\nTOKEN='$ALT ${ALT} ${ALT:-d} \\$'",
            "$ALT ${ALT} ${ALT:-d} \\$",
        ),
        (
            "\\$ is a dollar when unquoted",
            "ALT=x\nTOKEN=\\$ALT-\\${ALT}",
            "$ALT-${ALT}",
        ),
        (
            "\\$ is a dollar in double quotes",
            "ALT=x\nTOKEN=\"\\$ALT \\\\$ALT\"",
            "$ALT \\x",
        ),
        (
            "another backslash is no escape when unquoted",
            "ALT=x\nTOKEN=a\\n\\x",
            "a\\n\\x",
        ),
        (
            "$(command) stays literal",
            "TOKEN=$(echo hi) and `x`",
            "$(echo hi) and `x`",
        ),
        (
            "a dollar before a non-name character",
            "TOKEN=a$ b$",
            "a$ b$",
        ),
        ("an unclosed ${", "ALT=x\nTOKEN=${ALT", "${ALT"),
        (
            "${ with neither a name nor a default",
            "TOKEN=${a b} ${} ${-x}",
            "${a b} ${} ${-x}",
        ),
        (
            "a failed ${ keeps the references inside it literal",
            "ALT=x\nTOKEN=${A$ALT} ${$ALT}-$ALT",
            "${A$ALT} ${$ALT}-x",
        ),
        (
            "an unclosed ${ keeps the references after it literal",
            "ALT=x\nTOKEN=${A$ALT",
            "${A$ALT",
        ),
        (
            "a name that starts with a digit",
            "TOKEN=$1abc-${2:-d}",
            "-d",
        ),
        (
            "a reference does not scan its value again",
            "ALT='$TOKEN'\nTOKEN=$ALT",
            "$TOKEN",
        ),
        (
            "a reference to a later line reads empty",
            "TOKEN=[$ALT]\nALT=x",
            "[]",
        ),
        (
            "a reference reads the last assignment above it",
            "ALT=1\nALT=2\nTOKEN=$ALT\nALT=3",
            "2",
        ),
        (
            "a hash ends the value before its references",
            "ALT=x\nTOKEN=$ALT#${ALT}",
            "x",
        ),
        (
            "a non-ASCII character reads as itself",
            "ALT=x\nTOKEN=\u{e9}$ALT\u{1f600}",
            "\u{e9}x\u{1f600}",
        ),
        (
            "a trailing backslash is a plain backslash",
            "TOKEN=a\\",
            "a\\",
        ),
        (
            "a nested default holding an escaped brace pair",
            "TOKEN=${A:-x\\${y}}",
            "x${y}",
        ),
        (
            "a closing brace outside a reference is plain",
            "ALT=x\nTOKEN=}${ALT}}",
            "}x}",
        ),
    ];
    for (name, content, value) in cases {
        let ran = run_case(
            Case::files(&[(".env", content)])
                .names(&["TOKEN", "ALT"])
                .settings(Settings::None),
        )
        .await;
        assert_eq!((ran.code, ran.stderr.as_str()), (0, ""), "{name}");
        assert_eq!(ran.env()["TOKEN"], value, "{name}");
    }
}

#[tokio::test]
async fn a_reference_reads_the_environment_first_and_never_expands_the_environment_value() {
    let ran = read_layers(
        &[
            (".env", "ALT=file\nTOKEN=$ALT-${NEXT}"),
            (".env.local", "NEXT=local"),
        ],
        &[("ALT", "$NEXT"), ("NEXT", "")],
    )
    .await;
    assert_eq!(
        ran.env(),
        json!({"ALT": "$NEXT", "NEXT": "", "TOKEN": "$NEXT-"})
    );
}

#[tokio::test]
async fn a_reference_reads_a_more_specific_file_and_never_a_less_specific_one() {
    let ran = read_layers(
        &[
            (".env", "ALT=base\nNEXT=base\nTOKEN=$ALT-$NEXT"),
            (".env.local", "ALT=local\nTOKEN=$ALT-$NEXT"),
        ],
        &[],
    )
    .await;
    assert_eq!(
        ran.env(),
        json!({"ALT": "local", "NEXT": "base", "TOKEN": "local-"})
    );
}

#[tokio::test]
async fn a_reference_reads_a_name_an_allow_list_keeps_the_plugin_from_importing() {
    let ran = run_case(
        Case::files(&[(".env", "SECRET=s3\nTOKEN=<$SECRET>\n")])
            .names(&["TOKEN", "SECRET"])
            .settings(Settings::Only(vec!["TOKEN"])),
    )
    .await;
    assert_eq!(ran.env(), json!({"TOKEN": "<s3>"}));
}

#[tokio::test]
async fn an_unquoted_value_ends_at_any_hash() {
    let cases: [(&str, &'static str, &str); 6] = [
        ("a hash after other text", "TOKEN=a#b\n", "a"),
        ("a hash that starts the value", "TOKEN=#b\n", ""),
        ("a hash after whitespace", "TOKEN=a #b\n", "a"),
        (
            "a URL fragment",
            "TOKEN=https://x.test/p#frag\n",
            "https://x.test/p",
        ),
        (
            "a quoted hash",
            "TOKEN=\"https://x.test/p#frag\"\n",
            "https://x.test/p#frag",
        ),
        ("a single-quoted hash", "TOKEN='a#b'\n", "a#b"),
    ];
    for (name, content, value) in cases {
        let ran = run_text(content).await;
        assert_eq!((ran.code, ran.stderr.as_str()), (0, ""), "{name}");
        assert_eq!(ran.env(), json!({"TOKEN": value}), "{name}");
    }
}

// Capability detection, publication, and the Bun-read values

#[tokio::test]
async fn output_capability_detection_reads_the_prepared_environment() {
    let files = [(".env", "FORCE_COLOR=1\n")];
    let mut written = Vec::new();
    for with_file in [false, true] {
        let case = Case::files(if with_file { &files } else { &[] });
        let (_scratch, fields) = prepare(&case);
        let process = mock_process(fields.env("TERM", "xterm"));
        let app: App = Application::new("app")
            .description("Print styled text.")
            .plugins((dotenv().only(["FORCE_COLOR"]).plugin(),))
            .action(|ctx: Context| async move {
                ctx.out.print(&ctx.style.bold().apply("colored")).await
            });
        let code = app
            .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
            .await;
        assert_eq!((code.get(), process.stderr_text()), (0, String::new()));
        written.push(process.stdout_text());
    }
    assert_eq!(written[1], "\u{1b}[1mcolored\u{1b}[22m\n");
    assert_eq!(written[0], "colored\n");
}

/// A process that answers as the mock does and records each variable the run publishes.
struct Recording {
    inner: Arc<MockProcess>,
    published: Mutex<Vec<(String, String)>>,
}

impl ProcessHandle for Recording {
    fn argv(&self) -> Vec<String> {
        self.inner.argv()
    }
    fn program(&self) -> Vec<String> {
        self.inner.program()
    }
    fn env(&self) -> Env {
        self.inner.env()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.inner.cwd()
    }
    fn home(&self) -> PathBuf {
        self.inner.home()
    }
    fn tmpdir(&self) -> PathBuf {
        self.inner.tmpdir()
    }
    fn platform(&self) -> String {
        self.inner.platform()
    }
    fn arch(&self) -> String {
        self.inner.arch()
    }
    fn libc(&self) -> Option<Libc> {
        self.inner.libc()
    }
    fn uid(&self) -> Option<u32> {
        self.inner.uid()
    }
    fn time_zone(&self) -> String {
        self.inner.time_zone()
    }
    fn release(&self) -> ReleaseFacts {
        self.inner.release()
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        self.inner.stdin()
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        self.inner.stdout()
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        self.inner.stderr()
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        self.inner.terminal()
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        self.inner.signals()
    }
    fn spawn(&self, request: SpawnRequest) -> Child {
        self.inner.spawn(request)
    }
    fn set_exit_code(&self, code: ExitCode) {
        self.inner.set_exit_code(code);
    }
    fn publish_env(&self, name: &str, value: &str) {
        self.published
            .lock()
            .unwrap()
            .push((name.to_owned(), value.to_owned()));
    }
}

fn recording(case: &Case) -> (Scratch, Arc<Recording>) {
    let (scratch, fields) = prepare(case);
    let handle = Arc::new(Recording {
        inner: mock_process(fields),
        published: Mutex::new(Vec::new()),
    });
    (scratch, handle)
}

#[tokio::test]
async fn an_ordinary_run_publishes_each_dotenv_addition_and_a_named_run_publishes_nothing() {
    let case = Case::files(&[(".env", "TOKEN=file\nNEXT=two\nSET=replace\n")])
        .env(&[("SET", "shell")])
        .names(&["TOKEN", "NEXT", "SET"]);
    let (_scratch, handle) = recording(&case);
    let code = application(case.names.clone(), Settings::listed())
        .run(RunOptions::new().process(Arc::clone(&handle) as Arc<dyn ProcessHandle>))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        *handle.published.lock().unwrap(),
        [
            ("NEXT".to_owned(), "two".to_owned()),
            ("TOKEN".to_owned(), "file".to_owned())
        ]
    );
    let (_scratch, named) = recording(&case);
    let outcome = application(case.names.clone(), Settings::listed())
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(Arc::clone(&named) as Arc<dyn ProcessHandle>),
        )
        .await;
    assert!(matches!(outcome, InvocationOutcome::Completed { .. }));
    assert!(named.published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_four_layered_files_of_adr_0125_give_the_values_bun_reads_in_production() {
    let case = Case::files(&[
        (".env", "TOKEN=base\nALT=base-$TOKEN\nNEXT=${TOKEN}#comment"),
        (".env.local", "ALT=local-${MISSING:-d}"),
        (".env.production", "TOKEN=mode"),
        (".env.production.local", "NEXT=\"both $TOKEN \\$\""),
    ])
    .env(&[("NODE_ENV", "production")])
    .names(&["TOKEN", "ALT", "NEXT"])
    .settings(Settings::None);
    let ran = run_case(case).await;
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    // `.env.production.local` is read first, so TOKEN is still unset when its NEXT expands.
    assert_eq!(
        ran.env(),
        json!({"TOKEN": "mode", "ALT": "local-d", "NEXT": "both  $"})
    );
}

// Declarations

fn panic_text(call: impl FnOnce()) -> String {
    let payload = catch_unwind(AssertUnwindSafe(call)).expect_err("the call panics");
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_owned())
        })
        .unwrap_or_default()
}

fn variable_name_diagnostic(setting: &str, finding: &str, caret: &str) -> String {
    format!(
        "-- INVALID DOTENV VARIABLE NAME ---------- @loomcli/plugins/dotenv/variable-name

Plugin \"@loomcli/plugins/dotenv\" setting \"{setting}\" lists a name that is not an environment variable name.

    {finding}
    {caret}

The dotenv plugin compares each name an only or except list holds with the names
the assignments in the dotenv files give, and an assignment names a variable
with a letter or underscore followed by letters, digits, or underscores. A
listed name of another form never matches, so the list would not do what it
says.

Name each variable with a letter or underscore followed by letters, digits, or underscores, such as API_TOKEN."
    )
}

#[test]
fn a_listed_name_that_is_not_a_variable_name_panics_with_the_diagnostic() {
    let only = panic_text(|| {
        let _ = dotenv().only(["TOKEN", "API-TOKEN"]);
    });
    assert_eq!(
        only,
        variable_name_diagnostic(
            "only",
            "dotenv().only([\"TOKEN\", \"API-TOKEN\"])",
            "                        ^^^^^^^^^^^"
        )
    );
    let except = panic_text(|| {
        let _ = dotenv().except(["1ABC"]);
    });
    assert_eq!(
        except,
        variable_name_diagnostic(
            "except",
            "dotenv().except([\"1ABC\"])",
            "                 ^^^^^^"
        )
    );
    let empty = panic_text(|| {
        let _ = dotenv().only([""]);
    });
    assert!(empty.contains("setting \"only\""), "{empty}");
}

#[test]
fn a_name_listed_twice_is_listed_once_and_valid_names_do_not_panic() {
    let _ = dotenv().only(["_A1", "_A1", "a"]).plugin();
    let _ = dotenv().except(Vec::<String>::new()).plugin();
}

#[cfg(feature = "verbose")]
#[path = "dotenv_support/lines.rs"]
mod lines;
