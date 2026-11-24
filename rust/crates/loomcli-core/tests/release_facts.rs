//! The release facts a build bakes and a test supplies, under `release-facts.md`. The reference's
//! process cases bundle a fixture with each baked value; here the value's reader is the build
//! script's, whose cases are unit tests in `src/shipping/baked.rs`, and these cases read the facts
//! through the public API.

use loomcli_core::{Build, Installation, Release, ReleaseFacts};

#[test]
fn a_build_that_baked_nothing_reads_source() {
    // The test build runs without `LOOM_RELEASE`, as `cargo build` and `cargo run` do.
    let facts = ReleaseFacts::baked();
    assert_eq!(facts, ReleaseFacts::new(Build::Source));
    assert_eq!(
        serde_json::to_string(&facts).unwrap_or_default(),
        r#"{"build":"source"}"#
    );
}

#[test]
fn core_derives_the_channel_from_the_version() {
    let cases = [
        ("1.1.0-next.3", "next"),
        ("1.0.0-beta.1", "beta"),
        ("2.0.0", "stable"),
        ("2.0.0+build.5", "stable"),
    ];
    for (version, channel) in cases {
        let release = Release::new(version, "acme/probe");
        assert_eq!(release.channel, channel, "{version}");
        assert_eq!(release.version, version);
        assert_eq!(release.asset, None);
    }
}

#[test]
fn the_facts_serialize_as_the_reference_freezes_them() {
    let facts = ReleaseFacts::new(Build::Distributed)
        .release(Release::new("1.1.0-next.3", "acme/probe").asset("probe-linux-x64"))
        .installation(Installation::new(
            "script",
            "/home/me/.local/bin/probe",
            "sha256:00",
        ));
    assert_eq!(
        serde_json::to_string(&facts).unwrap_or_default(),
        concat!(
            r#"{"build":"distributed","release":{"asset":"probe-linux-x64","repository":"acme/probe","#,
            r#""channel":"next","version":"1.1.0-next.3"},"installation":{"digest":"sha256:00","#,
            r#""method":"script","path":"/home/me/.local/bin/probe"}}"#
        )
    );
    let unasseted =
        ReleaseFacts::new(Build::Distributed).release(Release::new("2.0.0", "acme/probe"));
    assert_eq!(
        serde_json::to_string(&unasseted).unwrap_or_default(),
        r#"{"build":"distributed","release":{"repository":"acme/probe","channel":"stable","version":"2.0.0"}}"#
    );
}

#[test]
fn a_development_build_is_any_build_but_distributed() {
    assert!(ReleaseFacts::new(Build::Source).is_development());
    assert!(ReleaseFacts::new(Build::Development).is_development());
    assert!(!ReleaseFacts::new(Build::Distributed).is_development());
}

// The run-level cases: a release override by build, the facts `invoke` reads, and `host.program`.

mod runs {
    use std::sync::Arc;

    use loomcli_core::{
        Application, Build, Command, Context, InvocationOutcome, InvocationValues, InvokeOptions,
        Release, ReleaseFacts, RunOptions,
    };
    use loomcli_testing::{MockFields, mock_process};

    /// The reference's `throwing` probe: its root fails with a foreign error, a defect.
    fn throwing() -> Application {
        Application::new("probe")
            .action(|_: Context| async { Err(std::io::Error::other("The probe failed.").into()) })
    }

    /// The reference's `facts` probe: its root prints the release facts its run reads.
    fn facts() -> Application {
        Application::new("probe").action(|ctx: Context| async move {
            let line = serde_json::to_string(&ctx.host.release).unwrap_or_default();
            ctx.out.print(&line).await
        })
    }

    /// An application whose `outer` action calls `inner`, which prints what `read` reads.
    fn nested(
        read: fn(&Context) -> String,
    ) -> Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Group> {
        Application::new("probe")
            .command(
                Command::new("inner").action(move |ctx: Context| async move {
                    let line = read(&ctx);
                    ctx.out.print(&line).await
                }),
            )
            .command(Command::new("outer").action(|ctx: Context| async move {
                let outcome = ctx
                    .invoke(&["inner"], InvocationValues::new(), InvokeOptions::new())
                    .await;
                let line = match outcome {
                    InvocationOutcome::Completed { output, .. } => output.trim().to_owned(),
                    _ => "not completed".to_owned(),
                };
                ctx.out.print(&line).await
            }))
    }

    async fn ran(app: &Application, fields: MockFields) -> (u8, String, String) {
        let mock = mock_process(fields);
        let code = app
            .run(RunOptions::new().process(Arc::clone(&mock) as _))
            .await;
        (code.get(), mock.stdout_text(), mock.stderr_text())
    }

