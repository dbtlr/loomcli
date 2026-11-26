//! A defect's evidence in a development build: the author's source around the failing frame and
//! the cause chain, and the detail a fatal log event carries.

use std::path::{Component, Path, PathBuf};

use crate::failures::messages::failure_reason;
use crate::output::LogDefect;
use crate::style::escape_control_characters;
use crate::{DeclarationError, Error, Failure, FailureFacts, InternalError};

/// What a development build reads a defect's source through: the roots a frame may lie under, the
/// working directory first, and a reader bound to the working directory.
pub(crate) struct SourceAccess<'a> {
    pub(crate) roots: Vec<PathBuf>,
    pub(crate) read: Option<SourceReader<'a>>,
}

/// A reader of one source file by its absolute path, bound to the working directory, which answers
/// `None` for a file it refuses.
pub(crate) type SourceReader<'a> = &'a dyn Fn(&str) -> Option<String>;

impl SourceAccess<'_> {
    /// Access that reads no source, such as for a working directory that could not be read.
    pub(crate) fn none() -> SourceAccess<'static> {
        SourceAccess {
            roots: Vec::new(),
            read: None,
        }
    }
}

/// How many lines a source excerpt shows on each side of the failing line.
const CONTEXT: usize = 2;

/// One backtrace frame's location: the file, and its line and column, both counted from 1.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Frame {
    file: String,
    line: usize,
    column: usize,
}

/// The lines of a captured backtrace, each trimmed: a frame's symbol and the `at` line under it.
fn backtrace_lines(error: &Error) -> Vec<String> {
    error.backtrace().map_or_else(Vec::new, |backtrace| {
        backtrace
            .to_string()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect()
    })
}

/// The location one `at` line names, `file:line:column`, where the file may hold colons.
fn parse_frame(line: &str) -> Option<Frame> {
    let location = line.strip_prefix("at ")?;
    let mut parts = location.rsplitn(3, ':');
    let column = parts.next()?.parse().ok()?;
    let line = parts.next()?.parse().ok()?;
    let file = parts.next()?;
    (!file.is_empty()).then(|| Frame {
        file: file.to_owned(),
        line,
        column,
    })
}

