//! Release facts, the installation record, and the application's directories.
//!
//! A build bakes its release facts at compile time: `cargo loom build` sets `LOOM_RELEASE` for the
//! compilation, core's build script validates it and bakes the normalized facts, and a build without
//! it is a `source` build. [`ReleaseFacts::baked`] reads them; the real process handle reports them.

// The build script reads most of the module; the crate reads its channel and asset helpers.
#[allow(dead_code)]
mod baked;

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::host::{Env, Host, normalized};

/// How the running copy was built. `Source` and `Development` are development builds, which render
/// a defect as its Developer Diagnostic; `Distributed` renders the generic defect message.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Build {
    /// No release facts were baked: a source run or a plain `cargo build`.
    Source,
    /// `cargo loom build --development`.
    Development,
    /// `cargo loom build`, with or without `--release`.
    Distributed,
}

/// The release a distributed build was cut from. Its JSON form holds the members in the order the
/// reference's frozen facts hold them: `asset` when present, `repository`, `channel`, `version`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct Release {
    /// The release asset name of a compiled binary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<String>,
    /// The repository, as `owner/name`.
    pub repository: String,
    /// The channel core derives from the version, such as `stable` or `next`.
    pub channel: String,
    /// The semantic version.
    pub version: String,
}

impl Release {
    /// A release of `version` from `repository`, with the channel derived from the version: its
    /// first prerelease identifier, so `1.1.0-next.3` reads `next`, or `stable` when it has none. A
    /// version that is not a semantic version reads `stable`.
    pub fn new(version: impl Into<String>, repository: impl Into<String>) -> Self {
        let version = version.into();
        let channel = baked::channel_of(&version).unwrap_or_else(|| "stable".to_owned());
        Self {
            version,
            channel,
            repository: repository.into(),
            asset: None,
        }
    }

    /// Sets the release asset name.
    #[must_use]
    pub fn asset(self, asset: impl Into<String>) -> Self {
        Self {
            asset: Some(asset.into()),
            ..self
        }
    }
}

/// How the running copy was installed, read from the installation record. Its JSON form holds
/// `digest`, `method`, and `path`, in the reference's order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct Installation {
    /// The binary's digest, as `sha256:<hex>`.
    pub digest: String,
    /// The installer that wrote it, such as `script`.
    pub method: String,
    /// The installed binary's path.
    pub path: String,
}

impl Installation {
    /// An installation record's facts.
    pub fn new(
        method: impl Into<String>,
        path: impl Into<String>,
        digest: impl Into<String>,
    ) -> Self {
        Self {
            method: method.into(),
            path: path.into(),
            digest: digest.into(),
        }
    }
}

/// How a run was built, captured with the host once per run.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct ReleaseFacts {
    /// The build kind.
    pub build: Build,
    /// The release, for a build cut from one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<Release>,
    /// The installation, for a compiled binary an installer recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation: Option<Installation>,
}

impl ReleaseFacts {
    /// The facts this build baked in, or a `source` build's when none were baked. The build script
    /// validated them, so they are never malformed; they carry no installation, which only a run's
    /// host capture reads.
    #[must_use]
    pub fn baked() -> Self {
        let build = match env!("LOOM_RELEASE_BUILD") {
            "development" => Build::Development,
            "distributed" => Build::Distributed,
            _ => Build::Source,
        };
        let version = env!("LOOM_RELEASE_VERSION");
        let release = (!version.is_empty()).then(|| {
            let release = Release::new(version, env!("LOOM_RELEASE_REPOSITORY"));
            match decoded_asset(env!("LOOM_RELEASE_ASSET")) {
                Some(asset) => release.asset(asset),
                None => release,
            }
        });
        Self {
            build,
            release,
            installation: None,
        }
    }

    /// A build of the given kind with no release, as a test supplies facts.
    #[must_use]
    pub fn new(build: Build) -> Self {
        Self {
            build,
            release: None,
            installation: None,
        }
    }

