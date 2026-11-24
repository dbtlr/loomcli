//! Running cases: one sandbox per case, the process, the comparison, and the verdict.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use crate::accepted::Accepted;
use crate::cases::{Case, session_steps};
use crate::compare::{Observed, Part, differing_parts, list_files, load_expected};
use crate::exec::{Input, Spec, TIMEOUT, run_process};
use crate::sandbox::{Layout, normalize, scrubbed_env, work_spellings};

/// The applications the corpus runs.
pub const APPS: [&str; 2] = ["jsonkit", "textstat"];

/// The verdict on one case.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Every part matches.
    Passed,
    /// Something differs and is not accepted, or the case could not run.
    Failed,
    /// Differs only in parts `accepted.json` allows.
    Accepted,
    /// Listed as accepted but now matches.
    Stale,
}

/// Everything known about one run case.
#[derive(Debug, Clone)]
pub struct CaseResult {
    /// The case id.
    pub id: String,
    /// The case file it came from.
    pub group: String,
    /// The verdict.
    pub status: Status,
    /// The parts that differ.
    pub parts: Vec<Part>,
    /// The captured reference result.
    pub expected: Observed,
    /// What the Rust binary produced.
    pub actual: Observed,
    /// Harness-level problems: could not start, timed out, ended by signal, unreadable expected files.
    pub notes: Vec<String>,
}

/// Fixed inputs of a run.
#[derive(Debug, Clone)]
pub struct Context {
    /// The `conformance` folder.
    pub conformance_dir: PathBuf,
    /// Where sandboxes are created.
    pub scratch_dir: PathBuf,
    /// Where the example binaries are.
    pub bin_dir: PathBuf,
    /// The accepted differences.
    pub accepted: Vec<Accepted>,
    /// The `PATH` value handed to every child.
    pub path_var: String,
    /// Worker threads.
    pub jobs: usize,
}

/// Decides the verdict from the differing parts and the case's accepted entry.
pub fn classify(parts: &[Part], accepted: Option<&Accepted>) -> Status {
    match (parts.is_empty(), accepted) {
        (true, None) => Status::Passed,
        (true, Some(_)) => Status::Stale,
        (false, None) => Status::Failed,
        (false, Some(entry)) => {
            let allowed = entry.part_set();
            if parts.iter().all(|p| allowed.contains(p)) {
                Status::Accepted
            } else {
                Status::Failed
            }
        }
    }
}

/// The path of an example binary in `bin_dir`.
pub fn binary_path(bin_dir: &Path, app: &str) -> PathBuf {
    bin_dir.join(app)
}

/// Names the first missing binary among `apps` with the cargo command that builds it.
pub fn check_binaries(bin_dir: &Path, apps: &[&str]) -> Result<(), String> {
    for app in apps {
        let path = binary_path(bin_dir, app);
        if !path.is_file() {
            return Err(format!(
                "the {app} binary is missing: {} does not exist\nbuild it with: cargo build -p {app}\n(or point --bin-dir at the folder that holds it)",
                path.display()
            ));
        }
    }
    Ok(())
}

