//! The reader of baked release facts, shared by the crate and its build script.
//!
//! The build script includes this file with `#[path]`, so it names nothing of the crate: it reads
//! the `LOOM_RELEASE` value as JSON and either answers the known members or the sentence that names
//! the member at fault. A member it does not know is ignored, so a later toolchain can bake more
//! facts under this core.

use serde_json::Value;

/// The facts one baked value says: its build and, when present, its release group.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct BakedFacts {
    /// `source`, `development`, or `distributed`.
    pub(crate) build: &'static str,
    /// The release group, when the value holds one.
    pub(crate) release: Option<BakedRelease>,
}

/// The release group of a baked value, without the channel core derives.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct BakedRelease {
    /// A semantic version.
    pub(crate) version: String,
    /// The repository, as `owner/name`.
    pub(crate) repository: String,
    /// A compiled binary's release asset name, nonempty.
    pub(crate) asset: Option<String>,
}

/// Reads one baked value. The error is the sentence that names the member at fault, such as
/// `The release facts baked into LOOM_RELEASE hold build "staging".`
pub(crate) fn read_facts(text: &str) -> Result<BakedFacts, String> {
    let malformed = |found: String| format!("The release facts baked into LOOM_RELEASE {found}.");
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Err(malformed("are not JSON".to_owned()));
    };
    let Value::Object(members) = &value else {
        return Err(malformed("are not an object".to_owned()));
    };
    let build = match members.get("build") {
        Some(Value::String(build)) if build == "source" => "source",
        Some(Value::String(build)) if build == "development" => "development",
        Some(Value::String(build)) if build == "distributed" => "distributed",
        None => return Err(malformed("hold no build".to_owned())),
        Some(other) => return Err(malformed(format!("hold build {}", quoted(other)))),
    };
    match members.get("compiled") {
        None | Some(Value::Bool(true)) => {}
        Some(other) => return Err(malformed(format!("hold compiled {}", quoted(other)))),
    }
    let release = match members.get("release") {
        None => None,
        Some(group) => Some(read_release(group).map_err(malformed)?),
    };
    Ok(BakedFacts { build, release })
}

/// Reads a release group, or answers what it holds that is wrong, after the sentence's subject.
fn read_release(group: &Value) -> Result<BakedRelease, String> {
    let Value::Object(members) = group else {
        return Err("hold a release that is not an object".to_owned());
    };
    let version = match members.get("version") {
        Some(Value::String(version)) if channel_of(version).is_some() => version.clone(),
        other => return Err(held_member("version", other)),
    };
    let repository = match members.get("repository") {
        Some(Value::String(repository)) if is_owner_name(repository) => repository.clone(),
        other => return Err(held_member("repository", other)),
    };
    let asset = match members.get("asset") {
        None => None,
        Some(Value::String(asset)) if !asset.is_empty() => Some(asset.clone()),
        other => return Err(held_member("asset", other)),
    };
    Ok(BakedRelease {
        version,
        repository,
        asset,
    })
}

/// What one member of the release group holds, for a sentence: its value, or that it has none.
fn held_member(name: &str, value: Option<&Value>) -> String {
    match value {
        None => format!("hold a release with no {name}"),
        Some(value) => format!("hold release {name} {}", quoted(value)),
    }
}

/// A value as a sentence quotes it: a string in double quotes with its control characters escaped,
/// and any other value as JSON writes it.
fn quoted(value: &Value) -> String {
    match value {
        Value::String(text) => format!("\"{}\"", loomcli_style::escape_control_characters(text)),
        other => other.to_string(),
    }
}

/// Whether `text` is a repository as `owner/name`: word characters, `.`, and `-` on each side of
/// one slash.
fn is_owner_name(text: &str) -> bool {
    let part = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
    };
    match text.split_once('/') {
        Some((owner, name)) => part(owner) && part(name),
        None => false,
    }
}

