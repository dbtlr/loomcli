//! The logging plugin's size rotation, ported from the reference's `logging.test.ts`. The reference
//! starts two real processes for its concurrency cases; these run two applications on two threads
//! of this process, which append to and rotate one file the same way. The rename that loses a race,
//! `logging-rotation.test.ts`, is a unit test in `src/logging/file.rs`.

#![cfg(feature = "logging")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod logging_support;

use std::collections::BTreeSet;
use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use logging_support::{Facts, Sandbox, lines, message_in, names, run};
use loomcli_core::{Application, Context, ProcessHandle, RunOptions};
use loomcli_plugins::logging::logging;
use loomcli_testing::{MockFields, mock_process};
use serde_json::Value;

fn messages(path: &std::path::Path) -> Vec<String> {
    lines(path)
        .iter()
        .map(|line| {
            let value: Value = serde_json::from_str(line).unwrap();
            value["message"].as_str().unwrap().to_owned()
        })
        .collect()
}

#[tokio::test]
async fn with_max_bytes_200_and_keep_2_writes_past_the_size_leave_the_file_and_two_copies() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["burst", "5", "0", "m"],
        Facts::default(),
        logging().keep(2).max_bytes(200),
    )
    .await;
    let directory = sandbox.directory();
    assert_eq!(
        names(&directory),
        ["heimdall.1.jsonl", "heimdall.2.jsonl", "heimdall.jsonl"]
    );
    assert_eq!(
        [
            message_in(&directory.join("heimdall.jsonl")),
            message_in(&directory.join("heimdall.1.jsonl")),
            message_in(&directory.join("heimdall.2.jsonl")),
        ],
        ["m5", "m4", "m3"]
    );
}

#[tokio::test]
async fn with_keep_0_a_write_past_max_bytes_deletes_the_file_and_a_new_one_starts_with_no_copy() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["burst", "3", "0", "m"],
        Facts::default(),
        logging().keep(0).max_bytes(200),
    )
    .await;
    assert_eq!(names(&sandbox.directory()), ["heimdall.jsonl"]);
    assert_eq!(messages(&sandbox.file), ["m3"]);
}

#[tokio::test]
async fn a_copy_of_a_file_with_no_extension_puts_its_number_after_the_name() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["burst", "3", "0", "m"],
        Facts::default(),
        logging().file("hub").keep(2).max_bytes(200),
    )
    .await;
    assert_eq!(names(&sandbox.directory()), ["hub", "hub.1", "hub.2"]);
}

#[tokio::test]
async fn a_record_larger_than_max_bytes_lands_whole_in_a_new_file() {
    let sandbox = Sandbox::new();
    let settings = || logging().max_bytes(200);
    run(
        &sandbox,
        &["burst", "1", "0", "s"],
        Facts::default(),
        settings(),
    )
    .await;
    run(
        &sandbox,
        &["burst", "1", "600", "big"],
        Facts::default(),
        settings(),
    )
    .await;
    let directory = sandbox.directory();
    let big: Value = serde_json::from_str(
        fs::read_to_string(directory.join("heimdall.jsonl"))
            .unwrap()
            .trim_end(),
    )
    .unwrap();
    assert_eq!(big["message"], "big1");
    assert_eq!(big["fields"]["payload"].as_str().unwrap().len(), 600);
    assert_eq!(message_in(&directory.join("heimdall.1.jsonl")), "s1");
    run(
        &sandbox,
        &["burst", "1", "0", "t"],
        Facts::default(),
        settings(),
    )
    .await;
    assert_eq!(message_in(&directory.join("heimdall.jsonl")), "t1");
    assert_eq!(message_in(&directory.join("heimdall.1.jsonl")), "big1");
}

#[tokio::test]
async fn an_oversize_record_written_to_a_file_that_does_not_exist_lands_whole_in_it() {
    let sandbox = Sandbox::new();
    run(
        &sandbox,
        &["burst", "1", "600", "big"],
        Facts::default(),
        logging().max_bytes(200),
    )
    .await;
    assert_eq!(names(&sandbox.directory()), ["heimdall.jsonl"]);
    let big: Value =
        serde_json::from_str(fs::read_to_string(&sandbox.file).unwrap().trim_end()).unwrap();
    assert_eq!(big["fields"]["payload"].as_str().unwrap().len(), 600);
}