fn run_one(ctx: &Context, case: &Case, fixtures_source: &[(String, Vec<u8>)]) -> CaseResult {
    let mut notes = Vec::new();
    let expected_dir = ctx.conformance_dir.join("expected").join(&case.id);
    let expected = load_expected(&expected_dir).unwrap_or_else(|e| {
        notes.push(e);
        Observed::default()
    });
    let layout = Layout::new(&ctx.scratch_dir.join(&case.id), case.cwd.as_deref());
    let mut actual = Observed::default();
    let mut parts = Vec::new();
    let setup = layout
        .create(&ctx.conformance_dir.join("fixtures"))
        .map_err(|e| format!("cannot create sandbox: {e}"));
    match setup {
        Err(e) => notes.push(e),
        Ok(()) => {
            let input = match &case.session {
                Some(items) => Input::Session(session_steps(
                    items,
                    fs::read(expected_dir.join("stdin")).ok().as_deref(),
                )),
                None => Input::Text(case.stdin.clone().unwrap_or_default().into_bytes()),
            };
            let spec = Spec {
                program: binary_path(&ctx.bin_dir, &case.app),
                args: case
                    .argv
                    .iter()
                    .map(|a| crate::sandbox::substitute(a, &layout.work))
                    .collect(),
                cwd: layout.cwd.clone(),
                env: scrubbed_env(&layout, &ctx.path_var, case.env.as_ref()),
            };
            match run_process(&spec, &input, TIMEOUT) {
                Err(e) => notes.push(e),
                Ok(raw) => {
                    if raw.timed_out {
                        notes.push(format!("timed out after {} seconds", TIMEOUT.as_secs()));
                    } else if raw.code.is_none() {
                        notes.push("the process ended by a signal".into());
                    }
                    let spellings = work_spellings(&layout.work);
                    actual = Observed {
                        stdout: normalize(&raw.stdout, &spellings),
                        stderr: normalize(&raw.stderr, &spellings),
                        exit: raw.code,
                        files: list_files(&layout.work)
                            .into_iter()
                            .map(|(name, bytes)| (name, normalize(&bytes, &spellings)))
                            .collect(),
                    };
                    parts = differing_parts(&expected, &actual);
                    if list_files(&layout.fixtures) != fixtures_source {
                        parts.push(Part::Fixtures);
                        notes.push("the case changed its copy of the fixtures".into());
                    }
                }
            }
        }
    }
    // A sandbox that cannot be removed is left for the next run, which clears it first.
    let _ = fs::remove_dir_all(&layout.root);
    let accepted = ctx.accepted.iter().find(|a| a.id == case.id);
    let status = if notes.is_empty() || !parts.is_empty() {
        classify(&parts, accepted)
    } else {
        Status::Failed
    };
    CaseResult {
        id: case.id.clone(),
        group: case.group.clone(),
        status,
        parts,
        expected,
        actual,
        notes,
    }
}

/// Runs `cases` on `ctx.jobs` threads; results come back in case order.
pub fn run_cases(ctx: &Context, cases: &[&Case]) -> Vec<CaseResult> {
    let fixtures_source = list_files(&ctx.conformance_dir.join("fixtures"));
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<CaseResult>>> = Mutex::new(vec![None; cases.len()]);
    thread::scope(|scope| {
        for _ in 0..ctx.jobs.max(1) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    let Some(case) = cases.get(i) else { break };
                    let result = run_one(ctx, case, &fixtures_source);
                    if let Ok(mut slots) = results.lock() {
                        slots[i] = Some(result);
                    }
                }
            });
        }
    });
    results
        .into_inner()
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn entry(parts: &[&str]) -> Accepted {
        Accepted {
            id: "x".into(),
            parts: parts.iter().map(|p| (*p).to_string()).collect(),
            row: "r".into(),
            reason: "r".into(),
        }
    }

    #[test]
    fn verdicts() {
        assert_eq!(classify(&[], None), Status::Passed);
        assert_eq!(classify(&[Part::Stdout], None), Status::Failed);
        assert_eq!(
            classify(&[Part::Stdout], Some(&entry(&["stdout", "exit"]))),
            Status::Accepted
        );
        assert_eq!(
            classify(&[Part::Stdout, Part::Stderr], Some(&entry(&["stdout"]))),
            Status::Failed
        );
        assert_eq!(classify(&[], Some(&entry(&["stdout"]))), Status::Stale);
        assert_eq!(
            classify(&[Part::Fixtures], Some(&entry(&["stdout"]))),
            Status::Failed
        );
    }

    #[test]
    fn a_missing_binary_names_the_cargo_command() {
        let message = check_binaries(Path::new("/nonexistent-bin-dir"), &["textstat"]).unwrap_err();
        assert!(message.contains("cargo build -p textstat"), "{message}");
    }
}
