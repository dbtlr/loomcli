//! Project lookup on a bounded process handle, from the reference's `config-ceiling.test.ts`.

#![cfg(feature = "config")]
#![allow(clippy::unwrap_used, clippy::panic)]

mod config_support;

use std::io;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use config_support::{Declared, Ran, Settings, Workspace, application, notice, project, shown};
use loomcli_core::{
    Application, Build, Command, Context, InvocationOutcome, InvocationValues, InvokeOptions, Opt,
    ProcessFields, ProcessHandle, ReleaseFacts, RunOptions, process_handle,
};
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::config::{ConfigurationSettings, configuration};
use loomcli_testing::{MockFields, MockProcess, mock_process};
use serde_json::{Map, Value, json};

fn titled(space: &Workspace, directory: &Path, title: &str) {
    space.write_in(
        directory,
        ".app.json",
        &json!({ "title": title }).to_string(),
    );
}

async fn run_on(handle: &Arc<MockProcess>, settings: Settings) -> Ran {
    let app = application(&Declared {
        settings,
        ..Declared::default()
    });
    let status = app
        .run(RunOptions::new().process(handle.clone()))
        .await
        .get();
    Ran {
        status,
        stdout: handle.stdout_text(),
        stderr: handle.stderr_text(),
    }
}

async fn title_on(handle: Arc<MockProcess>) -> Value {
    let ran = run_on(&handle, Settings::default()).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    ran.received()["title"].clone()
}

#[tokio::test]
async fn a_mock_inside_home_reads_no_file_above_its_working_directory() {
    let space = Workspace::new();
    let nested = space.nest(&space.project, &["packages", "cli"]);
    titled(&space, &space.project.join("packages"), "parent");
    let handle = mock_process(MockFields::new().cwd(&nested).home(&space.project));
    assert_eq!(handle.ceiling().unwrap().as_ref(), Some(&nested));
    assert_eq!(title_on(handle).await, Value::Null);
}

#[tokio::test]
async fn a_mock_outside_home_reads_no_file_above_its_working_directory() {
    let space = Workspace::new();
    let nested = space.nest(&space.project, &["packages", "cli"]);
    titled(&space, &space.project, "parent");
    titled(&space, &space.root, "grandparent");
    assert_eq!(
        title_on(mock_process(
            MockFields::new().cwd(nested).home(&space.home)
        ))
        .await,
        Value::Null
    );
}

#[tokio::test]
async fn a_mock_reads_its_working_directory() {
    let space = Workspace::new();
    let nested = space.nest(&space.project, &["cli"]);
    titled(&space, &space.project, "parent");
    titled(&space, &nested, "here");
    assert_eq!(
        title_on(mock_process(
            MockFields::new().cwd(nested).home(&space.home)
        ))
        .await,
        "here"
    );
}

#[tokio::test]
async fn a_named_ceiling_reads_its_own_file_and_nothing_above() {
    let space = Workspace::new();
    let nested = space.nest(&space.project, &["packages", "cli"]);
    titled(&space, &space.root, "above");
    let mock = || {
        mock_process(
            MockFields::new()
                .cwd(&nested)
                .home(&space.home)
                .ceiling(&space.project),
        )
    };
    assert_eq!(mock().ceiling().unwrap().as_ref(), Some(&space.project));
    assert_eq!(title_on(mock()).await, Value::Null);
    titled(&space, &space.project, "parent");
    assert_eq!(title_on(mock()).await, "parent");
    // A relative ceiling compares against the captured working directory.
    let relative = mock_process(
        MockFields::new()
            .cwd(&nested)
            .home(&space.home)
            .ceiling("../.."),
    );
    assert_eq!(title_on(relative).await, "parent");
}

#[tokio::test]
async fn an_outside_start_is_looked_in_alone() {
    let space = Workspace::new();
    let cwd = space.nest(&space.project, &["cli"]);
    let sibling = space.nest(&space.project, &["other"]);
    let deep = space.nest(&sibling, &["deep"]);
    titled(&space, &space.project, "ancestor");
    titled(&space, &sibling, "sibling");
    let settings = Settings::default().with_directory("project").with_notice();
    let mock = |path: &Path| {
        mock_process(
            MockFields::new()
                .cwd(&cwd)
                .home(&space.home)
                .argv(["--project", &shown(path)]),
        )
    };
    let near = run_on(&mock(&sibling), settings.clone()).await;
    assert_eq!(near.received()["title"], "sibling");
    assert_eq!(near.stderr, "");
    let far = run_on(&mock(&deep), settings).await;
    assert_eq!(far.received()["title"], Value::Null);
    assert_eq!(far.stderr, notice(&shown(&deep.join(".app.json"))));
}

#[tokio::test]
async fn a_start_above_the_ceiling_skips_the_walk() {
    let space = Workspace::new();
    let cwd = space.nest(&space.project, &["cli"]);
    titled(&space, &space.project, "ancestor");
    let mock = mock_process(
        MockFields::new()
            .cwd(cwd)
            .home(&space.home)
            .argv(["--project", ".."]),
    );
    let ran = run_on(
        &mock,
        Settings::default().with_directory("project").with_notice(),
    )
    .await;
    assert_eq!(ran.received()["title"], Value::Null);
    assert_eq!(ran.stderr, notice(&shown(&space.home.join(".app.json"))));
}

