//! POSIX path text as Node's `path` module computes it, because the paths the plugin writes into
//! startup lines and the record must match the reference's byte for byte: `join` normalizes, and
//! `dirname` ignores trailing separators.

/// The path with `.` and empty segments removed and `..` resolved, a trailing separator kept, and
/// `.` for an empty result.
pub(super) fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_owned();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut kept: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if kept.last().is_some_and(|last| *last != "..") {
                    kept.pop();
                } else if !absolute {
                    kept.push("..");
                }
            }
            other => kept.push(other),
        }
    }
    let mut joined = kept.join("/");
    if joined.is_empty() && !absolute {
        joined.push('.');
    }
    if trailing && !joined.is_empty() && !joined.ends_with('/') {
        joined.push('/');
    }
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

/// The parts joined with `/` and normalized.
pub(super) fn join(parts: &[&str]) -> String {
    let kept: Vec<&str> = parts
        .iter()
        .copied()
        .filter(|part| !part.is_empty())
        .collect();
    if kept.is_empty() {
        return ".".to_owned();
    }
    normalize(&kept.join("/"))
}

/// The folder above the path, `/` for a path directly under the root, and `.` for a bare name.
pub(super) fn dirname(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return if path.starts_with('/') { "/" } else { "." }.to_owned();
    }
    match trimmed.rfind('/') {
        None => ".".to_owned(),
        Some(0) => "/".to_owned(),
        Some(index) => trimmed[..index].trim_end_matches('/').to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{dirname, join, normalize};

    #[test]
    fn normalize_resolves_dots_and_keeps_a_trailing_separator() {
        assert_eq!(normalize("/a//b/./c/../d"), "/a/b/d");
        assert_eq!(normalize("/a/b/"), "/a/b/");
        assert_eq!(normalize("/../a"), "/a");
        assert_eq!(normalize("../a"), "../a");
        assert_eq!(normalize(""), ".");
        assert_eq!(normalize("/"), "/");
    }

    #[test]
    fn join_normalizes_and_dirname_ignores_trailing_separators() {
        assert_eq!(
            join(&["/home/me", ".local", "share"]),
            "/home/me/.local/share"
        );
        assert_eq!(join(&["/data/", "x", "..", "y"]), "/data/y");
        assert_eq!(dirname("/a/b/c"), "/a/b");
        assert_eq!(dirname("/a"), "/");
        assert_eq!(dirname("a"), ".");
        assert_eq!(dirname("/a/b/"), "/a");
    }
}
