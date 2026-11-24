//! Registering the MCP server with an agent, ported from the reference's
//! `mcp-registration.test.ts`.
//!
//! Every case runs `jsonkit mcp <child>` on a mock process whose scripts stand for `claude` and
//! `codex`, with the installation record under a temporary `XDG_STATE_HOME`. A script that answers
//! an error stands for a CLI that cannot start. The cases assert the argv each agent receives, the
//! record's JSON, and the sentences of each lane.

#![cfg(feature = "mcp")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use loomcli_core::{Application, Build, ProcessHandle, ProcessSignal, ReleaseFacts, RunOptions};
use loomcli_plugins::mcp::mcp;
use loomcli_testing::{MockFields, MockProcess, ProgramAnswer, ProgramCall, mock_process};
use serde_json::{Value, json};

const PROGRAM: &str = "/home/me/.local/bin/jsonkit";

/// A temporary state folder, the record's home, removed when it drops.
struct State {
    path: PathBuf,
}

impl Drop for State {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn state_folder() -> State {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "loom-mcp-registration-{}-{}-{nanos}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    State {
        path: fs::canonicalize(path).unwrap(),
    }
}

/// What an agent's script answers for one call.
#[derive(Clone)]
enum Reply {
    Answer {
        code: i32,
        stdout: &'static str,
        stderr: &'static str,
    },
    Unstarted,
}

fn exits(code: i32) -> Reply {
    Reply::Answer {
        code,
        stdout: "",
        stderr: "",
    }
}

fn exits_with(code: i32, stderr: &'static str, stdout: &'static str) -> Reply {
    Reply::Answer {
        code,
        stdout,
        stderr,
    }
}

/// What an agent's script answers by the joined words of a call, 0 and silence otherwise, or a
/// script that cannot start at all.
#[derive(Clone)]
enum Agent {
    Replies(Vec<(String, Reply)>),
    Unstarted,
}

impl Default for Agent {
    fn default() -> Self {
        Agent::Replies(Vec::new())
    }
}

fn replies(entries: &[(&str, Reply)]) -> Agent {
    Agent::Replies(
        entries
            .iter()
            .map(|(words, reply)| ((*words).to_owned(), reply.clone()))
            .collect(),
    )
}

/// What happens inside a call, by `<agent> <words>`, before its script answers.
type During = Arc<dyn Fn(&MockProcess) + Send + Sync>;

#[derive(Clone, Default)]
struct Options {
    name: Option<&'static str>,
    claude: Agent,
    codex: Agent,
    platform: Option<&'static str>,
    env: Option<Vec<(&'static str, &'static str)>>,
    home: Option<&'static str>,
    build: Option<Build>,
    program_words: Option<Vec<&'static str>>,
    during: Vec<(String, During)>,
}

/// What one run left.
struct Ran {
    code: u8,
    calls: Vec<String>,
    stderr: String,
    stdout: String,
    record_root: PathBuf,
    name: String,
}

impl Ran {
    /// An agent's plugin's file, parsed, or none.
    fn record(&self, agent: &str) -> Option<Value> {
        let path = self
            .record_root
            .join(&self.name)
            .join("installation")
            .join(format!("mcp.{agent}.json"));
        fs::read_to_string(path)
            .ok()
            .map(|text| serde_json::from_str(&text).unwrap())
    }

    /// The glyph of the lane that wrote the sentence: the start of the line that ends with it.
    fn lane(&self, sentence: &str) -> Option<String> {
        self.stderr
            .split('\n')
            .find(|line| line.ends_with(sentence))
            .map(|line| line[..line.len() - sentence.len()].to_owned())
    }

    fn calls_containing(&self, part: &str) -> Vec<&String> {
        self.calls
            .iter()
            .filter(|call| call.contains(part))
            .collect()
    }
}

/// One agent's script: it records each call, runs what happens during it, and answers by the
/// call's words.
fn script(
    agent: &'static str,
    replies: Agent,
    calls: Arc<Mutex<Vec<String>>>,
    during: Vec<(String, During)>,
    process: Arc<OnceLock<Arc<MockProcess>>>,
) -> impl Fn(ProgramCall) -> std::future::Ready<io::Result<ProgramAnswer>> + Send + Sync + 'static {
    move |call: ProgramCall| {
        let words = call.args.join(" ");
        let named = format!("{agent} {words}");
        calls.lock().unwrap().push(named.clone());
        for (when, work) in &during {
            if *when == named {
                work(process.get().unwrap());
            }
        }
        let reply = match &replies {
            Agent::Unstarted => Reply::Unstarted,
            Agent::Replies(entries) => entries
                .iter()
                .find(|(each, _)| *each == words)
                .map_or_else(|| exits(0), |(_, reply)| reply.clone()),
        };
        std::future::ready(match reply {
            Reply::Unstarted => Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("{agent} cannot start"),
            )),
            Reply::Answer {
                code,
                stdout,
                stderr,
            } => Ok(ProgramAnswer::new()
                .code(code)
                .stdout(stdout)
                .stderr(stderr)),
        })
    }
}