/// A path with `.` removed and each `..` taking its parent away, without touching the file system.
fn normalized(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// A frame's file as an absolute path and relative to the first root it lies under, when it may be
/// read: under a root and outside any `.cargo` directory, where dependencies' sources live. A
/// relative file, as a backtrace prints one under the process's working directory, resolves against
/// the first root. A backtrace can name any file, so this is checked before any read, and the
/// reader checks it again past symbolic links.
fn qualified(file: &str, roots: &[PathBuf]) -> Option<(PathBuf, PathBuf)> {
    let path = Path::new(file);
    let absolute = if path.is_absolute() {
        normalized(path)
    } else {
        normalized(&roots.first()?.join(path))
    };
    if absolute
        .components()
        .any(|component| component.as_os_str() == ".cargo")
    {
        return None;
    }
    roots.iter().find_map(|root| {
        let inside = absolute.strip_prefix(normalized(root)).ok()?;
        (!inside.as_os_str().is_empty()).then(|| (absolute.clone(), inside.to_path_buf()))
    })
}

/// A frame's location as the diagnostic prints it: relative to the root it lies under when it
/// qualifies, and as the backtrace named it otherwise.
fn location_text(frame: &Frame, roots: &[PathBuf]) -> String {
    let file = qualified(&frame.file, roots).map_or_else(
        || frame.file.clone(),
        |(_, inside)| inside.display().to_string(),
    );
    escape_control_characters(&format!("{file}:{}:{}", frame.line, frame.column))
}

/// One numbered source line, marked when it is the failing line, with a caret under the frame's
/// column below it. A tab reads as one space, so the caret stays under the column.
fn numbered_line(source: &str, number: usize, frame: &Frame, digits: usize) -> Vec<String> {
    let text = escape_control_characters(&source.replace('\t', " "));
    let failing = number == frame.line;
    let marker = if failing { '>' } else { ' ' };
    let line = format!("{marker} {number:>digits$} | {text}")
        .trim_end()
        .to_owned();
    if !failing {
        return vec![line];
    }
    let caret = format!(
        "  {} | {}^",
        " ".repeat(digits),
        " ".repeat(frame.column.saturating_sub(1))
    );
    vec![line, caret]
}

/// The lines around one frame, numbered, with the failing line marked, or none past the file's
/// end. Rust counts a source's lines at each line feed.
fn excerpt(text: &str, frame: &Frame) -> Option<String> {
    let lines: Vec<&str> = text
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    if frame.line < 1 || frame.line > lines.len() {
        return None;
    }
    let first = frame.line.saturating_sub(CONTEXT).max(1);
    let last = (frame.line + CONTEXT).min(lines.len());
    let digits = last.to_string().len();
    Some(
        (first..=last)
            .flat_map(|number| numbered_line(lines[number - 1], number, frame, digits))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// The author's source for a defect: the first frame of the outermost cause's backtrace whose file
/// lies under a root, read through the reader with two lines on each side. A read that answers
/// nothing leaves the frame's location alone, and a backtrace with no qualifying frame leaves its
/// first frame's location alone.
fn source_section(cause: &Error, access: &SourceAccess<'_>) -> Option<String> {
    let frames: Vec<Frame> = backtrace_lines(cause)
        .iter()
        .filter_map(|line| parse_frame(line))
        .collect();
    let Some((frame, absolute)) = frames.iter().find_map(|frame| {
        qualified(&frame.file, &access.roots).map(|(absolute, _)| (frame, absolute))
    }) else {
        return frames
            .first()
            .map(|frame| location_text(frame, &access.roots));
    };
    let location = location_text(frame, &access.roots);
    let text = access
        .read
        .and_then(|read| read(&absolute.display().to_string()));
    match text.and_then(|text| excerpt(&text, frame)) {
        Some(lines) => Some(format!("{location}\n\n{lines}")),
        None => Some(location),
    }
}

/// A heading line: the name and the escaped reason, or the name alone for an empty reason.
fn heading(prefix: &str, name: &str, reason: &str) -> String {
    let text = if reason.is_empty() {
        name.to_owned()
    } else {
        format!("{name}: {reason}")
    };
    format!("{prefix}{}", escape_control_characters(&text))
}

/// The cause chain: each failure's class name and reason, then a foreign error's type name, its
/// `Display`, and its captured backtrace, and each of its `source()` links under `Caused by`.
fn cause_chain(outermost: &Error) -> String {
    let mut lines = Vec::new();
    let mut link = Some(outermost);
    let mut prefix = "";
    while let Some(error) = link {
        if let Some(failure) = error.failure() {
            lines.push(heading(
                prefix,
                failure.class().name(),
                &failure_reason(failure),
            ));
            link = failure.cause();
        } else if let Some(foreign) = error.foreign() {
            let name = error.foreign_type_name().unwrap_or("Error");
            lines.push(heading(prefix, name, &foreign.to_string()));
            lines.extend(
                backtrace_lines(error)
                    .iter()
                    .map(|line| format!("    {}", escape_control_characters(line))),
            );
            let mut source = foreign.source();
            while let Some(inner) = source {
                lines.push(format!(
                    "Caused by {}",
                    escape_control_characters(&inner.to_string())
                ));
                source = inner.source();
            }
            link = None;
        } else {
            link = None;
        }
        prefix = "Caused by ";
    }
    lines.join("\n")
}

/// A defect's evidence in a development build: the author's source around the failing frame, read
/// only here, and the cause chain. A defect with no cause shows none.
pub(crate) fn defect_evidence(cause: Option<&Error>, access: &SourceAccess<'_>) -> Vec<String> {
    let Some(cause) = cause else {
        return Vec::new();
    };
    source_section(cause, access)
        .into_iter()
        .chain([cause_chain(cause)])
        .collect()
}

/// What a fatal log event carries of the defect a run caught: the name and message of an
/// `InternalError`'s cause, read as a diagnostic reads a cause, with its backtrace when one was
/// captured. A defect with no cause, and a declaration fault, are read as themselves.
pub(crate) fn defect_detail(failure: &dyn Failure) -> LogDefect {
    let cause = failure
        .downcast_ref::<InternalError>()
        .and_then(|defect| defect.cause());
    match cause {
        Some(cause) => match cause.failure() {
            Some(inner) => LogDefect {
                name: inner.class().name().to_owned(),
                message: failure_reason(inner),
                stack: None,
            },
            None => LogDefect {
                name: cause.foreign_type_name().unwrap_or("Error").to_owned(),
                message: cause.foreign().map(ToString::to_string).unwrap_or_default(),
                stack: cause.backtrace().map(ToString::to_string),
            },
        },
        None => LogDefect {
            name: failure.class().name().to_owned(),
            message: match failure.downcast_ref::<DeclarationError>() {
                Some(fault) => fault.sentence().to_owned(),
                None => failure_reason(failure),
            },
            stack: None,
        },
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;

    #[test]
    fn an_at_line_names_its_file_line_and_column_whatever_colons_the_file_holds() {
        assert_eq!(
            parse_frame("at /work/a:b/src/main.rs:12:5"),
            Some(Frame {
                file: "/work/a:b/src/main.rs".to_owned(),
                line: 12,
                column: 5,
            })
        );
        assert_eq!(parse_frame("0: app::main"), None);
        assert_eq!(parse_frame("at nowhere"), None);
    }

    #[test]
    fn a_frame_qualifies_under_a_root_and_outside_cargo_alone() {
        let roots = vec![PathBuf::from("/work/app")];
        assert_eq!(
            qualified("./src/main.rs", &roots),
            Some((
                PathBuf::from("/work/app/src/main.rs"),
                PathBuf::from("src/main.rs")
            ))
        );
        assert_eq!(qualified("/work/app/../other/x.rs", &roots), None);
        assert_eq!(
            qualified("/work/app/.cargo/registry/src/dep/lib.rs", &roots),
            None
        );
        assert_eq!(qualified("/rustc/abc/library/std/src/rt.rs", &roots), None);
        assert_eq!(qualified("src/main.rs", &[]), None);
    }

    #[test]
    fn an_excerpt_numbers_two_lines_on_each_side_and_marks_the_failing_column() {
        let text = "fn a() {}\n\nfn main() {\n\tlet x = broken();\n}\n// end\n";
        let frame = Frame {
            file: "src/main.rs".to_owned(),
            line: 4,
            column: 13,
        };
        assert_eq!(
            excerpt(text, &frame).as_deref(),
            Some(
                [
                    "  2 |",
                    "  3 | fn main() {",
                    "> 4 |  let x = broken();",
                    "    |             ^",
                    "  5 | }",
                    "  6 | // end",
                ]
                .join("\n")
                .as_str()
            )
        );
        let past = Frame { line: 40, ..frame };
        assert_eq!(excerpt(text, &past), None);
    }

    #[derive(Debug)]
    struct Outer(Inner);

    #[derive(Debug)]
    struct Inner;

    impl std::fmt::Display for Outer {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("Cannot read\nthe value.")
        }
    }

    impl std::fmt::Display for Inner {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("The file \u{202e}vanished.")
        }
    }

    impl std::error::Error for Outer {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(&self.0)
        }
    }

    impl std::error::Error for Inner {}

    #[test]
    fn a_cause_chain_names_each_link_and_escapes_every_control() {
        let error = Error::from(Outer(Inner));
        let chain = cause_chain(&error);
        let mut lines = chain.lines();
        assert_eq!(
            lines.next(),
            Some("loomcli_core::diagnostics::defect::tests::Outer: Cannot read\\u000athe value.")
        );
        assert_eq!(
            chain.lines().last(),
            Some("Caused by The file \\u202evanished.")
        );
    }

    #[test]
    fn a_failure_in_the_chain_reads_its_class_and_then_its_own_cause() {
        let error = Error::from(crate::FatalError::with_cause(
            "The registry is down.",
            crate::DeclarationError::sentence_only("The plugin is broken."),
        ));
        assert_eq!(
            cause_chain(&error),
            "FatalError: The registry is down.\nCaused by DeclarationError: The plugin is broken."
        );
    }

    #[test]
    fn a_defect_prints_the_authors_source_around_the_first_frame_under_the_working_directory() {
        let error =
            Error::from(Outer(Inner)).with_backtrace(std::backtrace::Backtrace::force_capture());
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let read = |path: &str| std::fs::read_to_string(path).ok();
        let access = SourceAccess {
            roots: vec![root.clone()],
            read: Some(&read),
        };
        let evidence = defect_evidence(Some(&error), &access);
        let [source, chain] = evidence.as_slice() else {
            panic!("a source section and a chain: {evidence:?}");
        };
        assert!(source.starts_with("src/diagnostics/defect.rs:"), "{source}");
        let failing = source
            .lines()
            .find(|line| line.starts_with('>'))
            .unwrap_or_default();
        assert!(failing.contains("force_capture()"), "{source}");
        assert!(chain.contains("\n    at "), "{chain}");
        // A reader that answers nothing leaves the location alone.
        let silent = |_: &str| None;
        let unread = SourceAccess {
            roots: vec![root],
            read: Some(&silent),
        };
        let evidence = defect_evidence(Some(&error), &unread);
        assert!(!evidence[0].contains('\n'), "{}", evidence[0]);
    }

    #[test]
    fn a_defect_with_no_cause_has_no_evidence() {
        assert!(defect_evidence(None, &SourceAccess::none()).is_empty());
    }

    #[test]
    fn a_log_defect_reads_the_cause_or_the_fault_itself() {
        let defect = InternalError::message_only("Broke.", Outer(Inner));
        let detail = defect_detail(&defect);
        assert_eq!(
            (detail.name.as_str(), detail.message.as_str()),
            (
                "loomcli_core::diagnostics::defect::tests::Outer",
                "Cannot read\nthe value."
            )
        );
        let fault = DeclarationError::sentence_only("One sentence.");
        let detail = defect_detail(&fault);
        assert_eq!(
            (detail.name.as_str(), detail.message.as_str(), detail.stack),
            ("DeclarationError", "One sentence.", None)
        );
    }
}