/// Logs `rounds` batches of `batch` records named `<turn>-<round>-<number>` through the plugin on
/// its own thread. With a baton, each batch waits for the baton to name this turn and hands it on.
fn writer(
    sandbox: &Sandbox,
    turn: usize,
    baton: Option<Arc<AtomicUsize>>,
    rounds: usize,
    batch: usize,
) -> std::thread::JoinHandle<(u8, String)> {
    let state = sandbox.state.clone();
    let home = sandbox.home.clone();
    let work = sandbox.work.clone();
    std::thread::spawn(move || {
        let label = ["a", "b"][turn];
        let app = Application::new("heimdall")
            .description("A fixture application.")
            .plugins((logging().keep(100).max_bytes(400),))
            .action(move |ctx: Context| {
                let baton = baton.clone();
                async move {
                    for round in 1..=rounds {
                        while baton
                            .as_ref()
                            .is_some_and(|baton| baton.load(Ordering::SeqCst) != turn)
                        {
                            std::thread::sleep(Duration::from_millis(1));
                        }
                        for number in 1..=batch {
                            ctx.log.info(&format!("{label}-{round}-{number}"), ());
                        }
                        if let Some(baton) = &baton {
                            baton.store(1 - turn, Ordering::SeqCst);
                        }
                    }
                    Ok(())
                }
            });
        let process = mock_process(
            MockFields::new()
                .cwd(work)
                .home(home.clone())
                .env("HOME", &home.display().to_string())
                .env("XDG_STATE_HOME", &state.display().to_string()),
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let code = runtime.block_on(
            app.run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>)),
        );
        (code.get(), process.stderr_text())
    })
}

/// Every message in the file and its copies.
fn all_messages(sandbox: &Sandbox) -> Vec<String> {
    let directory = sandbox.directory();
    names(&directory)
        .iter()
        .flat_map(|name| {
            fs::read_to_string(directory.join(name))
                .unwrap()
                .lines()
                .map(|line| {
                    let value: Value = serde_json::from_str(line).unwrap();
                    value["message"].as_str().unwrap().to_owned()
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[test]
fn two_writers_that_take_turns_appending_and_rotating_one_file_lose_no_record() {
    let sandbox = Sandbox::new();
    let baton = Arc::new(AtomicUsize::new(0));
    let first = writer(&sandbox, 0, Some(Arc::clone(&baton)), 3, 5);
    let second = writer(&sandbox, 1, Some(baton), 3, 5);
    assert_eq!(first.join().unwrap(), (0, String::new()));
    assert_eq!(second.join().unwrap(), (0, String::new()));
    let mut found = all_messages(&sandbox);
    found.sort();
    let mut expected: Vec<String> = ["a", "b"]
        .iter()
        .flat_map(|turn| {
            (1..=3).flat_map(move |round| {
                (1..=5).map(move |number| format!("{turn}-{round}-{number}"))
            })
        })
        .collect();
    expected.sort();
    assert_eq!(found, expected);
}

#[test]
fn two_writers_that_append_and_rotate_one_file_at_once_write_every_line_whole_none_twice() {
    let sandbox = Sandbox::new();
    let first = writer(&sandbox, 0, None, 20, 10);
    let second = writer(&sandbox, 1, None, 20, 10);
    assert_eq!(first.join().unwrap(), (0, String::new()));
    assert_eq!(second.join().unwrap(), (0, String::new()));
    // A simultaneous rotation may lose records from a copy, but no line is torn or written twice.
    let found = all_messages(&sandbox);
    assert!(!found.is_empty());
    assert!(found.iter().all(|message| {
        let parts: Vec<&str> = message.split('-').collect();
        parts.len() == 3
            && ["a", "b"].contains(&parts[0])
            && parts[1..].iter().all(|part| part.parse::<u32>().is_ok())
    }));
    let unique: BTreeSet<&String> = found.iter().collect();
    assert_eq!(unique.len(), found.len());
}
