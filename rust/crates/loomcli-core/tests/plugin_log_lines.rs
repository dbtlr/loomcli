//! The outermost log destination of plugin hooks.

#![allow(clippy::unwrap_used)]

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Command, Context, InvocationOutcome, InvocationValues, InvokeOptions, LogFields,
    Opt, Plugin, RunOptions,
};
use loomcli_testing::{MockFields, mock_process};

#[tokio::test]
async fn environment_hook_log_respects_the_outer_run_verbosity() {
    for (flags, expected) in [
        (&[][..], ""),
        (&["-L"], "› Read the environment.\n"),
        (
            &["-LL"],
            "› Read the environment.\n  ┆ Looked at the environment.\n",
        ),
    ] {
        let app = Application::new("app")
            .plugins([
                Plugin::new("fixture/environment").on_environment(|ctx| async move {
                    ctx.log.debug("Read the environment.", ());
                    ctx.log.trace("Looked at the environment.", ());
                    Ok(Default::default())
                }),
            ])
            .global_option("loud", Opt::count().short('L').verbose())
            .action(|_: Context| async { Ok(()) });
        let mock = mock_process(MockFields::new().argv(flags.iter().copied()));
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stderr_text(), expected);
    }
}

#[tokio::test]
async fn destination_log_preserves_identity_and_does_not_call_its_own_hook() {
    let own = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let collected = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/observer").on_log({
        let own = Arc::clone(&own);
        let seen = Arc::clone(&seen);
        move |event, destination| {
            own.lock().unwrap().push(event.message.clone());
            seen.lock()
                .unwrap()
                .push(std::ptr::from_ref(destination).addr());
            let log = destination
                .log
                .with(LogFields::new().field("message", &event.message));
            log.debug("Saw {message}", ());
            log.trace("Traced {message}", ());
        }
    });
    let recorder = Plugin::new("fixture/recorder").on_log({
        let collected = Arc::clone(&collected);
        move |event, _| collected.lock().unwrap().push(event.clone())
    });
    let app = Application::new("app")
        .plugins([observer, recorder])
        .global_option("loud", Opt::count().short('L').verbose())
        .command(Command::new("inner").action(|ctx: Context| async move {
            ctx.log.info("Nested.", ());
            Ok(())
        }))
        .command(Command::new("outer").action(|ctx: Context| async move {
            ctx.log.info("Outer.", ());
            let outcome = ctx.invoke(&["inner"], InvocationValues::new(), InvokeOptions::new()).await;
            assert!(matches!(outcome, InvocationOutcome::Completed { messages, .. } if messages.is_empty()));
            Ok(())
        }));
    let mock = mock_process(MockFields::new().argv(["-LL", "outer"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        concat!(
            "› Outer.\n› Saw Outer.\n  ┆ Traced Outer.\n",
            "› Nested.\n› Saw Nested.\n  ┆ Traced Nested.\n"
        )
    );
    assert_eq!(*own.lock().unwrap(), ["Outer.", "Nested."]);
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert_eq!(seen[0], seen[1]);
    let collected = collected.lock().unwrap();
    assert_eq!(
        collected
            .iter()
            .map(|event| (event.plugin.as_deref(), event.message.as_str()))
            .collect::<Vec<_>>(),
        [
            (Some("fixture/observer"), "Saw {message}"),
            (Some("fixture/observer"), "Traced {message}"),
            (None, "Outer."),
            (Some("fixture/observer"), "Saw {message}"),
            (Some("fixture/observer"), "Traced {message}"),
            (None, "Nested.")
        ]
    );
    assert_eq!(collected[3].path, ["outer"]);
    assert_eq!(collected[5].path, ["inner"]);
    assert_ne!(collected[3].run, collected[5].run);
}

#[tokio::test]
async fn a_top_level_named_invocation_captures_lines_from_the_hook() {
    let observer = Plugin::new("fixture/observer").on_log(|event, destination| {
        assert!(destination.stderr.is_none());
        destination.log.debug(
            "Saw {message}",
            LogFields::new().field("message", &event.message),
        );
    });
    let app = Application::new("app")
        .plugins([observer])
        .global_option("loud", Opt::count().short('L').verbose())
        .action(|ctx: Context| async move {
            ctx.log.info("Called.", ());
            Ok(())
        });
    for (verbosity, expected) in [(0, ""), (1, "› Called.\n› Saw Called.\n")] {
        let mock = mock_process(MockFields::new());
        let outcome = app
            .invoke(
                &[],
                InvocationValues::new().option("loud", verbosity),
                InvokeOptions::new(),
                Some(mock),
            )
            .await;
        assert!(
            matches!(outcome, InvocationOutcome::Completed { messages, .. } if messages == expected)
        );
    }
}
