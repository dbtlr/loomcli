//! Loading the case files and the session rules (what a session sends and what it waits for).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

use crate::exec::SessionStep;

/// One corpus invocation.
#[derive(Debug, Clone, Deserialize)]
pub struct Case {
    /// Unique id; names the folder under `expected/`.
    pub id: String,
    /// `jsonkit` or `textstat`.
    pub app: String,
    /// Arguments after the program name; `{sandbox}` is substituted.
    pub argv: Vec<String>,
    /// Text written to stdin in one piece.
    pub stdin: Option<String>,
    /// Interactive stdin script, never combined with `stdin`.
    pub session: Option<Vec<Value>>,
    /// Environment variables to set; `{sandbox}` is substituted in values.
    pub env: Option<BTreeMap<String, String>>,
    /// Folder under `fixtures/` used as the working directory.
    pub cwd: Option<String>,
    /// The case file's name without `.json`.
    #[serde(skip)]
    pub group: String,
}

#[derive(Deserialize)]
struct CaseFile {
    cases: Vec<Case>,
}

/// Reads every `cases/*.json` file under `conformance_dir`, sorted by file name.
pub fn load_cases(conformance_dir: &Path) -> Result<Vec<Case>, String> {
    let dir = conformance_dir.join("cases");
    let mut files: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    let mut cases = Vec::new();
    for file in files {
        let text = fs::read_to_string(&file)
            .map_err(|e| format!("cannot read {}: {e}", file.display()))?;
        let parsed: CaseFile = serde_json::from_str(&text)
            .map_err(|e| format!("cannot parse {}: {e}", file.display()))?;
        let group = file
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        for mut case in parsed.cases {
            case.group.clone_from(&group);
            cases.push(case);
        }
    }
    Ok(cases)
}

/// The line one session item sends: a string is a raw line, any other value is compact JSON.
pub fn session_line(item: &Value) -> String {
    match item {
        Value::String(s) => format!("{s}\n"),
        other => format!("{other}\n"),
    }
}

/// Whether the server answers a session item: a non-blank raw line, or a JSON object with an
/// `id` and neither `result` nor `error`.
pub fn expects_answer(item: &Value) -> bool {
    match item {
        Value::String(s) => !s.trim().is_empty(),
        Value::Object(map) => {
            map.contains_key("id") && !map.contains_key("result") && !map.contains_key("error")
        }
        _ => false,
    }
}

/// The steps of a session. When `recorded` (the bytes of `expected/<id>/stdin`) splits into as many
/// lines as the session has items, its lines are the exact bytes capture sent.
pub fn session_steps(session: &[Value], recorded: Option<&[u8]>) -> Vec<SessionStep> {
    let recorded_lines: Option<Vec<&[u8]>> = recorded.and_then(|bytes| {
        let mut lines: Vec<&[u8]> = bytes.split_inclusive(|b| *b == b'\n').collect();
        if lines.len() == session.len() && lines.iter().all(|l| l.ends_with(b"\n")) {
            Some(std::mem::take(&mut lines))
        } else {
            None
        }
    });
    session
        .iter()
        .enumerate()
        .map(|(i, item)| SessionStep {
            line: match &recorded_lines {
                Some(lines) => lines[i].to_vec(),
                None => session_line(item).into_bytes(),
            },
            answered: expects_answer(item),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use serde_json::json;

    #[test]
    fn raw_strings_are_sent_verbatim_and_values_as_compact_json() {
        assert_eq!(session_line(&json!("not json")), "not json\n");
        assert_eq!(
            session_line(&json!({"jsonrpc":"2.0","id":1})),
            "{\"jsonrpc\":\"2.0\",\"id\":1}\n"
        );
    }

    #[test]
    fn answered_items_follow_the_readme_rule() {
        assert!(expects_answer(&json!("garbage")));
        assert!(!expects_answer(&json!("   ")));
        assert!(!expects_answer(&json!("")));
        assert!(expects_answer(&json!({"id": 1, "method": "ping"})));
        assert!(!expects_answer(
            &json!({"method": "notifications/initialized"})
        ));
        assert!(!expects_answer(&json!({"id": 1, "result": {}})));
        assert!(!expects_answer(&json!({"id": 1, "error": {}})));
        assert!(!expects_answer(&json!(3)));
    }

    #[test]
    fn recorded_stdin_supplies_the_exact_bytes_when_it_matches() {
        let session = vec![json!({"id": 1}), json!("x")];
        let steps = session_steps(&session, Some(b"{\"id\":1.0}\nx\n"));
        assert_eq!(steps[0].line, b"{\"id\":1.0}\n");
        assert!(steps[0].answered && steps[1].answered);
        let fallback = session_steps(&session, Some(b"only one line\n"));
        assert_eq!(fallback[0].line, b"{\"id\":1}\n");
    }
}
