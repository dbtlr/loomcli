//! Drives the printed Bash script through a real Bash, without a pseudo-terminal, for the cases of
//! `completion-shells.test.ts` that the answer and the script alone decide. The reference types
//! each line into a pseudo-terminal and reads back what Tab leaves; here the test sets the
//! variables Bash sets for a completion function (`COMP_WORDS`, `COMP_CWORD`, `COMP_LINE`,
//! `COMP_POINT`, `COMP_TYPE`), calls `__start_kit`, and reads `COMPREPLY`. The program the script
//! calls is a stub that prints the answer this crate's own `__complete` wrote for the same words,
//! so the answer and the script are proven against each other. It logs the words it received.

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::process::Command as Process;

use completion_support::{TempDir, complete};
use loomcli_plugins::completion::test_support::bash_script;

/// What the stub program does when the script calls it.
enum Stub {
    Prints(String),
    Fails,
}

/// What a completion left: `COMPREPLY`, and the words the stub received if it ran.
struct Completed {
    reply: Vec<String>,
    received: Option<Vec<String>>,
}

fn bash_available() -> bool {
    match Process::new("bash").args(["-c", "true"]).output() {
        Ok(_) => true,
        Err(_) => {
            assert!(
                std::env::var_os("LOOM_REQUIRE_SHELLS").is_none(),
                "LOOM_REQUIRE_SHELLS is set, but bash not installed."
            );
            false
        }
    }
}

/// Single-quotes text for Bash.
fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// Presses Tab at the end of the words, as Bash 3.2 and later hand them to a completion function.
fn tab(words: &[&str], stub: &Stub) -> Completed {
    tab_line(&words.join(" "), words, stub)
}

