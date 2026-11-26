//! What `install` and `uninstall` share: the agents they register with, the registration an
//! application holds with one, the one call that runs an agent's program through the run's
//! `host.spawn`, the checks made before any program starts, and the agent output a failure
//! repeats.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use loomcli_core::{ChildExit, Error, FatalError, Host, NoResult, Out, RunSignal, SpawnOptions};

use super::messages::{self, Child, Names, shown};
use crate::installation::{PluginRecord, RecordedRegistration, RegistrationRead, record_directory};

/// One agent: the program that starts it and the words of each call the plugin makes. Each is one
/// program with a registration command-line interface, so this table is the MCP plugin's own and
/// is not the skills plugin's table of folder layouts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum Agent {
    Claude,
    Codex,
}

/// Every agent, in the order every child follows.
pub(super) const AGENTS: [Agent; 2] = [Agent::Claude, Agent::Codex];

/// The agent names `--agent` accepts.
pub(super) const AGENT_NAMES: [&str; 2] = ["claude", "codex"];

impl Agent {
    /// The agent's name, which is also its program.
    pub(super) fn name(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
        }
    }

    /// The agent `--agent` named; the validator already limited the value to the two names.
    pub(super) fn named(name: &str) -> Option<Agent> {
        AGENTS.into_iter().find(|agent| agent.name() == name)
    }

    /// The words of the call that shows the agent's CLI can start.
    pub(super) fn version(self) -> Vec<String> {
        words(&["--version"])
    }

    /// The words of the call that tells whether the agent holds a name, for an agent that has
    /// one.
    pub(super) fn name_check(self, name: &str) -> Option<Vec<String>> {
        match self {
            Agent::Claude => None,
            Agent::Codex => Some(words(&["mcp", "get", name, "--json"])),
        }
    }

    /// The words of the call that registers `name` to run `command`.
    pub(super) fn add(self, name: &str, command: &[String]) -> Vec<String> {
        let mut add = match self {
            Agent::Claude => words(&["mcp", "add", "-s", "user", name, "--"]),
            Agent::Codex => words(&["mcp", "add", name, "--"]),
        };
        add.extend(command.iter().cloned());
        add
    }

    /// The words of the call that removes the registration `name`.
    pub(super) fn remove(self, name: &str) -> Vec<String> {
        match self {
            Agent::Claude => words(&["mcp", "remove", "-s", "user", name]),
            Agent::Codex => words(&["mcp", "remove", name]),
        }
    }

    /// The plugin's file in the installation record for the agent, `mcp.<agent>.json`.
    pub(super) fn record_name(self) -> String {
        format!("mcp.{}", self.name())
    }
}

fn words(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| (*word).to_owned()).collect()
}

/// The agents a child acts on: the one `--agent` names, or every agent.
pub(super) fn selected_agents(named: Option<Agent>) -> Vec<Agent> {
    match named {
        Some(agent) => vec![agent],
        None => AGENTS.to_vec(),
    }
}

/// The registration name: the application's name with each `.` written as `_`, because Claude
/// Code's server names hold only letters, digits, `-`, and `_`.
pub(super) fn registration_name(application: &str) -> String {
    application.replace('.', "_")
}

/// The words that start this application's server again: `host.program`, then `mcp`.
pub(super) fn command_line(host: &Host) -> Vec<String> {
    let mut command = host.program.clone();
    command.push("mcp".to_owned());
    command
}

/// What one call to an agent's program answered.
pub(super) enum Answer {
    Unstarted,
    Exited {
        code: i32,
        stdout: String,
        stderr: String,
    },
}

impl Answer {
    /// Whether the call exited 0.
    pub(super) fn succeeded(&self) -> bool {
        matches!(self, Answer::Exited { code: 0, .. })
    }

    /// The code an `exited` answer holds, and none for a call that could not start.
    pub(super) fn code(&self) -> Option<i32> {
        match self {
            Answer::Exited { code, .. } => Some(*code),
            Answer::Unstarted => None,
        }
    }
}

/// What a child reads from its action: the application, the run, and the lanes it writes.
pub(super) struct ChildRun<'a> {
    pub(super) name: &'a str,
    pub(super) registration: String,
    pub(super) host: &'a Host,
    pub(super) signal: &'a RunSignal,
    pub(super) out: &'a Out<NoResult>,
}

