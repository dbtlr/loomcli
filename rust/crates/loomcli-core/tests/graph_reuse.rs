//! The Application's kept graph, ported from the reference's `graph-reuse.test.ts`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier, Mutex, Weak};

use loomcli_core::{
    Application, Build, Command, CommandGraph, Context, DeclarationError, DiagnosticParts,
    DiagnosticRule, GroupApplication, InvocationOutcome, InvocationValues, InvokeOptions, Issue,
    Opt, Plugin, ReleaseFacts, RunOptions, State, ValidationContext, Validator, diagnostic_rule,
};
use loomcli_testing::{MockFields, MockProcess, mock_process};

const BUILDS: [Build; 2] = [Build::Development, Build::Distributed];

#[test]
fn repeated_inspection_builds_once() {
    let built = Arc::new(AtomicUsize::new(0));
    let builds = Arc::clone(&built);
    let plugin = Plugin::new("@fixture/count").on_graph_built(move |_graph| {
        builds.fetch_add(1, Ordering::Relaxed);
        Ok(())
    });
    let app = Application::new("probe")
        .plugins([plugin])
        .action(|_: Context| async { Ok(()) });

    assert!(Arc::ptr_eq(
        &app.inspect().unwrap(),
        &app.inspect().unwrap()
    ));
    assert_eq!(built.load(Ordering::Relaxed), 1);
}

#[derive(Default)]
struct Calls {
    attached: AtomicUsize,
    built: AtomicUsize,
    read: Mutex<Vec<Weak<CommandGraph>>>,
}

impl Calls {
    fn counts(&self) -> (usize, usize) {
        (
            self.attached.load(Ordering::Relaxed),
            self.built.load(Ordering::Relaxed),
        )
    }

    fn read(&self) -> Vec<Arc<CommandGraph>> {
        self.read
            .lock()
            .unwrap()
            .iter()
            .map(|graph| graph.upgrade().unwrap())
            .collect()
    }

    fn plugin(self: &Arc<Self>) -> Plugin {
        let attach = Arc::clone(self);
        let build = Arc::clone(self);
        Plugin::new("@fixture/counting")
            .on_command_attach(move |_| {
                attach.attached.fetch_add(1, Ordering::Relaxed);
                Ok(())
            })
            .on_graph_built(move |_| {
                build.built.fetch_add(1, Ordering::Relaxed);
                Ok(())
            })
    }
}

fn counted() -> (GroupApplication, Arc<Calls>) {
    let calls = Arc::new(Calls::default());
    let read = Arc::clone(&calls);
    let app = Application::new("probe")
        .plugins([calls.plugin()])
        .command(Command::new("count").action(move |ctx: Context| {
            let read = Arc::clone(&read);
            async move {
                read.read.lock().unwrap().push(Arc::downgrade(&ctx.graph));
                Ok(())
            }
        }))
        .command(Command::new("caller").action(|ctx: Context| async move {
            let outcome = ctx
                .invoke(&["count"], InvocationValues::new(), InvokeOptions::new())
                .await;
            assert!(matches!(outcome, InvocationOutcome::Completed { .. }));
            Ok(())
        }));
    (app, calls)
}

fn process(build: Build, words: &[&str]) -> Arc<MockProcess> {
    mock_process(
        MockFields::new()
            .argv(words.iter().copied())
            .release(ReleaseFacts::new(build)),
    )
}

async fn run<I, R, S: State>(app: &Application<I, R, S>, build: Build, words: &[&str]) -> u8 {
    app.run(RunOptions::new().process(process(build, words)))
        .await
        .get()
}

async fn invoke(app: &GroupApplication, build: Build, path: &str) {
    let outcome = app
        .invoke(
            &[path],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(process(build, &[])),
        )
        .await;
    assert!(matches!(outcome, InvocationOutcome::Completed { .. }));
}

#[tokio::test]
async fn a_second_run_in_each_build_uses_the_first_graph() {
    for build in BUILDS {
        let (app, calls) = counted();
        for _ in 0..2 {
            assert_eq!(run(&app, build, &["count"]).await, 0);
            assert_eq!(calls.counts(), (3, 1));
        }
        let graphs = calls.read();
        assert!(Arc::ptr_eq(&graphs[0], &graphs[1]));
    }
}

