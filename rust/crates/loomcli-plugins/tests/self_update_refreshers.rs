//! Ports the three cases that run the self-update plugin end to end with an installing plugin's
//! refresh as `after_replace`: `skills-self-update.test.ts`, `manpage-self-update.test.ts`, and the
//! self-update case of `completion-refresh.test.ts`. Each replaced binary is a mock program that,
//! once the update wrote its bytes at the recorded path, runs the installing plugin's fixture
//! application with the words the refresh gave it. Each case compiles with its plugin's feature.

#![cfg(all(
    feature = "self-update",
    any(
        feature = "skills",
        all(feature = "manpage", feature = "help"),
        feature = "completion"
    )
))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod self_update_support;

#[cfg(feature = "skills")]
#[allow(unused_imports)]
#[path = "skills_support/mod.rs"]
mod skills_support;

#[cfg(all(feature = "manpage", feature = "help"))]
#[allow(unused_imports)]
#[path = "manpage_support/mod.rs"]
mod manpage_support;

#[cfg(feature = "completion")]
#[allow(unused_imports)]
#[path = "completion_support/mod.rs"]
mod completion_support;

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use loomcli_core::{BoxFuture, Build, Error, Installation, Release, ReleaseFacts};
use loomcli_plugins::self_update::AfterReplaceContext;
use loomcli_testing::{MockFields, ProgramAnswer, ProgramCall};
use self_update_support::{
    AfterReplaceHook, FakeRelease, Fixture, GitHub, Hook, Ran, Records, RunFacts, digest_of,
    mock_for, record_line, recorded_digest, run_named_on, temporary_root,
};
use tokio_util::sync::CancellationToken;

/// A program script, as `MockFields::script` takes it.
type Script =
    Arc<dyn Fn(ProgramCall) -> BoxFuture<'static, io::Result<ProgramAnswer>> + Send + Sync>;

/// A fake GitHub serving one release, `v1.5.0` of `repository`, whose asset holds `bytes`.
fn one_release(repository: &str, asset: &str, bytes: &str) -> GitHub {
    GitHub {
        repository: repository.to_owned(),
        foreign: Vec::new(),
        renamed_from: None,
        latest: Some("v1.5.0".to_owned()),
        feed: vec!["v1.5.0".to_owned()],
        releases: BTreeMap::from([(
            "v1.5.0".to_owned(),
            FakeRelease {
                sums: Some(format!("{}  {asset}\n", digest_of(bytes))),
                assets: BTreeMap::from([(asset.to_owned(), bytes.to_owned())]),
            },
        )]),
    }
}

/// A hook that awaits one refresh function over the context's refresh view.
fn hook_of<F>(refresh: F) -> AfterReplaceHook
where
    F: for<'a> Fn(
            loomcli_plugins::self_update::RefreshContext<'a>,
        ) -> BoxFuture<'a, Result<(), Error>>
        + Send
        + Sync
        + 'static,
{
    let refresh = Arc::new(refresh);
    Arc::new(move |context: AfterReplaceContext| {
        let refresh = Arc::clone(&refresh);
        Box::pin(async move { refresh(context.refresh()).await })
    })
}

