//! Semantic versions as the self-update plugin reads them: semver.org's grammar, SemVer precedence,
//! a tag's `v`, and the release channel a version derives.

use std::cmp::Ordering;

/// A semantic version read into the parts precedence compares, with the text it was read from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Version {
    /// The version as written, build metadata included.
    pub(crate) text: String,
    /// The major, minor, and patch numbers, as decimal digits with no leading zero.
    core: [String; 3],
    /// The prerelease identifiers, in order; empty for a stable version.
    prerelease: Vec<String>,
}

/// What a tag or an operator's version may begin with.
const VERSION_PREFIX: &str = "v";

/// The channel of a version with no prerelease identifier.
pub(crate) const STABLE: &str = "stable";

/// Whether `text` is a numeric part with no leading zero: `0`, or a nonzero digit and digits.
fn is_number(text: &str) -> bool {
    !text.is_empty()
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'))
}

/// Whether `text` is one SemVer prerelease identifier: a number with no leading zero, or ASCII
/// alphanumerics and hyphens with at least one that is not a digit.
fn is_identifier(text: &str) -> bool {
    if text.is_empty()
        || !text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return false;
    }
    !text.bytes().all(|byte| byte.is_ascii_digit()) || is_number(text)
}

/// Whether `text` is one build identifier: ASCII alphanumerics and hyphens, at least one.
fn is_build_identifier(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// The version a string spells, or `None` when it is not a semantic version.
pub(crate) fn parse_version(text: &str) -> Option<Version> {
    let (rest, build) = match text.split_once('+') {
        Some((rest, build)) => (rest, Some(build)),
        None => (text, None),
    };
    if let Some(build) = build
        && !build.split('.').all(is_build_identifier)
    {
        return None;
    }
    let (numbers, prerelease) = match rest.split_once('-') {
        Some((numbers, prerelease)) => (numbers, Some(prerelease)),
        None => (rest, None),
    };
    let parts: Vec<&str> = numbers.split('.').collect();
    let [major, minor, patch] = parts.as_slice() else {
        return None;
    };
    if ![major, minor, patch].iter().all(|part| is_number(part)) {
        return None;
    }
    let prerelease = match prerelease {
        Some(identifiers) => {
            let identifiers: Vec<&str> = identifiers.split('.').collect();
            if !identifiers
                .iter()
                .all(|identifier| is_identifier(identifier))
            {
                return None;
            }
            identifiers.into_iter().map(str::to_owned).collect()
        }
        None => Vec::new(),
    };
    Some(Version {
        text: text.to_owned(),
        core: [
            (*major).to_owned(),
            (*minor).to_owned(),
            (*patch).to_owned(),
        ],
        prerelease,
    })
}

/// The version a tag names, `v` and a semantic version, or `None` for any other tag.
pub(crate) fn version_of_tag(tag: &str) -> Option<Version> {
    tag.strip_prefix(VERSION_PREFIX).and_then(parse_version)
}

/// A version the operator typed, with or without a leading `v`.
pub(crate) fn version_of_argument(text: &str) -> Option<Version> {
    parse_version(text.strip_prefix(VERSION_PREFIX).unwrap_or(text))
}

/// The release channel of a version: its first prerelease identifier, or `stable`.
pub(crate) fn channel_of(version: &Version) -> &str {
    version.prerelease.first().map_or(STABLE, String::as_str)
}

/// Whether a string names a release channel: `stable`, or one prerelease identifier, which
/// `stable` already is.
pub(crate) fn is_channel_name(text: &str) -> bool {
    is_identifier(text)
}

/// Two numbers written as decimal digits with no leading zero, compared by value.
fn compare_numbers(left: &str, right: &str) -> Ordering {
    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

/// SemVer precedence of two prerelease identifiers: numbers below words, numbers by value, words
/// in ASCII order.
fn compare_identifiers(left: &str, right: &str) -> Ordering {
    let numeric = |text: &str| text.bytes().all(|byte| byte.is_ascii_digit());
    match (numeric(left), numeric(right)) {
        (true, true) => compare_numbers(left, right),
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        (false, false) => left.cmp(right),
    }
}

/// SemVer precedence of two prerelease lists, where a version with none outranks one with some.
fn compare_prerelease(left: &[String], right: &[String]) -> Ordering {
    if left.is_empty() || right.is_empty() {
        // The side with no identifiers ranks higher; two with none are equal.
        return right.len().cmp(&left.len());
    }
    for (part, other) in left.iter().zip(right) {
        let difference = compare_identifiers(part, other);
        if difference != Ordering::Equal {
            return difference;
        }
    }
    left.len().cmp(&right.len())
}

/// SemVer precedence: build metadata is ignored, the major, minor, and patch numbers decide first,
/// then the prerelease identifiers.
pub(crate) fn compare_versions(left: &Version, right: &Version) -> Ordering {
    left.core
        .iter()
        .zip(&right.core)
        .map(|(part, other)| compare_numbers(part, other))
        .find(|difference| *difference != Ordering::Equal)
        .unwrap_or_else(|| compare_prerelease(&left.prerelease, &right.prerelease))
}

#[cfg(test)]
mod tests {
    //! Ports the version case of `self-update.test.ts`.
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    #[test]
    fn versions_compare_by_semver_precedence_and_a_version_reads_its_channel() {
        let ordered: Vec<Version> = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.2",
            "1.0.0-alpha.10",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
            "1.0.1",
            "1.1.0",
            "2.0.0",
        ]
        .iter()
        .filter_map(|text| parse_version(text))
        .collect();
        assert_eq!(ordered.len(), 13);
        for pair in ordered.windows(2) {
            assert_eq!(
                compare_versions(&pair[0], &pair[1]),
                Ordering::Less,
                "{pair:?}"
            );
            assert_eq!(
                compare_versions(&pair[1], &pair[0]),
                Ordering::Greater,
                "{pair:?}"
            );
        }
        let built = parse_version("1.0.0+linux").unwrap();
        let plain = parse_version("1.0.0").unwrap();
        assert_eq!(compare_versions(&built, &plain), Ordering::Equal);
        for text in ["01.0.0", "1.0.0-01", "1.0", "v1.0.0"] {
            assert_eq!(parse_version(text), None, "{text}");
        }
        assert_eq!(version_of_tag("V1.0.0"), None);
        let next = version_of_tag("v1.6.0-next.2").unwrap();
        assert_eq!(channel_of(&next), "next");
    }

    #[test]
    fn a_number_compares_by_value_beyond_any_integer_type() {
        let small = parse_version("18446744073709551616.0.0").unwrap();
        let large = parse_version("18446744073709551617.0.0").unwrap();
        assert_eq!(compare_versions(&small, &large), Ordering::Less);
        let stable = parse_version("1.0.0").unwrap();
        let prerelease = parse_version("1.0.0-0").unwrap();
        assert_eq!(compare_versions(&stable, &prerelease), Ordering::Greater);
        assert_eq!(compare_versions(&prerelease, &stable), Ordering::Less);
        assert_eq!(compare_versions(&stable, &stable), Ordering::Equal);
    }

    #[test]
    fn a_channel_is_stable_or_one_prerelease_identifier() {
        for good in ["stable", "next", "1", "0", "beta-2", "x1"] {
            assert!(is_channel_name(good), "{good}");
        }
        for bad in ["", "01", "next.1", "a_b", "é"] {
            assert!(!is_channel_name(bad), "{bad}");
        }
        assert_eq!(version_of_argument("v1.4.0").unwrap().text, "1.4.0");
        assert_eq!(version_of_argument("1.x"), None);
        let build = parse_version("1.0.0-rc.1+build.5").unwrap();
        assert_eq!(channel_of(&build), "rc");
        assert_eq!(parse_version("1.0.0+"), None);
        assert_eq!(parse_version("1.0.0-"), None);
    }
}