#[tokio::test]
async fn home_is_excluded_even_when_it_is_also_the_ceiling() {
    let space = Workspace::new();
    titled(&space, &space.home, "home");
    let mock = mock_process(MockFields::new().cwd(&space.home).home(&space.home));
    let ran = run_on(&mock, Settings::default().with_scopes(vec![project(&[])])).await;
    assert_eq!(ran.received()["title"], Value::Null);
}

#[tokio::test]
async fn a_nested_invocation_reuses_the_ceiling() {
    let space = Workspace::new();
    let cwd = space.nest(&space.project, &["cli"]);
    titled(&space, &space.project, "parent");
    let config = configuration::<Map<String, Value>>(ConfigurationSettings::new(None));
    let app = Application::new("app")
        .plugins([config.plugin])
        .command(
            Command::new("show")
                .option(
                    "title",
                    Opt::string().extend([CONFIG_INPUT.value(ConfigInputFacts::path("title"))]),
                )
                .action(|ctx: Context| async move {
                    let title = ctx.option::<Option<String>>("title")?;
                    ctx.out
                        .print(&format!("title:{}", title.as_deref().unwrap_or("none")))
                        .await
                }),
        )
        .command(Command::new("outer").action(|ctx: Context| async move {
            let InvocationOutcome::Completed { output, .. } = ctx
                .invoke(&["show"], InvocationValues::new(), InvokeOptions::new())
                .await
            else {
                panic!("show completes");
            };
            ctx.out.print(output.trim()).await
        }));
    for (fields, expected) in [
        (MockFields::new(), "title:none\n"),
        (MockFields::new().ceiling(&space.project), "title:parent\n"),
    ] {
        let handle = mock_process(fields.argv(["outer"]).cwd(&cwd).home(&space.home));
        assert_eq!(
            app.run(RunOptions::new().process(handle.clone()))
                .await
                .get(),
            0
        );
        assert_eq!(handle.stdout_text(), expected);
    }
}

async fn real_run(space: &Workspace, cwd: &Path, ceiling: Option<&Path>) -> Value {
    let mock = mock_process(MockFields::new());
    let mut fields = ProcessFields::new()
        .argv(Vec::<String>::new())
        .program(["app"])
        .cwd(cwd)
        .env(Default::default())
        .home(&space.root)
        .tmpdir(&space.home)
        .platform("linux")
        .arch("x64")
        .libc(None)
        .uid(None)
        .time_zone("UTC")
        .release(ReleaseFacts::new(Build::Source))
        .stdin(mock.stdin())
        .stdout(mock.stdout())
        .stderr(mock.stderr())
        .terminal(mock.terminal());
    if let Some(path) = ceiling {
        fields = fields.ceiling(path);
    }
    let handle = process_handle(fields);
    assert_eq!(handle.ceiling().unwrap().as_deref(), ceiling);
    let status = application(&Declared::default())
        .run(RunOptions::new().process(handle))
        .await
        .get();
    assert_eq!(status, 0);
    Ran {
        status,
        stdout: mock.stdout_text(),
        stderr: mock.stderr_text(),
    }
    .received()["title"]
        .clone()
}

#[tokio::test]
async fn a_handle_without_a_ceiling_and_a_mock_with_a_root_ceiling_reach_a_parent() {
    let space = Workspace::new();
    let cwd = space.nest(&space.project, &["cli"]);
    titled(&space, &space.project, "parent");
    assert_eq!(real_run(&space, &cwd, None).await, "parent");
    let root = cwd.ancestors().last().unwrap();
    let mock = mock_process(MockFields::new().cwd(&cwd).home(&space.root).ceiling(root));
    assert_eq!(title_on(mock).await, "parent");
}

#[tokio::test]
async fn a_ceiling_on_the_real_handle_bounds_the_walk() {
    let space = Workspace::new();
    let cwd = space.nest(&space.project, &["cli"]);
    titled(&space, &space.project, "parent");
    assert_eq!(real_run(&space, &cwd, Some(&cwd)).await, Value::Null);
    assert_eq!(real_run(&space, &cwd, Some(&space.project)).await, "parent");
}

#[tokio::test]
async fn a_dynamic_mock_cwd_reads_twice_and_the_second_read_can_fail() {
    let space = Workspace::new();
    let cwd = space.nest(&space.project, &["cli"]);
    titled(&space, &space.project, "parent");
    for fail in [false, true] {
        let reads = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&reads);
        let path = cwd.clone();
        let handle = mock_process(MockFields::new().home(&space.home).cwd_with(move || {
            if count.fetch_add(1, Ordering::Relaxed) == 1 && fail {
                Err(io::Error::other("gone"))
            } else {
                Ok(path.clone())
            }
        }));
        let ran = run_on(&handle, Settings::default()).await;
        assert_eq!(reads.load(Ordering::Relaxed), 2);
        if fail {
            assert_eq!(
                (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
                (
                    1,
                    "",
                    "app: The current working directory cannot be read. Change to a directory that exists and run the command again.\n"
                )
            );
        } else {
            assert_eq!(ran.status, 0);
            assert_eq!(ran.received()["title"], Value::Null);
        }
    }
}
