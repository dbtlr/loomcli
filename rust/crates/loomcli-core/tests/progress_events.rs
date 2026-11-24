//! Ports the observed cases of `progress-events.test.ts` that need no invocation by name: a
//! region's reports and closes reach the run's progress observer through `run()`, which the hidden
//! `__private::observe_progress` installs where `invoke`'s `on_progress` will (stage 2.6). The
//! ledger's own cases are unit tests in `src/output/progress.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::__private::{install_log_hook, observe_progress};
use loomcli_core::{
    Application, Context, Done, EndState, Error, LogDestination, LogEvent, NoInputs, NoResult,
    ProgressEvent, ProgressReport, ProgressState, RegionOptions, RunOptions,
};
use loomcli_testing::{MockFields, mock_process};
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, Done>;

/// An event's id, state, label, completed count, and total.
type Facts = (u64, ProgressState, String, Option<f64>, Option<f64>);

/// What an observed run received, with its exit code.
struct Observed {
    events: Vec<ProgressEvent>,
    code: u8,
}

/// Runs an Application whose root runs `action`, observing its progress events.
async fn observed<F, Fut>(
    app: impl FnOnce(App) -> App,
    action: F,
    caller: Option<CancellationToken>,
) -> Observed
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    let events = Arc::new(Mutex::new(Vec::new()));
    let application = app(Application::new("probe")
        .description("Report progress.")
        .action(action));
    let mut options = RunOptions::new().process(mock_process(MockFields::new()) as _);
    if let Some(caller) = caller {
        options = options.signal(caller);
    }
    let options = observe_progress(options, {
        let events = Arc::clone(&events);
        move |event: &ProgressEvent| events.lock().unwrap().push(event.clone())
    });
    let code = application.run(options).await.get();
    let events = events.lock().unwrap().clone();
    Observed { events, code }
}

fn event(
    id: u64,
    state: ProgressState,
    label: &str,
    completed: Option<f64>,
    total: Option<f64>,
) -> Facts {
    (id, state, label.to_owned(), completed, total)
}

fn facts(events: &[ProgressEvent]) -> Vec<Facts> {
    events
        .iter()
        .map(|event| {
            (
                event.id,
                event.state,
                event.label.clone(),
                event.completed,
                event.total,
            )
        })
        .collect()
}

fn states(events: &[ProgressEvent]) -> Vec<(String, ProgressState)> {
    events
        .iter()
        .map(|event| (event.label.clone(), event.state))
        .collect()
}