impl<'a> ChildRun<'a> {
    pub(super) fn new(
        name: &'a str,
        host: &'a Host,
        signal: &'a RunSignal,
        out: &'a Out<NoResult>,
    ) -> Self {
        Self {
            name,
            registration: registration_name(name),
            host,
            signal,
            out,
        }
    }

    /// The names a sentence of the run uses.
    pub(super) fn names(&self) -> Names<'_> {
        Names {
            app: self.name,
            registration: &self.registration,
        }
    }

    /// Runs one agent call with the host's environment and working directory, no shell and no
    /// input, its output captured, until it exits or the run signal ends it with `SIGTERM`. A
    /// program that cannot start answers `Unstarted`. A run signal that has been cancelled, before
    /// the call or by the time it ends, returns the run's cancellation echo in place of an
    /// answer, so no later call starts.
    pub(super) async fn call(&self, agent: Agent, args: Vec<String>) -> Result<Answer, Error> {
        self.signal.throw_if_cancelled()?;
        let child = self.host.spawn(
            agent.name(),
            args,
            SpawnOptions::new().signal(self.signal.token()),
        );
        let answer = match child.exited().await {
            ChildExit::Exited {
                code,
                stdout,
                stderr,
            } => Answer::Exited {
                code,
                stdout: stdout.text,
                stderr: stderr.text,
            },
            _ => Answer::Unstarted,
        };
        self.signal.throw_if_cancelled()?;
        Ok(answer)
    }

    /// Whether the agent's CLI starts, whatever its exit code.
    pub(super) async fn starts(&self, agent: Agent) -> Result<bool, Error> {
        Ok(matches!(
            self.call(agent, agent.version()).await?,
            Answer::Exited { .. }
        ))
    }

    /// Prints the agent's captured standard error and then its standard output through
    /// `out.warn`, one line each, none of them blank.
    pub(super) async fn warn_output(&self, answer: &Answer) -> Result<(), Error> {
        let Answer::Exited { stdout, stderr, .. } = answer else {
            return Ok(());
        };
        for line in [stderr, stdout].into_iter().flat_map(|text| lines_of(text)) {
            if line.chars().any(|character| !is_js_space(character)) {
                self.out.warn(&shown(line)).await?;
            }
        }
        Ok(())
    }

    /// Refuses a child on `win32`, before it reads anything.
    pub(super) fn refuse_windows(&self, child: Child) -> Result<(), Error> {
        if self.host.platform == "win32" {
            return Err(FatalError::new(messages::not_on_windows(self.name, child)).into());
        }
        Ok(())
    }

    /// The record's directory, or the refusal of an environment that cannot name one.
    pub(super) fn record_directory(&self) -> Result<PathBuf, Error> {
        Ok(record_directory(self.name, self.host)?)
    }

    /// The registration each agent's plugin's file records, or the refusal of one it cannot read.
    /// Once every file reads, the staging files a killed write left beside them are removed.
    pub(super) fn read_records(
        &self,
        record: &Path,
        agents: &[Agent],
        child: Child,
    ) -> Result<HashMap<Agent, Option<RecordedRegistration>>, Error> {
        let mut recorded = HashMap::new();
        for agent in agents {
            match PluginRecord::new(record, agent.record_name()).read_registration()? {
                RegistrationRead::Refused(refused) => {
                    return Err(FatalError::new(messages::record(
                        self.name,
                        &refused.path.to_string_lossy(),
                        child,
                    ))
                    .into());
                }
                RegistrationRead::Read(registration) => {
                    recorded.insert(*agent, registration);
                }
            }
        }
        for agent in agents {
            PluginRecord::new(record, agent.record_name()).remove_staging()?;
        }
        Ok(recorded)
    }
}

/// JavaScript's `\s`: Unicode White_Space without U+0085, plus U+FEFF, as `trim` reads it.
fn is_js_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

/// A text's lines, split at CRLF, LF, or CR.
fn lines_of(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                lines.push(&text[start..index]);
                index += if bytes.get(index + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                };
                start = index;
            }
            b'\n' => {
                lines.push(&text[start..index]);
                index += 1;
                start = index;
            }
            _ => index += 1,
        }
    }
    lines.push(&text[start..]);
    lines
}

#[cfg(test)]
mod tests {
    use super::lines_of;

    #[test]
    fn lines_split_at_crlf_lf_and_cr() {
        assert_eq!(lines_of("a\r\nb\nc\rd"), ["a", "b", "c", "d"]);
        assert_eq!(lines_of("a\n"), ["a", ""]);
        assert_eq!(lines_of(""), [""]);
    }
}
