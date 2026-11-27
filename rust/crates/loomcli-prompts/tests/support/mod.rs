//! What the prompts tests share: running an application on a mock process, and reading what a
//! terminal shows of stderr.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

pub mod progress;
pub mod screen;

use std::future::Future;
use std::sync::{Arc, Mutex};

use loomcli_core::{Application, Context, Done, Error, NoInputs, NoResult, RunOptions};
use loomcli_testing::{KeyEntry, MockFields, MockProcess, MockTerminal, StreamName, mock_process};

/// An application with no inputs or result.
pub type App = Application<NoInputs, NoResult, Done>;

/// A slot an action writes its answer into, which the test reads after the run.
pub type Slot<T> = Arc<Mutex<Option<T>>>;

/// An empty slot.
pub fn slot<T>() -> Slot<T> {
    Arc::new(Mutex::new(None))
}

/// The value a slot holds.
pub fn taken<T: Clone>(slot: &Slot<T>) -> Option<T> {
    slot.lock().unwrap().clone()
}

/// A mock whose stdin and stderr sit on a terminal of this size with this keyboard.
pub fn keyboard(columns: u16, rows: u16, keys: Vec<KeyEntry>) -> Arc<MockProcess> {
    mock_process(MockFields::new().terminal(MockTerminal::new(columns, rows).keys(keys)))
}

/// One entry of one read.
pub fn entry(read: &str) -> KeyEntry {
    KeyEntry::reads([read])
}

/// One entry of several reads.
pub fn reads(reads: &[&str]) -> KeyEntry {
    KeyEntry::reads(reads.iter().copied())
}

/// A mock with stderr alone on a terminal of this size.
pub fn stderr_terminal(columns: u16, rows: u16) -> Arc<MockProcess> {
    mock_process(
        MockFields::new().terminal(MockTerminal::new(columns, rows).streams([StreamName::Stderr])),
    )
}

/// Runs `app` on `mock` and answers its exit code.
pub async fn run(app: App, mock: &Arc<MockProcess>) -> u8 {
    app.run(RunOptions::new().process(Arc::clone(mock) as _))
        .await
        .get()
}

/// Runs an application whose action is `act` on `mock`.
pub async fn run_action<F, Fut>(mock: &Arc<MockProcess>, act: F) -> u8
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    let app: App = Application::new("ask").action(act);
    run(app, mock).await
}

/// `text` without its terminal control sequences, as Node's `stripVTControlCharacters` reads it.
pub fn strip(text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut result = String::new();
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == '\u{1b}' || character == '\u{9b}' {
            let mut next = index + 1;
            if character == '\u{1b}' && characters.get(next) == Some(&']') {
                // An OSC string, up to BEL or ST.
                next += 1;
                while next < characters.len() {
                    if characters[next] == '\u{7}' {
                        next += 1;
                        break;
                    }
                    if characters[next] == '\u{1b}' && characters.get(next + 1) == Some(&'\\') {
                        next += 2;
                        break;
                    }
                    next += 1;
                }
                index = next;
                continue;
            }
            if character == '\u{1b}' && characters.get(next) == Some(&'[') {
                next += 1;
            } else if character == '\u{1b}' {
                index = next + 1;
                continue;
            }
            while next < characters.len() && !('\u{40}'..='\u{7e}').contains(&characters[next]) {
                next += 1;
            }
            index = next + 1;
            continue;
        }
        result.push(character);
        index += 1;
    }
    result
}

/// `text` with each SGR sequence that turns inverse on read as `[`, and off as `]`, then stripped.
pub fn marked(text: &str) -> String {
    let mut pieces = text.split("\u{1b}[");
    let mut result = pieces.next().unwrap_or_default().to_owned();
    for piece in pieces {
        let end = piece.find('m').unwrap_or(piece.len());
        let params: Vec<&str> = piece[..end].split(';').collect();
        if params.contains(&"7") {
            result.push('[');
        } else if params.contains(&"27") {
            result.push(']');
        }
        if end < piece.len() {
            result.push_str(&piece[end + 1..]);
        }
    }
    strip(&result)
}