    /// Sets the release.
    #[must_use]
    pub fn release(self, release: Release) -> Self {
        Self {
            release: Some(release),
            ..self
        }
    }

    /// Sets the installation.
    #[must_use]
    pub fn installation(self, installation: Installation) -> Self {
        Self {
            installation: Some(installation),
            ..self
        }
    }

    /// Whether the build renders defects as Developer Diagnostics: `source` or `development`.
    #[must_use]
    pub fn is_development(&self) -> bool {
        self.build != Build::Distributed
    }

    /// These facts with the installation the record holds for `executable`, read only for a release
    /// that carries an asset, as a compiled binary's alone does. Every other build reads no file.
    pub(crate) fn with_installation(
        self,
        application: &str,
        directories: &DirectoryFacts,
        executable: &Path,
    ) -> Self {
        let carries_asset = self
            .release
            .as_ref()
            .is_some_and(|release| release.asset.is_some());
        if !carries_asset {
            return self;
        }
        match read_installation(application, directories, executable) {
            Some(installation) => self.installation(installation),
            None => self,
        }
    }
}

/// The asset name the build script baked as the hexadecimal of its UTF-8 bytes, or `None` for none.
fn decoded_asset(hex: &str) -> Option<String> {
    if hex.is_empty() {
        return None;
    }
    let bytes: Option<Vec<u8>> = (0..hex.len())
        .step_by(2)
        .map(|at| {
            hex.get(at..at + 2)
                .and_then(|pair| u8::from_str_radix(pair, 16).ok())
        })
        .collect();
    bytes.and_then(|bytes| String::from_utf8(bytes).ok())
}

/// The largest record core reads, 1 MiB; a larger file is no record.
const RECORD_LIMIT: u64 = 1024 * 1024;

/// The installation the record's `install.json` holds, trusted only when its path and `executable`
/// resolve through symbolic links to the same path. A variable the directory needs, a missing or
/// unreadable file, a file that is not regular or exceeds 1 MiB, content that is not the record's
/// object, an unknown `format`, and another path each answer `None`, and nothing is reported. It
/// never hashes the binary.
pub(crate) fn read_installation(
    application: &str,
    directories: &DirectoryFacts,
    executable: &Path,
) -> Option<Installation> {
    let DirectoryLookup::Path(directory) =
        application_directory(ApplicationDirectory::Installation, application, directories)
    else {
        return None;
    };
    let text = read_small_file(&directory.join("install.json"), RECORD_LIMIT)?;
    let installation = installation_of(&serde_json::from_str(&text).ok()?)?;
    let recorded = std::fs::canonicalize(&installation.path).ok()?;
    let running = std::fs::canonicalize(executable).ok()?;
    (recorded == running).then_some(installation)
}

/// The installation one parsed `install.json` holds, or `None` when it is not that object: `format`
/// 1, a nonempty `method`, an absolute `path`, and a `sha256:` digest of 64 lowercase hexadecimal
/// digits. Every other member is ignored.
fn installation_of(value: &serde_json::Value) -> Option<Installation> {
    let members = value.as_object()?;
    let format = members.get("format")?.as_f64()?;
    let method = members.get("method")?.as_str()?;
    let path = members.get("path")?.as_str()?;
    let digest = members.get("digest")?.as_str()?;
    let hex = digest.strip_prefix("sha256:")?;
    let known = format == 1.0
        && !method.is_empty()
        && Path::new(path).is_absolute()
        && hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    known.then(|| Installation::new(method, path, digest))
}

/// A regular file's text when it is no larger than `limit` bytes, read synchronously and decoded
/// as UTF-8 with a replacement character for each invalid sequence, or `None` for any other path
/// and for any failure. The path's type is checked through its links before anything opens it, as
/// the reference's `statSync` is, so a FIFO or a device is refused without waiting on a writer.
pub(crate) fn read_small_file(path: &Path, limit: u64) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (u64::try_from(bytes.len()).ok()? <= limit)
        .then(|| String::from_utf8_lossy(&bytes).into_owned())
}