/// Presses Tab at the end of a line, which Bash split into `words`.
fn tab_line(line: &str, words: &[&str], stub: &Stub) -> Completed {
    let directory = TempDir::new("loom-bash-driver");
    let program = directory.path.join("kit");
    let log = directory.path.join("received");
    let body = match stub {
        Stub::Prints(answer) => format!(
            "#!/bin/sh\nfor word in \"$@\"; do printf '%s\\n' \"$word\"; done > {}\nprintf '%s' {}\n",
            quoted(&log.to_string_lossy()),
            quoted(answer)
        ),
        Stub::Fails => format!(
            "#!/bin/sh\nfor word in \"$@\"; do printf '%s\\n' \"$word\"; done > {}\nexit 1\n",
            quoted(&log.to_string_lossy())
        ),
    };
    fs::write(&program, body).unwrap();
    fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
    let script = directory.path.join("script");
    fs::write(&script, bash_script("kit")).unwrap();
    let array: Vec<String> = words.iter().map(|word| quoted(word)).collect();
    let driver = format!(
        "source {script}; COMP_WORDS=({array}); COMP_CWORD={last}; COMP_LINE={line}; COMP_POINT=${{#COMP_LINE}}; COMP_TYPE=9; COLUMNS=80; compopt() {{ :; }}; __start_kit; printf '%s\\n' \"${{COMPREPLY[@]}}\"",
        script = quoted(&script.to_string_lossy()),
        array = array.join(" "),
        last = words.len() - 1,
        line = quoted(line),
    );
    let output = Process::new("bash")
        .args(["--noprofile", "--norc", "-c", &driver])
        .env_clear()
        .env("HOME", &directory.path)
        .env(
            "PATH",
            format!(
                "{}:{}",
                directory.path.display(),
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .current_dir(&directory.path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reply: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect();
    let received = fs::read_to_string(&log)
        .ok()
        .map(|text| text.lines().map(str::to_owned).collect());
    Completed { reply, received }
}

/// The answer this crate's `__complete` writes for the words after the program word.
async fn answer_for(words: &[&str]) -> Stub {
    Stub::Prints(complete(words).await)
}

/// Removes one level of POSIX quoting from an inserted word: backslash escapes and single quotes,
/// which are the forms the script inserts.
fn unquoted(word: &str) -> String {
    let mut text = String::new();
    let mut characters = word.chars();
    while let Some(character) = characters.next() {
        match character {
            '\\' => text.extend(characters.next()),
            '\'' => {
                for inner in characters.by_ref() {
                    if inner == '\'' {
                        break;
                    }
                    text.push(inner);
                }
            }
            other => text.push(other),
        }
    }
    text
}

fn words_of(reply: &[String]) -> Vec<String> {
    // A reply of several words holds each word, then two spaces and its description in
    // parentheses, padded to align.
    let mut words: Vec<String> = reply
        .iter()
        .map(|entry| entry.split("  (").next().unwrap().trim_end().to_owned())
        .collect();
    words.sort();
    words
}

fn call(program_words: &[&str]) -> Vec<String> {
    ["completion", "__complete", "--"]
        .iter()
        .chain(program_words)
        .map(|word| (*word).to_owned())
        .collect()
}

#[tokio::test]
async fn kit_tab_lists_the_visible_commands() {
    if !bash_available() {
        return;
    }
    let done = tab(&["kit", ""], &answer_for(&[""]).await);
    assert_eq!(
        words_of(&done.reply),
        ["cache", "completion", "keys", "paths"]
    );
    assert_eq!(done.received, Some(call(&[""])));
}

#[tokio::test]
async fn kit_paths_f_t_tab_inserts_the_value_attached_to_the_value_letter() {
    if !bash_available() {
        return;
    }
    let done = tab(
        &["kit", "paths", "-qft"],
        &answer_for(&["paths", "-qft"]).await,
    );
    assert_eq!(done.reply, ["-qftable"]);
    assert_eq!(done.received, Some(call(&["paths", "-qft"])));
}

#[tokio::test]
async fn kit_paths_qf_tab_lists_the_values_the_groups_last_value_letter_awaits() {
    if !bash_available() {
        return;
    }
    let done = tab(
        &["kit", "paths", "-qf", ""],
        &answer_for(&["paths", "-qf", ""]).await,
    );
    assert_eq!(words_of(&done.reply), ["json", "jsonl", "table"]);
}

#[tokio::test]
async fn kit_backups_v_verb_tab_inserts_the_counted_verbose_again() {
    if !bash_available() {
        return;
    }
    let done = tab(
        &["kit", "backups", "-v", "--verb"],
        &answer_for(&["backups", "-v", "--verb"]).await,
    );
    assert_eq!(done.reply, ["--verbose"]);
}

#[tokio::test]
async fn kit_backups_backup_equals_tab_lists_the_values_of_the_option_with_an_implied_value() {
    if !bash_available() {
        return;
    }
    // Bash splits the line at `=`, a word break, and the script glues the words back together.
    let done = tab_line(
        "kit backups --backup=",
        &["kit", "backups", "--backup", "="],
        &answer_for(&["backups", "--backup="]).await,
    );
    assert_eq!(done.received, Some(call(&["backups", "--backup="])));
    // Bash lists the words after the last `=`.
    assert_eq!(words_of(&done.reply), ["none", "numbered", "simple"]);
}

#[tokio::test]
async fn kit_backups_backup_tab_lists_what_the_next_word_may_be_and_no_value() {
    if !bash_available() {
        return;
    }
    let done = tab(
        &["kit", "backups", "--backup", ""],
        &answer_for(&["backups", "--backup", ""]).await,
    );
    assert_eq!(words_of(&done.reply), ["disk", "tape"]);
}

#[tokio::test]
async fn kit_stats_depth_m_tab_inserts_max_three_levels_below_the_root() {
    if !bash_available() {
        return;
    }
    let done = tab(
        &["kit", "stats", "depth", "m"],
        &answer_for(&["stats", "depth", "m"]).await,
    );
    assert_eq!(done.reply, ["max"]);
}

#[tokio::test]
async fn a_misplaced_option_earlier_in_the_line_inserts_and_lists_nothing() {
    if !bash_available() {
        return;
    }
    let done = tab(
        &["kit", "-q", "paths", "-"],
        &answer_for(&["-q", "paths", "-"]).await,
    );
    assert!(done.reply.is_empty(), "{:?}", done.reply);
}

#[tokio::test]
async fn an_unknown_command_earlier_in_the_line_inserts_and_lists_nothing() {
    if !bash_available() {
        return;
    }
    let done = tab(&["kit", "nope", "a"], &answer_for(&["nope", "a"]).await);
    assert!(done.reply.is_empty(), "{:?}", done.reply);
}

#[tokio::test]
async fn an_unclosed_quote_under_the_cursor_inserts_and_lists_nothing_without_a_call() {
    if !bash_available() {
        return;
    }
    let done = tab(&["kit", "keys", "\"p"], &answer_for(&["keys", "p"]).await);
    assert!(done.reply.is_empty(), "{:?}", done.reply);
    assert_eq!(done.received, None);
}

#[tokio::test]
async fn a_callback_that_exits_nonzero_inserts_and_lists_nothing() {
    if !bash_available() {
        return;
    }
    let done = tab(&["kit", "--file", "a"], &Stub::Fails);
    assert!(done.reply.is_empty(), "{:?}", done.reply);
    assert_eq!(done.received, Some(call(&["--file", "a"])));
}

#[tokio::test]
async fn an_answer_whose_directive_line_is_a_bare_colon_inserts_and_lists_nothing() {
    if !bash_available() {
        return;
    }
    let done = tab(&["kit", "--file", "a"], &Stub::Prints(":\n".to_owned()));
    assert!(done.reply.is_empty(), "{:?}", done.reply);
}

#[tokio::test]
async fn a_closed_set_value_that_starts_with_a_shell_metacharacter_is_inserted_as_quoted_text() {
    if !bash_available() {
        return;
    }
    for (typed, argument, value) in [
        ("\\$", "$", "$(touch sentinel)"),
        ("\\`", "`", "`touch sentinel`"),
        (r"\;", ";", ";touch sentinel"),
    ] {
        let done = tab(
            &["kit", "keys", typed],
            &answer_for(&["keys", argument]).await,
        );
        assert_eq!(done.reply.len(), 1, "{typed}: {:?}", done.reply);
        assert_ne!(done.reply[0], value);
        assert_eq!(unquoted(&done.reply[0]), value);
        assert_eq!(done.received, Some(call(&["keys", argument])));
    }
}

#[tokio::test]
async fn the_listed_values_leave_out_the_one_holding_a_newline_and_every_other_unsafe_value() {
    if !bash_available() {
        return;
    }
    let done = tab(&["kit", "keys", ""], &answer_for(&["keys", ""]).await);
    let mut listed: Vec<String> = done.reply.iter().map(|word| unquoted(word)).collect();
    listed.sort();
    let mut expected = vec![
        "plain".to_owned(),
        "$(touch sentinel)".to_owned(),
        "`touch sentinel`".to_owned(),
        ";touch sentinel".to_owned(),
    ];
    expected.sort();
    assert_eq!(listed, expected);
}

#[tokio::test]
async fn several_values_that_share_a_prefix_insert_the_prefix_after_a_typed_escape_as_quoted_text()
{
    if !bash_available() {
        return;
    }
    for (typed, argument, prefix) in [("\\$", "$", "$(touch sentinel)"), ("a\\ ", "a ", "a b")] {
        let done = tab(
            &["kit", "odd", "values", typed],
            &answer_for(&["odd", "values", argument]).await,
        );
        assert_eq!(done.reply.len(), 2, "{typed}: {:?}", done.reply);
        let escaped: Vec<String> = done
            .reply
            .iter()
            .map(|entry| {
                entry
                    .split('\t')
                    .next()
                    .unwrap()
                    .split("  (")
                    .next()
                    .unwrap()
                    .trim_end()
                    .to_owned()
            })
            .collect();
        let common = escaped
            .iter()
            .map(String::as_str)
            .reduce(|a, b| {
                let length = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
                &a[..a
                    .char_indices()
                    .nth(length)
                    .map_or(a.len(), |(index, _)| index)]
            })
            .unwrap();
        assert_ne!(common, prefix, "{typed}");
        assert!(unquoted(common).starts_with(prefix), "{typed}: {common}");
    }
}
