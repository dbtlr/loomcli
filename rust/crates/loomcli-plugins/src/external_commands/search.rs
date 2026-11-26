//! Searches the run's PATH in order before handing an absolute program path to the process handle.

use std::path::{Component, Path, PathBuf};

use loomcli_core::{Env, Host, Log};

use super::messages;

pub(super) fn find_program(name: &str, host: &Host, log: &Log) -> Option<String> {
    let windows = host.platform == "win32";
    let separator = if windows { ';' } else { ':' };
    let suffixes: &[&str] = if windows { &[".com", ".exe"] } else { &[""] };
    for folder in path_value(&host.env, windows)?.split(separator) {
        let path = Path::new(folder);
        // On Windows, the reference considers a path rooted at the current drive absolute too.
        let absolute = if cfg!(windows) {
            path.has_root()
        } else {
            path.is_absolute()
        };
        if !absolute {
            continue;
        }
        for suffix in suffixes {
            let candidate = joined(path, &format!("{name}{suffix}"));
            if candidate.metadata().is_ok_and(|facts| facts.is_file())
                && (windows || may_execute(&candidate))
            {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
        let (template, fields) = messages::not_in(name, folder);
        log.trace(template, fields);
    }
    None
}

/// Windows uses the first case-insensitive match in key order, as libuv does.
fn path_value(env: &Env, windows: bool) -> Option<&str> {
    if windows {
        env.iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("PATH"))
            .map(|(_, value)| value.as_str())
    } else {
        env.get("PATH").map(String::as_str)
    }
}

/// Joins a portable filename to a rooted directory, resolving dot segments before lookup.
fn joined(folder: &Path, name: &str) -> PathBuf {
    let mut path = PathBuf::new();
    for component in folder.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                path.pop();
            }
            other => path.push(other),
        }
    }
    path.join(name)
}

#[cfg(unix)]
fn may_execute(path: &Path) -> bool {
    rustix::fs::access(path, rustix::fs::Access::EXEC_OK).is_ok()
}

#[cfg(not(unix))]
fn may_execute(_: &Path) -> bool {
    true
}