#[tokio::test]
async fn a_regions_reports_and_end_reach_the_observer_in_order_each_before_report_returns() {
    let received = Arc::new(AtomicUsize::new(usize::MAX));
    let events = Arc::new(Mutex::new(Vec::<ProgressEvent>::new()));
    let application: App = Application::new("probe").action({
        let (received, events) = (Arc::clone(&received), Arc::clone(&events));
        move |ctx: Context| {
            let (received, events) = (Arc::clone(&received), Arc::clone(&events));
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.report(ProgressReport::new().label("Fetching").total(3.0));
                received.store(events.lock().unwrap().len(), Ordering::SeqCst);
                region.report(ProgressReport::new().completed(1.0));
                region.report(ProgressReport::new().completed(2.0).label("Fetching more"));
                region.end(EndState::Ended, None).await
            }
        }
    });
    let options = observe_progress(
        RunOptions::new().process(mock_process(MockFields::new()) as _),
        {
            let events = Arc::clone(&events);
            move |event: &ProgressEvent| events.lock().unwrap().push(event.clone())
        },
    );
    assert_eq!(application.run(options).await.get(), 0);
    assert_eq!(
        facts(&events.lock().unwrap()),
        [
            event(1, ProgressState::Started, "Fetching", None, Some(3.0)),
            event(1, ProgressState::Updated, "Fetching", Some(1.0), Some(3.0)),
            event(
                1,
                ProgressState::Updated,
                "Fetching more",
                Some(2.0),
                Some(3.0)
            ),
            event(
                1,
                ProgressState::Ended,
                "Fetching more",
                Some(2.0),
                Some(3.0)
            ),
        ]
    );
    assert_eq!(received.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn regions_number_by_first_report_read_an_empty_label_before_one_and_read_a_styled_label_plain()
 {
    let run = observed(
        |app| app,
        |ctx: Context| async move {
            let first = ctx.out.region(RegionOptions::new());
            let second = ctx.out.region(RegionOptions::new());
            second.report(ProgressReport::new().completed(4.0));
            first.report(ProgressReport::new().label(ctx.style.token("highlight").apply("x")));
            Ok(())
        },
        None,
    )
    .await;
    let started: Vec<_> = run
        .events
        .iter()
        .filter(|event| event.state == ProgressState::Started)
        .cloned()
        .collect();
    assert_eq!(
        facts(&started),
        [
            event(1, ProgressState::Started, "", Some(4.0), None),
            event(2, ProgressState::Started, "x", None, None),
        ]
    );
}

#[tokio::test]
async fn each_way_a_region_closes_reaches_the_observer_as_its_end_state() {
    let end_failed = observed(
        |app| app,
        |ctx: Context| async move {
            let region = ctx.out.region(RegionOptions::new());
            region.report(ProgressReport::new().label("end failed"));
            region.end(EndState::Failed, None).await
        },
        None,
    )
    .await;
    assert_eq!(
        states(&end_failed.events),
        [
            ("end failed".to_owned(), ProgressState::Started),
            ("end failed".to_owned(), ProgressState::Failed)
        ]
    );
    let thrown = observed(
        |app| app,
        |ctx: Context| async move {
            ctx.out
                .region(RegionOptions::new())
                .report(ProgressReport::new().label("thrown"));
            Err(ctx.out.fatal("It failed."))
        },
        None,
    )
    .await;
    assert_eq!(thrown.code, 1);
    assert_eq!(
        states(&thrown.events),
        [
            ("thrown".to_owned(), ProgressState::Started),
            ("thrown".to_owned(), ProgressState::Failed)
        ]
    );
    let returned = observed(
        |app| app,
        |ctx: Context| async move {
            ctx.out
                .region(RegionOptions::new())
                .report(ProgressReport::new().label("returned"));
            Ok(())
        },
        None,
    )
    .await;
    assert_eq!(
        states(&returned.events),
        [
            ("returned".to_owned(), ProgressState::Started),
            ("returned".to_owned(), ProgressState::Ended)
        ]
    );
    let caller = CancellationToken::new();
    let cancelled = observed(
        |app| app,
        {
            let caller = caller.clone();
            move |ctx: Context| {
                let caller = caller.clone();
                async move {
                    ctx.out
                        .region(RegionOptions::new())
                        .report(ProgressReport::new().label("cancelled"));
                    caller.cancel();
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                    Ok(())
                }
            }
        },
        Some(caller),
    )
    .await;
    assert_eq!(cancelled.code, 130);
    assert_eq!(
        facts(&cancelled.events),
        [
            event(1, ProgressState::Started, "cancelled", None, None),
            event(1, ProgressState::Cancelled, "cancelled", None, None),
        ]
    );
    let silent = observed(
        |app| app,
        |ctx: Context| async move {
            ctx.out
                .region(RegionOptions::new())
                .end(EndState::Ended, None)
                .await
        },
        None,
    )
    .await;
    assert_eq!(silent.code, 0);
    assert!(silent.events.is_empty());
}

#[tokio::test]
async fn an_end_label_reaches_the_end_event_alone_as_plain_text() {
    let run = observed(
        |app| app,
        |ctx: Context| async move {
            let region = ctx.out.region(RegionOptions::new());
            region.report(
                ProgressReport::new()
                    .label("Fetching")
                    .completed(3.0)
                    .total(3.0),
            );
            let label = ctx.style.token("highlight").apply("Fetched 3 records.");
            region.end(EndState::Ended, Some(&label)).await
        },
        None,
    )
    .await;
    assert_eq!(
        facts(&run.events),
        [
            event(1, ProgressState::Started, "Fetching", Some(3.0), Some(3.0)),
            event(
                1,
                ProgressState::Ended,
                "Fetched 3 records.",
                Some(3.0),
                Some(3.0)
            ),
        ]
    );
}

#[tokio::test]
async fn an_on_log_hook_receives_no_event_for_any_report() {
    let heard = Arc::new(Mutex::new(Vec::<String>::new()));
    let run = observed(
        {
            let heard = Arc::clone(&heard);
            move |app| {
                install_log_hook(app, move |event: &LogEvent, _: &LogDestination| {
                    heard.lock().unwrap().push(event.message.clone());
                })
            }
        },
        |ctx: Context| async move {
            let region = ctx.out.region(RegionOptions::new());
            region.report(ProgressReport::new().label("reported").total(2.0));
            region.report(ProgressReport::new().completed(1.0));
            region.end(EndState::Ended, None).await
        },
        None,
    )
    .await;
    assert_eq!(run.events.len(), 3);
    assert!(heard.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_region_reports_whether_or_not_it_is_live() {
    // The mock's streams are pipes, so no region is live, and each still reports.
    let run = observed(
        |app| app,
        |ctx: Context| async move {
            let region = ctx.out.region(RegionOptions::new());
            assert!(!region.live());
            region.report(ProgressReport::new().label("piped"));
            Ok(())
        },
        None,
    )
    .await;
    assert_eq!(
        states(&run.events),
        [
            ("piped".to_owned(), ProgressState::Started),
            ("piped".to_owned(), ProgressState::Ended)
        ]
    );
}
