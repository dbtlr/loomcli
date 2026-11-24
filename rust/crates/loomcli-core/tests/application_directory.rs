//! The reference's `application-directory.test.ts`: the directories an application keeps its
//! installation record, its logs, and its cache in, resolved from `env`, `home`, and `platform`.

use std::path::PathBuf;

use loomcli_core::{
    ApplicationDirectory, DirectoryFacts, DirectoryLookup, Env, application_directory,
};

const HOME: &str = "/home/me";
const STATE: &str = "/state";
const CACHE: &str = "/cache";

fn env(pairs: &[(&str, &str)]) -> Env {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect()
}

/// One lookup of the notes application's directory. The home is `HOME` from the env, or empty
/// when it holds none, as a host's home follows an absolute `HOME`.
fn lookup(kind: ApplicationDirectory, platform: &str, env: &Env) -> DirectoryLookup {
    let home = env.get("HOME").cloned().unwrap_or_default();
    lookup_with(kind, platform, env, &home)
}

fn lookup_with(
    kind: ApplicationDirectory,
    platform: &str,
    env: &Env,
    home: &str,
) -> DirectoryLookup {
    application_directory(
        kind,
        "notes",
        &DirectoryFacts::new(env.clone(), home, platform),
    )
}

fn path(segments: &[&str]) -> DirectoryLookup {
    DirectoryLookup::Path(segments.iter().collect::<PathBuf>())
}

#[test]
fn each_platform_gives_its_row() {
    use ApplicationDirectory::{Cache, Installation, Logs};
    let env = env(&[
        ("HOME", HOME),
        ("XDG_CACHE_HOME", CACHE),
        ("XDG_STATE_HOME", STATE),
    ]);
    let rows = [
        (
            "linux",
            Installation,
            path(&[STATE, "notes", "installation"]),
        ),
        ("linux", Logs, path(&[STATE, "notes"])),
        ("linux", Cache, path(&[CACHE, "notes"])),
        (
            "freebsd",
            Installation,
            path(&[STATE, "notes", "installation"]),
        ),
        (
            "darwin",
            Installation,
            path(&[
                HOME,
                "Library",
                "Application Support",
                "notes",
                "installation",
            ]),
        ),
        ("darwin", Logs, path(&[HOME, "Library", "Logs", "notes"])),
        ("darwin", Cache, path(&[HOME, "Library", "Caches", "notes"])),
    ];
    for (platform, kind, expected) in rows {
        assert_eq!(
            lookup(kind, platform, &env),
            expected,
            "{platform} {kind:?}"
        );
    }
}

#[test]
fn an_xdg_state_home_that_is_unset_empty_or_relative_falls_back_to_home_local_state() {
    for state in [None, Some(""), Some("relative/state")] {
        let mut env = env(&[("HOME", HOME)]);
        if let Some(state) = state {
            env.insert("XDG_STATE_HOME".to_owned(), state.to_owned());
        }
        assert_eq!(
            lookup(ApplicationDirectory::Installation, "linux", &env),
            path(&[HOME, ".local", "state", "notes", "installation"])
        );
        assert_eq!(
            lookup(ApplicationDirectory::Logs, "linux", &env),
            path(&[HOME, ".local", "state", "notes"])
        );
    }
}

#[test]
fn an_xdg_cache_home_that_is_unset_empty_or_relative_falls_back_to_home_cache() {
    for cache in [None, Some(""), Some("relative/cache")] {
        // The state directory never stands in for the cache, whatever it names.
        let mut env = env(&[("HOME", HOME), ("XDG_STATE_HOME", STATE)]);
        if let Some(cache) = cache {
            env.insert("XDG_CACHE_HOME".to_owned(), cache.to_owned());
        }
        assert_eq!(
            lookup(ApplicationDirectory::Cache, "linux", &env),
            path(&[HOME, ".cache", "notes"])
        );
    }
}