/// Runs `<name> mcp <argv>` and answers the exit code, both streams, the calls, and the record.
async fn run(argv: &[&str], options: Options, state: &State) -> Ran {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let cell = Arc::new(OnceLock::new());
    let name = options.name.unwrap_or("jsonkit");
    let state_path = state.path.to_string_lossy().into_owned();
    let mut fields = MockFields::new()
        .argv(std::iter::once("mcp").chain(argv.iter().copied()))
        .home(
            options
                .home
                .map_or_else(|| state.path.clone(), PathBuf::from),
        )
        .platform(options.platform.unwrap_or("linux"))
        .program(
            options
                .program_words
                .clone()
                .unwrap_or_else(|| vec![PROGRAM]),
        )
        .release(ReleaseFacts::new(
            options.build.unwrap_or(Build::Distributed),
        ))
        .script(
            "claude",
            script(
                "claude",
                options.claude.clone(),
                Arc::clone(&calls),
                options.during.clone(),
                Arc::clone(&cell),
            ),
        )
        .script(
            "codex",
            script(
                "codex",
                options.codex.clone(),
                Arc::clone(&calls),
                options.during.clone(),
                Arc::clone(&cell),
            ),
        );
    match &options.env {
        Some(env) => {
            for (variable, value) in env {
                fields = fields.env(variable, value);
            }
        }
        None => {
            fields = fields
                .env("PATH", "/usr/bin")
                .env("XDG_STATE_HOME", &state_path);
        }
    }
    let process = mock_process(fields);
    let _ = cell.set(Arc::clone(&process));
    let code = Application::new(name)
        .plugins([mcp()])
        .description("Read JSON.")
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    let calls = calls.lock().unwrap().clone();
    Ran {
        code: code.get(),
        calls,
        stderr: process.stderr_text(),
        stdout: process.stdout_text(),
        record_root: state.path.clone(),
        name: name.to_owned(),
    }
}

/// Writes an agent's plugin's file by hand, as an earlier run or a killed one left it.
fn write_record(state: &State, agent: &str, text: &str) {
    let folder = state.path.join("jsonkit").join("installation");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join(format!("mcp.{agent}.json")), text).unwrap();
}

/// An agent's plugin's file as it is on disk now, read from inside a call.
fn record_now(state: &Path, agent: &str) -> Value {
    let path = state
        .join("jsonkit")
        .join("installation")
        .join(format!("mcp.{agent}.json"));
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn committed(command: &[&str]) -> String {
    format!(
        "{}\n",
        json!({ "directories": [], "files": [], "format": 1, "registrations": [{ "command": command, "name": "jsonkit" }], "state": "committed" })
    )
}

fn committed_now() -> String {
    committed(&[PROGRAM, "mcp"])
}

fn pending(prior: Option<&[&str]>, intended: Option<&[&str]>) -> String {
    format!("{}\n", pending_file(prior, intended))
}

/// What a pending file holds while a call runs.
fn pending_file(prior: Option<&[&str]>, intended: Option<&[&str]>) -> Value {
    json!({
        "directories": [],
        "files": [],
        "format": 1,
        "registrations": [{ "intended": intended, "name": "jsonkit", "prior": prior }],
        "state": "pending",
    })
}

fn claude_add() -> String {
    format!("mcp add -s user jsonkit -- {PROGRAM} mcp")
}

fn codex_add() -> String {
    format!("mcp add jsonkit -- {PROGRAM} mcp")
}

const CODEX_GET: &str = "mcp get jsonkit --json";
const CLAUDE_REMOVE: &str = "mcp remove -s user jsonkit";
const OLD: [&str; 2] = ["/old/jsonkit", "mcp"];

fn codex_free() -> Agent {
    replies(&[(CODEX_GET, exits(1))])
}

// install argv

#[tokio::test]
async fn runs_the_version_the_codex_name_check_and_each_add_with_the_contract_argv() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            codex: codex_free(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.calls,
        [
            "claude --version".to_owned(),
            "codex --version".to_owned(),
            format!("codex {CODEX_GET}"),
            format!("claude {}", claude_add()),
            format!("codex {}", codex_add()),
        ]
    );
    assert_eq!(
        result.stderr,
        format!(
            "✔ Registered jsonkit with claude to run {PROGRAM} mcp.\n✔ Registered jsonkit with codex to run {PROGRAM} mcp.\n"
        )
    );
    assert_eq!(result.stdout, "");
    assert_eq!(
        result.record("claude"),
        Some(json!({
            "directories": [],
            "files": [],
            "format": 1,
            "registrations": [{ "command": [PROGRAM, "mcp"], "name": "jsonkit" }],
            "state": "committed",
        }))
    );
}

#[tokio::test]
async fn writes_each_dot_of_the_application_name_as_an_underscore_and_keeps_every_runtime_word() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            name: Some("my.app"),
            program_words: Some(vec!["/usr/bin/node", "/srv/my.app/main.js"]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(
        result.calls,
        [
            "claude --version",
            "claude mcp add -s user my_app -- /usr/bin/node /srv/my.app/main.js mcp",
        ]
    );
    assert!(
        result.stderr.contains(
            "Registered my_app with claude to run /usr/bin/node /srv/my.app/main.js mcp."
        )
    );
}

