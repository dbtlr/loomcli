//! A run of jsonkit on the mock process, and the conformance corpus the reference captured.

#![allow(dead_code, clippy::expect_used, clippy::panic)]

use conformance_harness::sandbox::Layout;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use loomcli_core::{ProcessHandle, RunOptions};
use loomcli_testing::{MockFields, mock_process};

/// What one run wrote and resolved.
#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

/// Runs jsonkit with these words from `cwd`, with `HOME` set to `home`, the piped stdin, and the
/// variables.
pub async fn run_from(
    cwd: &Path,
    home: &Path,
    argv: &[&str],
    stdin: &str,
    env: &[(&str, &str)],
) -> Ran {
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .cwd(cwd)
        .env("HOME", &home.to_string_lossy())
        .stdin(stdin.as_bytes().to_vec());
    for (name, value) in env {
        fields = fields.env(name, value);
    }
    let process = mock_process(fields);
    let code = jsonkit::jsonkit()
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// A run that wrote `stdout` and nothing else, and exited 0.
pub fn printed(stdout: &str) -> Ran {
    Ran {
        status: 0,
        stdout: stdout.to_owned(),
        stderr: String::new(),
    }
}

/// A run that failed with `stderr` alone and this code.
pub fn failed(status: u8, stderr: &str) -> Ran {
    Ran {
        status,
        stdout: String::new(),
        stderr: stderr.to_owned(),
    }
}

/// The corpus folder.
fn corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../conformance")
}

/// The conformance fixtures every case reads.
pub fn fixtures() -> PathBuf {
    corpus().join("fixtures")
}

/// One case of the conformance corpus: its words, stdin, and variables, and what the reference
/// wrote, produced, and exited with.
pub struct Case {
    pub id: String,
    pub argv: Vec<String>,
    pub stdin: Option<String>,
    pub session: bool,
    pub env: Vec<(String, String)>,
    pub expected: Ran,
    /// The files the case produced in its work folder, by path relative to it.
    pub files: BTreeMap<String, String>,
}

/// The strings of a JSON array.
fn strings(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| item.as_str().expect("a string").to_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// The files under `folder`, by `/`-joined path relative to `root`.
pub fn files_under(root: &Path, folder: &Path, files: &mut BTreeMap<String, String>) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries {
        let path = entry.expect("a readable entry").path();
        if path.is_dir() {
            files_under(root, &path, files);
        } else {
            let relative = path.strip_prefix(root).expect("a path under the root");
            let name = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            files.insert(
                name,
                std::fs::read_to_string(&path).expect("a UTF-8 produced file"),
            );
        }
    }
}

/// Every jsonkit case of the corpus, in its group files' order.
pub fn cases() -> Vec<Case> {
    let mut groups: Vec<_> = std::fs::read_dir(corpus().join("cases"))
        .expect("the corpus has a cases folder")
        .map(|entry| entry.expect("a readable case file").path())
        .collect();
    groups.sort();
    let mut cases = Vec::new();
    for path in groups {
        let text = std::fs::read_to_string(&path).expect("a readable case file");
        let group: serde_json::Value = serde_json::from_str(&text).expect("a JSON case file");
        for found in group["cases"].as_array().into_iter().flatten() {
            if found["app"] != "jsonkit" {
                continue;
            }
            let id = found["id"].as_str().expect("an id").to_owned();
            let env = found["env"]
                .as_object()
                .map(|env| {
                    env.iter()
                        .map(|(name, value)| {
                            (name.clone(), value.as_str().expect("a string").to_owned())
                        })
                        .collect()
                })
                .unwrap_or_default();
            let expected = corpus().join("expected").join(&id);
            let read = |name: &str| {
                std::fs::read_to_string(expected.join(name)).expect("a captured result")
            };
            let mut files = BTreeMap::new();
            files_under(&expected.join("files"), &expected.join("files"), &mut files);
            cases.push(Case {
                argv: strings(&found["argv"]),
                stdin: found["stdin"].as_str().map(str::to_owned),
                session: found.get("session").is_some(),
                env,
                expected: Ran {
                    status: read("exit").trim().parse().expect("an exit code"),
                    stdout: read("stdout"),
                    stderr: read("stderr"),
                },
                files,
                id,
            });
        }
    }
    cases
}

/// What one case wrote, and the files it produced in its work folder.
pub struct CaseRun {
    pub ran: Ran,
    pub files: BTreeMap<String, String>,
}

/// Runs a shared case on the mock process with a fresh home, work directory, and copied fixtures.
pub async fn run_case(case: &Case) -> CaseRun {
    let sandbox = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join("jsonkit-corpus")
        .join(&case.id);
    let layout = Layout::new(&sandbox, None);
    layout.create(&fixtures()).expect("create the case sandbox");
    let work_text = layout.work.to_string_lossy().into_owned();
    let substitute = |text: &str| text.replace("{sandbox}", &work_text);
    let argv: Vec<String> = case.argv.iter().map(|word| substitute(word)).collect();
    let argv: Vec<&str> = argv.iter().map(String::as_str).collect();
    let env: Vec<(String, String)> = case
        .env
        .iter()
        .map(|(name, value)| (name.clone(), substitute(value)))
        .collect();
    let env: Vec<(&str, &str)> = env
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();
    let ran = run_from(
        &layout.cwd,
        &layout.home,
        &argv,
        case.stdin.as_deref().unwrap_or_default(),
        &env,
    )
    .await;
    let unsubstitute = |text: String| text.replace(&work_text, "{sandbox}");
    let mut files = BTreeMap::new();
    files_under(&layout.work, &layout.work, &mut files);
    let files = files
        .into_iter()
        .map(|(name, text)| (name, unsubstitute(text)))
        .collect();
    CaseRun {
        ran: Ran {
            status: ran.status,
            stdout: unsubstitute(ran.stdout),
            stderr: unsubstitute(ran.stderr),
        },
        files,
    }
}

/// What the reference wrote for the corpus case `id`, and the files it produced.
pub fn captured(id: &str) -> Case {
    cases()
        .into_iter()
        .find(|case| case.id == id)
        .unwrap_or_else(|| panic!("the corpus holds no case {id:?}"))
}