/// The release channel a semantic version reads: its first prerelease identifier, or `stable` when
/// it has none. A value that is not a semantic version, by semver.org's grammar, reads none.
pub(crate) fn channel_of(version: &str) -> Option<String> {
    let (rest, build) = match version.split_once('+') {
        Some((rest, build)) => (rest, Some(build)),
        None => (version, None),
    };
    if let Some(build) = build {
        let valid = build.split('.').all(|identifier| {
            !identifier.is_empty()
                && identifier
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        });
        if !valid {
            return None;
        }
    }
    let (core, prerelease) = match rest.split_once('-') {
        Some((core, prerelease)) => (core, Some(prerelease)),
        None => (rest, None),
    };
    let numbers: Vec<&str> = core.split('.').collect();
    if numbers.len() != 3 || !numbers.iter().all(|number| is_numeric_identifier(number)) {
        return None;
    }
    let Some(prerelease) = prerelease else {
        return Some("stable".to_owned());
    };
    let identifiers: Vec<&str> = prerelease.split('.').collect();
    let valid = identifiers.iter().all(|identifier| {
        !identifier.is_empty()
            && identifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && (identifier.bytes().any(|byte| !byte.is_ascii_digit())
                || is_numeric_identifier(identifier))
    });
    valid.then(|| identifiers[0].to_owned())
}

/// Whether `text` is `0` or digits with no leading zero.
fn is_numeric_identifier(text: &str) -> bool {
    !text.is_empty()
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'))
}

#[cfg(test)]
mod tests {
    //! The reference's `release-facts.test.ts` cases over a malformed or unknown baked value, read
    //! as the build script reads `LOOM_RELEASE`.

    use super::*;

    #[test]
    fn a_malformed_value_names_the_member_at_fault() {
        let cases = [
            (r#"{"build":"staging"}"#, r#"hold build "staging""#),
            ("[]", "are not an object"),
            (
                r#"{"build":"distributed","release":{"version":"one","repository":"acme/probe"}}"#,
                r#"hold release version "one""#,
            ),
            (r#"{"build":"distributed","compiled":1}"#, "hold compiled 1"),
            ("{}", "hold no build"),
            (
                r#"{"build":"distributed","release":[]}"#,
                "hold a release that is not an object",
            ),
            (
                r#"{"build":"distributed","release":{"version":"1.0.0"}}"#,
                "hold a release with no repository",
            ),
            (
                r#"{"build":"distributed","release":{"version":"1.0.0","repository":"probe"}}"#,
                r#"hold release repository "probe""#,
            ),
            (
                r#"{"build":"distributed","release":{"version":"1.0.0","repository":"acme/probe","asset":""}}"#,
                r#"hold release asset """#,
            ),
            ("not json", "are not JSON"),
        ];
        for (value, found) in cases {
            assert_eq!(
                read_facts(value),
                Err(format!(
                    "The release facts baked into LOOM_RELEASE {found}."
                )),
                "{value}"
            );
        }
    }

    #[test]
    fn a_quoted_value_escapes_its_control_characters() {
        assert_eq!(
            read_facts("{\"build\":\"a\\nb\"}"),
            Err(r#"The release facts baked into LOOM_RELEASE hold build "a\u000ab"."#.to_owned())
        );
    }

    #[test]
    fn a_baked_member_core_does_not_know_reads_as_the_known_members_alone() {
        let facts = read_facts(
            r#"{"build":"distributed","channel":"npm","compiled":true,"release":{"repository":"acme/probe","target":"linux","version":"1.0.0"}}"#,
        );
        assert_eq!(
            facts,
            Ok(BakedFacts {
                build: "distributed",
                release: Some(BakedRelease {
                    version: "1.0.0".to_owned(),
                    repository: "acme/probe".to_owned(),
                    asset: None,
                }),
            })
        );
    }

    #[test]
    fn each_build_reads_as_baked() {
        for build in ["source", "development", "distributed"] {
            let read = read_facts(&format!(r#"{{"build":"{build}"}}"#)).map(|facts| facts.build);
            assert_eq!(read, Ok(build));
        }
    }

    #[test]
    fn the_channel_is_the_first_prerelease_identifier_or_stable() {
        let cases = [
            ("1.1.0-next.3", Some("next")),
            ("1.0.0-beta.1", Some("beta")),
            ("2.0.0", Some("stable")),
            ("2.0.0+build.5", Some("stable")),
            ("1.0.0-rc.1+build", Some("rc")),
            ("1.0.0-0.3", Some("0")),
            ("one", None),
            ("1.0", None),
            ("01.0.0", None),
            ("1.0.0-01", None),
            ("1.0.0-", None),
            ("1.0.0+", None),
        ];
        for (version, channel) in cases {
            assert_eq!(channel_of(version).as_deref(), channel, "{version}");
        }
    }
}
