//! The observed result of one case, the loader for the captured one, and the byte comparison.

use std::fs;
use std::path::Path;

/// One of the things a case compares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Part {
    /// Standard output.
    Stdout,
    /// Standard error.
    Stderr,
    /// The exit code.
    Exit,
    /// The set and contents of files produced in the work directory.
    Files,
    /// The case modified its fixtures copy (capture fails on this).
    Fixtures,
}

impl Part {
    /// The name used in reports and in `accepted.json`.
    pub fn name(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::Exit => "exit",
            Self::Files => "files",
            Self::Fixtures => "fixtures",
        }
    }

    /// Parses a name that `accepted.json` may use (`fixtures` cannot be accepted).
    pub fn parse(name: &str) -> Option<Self> {
        [Self::Stdout, Self::Stderr, Self::Exit, Self::Files]
            .into_iter()
            .find(|p| p.name() == name)
    }
}

/// What a run produced, or what capture recorded.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Observed {
    /// Stdout bytes.
    pub stdout: Vec<u8>,
    /// Stderr bytes.
    pub stderr: Vec<u8>,
    /// Exit code; `None` when a signal or the timeout ended the process.
    pub exit: Option<i32>,
    /// Produced files, path relative to the work directory with `/` separators, sorted.
    pub files: Vec<(String, Vec<u8>)>,
}

/// Every regular file under `dir` (symlinks are skipped), sorted by relative path.
pub fn list_files(dir: &Path) -> Vec<(String, Vec<u8>)> {
    fn visit(dir: &Path, prefix: &str, out: &mut Vec<(String, Vec<u8>)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.filter_map(Result::ok) {
            let name = format!("{prefix}{}", entry.file_name().to_string_lossy());
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                visit(&entry.path(), &format!("{name}/"), out);
            } else if kind.is_file() {
                out.push((name, fs::read(entry.path()).unwrap_or_default()));
            }
        }
    }
    let mut out = Vec::new();
    visit(dir, "", &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Reads `expected/<id>/` (`stdout`, `stderr`, `exit`, `files/**`).
pub fn load_expected(dir: &Path) -> Result<Observed, String> {
    let read = |name: &str| {
        fs::read(dir.join(name))
            .map_err(|e| format!("cannot read {}: {e}", dir.join(name).display()))
    };
    let exit_text = String::from_utf8(read("exit")?).map_err(|e| e.to_string())?;
    let exit = exit_text
        .trim()
        .parse::<i32>()
        .map_err(|e| format!("bad exit file in {}: {e}", dir.display()))?;
    Ok(Observed {
        stdout: read("stdout")?,
        stderr: read("stderr")?,
        exit: Some(exit),
        files: list_files(&dir.join("files")),
    })
}

/// The parts that differ byte for byte.
pub fn differing_parts(expected: &Observed, actual: &Observed) -> Vec<Part> {
    let mut parts = Vec::new();
    if expected.stdout != actual.stdout {
        parts.push(Part::Stdout);
    }
    if expected.stderr != actual.stderr {
        parts.push(Part::Stderr);
    }
    if expected.exit != actual.exit {
        parts.push(Part::Exit);
    }
    if expected.files != actual.files {
        parts.push(Part::Files);
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observed() -> Observed {
        Observed {
            stdout: b"out".to_vec(),
            stderr: vec![],
            exit: Some(0),
            files: vec![("a/b".into(), b"x".to_vec())],
        }
    }

    #[test]
    fn identical_results_have_no_differing_part() {
        assert!(differing_parts(&observed(), &observed()).is_empty());
    }

    #[test]
    fn each_part_is_reported_on_its_own() {
        let mut other = observed();
        other.stdout.push(b'!');
        other.exit = Some(1);
        assert_eq!(
            differing_parts(&observed(), &other),
            [Part::Stdout, Part::Exit]
        );
        let mut other = observed();
        other.files.push(("c".into(), vec![]));
        assert_eq!(differing_parts(&observed(), &other), [Part::Files]);
        let mut other = observed();
        other.stderr = b"e".to_vec();
        other.exit = None;
        assert_eq!(
            differing_parts(&observed(), &other),
            [Part::Stderr, Part::Exit]
        );
    }

    #[test]
    fn part_names_round_trip_except_fixtures() {
        for p in [Part::Stdout, Part::Stderr, Part::Exit, Part::Files] {
            assert_eq!(Part::parse(p.name()), Some(p));
        }
        assert_eq!(Part::parse("fixtures"), None);
    }
}