/// The binary at `bin/<name>` holding `old` bytes, recorded by the application's installation record
/// under `state`.
fn installed_binary(bin: &Path, state: &Path, name: &str, old: &str) -> PathBuf {
    let binary = bin.join(name);
    std::fs::write(&binary, old).unwrap();
    std::fs::set_permissions(&binary, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let record = state.join(name).join("installation");
    std::fs::create_dir_all(&record).unwrap();
    std::fs::write(record.join("install.json"), record_line(&binary, old)).unwrap();
    binary
}

/// Runs `notes self-update` with `hook` as `after_replace`, the binary at `binary` replaced by the
/// program `replacing`.
#[allow(clippy::too_many_arguments)]
async fn update(
    name: &str,
    github: GitHub,
    asset: &str,
    binary: &Path,
    old: &str,
    env: Vec<(String, String)>,
    home: &Path,
    cwd: &Path,
    hook: AfterReplaceHook,
    replacing: Script,
) -> Ran {
    let release = ReleaseFacts::new(Build::Distributed)
        .release(Release::new("1.4.2", github.repository.clone()).asset(asset))
        .installation(Installation::new(
            "script",
            binary.to_string_lossy(),
            recorded_digest(old),
        ));
    let fixture = Fixture {
        github,
        rules: Vec::new(),
        hook: Hook::None,
        notices: None,
        notice_env: None,
        help: None,
        restyle: false,
        version: "1.4.2".to_owned(),
        records: Records::default(),
        controller: CancellationToken::new(),
        locked: None,
        after_replace: Some(hook),
        verbose: false,
    };
    let command = binary.to_string_lossy().into_owned();
    let process = mock_for(
        &RunFacts {
            argv: vec!["self-update".to_owned()],
            env,
            home: home.to_path_buf(),
            cwd: Some(cwd.to_path_buf()),
            release,
            program: None,
            tty: None,
        },
        move |fields: MockFields| fields.script(&command, move |call| replacing(call)),
    );
    run_named_on(&fixture, name, "run", &process).await
}

/// The answer of a fixture run, as a program answers it.
fn answer_of(status: u8, stdout: String, stderr: String) -> ProgramAnswer {
    ProgramAnswer::new()
        .code(i32::from(status))
        .stdout(stdout)
        .stderr(stderr)
}

#[cfg(feature = "skills")]
#[tokio::test]
async fn an_update_refreshes_a_recorded_skill_to_the_replaced_binarys_version() {
    use loomcli_plugins::skills::{Skill, SkillFile, refresh_skills, skills};

    let root = temporary_root("loom-skills-update");
    let (home, state, bin) = (root.join("home"), root.join("state"), root.join("bin"));
    for directory in [&home, &state, &bin] {
        std::fs::create_dir_all(directory).unwrap();
    }
    let old = "notes 1.4.2 binary\n";
    let new = "notes 1.5.0 binary\n";
    let binary = installed_binary(&bin, &state, "notes", old);
    // The old version installed its skill, so the record lists the folder and the folder holds v1.
    let folder = home.join(".claude").join("skills").join("notes");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("SKILL.md"), "v1\n").unwrap();
    std::fs::write(
        state.join("notes/installation/skills.claude.json"),
        format!(
            "{{\"format\":1,\"state\":\"committed\",\"directories\":[],\"files\":[],\"folders\":[{{\"path\":{}}}]}}\n",
            serde_json::json!(folder.to_string_lossy())
        ),
    )
    .unwrap();
    // The new binary's skill is what the skills application answers, once the update wrote it.
    let (call_home, call_state) = (home.clone(), state.clone());
    let replacing: Script = Arc::new(move |call: ProgramCall| {
        let (home, state) = (call_home.clone(), call_state.clone());
        Box::pin(async move {
            if std::fs::read_to_string(&call.command)? != new {
                return Err(io::Error::other(format!(
                    "{} is not the new notes binary.",
                    call.command
                )));
            }
            let application = skills_support::application_with(skills(vec![Skill::new(
                "notes",
                [SkillFile::new("SKILL.md", "v2\n")],
            )]));
            let mut fields = MockFields::new()
                .argv(call.args.clone())
                .cwd(call.cwd.clone())
                .platform("linux")
                .home(home.clone());
            for (name, value) in &call.env {
                fields = fields.env(name, value);
            }
            fields = fields.env("XDG_STATE_HOME", &state.to_string_lossy());
            let process = loomcli_testing::mock_process(fields);
            let code = application
                .run(
                    loomcli_core::RunOptions::new()
                        .process(Arc::clone(&process) as Arc<dyn loomcli_core::ProcessHandle>),
                )
                .await;
            Ok(answer_of(
                code.get(),
                process.stdout_text(),
                process.stderr_text(),
            ))
        })
    });
    let env = vec![
        ("HOME".to_owned(), home.to_string_lossy().into_owned()),
        (
            "XDG_STATE_HOME".to_owned(),
            state.to_string_lossy().into_owned(),
        ),
    ];
    let ran = update(
        "notes",
        one_release("acme/notes", "notes-linux-x64", new),
        "notes-linux-x64",
        &binary,
        old,
        env,
        &home,
        &root,
        hook_of(|context| Box::pin(refresh_skills(context))),
        replacing,
    )
    .await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert!(ran.stderr.contains("Updated notes from 1.4.2 to 1.5.0."));
    assert!(
        ran.stderr.contains(&format!(
            "Updated notes for claude in {}.",
            folder.display()
        )),
        "{}",
        ran.stderr
    );
    assert_eq!(
        std::fs::read_to_string(folder.join("SKILL.md")).unwrap(),
        "v2\n"
    );
    assert!(!home.join(".agents").exists());
    assert_eq!(std::fs::read_to_string(&binary).unwrap(), new);
    let _ = std::fs::remove_dir_all(&root);
}

