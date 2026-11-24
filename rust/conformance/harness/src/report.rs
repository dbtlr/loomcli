//! The printed report and the JSON summary.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde_json::{Value, json};

use crate::compare::Part;
use crate::diff::unified_diff;
use crate::runner::{CaseResult, Status};

/// Counts and failing ids of one group.
#[derive(Debug, Default, Clone)]
pub struct GroupSummary {
    /// Cases that matched.
    pub passed: usize,
    /// Cases that differed without being accepted.
    pub failed: usize,
    /// Cases accepted.
    pub accepted: usize,
    /// Accepted cases that now match.
    pub stale: usize,
    /// Ids of failing cases with their differing parts.
    pub failing: Vec<(String, Vec<String>)>,
    /// Ids of stale cases.
    pub stale_ids: Vec<String>,
}

/// Summarizes by group file, in group-name order.
pub fn summarize(results: &[CaseResult]) -> BTreeMap<String, GroupSummary> {
    let mut groups: BTreeMap<String, GroupSummary> = BTreeMap::new();
    for r in results {
        let g = groups.entry(r.group.clone()).or_default();
        match r.status {
            Status::Passed => g.passed += 1,
            Status::Failed => {
                g.failed += 1;
                g.failing.push((r.id.clone(), failure_parts(r)));
            }
            Status::Accepted => g.accepted += 1,
            Status::Stale => {
                g.stale += 1;
                g.stale_ids.push(r.id.clone());
            }
        }
    }
    groups
}

fn failure_parts(r: &CaseResult) -> Vec<String> {
    let mut names: Vec<String> = r.parts.iter().map(|p| p.name().to_owned()).collect();
    if names.is_empty() {
        names.push("harness".into());
    }
    names
}

/// Whether the run counts as a success: nothing failed and nothing is stale.
pub fn succeeded(results: &[CaseResult]) -> bool {
    results
        .iter()
        .all(|r| matches!(r.status, Status::Passed | Status::Accepted))
}

/// One line per failing or stale case, then the group table and totals.
pub fn render(results: &[CaseResult]) -> String {
    let mut out = String::new();
    for r in results {
        match r.status {
            Status::Failed => {
                let _ = writeln!(out, "FAIL {}: {}", r.id, failure_parts(r).join(", "));
                for note in &r.notes {
                    let _ = writeln!(out, "     {note}");
                }
            }
            Status::Stale => {
                let _ = writeln!(
                    out,
                    "STALE {}: listed in accepted.json but now matches",
                    r.id
                );
            }
            _ => {}
        }
    }
    let groups = summarize(results);
    let width = groups.keys().map(String::len).max().unwrap_or(5).max(5);
    let _ = writeln!(
        out,
        "\n{:<width$}  passed  failed  accepted  stale",
        "group"
    );
    let mut total = GroupSummary::default();
    for (name, g) in &groups {
        let _ = writeln!(
            out,
            "{name:<width$}  {:>6}  {:>6}  {:>8}  {:>5}",
            g.passed, g.failed, g.accepted, g.stale
        );
        total.passed += g.passed;
        total.failed += g.failed;
        total.accepted += g.accepted;
        total.stale += g.stale;
    }
    let _ = writeln!(
        out,
        "{:<width$}  {:>6}  {:>6}  {:>8}  {:>5}",
        "total", total.passed, total.failed, total.accepted, total.stale
    );
    out
}

/// The JSON summary: totals, and per group the counts with the failing ids.
pub fn json_summary(results: &[CaseResult]) -> Value {
    let groups = summarize(results);
    let mut by_group = serde_json::Map::new();
    let (mut passed, mut failed, mut accepted, mut stale) = (0, 0, 0, 0);
    for (name, g) in &groups {
        passed += g.passed;
        failed += g.failed;
        accepted += g.accepted;
        stale += g.stale;
        by_group.insert(
            name.clone(),
            json!({
                "passed": g.passed,
                "failed": g.failed,
                "accepted": g.accepted,
                "stale": g.stale,
                "failing": g.failing.iter().map(|(id, parts)| json!({"id": id, "parts": parts})).collect::<Vec<_>>(),
                "stale_ids": g.stale_ids,
            }),
        );
    }
    json!({
        "total": results.len(),
        "passed": passed,
        "failed": failed,
        "accepted": accepted,
        "stale": stale,
        "groups": by_group,
    })
}