#[tokio::test]
async fn a_recorded_claude_removes_and_then_adds_and_a_failing_remove_falls_through_to_add() {
    let state = state_folder();
    write_record(&state, "claude", &committed(&OLD));
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            claude: replies(&[(CLAUDE_REMOVE, exits_with(1, "no such server\n", ""))]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.calls,
        [
            "claude --version".to_owned(),
            format!("claude {CLAUDE_REMOVE}"),
            format!("claude {}", claude_add()),
        ]
    );
    assert!(!result.stderr.contains("Replaced"));
    assert_eq!(
        result.record("claude").unwrap()["registrations"][0]["command"],
        json!([PROGRAM, "mcp"])
    );
}

#[tokio::test]
async fn a_recorded_codex_runs_add_alone() {
    let state = state_folder();
    write_record(&state, "codex", &committed_now());
    let result = run(&["install", "--agent", "codex"], Options::default(), &state).await;
    assert_eq!(
        result.calls,
        [
            "codex --version".to_owned(),
            format!("codex {}", codex_add())
        ]
    );
}

// a name the record does not list

fn codex_held() -> Agent {
    replies(&[(CODEX_GET, exits_with(0, "", "{}"))])
}

#[tokio::test]
async fn refuses_when_codex_holds_it_with_nothing_written_to_any_agent() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            codex: codex_held(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert!(result.calls_containing(" mcp add").is_empty());
    assert!(result.calls_containing(" mcp remove").is_empty());
    assert_eq!(
        result.stderr,
        "⚠ codex already has an MCP server named jsonkit, which jsonkit mcp install did not register.\njsonkit mcp install changed nothing, because a registration it did not make is in the way. Remove it with codex mcp remove jsonkit, or run jsonkit mcp install --force to replace it.\n"
    );
    assert_eq!(result.record("claude"), None);
    assert_eq!(result.record("codex"), None);
}

#[tokio::test]
async fn replaces_it_under_force_and_says_so_before_codex_registers() {
    let state = state_folder();
    let result = run(
        &["install", "--force"],
        Options {
            codex: codex_held(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    let replaced = result
        .stderr
        .find("Replaced the jsonkit server codex had, which jsonkit mcp install did not register.")
        .unwrap();
    assert!(replaced < result.stderr.find("Registered jsonkit with codex").unwrap());
    assert!(result.calls.contains(&format!("codex {}", codex_add())));
}

#[tokio::test]
async fn under_force_claude_removes_first_and_reports_a_replacement_when_its_remove_exits_0() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude", "--force"],
        Options::default(),
        &state,
    )
    .await;
    assert_eq!(
        result.calls,
        [
            "claude --version".to_owned(),
            format!("claude {CLAUDE_REMOVE}"),
            format!("claude {}", claude_add()),
        ]
    );
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stderr,
        format!(
            "ℹ Replaced the jsonkit server claude had, which jsonkit mcp install did not register.\n✔ Registered jsonkit with claude to run {PROGRAM} mcp.\n"
        )
    );
}

#[tokio::test]
async fn under_force_claude_reports_no_replacement_when_its_remove_fails() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude", "--force"],
        Options {
            claude: replies(&[(CLAUDE_REMOVE, exits(1))]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stderr,
        format!("✔ Registered jsonkit with claude to run {PROGRAM} mcp.\n")
    );
}

#[tokio::test]
async fn fails_with_nothing_written_when_codex_get_exits_with_another_code() {
    for code in [2, 127] {
        let state = state_folder();
        let result = run(
            &["install"],
            Options {
                codex: replies(&[(CODEX_GET, exits_with(code, "boom\n", ""))]),
                ..Options::default()
            },
            &state,
        )
        .await;
        assert_eq!(result.code, 1);
        assert_eq!(
            result.stderr,
            format!(
                "⚠ boom\njsonkit cannot tell whether codex already has a server named jsonkit, because codex mcp get exited with code {code}. Fix what codex reported, then run jsonkit mcp install again.\n"
            )
        );
        assert!(result.calls_containing(" mcp add").is_empty());
        assert_eq!(result.record("claude"), None);
    }
}

#[tokio::test]
async fn fails_with_nothing_written_when_codex_get_cannot_start() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            codex: replies(&[(CODEX_GET, Reply::Unstarted)]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "jsonkit cannot tell whether codex already has a server named jsonkit, because codex mcp get could not start. Fix what codex reported, then run jsonkit mcp install again.\n"
    );
    assert!(result.calls_containing(" mcp add").is_empty());
}

// a failed add

fn claude_fails() -> Agent {
    Agent::Replies(vec![(
        claude_add(),
        exits_with(1, "already exists\n", "see docs\n"),
    )])
}

#[tokio::test]
async fn warns_the_output_leaves_no_file_and_gives_the_claude_correction() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            claude: claude_fails(),
            codex: codex_free(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "⚠ already exists\n⚠ see docs\njsonkit could not register with claude, because claude mcp add exited with code 1. If claude already has a server named jsonkit, remove it with claude mcp remove jsonkit -s user, or run jsonkit mcp install --force to replace it.\n"
    );
    assert_eq!(result.record("claude"), None);
    assert!(
        !result
            .calls
            .iter()
            .any(|call| call.starts_with(&format!("codex {}", codex_add())))
    );
}