    #[tokio::test]
    async fn a_distributed_override_writes_the_generic_message_and_a_development_one_the_developer_diagnostic()
     {
        assert_eq!(
            ran(
                &throwing(),
                MockFields::new().release(ReleaseFacts::new(Build::Distributed))
            )
            .await,
            (
                1,
                String::new(),
                "probe: Something went wrong.\n".to_owned()
            )
        );
        let (status, stdout, stderr) = ran(
            &throwing(),
            MockFields::new().release(ReleaseFacts::new(Build::Development)),
        )
        .await;
        assert_eq!((status, stdout.as_str()), (1, ""));
        let banner = stderr.lines().next().unwrap_or_default();
        assert!(
            banner.starts_with("-- UNHANDLED EXCEPTION --")
                && banner.ends_with(" @loomcli/core/foreign-throw"),
            "{stderr}"
        );
        assert!(
            stderr[banner.len()..].starts_with("\n\nThe probe failed.\n"),
            "{stderr}"
        );
    }

    #[tokio::test]
    async fn app_invoke_reads_the_builds_facts_or_its_handles_as_given_and_an_actions_invoke_its_runs()
     {
        let outcome = facts()
            .invoke(&[], InvocationValues::new(), InvokeOptions::new(), None)
            .await;
        let InvocationOutcome::Completed { output, .. } = outcome else {
            panic!("the invocation completes");
        };
        assert_eq!(output, "{\"build\":\"source\"}\n");

        let mut given = Release::new("0", "x");
        given.channel = "given".to_owned();
        let supplied = ReleaseFacts::new(Build::Development).release(given);
        let outcome = facts()
            .invoke(
                &[],
                InvocationValues::new(),
                InvokeOptions::new(),
                Some(mock_process(MockFields::new().release(supplied)) as _),
            )
            .await;
        let InvocationOutcome::Completed { output, .. } = outcome else {
            panic!("the invocation completes");
        };
        assert_eq!(
            output,
            "{\"build\":\"development\",\"release\":{\"repository\":\"x\",\"channel\":\"given\",\"version\":\"0\"}}\n"
        );

        let mock = mock_process(
            MockFields::new()
                .argv(["outer"])
                .release(ReleaseFacts::new(Build::Development)),
        );
        let code = nested(|ctx| serde_json::to_string(&ctx.host.release).unwrap_or_default())
            .run(RunOptions::new().process(Arc::clone(&mock) as _))
            .await;
        assert_eq!(
            (code.get(), mock.stdout_text(), mock.stderr_text()),
            (0, "{\"build\":\"development\"}\n".to_owned(), String::new())
        );
    }

    #[tokio::test]
    async fn a_program_override_replaces_the_whole_list_and_an_actions_invoke_keeps_it() {
        let program = Application::new("probe").action(|ctx: Context| async move {
            let line = format!("{:?}", ctx.host.program);
            ctx.out.print(&line).await
        });
        let words = ["/opt/runtime", "/srv/main.js"];
        assert_eq!(
            ran(&program, MockFields::new().program(words)).await,
            (
                0,
                "[\"/opt/runtime\", \"/srv/main.js\"]\n".to_owned(),
                String::new()
            )
        );
        let mock = mock_process(MockFields::new().argv(["outer"]).program(words));
        let code = nested(|ctx| format!("{:?}", ctx.host.program))
            .run(RunOptions::new().process(Arc::clone(&mock) as _))
            .await;
        assert_eq!(
            (code.get(), mock.stdout_text()),
            (0, "[\"/opt/runtime\", \"/srv/main.js\"]\n".to_owned())
        );
    }

    #[tokio::test]
    async fn a_run_on_the_real_handle_reads_host_program_as_the_running_executable() {
        let stdout = Arc::new(Sink::default());
        let handle = loomcli_core::process_handle(
            loomcli_core::ProcessFields::new()
                .argv(Vec::<String>::new())
                .stdout(Arc::clone(&stdout) as _),
        );
        let program = Application::new("probe").action(|ctx: Context| async move {
            let line = format!("{:?}", ctx.host.program);
            ctx.out.print(&line).await
        });
        assert_eq!(
            program.run(RunOptions::new().process(handle)).await.get(),
            0
        );
        let executable = std::env::current_exe()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        assert_eq!(stdout.text(), format!("{:?}\n", [executable]));
    }

    /// A stream that keeps what it is given.
    #[derive(Default)]
    struct Sink(std::sync::Mutex<Vec<u8>>);

    impl Sink {
        fn text(&self) -> String {
            String::from_utf8_lossy(&self.0.lock().map(|bytes| bytes.clone()).unwrap_or_default())
                .into_owned()
        }
    }

    impl loomcli_core::OutputStream for Sink {
        fn write<'a>(
            &'a self,
            bytes: &'a [u8],
        ) -> loomcli_core::BoxFuture<'a, std::io::Result<()>> {
            if let Ok(mut kept) = self.0.lock() {
                kept.extend_from_slice(bytes);
            }
            Box::pin(async { Ok(()) })
        }
    }
}