/// The `--show` output: a unified diff of expected against actual for each differing part.
pub fn show(result: &CaseResult) -> String {
    let mut out = format!("case {} ({})\n", result.id, result.group);
    for note in &result.notes {
        let _ = writeln!(out, "note: {note}");
    }
    let text = |b: &[u8]| String::from_utf8_lossy(b).into_owned();
    let (e, a) = (&result.expected, &result.actual);
    for part in &result.parts {
        let diff = match part {
            Part::Stdout => unified_diff(
                "expected stdout",
                "actual stdout",
                &text(&e.stdout),
                &text(&a.stdout),
            ),
            Part::Stderr => unified_diff(
                "expected stderr",
                "actual stderr",
                &text(&e.stderr),
                &text(&a.stderr),
            ),
            Part::Exit => format!("exit: expected {:?}, actual {:?}\n", e.exit, a.exit),
            Part::Files => files_diff(result),
            Part::Fixtures => "the case changed its copy of the fixtures\n".into(),
        };
        let _ = writeln!(out, "== {}\n{diff}", part.name());
    }
    if result.parts.is_empty() {
        out.push_str("no differences\n");
    }
    out
}

fn files_diff(result: &CaseResult) -> String {
    let text = |b: &[u8]| String::from_utf8_lossy(b).into_owned();
    let (e, a) = (&result.expected.files, &result.actual.files);
    let mut names: Vec<&String> = e.iter().chain(a).map(|(n, _)| n).collect();
    names.sort();
    names.dedup();
    let mut out = String::new();
    for name in names {
        let find = |list: &'_ [(String, Vec<u8>)]| {
            list.iter().find(|(n, _)| n == name).map(|(_, b)| text(b))
        };
        match (find(e), find(a)) {
            (Some(x), Some(y)) => out.push_str(&unified_diff(
                &format!("expected {name}"),
                &format!("actual {name}"),
                &x,
                &y,
            )),
            (Some(_), None) => {
                let _ = writeln!(out, "missing file: {name}");
            }
            (None, Some(_)) => {
                let _ = writeln!(out, "unexpected file: {name}");
            }
            (None, None) => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compare::Observed;

    fn result(id: &str, group: &str, status: Status, parts: Vec<Part>) -> CaseResult {
        CaseResult {
            id: id.into(),
            group: group.into(),
            status,
            parts,
            expected: Observed::default(),
            actual: Observed::default(),
            notes: vec![],
        }
    }

    #[test]
    fn summary_counts_by_group_and_lists_failing_ids() {
        let rs = vec![
            result("a-1", "a", Status::Passed, vec![]),
            result("a-2", "a", Status::Failed, vec![Part::Stdout, Part::Exit]),
            result("b-1", "b", Status::Accepted, vec![Part::Stderr]),
            result("b-2", "b", Status::Stale, vec![]),
        ];
        let v = json_summary(&rs);
        assert_eq!(v["total"], 4);
        assert_eq!(v["groups"]["a"]["failing"][0]["id"], "a-2");
        assert_eq!(v["groups"]["a"]["failing"][0]["parts"][1], "exit");
        assert_eq!(v["groups"]["b"]["stale_ids"][0], "b-2");
        assert!(!succeeded(&rs));
        let text = render(&rs);
        assert!(text.contains("FAIL a-2: stdout, exit"), "{text}");
        assert!(text.contains("STALE b-2"), "{text}");
    }

    #[test]
    fn show_prints_a_diff_with_visible_escapes() {
        let mut r = result("a-1", "a", Status::Failed, vec![Part::Stdout]);
        r.expected.stdout = b"\x1b[1mhi\x1b[0m\n".to_vec();
        r.actual.stdout = b"hi\n".to_vec();
        let text = show(&r);
        assert!(text.contains("-\\x1b[1mhi\\x1b[0m"), "{text}");
        assert!(text.contains("+hi"), "{text}");
    }
}