#[tokio::test]
async fn restores_the_recorded_registration_when_the_agent_was_not_touched() {
    let state = state_folder();
    write_record(&state, "codex", &committed(&OLD));
    let result = run(
        &["install", "--agent", "codex"],
        Options {
            codex: Agent::Replies(vec![(codex_add(), exits(3))]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "jsonkit could not register with codex, because codex mcp add exited with code 3. Fix what codex reported, then run jsonkit mcp install again.\n"
    );
    let record = result.record("codex").unwrap();
    assert_eq!(record["registrations"][0]["command"], json!(OLD));
    assert_eq!(record["state"], "committed");
}

#[tokio::test]
async fn keeps_no_file_for_claude_once_its_remove_exited_0() {
    let state = state_folder();
    write_record(&state, "claude", &committed(&OLD));
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            claude: claude_fails(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(result.record("claude"), None);
}

#[tokio::test]
async fn keeps_the_earlier_agent_registered_and_attempts_no_later_one() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            codex: Agent::Replies(vec![
                (codex_add(), exits(1)),
                (CODEX_GET.to_owned(), exits(1)),
            ]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    let claude = result.record("claude").unwrap();
    assert_eq!(claude["registrations"][0]["name"], "jsonkit");
    assert_eq!(claude["state"], "committed");
    assert_eq!(result.record("codex"), None);
}

#[tokio::test]
async fn reports_an_add_that_cannot_start() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            claude: Agent::Replies(vec![(claude_add(), Reply::Unstarted)]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "jsonkit could not register with claude, because claude mcp add could not start. If claude already has a server named jsonkit, remove it with claude mcp remove jsonkit -s user, or run jsonkit mcp install --force to replace it.\n"
    );
}

// discovery

#[tokio::test]
async fn registers_with_the_agents_that_start_and_skips_the_others() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            codex: Agent::Unstarted,
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stderr,
        format!(
            "✔ Registered jsonkit with claude to run {PROGRAM} mcp.\nℹ Skipped codex, because codex could not start.\n"
        )
    );
    assert_eq!(result.record("codex"), None);
    assert!(result.record("claude").is_some());
}

#[tokio::test]
async fn fails_when_none_starts() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            claude: Agent::Unstarted,
            codex: Agent::Unstarted,
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "jsonkit mcp install found no agent to register with, because neither claude nor codex could start. Install one of them, then run jsonkit mcp install again.\n"
    );
}

#[tokio::test]
async fn fails_when_the_named_agent_cannot_start() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "codex"],
        Options {
            codex: Agent::Unstarted,
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "jsonkit mcp install cannot register with codex, because codex could not start. Install codex, or leave out --agent.\n"
    );
    assert_eq!(result.calls, ["codex --version"]);
}

#[tokio::test]
async fn rejects_an_agent_outside_the_set_with_exit_2() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "gemini"],
        Options::default(),
        &state,
    )
    .await;
    assert_eq!(result.code, 2);
    assert_eq!(
        result.stderr,
        "jsonkit: Option \"--agent\": Expected one of: claude, codex.\n"
    );
    assert_eq!(result.stdout, "");
    assert_eq!(result.calls, Vec::<String>::new());
}

// uninstall

#[tokio::test]
async fn removes_only_the_recorded_agents_counts_a_pending_file_and_deletes_each_file() {
    let state = state_folder();
    write_record(&state, "claude", &pending(None, Some(&[PROGRAM, "mcp"])));
    let result = run(&["uninstall"], Options::default(), &state).await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.calls,
        [
            "claude --version".to_owned(),
            format!("claude {CLAUDE_REMOVE}")
        ]
    );
    assert_eq!(result.stderr, "✔ Removed jsonkit from claude.\n");
    assert_eq!(result.record("claude"), None);
}

#[tokio::test]
async fn removes_codex_with_its_own_argv() {
    let state = state_folder();
    write_record(&state, "codex", &committed_now());
    let result = run(
        &["uninstall", "--agent", "codex"],
        Options::default(),
        &state,
    )
    .await;
    assert_eq!(
        result.calls,
        ["codex --version", "codex mcp remove jsonkit"]
    );
}