#[test]
fn overlapping_first_runs_share_one_graph() {
    for build in BUILDS {
        let (app, calls) = counted();
        let start = Barrier::new(2);
        let run = || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            start.wait();
            runtime.block_on(run(&app, build, &["count"]))
        };
        std::thread::scope(|scope| {
            let first = scope.spawn(run);
            let second = scope.spawn(run);
            assert_eq!((first.join().unwrap(), second.join().unwrap()), (0, 0));
        });
        assert_eq!(calls.counts(), (3, 1));
        let graphs = calls.read();
        assert!(Arc::ptr_eq(&graphs[0], &graphs[1]));
    }
}

#[tokio::test]
async fn usage_refusals_reuse_a_successfully_built_graph() {
    for build in BUILDS {
        let (app, calls) = counted();
        for _ in 0..2 {
            assert_eq!(run(&app, build, &["--unknown"]).await, 2);
            assert_eq!(calls.counts(), (3, 1));
        }
    }
}

#[tokio::test]
async fn the_two_build_modes_keep_distinct_graphs() {
    let (app, calls) = counted();
    for build in [
        Build::Development,
        Build::Distributed,
        Build::Source,
        Build::Distributed,
    ] {
        assert_eq!(run(&app, build, &["count"]).await, 0);
    }
    assert_eq!(calls.counts(), (6, 2));
    let graphs = calls.read();
    assert!(Arc::ptr_eq(&graphs[0], &graphs[2]));
    assert!(Arc::ptr_eq(&graphs[1], &graphs[3]));
    assert!(!Arc::ptr_eq(&graphs[0], &graphs[1]));
}

#[tokio::test]
async fn inspection_after_two_runs_in_the_baked_build_reads_their_graph() {
    let (app, calls) = counted();
    let baked = ReleaseFacts::baked().build;
    for _ in 0..2 {
        assert_eq!(run(&app, baked, &["count"]).await, 0);
        assert_eq!(calls.counts(), (3, 1));
    }
    let graphs = calls.read();
    for _ in 0..2 {
        assert!(Arc::ptr_eq(&app.inspect().unwrap(), &graphs[0]));
        assert_eq!(calls.counts(), (3, 1));
    }
    assert!(Arc::ptr_eq(&graphs[0], &graphs[1]));
}

#[tokio::test]
async fn a_run_after_inspection_reads_the_inspected_graph() {
    let (app, calls) = counted();
    let graph = app.inspect().unwrap();
    assert_eq!(run(&app, ReleaseFacts::baked().build, &["count"]).await, 0);
    assert!(Arc::ptr_eq(&graph, &calls.read()[0]));
    assert_eq!(calls.counts(), (3, 1));
}

#[tokio::test]
async fn inspection_after_a_run_in_the_other_build_builds_its_own_graph() {
    let (app, calls) = counted();
    let other = if ReleaseFacts::baked().is_development() {
        Build::Distributed
    } else {
        Build::Development
    };
    assert_eq!(run(&app, other, &["count"]).await, 0);
    let inspected = app.inspect().unwrap();
    assert!(!Arc::ptr_eq(&inspected, &calls.read()[0]));
    assert!(Arc::ptr_eq(&inspected, &app.inspect().unwrap()));
    assert_eq!(calls.counts(), (6, 2));
}

#[tokio::test]
async fn run_and_both_forms_of_invocation_share_the_graph() {
    for build in BUILDS {
        let (app, calls) = counted();
        assert_eq!(run(&app, build, &["count"]).await, 0);
        invoke(&app, build, "count").await;
        invoke(&app, build, "caller").await;
        assert_eq!(calls.counts(), (3, 1));
        let graphs = calls.read();
        assert_eq!(graphs.len(), 3);
        assert!(graphs.iter().all(|graph| Arc::ptr_eq(graph, &graphs[0])));

        let (app, calls) = counted();
        invoke(&app, build, "count").await;
        assert_eq!(run(&app, build, &["count"]).await, 0);
        assert_eq!(calls.counts(), (3, 1));
        let graphs = calls.read();
        assert!(Arc::ptr_eq(&graphs[0], &graphs[1]));
    }
}