/// A per-application directory.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApplicationDirectory {
    /// The installation record's directory.
    Installation,
    /// The log directory.
    Logs,
    /// The cache directory.
    Cache,
}

/// The facts a directory lookup reads.
#[derive(Clone, Debug)]
#[must_use]
pub struct DirectoryFacts {
    pub(crate) env: Env,
    pub(crate) home: PathBuf,
    pub(crate) platform: String,
}

impl DirectoryFacts {
    /// The facts a lookup reads: the environment, the home folder, and the platform.
    pub fn new(env: Env, home: impl Into<PathBuf>, platform: impl Into<String>) -> Self {
        Self {
            env,
            home: home.into(),
            platform: platform.into(),
        }
    }
}

impl From<&Host> for DirectoryFacts {
    /// A run's facts: its `env`, `home`, and `platform`, as the reference passes the host itself.
    fn from(host: &Host) -> Self {
        Self::new(host.env.clone(), host.home.clone(), host.platform.clone())
    }
}

/// Where a directory is, or the variable it needs.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum DirectoryLookup {
    /// The absolute directory.
    Path(PathBuf),
    /// The variable it needs that is unset, empty, or not absolute; `HOME` for the home folder.
    Variable(String),
}

/// The directory of `kind` for `application`, resolved from `env`, `home`, and `platform` alone.
///
/// | Platform | `Installation` | `Logs` | `Cache` |
/// | --- | --- | --- | --- |
/// | `darwin` | `<home>/Library/Application Support/<app>/installation` | `<home>/Library/Logs/<app>` | `<home>/Library/Caches/<app>` |
/// | any other | `$XDG_STATE_HOME/<app>/installation` | `$XDG_STATE_HOME/<app>` | `$XDG_CACHE_HOME/<app>` |
///
/// `<home>` is `from.home`, a run's `host.home`, never `HOME` in `env`. An `XDG_STATE_HOME` that
/// is unset, empty, or not absolute stands for `<home>/.local/state`, and such an `XDG_CACHE_HOME`
/// for `<home>/.cache`. A home that is empty or not absolute cannot give the directory, and the
/// lookup answers [`DirectoryLookup::Variable`] with `HOME`. It reads no file and creates nothing.
#[must_use]
pub fn application_directory(
    kind: ApplicationDirectory,
    application: &str,
    from: &DirectoryFacts,
) -> DirectoryLookup {
    let mut segments = vec![application];
    if kind == ApplicationDirectory::Installation {
        segments.push("installation");
    }
    if from.platform == "darwin" {
        let folder = match kind {
            ApplicationDirectory::Installation => "Application Support",
            ApplicationDirectory::Logs => "Logs",
            ApplicationDirectory::Cache => "Caches",
        };
        return under_home(
            &from.home,
            &[&["Library", folder], segments.as_slice()].concat(),
        );
    }
    let (variable, fallback): (&str, &[&str]) = match kind {
        ApplicationDirectory::Cache => ("XDG_CACHE_HOME", &[".cache"]),
        ApplicationDirectory::Installation | ApplicationDirectory::Logs => {
            ("XDG_STATE_HOME", &[".local", "state"])
        }
    };
    match absolute_variable(&from.env, variable) {
        Some(base) => DirectoryLookup::Path(joined(Path::new(base), &segments)),
        None => under_home(&from.home, &[fallback, segments.as_slice()].concat()),
    }
}

/// A variable's value when it is an absolute path by the running process's rules.
pub(crate) fn absolute_variable<'a>(env: &'a Env, name: &str) -> Option<&'a str> {
    env.get(name)
        .map(String::as_str)
        .filter(|value| Path::new(value).is_absolute())
}

/// The directory under the home, or `HOME` when the home is empty or not absolute.
fn under_home(home: &Path, segments: &[&str]) -> DirectoryLookup {
    if home.is_absolute() {
        DirectoryLookup::Path(joined(home, segments))
    } else {
        DirectoryLookup::Variable("HOME".to_owned())
    }
}