#[tokio::test]
async fn deletes_the_file_and_exits_0_whatever_remove_answers() {
    let state = state_folder();
    write_record(&state, "claude", &committed_now());
    let result = run(
        &["uninstall"],
        Options {
            claude: replies(&[(CLAUDE_REMOVE, exits_with(1, "not found\n", ""))]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stderr,
        "⚠ not found\nℹ jsonkit is no longer recorded as registered with claude.\n"
    );
    assert_eq!(result.record("claude"), None);
}

#[tokio::test]
async fn keeps_the_file_of_a_recorded_agent_that_cannot_start_warns_and_fails_at_the_end() {
    let state = state_folder();
    write_record(&state, "claude", &committed_now());
    write_record(&state, "codex", &committed_now());
    let result = run(
        &["uninstall"],
        Options {
            claude: Agent::Unstarted,
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "⚠ claude could not start, so jsonkit stays registered with it.\n✔ Removed jsonkit from codex.\njsonkit mcp uninstall could not remove every registration. Make claude available and run jsonkit mcp uninstall again, or remove jsonkit from claude's MCP configuration yourself.\n"
    );
    assert!(result.record("claude").is_some());
    assert_eq!(result.record("codex"), None);
    assert!(
        result
            .calls
            .contains(&"codex mcp remove jsonkit".to_owned())
    );
}

#[tokio::test]
async fn says_there_is_nothing_to_remove_with_and_without_agent_and_starts_no_program() {
    let state = state_folder();
    let all = run(&["uninstall"], Options::default(), &state).await;
    assert_eq!(all.code, 0);
    assert_eq!(
        all.stderr,
        "✔ jsonkit is not registered with any agent by jsonkit mcp install, so there is nothing to remove.\n"
    );
    let one = run(
        &["uninstall", "--agent", "codex"],
        Options::default(),
        &state,
    )
    .await;
    assert_eq!(one.code, 0);
    assert_eq!(
        one.stderr,
        "✔ jsonkit is not registered with codex by jsonkit mcp install, so there is nothing to remove.\n"
    );
    assert_eq!(all.calls, Vec::<String>::new());
    assert_eq!(one.calls, Vec::<String>::new());
}

// refusals

#[tokio::test]
async fn a_damaged_record_refuses_install_and_uninstall_before_any_program_starts() {
    for child in ["install", "uninstall"] {
        let state = state_folder();
        write_record(&state, "codex", "{not json");
        let result = run(&[child], Options::default(), &state).await;
        assert_eq!(result.code, 1);
        assert_eq!(result.calls, Vec::<String>::new());
        let path = state.path.join("jsonkit/installation/mcp.codex.json");
        assert_eq!(
            result.stderr,
            format!(
                "{} cannot be read, so jsonkit will not change the registration it lists. Remove it, then run jsonkit mcp {child} again.\n",
                path.display()
            )
        );
    }
}

#[tokio::test]
async fn refuses_a_file_of_an_unknown_format() {
    let state = state_folder();
    write_record(&state, "claude", &json!({ "format": 2 }).to_string());
    let result = run(
        &["install", "--agent", "claude"],
        Options::default(),
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(result.calls, Vec::<String>::new());
}

#[tokio::test]
async fn refuses_a_damaged_file_of_an_agent_that_could_not_start_and_reads_only_the_named_agent() {
    let state = state_folder();
    write_record(&state, "codex", "[]");
    let result = run(
        &["install"],
        Options {
            codex: Agent::Unstarted,
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(result.calls, Vec::<String>::new());
    let named = run(
        &["install", "--agent", "claude"],
        Options::default(),
        &state,
    )
    .await;
    assert_eq!(named.code, 0);
}

#[tokio::test]
async fn refuses_install_and_uninstall_on_windows_before_any_program_starts() {
    for child in ["install", "uninstall"] {
        let state = state_folder();
        let result = run(
            &[child],
            Options {
                platform: Some("win32"),
                ..Options::default()
            },
            &state,
        )
        .await;
        assert_eq!(result.code, 1);
        assert_eq!(result.calls, Vec::<String>::new());
        assert_eq!(
            result.stderr,
            format!(
                "jsonkit mcp {child} registers with claude and codex on Linux and macOS. Print a client configuration with jsonkit mcp config and add it to your agent yourself.\n"
            )
        );
    }
}

#[tokio::test]
async fn refuses_a_command_line_word_that_holds_a_control_character() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            program_words: Some(vec!["/srv/bin\u{7}/jsonkit"]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(result.calls, Vec::<String>::new());
    assert_eq!(
        result.stderr,
        "jsonkit cannot register its MCP server because its path holds a control character. Install jsonkit where its path has none.\n"
    );
}

// build notes

#[tokio::test]
async fn prints_the_development_note() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            build: Some(Build::Development),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert!(result.stderr.contains(
        "jsonkit is a development build, so the registration runs it from this checkout. Run mcp install from an installed jsonkit to register that one instead."
    ));
    assert!(!result.stderr.contains("runtime flags"));
}

#[tokio::test]
async fn prints_the_source_note_alone_since_a_compiled_binary_has_no_runtime_flags() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            build: Some(Build::Source),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert!(result.stderr.contains(
        "jsonkit is a source build, so the registration runs it from this checkout. Run mcp install from an installed jsonkit to register that one instead."
    ));
    assert!(!result.stderr.contains("runtime flags"));
}

#[tokio::test]
async fn prints_no_note_for_a_distributed_build() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude"],
        Options::default(),
        &state,
    )
    .await;
    assert!(!result.stderr.contains("checkout"));
}

// config

#[tokio::test]
async fn config_writes_the_exact_bytes_starts_no_program_and_reads_no_record() {
    let state = state_folder();
    write_record(&state, "claude", "{not json");
    let result = run(
        &["config"],
        Options {
            name: Some("my.app"),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stdout,
        format!(
            "{{\n  \"mcpServers\": {{\n    \"my_app\": {{\n      \"command\": \"{PROGRAM}\",\n      \"args\": [\n        \"mcp\"\n      ]\n    }}\n  }}\n}}\n"
        )
    );
    assert_eq!(result.calls, Vec::<String>::new());
}

#[tokio::test]
async fn config_runs_on_win32_and_splits_the_runtime_words_into_command_and_args() {
    let state = state_folder();
    let result = run(
        &["config"],
        Options {
            platform: Some("win32"),
            program_words: Some(vec!["/usr/bin/node", "/srv/main.js"]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    assert_eq!(
        serde_json::from_str::<Value>(&result.stdout).unwrap(),
        json!({ "mcpServers": { "jsonkit": { "args": ["/srv/main.js", "mcp"], "command": "/usr/bin/node" } } })
    );
}

#[tokio::test]
async fn config_escapes_a_control_character_as_json_does() {
    let state = state_folder();
    let result = run(
        &["config"],
        Options {
            program_words: Some(vec!["/srv/bin\u{7}/jsonkit"]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 0);
    assert!(
        result
            .stdout
            .contains("\"command\": \"/srv/bin\\u0007/jsonkit\""),
        "{}",
        result.stdout
    );
}

// the file while a call runs

/// A `during` entry that reads an agent's file into `seen` when the call runs.
fn reading(
    state: &State,
    call: String,
    agent: &'static str,
    seen: &Arc<Mutex<Vec<Value>>>,
) -> (String, During) {
    let path = state.path.clone();
    let seen = Arc::clone(seen);
    (
        call,
        Arc::new(move |_: &MockProcess| seen.lock().unwrap().push(record_now(&path, agent))),
    )
}

#[tokio::test]
async fn install_writes_the_file_pending_with_the_prior_and_intended_lines_during_add() {
    let state = state_folder();
    write_record(&state, "codex", &committed(&OLD));
    let seen = Arc::new(Mutex::new(Vec::new()));
    run(
        &["install", "--agent", "codex"],
        Options {
            during: vec![reading(
                &state,
                format!("codex {}", codex_add()),
                "codex",
                &seen,
            )],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(
        *seen.lock().unwrap(),
        [pending_file(Some(&OLD), Some(&[PROGRAM, "mcp"]))]
    );
}

#[tokio::test]
async fn install_of_an_unrecorded_name_writes_prior_null_during_claude_add() {
    let state = state_folder();
    let seen = Arc::new(Mutex::new(Vec::new()));
    run(
        &["install", "--agent", "claude"],
        Options {
            during: vec![reading(
                &state,
                format!("claude {}", claude_add()),
                "claude",
                &seen,
            )],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(
        *seen.lock().unwrap(),
        [pending_file(None, Some(&[PROGRAM, "mcp"]))]
    );
}

#[tokio::test]
async fn install_keeps_the_file_pending_through_claude_remove() {
    let state = state_folder();
    write_record(&state, "claude", &committed(&OLD));
    let seen = Arc::new(Mutex::new(Vec::new()));
    run(
        &["install", "--agent", "claude"],
        Options {
            during: vec![reading(
                &state,
                format!("claude {CLAUDE_REMOVE}"),
                "claude",
                &seen,
            )],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(
        *seen.lock().unwrap(),
        [pending_file(Some(&OLD), Some(&[PROGRAM, "mcp"]))]
    );
}

#[tokio::test]
async fn uninstall_writes_the_file_pending_with_intended_null_during_remove() {
    let state = state_folder();
    write_record(&state, "claude", &committed(&OLD));
    let seen = Arc::new(Mutex::new(Vec::new()));
    run(
        &["uninstall"],
        Options {
            during: vec![reading(
                &state,
                format!("claude {CLAUDE_REMOVE}"),
                "claude",
                &seen,
            )],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(*seen.lock().unwrap(), [pending_file(Some(&OLD), None)]);
}

#[tokio::test]
async fn install_over_a_pending_file_treats_it_as_recorded() {
    let state = state_folder();
    write_record(&state, "claude", &pending(Some(&OLD), None));
    write_record(&state, "codex", &pending(Some(&OLD), None));
    let result = run(&["install"], Options::default(), &state).await;
    assert_eq!(result.code, 0);
    assert_eq!(
        result.calls,
        [
            "claude --version".to_owned(),
            "codex --version".to_owned(),
            format!("claude {CLAUDE_REMOVE}"),
            format!("claude {}", claude_add()),
            format!("codex {}", codex_add()),
        ]
    );
}

// the run signal

fn both(state: &State) {
    write_record(state, "claude", &committed(&OLD));
    write_record(state, "codex", &committed(&OLD));
}

fn raising(call: String, signal: ProcessSignal) -> (String, During) {
    (
        call,
        Arc::new(move |process: &MockProcess| process.raise(signal)),
    )
}

fn committed_old() -> Value {
    serde_json::from_str(&committed(&OLD)).unwrap()
}

#[tokio::test]
async fn a_signal_during_install_version_starts_no_later_call() {
    for (signal, code) in [(ProcessSignal::Int, 130), (ProcessSignal::Term, 143)] {
        let state = state_folder();
        both(&state);
        let result = run(
            &["install"],
            Options {
                during: vec![raising("claude --version".into(), signal)],
                ..Options::default()
            },
            &state,
        )
        .await;
        assert_eq!(result.code, code, "{signal:?}");
        assert_eq!(result.calls, ["claude --version"]);
        assert_eq!(result.record("claude"), Some(committed_old()));
        assert_eq!(result.record("codex"), Some(committed_old()));
    }
}

#[tokio::test]
async fn sigterm_during_uninstall_version_starts_no_later_call_and_keeps_both_files() {
    let state = state_folder();
    both(&state);
    let result = run(
        &["uninstall"],
        Options {
            during: vec![raising("claude --version".into(), ProcessSignal::Term)],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 143);
    assert_eq!(result.calls, ["claude --version"]);
    assert_eq!(result.record("claude"), Some(committed_old()));
    assert_eq!(result.record("codex"), Some(committed_old()));
}

#[tokio::test]
async fn sigterm_during_uninstall_remove_leaves_that_file_pending_and_the_other_untouched() {
    let state = state_folder();
    both(&state);
    let result = run(
        &["uninstall"],
        Options {
            during: vec![raising(
                format!("claude {CLAUDE_REMOVE}"),
                ProcessSignal::Term,
            )],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 143);
    assert_eq!(
        result.calls,
        [
            "claude --version".to_owned(),
            format!("claude {CLAUDE_REMOVE}")
        ]
    );
    assert_eq!(
        result.record("claude"),
        Some(pending_file(Some(&OLD), None))
    );
    assert_eq!(result.record("codex"), Some(committed_old()));
    assert!(!result.stderr.contains("Removed"));
}

#[tokio::test]
async fn sigint_during_install_add_leaves_that_file_pending_and_attempts_no_later_agent() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            codex: codex_free(),
            during: vec![raising(
                format!("claude {}", claude_add()),
                ProcessSignal::Int,
            )],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 130);
    assert_eq!(
        result.calls,
        [
            "claude --version".to_owned(),
            "codex --version".to_owned(),
            format!("codex {CODEX_GET}"),
            format!("claude {}", claude_add()),
        ]
    );
    assert_eq!(
        result.record("claude"),
        Some(pending_file(None, Some(&[PROGRAM, "mcp"])))
    );
    assert_eq!(result.record("codex"), None);
}

#[tokio::test]
async fn sigterm_during_install_claude_remove_leaves_the_file_pending_and_runs_no_add() {
    let state = state_folder();
    write_record(&state, "claude", &committed(&OLD));
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            during: vec![raising(
                format!("claude {CLAUDE_REMOVE}"),
                ProcessSignal::Term,
            )],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 143);
    assert_eq!(
        result.calls,
        [
            "claude --version".to_owned(),
            format!("claude {CLAUDE_REMOVE}")
        ]
    );
    assert_eq!(
        result.record("claude"),
        Some(pending_file(Some(&OLD), Some(&[PROGRAM, "mcp"])))
    );
}

#[tokio::test]
async fn sigterm_during_the_codex_name_check_writes_nothing_and_starts_no_add() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            during: vec![raising(format!("codex {CODEX_GET}"), ProcessSignal::Term)],
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 143);
    assert!(result.calls_containing(" mcp add").is_empty());
    assert_eq!(result.record("claude"), None);
    assert_eq!(result.record("codex"), None);
}

// leftover staging files

const LEFTOVER: &str = ".mcp.claude.json.0123456789abcdef.loom-staging";

#[tokio::test]
async fn install_and_uninstall_remove_leftover_staging_files() {
    for child in ["install", "uninstall"] {
        let state = state_folder();
        write_record(&state, "claude", &committed_now());
        let path = state.path.join("jsonkit/installation").join(LEFTOVER);
        fs::write(&path, "half").unwrap();
        run(&[child, "--agent", "claude"], Options::default(), &state).await;
        assert!(!path.exists(), "{child}");
    }
}

#[tokio::test]
async fn install_removes_leftover_staging_files_where_no_file_was_written() {
    let state = state_folder();
    let folder = state.path.join("jsonkit/installation");
    fs::create_dir_all(&folder).unwrap();
    let path = folder.join(LEFTOVER);
    fs::write(&path, "half").unwrap();
    run(
        &["install", "--agent", "claude"],
        Options::default(),
        &state,
    )
    .await;
    assert!(!path.exists());
}

// the lane of each sentence

const SUCCESS: &str = "✔ ";
const INFO: &str = "ℹ ";
const WARN: &str = "⚠ ";

#[tokio::test]
async fn writes_registered_as_success_and_skipped_and_build_notes_as_info_in_table_order() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            build: Some(Build::Source),
            claude: Agent::Unstarted,
            codex: codex_free(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(
        result.stderr,
        format!(
            "ℹ Skipped claude, because claude could not start.\n✔ Registered jsonkit with codex to run {PROGRAM} mcp.\nℹ jsonkit is a source build, so the registration runs it from this checkout. Run mcp install from an installed jsonkit to register that one instead.\n"
        )
    );
}

#[tokio::test]
async fn skips_claude_before_it_registers_codex_and_registers_claude_before_it_skips_codex() {
    let state = state_folder();
    let before = run(
        &["install"],
        Options {
            claude: Agent::Unstarted,
            codex: codex_free(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert!(
        before.stderr.find("Skipped claude").unwrap() < before.stderr.find("Registered").unwrap()
    );
    let state = state_folder();
    let after = run(
        &["install"],
        Options {
            codex: Agent::Unstarted,
            ..Options::default()
        },
        &state,
    )
    .await;
    assert!(
        after.stderr.find("Registered jsonkit with claude").unwrap()
            < after.stderr.find("Skipped codex").unwrap()
    );
}

#[tokio::test]
async fn writes_the_held_name_sentence_as_a_warning_and_replaced_as_info() {
    let held = || replies(&[(CODEX_GET, exits(0))]);
    let state = state_folder();
    let refused = run(
        &["install"],
        Options {
            codex: held(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(
        refused
            .lane(
                "codex already has an MCP server named jsonkit, which jsonkit mcp install did not register."
            )
            .as_deref(),
        Some(WARN)
    );
    let forced = run(
        &["install", "--force"],
        Options {
            codex: held(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(
        forced
            .lane(
                "Replaced the jsonkit server codex had, which jsonkit mcp install did not register."
            )
            .as_deref(),
        Some(INFO)
    );
}

#[tokio::test]
async fn writes_the_agent_output_as_a_warning_on_a_failed_add() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            claude: Agent::Replies(vec![(claude_add(), exits_with(1, "oops\n", ""))]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.lane("oops").as_deref(), Some(WARN));
}

#[tokio::test]
async fn writes_an_agent_output_esc_byte_escaped() {
    let state = state_folder();
    let result = run(
        &["install", "--agent", "claude"],
        Options {
            claude: Agent::Replies(vec![(claude_add(), exits_with(1, "a\u{1b}[31mred\n", ""))]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert!(
        result.stderr.contains("a\\u001b[31mred"),
        "{}",
        result.stderr
    );
}

#[tokio::test]
async fn writes_removed_as_success_and_no_longer_recorded_as_info_after_the_output_as_a_warning() {
    let state = state_folder();
    write_record(&state, "claude", &committed_now());
    write_record(&state, "codex", &committed_now());
    let result = run(
        &["uninstall"],
        Options {
            claude: replies(&[(CLAUDE_REMOVE, exits_with(1, "oops\n", ""))]),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.lane("oops").as_deref(), Some(WARN));
    assert_eq!(
        result
            .lane("jsonkit is no longer recorded as registered with claude.")
            .as_deref(),
        Some(INFO)
    );
    assert_eq!(
        result.lane("Removed jsonkit from codex.").as_deref(),
        Some(SUCCESS)
    );
}

#[tokio::test]
async fn writes_nothing_to_remove_as_success_and_could_not_start_as_a_warning() {
    let state = state_folder();
    let none = run(&["uninstall"], Options::default(), &state).await;
    assert_eq!(
        none.lane(
            "jsonkit is not registered with any agent by jsonkit mcp install, so there is nothing to remove."
        )
        .as_deref(),
        Some(SUCCESS)
    );
    let state = state_folder();
    write_record(&state, "claude", &committed_now());
    let result = run(
        &["uninstall"],
        Options {
            claude: Agent::Unstarted,
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(
        result
            .lane("claude could not start, so jsonkit stays registered with it.")
            .as_deref(),
        Some(WARN)
    );
}

// the order of the checks

fn bell() -> Option<Vec<&'static str>> {
    Some(vec!["/srv/bin\u{7}/jsonkit"])
}

fn relative() -> Option<Vec<(&'static str, &'static str)>> {
    Some(vec![("PATH", "/usr/bin"), ("XDG_STATE_HOME", "relative")])
}

#[tokio::test]
async fn refuses_a_record_directory_that_is_not_absolute_before_any_program_starts() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            env: relative(),
            home: Some(""),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert_eq!(result.code, 1);
    assert_eq!(result.calls, Vec::<String>::new());
    assert_eq!(
        result.stderr,
        "jsonkit cannot find its installation record because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.\n"
    );
}

#[tokio::test]
async fn checks_windows_before_a_control_character() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            program_words: bell(),
            platform: Some("win32"),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert!(
        result
            .stderr
            .contains("registers with claude and codex on Linux and macOS")
    );
    assert!(!result.stderr.contains("control character"));
}

#[tokio::test]
async fn checks_a_control_character_before_the_record_directory() {
    let state = state_folder();
    let result = run(
        &["install"],
        Options {
            program_words: bell(),
            env: relative(),
            home: Some(""),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert!(result.stderr.contains("holds a control character"));
    assert!(!result.stderr.contains("installation record"));
}

#[tokio::test]
async fn checks_a_control_character_before_a_damaged_record() {
    let state = state_folder();
    write_record(&state, "claude", "{not json");
    let result = run(
        &["install"],
        Options {
            program_words: bell(),
            ..Options::default()
        },
        &state,
    )
    .await;
    assert!(result.stderr.contains("holds a control character"));
    assert!(!result.stderr.contains("cannot be read"));
}
