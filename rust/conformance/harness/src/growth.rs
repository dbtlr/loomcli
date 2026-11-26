//! The growth check: a change may add to the behind list only for a case whose expected output it
//! changed, because Rust work only shrinks the list (ADR-0006).

use std::fs;
use std::path::Path;

use crate::accepted;
use crate::behind::{self, Behind};
use crate::compare::Part;

/// The parts one case gained on the behind list against the base branch's list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Growth {
    /// The case id.
    pub id: String,
    /// The parts the base list did not hold for the case, every listed part for a new entry.
    pub parts: Vec<Part>,
}

/// Each case whose entry `head` adds or widens against `base`, sorted by id.
pub fn grown(base: &Behind, head: &Behind) -> Vec<Growth> {
    // `Behind` is a `BTreeMap`, so iterating `head` yields the cases sorted by id.
    head.iter()
        .filter_map(|(id, parts)| {
            let before = base.get(id).map_or(&[][..], Vec::as_slice);
            let added: Vec<Part> = parts
                .iter()
                .copied()
                .filter(|part| !before.contains(part))
                .collect();
            (!added.is_empty()).then(|| Growth {
                id: id.clone(),
                parts: added,
            })
        })
        .collect()
}

/// The growth that `changed`, the repository-relative paths a change touched, does not explain. A
/// case's growth is explained when the change touched a file under `conformance/expected/<id>/`.
/// A part `base_accepted`, the base branch's `accepted.json`, lists for the case is explained too:
/// a deviation reclassified as owed to the catch-up was already known to differ there, so its move
/// is no regression.
pub fn unexplained(growth: Vec<Growth>, changed: &[String], base_accepted: &Behind) -> Vec<Growth> {
    growth
        .into_iter()
        .filter_map(|g| {
            let folder = format!("conformance/expected/{}/", g.id);
            if changed.iter().any(|path| path.starts_with(&folder)) {
                return None;
            }
            let accepted = base_accepted.get(&g.id).map_or(&[][..], Vec::as_slice);
            let parts: Vec<Part> = g
                .parts
                .into_iter()
                .filter(|part| !accepted.contains(part))
                .collect();
            (!parts.is_empty()).then_some(Growth { id: g.id, parts })
        })
        .collect()
}

/// Checks `head`, the committed behind list, against `base`, a folder holding the base branch's
/// `behind.json` and `accepted.json`, and `changed`, a file of the repository-relative paths the
/// change touched, each ended by a NUL as `git diff -z --name-only` writes them. Returns whether the
/// check passed and the text to print: the report of unexplained growth, or one line saying there
/// is none.
pub fn check(base: &Path, head: &Path, changed: &Path) -> Result<(bool, String), String> {
    let base_behind = behind::load(&base.join("behind.json"))?;
    let base_accepted = accepted::listed(&base.join("accepted.json"))?;
    let head = behind::load(head)?;
    let changed: Vec<String> = fs::read_to_string(changed)
        .map_err(|e| format!("cannot read {}: {e}", changed.display()))?
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect();
    let found = unexplained(grown(&base_behind, &head), &changed, &base_accepted);
    if found.is_empty() {
        return Ok((
            true,
            "behind.json grows only where this change explains it.\n".to_owned(),
        ));
    }
    Ok((false, render(&found)))
}