#[cfg(all(feature = "manpage", feature = "help"))]
#[tokio::test]
async fn an_update_rewrites_a_recorded_page_to_the_replaced_binarys_version() {
    use loomcli_plugins::manpage::refresh_manpages;

    let root = temporary_root("loom-manpage-update");
    let (home, state, bin) = (root.join("home"), root.join("state"), root.join("bin"));
    for directory in [&home, &state, &bin] {
        std::fs::create_dir_all(directory).unwrap();
    }
    let old = "notes 1.4.2 binary\n";
    let binary = installed_binary(&bin, &state, "notes", old);
    let env = vec![
        ("HOME".to_owned(), home.to_string_lossy().into_owned()),
        (
            "PATH".to_owned(),
            format!("{}:/usr/bin", home.join(".local").join("bin").display()),
        ),
        (
            "XDG_STATE_HOME".to_owned(),
            state.to_string_lossy().into_owned(),
        ),
    ];
    /// Runs the man page application at `version` with these words, directory, and environment.
    async fn notes_at(
        version: &str,
        args: Vec<String>,
        cwd: PathBuf,
        env: Vec<(String, String)>,
        home: &Path,
    ) -> (u8, String, String) {
        let application =
            manpage_support::application(&manpage_support::Scenario::default().version(version));
        let mut fields = MockFields::new()
            .argv(args)
            .cwd(cwd)
            .platform("linux")
            .home(home.to_path_buf())
            .release(ReleaseFacts::new(Build::Distributed));
        for (name, value) in &env {
            fields = fields.env(name, value);
        }
        let ran = manpage_support::run_application(&application, fields).await;
        (ran.status, ran.stdout, ran.stderr)
    }
    // The old version installed its pages.
    let words = vec!["manpage".to_owned(), "install".to_owned()];
    let (status, _, stderr) = notes_at("1.4.2", words, root.clone(), env.clone(), &home).await;
    assert_eq!(status, 0, "{stderr}");
    let page = home.join(".local/share/man/man1/notes.1");
    assert_eq!(
        std::fs::read_to_string(&page)
            .unwrap()
            .lines()
            .next()
            .unwrap(),
        ".TH \"NOTES\" \"1\" \"\" \"notes 1.4.2\" \"\""
    );
    // The new binary runs the same application at the version its bytes name.
    let new = "notes 1.5.0 binary\n";
    let call_home = home.clone();
    let replacing: Script = Arc::new(move |call: ProgramCall| {
        let home = call_home.clone();
        Box::pin(async move {
            let bytes = std::fs::read_to_string(&call.command)?;
            let Some(version) = bytes
                .trim()
                .strip_prefix("notes ")
                .and_then(|rest| rest.strip_suffix(" binary"))
            else {
                return Err(io::Error::other(format!(
                    "{} is not a notes binary.",
                    call.command
                )));
            };
            let env = call
                .env
                .iter()
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect();
            let (status, stdout, stderr) =
                notes_at(version, call.args.clone(), call.cwd.clone(), env, &home).await;
            Ok(answer_of(status, stdout, stderr))
        })
    });
    let ran = update(
        "notes",
        one_release("acme/notes", "notes-linux-x64", new),
        "notes-linux-x64",
        &binary,
        old,
        env,
        &home,
        &root,
        hook_of(|context| Box::pin(refresh_manpages(context))),
        replacing,
    )
    .await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert!(ran.stderr.contains("Updated notes from 1.4.2 to 1.5.0."));
    assert!(
        ran.stderr.contains(&format!(
            "Updated 8 man pages in {}.",
            home.join(".local/share/man/man1").display()
        )),
        "{}",
        ran.stderr
    );
    assert_eq!(
        std::fs::read_to_string(&page)
            .unwrap()
            .lines()
            .next()
            .unwrap(),
        ".TH \"NOTES\" \"1\" \"\" \"notes 1.5.0\" \"\""
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[cfg(feature = "completion")]
#[tokio::test]
async fn a_self_update_rewrites_a_recorded_script_to_the_replaced_binarys_version() {
    use loomcli_plugins::completion::refresh_completion;
    use loomcli_plugins::completion::test_support::bash_script;

    let root = temporary_root("loom-completion-update");
    let (home, data, state, bin) = (
        root.join("home"),
        root.join("data"),
        root.join("state"),
        root.join("bin"),
    );
    let installation = state.join("jsonkit/installation");
    for directory in [&home, &data, &state, &bin, &installation] {
        std::fs::create_dir_all(directory).unwrap();
    }
    let old = "jsonkit 1.4.2 binary\n";
    let binary = installed_binary(&bin, &state, "jsonkit", old);
    // The old version installed its Bash script, so the record lists it and the file holds it.
    let script = data.join("jsonkit/completion/jsonkit.bash");
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::write(&script, "old script\n").unwrap();
    std::fs::write(
        installation.join("completion.bash.json"),
        format!(
            "{}\n",
            serde_json::json!({
                "format": 1,
                "state": "committed",
                "directories": [],
                "files": [{ "path": script, "digest": recorded_digest("old script\n") }],
            })
        ),
    )
    .unwrap();
    let new = "jsonkit 1.5.0 binary\n";
    let (call_home, call_data, call_state) = (home.clone(), data.clone(), state.clone());
    let replacing: Script = Arc::new(move |call: ProgramCall| {
        let (home, data, state) = (call_home.clone(), call_data.clone(), call_state.clone());
        Box::pin(async move {
            if std::fs::read_to_string(&call.command)? != new {
                return Err(io::Error::other(format!(
                    "{} is not the new jsonkit binary.",
                    call.command
                )));
            }
            let process = loomcli_testing::mock_process(
                MockFields::new()
                    .argv(call.args.clone())
                    .cwd(call.cwd.clone())
                    .home(&home)
                    .env("HOME", &home.to_string_lossy())
                    .env("XDG_DATA_HOME", &data.to_string_lossy())
                    .env("XDG_STATE_HOME", &state.to_string_lossy())
                    .uid(Some(completion_support::install::current_uid())),
            );
            let code = completion_support::install::jsonkit()
                .run(
                    loomcli_core::RunOptions::new()
                        .process(Arc::clone(&process) as Arc<dyn loomcli_core::ProcessHandle>),
                )
                .await;
            Ok(answer_of(
                code.get(),
                process.stdout_text(),
                process.stderr_text(),
            ))
        })
    });
    let env = vec![
        ("HOME".to_owned(), home.to_string_lossy().into_owned()),
        (
            "XDG_STATE_HOME".to_owned(),
            state.to_string_lossy().into_owned(),
        ),
    ];
    let ran = update(
        "jsonkit",
        one_release("acme/jsonkit", "jsonkit-linux-x64", new),
        "jsonkit-linux-x64",
        &binary,
        old,
        env,
        &home,
        &root,
        hook_of(|context| Box::pin(refresh_completion(context))),
        replacing,
    )
    .await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert!(
        ran.stderr.contains(&format!(
            "Updated the bash completion script in {}.",
            script.display()
        )),
        "{}",
        ran.stderr
    );
    assert_eq!(
        std::fs::read_to_string(&script).unwrap(),
        bash_script("jsonkit")
    );
    let _ = std::fs::remove_dir_all(&root);
}
