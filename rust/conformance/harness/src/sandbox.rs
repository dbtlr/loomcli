//! The per-case sandbox, the scrubbed environment, and `{sandbox}` substitution.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The token the corpus uses for the case's writable work directory.
pub const SANDBOX_TOKEN: &str = "{sandbox}";

/// The folders of one case's sandbox.
#[derive(Debug, Clone)]
pub struct Layout {
    /// `S`, removed after the case.
    pub root: PathBuf,
    /// `S/home`, the `HOME` of the child.
    pub home: PathBuf,
    /// `S/work`, the folder `{sandbox}` stands for.
    pub work: PathBuf,
    /// `S/tmp`, the `TMPDIR` of the child.
    pub tmp: PathBuf,
    /// `S/home/fixtures`, the copy of the fixtures.
    pub fixtures: PathBuf,
    /// The working directory: the fixtures copy joined with the case's `cwd`.
    pub cwd: PathBuf,
}

impl Layout {
    /// The paths for a sandbox rooted at `root` (nothing is created).
    pub fn new(root: &Path, case_cwd: Option<&str>) -> Self {
        let home = root.join("home");
        let fixtures = home.join("fixtures");
        let cwd = match case_cwd {
            Some(sub) => fixtures.join(sub),
            None => fixtures.clone(),
        };
        Self {
            root: root.to_path_buf(),
            work: root.join("work"),
            tmp: root.join("tmp"),
            home,
            fixtures,
            cwd,
        }
    }

    /// Creates the folders and copies `fixtures_source` into `home/fixtures`.
    pub fn create(&self, fixtures_source: &Path) -> io::Result<()> {
        if self.root.exists() {
            fs::remove_dir_all(&self.root)?;
        }
        for dir in [&self.home, &self.work, &self.tmp] {
            fs::create_dir_all(dir)?;
        }
        copy_tree(fixtures_source, &self.fixtures)
    }
}

fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Replaces every `{sandbox}` in `text` with the work directory.
pub fn substitute(text: &str, work: &Path) -> String {
    text.replace(SANDBOX_TOKEN, &work.to_string_lossy())
}

/// The whole environment of a case: `PATH`, the sandbox variables, then the case's own variables
/// (which may override them, as in capture). Nothing else is inherited, `TERM`, `COLUMNS`, `CI`,
/// `NO_COLOR`, and `FORCE_COLOR` included.
pub fn scrubbed_env(
    layout: &Layout,
    path: &str,
    case_env: Option<&BTreeMap<String, String>>,
) -> Vec<(String, String)> {
    let text = |p: &Path| p.to_string_lossy().into_owned();
    let mut env: Vec<(String, String)> = vec![
        ("PATH".into(), path.into()),
        ("HOME".into(), text(&layout.home)),
        ("XDG_CACHE_HOME".into(), text(&layout.home.join(".cache"))),
        ("XDG_CONFIG_HOME".into(), text(&layout.home.join(".config"))),
        (
            "XDG_DATA_HOME".into(),
            text(&layout.home.join(".local").join("share")),
        ),
        (
            "XDG_STATE_HOME".into(),
            text(&layout.home.join(".local").join("state")),
        ),
        ("TMPDIR".into(), text(&layout.tmp)),
    ];
    for (key, value) in case_env.into_iter().flatten() {
        let value = substitute(value, &layout.work);
        match env.iter_mut().find(|(k, _)| k == key) {
            Some(slot) => slot.1 = value,
            None => env.push((key.clone(), value)),
        }
    }
    env
}

/// The spellings of the work directory to replace in output: as written and canonical, longest first.
pub fn work_spellings(work: &Path) -> Vec<Vec<u8>> {
    let mut spellings = vec![work.to_string_lossy().into_owned().into_bytes()];
    if let Ok(real) = fs::canonicalize(work) {
        spellings.push(real.to_string_lossy().into_owned().into_bytes());
    }
    spellings.sort_by_key(|s| std::cmp::Reverse(s.len()));
    spellings.dedup();
    spellings
}

/// Replaces each spelling of the work directory in `bytes` with `{sandbox}`.
pub fn normalize(bytes: &[u8], spellings: &[Vec<u8>]) -> Vec<u8> {
    let mut current = bytes.to_vec();
    for needle in spellings.iter().filter(|n| !n.is_empty()) {
        let mut next = Vec::with_capacity(current.len());
        let mut i = 0;
        while i < current.len() {
            if current[i..].starts_with(needle) {
                next.extend_from_slice(SANDBOX_TOKEN.as_bytes());
                i += needle.len();
            } else {
                next.push(current[i]);
                i += 1;
            }
        }
        current = next;
    }
    current
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn substitutes_every_token() {
        assert_eq!(
            substitute("{sandbox}/a:{sandbox}", Path::new("/w")),
            "/w/a:/w"
        );
    }

    #[test]
    fn layout_puts_the_working_directory_inside_home() {
        let l = Layout::new(Path::new("/s"), Some("project/sub"));
        assert_eq!(l.cwd, Path::new("/s/home/fixtures/project/sub"));
        assert_eq!(
            Layout::new(Path::new("/s"), None).cwd,
            Path::new("/s/home/fixtures")
        );
        assert_eq!(l.work, Path::new("/s/work"));
    }

    #[test]
    fn environment_holds_only_the_stated_variables() {
        let l = Layout::new(Path::new("/s"), None);
        let case_env = BTreeMap::from([
            ("FORCE_COLOR".to_string(), "1".to_string()),
            ("OUT".to_string(), "{sandbox}/o".to_string()),
        ]);
        let env = scrubbed_env(&l, "/bin", Some(&case_env));
        let names: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(
            names,
            [
                "PATH",
                "HOME",
                "XDG_CACHE_HOME",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
                "TMPDIR",
                "FORCE_COLOR",
                "OUT"
            ]
        );
        let get = |k: &str| {
            env.iter()
                .find(|(n, _)| n == k)
                .map(|(_, v)| v.as_str())
                .unwrap()
        };
        assert_eq!(get("HOME"), "/s/home");
        assert_eq!(get("XDG_DATA_HOME"), "/s/home/.local/share");
        assert_eq!(get("TMPDIR"), "/s/tmp");
        assert_eq!(get("OUT"), "/s/work/o");
    }

    #[test]
    fn a_case_variable_overrides_a_sandbox_variable_in_place() {
        let l = Layout::new(Path::new("/s"), None);
        let case_env = BTreeMap::from([("HOME".to_string(), "/elsewhere".to_string())]);
        let env = scrubbed_env(&l, "/bin", Some(&case_env));
        assert_eq!(env.len(), 7);
        assert!(env.contains(&("HOME".to_string(), "/elsewhere".to_string())));
    }

    #[test]
    fn normalize_replaces_every_spelling_longest_first() {
        let spellings = vec![b"/real/s/work".to_vec(), b"/s/work".to_vec()];
        let out = normalize(b"a /real/s/work/x and /s/work/y", &spellings);
        assert_eq!(out, b"a {sandbox}/x and {sandbox}/y");
        assert_eq!(normalize(b"no match", &spellings), b"no match");
    }
}
