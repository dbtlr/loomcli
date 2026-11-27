//! The run ID, event order, and warning lane from `failure-run.test.ts`.

#![allow(clippy::panic, clippy::unwrap_used)]

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Context, FatalError, InvocationOutcome, InvocationValues, InvokeOptions, LogEvent,
    Plugin, RunOptions,
};
use loomcli_testing::{MockFields, mock_process};

#[tokio::test]
async fn a_failure_hook_reads_the_run_of_the_failure_event_it_follows() {
    let heard = Arc::new(Mutex::new(Vec::<LogEvent>::new()));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let observing = Plugin::new("fixture/observing")
        .on_log({
            let heard = Arc::clone(&heard);
            move |event, _| heard.lock().unwrap().push(event.clone())
        })
        .on_failure({
            let heard = Arc::clone(&heard);
            let seen = Arc::clone(&seen);
            move |_, context| {
                seen.lock()
                    .unwrap()
                    .push((context.run.clone(), heard.lock().unwrap().len()));
                "A hint.".to_owned()
            }
        });
    let mock = mock_process(MockFields::new());
    let exit = Application::new("app")
        .plugins([observing])
        .action(|_: Context| async { Err(FatalError::new("The run failed.").into()) })
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(exit.get(), 1);
    let heard = heard.lock().unwrap();
    assert_eq!(heard.len(), 1);
    assert!(heard[0].failure.as_ref().unwrap().hints.is_empty());
    assert_eq!(*seen.lock().unwrap(), [(heard[0].run.clone(), 1)]);
    assert!(mock.stderr_text().contains("A hint.\n"));
}

#[tokio::test]
async fn a_log_destinations_warning_reaches_the_outermost_run_at_verbosity_zero() {
    let warning = Plugin::new("fixture/warning").on_log(|_, destination| {
        destination.warn("Using the declared level.");
    });
    let app = Application::new("app")
        .plugins([warning])
        .action(|ctx: Context| async move {
            ctx.log.debug("Detail.", ());
            Ok(())
        });
    let mock = mock_process(MockFields::new());
    let exit = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(exit.get(), 0);
    assert_eq!(mock.stderr_text(), "⚠ Using the declared level.\n");

    let invoked = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock),
        )
        .await;
    let InvocationOutcome::Completed { messages, .. } = invoked else {
        panic!("the invocation completes");
    };
    assert_eq!(messages, "⚠ Using the declared level.\n");
}