/// `base` with each segment joined in order and the result normalized, as the reference's
/// `path.join` normalizes it, so an operator's `XDG_STATE_HOME` of `/srv/../state//` gives
/// `/state/notes`.
fn joined(base: &Path, segments: &[&str]) -> PathBuf {
    normalized(
        &segments
            .iter()
            .fold(base.to_path_buf(), |path, segment| path.join(segment)),
    )
}

#[cfg(test)]
mod tests {
    //! The installation record's reader, under `installation-record.md`'s Reading the installation.
    #![allow(clippy::expect_used)]

    use std::path::{Path, PathBuf};

    use super::*;

    /// A fresh directory for one case, removed when the case ends.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("loomcli-record-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).expect("the scratch directory is created");
            Self(root)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const DIGEST: &str = "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    /// A scratch home with a binary at `bin/notes` and the record `install.json` holding `record`,
    /// with `{binary}` replaced by the binary's path.
    fn recorded(name: &str, record: &str) -> (Scratch, DirectoryFacts, PathBuf) {
        let scratch = Scratch::new(name);
        let binary = scratch.0.join("bin").join("notes");
        std::fs::create_dir_all(binary.parent().expect("a parent")).expect("bin is created");
        std::fs::write(&binary, "test").expect("the binary is written");
        let state = scratch.0.join("state");
        let directory = state.join("notes").join("installation");
        std::fs::create_dir_all(&directory).expect("the record directory is created");
        let text = record.replace("{binary}", &binary.to_string_lossy());
        std::fs::write(directory.join("install.json"), text).expect("the record is written");
        let mut env = Env::new();
        env.insert(
            "XDG_STATE_HOME".to_owned(),
            state.to_string_lossy().into_owned(),
        );
        let facts = DirectoryFacts::new(env, scratch.0.join("home"), "linux");
        (scratch, facts, binary)
    }