#[test]
fn a_home_that_is_unset_empty_or_relative_answers_its_variable_wherever_the_row_needs_it() {
    use ApplicationDirectory::{Cache, Installation, Logs};
    let variable = DirectoryLookup::Variable("HOME".to_owned());
    for home in [None, Some(""), Some("me")] {
        for kind in [Installation, Logs, Cache] {
            let mut linux = Env::new();
            let mut darwin = env(&[("XDG_STATE_HOME", STATE)]);
            if let Some(home) = home {
                linux.insert("HOME".to_owned(), home.to_owned());
                darwin.insert("HOME".to_owned(), home.to_owned());
            }
            assert_eq!(lookup(kind, "linux", &linux), variable);
            assert_eq!(lookup(kind, "darwin", &darwin), variable);
        }
    }
}

#[test]
fn the_home_comes_from_home_never_from_home_in_env() {
    let other = env(&[("HOME", "/home/other")]);
    assert_eq!(
        lookup_with(ApplicationDirectory::Installation, "linux", &other, HOME),
        path(&[HOME, ".local", "state", "notes", "installation"])
    );
    assert_eq!(
        lookup_with(ApplicationDirectory::Cache, "darwin", &other, HOME),
        path(&[HOME, "Library", "Caches", "notes"])
    );
    assert_eq!(
        lookup_with(
            ApplicationDirectory::Logs,
            "linux",
            &env(&[("HOME", HOME)]),
            ""
        ),
        DirectoryLookup::Variable("HOME".to_owned())
    );
}

#[test]
fn an_absolute_xdg_state_home_or_xdg_cache_home_needs_no_home_for_its_kinds() {
    assert_eq!(
        lookup(
            ApplicationDirectory::Installation,
            "linux",
            &env(&[("XDG_STATE_HOME", STATE)])
        ),
        path(&[STATE, "notes", "installation"])
    );
    assert_eq!(
        lookup(
            ApplicationDirectory::Cache,
            "linux",
            &env(&[("XDG_CACHE_HOME", CACHE)])
        ),
        path(&[CACHE, "notes"])
    );
}

#[test]
fn a_lookup_reads_no_file_and_creates_nothing() {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("directory-lookup");
    let _ = std::fs::remove_dir_all(&root);
    let home = root.join("home");
    let state = root.join("state");
    let cache = root.join("cache");
    let env: Env = [
        ("HOME", &home),
        ("XDG_STATE_HOME", &state),
        ("XDG_CACHE_HOME", &cache),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_owned(), value.to_string_lossy().into_owned()))
    .collect();
    for platform in ["linux", "darwin"] {
        for kind in [
            ApplicationDirectory::Installation,
            ApplicationDirectory::Logs,
            ApplicationDirectory::Cache,
        ] {
            let _ = lookup(kind, platform, &env);
        }
    }
    assert!(!root.exists());
}

/// A lookup's path as an operator reads it.
fn shown(lookup: &DirectoryLookup) -> String {
    match lookup {
        DirectoryLookup::Path(path) => path.to_string_lossy().into_owned(),
        other => panic!("a path, not {other:?}"),
    }
}

#[test]
fn each_path_is_normalized_as_path_join_normalizes_it() {
    let messy = env(&[
        ("HOME", HOME),
        ("XDG_STATE_HOME", "/srv/../state//"),
        ("XDG_CACHE_HOME", "/./cache/./x/..//"),
    ]);
    assert_eq!(
        [
            ApplicationDirectory::Installation,
            ApplicationDirectory::Logs,
            ApplicationDirectory::Cache,
        ]
        .map(|kind| shown(&lookup(kind, "linux", &messy))),
        ["/state/notes/installation", "/state/notes", "/cache/notes",]
    );
    let above_root = env(&[("XDG_STATE_HOME", "/../../state")]);
    assert_eq!(
        shown(&lookup(ApplicationDirectory::Logs, "linux", &above_root)),
        "/state/notes"
    );
    let home = env(&[]);
    assert_eq!(
        shown(&lookup_with(
            ApplicationDirectory::Cache,
            "darwin",
            &home,
            "/Users/me/../you/"
        )),
        "/Users/you/Library/Caches/notes"
    );
}