/// The report for unexplained growth: one line per case, then the rule it breaks.
pub fn render(unexplained: &[Growth]) -> String {
    let mut text = String::from(
        "behind.json grows for cases whose expected output this change leaves unchanged:\n",
    );
    for g in unexplained {
        let parts: Vec<_> = g.parts.iter().map(|part| part.name()).collect();
        text.push_str(&format!("  {}: {}\n", g.id, parts.join(", ")));
    }
    text.push_str(
        "Rust work only shrinks behind.json (ADR-0006), so a new difference here is a regression \
         to fix. A case may be added or widened only in the change that alters its files under \
         conformance/expected/, or that moves the parts accepted.json listed for it.\n",
    );
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(entries: &[(&str, &[Part])]) -> Behind {
        entries
            .iter()
            .map(|(id, parts)| ((*id).to_owned(), parts.to_vec()))
            .collect()
    }

    fn growth(id: &str, parts: &[Part]) -> Growth {
        Growth {
            id: id.to_owned(),
            parts: parts.to_vec(),
        }
    }

    fn paths(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|path| (*path).to_owned()).collect()
    }

    #[test]
    fn a_list_that_only_shrinks_has_no_growth() {
        let base = list(&[
            ("jsonkit-a", &[Part::Stdout, Part::Stderr]),
            ("jsonkit-b", &[Part::Exit]),
        ]);
        let head = list(&[("jsonkit-a", &[Part::Stdout])]);
        assert_eq!(grown(&base, &head), []);
        assert_eq!(grown(&base, &base), []);
    }

    #[test]
    fn a_new_entry_grows_by_every_part_it_lists() {
        let base = list(&[("jsonkit-a", &[Part::Stdout])]);
        let head = list(&[
            ("jsonkit-a", &[Part::Stdout]),
            ("textstat-b", &[Part::Stderr, Part::Files]),
        ]);
        assert_eq!(
            grown(&base, &head),
            [growth("textstat-b", &[Part::Stderr, Part::Files])]
        );
    }

    #[test]
    fn a_widened_entry_grows_by_the_parts_the_base_lacked_even_when_it_drops_others() {
        let base = list(&[("jsonkit-a", &[Part::Stdout, Part::Exit])]);
        let head = list(&[("jsonkit-a", &[Part::Stderr, Part::Exit])]);
        assert_eq!(grown(&base, &head), [growth("jsonkit-a", &[Part::Stderr])]);
    }

    #[test]
    fn growth_comes_sorted_by_case_id() {
        let head = list(&[("textstat-z", &[Part::Exit]), ("jsonkit-a", &[Part::Exit])]);
        let ids: Vec<_> = grown(&Behind::new(), &head)
            .into_iter()
            .map(|g| g.id)
            .collect();
        assert_eq!(ids, ["jsonkit-a", "textstat-z"]);
    }

    #[test]
    fn a_changed_expected_file_explains_only_its_own_cases_growth() {
        let found = vec![
            growth("jsonkit-a", &[Part::Stdout]),
            growth("jsonkit-b", &[Part::Stderr]),
        ];
        let changed = paths(&[
            "conformance/expected/jsonkit-a/stdout",
            "rust/crates/loomcli-core/src/lib.rs",
            "rust/conformance/behind.json",
        ]);
        assert_eq!(
            unexplained(found, &changed, &Behind::new()),
            [growth("jsonkit-b", &[Part::Stderr])]
        );
    }

    #[test]
    fn a_case_id_that_prefixes_another_explains_neither_the_other_nor_itself() {
        let found = vec![growth("jsonkit-a", &[Part::Stdout])];
        let changed = paths(&[
            "conformance/expected/jsonkit-ab/stdout",
            "conformance/expected/META.json",
            "conformance/cases/jsonkit.json",
            "rust/conformance/expected/jsonkit-a/stdout",
        ]);
        assert_eq!(
            unexplained(found.clone(), &changed, &Behind::new()),
            found,
            "only a file under conformance/expected/jsonkit-a/ explains jsonkit-a"
        );
    }

    #[test]
    fn the_base_accepted_explains_only_the_parts_it_accepted_for_its_own_case() {
        let found = vec![
            growth("jsonkit-a", &[Part::Stdout, Part::Exit]),
            growth("jsonkit-b", &[Part::Stdout]),
        ];
        let accepted = list(&[("jsonkit-a", &[Part::Stdout])]);
        assert_eq!(
            unexplained(found, &[], &accepted),
            [
                growth("jsonkit-a", &[Part::Exit]),
                growth("jsonkit-b", &[Part::Stdout])
            ]
        );
    }

    #[test]
    fn a_files_part_is_explained_by_a_changed_file_under_the_cases_files_folder() {
        let found = vec![growth("jsonkit-a", &[Part::Files])];
        let changed = paths(&["conformance/expected/jsonkit-a/files/out/report.json"]);
        assert_eq!(unexplained(found, &changed, &Behind::new()), []);
    }

    #[test]
    fn the_report_names_each_case_and_part_and_the_rule() {
        let text = render(&[
            growth("jsonkit-a", &[Part::Stdout, Part::Exit]),
            growth("textstat-b", &[Part::Files]),
        ]);
        assert_eq!(
            text,
            "behind.json grows for cases whose expected output this change leaves unchanged:\n  \
             jsonkit-a: stdout, exit\n  \
             textstat-b: files\n\
             Rust work only shrinks behind.json (ADR-0006), so a new difference here is a regression \
             to fix. A case may be added or widened only in the change that alters its files under \
             conformance/expected/, or that moves the parts accepted.json listed for it.\n"
        );
    }
}