    fn record(path: &str) -> String {
        format!(r#"{{"format":1,"method":"script","path":"{path}","digest":"{DIGEST}"}}"#) + "\n"
    }

    #[test]
    fn a_record_naming_the_running_executable_is_the_installation() {
        let (_scratch, facts, binary) = recorded("own", &record("{binary}"));
        assert_eq!(
            read_installation("notes", &facts, &binary),
            Some(Installation::new(
                "script",
                binary.to_string_lossy(),
                DIGEST
            ))
        );
    }

    #[test]
    fn a_record_naming_another_path_is_no_installation() {
        let (scratch, facts, binary) = recorded("other", &record("/loom-test/elsewhere/notes"));
        assert_eq!(read_installation("notes", &facts, &binary), None);
        let copy = scratch.0.join("copy");
        std::fs::write(&copy, "test").expect("the copy is written");
        let (_scratch, facts, _) = recorded("copy", &record("{binary}"));
        assert_eq!(read_installation("notes", &facts, &copy), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_the_running_executable_resolves_to_it() {
        let (scratch, _, binary) = recorded("link", "");
        let link = scratch.0.join("link");
        std::os::unix::fs::symlink(&binary, &link).expect("the link is made");
        let directory = scratch.0.join("state").join("notes").join("installation");
        std::fs::write(
            directory.join("install.json"),
            record(&link.to_string_lossy()),
        )
        .expect("the record is rewritten");
        let mut env = Env::new();
        env.insert(
            "XDG_STATE_HOME".to_owned(),
            scratch.0.join("state").to_string_lossy().into_owned(),
        );
        let facts = DirectoryFacts::new(env, "/loom-test/home", "linux");
        assert!(read_installation("notes", &facts, &binary).is_some());
    }

    #[test]
    fn malformed_content_and_an_unknown_format_are_no_installation() {
        let cases = [
            "not json".to_owned(),
            "[]".to_owned(),
            record("{binary}").replace(r#""format":1"#, r#""format":2"#),
            record("{binary}").replace(r#""method":"script""#, r#""method":"""#),
            record("{binary}").replace(DIGEST, "sha256:ABC"),
            record("{binary}").replace(DIGEST, &DIGEST.to_uppercase()),
            record("{binary}").replace(r#""path":"{binary}""#, r#""path":"bin/notes""#),
        ];
        for (index, content) in cases.iter().enumerate() {
            let (_scratch, facts, binary) = recorded(&format!("malformed-{index}"), content);
            assert_eq!(
                read_installation("notes", &facts, &binary),
                None,
                "{content}"
            );
        }
    }

    #[test]
    fn members_in_any_order_and_unknown_members_still_read() {
        let content = format!(
            r#"{{"digest":"{DIGEST}","extra":true,"path":"{{binary}}","method":"script","format":1}}"#
        );
        let (_scratch, facts, binary) = recorded("order", &content);
        assert!(read_installation("notes", &facts, &binary).is_some());
    }

    #[test]
    fn a_missing_file_or_a_needed_variable_is_no_installation() {
        let (scratch, _, binary) = recorded("missing", "");
        let facts = DirectoryFacts::new(Env::new(), scratch.0.join("nowhere"), "linux");
        assert_eq!(read_installation("notes", &facts, &binary), None);
        let homeless = DirectoryFacts::new(Env::new(), "", "linux");
        assert_eq!(read_installation("notes", &homeless, &binary), None);
    }

    #[test]
    fn a_record_over_one_mebibyte_is_no_installation() {
        let padded = record("{binary}").replace(
            r#""format":1"#,
            &format!(r#""format":1,"pad":"{}""#, "x".repeat(1024 * 1024)),
        );
        let (_scratch, facts, binary) = recorded("large", &padded);
        assert_eq!(read_installation("notes", &facts, &binary), None);
    }

    #[test]
    fn only_a_release_with_an_asset_reads_the_record() {
        let (_scratch, facts, binary) = recorded("asset", &record("{binary}"));
        let bare = ReleaseFacts::new(Build::Distributed);
        assert_eq!(
            bare.clone().with_installation("notes", &facts, &binary),
            bare
        );
        let unasseted =
            ReleaseFacts::new(Build::Distributed).release(Release::new("1.0.0", "acme/notes"));
        assert_eq!(
            unasseted
                .clone()
                .with_installation("notes", &facts, &binary)
                .installation,
            None
        );
        let compiled = ReleaseFacts::new(Build::Distributed)
            .release(Release::new("1.0.0", "acme/notes").asset("notes-linux-x64"));
        assert_eq!(
            compiled
                .with_installation("notes", &facts, &binary)
                .installation,
            Some(Installation::new(
                "script",
                binary.to_string_lossy(),
                DIGEST
            ))
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_record_that_is_a_fifo_is_no_installation_and_is_never_opened() {
        let (scratch, facts, binary) = recorded("fifo", "");
        let record = scratch
            .0
            .join("state")
            .join("notes")
            .join("installation")
            .join("install.json");
        std::fs::remove_file(&record).expect("the record is removed");
        rustix::fs::mkfifoat(rustix::fs::CWD, &record, rustix::fs::Mode::from(0o600))
            .expect("the FIFO is made");
        let (done, finished) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = done.send(read_installation("notes", &facts, &binary));
        });
        assert_eq!(
            finished.recv_timeout(std::time::Duration::from_secs(5)),
            Ok(None),
            "the reader answers at once, without waiting for a writer"
        );
    }

    #[test]
    fn a_small_file_decodes_an_invalid_byte_as_a_replacement_character() {
        let scratch = Scratch::new("lossy");
        let file = scratch.0.join("text");
        std::fs::write(&file, b"a\xffb").expect("the file is written");
        assert_eq!(read_small_file(&file, 10).as_deref(), Some("a\u{fffd}b"));
        assert_eq!(read_small_file(&file, 2), None);
    }

    #[test]
    fn a_small_file_read_refuses_a_directory() {
        let scratch = Scratch::new("directory");
        assert_eq!(read_small_file(Path::new(&scratch.0), 10), None);
    }
}