#[tokio::test]
async fn check_always_builds_and_the_run_uses_only_its_own_build() {
    let (app, calls) = counted();
    for expected in [1, 2] {
        assert!(app.check().is_empty());
        assert_eq!(calls.counts(), (3 * expected, expected));
    }
    assert_eq!(run(&app, Build::Development, &["count"]).await, 0);
    assert_eq!(calls.counts(), (9, 3));
    assert!(app.check().is_empty());
    assert_eq!(run(&app, Build::Development, &["count"]).await, 0);
    assert_eq!(calls.counts(), (12, 4));
    let graphs = calls.read();
    assert!(Arc::ptr_eq(&graphs[0], &graphs[1]));
}

const SHARED_NAME: DiagnosticRule = diagnostic_rule(
    "@fixture/judge/shared-name",
    "Two Commands share one description",
    "Each Command describes its own job.",
);

#[tokio::test]
async fn a_rejected_build_faults_fresh_on_every_call() {
    let judged = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&judged);
    let plugin = Plugin::new("@fixture/judge").on_graph_built(move |_| {
        count.fetch_add(1, Ordering::Relaxed);
        Err(DeclarationError::new(
            SHARED_NAME,
            DiagnosticParts::new("The graph shares a name.")
                .correction("Describe what each Command does in its own words."),
        )
        .into())
    });
    let app = Application::new("probe")
        .plugins([plugin])
        .action(|_: Context| async { Ok(()) });
    for build in BUILDS {
        let mut reports = Vec::new();
        for _ in 0..2 {
            let mock = process(build, &[]);
            assert_eq!(
                app.run(RunOptions::new().process(mock.clone())).await.get(),
                1
            );
            reports.push(mock.stderr_text());
        }
        assert!(!reports[0].is_empty());
        assert_eq!(reports[0], reports[1]);
    }
    assert_eq!(judged.load(Ordering::Relaxed), 4);
    for _ in 0..2 {
        assert_eq!(
            app.inspect().unwrap_err().sentence(),
            "The graph shares a name."
        );
    }
    assert_eq!(judged.load(Ordering::Relaxed), 6);
}

struct WorkingDirectoryDefault;

impl Validator for WorkingDirectoryDefault {
    type Output = String;

    fn validate(&self, text: &str, context: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(format!("{}:{text}", context.host.cwd.display()))
    }
}

#[tokio::test]
async fn declared_defaults_validate_against_each_outer_hosts_facts() {
    let calls = Arc::new(Calls::default());
    let app = Application::new("probe")
        .plugins([calls.plugin()])
        .option(
            "level",
            Opt::string().default("3").validate(WorkingDirectoryDefault),
        )
        .action(|ctx: Context| async move {
            let value = ctx.option::<Option<String>>("level")?;
            ctx.out.print(value.as_deref().unwrap()).await
        });
    for (directory, expected) in [
        ("/loom-test/first", "/loom-test/first:3\n"),
        ("/loom-test/later", "/loom-test/later:3\n"),
    ] {
        let mock = mock_process(MockFields::new().cwd(directory));
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stdout_text(), expected);
    }
    assert_eq!(calls.counts(), (1, 1));
}

#[test]
fn cloning_shares_the_slots_and_authoring_builds_fresh() {
    let (app, calls) = counted();
    let graph = app.inspect().unwrap();
    let same = app.clone();
    assert!(Arc::ptr_eq(&graph, &same.inspect().unwrap()));
    let changed = same
        .description("The edited application.")
        .inspect()
        .unwrap();
    assert!(!Arc::ptr_eq(&graph, &changed));
    assert_eq!(
        changed.description.as_deref(),
        Some("The edited application.")
    );
    assert!(Arc::ptr_eq(&graph, &app.inspect().unwrap()));
    assert_eq!(calls.counts(), (6, 2));
}
